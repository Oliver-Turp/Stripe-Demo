import { NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe-server'
import { getCustomerByEmail } from '@/lib/storage'

export async function POST(request) {
  try {
    const { priceId, planType, email, productName, promoCodeId } = await request.json() // Add promoCodeId

    if (!priceId || !planType || !email) {
      return NextResponse.json(
        { error: 'Missing required fields: priceId, planType, or email' },
        { status: 400 }
      )
    }

    // Check if customer already exists
    let customer
    const existingCustomer = await getCustomerByEmail(email)

    if (existingCustomer && existingCustomer.stripeCustomerId) {
      customer = await stripe.customers.retrieve(existingCustomer.stripeCustomerId)

      // Check for existing active subscriptions
      const activeSubscriptions = await stripe.subscriptions.list({
        customer: customer.id,
        status: 'active',
        limit: 10
      })

      if (activeSubscriptions.data.length > 0) {
        const activeSubscription = activeSubscriptions.data[0]
        const currentPrice = await stripe.prices.retrieve(activeSubscription.items.data[0].price.id)
        const currentProduct = await stripe.products.retrieve(currentPrice.product)

        return NextResponse.json({
          error: 'You already have an active subscription',
          details: {
            currentPlan: currentProduct.name,
            currentInterval: currentPrice.recurring.interval,
            subscriptionId: activeSubscription.id,
            hasActiveSubscription: true
          }
        }, { status: 409 })
      }

      // 🔄 RESUME LOGIC: Check for existing incomplete subscription with same price
      const incompleteSubscriptions = await stripe.subscriptions.list({
        customer: customer.id,
        status: 'incomplete',
        limit: 10
      })

      // Look for an incomplete subscription with the same price
      const matchingIncomplete = incompleteSubscriptions.data.find(sub => {
        const subPriceId = sub.items.data[0]?.price?.id
        return subPriceId === priceId
      })

      if (matchingIncomplete) {
        console.log(`🔄 Resuming existing incomplete subscription: ${matchingIncomplete.id}`)

        // Get the latest invoice and payment intent
        const invoice = await stripe.invoices.retrieve(matchingIncomplete.latest_invoice, {
          expand: ['payment_intent']
        })

        // Check if the payment intent is still valid (not expired)
        if (invoice.payment_intent &&
          invoice.payment_intent.status === 'requires_payment_method') {

          // Return the existing payment intent
          return NextResponse.json({
            subscriptionId: matchingIncomplete.id,
            clientSecret: invoice.payment_intent.client_secret,
            customerId: customer.id,
            resumed: true
          })
        } else {
          // Payment intent expired, we'll create a new subscription below
          console.log(`⏰ Payment intent expired for subscription ${matchingIncomplete.id}, creating new one`)
        }
      }

      // Also check for subscriptions that are past_due or unpaid
      const problematicSubscriptions = await stripe.subscriptions.list({
        customer: customer.id,
        status: 'past_due',
        limit: 10
      })

      if (problematicSubscriptions.data.length > 0) {
        return NextResponse.json({
          error: 'You have a subscription with payment issues that needs to be resolved first',
          details: {
            hasProblematicSubscription: true,
            subscriptionId: problematicSubscriptions.data[0].id
          }
        }, { status: 409 })
      }

    } else {
      // Create new customer
      customer = await stripe.customers.create({
        email: email,
        name: email.split('@')[0],
        metadata: {
          plan: planType,
          product: productName || 'Unknown'
        }
      })
    }

    // Create new subscription (only if no valid incomplete found)
    console.log(`🆕 Creating new subscription for customer ${customer.id}`)

    const subscriptionConfig = {
      customer: customer.id,
      items: [{ price: priceId }],
      payment_behavior: 'default_incomplete',
      payment_settings: { save_default_payment_method: 'on_subscription' },
      expand: ['latest_invoice.payment_intent'],
      metadata: {
        plan: planType,
        product: productName || 'Unknown'
      }
    }

    // Add promo code if provided
    if (promoCodeId) {
      subscriptionConfig.promotion_code = promoCodeId
      console.log(`🎫 Applying promo code: ${promoCodeId}`)
    }

    const subscription = await stripe.subscriptions.create(subscriptionConfig)

    // 🆕 NEW: Handle free subscriptions (100% discount from promo codes)
    if (subscription.status === 'active') {
      // Subscription is already active (no payment required due to 100% discount)
      console.log(`✅ Subscription activated immediately (100% discount): ${subscription.id}`)

      return NextResponse.json({
        subscriptionId: subscription.id,
        clientSecret: null, // No payment needed
        customerId: customer.id,
        resumed: false,
        freeSubscription: true, // Flag to indicate no payment needed
        status: 'active'
      })
    }

    // 🆕 NEW: Better handling of payment intent
    const invoice = subscription.latest_invoice
    let clientSecret = null

    if (invoice && typeof invoice === 'object') {
      // Invoice is expanded
      if (invoice.payment_intent && typeof invoice.payment_intent === 'object') {
        // Payment intent is expanded
        clientSecret = invoice.payment_intent.client_secret
      } else if (invoice.payment_intent && typeof invoice.payment_intent === 'string') {
        // Payment intent is just an ID, need to retrieve it
        try {
          const paymentIntent = await stripe.paymentIntents.retrieve(invoice.payment_intent)
          clientSecret = paymentIntent.client_secret
        } catch (piError) {
          console.error('Error retrieving payment intent:', piError)
        }
      }
    } else if (invoice && typeof invoice === 'string') {
      // Invoice is just an ID, need to retrieve it
      try {
        const fullInvoice = await stripe.invoices.retrieve(invoice, {
          expand: ['payment_intent']
        })
        if (fullInvoice.payment_intent && typeof fullInvoice.payment_intent === 'object') {
          clientSecret = fullInvoice.payment_intent.client_secret
        }
      } catch (invoiceError) {
        console.error('Error retrieving invoice:', invoiceError)
      }
    }

    if (!clientSecret) {
      console.error('No client secret found for subscription:', subscription.id)
      console.error('Subscription status:', subscription.status)
      console.error('Invoice:', invoice)

      return NextResponse.json({
        error: 'Unable to create payment session. Please try again or contact support.',
        details: {
          subscriptionId: subscription.id,
          subscriptionStatus: subscription.status,
          hasInvoice: !!invoice,
          debugInfo: {
            invoiceType: typeof invoice,
            invoiceId: typeof invoice === 'string' ? invoice : invoice?.id
          }
        }
      }, { status: 500 })
    }

    return NextResponse.json({
      subscriptionId: subscription.id,
      clientSecret: subscription.latest_invoice.payment_intent.client_secret,
      customerId: customer.id,
      resumed: false,
      freeSubscription: false
    })

  } catch (error) {
    console.error('Subscription creation error:', error)
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    )
  }
}
