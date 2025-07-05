import { NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe-server'

export async function POST(request) {
  try {
    const { promoCode, email } = await request.json()

    if (!promoCode || !email) {
      return NextResponse.json({
        valid: false,
        error: 'Promo code and email are required'
      }, { status: 400 })
    }

    // Find the promo code
    const promoCodes = await stripe.promotionCodes.list({
      code: promoCode,
      active: true,
      limit: 1
    })

    if (promoCodes.data.length === 0) {
      return NextResponse.json({
        valid: false,
        error: 'Promo code not found or inactive'
      })
    }

    const promoCodeObj = promoCodes.data[0]
    const coupon = promoCodeObj.coupon

    // Check if email matches
    const authorizedEmail = promoCodeObj.metadata.authorized_email       

    if (!authorizedEmail) {
      // No email restriction - anyone can use it
      return NextResponse.json({
        valid: true,
        discount: coupon.percent_off ? `${coupon.percent_off}% off` : `${coupon.amount_off / 100} off`,
        message: 'Promo code is valid!',
        promoCodeId: promoCodeObj.id,
        // 🆕 NEW: Return coupon details for price calculation
        coupon: {
          id: coupon.id,
          percent_off: coupon.percent_off,
          amount_off: coupon.amount_off,
          currency: coupon.currency,
          duration: coupon.duration,
          duration_in_months: coupon.duration_in_months
        }
      })
    }

    if (authorizedEmail.toLowerCase() !== email.toLowerCase()) {
      return NextResponse.json({
        valid: false,
        error: 'This promo code is not authorized for your email address'
      })
    }

    // All checks passed
    return NextResponse.json({
      valid: true,
      discount: coupon.percent_off ? `${coupon.percent_off}% off` : `${coupon.amount_off / 100} off`,
      message: 'Promo code is valid for your email!',
      promoCodeId: promoCodeObj.id,
      // 🆕 NEW: Return coupon details for price calculation
      coupon: {
        id: coupon.id,
        percent_off: coupon.percent_off,
        amount_off: coupon.amount_off,
        currency: coupon.currency,
        duration: coupon.duration,
        duration_in_months: coupon.duration_in_months
      }
    })

  } catch (error) {
    console.error('Error validating promo code:', error)
    return NextResponse.json({
      valid: false,
      error: 'Failed to validate promo code'
    }, { status: 500 })
  }
}
