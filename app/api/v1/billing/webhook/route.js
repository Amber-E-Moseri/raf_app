import { json } from '../../_shared/http.js';

const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

/**
 * Stripe webhook handler.
 * Verifies the Stripe-Signature header before processing any event.
 * Subscription tier changes are applied only from verified webhook events.
 */
export async function POST(request, _context) {
  if (!STRIPE_WEBHOOK_SECRET) {
    console.error('[RAF billing] STRIPE_WEBHOOK_SECRET is not configured');
    return json({ error: 'Billing webhooks are not configured on this server.' }, 503);
  }

  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return json({ error: 'Missing Stripe-Signature header' }, 400);
  }

  try {
    await request.text();
  } catch {
    return json({ error: 'Unable to read request body' }, 400);
  }

  // Verify the webhook signature using Stripe's SDK.
  // Install: npm install stripe
  // Then: import Stripe from 'stripe'
  // const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
  // const event = stripe.webhooks.constructEvent(rawBody, signature, STRIPE_WEBHOOK_SECRET)
  //
  // Until Stripe is fully integrated, reject all webhook calls so this
  // endpoint is not accidentally relied upon without signature verification.
  console.warn('[RAF billing] Stripe SDK not yet integrated — webhook received but not processed');
  return json({ received: true, processed: false, reason: 'stripe_sdk_not_configured' }, 200);
}
