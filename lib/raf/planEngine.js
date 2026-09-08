import { formatCents, parseMoneyToCents, parseFractionToBps, sortBySortOrderSlugId } from './reporting.js';
import { DEBT_RATIO_RISKY, DEBT_RATIO_ELEVATED } from './constants.js';

const FRACTION_SCALE = 10000;

// ── Priority levels (lower number = higher priority = more protected) ────────

export const AllocationPriority = Object.freeze({
  GIVING: 1,
  OBLIGATIONS: 2,
  ESSENTIALS: 3,
  SAVINGS_FLOOR: 4,
  GOALS: 5,
  ACCELERATED_DEBT: 6,
  ACCELERATED_SAVINGS: 7,
  FLEXIBLE_SPENDING: 8,
  SURPLUS: 9,
});

// Default slug → priority mapping; override per-household via priorityOverrides
const DEFAULT_SLUG_PRIORITIES = {
  tithe: AllocationPriority.GIVING,
  offerings: AllocationPriority.GIVING,
  partnership: AllocationPriority.GIVING,
  fixed_bills: AllocationPriority.OBLIGATIONS,
  savings: AllocationPriority.SAVINGS_FLOOR,
  buffer: AllocationPriority.SAVINGS_FLOOR,
  debt_payoff: AllocationPriority.ACCELERATED_DEBT,
  investment: AllocationPriority.ACCELERATED_SAVINGS,
  personal_spending: AllocationPriority.FLEXIBLE_SPENDING,
};

// Categories at these priorities may never appear as adjustment candidates.
const PROTECTED_PRIORITY_THRESHOLD = AllocationPriority.OBLIGATIONS;

function resolvePriority(category, priorityOverrides) {
  if (priorityOverrides && priorityOverrides[category.slug] != null) {
    return priorityOverrides[category.slug];
  }
  return DEFAULT_SLUG_PRIORITIES[category.slug] ?? AllocationPriority.FLEXIBLE_SPENDING;
}

// ── Income lifecycle helpers ─────────────────────────────────────────────────

/**
 * Derives an income stream status from expected vs received amounts.
 * @param {number} expectedCents
 * @param {number} receivedCents
 * @returns {'pending'|'partial'|'met'|'exceeded'}
 */
function incomeStreamStatus(expectedCents, receivedCents) {
  if (receivedCents === 0) return 'pending';
  if (receivedCents >= expectedCents) return receivedCents > expectedCents ? 'exceeded' : 'met';
  return 'partial';
}

// ── Surplus distribution helpers ─────────────────────────────────────────────

function distributeSurplus(surplusCents, activeRules) {
  if (activeRules.length === 0 || surplusCents <= 0) return [];

  let assignedCents = 0;
  const distributions = activeRules.map((rule) => {
    const bps = parseFractionToBps(rule.splitPercent);
    const cents = Math.floor((surplusCents * bps) / FRACTION_SCALE);
    assignedCents += cents;
    return { slug: rule.slug, label: rule.label ?? rule.slug, splitPercent: rule.splitPercent, amount: formatCents(cents) };
  });

  // Remainder always goes to emergency_fund slug
  const remainderCents = surplusCents - assignedCents;
  if (remainderCents !== 0) {
    const emergencyEntry = distributions.find((d) => d.slug === 'emergency_fund');
    if (emergencyEntry) {
      emergencyEntry.amount = formatCents(parseMoneyToCents(emergencyEntry.amount) + remainderCents);
    } else if (distributions.length > 0) {
      distributions[0].amount = formatCents(parseMoneyToCents(distributions[0].amount) + remainderCents);
    }
  }

  return distributions;
}

// ── Per-category spending analysis ──────────────────────────────────────────

function buildCategorySpending(activeCategories, incomeAllocations, transactions) {
  const allocatedCentsByCatId = new Map(activeCategories.map((c) => [c.id, 0]));
  const spentCentsByCatId = new Map(activeCategories.map((c) => [c.id, 0]));
  const addedCentsByCatId = new Map(activeCategories.map((c) => [c.id, 0]));

  for (const alloc of incomeAllocations) {
    const catId = alloc.allocationCategoryId ?? alloc.categoryId ?? null;
    if (catId && allocatedCentsByCatId.has(catId)) {
      allocatedCentsByCatId.set(catId, allocatedCentsByCatId.get(catId) + parseMoneyToCents(alloc.allocatedAmount ?? alloc.amount ?? '0.00'));
    }
  }

  for (const tx of transactions) {
    const catId = tx.categoryId ?? null;
    if (!catId || !spentCentsByCatId.has(catId)) continue;
    const amountCents = Math.abs(parseMoneyToCents(tx.amount ?? '0.00'));
    if (tx.direction === 'credit') {
      addedCentsByCatId.set(catId, addedCentsByCatId.get(catId) + amountCents);
    } else {
      spentCentsByCatId.set(catId, spentCentsByCatId.get(catId) + amountCents);
    }
  }

  return { allocatedCentsByCatId, spentCentsByCatId, addedCentsByCatId };
}

