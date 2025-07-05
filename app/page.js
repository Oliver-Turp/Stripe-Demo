import Link from 'next/link'

export default function Home() {
  return (
    <div className="container">
      <div className="card">
        <h1>Stripe Subscription Demo</h1>
        <p style={{ marginBottom: '2rem' }}>
          Test our subscription checkout with Stripe Elements and 3D Secure support.
        </p>
        
        <div style={{ display: 'flex', gap: '1rem' }}>
          <Link href="/checkout" className="button">
            Start Subscription
          </Link>
          <a 
            href="https://billing.stripe.com/p/login/test_cNifZh37N7Yo7jW0l3bo400" 
            target="_blank" 
            rel="noopener noreferrer"
            className="button"
            style={{ backgroundColor: '#6c757d' }}
          >
            Customer Portal
          </a>
        </div>
      </div>
    </div>
  )
}
