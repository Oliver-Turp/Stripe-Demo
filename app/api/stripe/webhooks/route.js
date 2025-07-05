import { NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe-server'
import { saveCustomer, saveSubscription, savePayment, saveCustomerEntitlements, suspendCustomerEntitlements } from '@/lib/storage'

export async function POST(request) {
  const body = await request.text()
  const sig = request.headers.get('stripe-signature')
  let event

  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET)
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message)
    return NextResponse.json({ error: 'Webhook signature verification failed' }, { status: 400 })
  }

  console.log('Webhook event type:', event.type)

  try {
    switch (event.type) {
      // 🆕 NEW: Entitlement events
      case 'entitlements.active_entitlement_summary.updated':
        await handleEntitlementSummaryUpdated(event.data.object)
        break

      case 'customer.created':
      case 'customer.updated':
        const customer = event.data.object
        await saveCustomer(customer.id, {
          stripeCustomerId: customer.id,
          email: customer.email,
          name: customer.name,
          metadata: customer.metadata,
          created: customer.created,
        })
        console.log('Customer saved:', customer.id)
        break

      case 'payment_intent.succeeded':
        const paymentIntentSucceeded = event.data.object
        await savePayment(paymentIntentSucceeded.id, {
          stripePaymentIntentId: paymentIntentSucceeded.id,
          customerId: paymentIntentSucceeded.customer,
          amount: paymentIntentSucceeded.amount,
          currency: paymentIntentSucceeded.currency,
          status: 'succeeded',
          paymentMethod: paymentIntentSucceeded.payment_method,
        })
        console.log('Payment succeeded and saved:', paymentIntentSucceeded.id)
        break

      case 'payment_intent.payment_failed':
        const paymentIntentFailed = event.data.object
        await savePayment(paymentIntentFailed.id, {
          stripePaymentIntentId: paymentIntentFailed.id,
          customerId: paymentIntentFailed.customer,
          amount: paymentIntentFailed.amount,
          currency: paymentIntentFailed.currency,
          status: 'failed',
          lastPaymentError: paymentIntentFailed.last_payment_error,
        })
        console.log('Payment failed and saved:', paymentIntentFailed.id)
        break

      case 'invoice.payment_succeeded':
        const invoiceSucceeded = event.data.object
        console.log('Invoice payment succeeded:', invoiceSucceeded.id)

        // 🔄 RESTORE ACCESS: If this was a subscription invoice, restore access
        if (invoiceSucceeded.subscription && invoiceSucceeded.customer) {
          console.log(`✅ Payment succeeded - restoring access for customer: ${invoiceSucceeded.customer}`)

          // Get the subscription to check if it was previously past_due
          const subscription = await stripe.subscriptions.retrieve(invoiceSucceeded.subscription)

          if (subscription.status === 'active') {
            console.log(`🔓 Restoring entitlements for customer: ${invoiceSucceeded.customer}`)
            // The entitlements.active_entitlement_summary.updated webhook will handle this automatically
            // But you could also manually restore access here if needed
          }
        }

        // 🧹 CLEANUP: If this is a subscription invoice, clean up other incomplete subscriptions
        const subscriptionId = invoiceSucceeded.parent?.subscription_details?.subscription
        if (subscriptionId && invoiceSucceeded.customer) {
          try {
            console.log(`🧹 Cleaning up incomplete subscriptions for customer: ${invoiceSucceeded.customer}`)
            console.log(`✅ Successful subscription: ${subscriptionId}`)

            // Get all incomplete subscriptions for this customer
            const incompleteSubscriptions = await stripe.subscriptions.list({
              customer: invoiceSucceeded.customer,
              status: 'incomplete',
              limit: 100
            })

            if (incompleteSubscriptions.data.length > 0) {
              console.log(`Found ${incompleteSubscriptions.data.length} incomplete subscriptions to clean up`)
              let cleanedCount = 0

              for (const incompleteSub of incompleteSubscriptions.data) {
                // Don't cancel the subscription that just succeeded
                if (incompleteSub.id !== subscriptionId) {
                  try {
                    await stripe.subscriptions.cancel(incompleteSub.id)
                    cleanedCount++
                    console.log(`✅ Cancelled incomplete subscription: ${incompleteSub.id}`)
                  } catch (cancelError) {
                    console.warn(`⚠️ Failed to cancel subscription ${incompleteSub.id}:`, cancelError.message)
                  }
                } else {
                  console.log(`🎯 Skipping successful subscription: ${incompleteSub.id}`)
                }
              }
              console.log(`🎉 Successfully cleaned up ${cleanedCount} incomplete subscriptions for customer ${invoiceSucceeded.customer}`)
            } else {
              console.log(`✨ No incomplete subscriptions to clean up for customer ${invoiceSucceeded.customer}`)
            }
          } catch (cleanupError) {
            console.error('Error during incomplete subscription cleanup:', cleanupError)
            // Don't fail the webhook if cleanup fails
          }
        } else {
          console.log('Not a subscription invoice or missing customer/subscription info')
        }
        break

      // 🚨 NEW: Handle payment failures - IMMEDIATE LOCKOUT
      case 'invoice.payment_failed':
        const invoiceFailed = event.data.object
        console.log('🚨 Invoice payment failed:', invoiceFailed.id)

        // 🔍 DEBUG: Log the invoice object to see what we're working with
        console.log('🔍 Invoice details:', {
          id: invoiceFailed.id,
          customer: invoiceFailed.customer,
          subscription: invoiceFailed.subscription,
          billing_reason: invoiceFailed.billing_reason,
          amount_due: invoiceFailed.amount_due,
          attempt_count: invoiceFailed.attempt_count
        })

        // Check if this is a subscription invoice (multiple ways to detect)
        const isSubscriptionInvoice = invoiceFailed.subscription ||
          invoiceFailed.billing_reason === 'subscription_create' ||
          invoiceFailed.billing_reason === 'subscription_cycle' ||
          invoiceFailed.billing_reason === 'subscription_update'

        // Check if this is a subscription invoice
        if (isSubscriptionInvoice && invoiceFailed.customer) {
          console.log(`🔒 Payment failed for subscription invoice - suspending access`)
          console.log(`📋 Billing reason: ${invoiceFailed.billing_reason}`)

          try {
            // Get subscription details
            const customer = await stripe.customers.retrieve(invoiceFailed.customer)

            console.log(`🚨 Suspending access for customer: ${customer.email} (${customer.id})`)
            console.log(`💰 Failed amount: £${(invoiceFailed.amount_due / 100).toFixed(2)}`)
            console.log(`📅 Attempt: ${invoiceFailed.attempt_count}`)

            // Suspend customer entitlements immediately
            await suspendCustomerEntitlements(invoiceFailed.customer, {
              reason: 'payment_failed',
              failedInvoiceId: invoiceFailed.id,
              subscriptionId: invoiceFailed.subscription,
              billingReason: invoiceFailed.billing_reason,
              suspendedAt: new Date().toISOString(),
              attemptCount: invoiceFailed.attempt_count,
              amountDue: invoiceFailed.amount_due
            })

            console.log(`🔒 Access suspended for customer ${customer.email}`)

          } catch (suspendError) {
            console.error('Error suspending customer access:', suspendError)
            // Don't fail the webhook if suspension fails
          }
        } else {
          console.log('🔍 Not a subscription invoice or missing customer:', {
            hasSubscription: !!invoiceFailed.subscription,
            hasCustomer: !!invoiceFailed.customer,
            billingReason: invoiceFailed.billing_reason
          })
        }
        break

      case 'invoice.upcoming':
        const upcomingInvoice = event.data.object
        const upcomingSubscriptionId = upcomingInvoice.subscription || upcomingInvoice.parent?.subscription_details?.subscription
        console.log(`📅 Upcoming invoice for customer ${upcomingInvoice.customer} (subscription: ${upcomingSubscriptionId})`)
        console.log(`Amount due: ${upcomingInvoice.amount_due / 100} ${upcomingInvoice.currency.toUpperCase()}`)
        break

      case 'invoice.created':
        const createdInvoice = event.data.object
        console.log(`📄 Invoice created: ${createdInvoice.id} for customer ${createdInvoice.customer}`)
        break

      case 'customer.subscription.created':
        const createdSubscription = event.data.object
        await saveSubscription(createdSubscription.id, {
          stripeSubscriptionId: createdSubscription.id,
          customerId: createdSubscription.customer,
          status: createdSubscription.status,
          priceId: createdSubscription.items.data[0]?.price?.id,
          productId: createdSubscription.items.data[0]?.price?.product,
          currentPeriodStart: createdSubscription.current_period_start,
          currentPeriodEnd: createdSubscription.current_period_end,
          cancelAtPeriodEnd: createdSubscription.cancel_at_period_end,
          metadata: createdSubscription.metadata,
        })
        console.log('Subscription created:', createdSubscription.id)
        break

      case 'customer.subscription.updated':
        const updatedSubscription = event.data.object
        const previousAttributes = event.data.previous_attributes

        // 🔄 Check if subscription status changed from past_due to active (payment recovered)
        if (updatedSubscription.status === 'active' &&
          previousAttributes?.status === 'past_due') {
          console.log(`🎉 Subscription recovered from past_due: ${updatedSubscription.id}`)
          console.log(`🔓 Customer should regain access: ${updatedSubscription.customer}`)
          // The entitlements webhook will handle restoring access automatically
        }

        // Check if subscription became past_due
        if (updatedSubscription.status === 'past_due' &&
          previousAttributes?.status !== 'past_due') {
          console.log(`🚨 Subscription became past due: ${updatedSubscription.id}`)
          console.log(`🔒 Customer access should be suspended: ${updatedSubscription.customer}`)
          // Access should already be suspended by invoice.payment_failed webhook
        }

        // Check for other status changes
        if (previousAttributes?.status &&
          previousAttributes.status !== updatedSubscription.status) {
          console.log(`📊 Subscription status changed: ${previousAttributes.status} → ${updatedSubscription.status}`)
        }

        await saveSubscription(updatedSubscription.id, {
          stripeSubscriptionId: updatedSubscription.id,
          customerId: updatedSubscription.customer,
          status: updatedSubscription.status,
          priceId: updatedSubscription.items.data[0]?.price?.id,
          productId: updatedSubscription.items.data[0]?.price?.product,
          currentPeriodStart: updatedSubscription.current_period_start,
          currentPeriodEnd: updatedSubscription.current_period_end,
          cancelAtPeriodEnd: updatedSubscription.cancel_at_period_end,
          cancelAt: updatedSubscription.cancel_at,
          canceledAt: updatedSubscription.canceled_at,
          pauseCollection: updatedSubscription.pause_collection,
          metadata: updatedSubscription.metadata,
        })
        console.log('Subscription updated:', updatedSubscription.id)
        break

      case 'customer.subscription.deleted':
        const deletedSubscription = event.data.object
        await saveSubscription(deletedSubscription.id, {
          stripeSubscriptionId: deletedSubscription.id,
          customerId: deletedSubscription.customer,
          status: 'canceled',
          canceledAt: deletedSubscription.canceled_at,
          endedAt: deletedSubscription.ended_at,
        })
        console.log('Subscription canceled/deleted:', deletedSubscription.id)
        break

      case 'customer.subscription.paused':
        const pausedSubscription = event.data.object
        await saveSubscription(pausedSubscription.id, {
          stripeSubscriptionId: pausedSubscription.id,
          customerId: pausedSubscription.customer,
          status: 'paused',
          pauseCollection: pausedSubscription.pause_collection,
        })
        console.log('Subscription paused:', pausedSubscription.id)
        break

      case 'customer.subscription.resumed':
        const resumedSubscription = event.data.object
        await saveSubscription(resumedSubscription.id, {
          stripeSubscriptionId: resumedSubscription.id,
          customerId: resumedSubscription.customer,
          status: resumedSubscription.status,
          pauseCollection: null, // Clear pause when resumed
        })
        console.log('Subscription resumed:', resumedSubscription.id)
        break

      default:
        console.log(`Unhandled event type: ${event.type}`)
    }

    return NextResponse.json({ received: true })

  } catch (error) {
    console.error('Webhook handler error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// 🆕 NEW: Handle entitlement summary updates
async function handleEntitlementSummaryUpdated(entitlementSummary) {
  try {
    console.log('🎯 Processing entitlement summary update for customer:', entitlementSummary.customer)

    // Get the full customer data
    const customer = await stripe.customers.retrieve(entitlementSummary.customer)

    // Save/update customer info (without entitlements first)
    await saveCustomer(customer.id, {
      stripeCustomerId: customer.id,
      email: customer.email,
      name: customer.name,
      metadata: customer.metadata,
      created: customer.created
    })

    const entitlements = entitlementSummary.entitlements?.data || []
    console.log(`📋 Found ${entitlements.length} entitlements to process`)

    // Build entitlements object to nest under customer
    const customerEntitlements = {}

    // Process each entitlement
    for (const entitlement of entitlements) {
      // Get feature details since entitlement.feature is just an ID
      let featureName = 'Unknown Feature'
      let featureMetadata = {}

      try {
        // Fetch the full feature object
        const feature = await stripe.entitlements.features.retrieve(entitlement.feature)
        featureName = feature.name || feature.lookup_key
        featureMetadata = feature.metadata || {}
        console.log(`  🔍 Retrieved feature details: ${featureName} (${feature.lookup_key})`)
      } catch (featureError) {
        console.warn(`  ⚠️ Could not retrieve feature ${entitlement.feature}:`, featureError.message)
        // Use lookup_key from entitlement as fallback
        featureName = entitlement.lookup_key || 'Unknown Feature'
      }

      console.log(`  📋 Processing entitlement: ${featureName} (${entitlement.lookup_key})`)

      // Add to customer entitlements object
      customerEntitlements[entitlement.id] = {
        stripeEntitlementId: entitlement.id,
        featureId: entitlement.feature,
        featureLookupKey: entitlement.lookup_key,
        featureName: featureName,
        status: 'active',
        type: entitlement.type,
        value: entitlement.value,
        metadata: featureMetadata,
        updatedAt: new Date().toISOString()
      }

      console.log(`  ✅ Prepared entitlement: ${featureName}`)
    }

    // Save all entitlements at once (overwrites existing)
    await saveCustomerEntitlements(customer.id, customerEntitlements)

    console.log(`✅ Updated ${entitlements.length} entitlements for customer ${customer.email}`)

  } catch (error) {
    console.error('Error handling entitlement summary update:', error)
    throw error
  }
}
