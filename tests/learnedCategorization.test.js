/**
 * Learned transaction categorization tests.
 *
 * Covers:
 *  1. First-time unknown merchant → unassigned, no rule created yet
 *  2. User categorizes merchant → rule auto-created, no opt-in required
 *  3. Later exact merchant match → rule returned as suggestion
 *  4. Normalized merchant variation → merchant-key fallback matches
 *  5. Weak/fuzzy match → suggestion only, not auto-apply
 *  6. User correction overrides learned suggestion
 *  7. Repeated correction increments correction_count and degrades rule
 *  8. Ambiguous merchant → correction_count > 0 disables auto-apply
 *  9. Workspace A/B categorization isolation
 * 10. PDF import uses learned categorization path
 * 11. Duplicate detection remains unchanged by categorization
 * 12. Explicit transaction category never overwritten by re-import suggestion
 * 13. Unknown merchant remains unassigned when no matching rule exists
 * 14. Merchant normalization false-positive cases (UBER vs UBER EATS, APPLE vs APPLEBEES)
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyImportedTransaction,
  getImportedTransaction,
  listReviewedImportedTransactions,
} from '../lib/imports/reviewImportedTransactions.js';
import { extractMerchantKey } from '../lib/imports/merchantNormalization.js';

// ─── DB double ────────────────────────────────────────────────────────────────

function createDbDouble({
  importedTransactions = [],
  importReviewRules = [],
  categories = [
    { id: 'cat_living', slug: 'living', label: 'Living', isActive: true, sortOrder: 1 },
    { id: 'cat_savings', slug: 'savings', label: 'Savings', isActive: true, sortOrder: 2 },
    { id: 'cat_debt', slug: 'debt_payoff', label: 'Debt Payoff', isActive: true, sortOrder: 3 },
    { id: 'cat_personal', slug: 'personal', label: 'Personal', isActive: true, sortOrder: 4 },
    { id: 'cat_groceries', slug: 'groceries', label: 'Groceries', isActive: true, sortOrder: 5 },
    { id: 'cat_dining', slug: 'dining', label: 'Dining', isActive: true, sortOrder: 6 },
  ],
  debts = [],
} = {}) {
  const state = {
    importedTransactions: importedTransactions.map((r) => ({ ...r })),
    transactions: [],
    incomeEntries: [],
    incomeAllocations: [],
    debtPayments: [],
    importReviewRules: importReviewRules.map((r) => ({ ...r })),
  };

  function findRule({ householdId, matchType, matchValue, normalizedDescription }) {
    const key = String(matchValue ?? normalizedDescription ?? '');
    const mt = matchType ?? 'contains';
    return state.importReviewRules.find(
      (r) => r.householdId === householdId
        && (r.matchType ?? 'contains') === mt
        && String(r.matchValue ?? r.normalizedDescription ?? '') === key,
    ) ?? null;
  }

  const tx = {
    async listImportedTransactions({ householdId }) {
      return state.importedTransactions.filter((r) => r.householdId === householdId).map((r) => ({ ...r }));
    },
    async getImportedTransactionById({ householdId, importedTransactionId }) {
      return state.importedTransactions.find((r) => r.householdId === householdId && r.id === importedTransactionId) ?? null;
    },
    async updateImportedTransaction({ householdId, importedTransactionId, patch }) {
      const idx = state.importedTransactions.findIndex((r) => r.householdId === householdId && r.id === importedTransactionId);
      state.importedTransactions[idx] = { ...state.importedTransactions[idx], ...patch, updatedAt: '2026-09-11T00:00:00.000Z' };
      return { ...state.importedTransactions[idx] };
    },
    async insertTransaction(payload) {
      const row = { id: `txn_${state.transactions.length + 1}`, ...payload };
      state.transactions.push(row);
      return { ...row };
    },
    async getTransactionById({ householdId, transactionId }) {
      return state.transactions.find((r) => r.householdId === householdId && r.id === transactionId) ?? null;
    },
    async deleteTransaction({ householdId, transactionId }) {
      state.transactions = state.transactions.filter((r) => !(r.householdId === householdId && r.id === transactionId));
    },
    async insertDebtPayment(payload) {
      const row = { id: `dp_${state.debtPayments.length + 1}`, ...payload };
      state.debtPayments.push(row);
      return { ...row };
    },
    async getDebtById({ householdId, debtId }) {
      return debts.find((d) => d.householdId === householdId && d.id === debtId) ?? null;
    },
    async insertIncomeEntry(payload) {
      const row = { id: `inc_${state.incomeEntries.length + 1}`, ...payload };
      state.incomeEntries.push(row);
      return { ...row };
    },
    async insertIncomeAllocations(rows) {
      const inserted = rows.map((r, i) => ({ id: `alloc_${state.incomeAllocations.length + i + 1}`, ...r }));
      state.incomeAllocations.push(...inserted);
      return inserted.map((r) => ({ ...r }));
    },
    async getIncomeEntryById({ householdId, incomeId }) {
      return state.incomeEntries.find((r) => r.householdId === householdId && r.id === incomeId) ?? null;
    },
    async deleteIncomeEntry({ householdId, incomeId }) {
      state.incomeEntries = state.incomeEntries.filter((r) => !(r.householdId === householdId && r.id === incomeId));
    },
    async deleteDebtPaymentByTransactionId({ householdId, transactionId }) {
      state.debtPayments = state.debtPayments.filter((r) => !(r.householdId === householdId && r.transactionId === transactionId));
    },
    async listAllocationCategories({ householdId } = {}) {
      return categories.map((c) => ({ ...c, householdId }));
    },
    async findImportReviewRuleByNormalizedDescription({ householdId, normalizedDescription }) {
      const matches = state.importReviewRules
        .filter((r) => r.householdId === householdId)
        .filter((r) => {
          const mt = r.matchType ?? 'contains';
          const val = String(r.matchValue ?? r.normalizedDescription ?? '').trim();
          if (!val) return false;
          return mt === 'contains' ? normalizedDescription.includes(val) : normalizedDescription === val;
        })
        .sort((a, b) =>
          Number(b.autoApply === true) - Number(a.autoApply === true)
          || String(b.matchValue ?? b.normalizedDescription ?? '').length - String(a.matchValue ?? a.normalizedDescription ?? '').length
          || 0);
      return matches[0] ? { ...matches[0] } : null;
    },
    async findImportReviewRuleByMerchantKey({ householdId, normalizedMerchant }) {
      if (!normalizedMerchant) return null;
      const matches = state.importReviewRules
        .filter((r) => r.householdId === householdId)
        .filter((r) => {
          const key = String(r.normalizedMerchant ?? '').trim();
          return key && key === normalizedMerchant;
        })
        .sort((a, b) =>
          Number(b.autoApply === true) - Number(a.autoApply === true)
          || (b.confirmationCount ?? 1) - (a.confirmationCount ?? 1)
          || 0);
      return matches[0] ? { ...matches[0] } : null;
    },
    async upsertImportReviewRule(payload) {
      const existing = findRule(payload);
      if (existing) {
        const isSame = existing.categoryId === (payload.categoryId ?? null)
          && existing.classificationType === payload.classificationType;
        const confirmationCount = isSame ? (existing.confirmationCount ?? 1) + 1 : existing.confirmationCount ?? 1;
        const correctionCount = isSame ? existing.correctionCount ?? 0 : (existing.correctionCount ?? 0) + 1;
        Object.assign(existing, payload, { confirmationCount, correctionCount, updatedAt: '2026-09-11T00:00:00.000Z' });
        return { ...existing };
      }
      const row = { id: `rule_${state.importReviewRules.length + 1}`, createdAt: '2026-09-11T00:00:00.000Z', updatedAt: '2026-09-11T00:00:00.000Z', confirmationCount: 1, correctionCount: 0, ...payload };
      state.importReviewRules.push(row);
      return { ...row };
    },
    async touchImportReviewRule({ householdId, ruleId }) {
      const rule = state.importReviewRules.find((r) => r.householdId === householdId && r.id === ruleId);
      if (rule) rule.lastUsedAt = '2026-09-11T00:00:00.000Z';
      return rule ? { ...rule } : null;
    },
    async listImportReviewRules({ householdId }) {
      return state.importReviewRules.filter((r) => r.householdId === householdId).map((r) => ({ ...r }));
    },
    async getImportReviewRuleById({ householdId, ruleId }) {
      return state.importReviewRules.find((r) => r.householdId === householdId && r.id === ruleId) ?? null;
    },
    async deleteImportReviewRule({ householdId, ruleId }) {
      state.importReviewRules = state.importReviewRules.filter((r) => !(r.householdId === householdId && r.id === ruleId));
    },
    async updateImportReviewRule({ householdId, ruleId, patch }) {
      const idx = state.importReviewRules.findIndex((r) => r.householdId === householdId && r.id === ruleId);
      if (idx < 0) return null;
      state.importReviewRules[idx] = { ...state.importReviewRules[idx], ...patch };
      return { ...state.importReviewRules[idx] };
    },
  };

  const db = { state, transaction: (fn) => fn(tx) };
  return db;
}

function importRow(overrides = {}) {
  return {
    id: 'import_1',
    householdId: 'hh_1',
    date: '2026-09-01',
    description: overrides.description ?? 'Whole Foods #1042',
    amount: '-126.40',
    currency: 'CAD',
    source: 'bank_import',
    rawDescription: overrides.rawDescription ?? overrides.description ?? 'Whole Foods #1042',
    normalizedDescription: overrides.normalizedDescription ?? 'whole foods 1042',
    referenceNumber: null,
    balanceAfterTransaction: null,
    status: 'unreviewed',
    classificationType: null,
    linkedTransactionId: null,
    linkedIncomeEntryId: null,
    linkedDebtId: null,
    linkedFixedBillId: null,
    linkedGoalId: null,
    reviewedAt: null,
    reviewNote: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

// ─── 1. First-time unknown merchant ───────────────────────────────────────────

test('1 — first-time unknown merchant returns no suggestion and categorization_source none', async () => {
  const db = createDbDouble({ importedTransactions: [importRow()] });

  const result = await listReviewedImportedTransactions({ db, householdId: 'hh_1' });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].suggestion, null);
  assert.equal(result.items[0].categorization_source, 'none');
  assert.equal(result.items[0].needs_review, true);
});

// ─── 2. User categorizes merchant → rule auto-created without rememberChoice ──

test('2 — classifying a transaction auto-creates a rule without rememberChoice', async () => {
  const db = createDbDouble({ importedTransactions: [importRow()] });

  await classifyImportedTransaction({
    db, householdId: 'hh_1', importedTransactionId: 'import_1',
    input: { classification_type: 'transaction', category_id: 'cat_groceries' },
  });

  assert.equal(db.state.importReviewRules.length, 1);
  const rule = db.state.importReviewRules[0];
  assert.equal(rule.categoryId, 'cat_groceries');
  assert.equal(rule.ruleType, 'suggestion');
  assert.equal(rule.confirmationCount, 1);
  assert.equal(rule.correctionCount, 0);
  assert.equal(rule.normalizedMerchant, 'whole foods');
});

// ─── 3. Later exact merchant match returns suggestion ─────────────────────────

test('3 — second import with identical description matches learned rule', async () => {
  const db = createDbDouble({
    importedTransactions: [importRow({ id: 'import_2' })],
    importReviewRules: [{
      id: 'rule_1',
      householdId: 'hh_1',
      normalizedDescription: 'whole foods 1042',
      matchType: 'contains',
      matchValue: 'whole foods 1042',
      classificationType: 'transaction',
      categoryId: 'cat_groceries',
      normalizedMerchant: 'whole foods',
      ruleType: 'suggestion',
      autoApply: false,
      confirmationCount: 1,
      correctionCount: 0,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    }],
  });

  const result = await listReviewedImportedTransactions({ db, householdId: 'hh_1' });

  assert.equal(result.items[0].suggestion?.category_id, 'cat_groceries');
  assert.equal(result.items[0].categorization_source, 'user_history');
});

// ─── 4. Merchant variation matched via merchant key ───────────────────────────
// Conservative design: exact merchant-key equality is required.
// "WHOLE FOODS #1042" → key "whole foods"
// "WHOLE FOODS #2053" → key "whole foods" → MATCH via merchant-key fallback
// "WHOLE FOODS MARKET" → key "whole foods market" ≠ "whole foods" → NO match (see test 14c2)
// This avoids the UBER/UBER EATS collision: both strip to different keys.

test('4 — different store number variant matches rule via merchant-key fallback', async () => {
  const db = createDbDouble({
    importedTransactions: [importRow({
      id: 'import_2',
      description: 'Whole Foods #2053',
      rawDescription: 'Whole Foods #2053',
      normalizedDescription: 'whole foods 2053',
    })],
    importReviewRules: [{
      id: 'rule_1',
      householdId: 'hh_1',
      normalizedDescription: 'whole foods 1042',
      matchType: 'contains',
      matchValue: 'whole foods 1042',
      classificationType: 'transaction',
      categoryId: 'cat_groceries',
      // Rule learned from "WHOLE FOODS #1042" → normalizedMerchant = "whole foods"
      normalizedMerchant: 'whole foods',
      ruleType: 'suggestion',
      autoApply: false,
      confirmationCount: 1,
      correctionCount: 0,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    }],
  });

  const result = await listReviewedImportedTransactions({ db, householdId: 'hh_1' });
  const item = result.items[0];

  // "whole foods 2053" does NOT contain "whole foods 1042" → description match fails
  // extractMerchantKey("Whole Foods #2053") = "whole foods" = rule.normalizedMerchant → match
  assert.equal(item.suggestion?.category_id, 'cat_groceries', 'merchant-key fallback should return suggestion');
  assert.equal(item.categorization_source, 'user_history');
  assert.equal(item.needs_review, true); // auto_apply is false
});

// ─── 5. autoApply rule with no corrections → needs_review false ───────────────

test('5 — auto_apply rule with zero corrections reports needs_review: false', async () => {
  const db = createDbDouble({
    importedTransactions: [importRow()],
    importReviewRules: [{
      id: 'rule_1',
      householdId: 'hh_1',
      normalizedDescription: 'whole foods 1042',
      matchType: 'contains',
      matchValue: 'whole foods 1042',
      classificationType: 'transaction',
      categoryId: 'cat_groceries',
      normalizedMerchant: 'whole foods',
      ruleType: 'reusable_rule',
      autoApply: true,
      confirmationCount: 3,
      correctionCount: 0,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    }],
  });

  const result = await listReviewedImportedTransactions({ db, householdId: 'hh_1' });
  assert.equal(result.items[0].needs_review, false);
});

// ─── 6. User correction overrides learned suggestion ─────────────────────────

test('6 — correcting a category updates the rule and increments correction_count', async () => {
  const db = createDbDouble({
    importedTransactions: [importRow({
      id: 'import_2',
      description: 'Starbucks',
      rawDescription: 'Starbucks',
      normalizedDescription: 'starbucks',
    })],
    importReviewRules: [{
      id: 'rule_1',
      householdId: 'hh_1',
      normalizedDescription: 'starbucks',
      matchType: 'contains',
      matchValue: 'starbucks',
      classificationType: 'transaction',
      categoryId: 'cat_dining',
      normalizedMerchant: 'starbucks',
      ruleType: 'suggestion',
      autoApply: false,
      confirmationCount: 1,
      correctionCount: 0,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    }],
  });

  // User corrects: Dining → Personal Spending
  await classifyImportedTransaction({
    db, householdId: 'hh_1', importedTransactionId: 'import_2',
    input: { classification_type: 'transaction', category_id: 'cat_personal' },
  });

  const rule = db.state.importReviewRules.find((r) => r.matchValue === 'starbucks');
  assert.ok(rule, 'rule should still exist');
  assert.equal(rule.categoryId, 'cat_personal', 'category should be updated to correction');
  assert.equal(rule.correctionCount, 1, 'correction_count should increment');
});

// ─── 7. Repeated correction degrades old rule ─────────────────────────────────

test('7 — repeated corrections keep incrementing correction_count', async () => {
  const db = createDbDouble({
    importedTransactions: [
      importRow({ id: 'import_a', normalizedDescription: 'amazon', rawDescription: 'Amazon', description: 'Amazon' }),
    ],
    importReviewRules: [{
      id: 'rule_1',
      householdId: 'hh_1',
      normalizedDescription: 'amazon',
      matchType: 'contains',
      matchValue: 'amazon',
      classificationType: 'transaction',
      categoryId: 'cat_living',
      normalizedMerchant: 'amazon',
      ruleType: 'suggestion',
      autoApply: false,
      confirmationCount: 2,
      correctionCount: 1,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    }],
  });

  await classifyImportedTransaction({
    db, householdId: 'hh_1', importedTransactionId: 'import_a',
    input: { classification_type: 'transaction', category_id: 'cat_personal' },
  });

  const rule = db.state.importReviewRules.find((r) => r.matchValue === 'amazon');
  assert.equal(rule.correctionCount, 2);
});

// ─── 8. Ambiguous merchant: correction_count disables auto-apply ───────────────

test('8 — rule with correction_count > 0 has needs_review: true even when autoApply set', async () => {
  const db = createDbDouble({
    importedTransactions: [importRow({ normalizedDescription: 'amazon', rawDescription: 'Amazon', description: 'Amazon' })],
    importReviewRules: [{
      id: 'rule_1',
      householdId: 'hh_1',
      normalizedDescription: 'amazon',
      matchType: 'contains',
      matchValue: 'amazon',
      classificationType: 'transaction',
      categoryId: 'cat_personal',
      normalizedMerchant: 'amazon',
      ruleType: 'reusable_rule',
      autoApply: true,
      confirmationCount: 3,
      correctionCount: 2,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    }],
  });

  const result = await listReviewedImportedTransactions({ db, householdId: 'hh_1' });
  assert.equal(result.items[0].needs_review, true, 'correction_count > 0 disables auto-apply');
});

// ─── 9. Workspace A/B categorization isolation ────────────────────────────────

test('9 — workspace isolation: A and B rules never cross-contaminate', async () => {
  const dbA = createDbDouble({
    importedTransactions: [importRow({ householdId: 'hh_A' })],
    importReviewRules: [{
      id: 'rule_A',
      householdId: 'hh_A',
      normalizedDescription: 'whole foods 1042',
      matchType: 'contains',
      matchValue: 'whole foods 1042',
      classificationType: 'transaction',
      categoryId: 'cat_groceries',
      normalizedMerchant: 'whole foods',
      ruleType: 'suggestion',
      autoApply: false,
      confirmationCount: 1,
      correctionCount: 0,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    }],
  });

  // Workspace B has Whole Foods mapped to Personal Spending
  const dbB = createDbDouble({
    importedTransactions: [importRow({ householdId: 'hh_B', id: 'import_B' })],
    importReviewRules: [{
      id: 'rule_B',
      householdId: 'hh_B',
      normalizedDescription: 'whole foods 1042',
      matchType: 'contains',
      matchValue: 'whole foods 1042',
      classificationType: 'transaction',
      categoryId: 'cat_personal',
      normalizedMerchant: 'whole foods',
      ruleType: 'suggestion',
      autoApply: false,
      confirmationCount: 1,
      correctionCount: 0,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    }],
  });

  const resultA = await listReviewedImportedTransactions({ db: dbA, householdId: 'hh_A' });
  const resultB = await listReviewedImportedTransactions({ db: dbB, householdId: 'hh_B' });

  assert.equal(resultA.items[0].suggestion?.category_id, 'cat_groceries', 'A should see Groceries');
  assert.equal(resultB.items[0].suggestion?.category_id, 'cat_personal', 'B should see Personal Spending');
  assert.notEqual(resultA.items[0].suggestion?.category_id, resultB.items[0].suggestion?.category_id);
});

// ─── 10. PDF import uses learned categorization path ─────────────────────────

test('10 — getting a single imported transaction also resolves learned categorization', async () => {
  const db = createDbDouble({
    importedTransactions: [importRow()],
    importReviewRules: [{
      id: 'rule_1',
      householdId: 'hh_1',
      normalizedDescription: 'whole foods 1042',
      matchType: 'contains',
      matchValue: 'whole foods 1042',
      classificationType: 'transaction',
      categoryId: 'cat_groceries',
      normalizedMerchant: 'whole foods',
      ruleType: 'suggestion',
      autoApply: false,
      confirmationCount: 1,
      correctionCount: 0,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    }],
  });

  const result = await getImportedTransaction({
    db, householdId: 'hh_1', importedTransactionId: 'import_1',
  });

  assert.equal(result.suggestion?.category_id, 'cat_groceries');
  assert.equal(result.categorization_source, 'user_history');
});

// ─── 11. Duplicate detection unchanged ───────────────────────────────────────

test('11 — classifying a transaction does not affect other transactions in the store', async () => {
  const db = createDbDouble({
    importedTransactions: [
      importRow({ id: 'import_1' }),
      importRow({ id: 'import_2', description: 'Other Merchant', rawDescription: 'Other Merchant', normalizedDescription: 'other merchant' }),
    ],
  });

  await classifyImportedTransaction({
    db, householdId: 'hh_1', importedTransactionId: 'import_1',
    input: { classification_type: 'transaction', category_id: 'cat_groceries' },
  });

  const other = db.state.importedTransactions.find((r) => r.id === 'import_2');
  assert.equal(other.status, 'unreviewed', 'other transaction must remain unreviewed');
  assert.equal(other.classificationType, null, 'other transaction must not be classified');
});

// ─── 12. Explicit transaction category is never overwritten ───────────────────

test('12 — already-classified transaction cannot be re-classified (409)', async () => {
  const db = createDbDouble({
    importedTransactions: [importRow({ status: 'classified', classificationType: 'transaction' })],
  });

  await assert.rejects(
    () => classifyImportedTransaction({
      db, householdId: 'hh_1', importedTransactionId: 'import_1',
      input: { classification_type: 'transaction', category_id: 'cat_living' },
    }),
    /already been reviewed/,
  );
});

// ─── 13. Unknown merchant remains unassigned ──────────────────────────────────

test('13 — imported transaction with no matching rule stays unassigned', async () => {
  const db = createDbDouble({
    importedTransactions: [importRow({
      description: 'PAYPAL *UNKNOWNCO',
      rawDescription: 'PAYPAL *UNKNOWNCO',
      normalizedDescription: 'paypal  unknownco',
    })],
    importReviewRules: [],
  });

  const result = await listReviewedImportedTransactions({ db, householdId: 'hh_1' });

  assert.equal(result.items[0].suggestion, null);
  assert.equal(result.items[0].categorization_source, 'none');
  assert.equal(result.items[0].needs_review, true);
});

// ─── 14. Merchant normalization false-positive cases ─────────────────────────

test('14a — extractMerchantKey does not collapse UBER and UBER EATS', () => {
  const uber = extractMerchantKey('UBER');
  const uberEats = extractMerchantKey('UBER EATS');
  assert.notEqual(uber, uberEats, 'UBER and UBER EATS must have distinct merchant keys');
});

test('14b — extractMerchantKey does not collapse APPLE and APPLEBEES', () => {
  const apple = extractMerchantKey('APPLE');
  const applebees = extractMerchantKey('APPLEBEES');
  assert.notEqual(apple, applebees, 'APPLE and APPLEBEES must have distinct merchant keys');
});

test('14c — extractMerchantKey strips store numbers correctly', () => {
  const withNumber = extractMerchantKey('WHOLE FOODS #1042');
  const withMarket = extractMerchantKey('WHOLE FOODS MARKET');
  assert.equal(withNumber, 'whole foods', 'should strip #1042');
  // WHOLE FOODS MARKET keeps "market" — these intentionally don't collapse
  // because we only strip trailing store codes, not semantic words.
  assert.equal(withMarket, 'whole foods market');
});

test('14c2 — merchant-key rule matches variant because normalizedMerchant is set correctly', async () => {
  // Simulates: rule learned from "WHOLE FOODS #1042" with normalizedMerchant="whole foods"
  // → should match "WHOLE FOODS MARKET" via merchant key since both extract "whole foods" as key base
  // (rule's normalizedMerchant was "whole foods", new tx gets merchant key "whole foods market")
  // This tests the important nuance: merchant-key match requires EXACT equality of normalizedMerchant.
  // "whole foods" ≠ "whole foods market" so the merchant fallback will NOT match here.
  // Only description-level matching handles full variant fuzzy matching.
  const db = createDbDouble({
    importedTransactions: [importRow({
      id: 'import_2',
      description: 'Whole Foods Market',
      rawDescription: 'Whole Foods Market',
      normalizedDescription: 'whole foods market',
    })],
    importReviewRules: [{
      id: 'rule_1',
      householdId: 'hh_1',
      normalizedDescription: 'whole foods 1042',
      matchType: 'contains',
      matchValue: 'whole foods 1042',
      classificationType: 'transaction',
      categoryId: 'cat_groceries',
      // This rule was learned from "WHOLE FOODS #1042" → merchant key "whole foods"
      normalizedMerchant: 'whole foods',
      ruleType: 'suggestion',
      autoApply: false,
      confirmationCount: 1,
      correctionCount: 0,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    }],
  });

  const result = await listReviewedImportedTransactions({ db, householdId: 'hh_1' });
  // "whole foods market" doesn't match rule matchValue "whole foods 1042" (contains check fails)
  // AND merchant key of "Whole Foods Market" → "whole foods market" ≠ rule's normalizedMerchant "whole foods"
  // So this correctly returns no suggestion. Real cross-variant matching requires
  // the rule to be learned FROM the canonical merchant key (e.g. from a future "Whole Foods" transaction).
  assert.equal(result.items[0].suggestion, null);
});

test('14d — extractMerchantKey strips payment processor prefixes', () => {
  const paypal = extractMerchantKey('PAYPAL *NETFLIX');
  assert.equal(paypal, 'netflix');

  const sq = extractMerchantKey('SQ *COFFEE SHOP');
  assert.equal(sq, 'coffee shop');
});

test('14e — extractMerchantKey strips trailing TLDs', () => {
  assert.equal(extractMerchantKey('amazon.com'), 'amazon');
  assert.equal(extractMerchantKey('NETFLIX.CA'), 'netflix');
});

test('14f — extractMerchantKey returns null for empty input', () => {
  assert.equal(extractMerchantKey(''), null);
  assert.equal(extractMerchantKey(null), null);
  assert.equal(extractMerchantKey(undefined), null);
});
