import test from 'node:test';
import assert from 'node:assert/strict';

import { POST as postPaceAcknowledgement } from '../app/api/v1/debts/[id]/pace-acknowledgement/route.js';
import { createDebt, listDebts } from '../lib/debts/debts.js';
import {
  buildDebtPaymentInsight,
  classifyPaymentPace,
  deriveBalanceTrajectory,
  deriveDebtSnapshot,
  derivePaymentObligation,
  estimateDebtPayoff,
  explainBalanceChange,
  getCompletedPaymentPeriods,
} from '../lib/raf/debts.js';
import { createInMemoryDb } from '../lib/server/inMemoryDb.js';

function jsonRequest(body) {
  return new Request('http://localhost/api/v1/test', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-household-id': 'household_1' },
    body: JSON.stringify(body),
  });
}

test('classifyPaymentPace assigns all pace states with five-percent or five-dollar tolerance', () => {
  const base = {
    minimumPaymentCents: 10000,
    monthlyPaymentCents: 30000,
    isPaymentDue: true,
  };

  assert.equal(classifyPaymentPace({ ...base, actualPaymentCents: 0 }).pace, 'no_payment');
  assert.equal(classifyPaymentPace({ ...base, actualPaymentCents: 5000 }).pace, 'under_minimum');
  assert.equal(classifyPaymentPace({ ...base, actualPaymentCents: 10000 }).pace, 'minimum_only');
  assert.equal(classifyPaymentPace({ ...base, actualPaymentCents: 25000 }).pace, 'below_plan');
  assert.equal(classifyPaymentPace({ ...base, actualPaymentCents: 28500 }).pace, 'on_plan');
  assert.equal(classifyPaymentPace({ ...base, actualPaymentCents: 31500 }).pace, 'on_plan');
  assert.equal(classifyPaymentPace({ ...base, actualPaymentCents: 32000 }).pace, 'above_plan');

  const smallPlan = classifyPaymentPace({
    actualPaymentCents: 5600,
    minimumPaymentCents: 2500,
    monthlyPaymentCents: 5000,
    isPaymentDue: true,
  });
  assert.equal(smallPlan.upperBound, 5500);
  assert.equal(smallPlan.pace, 'above_plan');
});

test('buildDebtPaymentInsight returns null for non-actionable pace and never mutates the planned debt', () => {
  const debt = {
    id: 'debt_1',
    name: 'Card',
    startingBalance: '5000.00',
    apr: 19.99,
    minimumPayment: '100.00',
    monthlyPayment: '300.00',
    isActive: true,
  };
  const before = { ...debt };
  const onPlan = classifyPaymentPace({
    actualPaymentCents: 30000,
    minimumPaymentCents: 10000,
    monthlyPaymentCents: 30000,
    isPaymentDue: true,
  });

  assert.equal(buildDebtPaymentInsight({
    debt,
    classifiedPace: onPlan,
    actionablePaymentPeriod: '2026-03',
    currentBalance: '5000.00',
  }), null);
  assert.deepEqual(debt, before);

  const abovePlan = classifyPaymentPace({
    actualPaymentCents: 50000,
    minimumPaymentCents: 10000,
    monthlyPaymentCents: 30000,
    isPaymentDue: true,
  });
  const insight = buildDebtPaymentInsight({
    debt,
    classifiedPace: abovePlan,
    actionablePaymentPeriod: '2026-03',
    currentBalance: '5000.00',
    observedMonthlyPaymentCents: 50000,
    observedBasis: 'this_month',
  });

  assert.equal(insight.type, 'above_plan_payment');
  assert.equal(insight.actualPayment, '500.00');
  assert.equal(insight.plannedPayment, '300.00');
  assert.equal(insight.suggestedRecurringPayment, '500.00');
  assert.equal(debt.monthlyPayment, '300.00');
});

test('completed payment periods exclude the active incomplete month and use latest periods first', () => {
  const periods = getCompletedPaymentPeriods([
    { paymentDate: '2026-01-10', amount: '100.00' },
    { paymentDate: '2026-02-10', amount: '150.00' },
    { paymentDate: '2026-02-20', amount: '50.00' },
    { paymentDate: '2026-03-05', amount: '500.00' },
  ], 3, '2026-03-01');

  assert.deepEqual(periods, [
    { paymentPeriodMonth: '2026-02', amount: '200.00', amountCents: 20000 },
    { paymentPeriodMonth: '2026-01', amount: '100.00', amountCents: 10000 },
  ]);
});

