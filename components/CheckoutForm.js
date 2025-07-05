'use client'

import { useState } from 'react'
import {
  useStripe,
  useElements,
  PaymentElement
} from '@stripe/react-stripe-js'

export default function CheckoutForm({ clientSecret }) {
  const stripe = useStripe()
  const elements = useElements()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  const handleSubmit = async (event) => {
    event.preventDefault()

    if (!stripe || !elements) {
      return
    }

    setLoading(true)
    setError('')

    try {
      const { error: submitError } = await elements.submit()
      if (submitError) {
        throw new Error(submitError.message)
      }

      // This is the key part for 3D Secure - confirmPayment handles the entire flow
      const { error: confirmError } = await stripe.confirmPayment({
        elements,
        clientSecret,
        confirmParams: {
          return_url: `${window.location.origin}/success`,
        },
      })

      if (confirmError) {
        // This will handle cases where 3D Secure fails or user cancels
        throw new Error(confirmError.message)
      }

      // If we get here without error, payment succeeded
      setSuccess(true)

    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div className="success">
        <h2>Payment Successful!</h2>
        <p>Your subscription has been activated.</p>
      </div>
    )
  }

  return (
    <div>
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: '1rem' }}>
          <PaymentElement
            options={{
              layout: {
                type: 'accordion',
                defaultCollapsed: false,
                radios: false,
                spacedAccordionItems: true
              }
            }}
          />
        </div>

        {error && <div className="error">{error}</div>}

        <button
          type="submit"
          className="button"
          disabled={!stripe || loading}
          style={{ margin: '1rem 0' }}
        >
          {loading ? 'Processing...' : 'Subscribe Now'}
        </button>
      </form>
    </div>
  )
}
