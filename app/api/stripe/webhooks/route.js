import { NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe-server'
import { saveCustomer, saveCustomerSubscription, saveCustomerEntitlements, suspendCustomerEntitlements } from '@/lib/storage'

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
      case 'customer.created':
      case 'customer.updated':
        const customer = event.data.object
        console.log("**[customer.created/updated] CUSTOMER OBJECT**", customer);
        await saveCustomer(customer.id, {
          stripeCustomerId: customer.id,
          email: customer.email,
          name: customer.name,
          created: customer.created,
        })
        console.log('Customer saved:', customer.id)
        break

      case 'payment_intent.succeeded':
        const paymentIntentSucceeded = event.data.object
        // ❌ REMOVED: savePayment call - no longer needed
        console.log('Payment succeeded:', paymentIntentSucceeded.id)
        break

      case 'payment_intent.payment_failed':
        const paymentIntentFailed = event.data.object
        // ❌ REMOVED: savePayment call - no longer needed
        console.log('Payment failed:', paymentIntentFailed.id)
        break

      case 'invoice.payment_succeeded':
        const invoiceSucceeded = event.data.object
        console.log('Invoice payment succeeded:', invoiceSucceeded.id)
        console.log('[invoice.payment_succeeded] **INVOICE OBJECT**', invoiceSucceeded);

        // ✅ CORRECT: Get subscription ID from the nested structure
        const subscriptionId = invoiceSucceeded.parent?.subscription_details?.subscription

        // 🔄 RESTORE ACCESS: If this was a subscription invoice, restore access
        if (subscriptionId && invoiceSucceeded.customer) {
          console.log(`✅ Payment succeeded - restoring access for customer: ${invoiceSucceeded.customer}`)

          // Get the subscription to check if it was previously past_due
          const subscription = await stripe.subscriptions.retrieve(subscriptionId)

          if (subscription.status === 'active') {
            console.log(`🔓 Restoring entitlements for customer: ${invoiceSucceeded.customer}`)

            // ✅ SAVE SUBSCRIPTION DATA ON SUCCESSFUL PAYMENT
            await saveCustomerSubscription(invoiceSucceeded.customer, {
              stripeSubscriptionId: subscription.id,
              status: subscription.status,
              priceId: subscription.items.data[0]?.price?.id,
              productId: subscription.items.data[0]?.price?.product,
              currentPeriodStart: subscription.current_period_start,
              currentPeriodEnd: subscription.current_period_end,
              cancelAtPeriodEnd: subscription.cancel_at_period_end,
              metadata: subscription.metadata,
            })
            console.log(`💾 Saved subscription data for customer: ${invoiceSucceeded.customer}`)
          }

          // 🧹 CLEANUP: Clean up other incomplete subscriptions
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

          // ✅ FIX: Discord logging for subscription
          try {
            const customer = await stripe.customers.retrieve(invoiceSucceeded.customer)
            console.log('[invoice.payment_succeeded] **CUSTOMER OBJECT**', customer)

            // ✅ FIX: Use the correct subscription ID from the nested structure
            const subscription = await stripe.subscriptions.retrieve(subscriptionId)
            console.log('[invoice.payment_succeeded] **SUBSCRIPTION OBJECT**', subscription)

            // Get the product name from the subscription
            const priceId = subscription.items.data[0]?.price?.id
            const price = await stripe.prices.retrieve(priceId)
            const product = await stripe.products.retrieve(price.product)

            // ✅ FIX: Update customer metadata to reflect the actual purchased plan
            await stripe.customers.update(customer.id, {
              metadata: {
                plan: `${product.id}_${price.recurring.interval}`,
                product: product.name
              }
            })
            console.log(`🔄 Updated customer metadata to reflect purchased plan: ${product.name}`)

            await sendDiscordLog({
              title: '💰 Subscription Payment Succeeded',
              color: 0x00ff00, // Green
              fields: [
                // Row 1: Name and Email (2 columns)
                {
                  name: '👤 Customer Name',
                  value: customer.name || 'Not provided',
                  inline: true
                },
                {
                  name: '📧 Email',
                  value: customer.email || 'Unknown',
                  inline: true
                },

                // Row 2: Customer ID (full width)
                {
                  name: '🆔 Customer ID',
                  value: `\`${customer.id}\``,
                  inline: false
                },

                // Row 3: Plan details
                {
                  name: '📦 Plan',
                  value: product.name || 'Unknown',
                  inline: true
                },
                {
                  name: '🔄 Cycle',
                  value: price.recurring.interval === 'month' ? 'Monthly' :
                    price.recurring.interval === 'year' ? 'Yearly' :
                      (price.recurring.interval || 'Unknown'),
                  inline: true
                },
                {
                  name: '💰 Amount',
                  value: `£${(invoiceSucceeded.amount_paid / 100).toFixed(2)}`,
                  inline: true
                },

                // Row 4: Discount (only if exists, full width)
                ...(subscription.discount?.coupon ? [{
                  name: '🎟️ Discount Applied',
                  value: `**${subscription.discount.coupon.name}** - ${subscription.discount.coupon.percent_off
                    ? `${subscription.discount.coupon.percent_off}% off`
                    : `£${(subscription.discount.coupon.amount_off / 100).toFixed(2)} off`
                    }`,
                  inline: false
                }] : []),

                // Row 5: Invoice ID (full width)
                {
                  name: '🧾 Invoice ID',
                  value: `\`${invoiceSucceeded.id}\``,
                  inline: false
                }
              ],
              timestamp: new Date().toISOString()
            })

          } catch (discordError) {
            console.error('Discord logging failed for payment succeeded:', discordError.message)
          }
        } else {
          console.log('Not a subscription invoice or missing customer/subscription info')
          console.log('Debug info:', {
            hasSubscriptionId: !!subscriptionId,
            hasCustomer: !!invoiceSucceeded.customer,
            parentType: invoiceSucceeded.parent?.type,
            billingReason: invoiceSucceeded.billing_reason
          })
        }
        break

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

        const isInitialPaymentAttempt = invoiceFailed.billing_reason === 'subscription_create' &&
          invoiceFailed.attempt_count === 0

        // Check if this is a subscription invoice
        if (isSubscriptionInvoice && invoiceFailed.customer && !isInitialPaymentAttempt) {
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

          // Discord logging for payment failures
          try {
            const customer = await stripe.customers.retrieve(invoiceFailed.customer)

            await sendDiscordLog({
              title: '🚨 Subscription Payment Failed',
              color: 0xff0000, // Red
              fields: [
                { name: 'Customer', value: customer.email || 'Unknown', inline: true },
                { name: 'Amount Due', value: `£${(invoiceFailed.amount_due / 100).toFixed(2)}`, inline: true },
                { name: 'Attempt', value: `${invoiceFailed.attempt_count}`, inline: true },
                { name: 'Billing Reason', value: invoiceFailed.billing_reason, inline: true },
                { name: 'Invoice ID', value: invoiceFailed.id, inline: false }
              ],
              timestamp: new Date().toISOString()
            })
          } catch (discordError) {
            console.error('Discord logging failed for payment failed:', discordError.message)
          }
        } else if (isInitialPaymentAttempt) {
          console.log('🔍 Skipping suspension for initial payment attempt (likely 3D Secure flow)')
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
        // ❌ REMOVED: Don't save subscription data here - wait for payment confirmation
        console.log('Subscription created (waiting for payment):', createdSubscription.id)
        console.log('Status:', createdSubscription.status)
        break

      case 'customer.subscription.updated':
        const updatedSubscription = event.data.object
        const previousAttributes = event.data.previous_attributes

        // 🔄 Check if subscription status changed from past_due to active (payment recovered)
        if (updatedSubscription.status === 'active' &&
          previousAttributes?.status === 'past_due') {
          console.log(`🎉 Subscription recovered from past_due: ${updatedSubscription.id}`)
          console.log(`🔓 Customer should regain access: ${updatedSubscription.customer}`)

          // ✅ UPDATE SUBSCRIPTION DATA ON RECOVERY
          await saveCustomerSubscription(updatedSubscription.customer, {
            stripeSubscriptionId: updatedSubscription.id,
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
          console.log(`💾 Updated subscription data for recovered customer: ${updatedSubscription.customer}`)
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

        // ❌ REMOVED: Don't automatically save all subscription updates - only save on confirmed payments
        console.log('Subscription updated:', updatedSubscription.id)
        break

      case 'customer.subscription.deleted':
        const deletedSubscription = event.data.object
        console.log("[customer.subscription.deleted] **DELETED SUBSCRIPTION OBJECT**", deletedSubscription);

        // ✅ UPDATED: Use saveCustomerSubscription instead of saveSubscription
        await saveCustomerSubscription(deletedSubscription.customer, {
          stripeSubscriptionId: deletedSubscription.id,
          status: 'canceled',
          canceledAt: deletedSubscription.canceled_at,
          endedAt: deletedSubscription.ended_at,
        })
        console.log('Subscription canceled/deleted:', deletedSubscription.id)

        // Discord logging
        try {
          const customer = await stripe.customers.retrieve(deletedSubscription.customer)
          const product = await stripe.products.retrieve(deletedSubscription.items.data[0].price.product)

          // Calculate subscription duration
          const subscriptionDuration = deletedSubscription.ended_at - deletedSubscription.created
          const durationDays = Math.floor(subscriptionDuration / (24 * 60 * 60))

          // Get cancellation reason
          const cancellationReason = deletedSubscription.cancellation_details?.reason || 'unknown'
          const cancellationFeedback = deletedSubscription.cancellation_details?.feedback
          const cancellationComment = deletedSubscription.cancellation_details?.comment

          // Helper function to format cancellation reasons
          const formatCancellationReason = (reason) => {
            const reasonMap = {
              'cancellation_requested': 'Customer Requested',
              'payment_failed': 'Payment Failed',
              'product_discontinued': 'Product Discontinued',
              'customer_service': 'Customer Service',
              'unknown': 'Unknown'
            }
            return reasonMap[reason] || reason.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
          }

          // Helper function to format feedback
          const formatFeedback = (feedback) => {
            const feedbackMap = {
              'unused': '🚫 Unused',
              'too_expensive': '💸 Too Expensive',
              'too_complex': '🤯 Too Complex',
              'low_quality': '👎 Low Quality',
              'missing_features': '🔧 Missing Features',
              'switched_service': '🔄 Switched Service',
              'customer_service': '📞 Customer Service Issues',
              'other': '❓ Other'
            }
            return feedbackMap[feedback] || (feedback ? feedback.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) : null)
          }

          // Calculate billing cycle info
          const billingCycle = deletedSubscription.plan?.interval === 'month' ? 'Monthly' : 'Yearly'
          const planAmount = `£${(deletedSubscription.plan?.amount / 100).toFixed(2)}`

          await sendDiscordLog({
            title: '❌ Subscription Cancelled',
            color: 0xff9900, // Orange
            fields: [
              // Row 1: Customer Name and Email
              {
                name: '👤 Customer Name',
                value: customer.name || 'Not provided',
                inline: true
              },
              {
                name: '📧 Email',
                value: customer.email || 'Unknown',
                inline: true
              },

              // Row 2: Customer ID
              {
                name: '🆔 Customer ID',
                value: `\`${customer.id}\``,
                inline: false
              },

              // Row 3: Plan details
              {
                name: '📦 Plan',
                value: product.name || 'Unknown',
                inline: true
              },
              {
                name: '🔄 Cycle',
                value: billingCycle,
                inline: true
              },
              {
                name: '💰 Value',
                value: planAmount,
                inline: true
              },

              // Row 4: Duration
              {
                name: '⏱️ Subscription Duration',
                value: `${durationDays} day${durationDays !== 1 ? 's' : ''}`,
                inline: false
              },

              // Row 5: Cancellation reason and feedback (combined if both exist)
              ...(() => {
                const formattedReason = formatCancellationReason(cancellationReason)
                const formattedFeedback = formatFeedback(cancellationFeedback)

                // If we have both reason and feedback, combine them intelligently
                if (cancellationReason !== 'cancellation_requested' && formattedFeedback) {
                  return [{
                    name: '❓ Cancellation Details',
                    value: `**Reason:** ${formattedReason}\n**Feedback:** ${formattedFeedback}`,
                    inline: false
                  }]
                }
                // If only non-default reason
                else if (cancellationReason !== 'cancellation_requested') {
                  return [{
                    name: '❓ Cancellation Reason',
                    value: formattedReason,
                    inline: false
                  }]
                }
                // If only feedback (and reason is default)
                else if (formattedFeedback) {
                  return [{
                    name: '💭 Customer Feedback',
                    value: formattedFeedback,
                    inline: false
                  }]
                }
                // Neither - return empty array
                return []
              })(),

              // Row 6: Comment (only if exists)
              ...(cancellationComment ? [{
                name: '💬 Customer Comment',
                value: `"${cancellationComment}"`,
                inline: false
              }] : []),

              // Row 7: Subscription ID
              {
                name: '🔗 Subscription ID',
                value: `\`${deletedSubscription.id}\``,
                inline: false
              }
            ],
            timestamp: new Date().toISOString()
          })
        } catch (discordError) {
          console.error('Discord logging failed for subscription deleted:', discordError.message)
        }
        break


      case 'customer.subscription.paused':
        const pausedSubscription = event.data.object
        // ✅ UPDATED: Use saveCustomerSubscription instead of saveSubscription
        await saveCustomerSubscription(pausedSubscription.customer, {
          stripeSubscriptionId: pausedSubscription.id,
          status: 'paused',
          pauseCollection: pausedSubscription.pause_collection,
        })
        console.log('Subscription paused:', pausedSubscription.id)
        break

      case 'customer.subscription.resumed':
        const resumedSubscription = event.data.object
        // ✅ UPDATED: Use saveCustomerSubscription instead of saveSubscription
        await saveCustomerSubscription(resumedSubscription.customer, {
          stripeSubscriptionId: resumedSubscription.id,
          status: resumedSubscription.status,
          pauseCollection: null, // Clear pause when resumed
        })
        console.log('Subscription resumed:', resumedSubscription.id)
        break

      case 'entitlements.active_entitlement_summary.updated':
        await handleEntitlementSummaryUpdated(event.data.object)
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

// Discord logging utility
async function sendDiscordLog(embed) {
  if (!process.env.DISCORD_WEBHOOK_URL) {
    return // Skip if no webhook URL configured
  }

  try {
    await fetch(process.env.DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        embeds: [embed]
      })
    })
  } catch (error) {
    console.error('Discord logging failed:', error.message)
    // Don't throw - we don't want Discord failures to break Stripe processing
  }
}
