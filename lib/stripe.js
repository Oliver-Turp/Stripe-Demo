import { loadStripe } from '@stripe/stripe-js'

// Client-side Stripe - used for payment forms and 3D Secure
export const stripePromise = loadStripe(
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
)