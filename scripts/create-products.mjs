import Stripe from 'stripe'
import dotenv from 'dotenv'

dotenv.config()

console.log('🔧 Environment check:')
console.log('- STRIPE_SECRET_KEY exists:', !!process.env.STRIPE_SECRET_KEY)
console.log('- STRIPE_SECRET_KEY starts with:', process.env.STRIPE_SECRET_KEY?.substring(0, 8))

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

// 🎯 PRODUCT CONFIGURATION - Edit this to add/modify products
const PRODUCTS_CONFIG = [
  {
    name: 'Core Tier',
    description: 'Ideal for individuals and small servers ready to go premium',
    features: [
      'single_premium_server',
      'extended_limits',
      'priority_support',
      'credit_shoutout'
    ],
    prices: {
      monthly: { amount: 300, interval: 'month' }, // £3.00
      yearly: { amount: 3000, interval: 'year' }   // £30.00
    },
    metadata: {
      tier: 'core',
      priority: 1,
      popular: false
    }
  },
  {
    name: 'Plus Tier',
    description: 'Perfect for multilingual servers and teams needing smart, AI-powered help',
    features: [
      'single_premium_server',
      'extended_limits',
      'priority_support',
      'credit_shoutout',
      'ai_integration',
      'translation_commands',
      'feature_suggestions'
    ],
    prices: {
      monthly: { amount: 500, interval: 'month' }, // £5.00
      yearly: { amount: 5000, interval: 'year' }   // £50.00
    },
    metadata: {
      tier: 'plus',
      priority: 2,
      popular: true
    }
  },
  {
    name: 'Ultra Tier',
    description: 'For multi-server admins seeking dedicated support and custom branding.',
    features: [
      'extended_limits',
      'priority_support',
      'credit_shoutout',
      'ai_integration',
      'translation_commands',
      'feature_suggestions',
      'custom_bot_name',
      'personal_support',
      'three_premium_servers'
    ],
    prices: {
      monthly: { amount: 1000, interval: 'month' }, // £10.00
      yearly: { amount: 10000, interval: 'year' }   // £100.00
    },
    metadata: {
      tier: 'ultra',
      priority: 3,
      popular: false
    }
  },
]

const currency = 'gbp'

// 🆕 Helper function to get feature ID from lookup_key
async function getFeatureIdByLookupKey(lookupKey) {
  try {
    const features = await stripe.entitlements.features.list({
      lookup_key: lookupKey,
      limit: 1
    })

    if (features.data.length === 0) {
      throw new Error(`Feature with lookup_key '${lookupKey}' not found`)
    }

    return features.data[0].id
  } catch (error) {
    throw new Error(`Failed to find feature '${lookupKey}': ${error.message}`)
  }
}

