import test from 'node:test';
import assert from 'node:assert/strict';

import { GET, POST } from '../app/api/v1/income/route.js';
import { DELETE, PATCH } from '../app/api/v1/income/[id]/route.js';
import { createIncome, deleteIncome, listIncome, updateIncome } from '../lib/income/createIncome.js';
import { replaceHouseholdAllocationCategories } from '../lib/household/allocationCategories.js';
import { createInMemoryDb } from '../lib/server/inMemoryDb.js';

function createDbDouble({
  categories,
  incomeEntries = [],
  existingIncome = null,
  existingAllocations = [],
} = {}) {
  const state = {
    incomeEntries: incomeEntries.map((entry) => ({ ...entry })),
    insertedIncomeEntry: null,
    updatedIncomeEntry: null,
    insertedIncomeAllocations: null,
    deletedIncomeAllocationsFor: null,
    deletedIncomeEntry: null,
  };

  const tx = {
    async findIncomeByIdempotencyKey({ idempotencyKey }) {
      if (existingIncome && existingIncome.idempotencyKey === idempotencyKey) {
        return existingIncome;
      }

      return state.incomeEntries.find((entry) => entry.idempotencyKey === idempotencyKey) ?? null;
    },
    async listIncomeAllocations({ incomeEntryId }) {
      if (existingIncome?.id === incomeEntryId) {
        return existingAllocations;
      }

      return existingAllocations;
    },
    async listAllocationCategories() {
      return categories ?? [];
    },
    async insertIncomeEntry(payload) {
      state.insertedIncomeEntry = payload;
      const row = {
        id: 'income_123',
        ...payload,
      };
      state.incomeEntries.push(row);
      return row;
    },
    async insertIncomeAllocations(rows) {
      state.insertedIncomeAllocations = rows;
      return rows;
    },
    async listIncomeEntries({ from, to }) {
      return state.incomeEntries.filter((entry) => entry.receivedDate >= from && entry.receivedDate <= to);
    },
    async getIncomeEntryById({ incomeId }) {
      return state.incomeEntries.find((entry) => entry.id === incomeId) ?? null;
    },
    async updateIncomeEntry({ incomeId, patch }) {
      const index = state.incomeEntries.findIndex((entry) => entry.id === incomeId);
      state.incomeEntries[index] = {
        ...state.incomeEntries[index],
        ...patch,
      };
      state.updatedIncomeEntry = state.incomeEntries[index];
      return state.incomeEntries[index];
    },
    async deleteIncomeAllocationsByIncomeEntryId({ incomeEntryId }) {
      state.deletedIncomeAllocationsFor = incomeEntryId;
    },
    async deleteIncomeEntry({ incomeId }) {
      state.deletedIncomeEntry = incomeId;
      state.incomeEntries = state.incomeEntries.filter((entry) => entry.id !== incomeId);
    },
  };

  return {
    state,
    async transaction(callback) {
      return callback(tx);
    },
  };
}

function defaultCategories() {
  return [
    { id: 'cat_savings', slug: 'savings', label: 'Savings', allocationPercent: '0.2500', sortOrder: 1, isActive: true },
    { id: 'cat_bills', slug: 'fixed_bills', label: 'Fixed Bills', allocationPercent: '0.5000', sortOrder: 2, isActive: true },
    { id: 'cat_buffer', slug: 'buffer', label: 'Buffer', allocationPercent: '0.2500', sortOrder: 3, isActive: true },
  ];
}