// ── Main engine ──────────────────────────────────────────────────────────────

/**
 * Computes a normalized PlanResult for a period.
 *
 * Income lifecycle:
 *   expectedIncome  – what income streams project for the period
 *   receivedIncome  – what income entries have actually arrived
 *   allocatedIncome – what has been distributed across categories
 *   availableIncome – received minus allocated (unrouted cash)
 *
 * Deficit handling: adjustment candidates are non-protected categories with
 * remaining (unspent) budget, ordered lowest-priority-first so the least
 * critical categories surface first. Protected categories (GIVING, OBLIGATIONS)
 * never appear as candidates.
 *
 * Surplus handling: surplus is surfaced explicitly and requires intentional
 * treatment; distribution suggestions are derived from active surplus split rules.
 *
 * @param {Object} params
 * @param {string} params.period - ISO month-start date ('YYYY-MM-01')
 * @param {Array<{id:string,sourceName:string,expectedAmount:string}>} [params.incomeStreams]
 * @param {Array<{id:string,sourceName:string,amount:string,receivedDate:string}>} [params.incomeEntries]
 * @param {Array<{allocationCategoryId?:string,categoryId?:string,allocatedAmount?:string,amount?:string}>} [params.incomeAllocations]
 * @param {Array<{id:string,slug:string,label:string,allocationPercent:string,isActive?:boolean,sortOrder?:number}>} [params.allocationCategories]
 * @param {Array<{id:string,amount:string,direction:'debit'|'credit',categoryId?:string,linkedDebtId?:string}>} [params.transactions]
 * @param {Array<{slug:string,label?:string,splitPercent:string,isActive?:boolean,sortOrder?:number}>} [params.surplusSplitRules]
 * @param {Object} [params.priorityOverrides] - slug → AllocationPriority number
 * @param {number|null} [params.emergencyCoverageMonths]
 * @returns {PlanResult}
 */
