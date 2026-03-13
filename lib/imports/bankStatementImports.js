import { z } from 'zod';

import {
  ImportHttpError,
  normalizeIsoDate,
  normalizeMoney,
  normalizeOptionalString,
  parseMoneyToCents,
} from './shared.js';

const uploadBankStatementSchema = z.object({
  filename: z.string().trim().min(1, 'filename is required'),
  contentType: z.string().trim().optional().nullable(),
  pdfBuffer: z.instanceof(Uint8Array),
  currency: z.string().trim().min(3).max(3).optional().default('USD'),
});

function requireDbContract(db) {
  if (typeof db?.transaction !== 'function') {
    throw new Error('Import DB adapter must implement transaction().');
  }
}

function parseWithSchema(schema, input, status = 400) {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue.path.length > 0 ? issue.path.join('.') : 'request';
    throw new ImportHttpError(status, `${path} ${issue.message}`.trim());
  }

  return result.data;
}

function decodePdfLiteralString(value) {
  let result = '';

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char !== '\\') {
      result += char;
      continue;
    }

    const next = value[index + 1];
    if (next == null) {
      break;
    }

    if (/[0-7]/.test(next)) {
      const octal = value.slice(index + 1, index + 4).match(/^[0-7]{1,3}/)?.[0] ?? next;
      result += String.fromCharCode(Number.parseInt(octal, 8));
      index += octal.length;
      continue;
    }

    const replacements = {
      n: '\n',
      r: '\r',
      t: '\t',
      b: '\b',
      f: '\f',
      '(': '(',
      ')': ')',
      '\\': '\\',
    };

    result += replacements[next] ?? next;
    index += 1;
  }

  return result;
}

