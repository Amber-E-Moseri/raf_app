import { listDebts } from '../debts/debts.js';
import { listGoals } from '../goals/goals.js';
import { getDashboardReport } from '../reports/getDashboardReport.js';
import { getFinancialHealthReport } from '../reports/getFinancialHealthReport.js';

const WIDE_FROM = '1900-01-01';
const WIDE_TO = '2999-12-31';

function stable(value) {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value) {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortKeys(value[key])]),
    );
  }

  return value;
}

function count(items) {
  return Array.isArray(items) ? items.length : 0;
}

async function adapterSnapshot(db, workspaceId) {
  const householdId = workspaceId;
  const [
    household,
    allocationCategories,
    surplusSplitRules,
    incomeEntries,
    incomeAllocations,
    financialAccounts,
    transactions,
    debts,
    goals,
    fixedBills,
    monthlyReviews,
    importedTransactions,
    accountReconciliations,
    importReviewRules,
    merchantRules,
    dashboard,
    financialHealth,
  ] = await Promise.all([
    db.transaction((tx) => tx.getHousehold({ householdId })),
    db.transaction((tx) => tx.listAllocationCategories({ householdId, includeSuperseded: true })),
    db.transaction((tx) => tx.listSurplusSplitRules({ householdId })),
    db.transaction((tx) => tx.listIncomeEntries({ householdId, from: WIDE_FROM, to: WIDE_TO })),
    db.transaction((tx) => tx.listIncomeAllocations({ householdId, from: WIDE_FROM, to: WIDE_TO })),
    db.transaction((tx) => typeof tx.listFinancialAccounts === 'function' ? tx.listFinancialAccounts({ householdId }) : []),
    db.transaction((tx) => tx.listTransactions({ householdId, from: WIDE_FROM, to: WIDE_TO, limit: 100 })),
    listDebts({ db, householdId, asOf: WIDE_TO }),
    listGoals({ db, householdId }),
    db.transaction((tx) => tx.listFixedBills({ householdId })),
    db.transaction((tx) => tx.listMonthlyReviews({ householdId, from: WIDE_FROM, to: WIDE_TO })),
    db.transaction((tx) => tx.listImportedTransactions({ householdId })),
    db.transaction(async (tx) => {
      if (typeof tx.listFinancialAccounts !== 'function' || typeof tx.listAccountReconciliations !== 'function') {
        return [];
      }
      const accounts = await tx.listFinancialAccounts({ householdId });
      const allRows = [];
      for (const account of accounts) {
        allRows.push(...await tx.listAccountReconciliations({ householdId, accountId: account.id }));
      }
      return allRows;
    }),
    db.transaction((tx) => tx.listImportReviewRules({ householdId })),
    db.transaction((tx) => tx.listMerchantRules({ householdId })),
    getDashboardReport({ db, householdId, from: WIDE_FROM, to: WIDE_TO }),
    getFinancialHealthReport({ db, householdId }),
  ]);

  return {
    workspaceId,
    household: {
      id: household?.id ?? null,
      name: household?.name ?? null,
      activeMonth: household?.activeMonth ?? null,
      periodStartDay: household?.periodStartDay ?? null,
      savingsFloor: household?.savingsFloor ?? null,
      monthlyEssentialsBaseline: household?.monthlyEssentialsBaseline ?? null,
    },
    counts: {
      allocationCategories: count(allocationCategories),
      surplusSplitRules: count(surplusSplitRules),
      incomeEntries: count(incomeEntries),
      incomeAllocations: count(incomeAllocations),
      financialAccounts: count(financialAccounts),
      transactions: count(transactions.items ?? transactions),
      debts: count(debts.items),
      goals: count(goals.items),
      fixedBills: count(fixedBills),
      monthlyReviews: count(monthlyReviews),
      importedTransactions: count(importedTransactions),
      accountReconciliations: count(accountReconciliations),
      importReviewRules: count(importReviewRules),
      merchantRules: count(merchantRules),
    },
    financials: {
      incomeTotal: incomeEntries.reduce((sum, row) => sum + Number(row.amount), 0).toFixed(2),
      transactionDebitTotal: (transactions.items ?? transactions)
        .filter((row) => row.direction === 'debit')
        .reduce((sum, row) => sum + Number(row.amount), 0)
        .toFixed(2),
      transactionCreditTotal: (transactions.items ?? transactions)
        .filter((row) => row.direction === 'credit')
        .reduce((sum, row) => sum + Number(row.amount), 0)
        .toFixed(2),
      debtSummary: debts.summary,
      goalProgress: dashboard.goal_progress ?? [],
      allocationSlugs: allocationCategories.map((row) => `${row.slug}:${row.allocationPercent}:${row.isActive}`),
      surplusRuleSlugs: surplusSplitRules.map((row) => `${row.slug}:${row.splitPercent}:${row.isActive}`),
      dashboard: {
        incomeTotal: dashboard.incomeTotal,
        actualSpentTotal: dashboard.actualSpentTotal,
        surplusOrDeficit: dashboard.surplusOrDeficit,
      },
      financialHealth,
    },
  };
}

function compareSnapshots(source, target) {
  const mismatches = [];
  for (const key of ['household', 'counts', 'financials']) {
    if (stable(source[key]) !== stable(target[key])) {
      mismatches.push(key);
    }
  }
  return mismatches;
}

export async function verifyMigrationReconciliation({ sourceDb, targetDb, workspaceIds }) {
  const results = [];
  for (const workspaceId of workspaceIds) {
    const source = await adapterSnapshot(sourceDb, workspaceId);
    const target = await adapterSnapshot(targetDb, workspaceId);
    const mismatches = compareSnapshots(source, target);
    results.push({
      workspaceId,
      ok: mismatches.length === 0,
      mismatches,
      source,
      target,
    });
  }

  return {
    ok: results.every((result) => result.ok),
    results,
  };
}

export const __migrationVerification = {
  adapterSnapshot,
  compareSnapshots,
};