export function computePlanResult({
  period,
  incomeStreams = [],
  incomeEntries = [],
  incomeAllocations = [],
  allocationCategories = [],
  transactions = [],
  surplusSplitRules = [],
  priorityOverrides = {},
  emergencyCoverageMonths = null,
} = {}) {
  // ── Income totals ────────────────────────────────────────────────────────
  const totalExpectedCents = incomeStreams.reduce(
    (sum, s) => sum + parseMoneyToCents(s.expectedAmount ?? '0.00'),
    0,
  );
  const totalReceivedCents = incomeEntries.reduce(
    (sum, e) => sum + parseMoneyToCents(e.amount ?? '0.00'),
    0,
  );
  const totalAllocatedCents = incomeAllocations.reduce(
    (sum, a) => sum + parseMoneyToCents(a.allocatedAmount ?? a.amount ?? '0.00'),
    0,
  );
  const totalAvailableCents = totalReceivedCents - totalAllocatedCents;
  const incomeShortfallCents = Math.max(0, totalExpectedCents - totalReceivedCents);

  // ── Income stream statuses ───────────────────────────────────────────────
  const expectedStreamResults = incomeStreams.map((stream) => {
    const expectedCents = parseMoneyToCents(stream.expectedAmount ?? '0.00');
    return {
      id: stream.id,
      sourceName: stream.sourceName,
      expectedAmount: formatCents(expectedCents),
      status: incomeStreamStatus(expectedCents, totalReceivedCents),
    };
  });

  const receivedEntryResults = incomeEntries.map((entry) => ({
    id: entry.id,
    sourceName: entry.sourceName,
    receivedDate: entry.receivedDate,
    amount: formatCents(parseMoneyToCents(entry.amount ?? '0.00')),
  }));

  // ── Category spending ────────────────────────────────────────────────────
  const activeCategories = [...allocationCategories]
    .filter((c) => c.isActive !== false)
    .sort(sortBySortOrderSlugId);

  const { allocatedCentsByCatId, spentCentsByCatId, addedCentsByCatId } =
    buildCategorySpending(activeCategories, incomeAllocations, transactions);

  // ── Per-category plan rows ───────────────────────────────────────────────
  const categoryRows = activeCategories.map((cat) => {
    const priority = resolvePriority(cat, priorityOverrides);
    const protected_ = priority <= PROTECTED_PRIORITY_THRESHOLD;

    // Budgeted: what this category expects based on projected income
    const bps = parseFractionToBps(cat.allocationPercent);
    const budgetedCents = Math.floor((totalExpectedCents * bps) / FRACTION_SCALE);

    const allocatedCents = allocatedCentsByCatId.get(cat.id) ?? 0;
    const spentCents = spentCentsByCatId.get(cat.id) ?? 0;
    const addedCents = addedCentsByCatId.get(cat.id) ?? 0;
    const effectiveBudgetCents = allocatedCents + addedCents;
    const remainingCents = effectiveBudgetCents - spentCents;
    const overrunCents = Math.max(0, -remainingCents);

    let status;
    if (spentCents === 0 && allocatedCents === 0) {
      status = 'not_started';
    } else if (overrunCents > 0) {
      status = 'over_budget';
    } else {
      status = 'on_track';
    }

    return {
      categoryId: cat.id,
      slug: cat.slug,
      label: cat.label ?? cat.slug,
      priority,
      isProtected: protected_,
      allocationPercent: cat.allocationPercent,
      budgeted: formatCents(budgetedCents),
      allocated: formatCents(allocatedCents),
      added: formatCents(addedCents),
      spent: formatCents(spentCents),
      remaining: formatCents(remainingCents),
      overrun: formatCents(overrunCents),
      utilizationPercent: allocatedCents === 0
        ? (spentCents > 0 ? 100 : 0)
        : Number(((spentCents / allocatedCents) * 100).toFixed(2)),
      status,
    };
  });

  // ── Net position ─────────────────────────────────────────────────────────
  const totalSpentCents = transactions.reduce((sum, tx) => {
    if (tx.direction !== 'debit') return sum;
    return sum + Math.abs(parseMoneyToCents(tx.amount ?? '0.00'));
  }, 0);

  const netCents = totalReceivedCents - totalSpentCents;
  const isDeficit = netCents < 0;
  const surplusCents = Math.max(netCents, 0);
  const deficitCents = Math.abs(Math.min(netCents, 0));

  // ── Adjustment candidates ────────────────────────────────────────────────
  // Non-protected categories with remaining budget, lowest priority first
  // (most cuttable surfaces at the top). For deficit: show how much of each
  // category's remaining budget could cover the gap.
  const adjustmentCandidates = categoryRows
    .filter((row) => !row.isProtected && parseMoneyToCents(row.remaining) > 0)
    .sort((a, b) => b.priority - a.priority || a.slug.localeCompare(b.slug))
    .map((row) => {
      const availableCents = parseMoneyToCents(row.remaining);
      const coversDeficitPercent = deficitCents > 0 && availableCents > 0
        ? Number((Math.min(availableCents / deficitCents, 1) * 100).toFixed(1))
        : 0;
      return {
        categoryId: row.categoryId,
        slug: row.slug,
        label: row.label,
        priority: row.priority,
        availableToCut: row.remaining,
        coversDeficitPercent,
      };
    });

  // ── Deficit analysis ─────────────────────────────────────────────────────
  let deficit = null;
  if (isDeficit) {
    const overBudgetCategories = categoryRows
      .filter((row) => row.status === 'over_budget')
      .map((row) => ({ categoryId: row.categoryId, slug: row.slug, label: row.label, overrun: row.overrun }));

    deficit = {
      amount: formatCents(deficitCents),
      incomeShortfall: formatCents(incomeShortfallCents),
      causes: overBudgetCategories,
      adjustmentCandidates,
    };
  }

  // ── Surplus analysis ─────────────────────────────────────────────────────
  let surplus = null;
  if (!isDeficit) {
    const activeRules = [...surplusSplitRules]
      .filter((r) => r.isActive !== false)
      .sort(sortBySortOrderSlugId);
    const distributions = distributeSurplus(surplusCents, activeRules);
    surplus = {
      amount: formatCents(surplusCents),
      requiresIntentionalTreatment: surplusCents > 0,
      distributions: distributions.length > 0 ? distributions : null,
    };
  }

  // ── Alert status ─────────────────────────────────────────────────────────
  const monthlyDebtPaymentsCents = transactions.reduce((sum, tx) => {
    if (tx.direction !== 'debit' || !tx.linkedDebtId) return sum;
    return sum + Math.abs(parseMoneyToCents(tx.amount ?? '0.00'));
  }, 0);
  const debtRatio = totalReceivedCents === 0 ? 0 : monthlyDebtPaymentsCents / totalReceivedCents;

  let alertStatus;
  if (debtRatio > DEBT_RATIO_RISKY || (emergencyCoverageMonths != null && emergencyCoverageMonths < 1)) {
    alertStatus = 'risky';
  } else if (debtRatio > DEBT_RATIO_ELEVATED || isDeficit) {
    alertStatus = 'elevated';
  } else {
    alertStatus = 'ok';
  }

  // ── PlanResult ───────────────────────────────────────────────────────────
  return {
    period,
    income: {
      expectedStreams: expectedStreamResults,
      receivedEntries: receivedEntryResults,
      totalExpected: formatCents(totalExpectedCents),
      totalReceived: formatCents(totalReceivedCents),
      totalAllocated: formatCents(totalAllocatedCents),
      totalAvailable: formatCents(totalAvailableCents),
      incomeShortfall: formatCents(incomeShortfallCents),
      incomeStatus: incomeStreamStatus(totalExpectedCents, totalReceivedCents),
    },
    spending: {
      total: formatCents(totalSpentCents),
      byCategory: categoryRows,
    },
    net: formatCents(netCents),
    isDeficit,
    surplus,
    deficit,
    adjustmentCandidates: isDeficit ? adjustmentCandidates : [],
    alertStatus,
  };
}
