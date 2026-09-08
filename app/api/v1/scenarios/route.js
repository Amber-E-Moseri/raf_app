import { json, getDb, getHouseholdId } from '../_shared/http.js';
import { buildSnapshot } from '../../../../lib/scenarios/snapshot.js';
import { compute, applyScenario } from '../../../../lib/scenarios/engine.js';

export async function POST(request, context) {
  const db = getDb(context);
  const householdId = getHouseholdId(request, context);
  const body = await request.json();
  const { scenario } = body ?? {};

  if (!scenario?.type) {
    return json({ error: 'scenario.type is required' }, 400);
  }

  const snapshot = await buildSnapshot({ db, householdId });
  const current = compute(snapshot);
  const scenarioSnapshot = applyScenario(snapshot, scenario);
  const scenarioMetrics = compute(scenarioSnapshot);

  const delta = {
    monthlyIncome: diff(current._cents.monthlyIncome, scenarioMetrics._cents.monthlyIncome),
    surplus: diff(current._cents.surplus, scenarioMetrics._cents.surplus),
    bufferAmount: diff(current._cents.buffer, scenarioMetrics._cents.buffer),
    monthlyFlexibility: diff(current._cents.monthlyFlexibility, scenarioMetrics._cents.monthlyFlexibility),
    maxDebtPayoffMonths: scenarioMetrics.maxDebtPayoffMonths - current.maxDebtPayoffMonths,
  };

  return json({
    current: stripCents(current),
    scenario: stripCents(scenarioMetrics),
    delta,
    snapshot: {
      monthlyIncome: snapshot.monthlyIncome,
      incomeEntryCount: snapshot.incomeEntryCount,
      debtCount: snapshot.debts.length,
      goalCount: snapshot.goals.length,
      fixedBillCount: snapshot.fixedBills.length,
    },
  });
}

function diff(currentCents, scenarioCents) {
  const deltaCents = scenarioCents - currentCents;
  const sign = deltaCents >= 0 ? '+' : '-';
  const abs = Math.abs(deltaCents);
  const dollars = Math.floor(abs / 100);
  const cents = String(abs % 100).padStart(2, '0');
  return { cents: deltaCents, formatted: `${sign}$${dollars}.${cents}` };
}

function stripCents(metrics) {
  const { _cents, ...rest } = metrics;
  return rest;
}