test('observed projection can improve payoff without changing planned projection input', () => {
  const debt = {
    id: 'debt_1',
    startingBalance: '5000.00',
    currentBalance: '5000.00',
    apr: 12,
    minimumPayment: '100.00',
    monthlyPayment: '300.00',
  };

  const planned = estimateDebtPayoff(debt, '5000.00');
  const observed = estimateDebtPayoff({ ...debt, monthlyPayment: '500.00' }, '5000.00');

  assert.equal(debt.monthlyPayment, '300.00');
  assert.ok(observed.monthsRemaining < planned.monthsRemaining);
});

test('listDebts surfaces above-plan pace and acknowledgement POST can update plan explicitly', async () => {
  const db = createInMemoryDb();
  const debt = await createDebt({
    db,
    householdId: 'household_1',
    input: {
      name: 'Visa',
      startingBalance: '5000.00',
      apr: '12.00',
      minimumPayment: '100.00',
      monthlyPayment: '300.00',
      paymentDueDay: 15,
    },
  });

  db.state.debtPayments.push({
    id: 'payment_1',
    householdId: 'household_1',
    debtId: debt.id,
    paymentDate: '2026-03-20',
    amount: '500.00',
    createdAt: '2026-03-20T00:00:00.000Z',
  });

  const before = await listDebts({ db, householdId: 'household_1' });
  assert.equal(before.items[0].monthlyPayment, '300.00');
  assert.equal(before.items[0].paymentPace.pace, 'above_plan');
  assert.equal(before.items[0].paymentInsight.type, 'above_plan_payment');

  const response = await postPaceAcknowledgement(
    jsonRequest({
      action: 'update_plan',
      paymentPeriodMonth: '2026-03',
      newMonthlyPayment: '500.00',
    }),
    { db, householdId: 'household_1', params: { id: debt.id } },
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.acknowledged, true);
  assert.equal(body.debt.monthlyPayment, '500.00');
  assert.equal(body.debt.insightAcknowledged, true);

  const after = await listDebts({ db, householdId: 'household_1' });
  assert.equal(after.items[0].monthlyPayment, '500.00');
  assert.equal(after.items[0].paymentPace.pace, 'on_plan');
  assert.equal(after.items[0].paymentInsight, null);
});

// --- classifyPaymentPace boundaries (Phase 7 clarification; Phase 2 table superseded) ---

test('classifyPaymentPace treats exactly the minimum as minimum_only and one cent more as below_plan', () => {
  const base = { minimumPaymentCents: 10000, monthlyPaymentCents: 30000, isPaymentDue: true };
  assert.equal(classifyPaymentPace({ ...base, actualPaymentCents: 10000 }).pace, 'minimum_only');
  assert.equal(classifyPaymentPace({ ...base, actualPaymentCents: 10001 }).pace, 'below_plan');
});

test('classifyPaymentPace: paying the minimum when it already sits inside the on-plan band reads as on_plan', () => {
  // plan 10000, tolerance = max(500, 500) = 500 -> lowerBound 9500; minimum 9600 is inside the band.
  const pace = classifyPaymentPace({
    actualPaymentCents: 9600,
    minimumPaymentCents: 9600,
    monthlyPaymentCents: 10000,
    isPaymentDue: true,
  });
  assert.equal(pace.pace, 'on_plan');
});

test('classifyPaymentPace: a sub-minimum payment before the due date is not under_minimum', () => {
  const pace = classifyPaymentPace({
    actualPaymentCents: 5000,
    minimumPaymentCents: 10000,
    monthlyPaymentCents: 30000,
    isPaymentDue: false,
  });
  assert.equal(pace.pace, 'below_plan');
});

// --- buildDebtPaymentInsight: projection suppression + savings gate (D1, D3) ---

const projectionDebt = {
  id: 'debt_p',
  name: 'Card',
  startingBalance: '5000.00',
  apr: 19.99,
  minimumPayment: '100.00',
  monthlyPayment: '300.00',
  isActive: true,
};

