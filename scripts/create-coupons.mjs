import Stripe from 'stripe'
import dotenv from 'dotenv'

dotenv.config()
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

// 🎯 COUPON CONFIGURATION - Edit this to add/modify coupons
const COUPONS_CONFIG = [
    {
        id: 'beta-unlimited-access',
        name: 'Beta Tester Unlimited Access',
        percent_off: 100,
        duration: 'forever',
        description: 'Free access for beta testers and friends',
        metadata: {
            program: 'beta_testing',
            type: 'unlimited_access'
        }
    },
    // You can add more coupons here and re-run the script safely
]

async function createCoupons() {
    try {
        console.log('🎫 Creating Stripe Coupons...')
        console.log(`📊 Found ${COUPONS_CONFIG.length} coupon(s) in configuration`)

        const createdCoupons = []
        const skippedCoupons = []

        for (const couponConfig of COUPONS_CONFIG) {
            console.log(`\n🔍 Checking coupon: ${couponConfig.name} (${couponConfig.id})`)

            // Check if coupon already exists
            try {
                const existingCoupon = await stripe.coupons.retrieve(couponConfig.id)
                console.log(`⚠️  Coupon '${couponConfig.id}' already exists - skipping creation`)
                console.log(`    Existing: ${existingCoupon.percent_off}% off ${existingCoupon.duration}`)
                
                skippedCoupons.push({
                    config: couponConfig,
                    existing: existingCoupon
                })
                continue

            } catch (error) {
                // If error is 'resource_missing', coupon doesn't exist - we can create it
                if (error.code === 'resource_missing') {
                    console.log(`✨ Coupon '${couponConfig.id}' doesn't exist - creating now...`)
                } else {
                    // Some other error occurred
                    console.error(`❌ Error checking coupon '${couponConfig.id}':`, error.message)
                    throw error
                }
            }

            // Create the coupon
            try {
                const coupon = await stripe.coupons.create({
                    id: couponConfig.id,
                    name: couponConfig.name,
                    percent_off: couponConfig.percent_off,
                    duration: couponConfig.duration,
                    metadata: {
                        description: couponConfig.description,
                        ...couponConfig.metadata,
                    }
                })

                createdCoupons.push(coupon)
                console.log(`✅ Successfully created: ${coupon.id}`)
                console.log(`    Details: ${coupon.percent_off}% off ${coupon.duration}`)

            } catch (createError) {
                console.error(`❌ Failed to create coupon '${couponConfig.id}':`, createError.message)
                throw createError
            }
        }

        // Summary
        console.log('\n' + '='.repeat(60))
        console.log('🎉 COUPON CREATION COMPLETE!')
        console.log('='.repeat(60))

        if (createdCoupons.length > 0) {
            console.log(`\n✅ Created ${createdCoupons.length} new coupon(s):`)
            createdCoupons.forEach(coupon => {
                console.log(`  • ${coupon.name}: ${coupon.id} (${coupon.percent_off}% off ${coupon.duration})`)
            })
        }

        if (skippedCoupons.length > 0) {
            console.log(`\n⚠️  Skipped ${skippedCoupons.length} existing coupon(s):`)
            skippedCoupons.forEach(({ config, existing }) => {
                console.log(`  • ${config.name}: ${config.id} (already exists)`)
            })
        }

        if (createdCoupons.length === 0 && skippedCoupons.length > 0) {
            console.log('\n💡 All coupons already exist - nothing to create!')
        }

        console.log('\n📋 Total Coupons Available:')
        const allCoupons = [...createdCoupons, ...skippedCoupons.map(s => s.existing)]
        allCoupons.forEach(coupon => {
            console.log(`  • ${coupon.name || coupon.id}: ${coupon.id} (${coupon.percent_off}% off)`)
        })

        console.log('\n💡 Next Steps:')
        console.log('1. Coupons are ready to use!')
        console.log('2. Create promotion codes to give people access to these coupons')
        console.log('3. Add more coupons to the CONFIG array and re-run this script anytime')

        return {
            created: createdCoupons,
            skipped: skippedCoupons,
            total: allCoupons
        }

    } catch (error) {
        console.error('\n❌ SCRIPT FAILED:')
        console.error('Error message:', error.message)
        console.error('Error type:', error.type)
        console.error('Error code:', error.code)
        
        if (error.type === 'StripeInvalidRequestError') {
            console.error('💡 This is likely a validation error with the coupon configuration')
        }
        
        process.exit(1)
    }
}

createCoupons()
