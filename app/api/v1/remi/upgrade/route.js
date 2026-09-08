import { json, getDb } from '../../_shared/http.js';

// Billing is managed exclusively via the Stripe webhook at /api/v1/billing/webhook.
// This endpoint is intentionally disabled to prevent self-promotion to paid tier.
export async function PATCH(_request, _context) {
  return json({ error: 'Billing management is not available through this endpoint. Subscription changes are processed via Stripe.' }, 501);
}

export async function GET(request, context) {
  const db = getDb(context);
  const userId = context?.userId ?? 'local-user';
  const user = await db.transaction((tx) => tx.getUserById({ userId }));
  return json({ userId, remiTier: user?.remiTier ?? 'free' });
}