function abovePlanPace(actualPaymentCents) {
  return classifyPaymentPace({
    actualPaymentCents,
    minimumPaymentCents: 10000,
    monthlyPaymentCents: 30000,
    isPaymentDue: true,
  });
}

test('buildDebtPaymentInsight omits projections when the only basis is the incomplete current month', () => {
  const insight = buildDebtPaymentInsight({
    debt: projectionDebt,
    classifiedPace: abovePlanPace(50000),
    actionablePaymentPeriod: '2026-03',
    currentBalance: '5000.00',
    observedMonthlyPaymentCents: 50000,
    observedBasis: 'this_month',
  });
  assert.equal(insight.type, 'above_plan_payment');
  assert.equal(insight.projections, undefined);
});

test('buildDebtPaymentInsight keeps projections once a completed period backs the observed pace', () => {
  const insight = buildDebtPaymentInsight({
    debt: projectionDebt,
    classifiedPace: abovePlanPace(50000),
    actionablePaymentPeriod: '2026-03',
    currentBalance: '5000.00',
    observedMonthlyPaymentCents: 50000,
    observedBasis: 'latest_completed_month',
  });
  assert.ok(insight.projections);
  assert.ok(insight.projections.planned);
  assert.ok(insight.projections.observed);
});

test('buildDebtPaymentInsight hides immaterial savings but reports material ones (Phase 5 gate)', () => {
  const trivial = buildDebtPaymentInsight({
    debt: { ...projectionDebt, apr: 0, startingBalance: '1000.00', monthlyPayment: '500.00' },
    classifiedPace: classifyPaymentPace({
      actualPaymentCents: 55000,
      minimumPaymentCents: 10000,
      monthlyPaymentCents: 50000,
      isPaymentDue: true,
    }),
    actionablePaymentPeriod: '2026-03',
    currentBalance: '1000.00',
    observedMonthlyPaymentCents: 55000,
    observedBasis: 'latest_completed_month',
  });
  assert.ok(trivial.projections);
  assert.equal(trivial.projections.acceleratedMonths, undefined);
  assert.equal(trivial.projections.interestSaved, undefined);

  const material = buildDebtPaymentInsight({
    debt: { ...projectionDebt, apr: 24, startingBalance: '5000.00', monthlyPayment: '150.00' },
    classifiedPace: classifyPaymentPace({
      actualPaymentCents: 100000,
      minimumPaymentCents: 10000,
      monthlyPaymentCents: 15000,
      isPaymentDue: true,
    }),
    actionablePaymentPeriod: '2026-03',
    currentBalance: '5000.00',
    observedMonthlyPaymentCents: 100000,
    observedBasis: 'latest_completed_month',
  });
  assert.ok(material.projections.acceleratedMonths > 1);
  assert.ok(Number(material.projections.interestSaved) > 50);
});

// --- below_plan_warning (payment-pace dimension only) ---

test('buildDebtPaymentInsight emits below_plan_warning only when well below plan and the obligation is closed', () => {
  const wellBelow = classifyPaymentPace({
    actualPaymentCents: 12000,
    minimumPaymentCents: 10000,
    monthlyPaymentCents: 30000,
    isPaymentDue: true,
  });
  assert.equal(wellBelow.pace, 'below_plan');

  const closed = buildDebtPaymentInsight({
    debt: projectionDebt,
    classifiedPace: wellBelow,
    actionablePaymentPeriod: '2026-03',
    currentBalance: '5000.00',
    observedMonthlyPaymentCents: 12000,
    observedBasis: 'latest_completed_month',
    currentObligationOpen: false,
  });
  assert.equal(closed.type, 'below_plan_warning');
  assert.equal(closed.reason, 'well_below_plan');
  assert.equal(closed.amountBelowPlan, '180.00');
  assert.equal(closed.suggestedRecurringPayment, undefined);

  const stillOpen = buildDebtPaymentInsight({
    debt: projectionDebt,
    classifiedPace: wellBelow,
    actionablePaymentPeriod: '2026-03',
    currentBalance: '5000.00',
    observedMonthlyPaymentCents: 12000,
    observedBasis: 'latest_completed_month',
    currentObligationOpen: true,
  });
  assert.equal(stillOpen, null);
});

