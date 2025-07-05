import dotenv from 'dotenv'
import Stripe from 'stripe'

dotenv.config()

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

async function cancelStripeTests() {
  try {
    // Verify API key is loaded
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error('STRIPE_SECRET_KEY not found in environment variables');
    }

    // Incomplete subscriptions
    console.log('🔍 Searching for incomplete subscriptions...');
    const subscriptions = await stripe.subscriptions.list({
      status: 'incomplete',
      limit: 100,
    });
    if (subscriptions.data.length > 0) {
      for (const subscription of subscriptions.data) {
        await stripe.subscriptions.cancel(subscription.id);
        console.log(`✅ Canceled subscription: ${subscription.id}`);
      }
      console.log(`🎉 All ${subscriptions.data.length} incomplete subscriptions canceled!`);
    }

    // unpaid invoices
    console.log('🔍 Searching for unpaid invoices...');
    const invoices = await stripe.invoices.list({
      status: 'open',
      limit: 100,
    });
    if (invoices.data.length > 0) {
      for (const invoice of invoices.data) {
        await stripe.invoices.voidInvoice(invoice.id);
        console.log(`✅ Voided invoice: ${invoice.id}`);
      }
      console.log(`🎉 All ${invoices.data.length} unpaid invoices voided!`);
    }

    //incomplete payments
    const paymentIntents = await stripe.paymentIntents.list({
      limit: 100,
    });
    const incompletePaymentIntents = paymentIntents.data.filter(
      pi => pi.status === 'requires_payment_method'
    );

    if (incompletePaymentIntents.length > 0) {
      for (const paymentIntent of incompletePaymentIntents) {
        await stripe.paymentIntents.cancel(paymentIntent.id);
        console.log(`✅ Canceled payment intent: ${paymentIntent.id}`);
      }
      console.log(`🎉 All ${incompletePaymentIntents.length} incomplete payments canceled!`);
    }
    console.log("Logging out of Stripe...");
  } catch (error) {
    console.error('Error:', error);
  }
}

cancelStripeTests();
