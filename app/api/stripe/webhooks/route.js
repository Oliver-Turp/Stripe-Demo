import { NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe-server'
import { saveCustomer, saveSubscription, savePayment, saveCustomerEntitlements } from '@/lib/storage'

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

      case 'invoice.payment_failed':
        const invoiceFailed = event.data.object
        console.log('Invoice payment failed:', invoiceFailed.id)
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
        // Check if this was a plan change (price change)
        const previousAttributes = event.data.previous_attributes
        const wasScheduleChange = previousAttributes?.items?.data?.[0]?.price?.id

        if (wasScheduleChange) {
          console.log(`📋 Plan change detected for subscription: ${updatedSubscription.id}`)
          console.log(`Old price: ${previousAttributes.items.data[0].price.id}`)
          console.log(`New price: ${updatedSubscription.items.data[0].price.id}`)
        }

        // Check if subscription was paused/resumed
        if (previousAttributes?.pause_collection !== undefined) {
          if (updatedSubscription.pause_collection) {
            console.log(`⏸️ Subscription paused: ${updatedSubscription.id}`)
          } else {
            console.log(`▶️ Subscription resumed: ${updatedSubscription.id}`)
          }
        }

        // Check if cancellation was scheduled/unscheduled
        if (previousAttributes?.cancel_at_period_end !== undefined) {
          if (updatedSubscription.cancel_at_period_end) {
            console.log(`🗓️ Subscription scheduled for cancellation: ${updatedSubscription.id}`)
          } else {
            console.log(`🔄 Subscription cancellation unscheduled: ${updatedSubscription.id}`)
          }
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