test('below_plan_warning projections carry a negative acceleratedMonths when payoff slips later', () => {
  const insight = buildDebtPaymentInsight({
    debt: { ...projectionDebt, apr: 24, startingBalance: '5000.00', monthlyPayment: '500.00' },
    classifiedPace: classifyPaymentPace({
      actualPaymentCents: 20000,
      minimumPaymentCents: 10000,
      monthlyPaymentCents: 50000,
      isPaymentDue: true,
    }),
    actionablePaymentPeriod: '2026-03',
    currentBalance: '5000.00',
    observedMonthlyPaymentCents: 20000,
    observedBasis: 'latest_completed_month',
    currentObligationOpen: false,
  });
  assert.equal(insight.type, 'below_plan_warning');
  assert.ok(insight.projections.acceleratedMonths < 0);
  assert.ok(Number(insight.projections.interestSaved) < 0);
});

// --- derivePaymentObligation status ladder (D6) ---

const obligationDebt = {
  id: 'debt_o',
  name: 'Card',
  startingBalance: '5000.00',
  minimumPayment: '200.00',
  monthlyPayment: '400.00',
  apr: '19.99',
  statementDay: 15,
  paymentDueDay: 25,
};

test('derivePaymentObligation: zero payment before the due date is pending, not missed', () => {
  const obligation = derivePaymentObligation({
    debt: obligationDebt,
    payments: [],
    obligationMonth: '2026-09',
    asOfDate: '2026-09-10',
  });
  assert.equal(obligation.status, 'pending');
});

test('derivePaymentObligation: reaching the planned amount is satisfied', () => {
  const obligation = derivePaymentObligation({
    debt: obligationDebt,
    payments: [
      { paymentDate: '2026-09-05', amount: '150.00' },
      { paymentDate: '2026-09-18', amount: '250.00' },
    ],
    obligationMonth: '2026-09',
    asOfDate: '2026-09-19',
  });
  assert.equal(obligation.totalPaidToDate, '400.00');
  assert.equal(obligation.status, 'satisfied');
  assert.equal(obligation.planSatisfied, true);
});

// --- deriveBalanceTrajectory.warning + explainBalanceChange.newActivity (D13) ---

test('deriveBalanceTrajectory flags a growing balance with warning === true', () => {
  assert.equal(deriveBalanceTrajectory({ openingBalanceCents: 500000, closingBalanceCents: 550000 }).warning, true);
  assert.equal(deriveBalanceTrajectory({ openingBalanceCents: 500000, closingBalanceCents: 450000 }).warning, false);
});

test('explainBalanceChange surfaces new charges or borrowing as newActivity', () => {
  const explanation = explainBalanceChange({
    openingBalanceCents: 500000,
    closingBalanceCents: 520000,
    paymentsThisPeriodCents: 0,
    interestChargedCents: 0,
    feesChargedCents: 0,
    adjustmentsCents: 20000,
  });
  assert.equal(explanation.newActivity, '200.00');
  assert.match(explanation.changeMessage, /new charges or borrowing/);
});

// --- deriveDebtSnapshot: independent dimensions coexist (invariants 1, 4, 5) ---

test('deriveDebtSnapshot carries obligation, trajectory and explanation as independent fields', () => {
  const snapshot = deriveDebtSnapshot(
    {
      id: 'debt_s',
      name: 'Card',
      startingBalance: '5000.00',
      apr: 0,
      minimumPayment: '100.00',
      monthlyPayment: '250.00',
      statementDay: 5,
      paymentDueDay: 15,
      isActive: true,
    },
    [{ paymentDate: '2026-03-10', amount: '300.00' }],
    [{ adjustmentType: 'interest', amount: '400.00', effectiveDate: '2026-03-12', generated: false }],
    '2026-03-01',
  );

  assert.equal(snapshot.paymentPace.pace, 'above_plan');
  assert.equal(snapshot.balanceTrajectory.trajectory, 'increasing');
  assert.equal(snapshot.balanceTrajectory.warning, true);
  assert.ok(snapshot.balanceExplanation);
  assert.ok(snapshot.paymentObligation);
  assert.equal(snapshot.paymentInsight.type, 'above_plan_payment');
});

