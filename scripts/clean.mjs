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
      let canceledCount = 0;
      let voidedInvoiceCount = 0;

      for (const paymentIntent of incompletePaymentIntents) {
        try {
          // Try to cancel the payment intent first
          await stripe.paymentIntents.cancel(paymentIntent.id);
          console.log(`✅ Canceled payment intent: ${paymentIntent.id}`);
          canceledCount++;

        } catch (error) {
          // If it's an invoice-related payment intent, find and void the invoice
          if (error.message?.includes('cannot cancel PaymentIntents created by invoices')) {
            console.log(`🔍 Finding invoice for payment intent: ${paymentIntent.id}`);

            try {
              // Find the invoice associated with this payment intent
              const invoices = await stripe.invoices.list({
                customer: paymentIntent.customer,
                limit: 100,
              });
              console.log("invoices", invoices);

              // Look for the invoice that matches this payment intent
              const associatedInvoice = invoices.data.find(invoice =>
                invoice.payment_intent === paymentIntent.id
              );

              if (associatedInvoice) {
                // Check if invoice can be voided (must be 'open' status)
                if (associatedInvoice.status === 'open') {
                  await stripe.invoices.voidInvoice(associatedInvoice.id);
                  console.log(`✅ Voided associated invoice: ${associatedInvoice.id} for payment intent: ${paymentIntent.id}`);
                  voidedInvoiceCount++;
                } else {
                  console.log(`⏭️  Invoice ${associatedInvoice.id} status is '${associatedInvoice.status}', cannot void`);
                }
              } else {
                console.log(`⚠️  Could not find associated invoice for payment intent: ${paymentIntent.id}`);
              }

            } catch (invoiceError) {
              console.log(`⚠️  Error handling invoice for payment intent ${paymentIntent.id}: ${invoiceError.message}`);
            }
          } else {
            // Log other unexpected errors but continue
            console.log(`⚠️  Could not cancel payment intent ${paymentIntent.id}: ${error.message}`);
          }
        }
      }

      console.log(`🎉 Payment intents cleanup completed!`);
    } else {
      console.log('✅ No incomplete payment intents found');
    }
    console.log("Logging out of Stripe...");
  } catch (error) {
    console.error('Error:', error);
  }
}

cancelStripeTests();
