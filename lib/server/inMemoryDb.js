import crypto from 'node:crypto';

function uuid() {
  return crypto.randomUUID();
}

function isoNow() {
  return new Date().toISOString();
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function compareValues(left, right) {
  if (left == null && right == null) {
    return 0;
  }

  if (left == null) {
    return -1;
  }

  if (right == null) {
    return 1;
  }

  return String(left).localeCompare(String(right));
}

function nextMonth(date) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCMonth(value.getUTCMonth() + 1);
  return value.toISOString().slice(0, 10);
}

function isMonthAnchorRange(from, to) {
  return typeof from === 'string'
    && typeof to === 'string'
    && /^\d{4}-\d{2}-01$/.test(from)
    && /^\d{4}-\d{2}-01$/.test(to);
}

function dateInRange(date, from, to) {
  if (!from || !to) {
    return true;
  }

  if (isMonthAnchorRange(from, to)) {
    return date >= from && date < nextMonth(to);
  }

  return date >= from && date <= to;
}

function paginate(items, { cursor = null, limit = 50, idSelector = (item) => item.id } = {}) {
  let filtered = [...items];
  if (cursor) {
    filtered = filtered.filter((item) => compareValues(idSelector(item), cursor) > 0);
  }

  const page = filtered.slice(0, limit);
  return {
    items: page.map(clone),
    nextCursor: filtered.length > limit ? idSelector(page.at(-1)) : null,
  };
}

function defaultAllocationCategories(householdId) {
  return [
    { id: uuid(), householdId, slug: 'savings', label: 'Savings', sortOrder: 1, allocationPercent: '0.1000', isSystem: true, isActive: true, isBuffer: false },
    { id: uuid(), householdId, slug: 'fixed_bills', label: 'Fixed Bills', sortOrder: 2, allocationPercent: '0.3000', isSystem: true, isActive: true, isBuffer: false },
    { id: uuid(), householdId, slug: 'personal_spending', label: 'Personal Spending', sortOrder: 3, allocationPercent: '0.1500', isSystem: true, isActive: true, isBuffer: false },
    { id: uuid(), householdId, slug: 'investment', label: 'Investment', sortOrder: 4, allocationPercent: '0.1000', isSystem: false, isActive: true, isBuffer: false },
    { id: uuid(), householdId, slug: 'debt_payoff', label: 'Debt Payoff', sortOrder: 5, allocationPercent: '0.1000', isSystem: false, isActive: true, isBuffer: false },
    { id: uuid(), householdId, slug: 'buffer', label: 'Buffer', sortOrder: 9, allocationPercent: '0.2500', isSystem: true, isActive: true, isBuffer: true },
  ].map((row) => ({
    ...row,
    createdAt: isoNow(),
    updatedAt: isoNow(),
  }));
}

function defaultSurplusSplits(householdId) {
  return [
    { id: uuid(), householdId, slug: 'emergency_fund', label: 'Emergency Fund', splitPercent: '0.4000', sortOrder: 1, isActive: true },
    { id: uuid(), householdId, slug: 'extra_debt_payoff', label: 'Extra Debt Payoff', splitPercent: '0.4000', sortOrder: 2, isActive: true },
    { id: uuid(), householdId, slug: 'investment', label: 'Investment', splitPercent: '0.2000', sortOrder: 3, isActive: true },
  ].map((row) => ({
    ...row,
    createdAt: isoNow(),
    updatedAt: isoNow(),
  }));
}

