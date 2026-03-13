import { z } from 'zod';

import { ImportHttpError } from './shared.js';

const uploadFileSchema = z.object({
  filename: z.string().trim().min(1, 'filename is required'),
  contentType: z.string().trim().optional().nullable(),
  text: z.string(),
});

function requireDbContract(db) {
  if (typeof db?.transaction !== 'function') {
    throw new Error('Import DB adapter must implement transaction().');
  }
}

function parseWithSchema(schema, input) {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue.path.length > 0 ? issue.path.join('.') : 'request';
    throw new ImportHttpError(400, `${path} ${issue.message}`);
  }

  return result.data;
}

function getExtension(filename) {
  const normalized = filename.trim().toLowerCase();
  const lastDot = normalized.lastIndexOf('.');
  return lastDot === -1 ? '' : normalized.slice(lastDot);
}

function parseCsv(text) {
  const rows = [];
  let current = '';
  let row = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(current);
      current = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') {
        index += 1;
      }

      row.push(current);
      current = '';
      if (row.some((value) => value.length > 0)) {
        rows.push(row);
      }
      row = [];
      continue;
    }

    current += char;
  }

  row.push(current);
  if (row.some((value) => value.length > 0)) {
    rows.push(row);
  }

  return rows;
}

function buildRawDataRows(csvText) {
  const rows = parseCsv(csvText);
  if (rows.length === 0) {
    return [];
  }

  const headers = rows[0].map((value) => String(value ?? '').trim());
  if (headers.some((header) => !header)) {
    throw new ImportHttpError(400, 'CSV header row contains empty column names');
  }

  return rows.slice(1).map((values) => {
    const rawData = {};
    headers.forEach((header, index) => {
      rawData[header] = String(values[index] ?? '').trim();
    });
    return rawData;
  });
}

export async function uploadImportBatch({ db, householdId, input }) {
  if (!householdId) {
    throw new ImportHttpError(400, 'householdId is required');
  }

  requireDbContract(db);
  const parsedInput = parseWithSchema(uploadFileSchema, input);
  const extension = getExtension(parsedInput.filename);

  if (!['.csv', '.xlsx'].includes(extension)) {
    throw new ImportHttpError(400, 'unsupported format; expected CSV or XLSX');
  }

  if (extension === '.xlsx') {
    throw new ImportHttpError(400, 'unsupported format; XLSX parsing is not available in the current MVP implementation');
  }

  const rawRows = buildRawDataRows(parsedInput.text);

  return db.transaction(async (tx) => {
    const batch = await tx.insertImportBatch({
      householdId,
      filename: parsedInput.filename,
      status: 'uploaded',
      rowCount: rawRows.length,
    });

    if (rawRows.length > 0) {
      await tx.insertImportedRows({
        householdId,
        batchId: batch.id,
        rows: rawRows.map((rawData) => ({
          householdId,
          batchId: batch.id,
          rawData,
          rawDate: null,
          rawDescription: null,
          rawMerchant: null,
          rawAmount: null,
          rawDirection: null,
          status: 'pending',
        })),
      });
    }

    return {
      batchId: batch.id,
      filename: batch.filename,
      rowCount: batch.rowCount ?? rawRows.length,
    };
  });
}