test('deriveDebtSnapshot uses the most recent completed month (not the 2-month mean) as the observed pace', () => {
  const snapshot = deriveDebtSnapshot(
    {
      id: 'debt_d2',
      name: 'Card',
      startingBalance: '8000.00',
      apr: 12,
      minimumPayment: '100.00',
      monthlyPayment: '300.00',
      paymentDueDay: 15,
      isActive: true,
    },
    [
      { paymentDate: '2026-01-10', amount: '100.00' },
      { paymentDate: '2026-02-10', amount: '400.00' },
      { paymentDate: '2026-03-10', amount: '600.00' },
    ],
    [],
    '2026-03-01',
  );

  assert.equal(snapshot.paymentInsight.type, 'above_plan_payment');
  assert.equal(snapshot.paymentInsight.projections.observedBasis, 'latest_completed_month');
  // Most recent completed month (Feb) is $400 — not the Jan/Feb mean of $250.
  assert.equal(snapshot.paymentInsight.suggestedRecurringPayment, '400.00');
});

test('deriveDebtSnapshot does not warn about a sub-plan payment while the obligation is still open', () => {
  const snapshot = deriveDebtSnapshot(
    {
      id: 'debt_open',
      name: 'Card',
      startingBalance: '5000.00',
      apr: 12,
      minimumPayment: '100.00',
      monthlyPayment: '300.00',
      paymentDueDay: 25,
      isActive: true,
    },
    [{ paymentDate: '2026-03-05', amount: '120.00' }],
    [],
    '2026-03-01',
  );
  // Past month: as-of date is month end, which is after the 25th, so the obligation is closed.
  assert.equal(snapshot.paymentPace.pace, 'below_plan');
  assert.equal(snapshot.paymentInsight.type, 'below_plan_warning');
});

// --- acknowledgement side effects (audit + no plan mutation) ---

test('update_plan writes a debt.updated audit event; keep_plan and one-time do not touch the plan', async () => {
  const db = createInMemoryDb();
  const debt = await createDebt({
    db,
    householdId: 'household_1',
    input: {
      name: 'Visa',
      startingBalance: '5000.00',
      apr: '12.00',
      minimumPayment: '100.00',
      monthlyPayment: '300.00',
      paymentDueDay: 15,
    },
  });
  db.state.debtPayments.push({
    id: 'payment_a',
    householdId: 'household_1',
    debtId: debt.id,
    paymentDate: '2026-03-20',
    amount: '500.00',
    createdAt: '2026-03-20T00:00:00.000Z',
  });

  const keep = await postPaceAcknowledgement(
    jsonRequest({ action: 'keep_plan', paymentPeriodMonth: '2026-03' }),
    { db, householdId: 'household_1', userId: 'user_1', params: { id: debt.id } },
  );
  assert.equal(keep.status, 200);
  const keepBody = await keep.json();
  assert.equal(keepBody.debt.monthlyPayment, '300.00');
  assert.equal(keepBody.debt.insightAcknowledged, true);
  assert.equal(db.state.workspaceActivity.length, 0);

  const updated = await postPaceAcknowledgement(
    jsonRequest({ action: 'update_plan', paymentPeriodMonth: '2026-04', newMonthlyPayment: '500.00' }),
    { db, householdId: 'household_1', userId: 'user_1', params: { id: debt.id } },
  );
  assert.equal(updated.status, 200);
  assert.equal(
    db.state.workspaceActivity.some((row) => row.action === 'debt.updated' && row.entityId === debt.id),
    true,
  );
});

test('acknowledgeDebtPaymentPace rejects update_plan without a new amount', async () => {
  const db = createInMemoryDb();
  const debt = await createDebt({
    db,
    householdId: 'household_1',
    input: {
      name: 'Visa',
      startingBalance: '5000.00',
      apr: '12.00',
      minimumPayment: '100.00',
      monthlyPayment: '300.00',
    },
  });

  const response = await postPaceAcknowledgement(
    jsonRequest({ action: 'update_plan', paymentPeriodMonth: '2026-03' }),
    { db, householdId: 'household_1', userId: 'user_1', params: { id: debt.id } },
  );
  assert.equal(response.status, 400);
});
