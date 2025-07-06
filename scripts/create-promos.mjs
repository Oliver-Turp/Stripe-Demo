import Stripe from 'stripe'
import dotenv from 'dotenv'

dotenv.config()
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

// 🎯 PROMO CODE CONFIGURATION - Add your beta testers here
const PROMO_CODES_CONFIG = [
    {
        email: 'beta1@example.com',
        coupon: 'beta-unlimited-access',
        code: 'BETA_ALICE_2024'
    },
    {
        email: 'beta2@example.com',
        coupon: 'beta-unlimited-access',
        code: 'BETA_BOB_2024'
    },
    {
        email: 'friend1@example.com',
        coupon: 'beta-unlimited-access',
        code: 'BETA_CHARLIE_2024'
    },
    // Add more here and re-run the script safely
]

async function createPromoCodes() {
    try {
        console.log('🎫 Creating Stripe Promo Codes...')
        console.log(`📊 Found ${PROMO_CODES_CONFIG.length} promo code(s) in configuration`)

        const createdCodes = []
        const skippedCodes = []
        const reactivatedCodes = []

        for (const promoConfig of PROMO_CODES_CONFIG) {
            console.log(`\n🔍 Checking promo code: ${promoConfig.code} for ${promoConfig.email}`)

            // Check if promo code already exists
            try {
                const existingCodes = await stripe.promotionCodes.list({
                    code: promoConfig.code,
                    limit: 1
                })

                if (existingCodes.data.length > 0) {
                    const existingCode = existingCodes.data[0]

                    // Check if the existing code is active
                    if (existingCode.active) {
                        console.log(`⚠️  Active promo code '${promoConfig.code}' already exists - skipping`)
                        console.log(`    For: ${existingCode.metadata.authorized_email || 'Unknown email'}`)
                        console.log(`    Status: Active, Max redemptions: ${existingCode.max_redemptions || 'Unlimited'}`)

                        skippedCodes.push({
                            config: promoConfig,
                            existing: existingCode
                        })
                        continue
                    } else {
                        // Promo code exists but is inactive - we can reactivate it
                        console.log(`🔄 Found inactive promo code '${promoConfig.code}' - reactivating...`)

                        try {
                            const reactivatedCode = await stripe.promotionCodes.update(existingCode.id, {
                                active: true,
                                metadata: {
                                    authorized_email: promoConfig.email,
                                    beta_tester: 'true',
                                    reactivated_date: new Date().toISOString(),
                                    reactivated_by: 'create-promos-script'
                                }
                            })

                            reactivatedCodes.push(reactivatedCode)
                            console.log(`✅ Successfully reactivated: ${reactivatedCode.code}`)
                            console.log(`    For: ${promoConfig.email}`)
                            continue

                        } catch (reactivateError) {
                            console.warn(`⚠️  Cannot reactivate promo code '${promoConfig.code}': ${reactivateError.message}`)

                            if (reactivateError.message.includes('coupon is not valid')) {
                                console.log(`💡 The underlying coupon was deleted - will create a new promo code`)
                            }
                        }
                    }
                }
            } catch (error) {
                console.error(`❌ Error checking promo code '${promoConfig.code}':`, error.message)
                throw error
            }

            // Verify the coupon exists
            try {
                const coupon = await stripe.coupons.retrieve(promoConfig.coupon)
                console.log(`🔍 Verified coupon '${promoConfig.coupon}' exists (${coupon.percent_off || coupon.amount_off}% off)`)
            } catch (error) {
                if (error.code === 'resource_missing') {
                    console.error(`❌ Coupon '${promoConfig.coupon}' not found!`)
                    console.error(`💡 Run 'pnpm run create:coup' first to create coupons`)
                    throw error
                } else {
                    throw error
                }
            }

            // Create the promo code
            try {
                console.log(`✨ Creating promo code '${promoConfig.code}' for ${promoConfig.email}...`)

                const promoCode = await stripe.promotionCodes.create({
                    coupon: promoConfig.coupon,
                    code: promoConfig.code,
                    active: true, // Explicitly set as active
                    restrictions: {
                        first_time_transaction: false, // Allow multiple subscriptions
                    },
                    metadata: {
                        authorized_email: promoConfig.email,
                        beta_tester: 'true',
                    }
                })

                createdCodes.push(promoCode)
                console.log(`✅ Successfully created: ${promoCode.code}`)
                console.log(`    For: ${promoConfig.email}`)
                console.log(`    Status: Active, Max redemptions: ${promoCode.max_redemptions || 'Unlimited'}`)

            } catch (createError) {
                console.error(`❌ Failed to create promo code '${promoConfig.code}':`, createError.message)

                if (createError.code === 'resource_already_exists') {
                    console.error(`💡 This promo code already exists (possibly created between checks)`)
                }

                throw createError
            }
        }

        // Summary
        console.log('\n' + '='.repeat(60))
        console.log('🎉 PROMO CODE CREATION COMPLETE!')
        console.log('='.repeat(60))

        if (createdCodes.length > 0) {
            console.log(`\n✅ Created ${createdCodes.length} new promo code(s):`)
            createdCodes.forEach(code => {
                console.log(`  • ${code.code}: ${code.metadata.authorized_email}`)
            })
        }

        if (reactivatedCodes.length > 0) {
            console.log(`\n🔄 Reactivated ${reactivatedCodes.length} promo code(s):`)
            reactivatedCodes.forEach(code => {
                console.log(`  • ${code.code}: ${code.metadata.authorized_email}`)
            })
        }

        if (skippedCodes.length > 0) {
            console.log(`\n⚠️  Skipped ${skippedCodes.length} existing active promo code(s):`)
            skippedCodes.forEach(({ config }) => {
                console.log(`  • ${config.code}: ${config.email} (already active)`)
            })
        }

        if (createdCodes.length === 0 && reactivatedCodes.length === 0 && skippedCodes.length > 0) {
            console.log('\n💡 All promo codes already exist and are active - nothing to create!')
        }

        console.log('\n📋 Total Active Promo Codes Available:')
        const allCodes = [...createdCodes, ...reactivatedCodes, ...skippedCodes.map(s => s.existing)]
        allCodes.forEach(code => {
            const status = code.active ? '✅ Active' : '❌ Inactive'
            console.log(`  • ${code.code}: ${code.metadata.authorized_email || 'Unknown email'} (${status})`)
        })

        console.log('\n💡 Next Steps:')
        console.log('1. Send promo codes to your beta testers')
        console.log('2. They can use these codes at checkout for free access')
        console.log('3. Add more codes to CONFIG array and re-run this script anytime')
        console.log('4. Deactivate codes via Stripe Dashboard or API if needed')

        return {
            created: createdCodes,
            reactivated: reactivatedCodes,
            skipped: skippedCodes,
            total: allCodes
        }

    } catch (error) {
        console.error('\n❌ SCRIPT FAILED:')
        console.error('Error message:', error.message)
        console.error('Error type:', error.type)
        console.error('Error code:', error.code)

        if (error.type === 'StripeInvalidRequestError') {
            console.error('💡 This is likely a validation error with the promo code configuration')
        }

        process.exit(1)
    }
}

createPromoCodes()
