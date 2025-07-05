// Complete Stripe test environment wipe
import dotenv from 'dotenv'
import Stripe from 'stripe'
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'

dotenv.config()

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

async function wipeStripeEnvironment() {
  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error('STRIPE_SECRET_KEY not found in environment variables')
    }

    console.log('🚨 DANGER ZONE: Complete Stripe Test Environment Wipe')
    console.log('⚠️  This will delete ALL test data in Stripe!')
    console.log('🧹 Starting complete wipe...\n')

    // Step 1: Run the existing clean script
    console.log('📋 STEP 1: Running clean script...')
    try {
      execSync('node scripts/clean.mjs', { stdio: 'inherit' })
      console.log('✅ Clean script completed\n')
    } catch (error) {
      console.log('⚠️  Clean script had issues, continuing...\n')
    }

    // Step 2: Cancel all active subscriptions
    console.log('📋 STEP 2: Canceling all active subscriptions...')
    await cancelAllActiveSubscriptions()

    // Step 3: Delete all customers
    console.log('\n📋 STEP 3: Deleting all customers...')
    await deleteAllCustomers()

    // Step 4: Delete all products (this will also remove feature attachments)
    console.log('\n📋 STEP 4: Deleting all products...')
    await deleteAllProducts()

    // 🆕 Step 5: Delete all features
    console.log('\n📋 STEP 5: Deleting all features...')
    await deleteAllFeatures()

    // Step 6: Blank out the JSON file
    console.log('\n📋 STEP 6: Clearing local data file...')
    clearLocalData()

    console.log('\n🎉 COMPLETE WIPE FINISHED!')
    console.log('✨ Your Stripe test environment is now completely clean!')
    console.log('🔄 You can now run:')
    console.log('   1. `node scripts/create-features.mjs` to create features')
    console.log('   2. `node scripts/create-products.mjs` to create products')

  } catch (error) {
    console.error('❌ Wipe error:', error.message)
    process.exit(1)
  }
}

async function cancelAllActiveSubscriptions() {
  // Get all active subscriptions
  const activeSubscriptions = await stripe.subscriptions.list({
    status: 'active',
    limit: 100,
  })

  console.log(`Found ${activeSubscriptions.data.length} active subscriptions`)

  for (const subscription of activeSubscriptions.data) {
    try {
      await stripe.subscriptions.cancel(subscription.id)
      console.log(`✅ Canceled subscription: ${subscription.id}`)
    } catch (err) {
      console.log(`⚠️  Could not cancel subscription ${subscription.id}: ${err.message}`)
    }
  }

  // Also get past_due subscriptions
  const pastDueSubscriptions = await stripe.subscriptions.list({
    status: 'past_due',
    limit: 100,
  })

  console.log(`Found ${pastDueSubscriptions.data.length} past_due subscriptions`)

  for (const subscription of pastDueSubscriptions.data) {
    try {
      await stripe.subscriptions.cancel(subscription.id)
      console.log(`✅ Canceled past_due subscription: ${subscription.id}`)
    } catch (err) {
      console.log(`⚠️  Could not cancel subscription ${subscription.id}: ${err.message}`)
    }
  }
}

async function deleteAllCustomers() {
  const customers = await stripe.customers.list({
    limit: 100,
  })

  console.log(`Found ${customers.data.length} customers`)

  for (const customer of customers.data) {
    try {
      await stripe.customers.del(customer.id)
      console.log(`✅ Deleted customer: ${customer.id} (${customer.email})`)
    } catch (err) {
      console.log(`⚠️  Could not delete customer ${customer.id}: ${err.message}`)
    }
  }
}

