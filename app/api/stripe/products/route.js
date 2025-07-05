import { NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe-server'

export async function GET() {
  try {
    // Fetch all active products
    const products = await stripe.products.list({
      active: true,
      expand: ['data.default_price'],
      limit: 100
    })

    // Fetch all active prices
    const prices = await stripe.prices.list({
      active: true,
      limit: 100
    })

    // Group prices by product
    const productsWithPrices = await Promise.all(
      products.data.map(async (product) => {
        const productPrices = prices.data.filter(price => price.product === product.id)

        // Organize prices by interval
        const pricesByInterval = {}
        productPrices.forEach(price => {
          if (price.recurring) {
            const intervalKey = price.recurring.interval === 'month' ? 'monthly' :
              price.recurring.interval === 'year' ? 'yearly' :
                price.recurring.interval

            pricesByInterval[intervalKey] = {
              id: price.id,
              amount: price.unit_amount,
              interval: price.recurring.interval
            }
          }
        })

        // 🆕 NEW: Get entitlement features attached to this product
        let features = []
        try {
          const productFeatures = await stripe.products.listFeatures(product.id)

          // 🆕 NEW: Sort features by order metadata before extracting names
          const sortedProductFeatures = productFeatures.data.sort((a, b) => {
            const orderA = parseInt(a.entitlement_feature.metadata?.order || 999)
            const orderB = parseInt(b.entitlement_feature.metadata?.order || 999)
            return orderA - orderB
          })

          // Extract feature names/lookup_keys for display
          features = sortedProductFeatures.map(pf => {
            // pf.entitlement_feature is the feature object
            return pf.entitlement_feature.name || pf.entitlement_feature.lookup_key
          })

          // console.log(`📋 Found ${features.length} entitlement features for ${product.name}:`, features)

        } catch (featureError) {
          console.warn(`⚠️ Could not fetch features for product ${product.id}:`, featureError.message)

          // Fallback to metadata.features if entitlement features fail
          if (product.metadata?.features) {
            features = product.metadata.features.split(', ').filter(f => f.trim())
            console.log(`📋 Using metadata.features fallback for ${product.name}:`, features)
          }
        }

        return {
          id: product.id,
          name: product.name,
          description: product.description,
          features: features,
          prices: pricesByInterval,
          metadata: product.metadata
        }
      })
    )

    // Sort products by priority if available
    productsWithPrices.sort((a, b) => {
      const priorityA = parseInt(a.metadata?.priority || 999)
      const priorityB = parseInt(b.metadata?.priority || 999)
      return priorityA - priorityB
    })

    // console.log(`✅ Returning ${productsWithPrices.length} products`)
    // productsWithPrices.forEach(product => {
    //   console.log(`  - ${product.name}: ${product.features.length} features`)
    // })

    return NextResponse.json({ products: productsWithPrices })

  } catch (error) {
    console.error('Error fetching products:', error)
    return NextResponse.json(
      { error: 'Failed to fetch products' },
      { status: 500 }
    )
  }
}
