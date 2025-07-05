import Stripe from 'stripe'

// Server-side Stripe (only use this in API routes)
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2023-10-16',
})