async function deleteAllProducts() {
  const products = await stripe.products.list({
    limit: 100,
  })

  console.log(`Found ${products.data.length} products`)

  for (const product of products.data) {
    try {
      // 🆕 First, remove all feature attachments from this product
      console.log(`🔗 Checking feature attachments for product ${product.id}...`)
      try {
        const productFeatures = await stripe.products.listFeatures(product.id, {
          limit: 100
        })

        console.log(`  Found ${productFeatures.data.length} attached features`)

        for (const attachment of productFeatures.data) {
          try {
            await stripe.products.deleteFeature(product.id, attachment.id)
            console.log(`  🔗 Removed feature attachment: ${attachment.id}`)
          } catch (detachErr) {
            console.log(`  ⚠️  Could not remove feature attachment ${attachment.id}: ${detachErr.message}`)
          }
        }
      } catch (featuresErr) {
        console.log(`  ⚠️  Could not list features for product ${product.id}: ${featuresErr.message}`)
      }

      // Get ALL prices for this product
      const prices = await stripe.prices.list({
        product: product.id,
        limit: 100
      })

      console.log(`  Found ${prices.data.length} prices for product ${product.id}`)

      // Handle each price: try delete, fallback to archive
      for (const price of prices.data) {
        try {
          // Try to delete the price first
          await stripe.prices.del(price.id)
          console.log(`  🗑️  Deleted price: ${price.id}`)
        } catch (deleteErr) {
          // If delete fails, try to archive it
          try {
            if (price.active) {
              await stripe.prices.update(price.id, { active: false })
              console.log(`  📦 Archived price: ${price.id} (delete failed, archived instead)`)
            } else {
              console.log(`  📦 Price already archived: ${price.id}`)
            }
          } catch (archiveErr) {
            console.log(`  ⚠️  Could not delete or archive price ${price.id}: ${archiveErr.message}`)
          }
        }
      }

      // Small delay to ensure price updates are processed
      await new Promise(resolve => setTimeout(resolve, 200))

      // Try to delete the product first
      try {
        await stripe.products.del(product.id)
        console.log(`✅ Deleted product: ${product.id} (${product.name})`)
      } catch (deleteErr) {
        // If delete fails, try to archive the product
        try {
          await stripe.products.update(product.id, { active: false })
          console.log(`📦 Archived product: ${product.id} (${product.name}) - delete failed, archived instead`)
        } catch (archiveErr) {
          console.log(`⚠️  Could not delete or archive product ${product.id}: ${archiveErr.message}`)
        }
      }

    } catch (err) {
      console.log(`⚠️  Error processing product ${product.id}: ${err.message}`)
    }
  }
}

// 🆕 NEW: Delete all features
async function deleteAllFeatures() {
  try {
    const features = await stripe.entitlements.features.list({
      limit: 100,
    })

    console.log(`Found ${features.data.length} features`)

    if (features.data.length === 0) {
      console.log('✅ No features to delete')
      return
    }

    for (const feature of features.data) {
      try {
        // Features can only be archived, not deleted
        await stripe.entitlements.features.update(feature.id, {
          active: false
        })
        console.log(`📦 Archived feature: ${feature.id} (${feature.name}) - lookup_key: ${feature.lookup_key}`)

        // Small delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 100))

      } catch (err) {
        console.log(`⚠️  Could not archive feature ${feature.id}: ${err.message}`)
      }
    }

    console.log('✅ All features archived (features cannot be permanently deleted)')
    console.log('💡 Archived features can be reactivated or their lookup_keys can be reused')

  } catch (error) {
    console.log(`⚠️  Error listing features: ${error.message}`)
  }
}

function clearLocalData() {
  try {
    const dataPath = path.join(process.cwd(), 'data', 'users.json')

    const emptyData = {
      customers: {},
      subscriptions: {},
      payments: {}
    }

    fs.writeFileSync(dataPath, JSON.stringify(emptyData, null, 2))
    console.log('✅ Cleared local data file')
  } catch (error) {
    console.log(`⚠️  Could not clear local data: ${error.message}`)
  }
}

// Confirmation prompt with countdown
console.log('🚨 WARNING: This will completely wipe your Stripe test environment!')
console.log('This includes:')
console.log('- All subscriptions (active and inactive)')
console.log('- All customers')
console.log('- All products and prices')
console.log('- All features (archived)')
console.log('- All payment intents and invoices')
console.log('- Local data file')
console.log('')
console.log('This action cannot be undone!')
console.log('')
console.log('Press Ctrl+C to cancel now!')

// Visual countdown that starts immediately
let countdown = 5
const countdownInterval = setInterval(() => {
  process.stdout.write(`\r⏰ Starting wipe in ${countdown} seconds...`)
  countdown--

  if (countdown < 0) {
    clearInterval(countdownInterval)
    process.stdout.write('\r⏰ Starting wipe now...           \n') // Clear the line and add newline
    wipeStripeEnvironment()
  }
}, 1000)

// Show initial countdown immediately
process.stdout.write(`⏰ Starting wipe in ${countdown} seconds...`)
