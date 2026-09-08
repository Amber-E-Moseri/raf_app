import { parseMoneyToCents, formatCents } from '../raf/reporting.js';
import { listGoalProgress } from '../goals/goals.js';

export async function buildSnapshot({ db, householdId }) {
  const now = new Date();
  const threeMonthsAgo = new Date(now);
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  const fromDate = threeMonthsAgo.toISOString().slice(0, 10);
  const toDate = now.toISOString().slice(0, 10);

  const [incomeEntries, allocationCategories, fixedBills, debts, goalProgress, surplusSplitRules] =
    await Promise.all([
      db.transaction((tx) => tx.listIncomeEntries({ householdId, from: fromDate, to: toDate })),
      db.transaction((tx) => tx.listAllocationCategories({ householdId })),
      db.transaction((tx) => tx.listFixedBills({ householdId })),
      db.transaction((tx) => tx.listDebts({ householdId })),
      listGoalProgress({ db, householdId }),
      db.transaction((tx) => tx.listSurplusSplitRules({ householdId })),
    ]);

  const totalIncomeCents = incomeEntries.reduce(
    (s, e) => s + parseMoneyToCents(e.amount ?? '0.00'),
    0,
  );
  const monthlyIncomeCents = incomeEntries.length > 0 ? Math.round(totalIncomeCents / 3) : 0;

  const activeAllocations = allocationCategories.filter((a) => a.isActive);
  const activeFixedBills = fixedBills.filter((b) => b.active !== false);
  const activeDebts = debts.filter((d) => d.isActive !== false);

  const savingsAlloc = activeAllocations.find((a) => a.slug === 'savings');
  const savingsAllocPct = savingsAlloc ? parseFloat(savingsAlloc.allocationPercent) : 0;
  const savingsAmountCents = Math.round(monthlyIncomeCents * savingsAllocPct);
  const numGoals = goalProgress.length;
  const defaultGoalContributionCents = numGoals > 0 ? Math.round(savingsAmountCents / numGoals) : 0;

  return {
    householdId,
    monthlyIncomeCents,
    monthlyIncome: formatCents(monthlyIncomeCents),
    incomeEntryCount: incomeEntries.length,
    allocations: activeAllocations.map((a) => ({
      id: a.id,
      slug: a.slug,
      label: a.label,
      allocationPercent: a.allocationPercent,
      isBuffer: !!a.isBuffer,
      isSystem: !!a.isSystem,
    })),
    fixedBills: activeFixedBills.map((b) => ({
      id: b.id,
      name: b.name,
      expectedAmountCents: parseMoneyToCents(b.expected_amount ?? b.expectedAmount ?? '0.00'),
      expectedAmount: b.expected_amount ?? b.expectedAmount ?? '0.00',
    })),
    debts: activeDebts.map((d) => ({
      id: d.id,
      name: d.name,
      currentBalanceCents: parseMoneyToCents(d.currentBalance ?? '0.00'),
      minimumPaymentCents: parseMoneyToCents(d.minimumPayment ?? '0.00'),
      aprPct: parseFloat(d.apr ?? '0'),
    })),
    goals: goalProgress.map((g) => ({
      id: g.goal_id,
      name: g.goal_name,
      targetAmountCents: parseMoneyToCents(g.target_amount ?? '0.00'),
      reservedAmountCents: parseMoneyToCents(g.reserved_amount ?? '0.00'),
      monthlyContributionCents: defaultGoalContributionCents,
    })),
    surplusSplitRules,
  };
}
