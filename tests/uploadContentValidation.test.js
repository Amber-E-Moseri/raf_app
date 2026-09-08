import test from 'node:test';
import assert from 'node:assert/strict';

import { importBankStatement } from '../lib/imports/bankStatementImports.js';
import { uploadImportBatch } from '../lib/imports/uploadImportBatch.js';
import { createInMemoryDb } from '../lib/server/inMemoryDb.js';

function createPdfFixture(textLines) {
  const body = textLines.map((line) => `(${line}) Tj`).join('\n');
  return Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Length ${body.length} >>\nstream\n${body}\nendstream\nendobj\n%%EOF`);
}

test('valid CSV and PDF statement uploads remain accepted', async () => {
  const db = createInMemoryDb();
  const csv = await uploadImportBatch({
    db,
    householdId: 'household_1',
    input: {
      filename: 'statement.csv',
      text: 'Date,Description,Amount\n2026-03-01,Coffee,4.25\n',
    },
  });
  assert.equal(csv.rowCount, 1);

  const pdf = await importBankStatement({
    db,
    householdId: 'household_1',
    pdfTextExtractor: async () => '2026-03-01 COFFEE 4.25 100.00',
    input: {
      filename: 'statement.pdf',
      contentType: 'application/pdf',
      pdfBuffer: createPdfFixture(['2026-03-01 COFFEE 4.25 100.00']),
    },
  });
  assert.equal(pdf.extracted, 1);
});

test('renamed executable is rejected before PDF parsing', async () => {
  const db = createInMemoryDb();
  let extractorCalled = false;
  await assert.rejects(
    () => importBankStatement({
      db,
      householdId: 'household_1',
      pdfTextExtractor: async () => {
        extractorCalled = true;
        return '2026-03-01 COFFEE 4.25 100.00';
      },
      input: {
        filename: 'statement.pdf',
        contentType: 'application/pdf',
        pdfBuffer: Buffer.from('MZfake executable'),
      },
    }),
    /uploaded file content is not a supported statement format/,
  );
  assert.equal(extractorCalled, false);
});

test('binary CSV, empty files, and structurally invalid CSV files are rejected', async () => {
  const db = createInMemoryDb();

  await assert.rejects(
    () => uploadImportBatch({
      db,
      householdId: 'household_1',
      input: {
        filename: 'statement.csv',
        text: Buffer.from([0x00, 0x01, 0x02, 0x03]).toString('utf8'),
      },
    }),
    /uploaded CSV content is binary|unsupported binary control characters/,
  );

  await assert.rejects(
    () => uploadImportBatch({
      db,
      householdId: 'household_1',
      input: {
        filename: 'empty.csv',
        text: '',
      },
    }),
    /uploaded file is empty/,
  );

  await assert.rejects(
    () => importBankStatement({
      db,
      householdId: 'household_1',
      input: {
        filename: 'empty.pdf',
        contentType: 'application/pdf',
        pdfBuffer: new Uint8Array(),
      },
    }),
    /uploaded file is empty/,
  );

  await assert.rejects(
    () => uploadImportBatch({
      db,
      householdId: 'household_1',
      input: {
        filename: 'garbage.csv',
        text: 'not a csv statement',
      },
    }),
    /CSV header row must contain at least two columns/,
  );
});

test('malicious filenames are sanitized before import batch storage', async () => {
  const db = createInMemoryDb();
  const result = await uploadImportBatch({
    db,
    householdId: 'household_1',
    input: {
      filename: '..\\..\\evil\u0000<script>.csv',
      text: 'Date,Description,Amount\n2026-03-01,Coffee,4.25\n',
    },
  });

  assert.equal(result.filename, 'evil_script_.csv');
  assert.equal(db.state.importBatches[0].filename, 'evil_script_.csv');
});
