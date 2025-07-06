# Stripe Subscription Demo

A simple Next.js demo showing Stripe subscriptions with feature entitlements, coupons, and promotion codes. No user authentication - just email-based customer matching for demo purposes.

## 🎯 What This Does

- Creates tiered subscription plans (Core £3/month, Plus £5/month, Ultra £10/month)
- Shows different features per tier using Stripe's entitlements system
- Handles subscriptions via Stripe Checkout with coupon/promo code support
- Demonstrates discount application with coupons and promotion codes
- Immediate access suspension on payment failures with automatic restoration
- **Discord webhook logging** for subscription events and payment monitoring
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

### 3. Set Up Discord Logging (Optional)

**For subscription event monitoring:**

1. Create a Discord server and channel for logs
2. Create a Discord bot:
   - Go to [Discord Developer Portal](https://discord.com/developers/applications)
   - Create new application → Bot → Copy bot token
   - Enable bot permissions: `Send Messages`, `Use Slash Commands`
   - Invite bot to your server with these permissions
3. Get your log channel ID:
   - Enable Developer Mode in Discord settings
   - Right-click your log channel → Copy ID

### 4. Create `.env` File
```env
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_your_key_here
STRIPE_SECRET_KEY=sk_test_your_key_here
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret_here

# Discord logging (optional)
DISCORD_BOT_TOKEN=your_bot_token_here
STRIPE_LOG_CHANNEL_ID=your_channel_id_here
DISCORD_WEBHOOK_URL=your_webhook_url_here
```

### 5. Set Up Local Webhooks

**Important**: Webhooks don't work in local development by default. You need Stripe CLI:

1. Install [Stripe CLI](https://stripe.com/docs/stripe-cli)
2. Login: `stripe login`
3. Forward webhooks to your local server:
```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```
4. Copy the webhook signing secret from the CLI output to your `.env` file

### 6. Create Products, Features & Discounts
```bash
# Create everything at once (recommended)
pnpm run create:all

# Or create individually:
pnpm run create:feat   # Create features first
pnpm run create:prod   # Then create products
pnpm run create:coup   # Create coupons
pnpm run create:promo  # Create promotion codes
pnpm run create:logs   # Create Discord webhook (optional)
```

### 7. Run the App
```bash
pnpm run dev
```

Visit [http://localhost:3000](http://localhost:3000)

## 🛠️ Available Scripts

**Setup:**
- `pnpm run create:all` - Create features, products, coupons, promotion codes, and Discord webhook
- `pnpm run create:feat` - Create Stripe features only
- `pnpm run create:prod` - Create Stripe products only
- `pnpm run create:coup` - Create Stripe coupons only
- `pnpm run create:promo` - Create Stripe promotion codes only
- `pnpm run create:logs` - Create Discord webhook for logging only

**Development:**
- `pnpm run dev` - Start development server
- `pnpm run build` - Build for production

**Cleanup:**
- `pnpm run clean` - Remove incomplete subscriptions, unpaid invoices, failed payments
- `pnpm run wipe` - ⚠️ **DANGER**: Completely wipe all Stripe test data (products, customers, subscriptions, everything!)

## 💳 Test the Subscription Flow

1. Enter any email address
2. Choose Core (£3/month), Plus (£5/month), or Ultra (£10/month)
3. Apply promotion codes if desired
4. Use [any test card](https://docs.stripe.com/testing) like `4242 4242 4242 4242`
5. Any future expiry date and any 3-digit CVC

## 🚨 Payment Failure Handling

- **Immediate lockout** on first payment failure
- **Automatic restoration** when payment succeeds
- **Suspended entitlements** preserved during suspension
- **Multiple retry attempts** handled gracefully
- **Discord notifications** for payment failures and recoveries

## 📊 Discord Logging Features

**Automatic logging for:**
- ✅ **Successful subscriptions** - Customer details, plan, billing cycle, discounts
- ❌ **Subscription cancellations** - Reason, feedback, duration, customer comments
- 🚨 **Payment failures** - Failed amount, attempt count, customer details
- 💰 **Payment recoveries** - Successful retry notifications

**Rich embed format with:**
- Customer information (name, email, ID)
- Plan details (name, billing cycle, amount)
- Cancellation insights (reason, feedback, duration)
- Discount information when applicable
- Technical references (subscription/invoice IDs)

## ⚠️ Important Notes

- **Demo only** - No real authentication, just email matching
- **Test mode** - No real payments processed
- **Local webhooks** - Must use Stripe CLI for local development
- **Discord logging** - Optional but recommended for monitoring
- **Cleanup scripts** - Use `clean` for minor cleanup, `wipe` to reset everything
- **Promotion codes** - Test various discount scenarios with provided codes

## 🐛 Common Issues

1. **Webhooks not working**: Make sure Stripe CLI is running with `stripe listen`
2. **"Feature not found"**: Run `pnpm run create:feat` first
3. **Products missing**: Run `pnpm run create:prod` after creating features
4. **Coupons not working**: Run `pnpm run create:coup` and `pnpm run create:promo`
5. **Discord logging not working**: Check bot permissions and webhook URL
6. **Need fresh start**: Use `pnpm run wipe` then `pnpm run create:all`

## 🎯 API Endpoints

- `/api/stripe/create-subscription` - Create new subscription
- `/api/stripe/products` - Fetch available products and pricing
- `/api/stripe/verify-promo` - Verify promo code is allowed for user's email
- `/api/stripe/verify-payment` - Verify payment status
- `/api/stripe/verify-subscription` - Verify subscription status
- `/api/stripe/webhooks` - Handle Stripe webhooks and Discord logging

## 🧪 Testing Scenarios

**Happy Path:**
1. Subscribe with promotion code
2. Verify discounted pricing
3. Complete payment successfully
4. Check feature access
5. Monitor Discord logs for success notification

**Payment Failure:**
1. Subscribe with failing card (`4000000000000002`)
2. Verify immediate access suspension
3. Check Discord notification for payment failure
4. Update payment method
5. Verify automatic access restoration
6. Monitor Discord logs for recovery notification

**Cancellation Testing:**
1. Create successful subscription
2. Cancel via Stripe Dashboard with reason/feedback
3. Monitor Discord logs for cancellation details
4. Verify customer feedback and duration tracking

**Discount Validation:**
1. Try expired promotion codes
2. Test usage limits
3. Verify discount calculations
4. Check recurring vs one-time discounts
5. Monitor Discord logs for discount application

## 🔧 Discord Setup Tips

- **Channel organization**: Create separate channels for different event types
- **Bot permissions**: Ensure bot has `Send Messages` and `Embed Links` permissions
- **Webhook vs Bot**: Script creates webhook automatically, but you can also use bot token directly
- **Message formatting**: Rich embeds provide better readability than plain text
- **Rate limiting**: Discord has rate limits, but normal subscription volume shouldn't hit them