test('createIncome creates deterministic allocation rows and response payload', async () => {
  const db = createDbDouble({
    categories: defaultCategories(),
  });

  const result = await createIncome({
    db,
    householdId: 'household_1',
    idempotencyKey: 'dep-1',
    input: {
      sourceName: 'Payroll',
      amount: '100.01',
      receivedDate: '2026-03-12',
      notes: 'March deposit',
    },
  });

  assert.equal(result.incomeId, 'income_123');
  assert.equal(db.state.insertedIncomeEntry.amount, '100.01');
  assert.deepEqual(db.state.insertedIncomeAllocations, [
    {
      householdId: 'household_1',
      incomeEntryId: 'income_123',
      allocationCategoryId: 'cat_savings',
      allocationPercent: '0.2500',
      allocatedAmount: '25.00',
    },
    {
      householdId: 'household_1',
      incomeEntryId: 'income_123',
      allocationCategoryId: 'cat_bills',
      allocationPercent: '0.5000',
      allocatedAmount: '50.00',
    },
    {
      householdId: 'household_1',
      incomeEntryId: 'income_123',
      allocationCategoryId: 'cat_buffer',
      allocationPercent: '0.2500',
      allocatedAmount: '25.01',
    },
  ]);
  assert.deepEqual(result.allocations, [
    { category: 'Savings', slug: 'savings', amount: '25.00' },
    { category: 'Fixed Bills', slug: 'fixed_bills', amount: '50.00' },
    { category: 'Buffer', slug: 'buffer', amount: '25.01' },
  ]);
});

test('createIncome returns the original record for a matching idempotency key', async () => {
  const db = createDbDouble({
    existingIncome: {
      id: 'income_existing',
      sourceName: 'Payroll',
      amount: '100.00',
      receivedDate: '2026-03-12',
      notes: null,
      idempotencyKey: 'dep-1',
    },
    existingAllocations: [
      { label: 'Savings', slug: 'savings', amount: '20.00' },
      { label: 'Buffer', slug: 'buffer', amount: '80.00' },
    ],
  });

  const result = await createIncome({
    db,
    householdId: 'household_1',
    idempotencyKey: 'dep-1',
    input: {
      sourceName: 'Payroll',
      amount: '100.00',
      receivedDate: '2026-03-12',
    },
  });

  assert.equal(result.created, false);
  assert.equal(result.incomeId, 'income_existing');
  assert.equal(db.state.insertedIncomeEntry, null);
  assert.deepEqual(result.allocations, [
    { category: 'Savings', slug: 'savings', amount: '20.00' },
    { category: 'Buffer', slug: 'buffer', amount: '80.00' },
  ]);
});

test('createIncome rejects an idempotency key reused with a different payload', async () => {
  const db = createDbDouble({
    existingIncome: {
      id: 'income_existing',
      sourceName: 'Payroll',
      amount: '100.00',
      receivedDate: '2026-03-12',
      notes: null,
      idempotencyKey: 'dep-1',
    },
  });

  await assert.rejects(
    () =>
      createIncome({
        db,
        householdId: 'household_1',
        idempotencyKey: 'dep-1',
        input: {
          sourceName: 'Payroll',
          amount: '101.00',
          receivedDate: '2026-03-12',
        },
      }),
    /Idempotency-Key already exists/,
  );
});

test('createIncome rejects invalid allocation sums from active categories', async () => {
  const db = createDbDouble({
    categories: [
      { id: 'cat_savings', slug: 'savings', label: 'Savings', allocationPercent: '0.3000', sortOrder: 1, isActive: true },
      { id: 'cat_buffer', slug: 'buffer', label: 'Buffer', allocationPercent: '0.3000', sortOrder: 2, isActive: true },
    ],
  });

  await assert.rejects(
    () =>
      createIncome({
        db,
        householdId: 'household_1',
        input: {
          sourceName: 'Payroll',
          amount: '100.00',
          receivedDate: '2026-03-12',
        },
      }),
    /must sum to 1\.0000/,
  );
});

test('listIncome returns items and total for a date range', async () => {
  const db = createDbDouble({
    incomeEntries: [
      { id: 'income_1', sourceName: 'Payroll', amount: '100.00', receivedDate: '2026-03-01', notes: null },
      { id: 'income_2', sourceName: 'Bonus', amount: '50.25', receivedDate: '2026-03-15', notes: 'Quarterly' },
      { id: 'income_3', sourceName: 'Payroll', amount: '90.00', receivedDate: '2026-04-01', notes: null },
    ],
  });

  const result = await listIncome({
    db,
    householdId: 'household_1',
    query: {
      from: '2026-03-01',
      to: '2026-03-31',
    },
  });

  assert.deepEqual(result, {
    items: [
      { incomeId: 'income_1', sourceName: 'Payroll', amount: '100.00', receivedDate: '2026-03-01', notes: null },
      { incomeId: 'income_2', sourceName: 'Bonus', amount: '50.25', receivedDate: '2026-03-15', notes: 'Quarterly' },
    ],
    total: '150.25',
  });
});

