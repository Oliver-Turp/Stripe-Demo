# Stripe Subscription Demo

A simple Next.js demo showing Stripe subscriptions with feature entitlements. No user authentication - just email-based customer matching for demo purposes.

## 🎯 What This Does

- Creates tiered subscription plans (Silver £3/month, Gold £5/month)
- Shows different features per tier using Stripe's entitlements system
- Handles subscriptions via Stripe Checkout
- Basic demo - customer identification by email only

## 🚀 Quick Setup

### 1. Install Dependencies
```bash
pnpm install
```

### 2. Get Stripe Keys

1. Sign up at [stripe.com](https://stripe.com) 
2. Go to [Dashboard > API Keys](https://dashboard.stripe.com/apikeys)
3. Copy your test keys (pk_test_... and sk_test_...)

### 3. Create `.env` File
```env
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_your_key_here
STRIPE_SECRET_KEY=sk_test_your_key_here
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret_here
```

### 4. Set Up Local Webhooks

**Important**: Webhooks don't work in local development by default. You need Stripe CLI:

1. Install [Stripe CLI](https://stripe.com/docs/stripe-cli)
2. Login: `stripe login`
3. Forward webhooks to your local server:
```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```
4. Copy the webhook signing secret from the CLI output to your `.env` file

### 5. Create Products & Features
```bash
# Create features and products
pnpm run create

# Or create separately:
pnpm run createf  # Create features first
pnpm run createp  # Then create products
```

### 6. Run the App
```bash
pnpm run dev
```

Visit [http://localhost:3000](http://localhost:3000)

## 🛠️ Available Scripts

**Setup:**
- `pnpm run create` - Create features and products
- `pnpm run createf` - Create Stripe features only
- `pnpm run createp` - Create Stripe products only

**Development:**
- `pnpm run dev` - Start development server
- `pnpm run build` - Build for production

**Cleanup:**
- `pnpm run clean` - Remove incomplete subscriptions, unpaid invoices, failed payments
- `pnpm run wipe` - ⚠️ **DANGER**: Completely wipe all Stripe test data (products, customers, subscriptions, everything!)

## 💳 Test the Subscription Flow

1. Enter any email address
2. Choose Silver (£3/month) or Gold (£5/month)
3. Use [any test card](https://docs.stripe.com/testing) like `4242 4242 4242 4242`
4. Any future expiry date and any 3-digit CVC

## 🔧 Subscription Tiers

**Silver Tier** - £3/month or £30/year
- Premium Server Access, Extended Limits, Priority Support, Credit Shoutout

**Gold Tier** - £5/month or £50/year
- All Silver features + AI Integration, Translation Commands, Feature Suggestions

## ⚠️ Important Notes

- **Demo only** - No real authentication, just email matching
- **Test mode** - No real payments processed
- **Local webhooks** - Must use Stripe CLI for local development
- **Cleanup scripts** - Use `clean` for minor cleanup, `wipe` to reset everything

## 🐛 Common Issues

1. **Webhooks not working**: Make sure Stripe CLI is running with `stripe listen`
2. **"Feature not found"**: Run `pnpm run createf` first
3. **Products missing**: Run `pnpm run createp` after creating features
4. **Need fresh start**: Use `pnpm run wipe` then recreate everything

## 📚 What You'll Learn

- Stripe subscription setup with entitlements
- Webhook handling for subscription events
- Feature-based access control
- Basic subscription management UI

Perfect starting point for building real subscription apps!