export function createInMemoryDb() {
  const householdId = 'household_1';
  const state = {
    households: [
      {
        id: householdId,
        ownerUserId: 'local-user',
        name: 'Local RAF Household',
        timezone: 'America/Toronto',
        activeMonth: '2026-03-01',
        periodStartDay: 1,
        savingsFloor: '0.00',
        monthlyEssentialsBaseline: '2000.00',
        createdAt: isoNow(),
        updatedAt: isoNow(),
      },
    ],
    allocationCategories: defaultAllocationCategories(householdId),
    surplusSplitRules: defaultSurplusSplits(householdId),
    incomeEntries: [],
    incomeAllocations: [],
    transactions: [],
    debts: [],
    debtPayments: [],
    importBatches: [],
    importedRows: [],
    merchantRules: [],
    fixedBills: [],
    monthlyReviews: [],
  };

  const tx = {
    async listAllocationCategories({ householdId: targetHouseholdId }) {
      return state.allocationCategories
        .filter((row) => row.householdId === targetHouseholdId)
        .sort((left, right) =>
          (left.sortOrder ?? 0) - (right.sortOrder ?? 0)
          || compareValues(left.slug, right.slug)
          || compareValues(left.id, right.id))
        .map(clone);
    },
    async replaceAllocationCategories({ householdId: targetHouseholdId, items }) {
      const incomingSlugs = new Set(items.map((item) => item.slug));
      state.allocationCategories = state.allocationCategories.filter((row) => (
        row.householdId !== targetHouseholdId
        || incomingSlugs.has(row.slug)
        || (row.slug !== 'buffer' && row.isSystem === true)
      ));

      const rowsBySlug = new Map(
        state.allocationCategories
          .filter((row) => row.householdId === targetHouseholdId)
          .map((row) => [row.slug, row]),
      );

      for (const item of items) {
        const existing = rowsBySlug.get(item.slug);
        if (!existing) {
          state.allocationCategories.push({
            id: uuid(),
            householdId: targetHouseholdId,
            slug: item.slug,
            label: item.label,
            sortOrder: item.sortOrder,
            allocationPercent: item.allocationPercent,
            isSystem: false,
            isActive: item.isActive !== false,
            isBuffer: item.slug === 'buffer',
            createdAt: isoNow(),
            updatedAt: isoNow(),
          });
          continue;
        }

        Object.assign(existing, {
          ...item,
          isBuffer: item.slug === 'buffer',
          updatedAt: isoNow(),
        });
      }

      return tx.listAllocationCategories({ householdId: targetHouseholdId });
    },
    async listSurplusSplitRules({ householdId: targetHouseholdId }) {
      return state.surplusSplitRules
        .filter((row) => row.householdId === targetHouseholdId)
        .sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0))
        .map(clone);
    },
    async listFixedBills({ householdId: targetHouseholdId }) {
      return state.fixedBills
        .filter((row) => row.householdId === targetHouseholdId)
        .sort((left, right) =>
          (left.dueDayOfMonth ?? 0) - (right.dueDayOfMonth ?? 0)
          || compareValues(left.name, right.name)
          || compareValues(left.id, right.id))
        .map(clone);
    },
    async insertFixedBill(payload) {
      const row = { id: uuid(), createdAt: isoNow(), updatedAt: isoNow(), ...payload };
      state.fixedBills.push(row);
      return clone(row);
    },
    async getFixedBillById({ householdId: targetHouseholdId, fixedBillId }) {
      return clone(state.fixedBills.find((row) => row.householdId === targetHouseholdId && row.id === fixedBillId) ?? null);
    },
    async updateFixedBill({ householdId: targetHouseholdId, fixedBillId, patch }) {
      const row = state.fixedBills.find((entry) => entry.householdId === targetHouseholdId && entry.id === fixedBillId);
      Object.assign(row, patch, { updatedAt: isoNow() });
      return clone(row);
    },
    async findIncomeByIdempotencyKey({ householdId: targetHouseholdId, idempotencyKey }) {
      return clone(
        state.incomeEntries.find((row) => row.householdId === targetHouseholdId && row.idempotencyKey === idempotencyKey) ?? null,
      );
    },
    async insertIncomeEntry(payload) {
      const row = { id: uuid(), createdAt: isoNow(), updatedAt: isoNow(), ...payload };
      state.incomeEntries.push(row);
      return clone(row);
    },
    async listIncomeEntries({ householdId: targetHouseholdId, from, to }) {
      return state.incomeEntries
        .filter((row) => row.householdId === targetHouseholdId && dateInRange(row.receivedDate, from, to))
        .sort((left, right) => compareValues(left.receivedDate, right.receivedDate) || compareValues(left.id, right.id))
        .map(clone);
    },
    async getIncomeEntryById({ householdId: targetHouseholdId, incomeId }) {
      return clone(state.incomeEntries.find((row) => row.householdId === targetHouseholdId && row.id === incomeId) ?? null);
    },
    async updateIncomeEntry({ householdId: targetHouseholdId, incomeId, patch }) {
      const row = state.incomeEntries.find((entry) => entry.householdId === targetHouseholdId && entry.id === incomeId);
      Object.assign(row, patch, { updatedAt: isoNow() });
      return clone(row);
    },
    async deleteIncomeEntry({ householdId: targetHouseholdId, incomeId }) {
      state.incomeEntries = state.incomeEntries.filter((row) => !(row.householdId === targetHouseholdId && row.id === incomeId));
      state.incomeAllocations = state.incomeAllocations.filter((row) => !(row.householdId === targetHouseholdId && row.incomeEntryId === incomeId));
    },
    async insertIncomeAllocations(rows) {
      const inserted = rows.map((row) => ({
        id: uuid(),
        createdAt: isoNow(),
        ...row,
      }));
      state.incomeAllocations.push(...inserted);
      return clone(inserted);
    },
    async deleteIncomeAllocationsByIncomeEntryId({ householdId: targetHouseholdId, incomeEntryId }) {
      state.incomeAllocations = state.incomeAllocations.filter(
        (row) => !(row.householdId === targetHouseholdId && row.incomeEntryId === incomeEntryId),
      );
    },
    async listIncomeAllocations({ householdId: targetHouseholdId, incomeEntryId, from, to }) {
      let rows = state.incomeAllocations.filter((row) => row.householdId === targetHouseholdId);
      if (incomeEntryId) {
        rows = rows.filter((row) => row.incomeEntryId === incomeEntryId);
      }
      if (from && to) {
        rows = rows.filter((row) => {
          const entry = state.incomeEntries.find((income) => income.id === row.incomeEntryId);
          return entry ? dateInRange(entry.receivedDate, from, to) : false;
        });
      }

      return rows.map((row) => {
        const category = state.allocationCategories.find((category) => category.id === row.allocationCategoryId);
        const incomeEntry = state.incomeEntries.find((income) => income.id === row.incomeEntryId);
        return clone({
          ...row,
          slug: category?.slug ?? null,
          label: category?.label ?? null,
          amount: row.allocatedAmount,
          receivedDate: incomeEntry?.receivedDate ?? null,
        });
      });
    },
    async listIncomeAllocationsBySlug({ householdId: targetHouseholdId, slug }) {
      return (await tx.listIncomeAllocations({ householdId: targetHouseholdId }))
        .filter((row) => row.slug === slug);
    },
    async findDebtById({ householdId: targetHouseholdId, debtId }) {
      return clone(state.debts.find((row) => row.householdId === targetHouseholdId && row.id === debtId) ?? null);
    },
    async insertTransaction(payload) {
      const row = { id: uuid(), createdAt: isoNow(), updatedAt: isoNow(), ...payload };
      state.transactions.push(row);
      return clone(row);
    },
    async listTransactions({ householdId: targetHouseholdId, from, to, categoryId = null, direction = null, cursor = null, limit = 50 }) {
      const items = state.transactions
        .filter((row) => row.householdId === targetHouseholdId && dateInRange(row.transactionDate, from, to))
        .filter((row) => (categoryId ? row.categoryId === categoryId : true))
        .filter((row) => (direction ? row.direction === direction : true))
        .sort((left, right) => compareValues(left.transactionDate, right.transactionDate) || compareValues(left.id, right.id));

      return paginate(items, { cursor, limit, idSelector: (item) => item.id });
    },
    async getTransactionById({ householdId: targetHouseholdId, transactionId }) {
      return clone(state.transactions.find((row) => row.householdId === targetHouseholdId && row.id === transactionId) ?? null);
    },
    async updateTransaction({ householdId: targetHouseholdId, transactionId, patch }) {
      const row = state.transactions.find((entry) => entry.householdId === targetHouseholdId && entry.id === transactionId);
      Object.assign(row, patch, { updatedAt: isoNow() });
      return clone(row);
    },
    async deleteTransaction({ householdId: targetHouseholdId, transactionId }) {
      state.transactions = state.transactions.filter((row) => !(row.householdId === targetHouseholdId && row.id === transactionId));
    },
    async insertDebtPayment(payload) {
      const row = { id: uuid(), createdAt: isoNow(), ...payload };
      state.debtPayments = state.debtPayments.filter((entry) => entry.transactionId == null || entry.transactionId !== row.transactionId);
      state.debtPayments.push(row);
      return clone(row);
    },
    async deleteDebtPaymentByTransactionId({ householdId: targetHouseholdId, transactionId }) {
      state.debtPayments = state.debtPayments.filter(
        (row) => !(row.householdId === targetHouseholdId && row.transactionId === transactionId),
      );
    },
    async listDebtPayments({ householdId: targetHouseholdId, debtId = null, from, to }) {
      return state.debtPayments
        .filter((row) => row.householdId === targetHouseholdId)
        .filter((row) => (debtId ? row.debtId === debtId : true))
        .filter((row) => (from && to ? dateInRange(row.paymentDate, from, to) : true))
        .map(clone);
    },
    async insertDebt(payload) {
      const row = { id: uuid(), createdAt: isoNow(), updatedAt: isoNow(), ...payload };
      state.debts.push(row);
      return clone(row);
    },
    async listDebts({ householdId: targetHouseholdId }) {
      return state.debts
        .filter((row) => row.householdId === targetHouseholdId)
        .sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0))
        .map(clone);
    },
    async getDebtById({ householdId: targetHouseholdId, debtId }) {
      return clone(state.debts.find((row) => row.householdId === targetHouseholdId && row.id === debtId) ?? null);
    },
    async updateDebt({ householdId: targetHouseholdId, debtId, patch }) {
      const row = state.debts.find((entry) => entry.householdId === targetHouseholdId && entry.id === debtId);
      Object.assign(row, patch, { updatedAt: isoNow() });
      return clone(row);
    },
    async countDebtPaymentsForDebt({ householdId: targetHouseholdId, debtId }) {
      return state.debtPayments.filter((row) => row.householdId === targetHouseholdId && row.debtId === debtId).length;
    },
    async deleteDebt({ householdId: targetHouseholdId, debtId }) {
      state.debts = state.debts.filter((row) => !(row.householdId === targetHouseholdId && row.id === debtId));
    },
    async getHousehold({ householdId: targetHouseholdId }) {
      return clone(state.households.find((row) => row.id === targetHouseholdId) ?? null);
    },
    async getMonthlyReviewByMonth({ householdId: targetHouseholdId, reviewMonth }) {
      return clone(state.monthlyReviews.find((row) => row.householdId === targetHouseholdId && row.reviewMonth === reviewMonth) ?? null);
    },
    async insertMonthlyReview(payload) {
      const row = { id: uuid(), createdAt: isoNow(), updatedAt: isoNow(), ...payload };
      state.monthlyReviews.push(row);
      return clone(row);
    },
    async listMonthlyReviews({ householdId: targetHouseholdId, from, to }) {
      return state.monthlyReviews
        .filter((row) => row.householdId === targetHouseholdId && dateInRange(row.reviewMonth, from, to))
        .sort((left, right) => compareValues(left.reviewMonth, right.reviewMonth))
        .map(clone);
    },
    async getMonthlyReviewById({ householdId: targetHouseholdId, reviewId }) {
      return clone(state.monthlyReviews.find((row) => row.householdId === targetHouseholdId && row.id === reviewId) ?? null);
    },
    async updateMonthlyReview({ householdId: targetHouseholdId, reviewId, patch }) {
      const row = state.monthlyReviews.find((entry) => entry.householdId === targetHouseholdId && entry.id === reviewId);
      Object.assign(row, patch, { updatedAt: isoNow() });
      return clone(row);
    },
    async listMerchantRules({ householdId: targetHouseholdId }) {
      return state.merchantRules.filter((row) => row.householdId === targetHouseholdId).map(clone);
    },
    async insertMerchantRule(payload) {
      const row = { id: uuid(), createdAt: isoNow(), updatedAt: isoNow(), ...payload };
      state.merchantRules.push(row);
      return clone(row);
    },
    async getMerchantRuleById({ householdId: targetHouseholdId, ruleId }) {
      return clone(state.merchantRules.find((row) => row.householdId === targetHouseholdId && row.id === ruleId) ?? null);
    },
    async updateMerchantRule({ householdId: targetHouseholdId, ruleId, patch }) {
      const row = state.merchantRules.find((entry) => entry.householdId === targetHouseholdId && entry.id === ruleId);
      Object.assign(row, patch, { updatedAt: isoNow() });
      return clone(row);
    },
    async deleteMerchantRule({ householdId: targetHouseholdId, ruleId }) {
      state.merchantRules = state.merchantRules.filter((row) => !(row.householdId === targetHouseholdId && row.id === ruleId));
    },
    async insertImportBatch(payload) {
      const row = { id: uuid(), createdAt: isoNow(), updatedAt: isoNow(), ...payload };
      state.importBatches.push(row);
      return clone(row);
    },
    async insertImportedRows({ rows }) {
      const inserted = rows.map((row) => ({
        id: uuid(),
        createdAt: isoNow(),
        ...row,
      }));
      state.importedRows.push(...inserted);
      return clone(inserted);
    },
    async getImportBatch({ householdId: targetHouseholdId, batchId }) {
      return clone(state.importBatches.find((row) => row.householdId === targetHouseholdId && row.id === batchId) ?? null);
    },
    async updateImportBatch({ householdId: targetHouseholdId, batchId, status, rowCount }) {
      const row = state.importBatches.find((entry) => entry.householdId === targetHouseholdId && entry.id === batchId);
      Object.assign(row, {
        status: status ?? row.status,
        rowCount: rowCount ?? row.rowCount,
        updatedAt: isoNow(),
      });
      return clone(row);
    },
    async listImportedRows({ householdId: targetHouseholdId, batchId }) {
      return state.importedRows
        .filter((row) => row.householdId === targetHouseholdId && row.batchId === batchId)
        .map(clone);
    },
    async updateImportedRow({ householdId: targetHouseholdId, rowId, patch }) {
      const row = state.importedRows.find((entry) => entry.householdId === targetHouseholdId && entry.id === rowId);
      Object.assign(row, patch);
      return clone(row);
    },
    async getImportedRow({ householdId: targetHouseholdId, rowId }) {
      return clone(state.importedRows.find((row) => row.householdId === targetHouseholdId && row.id === rowId) ?? null);
    },
    async findDuplicateTransaction({ householdId: targetHouseholdId, parsedDate, parsedAmount, normalizedMerchant }) {
      return clone(
        state.transactions.find((row) => {
          const merchant = String(row.merchant ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
          return row.householdId === targetHouseholdId
            && row.transactionDate === parsedDate
            && row.amount === parsedAmount
            && merchant === String(normalizedMerchant ?? '');
        }) ?? null,
      );
    },
  };

  return {
    defaultHouseholdId: householdId,
    state,
    async transaction(callback) {
      return callback(tx);
    },
  };
}
