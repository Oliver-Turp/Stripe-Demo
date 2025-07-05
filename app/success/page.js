'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'

export default function SuccessPage() {
  const [status, setStatus] = useState('loading')
  const [message, setMessage] = useState('')
  const searchParams = useSearchParams()

  useEffect(() => {
    const paymentIntentId = searchParams.get('payment_intent')
    const paymentIntentClientSecret = searchParams.get('payment_intent_client_secret')

    if (paymentIntentId && paymentIntentClientSecret) {
      // Verify the payment status
      fetch(`/api/stripe/verify-payment?payment_intent_id=${paymentIntentId}`)
        .then(res => res.json())
        .then(data => {
          if (data.status === 'succeeded') {
            setStatus('success')
            setMessage('Your subscription has been successfully activated!')
          } else {
            setStatus('error')
            setMessage('Payment verification failed. Please contact support.')
          }
        })
        .catch(() => {
          setStatus('error')
          setMessage('Failed to verify payment. Please contact support.')
        })
    } else {
      setStatus('error')
      setMessage('Invalid payment confirmation.')
    }
  }, [searchParams])

  return (
    <div className="container">
      <div className="card">
        {status === 'loading' && (
          <div>
            <h1>Verifying Payment...</h1>
            <p>Please wait while we confirm your subscription.</p>
          </div>
        )}
        
        {status === 'success' && (
          <div className="success">
            <h1>Welcome!</h1>
            <p>{message}</p>
            <div style={{ marginTop: '2rem' }}>
              <Link href="/" className="button">
                Return Home
              </Link>
            </div>
          </div>
        )}
        
        {status === 'error' && (
          <div className="error">
            <h1>Payment Error</h1>
            <p>{message}</p>
            <div style={{ marginTop: '2rem' }}>
              <Link href="/checkout" className="button">
                Try Again
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
