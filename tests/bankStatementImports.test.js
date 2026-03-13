import test from 'node:test';
import assert from 'node:assert/strict';

import { GET as listImportsRoute } from '../app/api/v1/imports/route.js';
import { POST as importBankStatementRoute } from '../app/api/v1/imports/bank-statement/route.js';
import {
  __internal,
  importBankStatement,
  listImportedTransactions,
} from '../lib/imports/bankStatementImports.js';

function createPdfFixture(textLines) {
  const body = textLines.map((line) => `(${line}) Tj`).join('\n');
  return Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Length ${body.length} >>\nstream\n${body}\nendstream\nendobj\n%%EOF`);
}

function createDbDouble({ importedTransactions = [] } = {}) {
  const state = {
    importedTransactions: importedTransactions.map((row) => ({ ...row })),
  };

  const tx = {
    async insertImportedTransactions({ rows }) {
      const inserted = rows.map((row, index) => ({
        id: `import_${state.importedTransactions.length + index + 1}`,
        createdAt: '2026-03-13T00:00:00.000Z',
        updatedAt: '2026-03-13T00:00:00.000Z',
        ...row,
      }));
      state.importedTransactions.push(...inserted);
      return inserted.map((row) => ({ ...row }));
    },
    async listImportedTransactions({ householdId }) {
      return state.importedTransactions
        .filter((row) => row.householdId === householdId)
        .map((row) => ({ ...row }));
    },
  };

  return {
    state,
    async transaction(callback) {
      return callback(tx);
    },
  };
}

test('importBankStatement extracts normalized imported transactions from a text-based PDF statement', async () => {
  const db = createDbDouble();
  const result = await importBankStatement({
    db,
    householdId: 'household_1',
    input: {
      filename: 'statement.pdf',
      contentType: 'application/pdf',
      pdfBuffer: createPdfFixture([
        '2026-03-10 COFFEE SHOP 12.99 980.00',
        '2026-03-11 PAYROLL 1000.00 1980.00',
      ]),
    },
  });

  assert.equal(result.extracted, 2);
  assert.deepEqual(result.items.map((item) => ({
    date: item.date,
    description: item.description,
    amount: item.amount,
    balance_after_transaction: item.balance_after_transaction,
  })), [
    {
      date: '2026-03-10',
      description: 'COFFEE SHOP',
      amount: '12.99',
      balance_after_transaction: '980.00',
    },
    {
      date: '2026-03-11',
      description: 'PAYROLL',
      amount: '1000.00',
      balance_after_transaction: '1980.00',
    },
  ]);
});

test('normalization logic handles slash dates and signed debit amounts', () => {
  const parsed = __internal.parseStatementLine('03/10/2026 GROCERY STORE (45.61) 500.22');

  assert.deepEqual(parsed, {
    date: '2026-03-10',
    description: 'GROCERY STORE',
    amount: '-45.61',
    rawDescription: 'GROCERY STORE',
    referenceNumber: null,
    balanceAfterTransaction: '500.22',
  });
});

test('importBankStatement rejects unreadable PDFs and inserts nothing', async () => {
  const db = createDbDouble();

  await assert.rejects(
    () => importBankStatement({
      db,
      householdId: 'household_1',
      input: {
        filename: 'statement.pdf',
        contentType: 'application/pdf',
        pdfBuffer: Buffer.from('%PDF-1.4\n%%EOF'),
      },
    }),
    /statement PDF does not contain extractable text|no transaction rows found/,
  );
  assert.equal(db.state.importedTransactions.length, 0);
});

test('importBankStatement rejects empty statements and inserts nothing', async () => {
  const db = createDbDouble();

  await assert.rejects(
    () => importBankStatement({
      db,
      householdId: 'household_1',
      input: {
        filename: 'statement.pdf',
        contentType: 'application/pdf',
        pdfBuffer: createPdfFixture(['Statement Period 03/01/2026 - 03/31/2026']),
      },
    }),
    /no transaction rows found/,
  );
  assert.equal(db.state.importedTransactions.length, 0);
});

test('imports routes expose PDF upload and imported transaction listing', async () => {
  const db = createDbDouble();
  const formData = new FormData();
  formData.set(
    'file',
    new File(
      [createPdfFixture(['2026-03-10 COFFEE SHOP 12.99 980.00'])],
      'statement.pdf',
      { type: 'application/pdf' },
    ),
  );

  const uploadResponse = await importBankStatementRoute(
    new Request('http://localhost/api/v1/imports/bank-statement', {
      method: 'POST',
      headers: {
        'x-household-id': 'household_1',
      },
      body: formData,
    }),
    { db },
  );
  assert.equal(uploadResponse.status, 201);
  assert.equal((await uploadResponse.json()).extracted, 1);

  const listResponse = await listImportsRoute(
    new Request('http://localhost/api/v1/imports', {
      headers: { 'x-household-id': 'household_1' },
    }),
    { db },
  );
  assert.equal(listResponse.status, 200);
  assert.equal((await listResponse.json()).items.length, 1);
});

test('listImportedTransactions is household scoped', async () => {
  const db = createDbDouble({
    importedTransactions: [
      {
        id: 'import_1',
        householdId: 'household_1',
        date: '2026-03-10',
        description: 'Coffee',
        amount: '12.99',
        currency: 'USD',
        source: 'bank_import',
        rawDescription: 'Coffee',
        referenceNumber: null,
        balanceAfterTransaction: null,
        createdAt: '2026-03-13T00:00:00.000Z',
        updatedAt: '2026-03-13T00:00:00.000Z',
      },
      {
        id: 'import_2',
        householdId: 'household_2',
        date: '2026-03-10',
        description: 'Other',
        amount: '9.99',
        currency: 'USD',
        source: 'bank_import',
        rawDescription: 'Other',
        referenceNumber: null,
        balanceAfterTransaction: null,
        createdAt: '2026-03-13T00:00:00.000Z',
        updatedAt: '2026-03-13T00:00:00.000Z',
      },
    ],
  });

  const result = await listImportedTransactions({
    db,
    householdId: 'household_1',
  });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].household_id, 'household_1');
});
