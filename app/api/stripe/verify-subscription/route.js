import { NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe-server'

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const subscriptionId = searchParams.get('subscription_id')

    if (!subscriptionId) {
      return NextResponse.json(
        { error: 'Missing subscription_id' },
        { status: 400 }
      )
    }

    // Retrieve the subscription object
    const subscription = await stripe.subscriptions.retrieve(subscriptionId)

    console.log(`📋 Subscription ${subscriptionId} status: ${subscription.status}`)

    return NextResponse.json({
      status: subscription.status,
      subscription_id: subscription.id,
      // 🆕 ADD: Include more useful info for debugging
      customer_id: subscription.customer,
      current_period_end: subscription.current_period_end,
      cancel_at_period_end: subscription.cancel_at_period_end,
    })

  } catch (error) {
    console.error('Subscription verification error:', error)
    
    // 🆕 ADD: Better error handling
    if (error.code === 'resource_missing') {
      return NextResponse.json(
        { error: 'Subscription not found' },
        { status: 404 }
      )
    }
    
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    )
  }
}