test('updateIncome updates the entry and recreates allocations inside the transaction', async () => {
  const db = createDbDouble({
    categories: defaultCategories(),
    incomeEntries: [
      { id: 'income_1', sourceName: 'Payroll', amount: '100.00', receivedDate: '2026-03-12', notes: null },
    ],
  });

  const result = await updateIncome({
    db,
    householdId: 'household_1',
    incomeId: 'income_1',
    input: {
      amount: '120.01',
      notes: 'Updated',
    },
  });

  assert.equal(db.state.deletedIncomeAllocationsFor, 'income_1');
  assert.equal(db.state.updatedIncomeEntry.amount, '120.01');
  assert.deepEqual(db.state.insertedIncomeAllocations, [
    {
      householdId: 'household_1',
      incomeEntryId: 'income_1',
      allocationCategoryId: 'cat_savings',
      allocationPercent: '0.2500',
      allocatedAmount: '30.00',
    },
    {
      householdId: 'household_1',
      incomeEntryId: 'income_1',
      allocationCategoryId: 'cat_bills',
      allocationPercent: '0.5000',
      allocatedAmount: '60.00',
    },
    {
      householdId: 'household_1',
      incomeEntryId: 'income_1',
      allocationCategoryId: 'cat_buffer',
      allocationPercent: '0.2500',
      allocatedAmount: '30.01',
    },
  ]);
  assert.equal(result.notes, 'Updated');
});

test('deleteIncome deletes the income entry inside the transaction', async () => {
  const db = createDbDouble({
    incomeEntries: [
      { id: 'income_1', sourceName: 'Payroll', amount: '100.00', receivedDate: '2026-03-12', notes: null },
    ],
  });

  await deleteIncome({
    db,
    householdId: 'household_1',
    incomeId: 'income_1',
  });

  assert.equal(db.state.deletedIncomeEntry, 'income_1');
});

test('income routes cover POST, GET, PATCH, and DELETE', async () => {
  const db = createDbDouble({
    categories: defaultCategories(),
    incomeEntries: [
      { id: 'income_1', sourceName: 'Payroll', amount: '100.00', receivedDate: '2026-03-12', notes: null },
    ],
  });

  const postResponse = await POST(
    new Request('http://localhost/api/v1/income', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-household-id': 'household_1',
      },
      body: JSON.stringify({
        sourceName: 'Consulting',
        amount: '80.01',
        receivedDate: '2026-03-12',
      }),
    }),
    { db },
  );

  assert.equal(postResponse.status, 201);

  const getResponse = await GET(
    new Request('http://localhost/api/v1/income?from=2026-03-01&to=2026-03-31', {
      headers: { 'x-household-id': 'household_1' },
    }),
    { db },
  );

  assert.equal(getResponse.status, 200);

  const patchResponse = await PATCH(
    new Request('http://localhost/api/v1/income/income_1', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        'x-household-id': 'household_1',
      },
      body: JSON.stringify({ amount: '110.00' }),
    }),
    { db, params: { id: 'income_1' } },
  );

  assert.equal(patchResponse.status, 200);
  assert.equal((await patchResponse.json()).amount, '110.00');

  const deleteResponse = await DELETE(
    new Request('http://localhost/api/v1/income/income_1', {
      method: 'DELETE',
      headers: { 'x-household-id': 'household_1' },
    }),
    { db, params: { id: 'income_1' } },
  );

  assert.equal(deleteResponse.status, 204);
});

