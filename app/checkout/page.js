'use client'

import { useState, useEffect } from 'react'
import { Elements } from '@stripe/react-stripe-js'
import { stripePromise } from '@/lib/stripe'
import CheckoutForm from '@/components/CheckoutForm'

export default function CheckoutPage() {
  const [products, setProducts] = useState([])
  const [selectedProduct, setSelectedProduct] = useState('')
  const [selectedInterval, setSelectedInterval] = useState('monthly')
  const [clientSecret, setClientSecret] = useState('')
  const [productsLoading, setProductsLoading] = useState(true)
  const [subscriptionLoading, setSubscriptionLoading] = useState(false)
  const [error, setError] = useState('')
  const [email, setEmail] = useState('')
  const [existingSubscription, setExistingSubscription] = useState(null)

  // NEW: Promo code state
  const [promoCode, setPromoCode] = useState("")
  const [promoValidation, setPromoValidation] = useState(null)
  const [promoMessage, setPromoMessage] = useState("")
  const [validatedPromoCodeId, setValidatedPromoCodeId] = useState(null)
  const [validatedCoupon, setValidatedCoupon] = useState(null)

  // Fetch products on component mount
  useEffect(() => {
    fetchProducts()
  }, [])

  // 🔄 RESET CLIENT SECRET when user changes selection
  useEffect(() => {
    if (clientSecret) {
      console.log('🔄 User changed selection, resetting checkout session')
      setClientSecret('')
      setError('')
      setExistingSubscription(null)
    }
  }, [selectedProduct, selectedInterval]) // Reset when product or interval changes

  const fetchProducts = async () => {
    try {
      setProductsLoading(true)
      const response = await fetch('/api/stripe/products')
      const data = await response.json()

      if (response.ok) {
        setProducts(data.products)
        if (data.products.length > 0) {
          setSelectedProduct(data.products[0].id)
        }
      } else {
        setError('Failed to load products')
      }
    } catch (err) {
      setError('Failed to load products')
    } finally {
      setProductsLoading(false)
    }
  }

  // NEW: Promo code validation function
  const validatePromoCode = async () => {
    if (!promoCode.trim()) {
      setPromoValidation(null)
      setPromoMessage('')
      setValidatedPromoCodeId(null)
      setValidatedCoupon(null) // 🆕 NEW: Clear coupon info
      return
    }

    if (!email) {
      setPromoValidation('invalid')
      setPromoMessage('Please enter your email first')
      return
    }

    setPromoValidation('loading')
    setPromoMessage('Validating...')

    try {
      const response = await fetch('/api/stripe/validate-promo', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          promoCode: promoCode.trim(),
          email: email
        })
      })

      const result = await response.json()

      if (result.valid) {
        setPromoValidation('valid')
        setPromoMessage(result.message)
        setValidatedPromoCodeId(result.promoCodeId)
        setValidatedCoupon(result.coupon) // 🆕 NEW: Store coupon info
      } else {
        setPromoValidation('invalid')
        setPromoMessage(result.error)
        setValidatedPromoCodeId(null)
        setValidatedCoupon(null) // 🆕 NEW: Clear coupon info
      }
    } catch (error) {
      setPromoValidation('invalid')
      setPromoMessage('Failed to validate promo code')
      setValidatedPromoCodeId(null)
      setValidatedCoupon(null) // 🆕 NEW: Clear coupon info
    }
  }

  // 🆕 NEW: Add function to calculate discounted price
  const calculateDiscountedPrice = (originalAmount) => {
    if (!validatedCoupon) return originalAmount

    if (validatedCoupon.percent_off) {
      // Percentage discount
      const discountAmount = Math.round(originalAmount * (validatedCoupon.percent_off / 100))
      return originalAmount - discountAmount
    } else if (validatedCoupon.amount_off) {
      // Fixed amount discount
      const discountedPrice = originalAmount - validatedCoupon.amount_off
      return Math.max(0, discountedPrice) // Don't go below 0
    }

    return originalAmount
  }

  // 🆕 NEW: Add function to get discount amount for display
  const getDiscountAmount = (originalAmount) => {
    if (!validatedCoupon) return 0

    if (validatedCoupon.percent_off) {
      return Math.round(originalAmount * (validatedCoupon.percent_off / 100))
    } else if (validatedCoupon.amount_off) {
      return Math.min(validatedCoupon.amount_off, originalAmount)
    }

    return 0
  }

  const handleCreateSubscription = async () => {
    if (!email) {
      setError('Please enter your email address')
      return
    }

    if (!selectedProduct) {
      setError('Please select a product')
      return
    }

    setSubscriptionLoading(true)
    setError('')
    setExistingSubscription(null)

    try {
      const product = products.find(p => p.id === selectedProduct)
      const selectedPrice = product.prices[selectedInterval]

      if (!selectedPrice) {
        throw new Error(`${selectedInterval} pricing not available for this product`)
      }

      const response = await fetch('/api/stripe/create-subscription', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          priceId: selectedPrice.id,
          planType: `${selectedProduct}_${selectedInterval}`,
          email: email,
          productName: product.name,
          promoCodeId: validatedPromoCodeId
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        if (response.status === 409 && data.details?.hasActiveSubscription) {
          setExistingSubscription(data.details)
          setError(`You already have an active ${data.details.currentPlan} subscription (${data.details.currentInterval}ly billing).`)
        } else {
          throw new Error(data.error || 'Failed to create subscription')
        }
        return
      }

      if (data.freeSubscription) {
        console.log('🎉 Free subscription activated!')
        // Redirect to success page with subscription info
        window.location.href = `/success?subscription_id=${data.subscriptionId}&free=true`
        return
      }

      setClientSecret(data.clientSecret)
    } catch (err) {
      setError(err.message)
    } finally {
      setSubscriptionLoading(false)
    }
  }

  // 🔄 HANDLE PLAN CHANGE - Reset checkout and show change message
  const handlePlanChange = (newProduct, newInterval) => {
    if (clientSecret) {
      // Show a brief message about resetting
      setError('Plan changed - please continue to payment with your new selection')
      setTimeout(() => setError(''), 3000) // Clear message after 3 seconds
    }

    if (newProduct !== undefined) setSelectedProduct(newProduct)
    if (newInterval !== undefined) setSelectedInterval(newInterval)
  }

  const formatPrice = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'GBP',
    }).format(amount / 100)
  }

  const getYearlySavings = (product) => {
    if (!product.prices.monthly || !product.prices.yearly) return '£0'
    const monthlyTotal = product.prices.monthly.amount * 12
    const yearlyPrice = product.prices.yearly.amount
    const savings = monthlyTotal - yearlyPrice
    return formatPrice(savings)
  }

  // Loading state for products
  if (productsLoading) {
    return (
      <div className="container">
        <div className="card">
          <h1>Loading products...</h1>
          <div style={{ textAlign: 'center', padding: '2rem' }}>
            <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>⏳</div>
            <p>Fetching available plans...</p>
          </div>
        </div>
      </div>
    )
  }

  // Error state
  if (error && products.length === 0) {
    return (
      <div className="container">
        <div className="card">
          <h1>Unable to Load Products</h1>
          <div style={{ textAlign: 'center', padding: '2rem' }}>
            <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>⚠️</div>
            <p style={{ color: '#dc3545', marginBottom: '1rem' }}>{error}</p>
            <button
              className="button"
              onClick={fetchProducts}
              style={{ backgroundColor: 'hsl(214, 15%, 21%)' }}
            >
              Try Again
            </button>
          </div>
        </div>
      </div>
    )
  }

  // No products state
  if (products.length === 0) {
    return (
      <div className="container">
        <div className="card">
          <h1>Coming Soon!</h1>
          <div style={{ textAlign: 'center', padding: '3rem' }}>
            <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>🚀</div>
            <h2 style={{ color: '#635bff', marginBottom: '1rem' }}>Exciting Plans Are On The Way</h2>
            <p style={{ fontSize: '1.1rem', color: '#666', marginBottom: '2rem', lineHeight: '1.6' }}>
              We're putting the finishing touches on our subscription plans.
              Check back soon for amazing features and competitive pricing!
            </p>
            <div style={{
              backgroundColor: 'hsl(214, 15%, 15%)',
              padding: '1.5rem',
              borderRadius: '8px',
              border: '1px solid #e0e7ff',
              marginBottom: '2rem'
            }}>
              <h3 style={{ margin: '0 0 1rem 0', color: '#4338ca' }}>What to expect:</h3>
              <ul style={{
                listStyle: 'none',
                padding: 0,
                margin: 0,
                textAlign: 'left',
                display: 'inline-block'
              }}>
                <li style={{ padding: '0.5rem 0', color: '#555' }}>
                  <span style={{ color: '#22c55e', marginRight: '0.5rem' }}>✓</span>
                  Multiple subscription tiers
                </li>
                <li style={{ padding: '0.5rem 0', color: '#555' }}>
                  <span style={{ color: '#22c55e', marginRight: '0.5rem' }}>✓</span>
                  Flexible monthly and yearly billing
                </li>
                <li style={{ padding: '0.5rem 0', color: '#555' }}>
                  <span style={{ color: '#22c55e', marginRight: '0.5rem' }}>✓</span>
                  Secure payments with 3D Secure support
                </li>
                <li style={{ padding: '0.5rem 0', color: '#555' }}>
                  <span style={{ color: '#22c55e', marginRight: '0.5rem' }}>✓</span>
                  Easy subscription management
                </li>
              </ul>
            </div>
            <button
              className="button"
              onClick={fetchProducts}
              style={{
                backgroundColor: 'hsl(214, 15%, 15%)',
                marginRight: '1rem'
              }}
            >
              Check Again
            </button>
            <button
              className="button"
              onClick={() => window.location.href = '/'}
              style={{ backgroundColor: 'hsl(214, 15%, 15%)' }}
            >
              Back to Home
            </button>
          </div>
        </div>
      </div>
    )
  }


  const selectedProductData = products.find(p => p.id === selectedProduct)

  return (
    <div className="container">
      <div className="card">
        <h1>Choose Your Plan</h1>

        {/* Email Input */}
        {!clientSecret && (
          <div style={{ marginBottom: '2rem', marginTop: '1rem' }}>
            <label htmlFor="email" style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
              Email Address
            </label>
            <input
              type="email"
              id="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter your email"
              style={{
                width: '100%',
                padding: '0.75rem',
                border: '1px solid rgb(221, 221, 221)',
                borderRadius: '4px',
                fontSize: '1rem',
                backgroundColor: 'hsl(214, 15%, 15%)',
                color: 'white'
              }}
              required
            />
          </div>
        )}

        {/* Promo Code Input */}
        {!clientSecret && (
          <div style={{ marginBottom: "2rem" }}>
            <label
              htmlFor="promo-code"
              style={{
                display: "block",
                marginBottom: "0.5rem",
                fontWeight: "bold",
              }}
            >
              Promo Code (Optional)
            </label>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <input
                type="text"
                id="promo-code"
                value={promoCode}
                onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                onBlur={validatePromoCode}
                placeholder="Enter promo code"
                style={{
                  flex: 1,
                  padding: "0.75rem",
                  border: `2px solid ${promoValidation === "valid"
                    ? "#22c55e"
                    : promoValidation === "invalid"
                      ? "#ef4444"
                      : "rgb(221, 221, 221)"
                    }`,
                  borderRadius: "4px",
                  fontSize: "1rem",
                  backgroundColor: "hsl(214, 15%, 15%)",
                  color: "white",
                }}
              />
              <button
                type="button"
                onClick={validatePromoCode}
                disabled={promoValidation === "loading"}
                style={{
                  padding: "0.75rem 1rem",
                  backgroundColor: "#3b82f6",
                  color: "white",
                  border: "none",
                  borderRadius: "4px",
                  cursor:
                    promoValidation === "loading" ? "not-allowed" : "pointer",
                }}
              >
                {promoValidation === "loading" ? "..." : "Check"}
              </button>
            </div>
            {promoMessage && (
              <div
                style={{
                  marginTop: "0.5rem",
                  padding: "0.5rem",
                  borderRadius: "4px",
                  fontSize: "0.9rem",
                  backgroundColor:
                    promoValidation === "valid" ? "#dcfce7" : "#fef2f2",
                  color: promoValidation === "valid" ? "#166534" : "#dc2626",
                }}
              >
                {promoValidation === "valid" ? "✅" : "❌"} {promoMessage}
              </div>
            )}
          </div>
        )}

        {/* Existing Subscription Warning */}
        {existingSubscription && (
          <div style={{
            color: '#856404',
            backgroundColor: '#fff3cd',
            padding: '1rem',
            borderRadius: '4px',
            marginBottom: '1rem',
            border: '1px solid #ffeaa7'
          }}>
            <h4 style={{ margin: '0 0 0.5rem 0' }}>Existing Subscription Found</h4>
            <p style={{ margin: '0 0 1rem 0' }}>
              You already have an active <strong>{existingSubscription.currentPlan}</strong> subscription
              with <strong>{existingSubscription.currentInterval}ly</strong> billing.
            </p>
            <p style={{ margin: 0, fontSize: '0.9rem' }}>
              To change your plan, please use the customer portal or contact support.
            </p>
          </div>
        )}

        {/* Product Selection */}
        <div className="product-selector" style={{ marginBottom: '2rem', marginTop: '1rem' }}>
          <h3 style={{ marginBottom: '0.5rem' }}>Select Plan</h3>
          {products.map((product) => (
            <div
              key={product.id}
              className={`product-option ${selectedProduct === product.id ? 'selected' : ''}`}
              onClick={() => !existingSubscription && handlePlanChange(product.id, undefined)}
              style={{
                border: selectedProduct === product.id ? '2px solid #635bff' : '1px solid #ddd',
                borderRadius: '8px',
                padding: '1.5rem',
                margin: '1rem 0',
                cursor: existingSubscription ? 'not-allowed' : 'pointer',
                backgroundColor: selectedProduct === product.id ? 'hsl(214, 15%, 15%)' : 'hsl(214, 15%, 15%)',
                opacity: existingSubscription ? 0.6 : 1,
                transition: 'all 0.2s ease',
                position: 'relative'
              }}
            >
              {product.metadata?.popular === 'true' && (
                <div style={{
                  position: 'absolute',
                  top: '-8px',
                  right: '8px',
                  backgroundColor: '#7851A9',
                  color: 'white',
                  padding: '0.25rem 0.5rem',
                  borderRadius: '4px',
                  fontSize: '0.7rem',
                  fontWeight: 'bold'
                }}>
                  Most Popular
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <h4 style={{ margin: '0 0 0.5rem 0', color: '#FFFFFF' }}>{product.name}</h4>
                  <p style={{ color: '#B0B0B0', marginBottom: '1rem', fontSize: '0.9rem' }}>
                    {product.description}
                  </p>
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                    {product.features.map((feature, index) => (
                      <li key={index} style={{
                        padding: '0.25rem 0',
                        color: '#D0D0D0',
                        fontSize: '0.9rem'
                      }}>
                        <span style={{ color: '#22c55e', marginRight: '0.5rem' }}>✓</span>
                        {feature}
                      </li>
                    ))}
                  </ul>
                </div>
                <div style={{ textAlign: 'right', marginLeft: '1rem' }}>
                  {product.prices[selectedInterval] && validatedCoupon ? (
                    // Show discounted price
                    <div>
                      <div style={{
                        fontSize: '1rem',
                        color: '#B0B0B0',
                        textDecoration: 'line-through'
                      }}>
                        {formatPrice(product.prices[selectedInterval].amount)}
                      </div>
                      <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#22c55e' }}>
                        {formatPrice(calculateDiscountedPrice(product.prices[selectedInterval].amount))}
                      </div>
                    </div>
                  ) : (
                    // Show regular price
                    <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#FFFFFF' }}>
                      {product.prices[selectedInterval] ?
                        formatPrice(product.prices[selectedInterval].amount) : 'N/A'}
                    </div>
                  )}
                  <div style={{ fontSize: '0.8rem', color: '#B0B0B0' }}>
                    per {selectedInterval === 'monthly' ? 'month' : 'year'}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Billing Interval Selection */}
        {selectedProductData && (
          <div className="interval-selector" style={{ marginBottom: '2rem' }}>
            <h3 style={{ marginBottom: '0.5rem' }}>Billing Frequency</h3>
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
              {selectedProductData.prices.monthly && (
                <div
                  className={`interval-option ${selectedInterval === 'monthly' ? 'selected' : ''}`}
                  onClick={() => !existingSubscription && handlePlanChange(undefined, 'monthly')}
                  style={{
                    border: selectedInterval === 'monthly' ? '2px solid #635bff' : '1px solid #ddd',
                    borderRadius: '8px',
                    padding: '1rem',
                    cursor: existingSubscription ? 'not-allowed' : 'pointer',
                    backgroundColor: selectedInterval === 'monthly' ? 'hsl(214, 15%, 15%)' : 'hsl(214, 15%, 15%)',
                    opacity: existingSubscription ? 0.6 : 1,
                    flex: '1',
                    minWidth: '200px',
                    textAlign: 'center'
                  }}
                >
                  <div style={{ fontWeight: 'bold', marginBottom: '0.5rem', color: '#FFFFFF' }}>Monthly</div>
                  {validatedCoupon ? (
                    <div>
                      <div style={{
                        fontSize: '0.9rem',
                        color: '#B0B0B0',
                        textDecoration: 'line-through'
                      }}>
                        {formatPrice(selectedProductData.prices.monthly.amount)}
                      </div>
                      <div style={{ fontSize: '1.2rem', color: '#22c55e' }}>
                        {formatPrice(calculateDiscountedPrice(selectedProductData.prices.monthly.amount))}
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontSize: '1.2rem', color: '#FFFFFF' }}>
                      {formatPrice(selectedProductData.prices.monthly.amount)}
                    </div>
                  )}
                  <div style={{ fontSize: '0.8rem', color: '#B0B0B0' }}>per month</div>
                </div>
              )}

              {selectedProductData.prices.yearly && (
                <div
                  className={`interval-option ${selectedInterval === 'yearly' ? 'selected' : ''}`}
                  onClick={() => !existingSubscription && handlePlanChange(undefined, 'yearly')}
                  style={{
                    border: selectedInterval === 'yearly' ? '2px solid #635bff' : '1px solid #ddd',
                    borderRadius: '8px',
                    padding: '1rem',
                    cursor: existingSubscription ? 'not-allowed' : 'pointer',
                    backgroundColor: selectedInterval === 'yearly' ? 'hsl(214, 15%, 15%)' : 'hsl(214, 15%, 15%)',
                    opacity: existingSubscription ? 0.6 : 1,
                    flex: '1',
                    minWidth: '200px',
                    textAlign: 'center',
                    position: 'relative'
                  }}
                >
                  {selectedProductData.prices.monthly && (
                    <div style={{
                      position: 'absolute',
                      top: '-8px',
                      right: '8px',
                      backgroundColor: '#22c55e',
                      color: 'white',
                      padding: '0.25rem 0.5rem',
                      borderRadius: '4px',
                      fontSize: '0.7rem',
                      fontWeight: 'bold'
                    }}>
                      SAVE {getYearlySavings(selectedProductData)}
                    </div>
                  )}
                  <div style={{ fontWeight: 'bold', marginBottom: '0.5rem', color: '#FFFFFF' }}>Yearly</div>
                  {validatedCoupon ? (
                    <div>
                      <div style={{
                        fontSize: '0.9rem',
                        color: '#B0B0B0',
                        textDecoration: 'line-through'
                      }}>
                        {formatPrice(selectedProductData.prices.yearly.amount)}
                      </div>
                      <div style={{ fontSize: '1.2rem', color: '#22c55e' }}>
                        {formatPrice(calculateDiscountedPrice(selectedProductData.prices.yearly.amount))}
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontSize: '1.2rem', color: '#FFFFFF' }}>
                      {formatPrice(selectedProductData.prices.yearly.amount)}
                    </div>
                  )}
                  <div style={{ fontSize: '0.8rem', color: '#B0B0B0' }}>per year</div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Summary */}
        {!clientSecret && !existingSubscription && selectedProductData?.prices[selectedInterval] && (
          <div style={{
            backgroundColor: 'hsl(214, 15%, 15%)',
            padding: '1rem',
            borderRadius: '8px',
            marginBottom: '2rem',
            border: '1px solid rgb(221, 221, 221)'
          }}>
            <h4 style={{ margin: '0 0 0.5rem 0', color: '#FFFFFF' }}>Order Summary</h4>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
              <span style={{ color: '#D0D0D0' }}>
                {selectedProductData.name} - {selectedInterval === 'monthly' ? 'Monthly' : 'Yearly'}
              </span>
              <span style={{
                fontWeight: 'bold',
                color: validatedCoupon ? '#B0B0B0' : '#FFFFFF',
                textDecoration: validatedCoupon ? 'line-through' : 'none'
              }}>
                {formatPrice(selectedProductData.prices[selectedInterval].amount)}
              </span>
            </div>

            {/* Show discount if applied */}
            {validatedCoupon && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <span style={{ color: '#22c55e' }}>
                  Discount ({validatedCoupon.percent_off ? `${validatedCoupon.percent_off}%` : formatPrice(validatedCoupon.amount_off)})
                </span>
                <span style={{ fontWeight: 'bold', color: '#22c55e' }}>
                  -{formatPrice(getDiscountAmount(selectedProductData.prices[selectedInterval].amount))}
                </span>
              </div>
            )}

            {/* Show final total */}
            {validatedCoupon && (
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginTop: '0.5rem',
                paddingTop: '0.5rem',
                borderTop: '1px solid #444',
                fontSize: '1.1rem'
              }}>
                <span style={{ color: '#FFFFFF', fontWeight: 'bold' }}>Total</span>
                <span style={{ fontWeight: 'bold', color: '#22c55e' }}>
                  {formatPrice(calculateDiscountedPrice(selectedProductData.prices[selectedInterval].amount))}
                </span>
              </div>
            )}

            {selectedInterval === 'yearly' && selectedProductData.prices.monthly && (
              <div style={{ fontSize: '0.8rem', color: '#22c55e', marginTop: '0.5rem' }}>
                You save {getYearlySavings(selectedProductData)} compared to monthly billing
              </div>
            )}
          </div>
        )}

        {error && products.length > 0 && (
          <div style={{
            color: '#dc3545',
            backgroundColor: '#f8d7da',
            padding: '0.75rem',
            borderRadius: '4px',
            marginBottom: '1rem',
            border: '1px solid #f5c6cb'
          }}>
            {error}
          </div>
        )}

        {!clientSecret ? (
          <button
            className="button"
            onClick={handleCreateSubscription}
            disabled={subscriptionLoading || !email || !selectedProduct}
            style={{
              width: '100%',
              padding: '1rem',
              fontSize: '1.1rem',
              backgroundColor: subscriptionLoading || !email || !selectedProduct ? '#ccc' : '#635bff',
              cursor: subscriptionLoading || !email || !selectedProduct ? 'not-allowed' : 'pointer'
            }}
          >
            {subscriptionLoading ? 'Creating subscription...' : 'Continue to Payment'}
          </button>
        ) : (
          <Elements
            stripe={stripePromise}
            options={{
              clientSecret,
              appearance: {
                theme: 'night',
                variables: {
                  colorPrimary: '#FFFFFF',
                  colorBackground: 'hsl(214, 15%, 21%)',
                  colorDanger: '#df1b41',
                  colorTextSecondary: "#808697",
                  colorTextPlaceholder: "#808697",
                  iconColor: "#FFFFFF",
                  iconCardCvcColor: "#FFFFFF",
                  iconRedirectColor: "#FFFFFF",
                  RedirectText: "#FF0000",
                },
                rules: {
                  '.RedirectText': {
                    color: '#FFFFFF',
                  },
                }
              }
            }}
          >
            <CheckoutForm clientSecret={clientSecret} />
          </Elements>
        )}
      </div>
    </div>
  )
}
