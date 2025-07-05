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

// Helper function to get feature ID from lookup_key
async function getFeatureIdByLookupKey(lookupKey) {
  try {
    const features = await stripe.entitlements.features.list({
      lookup_key: lookupKey,
      limit: 10 // Get more in case there are archived ones
    })

    // Find an ACTIVE feature with this lookup_key
    const activeFeature = features.data.find(feature => feature.active === true)
    
    if (!activeFeature) {
      throw new Error(`Active feature with lookup_key '${lookupKey}' not found`)
    }

    return activeFeature.id
  } catch (error) {
    throw new Error(`Failed to find active feature '${lookupKey}': ${error.message}`)
  }
}

// Helper function to check if a product with similar name/tier already exists
async function findExistingActiveProduct(productConfig) {
  try {
    const products = await stripe.products.list({
      active: true,
      limit: 100
    })

    // Look for a product with the same tier in metadata
    const existingProduct = products.data.find(product => 
      product.metadata?.tier === productConfig.metadata.tier
    )

    return existingProduct || null
  } catch (error) {
    console.warn('Could not search for existing products:', error.message)
    return null
  }
}

async function createProducts() {
  try {
    console.log(`🚀 Creating ${PRODUCTS_CONFIG.length} products with pricing and features...`)

    const createdProducts = []
    const skippedProducts = []

    for (const productConfig of PRODUCTS_CONFIG) {
      console.log(`\n🔍 Checking product: ${productConfig.name} (${productConfig.metadata.tier})`)

      // Check if a similar active product already exists
      const existingProduct = await findExistingActiveProduct(productConfig)
      
      if (existingProduct) {
        console.log(`⚠️  Active product with tier '${productConfig.metadata.tier}' already exists - skipping`)
        console.log(`    Existing: ${existingProduct.name} (${existingProduct.id})`)
        
        skippedProducts.push({
          config: productConfig,
          existing: existingProduct
        })
        continue
      }

      // Create the product (let Stripe generate the ID)
      const productPayload = {
        // Remove custom ID - let Stripe generate it
        name: productConfig.name,
        description: productConfig.description,
        metadata: {
          features: productConfig.features.join(', '),
          ...productConfig.metadata,
        }
      }

      console.log(`📦 Creating product: ${productConfig.name}...`)
      
      try {
        const product = await stripe.products.create(productPayload)
        console.log(`✅ Created product: ${product.id}`)

        // Attach features to the product
        console.log(`\n🔗 Attaching ${productConfig.features.length} features to ${product.name}...`)
        
        for (const featureLookupKey of productConfig.features) {
          try {
            console.log(`  📎 Attaching feature: ${featureLookupKey}`)
            const featureId = await getFeatureIdByLookupKey(featureLookupKey)
            console.log(`  🔍 Found feature ID: ${featureId}`)

            await stripe.products.createFeature(product.id, {
              entitlement_feature: featureId
            })

            console.log(`  ✅ Successfully attached: ${featureLookupKey}`)

          } catch (featureError) {
            console.error(`  ❌ Failed to attach feature ${featureLookupKey}:`, featureError.message)
            
            if (featureError.message.includes('not found')) {
              console.error(`  💡 Make sure you've run 'pnpm run create:feat' first!`)
            }
          }
        }

        // Create prices for this product
        const prices = {}

        for (const [interval, priceConfig] of Object.entries(productConfig.prices)) {
          console.log(`\n💰 Creating ${interval} price for ${productConfig.name}...`)

          const price = await stripe.prices.create({
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
          })

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

      } catch (createError) {
        console.error(`❌ Failed to create product '${productConfig.name}':`, createError.message)
        
        if (createError.code === 'resource_already_exists') {
          console.error(`💡 A product with similar properties already exists`)
        }
        
        throw createError
      }
    }

    // Display summary
    console.log('\n' + '='.repeat(80))
    console.log('🎉 PRODUCT CREATION COMPLETE!')
    console.log('='.repeat(80))

    if (createdProducts.length > 0) {
      console.log(`\n✅ Created ${createdProducts.length} new product(s):`)
      createdProducts.forEach(({ product, prices }) => {
        console.log(`  • ${product.name} (${product.tier.toUpperCase()})`)
        console.log(`    Product ID: ${product.id}`)
        Object.entries(prices).forEach(([interval, price]) => {
          console.log(`    ${interval}: ${price.id} (£${(price.amount / 100).toFixed(2)})`)
        })
      })
    }

    if (skippedProducts.length > 0) {
      console.log(`\n⚠️  Skipped ${skippedProducts.length} existing active product(s):`)
      skippedProducts.forEach(({ config, existing }) => {
        console.log(`  • ${config.name}: ${existing.id} (already exists)`)
      })
    }

    if (createdProducts.length === 0 && skippedProducts.length > 0) {
      console.log('\n💡 All products already exist - nothing to create!')
    }

    console.log('\n💡 Next Steps:')
    console.log('1. Your products are now live in Stripe with feature entitlements!')
    console.log('2. The checkout page will automatically fetch these products')
    console.log('3. Webhooks will automatically sync feature entitlements')
    console.log('4. Add more products to CONFIG array and re-run this script anytime')

    console.log('\n📚 About Product IDs:')
    console.log('• Product IDs are auto-generated by Stripe (cannot be reused)')
    console.log('• Archived products cannot be reactivated')
    console.log('• This script checks for existing products by tier metadata')

    return {
      created: createdProducts,
      skipped: skippedProducts
    }

  } catch (error) {
    console.error('\n❌ SCRIPT FAILED:')
    console.error('Error message:', error.message)
    console.error('Error type:', error.type)
    console.error('Error code:', error.code)

    if (error.type === 'StripeInvalidRequestError') {
      console.error('💡 This is likely a validation error with the request payload')
    }

    process.exit(1)
  }
}

createProducts()