test('deposit dated Feb 15 uses the February allocation snapshot after a March change', async () => {
  const db = createInMemoryDb();

  await replaceHouseholdAllocationCategories({
    db,
    householdId: db.defaultHouseholdId,
    effectiveDate: '2026-03-01',
    input: {
      items: [
        { slug: 'savings', label: 'Savings', allocationPercent: '0.2000', sortOrder: 1, isActive: true },
        { slug: 'fixed_bills', label: 'Fixed Bills', allocationPercent: '0.2000', sortOrder: 2, isActive: true },
        { slug: 'personal_spending', label: 'Personal Spending', allocationPercent: '0.1500', sortOrder: 3, isActive: true },
        { slug: 'investment', label: 'Investment', allocationPercent: '0.1000', sortOrder: 4, isActive: true },
        { slug: 'debt_payoff', label: 'Debt Payoff', allocationPercent: '0.1000', sortOrder: 5, isActive: true },
        { slug: 'buffer', label: 'Buffer', allocationPercent: '0.2500', sortOrder: 9, isActive: true },
      ],
    },
  });

  const result = await createIncome({
    db,
    householdId: db.defaultHouseholdId,
    input: {
      sourceName: 'Payroll',
      amount: '100.00',
      receivedDate: '2026-02-15',
    },
  });

  assert.equal(result.allocations.find((item) => item.slug === 'savings')?.amount, '10.00');
});

test('deposit dated Mar 10 uses the March allocation snapshot after a March change', async () => {
  const db = createInMemoryDb();

  await replaceHouseholdAllocationCategories({
    db,
    householdId: db.defaultHouseholdId,
    effectiveDate: '2026-03-01',
    input: {
      items: [
        { slug: 'savings', label: 'Savings', allocationPercent: '0.2000', sortOrder: 1, isActive: true },
        { slug: 'fixed_bills', label: 'Fixed Bills', allocationPercent: '0.2000', sortOrder: 2, isActive: true },
        { slug: 'personal_spending', label: 'Personal Spending', allocationPercent: '0.1500', sortOrder: 3, isActive: true },
        { slug: 'investment', label: 'Investment', allocationPercent: '0.1000', sortOrder: 4, isActive: true },
        { slug: 'debt_payoff', label: 'Debt Payoff', allocationPercent: '0.1000', sortOrder: 5, isActive: true },
        { slug: 'buffer', label: 'Buffer', allocationPercent: '0.2500', sortOrder: 9, isActive: true },
      ],
    },
  });

  const result = await createIncome({
    db,
    householdId: db.defaultHouseholdId,
    input: {
      sourceName: 'Payroll',
      amount: '100.00',
      receivedDate: '2026-03-10',
    },
  });

  assert.equal(result.allocations.find((item) => item.slug === 'savings')?.amount, '20.00');
});

test('same-day allocation changes take effect immediately for deposits on that day', async () => {
  const db = createInMemoryDb();

  await replaceHouseholdAllocationCategories({
    db,
    householdId: db.defaultHouseholdId,
    effectiveDate: '2026-03-01',
    input: {
      items: [
        { slug: 'savings', label: 'Savings', allocationPercent: '0.2000', sortOrder: 1, isActive: true },
        { slug: 'fixed_bills', label: 'Fixed Bills', allocationPercent: '0.2000', sortOrder: 2, isActive: true },
        { slug: 'personal_spending', label: 'Personal Spending', allocationPercent: '0.1500', sortOrder: 3, isActive: true },
        { slug: 'investment', label: 'Investment', allocationPercent: '0.1000', sortOrder: 4, isActive: true },
        { slug: 'debt_payoff', label: 'Debt Payoff', allocationPercent: '0.1000', sortOrder: 5, isActive: true },
        { slug: 'buffer', label: 'Buffer', allocationPercent: '0.2500', sortOrder: 9, isActive: true },
      ],
    },
  });

  const result = await createIncome({
    db,
    householdId: db.defaultHouseholdId,
    input: {
      sourceName: 'Payroll',
      amount: '100.00',
      receivedDate: '2026-03-01',
    },
  });

  assert.equal(result.allocations.find((item) => item.slug === 'savings')?.amount, '20.00');
});