function extractPdfText(pdfBuffer) {
  const rawText = Buffer.from(pdfBuffer).toString('latin1');
  const literalMatches = [...rawText.matchAll(/\(((?:\\.|[^\\()])*)\)/g)];
  const literalText = literalMatches
    .map((match) => decodePdfLiteralString(match[1]))
    .join('\n');

  const printableText = rawText.replace(/[^\x09\x0A\x0D\x20-\x7E]/g, ' ');
  const combined = `${literalText}\n${printableText}`;

  return combined
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function normalizeStatementDate(value) {
  const raw = String(value ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return normalizeIsoDate(raw, 'date');
  }

  const slashMatch = raw.match(/^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/);
  if (!slashMatch) {
    throw new ImportHttpError(422, 'date must be a valid statement date');
  }

  const [, month, day, yearToken] = slashMatch;
  const year = yearToken.length === 2 ? `20${yearToken}` : yearToken;
  return normalizeIsoDate(`${year}-${month}-${day}`, 'date');
}

function normalizeAmountToken(value) {
  const raw = String(value ?? '').trim().toUpperCase();
  const isNegative = raw.startsWith('(') && raw.endsWith(')');
  const withoutParens = isNegative ? raw.slice(1, -1) : raw;
  const withoutMarkers = withoutParens.replace(/\s+(CR|DR)$/, '');
  const directionMarker = withoutParens.match(/\s+(CR|DR)$/)?.[1] ?? null;
  const unsigned = withoutMarkers.replace(/\$/g, '').replace(/,/g, '');
  const signed = isNegative || directionMarker === 'DR' ? `-${unsigned}` : unsigned;
  return normalizeMoney(signed, 'amount');
}

function buildImportedTransactionRow(transaction, householdId, currency) {
  return {
    householdId,
    date: normalizeIsoDate(transaction.date, 'date'),
    description: normalizeOptionalString(transaction.description),
    amount: normalizeMoney(transaction.amount, 'amount'),
    currency,
    source: 'bank_import',
    rawDescription: normalizeOptionalString(transaction.rawDescription) ?? normalizeOptionalString(transaction.description),
    referenceNumber: normalizeOptionalString(transaction.referenceNumber),
    balanceAfterTransaction: transaction.balanceAfterTransaction == null
      ? null
      : normalizeMoney(transaction.balanceAfterTransaction, 'balance_after_transaction'),
  };
}

function parseStatementLine(line) {
  const trimmed = String(line ?? '').trim();
  if (!trimmed) {
    return null;
  }

  const dateMatch = trimmed.match(/^(?<date>\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{2,4})\s+(?<rest>.+)$/);
  if (!dateMatch) {
    return null;
  }

  const rest = dateMatch.groups.rest.trim();
  const amountMatches = [...rest.matchAll(/(?:\(?\$?\d[\d,]*\.\d{2}\)?(?:\s+(?:CR|DR))?)/g)];
  if (amountMatches.length === 0) {
    return null;
  }

  const amountMatch = amountMatches.length >= 2 ? amountMatches.at(-2) : amountMatches.at(-1);
  const balanceMatch = amountMatches.length >= 2 ? amountMatches.at(-1) : null;
  const description = rest.slice(0, amountMatch.index).trim().replace(/\s{2,}/g, ' ');
  if (!description) {
    throw new ImportHttpError(422, 'description is required');
  }

  const referenceMatch = description.match(/\b(?:REF|REFERENCE|CONFIRMATION|TRACE)[#:\s-]+([A-Z0-9-]+)\b/i);

  return {
    date: normalizeStatementDate(dateMatch.groups.date),
    description,
    amount: normalizeAmountToken(amountMatch[0]),
    rawDescription: description,
    referenceNumber: referenceMatch?.[1] ?? null,
    balanceAfterTransaction: balanceMatch ? normalizeAmountToken(balanceMatch[0]) : null,
  };
}

export function extractImportedTransactionsFromPdf(pdfBuffer) {
  const text = extractPdfText(pdfBuffer);
  if (!text) {
    throw new ImportHttpError(422, 'statement PDF does not contain extractable text');
  }

  const parsed = [];
  const seen = new Set();

  // MVP assumption: the statement is a text-based PDF with one transaction per line,
  // a leading date token, and the transaction amount as the last or second-to-last
  // monetary token when a trailing running balance column is present.
  for (const line of text.split('\n')) {
    const normalizedLine = line.trim().replace(/\s+/g, ' ');
    if (!normalizedLine || seen.has(normalizedLine)) {
      continue;
    }

    seen.add(normalizedLine);
    const row = parseStatementLine(normalizedLine);
    if (row) {
      parsed.push(row);
    }
  }

  if (parsed.length === 0) {
    throw new ImportHttpError(422, 'no transaction rows found in statement PDF');
  }

  return parsed;
}

function formatImportedTransaction(row) {
  return {
    id: row.id,
    household_id: row.householdId,
    date: row.date,
    description: row.description,
    amount: row.amount,
    currency: row.currency,
    source: row.source,
    raw_description: row.rawDescription,
    reference_number: row.referenceNumber ?? null,
    balance_after_transaction: row.balanceAfterTransaction ?? null,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

export async function importBankStatement({ db, householdId, input }) {
  if (!householdId) {
    throw new ImportHttpError(400, 'householdId is required');
  }

  requireDbContract(db);
  const parsedInput = parseWithSchema(uploadBankStatementSchema, input);
  const normalizedCurrency = parsedInput.currency.toUpperCase();

  if (!parsedInput.filename.toLowerCase().endsWith('.pdf')) {
    throw new ImportHttpError(400, 'unsupported format; expected PDF');
  }

  if (parsedInput.contentType && !parsedInput.contentType.toLowerCase().includes('pdf')) {
    throw new ImportHttpError(400, 'contentType must be application/pdf');
  }

  const extractedRows = extractImportedTransactionsFromPdf(parsedInput.pdfBuffer)
    .map((row) => buildImportedTransactionRow(row, householdId, normalizedCurrency));

  return db.transaction(async (tx) => {
    const inserted = await tx.insertImportedTransactions({
      rows: extractedRows,
    });

    return {
      extracted: inserted.length,
      currency: normalizedCurrency,
      items: inserted.map(formatImportedTransaction),
    };
  });
}

export async function listImportedTransactions({ db, householdId }) {
  if (!householdId) {
    throw new ImportHttpError(400, 'householdId is required');
  }

  requireDbContract(db);

  return db.transaction(async (tx) => ({
    items: (await tx.listImportedTransactions({ householdId })).map(formatImportedTransaction),
  }));
}

export const __internal = {
  extractImportedTransactionsFromPdf,
  extractPdfText,
  normalizeAmountToken,
  normalizeStatementDate,
  parseStatementLine,
  formatImportedTransaction,
  buildImportedTransactionRow,
  parseMoneyToCents,
};
