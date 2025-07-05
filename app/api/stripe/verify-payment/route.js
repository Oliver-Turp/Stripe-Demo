import { NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe-server'

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const paymentIntentId = searchParams.get('payment_intent_id')

    if (!paymentIntentId) {
      return NextResponse.json(
        { error: 'Missing payment_intent_id' }, 
        { status: 400 }
      )
    }

    // Retrieve the payment intent
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId)

    return NextResponse.json({
      status: paymentIntent.status,
      subscription_id: paymentIntent.metadata?.subscription_id,
    })

  } catch (error) {
    console.error('Payment verification error:', error)
    return NextResponse.json(
      { error: error.message }, 
      { status: 500 }
    )
  }
}
