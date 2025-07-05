import Stripe from 'stripe'
import dotenv from 'dotenv'

dotenv.config()
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

const FEATURES_CONFIG = [
    {
        name: 'Premium Server Access',
        lookup_key: 'single_premium_server',
        description: 'Access to one premium Discord server',
        order: 1,
    },
    {
        name: 'Extended Limits',
        lookup_key: 'extended_limits',
        description: 'Higher rate limits and extended functionality',
        order: 2,
    },
    {
        name: 'Priority Support',
        lookup_key: 'priority_support',
        description: 'Priority customer support and faster response times',
        order: 3,
    },
    {
        name: "Credit Shoutout",
        lookup_key: 'credit_shoutout',
        description: 'Your name will be displayed in the credits list',
        order: 4,
    },
    {
        name: 'Translation Commands',
        lookup_key: 'translation_commands',
        description: 'Multi-language translation capabilities',
        order: 5,
    },
    {
        name: 'AI Integration',
        lookup_key: 'ai_integration',
        description: 'AI-powered bot responses and commands',
        order: 6,
    },
    {
        name: 'Feature Suggestions',
        lookup_key: 'feature_suggestions',
        description: 'Suggest new features and improvements',
        order: 7,
    },
    {
        name: 'Custom Bot Name',
        lookup_key: 'custom_bot_name',
        description: 'Customize the bot\'s name',
        order: 8,
    },
    {
        name: '1-1 Support',
        lookup_key: 'personal_support',
        description: '1-1 support with the developer',
        order: 9,
    },
    {
        name: 'Three Premium Servers',
        lookup_key: 'three_premium_servers',
        description: 'Access to three premium Discord servers',
        order: 10,
    },
]

async function createFeatures() {
    try {
        console.log('🎯 Creating Stripe Features for Discord Bot...')
        console.log(`📊 Found ${FEATURES_CONFIG.length} feature(s) in configuration`)

        const createdFeatures = []
        const skippedFeatures = []

        for (const featureConfig of FEATURES_CONFIG) {
            console.log(`\n🔍 Checking feature: ${featureConfig.name} (${featureConfig.lookup_key})`)

            // Check if feature already exists by lookup_key
            try {
                const existingFeatures = await stripe.entitlements.features.list({
                    lookup_key: featureConfig.lookup_key,
                    limit: 10 // Get more in case there are multiple (active + archived)
                })

                // Look for an ACTIVE feature with this lookup_key
                const activeFeature = existingFeatures.data.find(feature => feature.active === true)

                if (activeFeature) {
                    console.log(`⚠️  Active feature '${featureConfig.lookup_key}' already exists - skipping`)
                    console.log(`    Existing: ${activeFeature.name} (${activeFeature.id})`)
                    
                    skippedFeatures.push({
                        config: featureConfig,
                        existing: activeFeature
                    })
                    continue
                }

                // If we found features but none are active, they're all archived
                if (existingFeatures.data.length > 0) {
                    const archivedCount = existingFeatures.data.filter(f => !f.active).length
                    console.log(`📦 Found ${archivedCount} archived feature(s) with lookup_key '${featureConfig.lookup_key}'`)
                    console.log(`💡 Creating new feature (lookup_key can be reused)...`)
                }

            } catch (error) {
                console.error(`❌ Error checking feature '${featureConfig.lookup_key}':`, error.message)
                throw error
            }

            // Create the feature (no active feature exists with this lookup_key)
            try {
                console.log(`✨ Creating feature '${featureConfig.lookup_key}'...`)
                
                const feature = await stripe.entitlements.features.create({
                    name: featureConfig.name,
                    lookup_key: featureConfig.lookup_key,
                    metadata: {
                        description: featureConfig.description,
                        order: featureConfig.order,
                        created_date: new Date().toISOString(),
                        created_by: 'create-features-script'
                    }
                })

                createdFeatures.push(feature)
                console.log(`✅ Successfully created: ${feature.lookup_key} (${feature.id})`)

            } catch (createError) {
                console.error(`❌ Failed to create feature '${featureConfig.lookup_key}':`, createError.message)
                
                // Provide helpful error context
                if (createError.message.includes('already exists')) {
                    console.error(`💡 This might be a race condition or the feature was just created`)
                }
                
                throw createError
            }
        }

        // Summary
        console.log('\n' + '='.repeat(60))
        console.log('🎉 FEATURE CREATION COMPLETE!')
        console.log('='.repeat(60))

        if (createdFeatures.length > 0) {
            console.log(`\n✅ Created ${createdFeatures.length} new feature(s):`)
            createdFeatures.forEach(feature => {
                console.log(`  • ${feature.name}: ${feature.lookup_key}`)
            })
        }

        if (skippedFeatures.length > 0) {
            console.log(`\n⚠️  Skipped ${skippedFeatures.length} existing active feature(s):`)
            skippedFeatures.forEach(({ config }) => {
                console.log(`  • ${config.name}: ${config.lookup_key} (already exists)`)
            })
        }

        if (createdFeatures.length === 0 && skippedFeatures.length > 0) {
            console.log('\n💡 All features already exist - nothing to create!')
        }

        console.log('\n📋 Total Active Features Available:')
        const allFeatures = [...createdFeatures, ...skippedFeatures.map(s => s.existing)]
        allFeatures.forEach(feature => {
            console.log(`  • ${feature.name}: ${feature.lookup_key}`)
        })

        console.log('\n💡 Next Steps:')
        console.log('1. Features are ready to be attached to products!')
        console.log('2. Run "pnpm run create:prod" to create products with these features')
        console.log('3. Add more features to CONFIG array and re-run this script anytime')

        console.log('\n📚 About Archived Features:')
        console.log('• Archived features cannot be edited or reactivated')
        console.log('• Their lookup_keys can be reused for new features')
        console.log('• This script will create new features even if archived ones exist')

        return {
            created: createdFeatures,
            skipped: skippedFeatures,
            total: allFeatures
        }

    } catch (error) {
        console.error('\n❌ SCRIPT FAILED:')
        console.error('Error message:', error.message)
        console.error('Error type:', error.type)
        console.error('Error code:', error.code)
        
        if (error.type === 'StripeInvalidRequestError') {
            console.error('💡 This is likely a validation error with the feature configuration')
        }
        
        process.exit(1)
    }
}

createFeatures()
