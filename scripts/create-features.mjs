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

        const createdFeatures = []

        for (const featureConfig of FEATURES_CONFIG) {
            console.log(`\n📦 Creating feature: ${featureConfig.name}`)

            const feature = await stripe.entitlements.features.create({
                name: featureConfig.name,
                lookup_key: featureConfig.lookup_key,
                metadata: {
                    description: featureConfig.description,
                    order: featureConfig.order,
                }
            })

            createdFeatures.push(feature)
            console.log(`✅ Created: ${feature.lookup_key} (${feature.id})`)
        }

        console.log('\n🎉 All features created!')
        console.log('\n📋 Feature Summary:')
        createdFeatures.forEach(feature => {
            console.log(`  ${feature.name}: ${feature.lookup_key}`)
        })

        return createdFeatures

    } catch (error) {
        console.error('❌ Error creating features:', error)
    }
}

createFeatures()
