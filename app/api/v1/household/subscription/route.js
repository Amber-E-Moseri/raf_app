import { z } from 'zod';

import { getDb, getHouseholdId, json, buildErrorBody } from '../../_shared/http.js';

const updateSubscriptionSchema = z.object({
  tier: z.enum(['free', 'paid']),
  expiresAt: z.string().nullable().optional(),
});

export async function GET(request, context = {}) {
  try {
    const db = getDb(context);
    const householdId = getHouseholdId(request, context);

    const status = await db.transaction(async (tx) => {
      return await tx.getPdfImportQuotaStatus({ householdId });
    });

    return json({
      tier: status.tier,
      remaining: status.remaining,
      canImport: status.canImport,
      reason: status.reason,
    });
  } catch (error) {
    return json(buildErrorBody({ status: 500, message: 'Internal Server Error' }), 500);
  }
}

export async function PATCH(request, context = {}) {
  try {
    const db = getDb(context);
    const householdId = getHouseholdId(request, context);

    const body = await request.json();
    const parsed = updateSubscriptionSchema.safeParse(body);

    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return json(
        buildErrorBody({
          status: 400,
          message: `${issue.path.join('.')} ${issue.message}`,
        }),
        400,
      );
    }

    const household = await db.transaction(async (tx) => {
      return await tx.updateHouseholdPdfQuotaTier({
        householdId,
        tier: parsed.data.tier,
        expiresAt: parsed.data.expiresAt,
      });
    });

    return json({
      tier: household.pdfImportQuotaTier,
      expiresAt: household.pdfImportQuotaExpiresAt,
      message: `Subscription updated to ${parsed.data.tier}`,
    });
  } catch {
    return json(buildErrorBody({ status: 500, message: 'Internal Server Error' }), 500);
  }
}
