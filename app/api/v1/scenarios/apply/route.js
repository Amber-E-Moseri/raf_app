import { json, getDb, getHouseholdId } from '../../_shared/http.js';
import { buildSnapshot } from '../../../../../lib/scenarios/snapshot.js';
import { buildChangeSet, applyScenario, compute } from '../../../../../lib/scenarios/engine.js';
import { parseMoneyToCents, formatCents } from '../../../../../lib/raf/reporting.js';

export async function POST(request, context) {
  const db = getDb(context);
  const householdId = getHouseholdId(request, context);
  const body = await request.json();
  const { scenario, confirmed } = body ?? {};

  if (!scenario?.type) {
    return json({ error: 'scenario.type is required' }, 400);
  }

  const snapshot = await buildSnapshot({ db, householdId });
  const changeSet = buildChangeSet(snapshot, scenario);

  if (!confirmed) {
    return json({ changeSet, requiresConfirmation: true });
  }

  const applied = [];
  const errors = [];

  for (const change of changeSet) {
    try {
      await executeChange({ db, householdId, change, scenario, snapshot });
      applied.push(change);
    } catch (err) {
      errors.push({ change, error: err.message });
    }
  }

  const updatedSnapshot = await buildSnapshot({ db, householdId });
  const updatedMetrics = compute(updatedSnapshot);

  return json({
    applied,
    errors,
    changeCount: applied.length,
    metrics: stripCents(updatedMetrics),
  });
}

async function executeChange({ db, householdId, change, scenario, snapshot }) {
  switch (change.resource) {
    case 'debt': {
      const paymentCents = parseMoneyToCents(change.to);
      await db.transaction((tx) =>
        tx.updateDebt({
          householdId,
          debtId: change.id,
          patch: { minimumPayment: formatCents(paymentCents) },
        }),
      );
      break;
    }

    case 'fixedBill': {
      if (change.id) {
        const amountCents = parseMoneyToCents(change.to);
        await db.transaction((tx) =>
          tx.updateFixedBill({
            householdId,
            fixedBillId: change.id,
            patch: { expected_amount: formatCents(amountCents) },
          }),
        );
      } else {
        const amountCents = parseMoneyToCents(change.to);
        await db.transaction((tx) =>
          tx.insertFixedBill({
            householdId,
            name: change.label,
            expected_amount: formatCents(amountCents),
            active: true,
          }),
        );
      }
      break;
    }

    case 'allocation': {
      const currentCategories = await db.transaction((tx) =>
        tx.listAllocationCategories({ householdId }),
      );
      const updated = currentCategories
        .filter((c) => c.isActive)
        .map((c) => {
          if (c.id === change.id) return { ...c, allocationPercent: change.to };
          return c;
        });
      const today = new Date().toISOString().slice(0, 10);
      await db.transaction((tx) =>
        tx.replaceAllocationCategories({ householdId, items: updated, effectiveFrom: today }),
      );
      break;
    }

    case 'note':
      break;

    default:
      throw new Error(`Unknown resource type: ${change.resource}`);
  }
}

function stripCents(metrics) {
  const { _cents, ...rest } = metrics;
  return rest;
}
