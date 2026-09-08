import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDebt } from '../lib/debts/debts.js';
import { createGoal } from '../lib/goals/goals.js';
import { createFixedBill } from '../lib/household/fixedBills.js';
import { createIncome } from '../lib/income/createIncome.js';
import { createSqliteDb } from '../lib/server/sqliteDb.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, '..');
const dbPath = process.env.RAF_DB_PATH
  ? path.resolve(appRoot, process.env.RAF_DB_PATH)
  : path.resolve(appRoot, 'db', 'raf.sqlite');

const db = createSqliteDb({ dbPath });
const householdId = db.defaultHouseholdId;

async function getActiveCategoryIdBySlug(slug) {
  return db.transaction(async (tx) => {
    const categories = await tx.listAllocationCategories({ householdId });
    return categories.find((category) => category.slug === slug && category.isActive !== false)?.id ?? null;
  });
}

async function seedIncome() {
  await createIncome({
    db,
    householdId,
    idempotencyKey: 'seed-demo-income-payroll',
    input: {
      sourceName: 'Primary Payroll',
      amount: '4200.00',
      receivedDate: '2026-03-10',
      notes: 'Demo seed',
    },
  });

  await createIncome({
    db,
    householdId,
    idempotencyKey: 'seed-demo-income-side',
    input: {
      sourceName: 'Side Consulting',
      amount: '950.00',
      receivedDate: '2026-03-17',
      notes: 'Demo seed',
    },
  });
}

async function seedFixedBills() {
  const existingByName = await db.transaction(async (tx) => {
    const existing = await tx.listFixedBills({ householdId });
    return new Set(existing.map((row) => String(row.name).toLowerCase()));
  });

  const defaults = [
    { name: 'Rent', category_slug: 'fixed_bills', expected_amount: '1850.00', due_day_of_month: 1 },
    { name: 'Phone', category_slug: 'fixed_bills', expected_amount: '95.00', due_day_of_month: 9 },
    { name: 'Internet', category_slug: 'fixed_bills', expected_amount: '75.00', due_day_of_month: 15 },
  ];

  for (const bill of defaults) {
    if (existingByName.has(bill.name.toLowerCase())) {
      continue;
    }

    await createFixedBill({
      db,
      householdId,
      input: {
        ...bill,
        active: true,
      },
    });
  }
}

async function seedDebts() {
  const existingByName = await db.transaction(async (tx) => {
    const existing = await tx.listDebts({ householdId });
    return new Set(existing.map((row) => String(row.name).toLowerCase()));
  });

  const debts = [
    {
      name: 'Visa',
      startingBalance: '4200.00',
      apr: 19.99,
      minimumPayment: '120.00',
      monthlyPayment: '220.00',
      sortOrder: 1,
    },
    {
      name: 'Auto Loan',
      startingBalance: '9800.00',
      apr: 6.49,
      minimumPayment: '280.00',
      monthlyPayment: '340.00',
      sortOrder: 2,
    },
  ];

  for (const debt of debts) {
    if (existingByName.has(debt.name.toLowerCase())) {
      continue;
    }

    await createDebt({
      db,
      householdId,
      input: debt,
    });
  }
}

async function seedGoals() {
  const savingsBucketId = await getActiveCategoryIdBySlug('savings');
  if (!savingsBucketId) {
    throw new Error('Cannot seed goals: missing active savings bucket.');
  }

  const goals = [
    {
      bucket_id: savingsBucketId,
      name: 'Emergency Fund',
      target_amount: '10000.00',
      target_date: '2026-12-31',
      notes: 'Six-month reserve',
    },
    {
      bucket_id: savingsBucketId,
      name: 'Travel',
      target_amount: '2500.00',
      target_date: '2026-09-30',
      notes: 'Autumn trip',
    },
  ];

  const existingByName = await db.transaction(async (tx) => {
    const existing = await tx.listGoals({ householdId });
    return new Set(existing.map((row) => String(row.name).toLowerCase()));
  });

  for (const goal of goals) {
    if (existingByName.has(goal.name.toLowerCase())) {
      continue;
    }

    await createGoal({
      db,
      householdId,
      input: goal,
    });
  }
}

async function run() {
  await seedIncome();
  await seedFixedBills();
  await seedDebts();
  await seedGoals();

  console.info(`Demo data seeded for household ${householdId} in ${dbPath}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