async function createProducts() {
  try {
    console.log(`🚀 Creating ${PRODUCTS_CONFIG.length} products with pricing and features...`)

    const createdProducts = []

    for (const productConfig of PRODUCTS_CONFIG) {
      console.log(`\n📦 Creating ${productConfig.name}...`)

      // 🔍 DEBUG: Log what we're about to send
      const productPayload = {
        name: productConfig.name,
        description: productConfig.description,
        metadata: {
          // Keep the old features string for backward compatibility
          features: productConfig.features.join(', '),
          ...productConfig.metadata
        }
      }

      console.log('🔍 Product payload:', JSON.stringify(productPayload, null, 2))

      // Create the product
      console.log('📡 Sending product creation request...')
      const product = await stripe.products.create(productPayload)

      console.log(`✅ Created product: ${product.id}`)
      console.log('🔍 Product response:', JSON.stringify({
        id: product.id,
        name: product.name,
        metadata: product.metadata
      }, null, 2))

      // 🆕 NEW: Attach features to the product (FIXED)
      console.log(`\n🔗 Attaching ${productConfig.features.length} features to ${product.name}...`)

      for (const featureLookupKey of productConfig.features) {
        try {
          console.log(`  📎 Attaching feature: ${featureLookupKey}`)

          // 🔧 FIXED: Get the feature ID first
          const featureId = await getFeatureIdByLookupKey(featureLookupKey)
          console.log(`  🔍 Found feature ID: ${featureId}`)

          // 🔧 FIXED: Use correct parameter name and feature ID
          await stripe.products.createFeature(product.id, {
            entitlement_feature: featureId  // Use feature ID, not lookup_key
          })

          console.log(`  ✅ Successfully attached: ${featureLookupKey} (${featureId})`)

        } catch (featureError) {
          console.error(`  ❌ Failed to attach feature ${featureLookupKey}:`, featureError.message)

          if (featureError.message.includes('not found')) {
            console.error(`  💡 Make sure you've run 'node scripts/create-features.mjs' first!`)
          }
        }
      }

      // Create prices for this product
      const prices = {}

      for (const [interval, priceConfig] of Object.entries(productConfig.prices)) {
        console.log(`\n💰 Creating ${interval} price for ${productConfig.name}...`)

        const pricePayload = {
          product: product.id,
          unit_amount: priceConfig.amount,
          currency: currency,
          recurring: {
            interval: priceConfig.interval
          },
          metadata: {
            plan: productConfig.metadata.tier,
            interval: interval,
            tier: productConfig.metadata.tier
          }
        }

        console.log('🔍 Price payload:', JSON.stringify(pricePayload, null, 2))

        const price = await stripe.prices.create(pricePayload)

        prices[interval] = {
          id: price.id,
          amount: priceConfig.amount
        }

        console.log(`✅ Created ${interval} price: ${price.id} (£${(priceConfig.amount / 100).toFixed(2)})`)
      }

      createdProducts.push({
        product: {
          id: product.id,
          name: product.name,
          tier: productConfig.metadata.tier,
          features: productConfig.features
        },
        prices
      })

      // Small delay to avoid rate limits
      console.log('⏳ Waiting 100ms before next product...')
      await new Promise(resolve => setTimeout(resolve, 100))
    }

    // Display summary
    console.log('\n' + '='.repeat(80))
    console.log('🎉 ALL PRODUCTS CREATED SUCCESSFULLY!')
    console.log('='.repeat(80))

    console.log('\n📋 SUMMARY:')
    createdProducts.forEach(({ product, prices }) => {
      console.log(`\n${product.name} (${product.tier.toUpperCase()})`)
      console.log(`  Product ID: ${product.id}`)
      console.log(`  Features: ${product.features.join(', ')}`)
      Object.entries(prices).forEach(([interval, price]) => {
        console.log(`  ${interval.charAt(0).toUpperCase() + interval.slice(1)} Price: ${price.id} (£${(price.amount / 100).toFixed(2)})`)
      })
    })

    console.log('\n💡 NEXT STEPS:')
    console.log('1. Your products are now live in Stripe with feature entitlements!')
    console.log('2. The checkout page will automatically fetch these products')
    console.log('3. Webhooks will automatically sync feature entitlements')
    console.log('4. Check your Stripe dashboard to see the products and features')

    // Optional: Generate a quick reference
    console.log('\n📄 QUICK REFERENCE (for debugging):')
    const quickRef = createdProducts.reduce((acc, { product, prices }) => {
      acc[product.tier] = {
        productId: product.id,
        features: product.features,
        monthly: prices.monthly?.id,
        yearly: prices.yearly?.id
      }
      return acc
    }, {})
    console.log(JSON.stringify(quickRef, null, 2))

    // 🆕 NEW: Show entitlements info
    console.log('\n🎯 ENTITLEMENTS INFO:')
    console.log('- Features are now attached to products')
    console.log('- When customers subscribe, they automatically get entitlements')
    console.log('- Use webhooks to sync entitlements to your database')
    console.log('- Check entitlements with: stripe.entitlements.active.list({ customer: "cus_..." })')

  } catch (error) {
    console.error('❌ Error creating products:')
    console.error('Error message:', error.message)
    console.error('Error type:', error.type)
    console.error('Error code:', error.code)
    console.error('Full error:', error)

    if (error.type === 'StripeInvalidRequestError') {
      console.error('🔍 This is likely a validation error with the request payload')
    }

    process.exit(1)
  }
}

createProducts()
