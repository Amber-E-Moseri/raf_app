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

async function loadPdfParse() {
  try {
    const module = await import('pdf-parse');
    return module.default ?? module;
  } catch (error) {
    throw new ImportHttpError(500, 'PDF parsing dependency is unavailable', {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

function normalizeDecodedPdfText(text) {
  return String(text ?? '')
    .replace(/\u0000/g, ' ')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function extractPdfText(pdfBuffer, options = {}) {
  const extractor = options.pdfTextExtractor ?? null;

  try {
    const pdfData = Buffer.from(pdfBuffer);
    const decodedText = extractor
      ? await extractor(pdfData)
      : (await (await loadPdfParse())(pdfData))?.text ?? '';

    const normalized = normalizeDecodedPdfText(decodedText);
    if (!normalized) {
      throw new ImportHttpError(422, 'statement PDF did not contain decoded text');
    }

    return normalized;
  } catch (error) {
    if (error instanceof ImportHttpError) {
      throw error;
    }

    throw new ImportHttpError(422, 'unable to decode readable text from PDF', {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

function logPdfTextPreview(text) {
  const preview = String(text ?? '').slice(0, 3000);
  console.info('[RAF bank import] extracted PDF text preview:', preview);
}

function logNormalizedLines(lines) {
  console.info('[RAF bank import] normalized candidate lines:', lines.slice(0, 100));
}

function logRejectedCandidates(rejections) {
  console.info(
    '[RAF bank import] rejected candidate lines:',
    rejections.slice(0, 50).map((item) => ({
      line: item.line,
      reason: item.reason,
    })),
  );
}

function logParseSummary(lines, matchedRowCount) {
  console.info('[RAF bank import] parse summary:', {
    lines_scanned: lines.length,
    matched_rows_count: matchedRowCount,
  });
}

function parseSlashDateWithYear(raw) {
  const slashMatch = raw.match(/^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/);
  if (!slashMatch) {
    return null;
  }

  const [, first, second, yearToken] = slashMatch;
  const year = yearToken.length === 2 ? `20${yearToken}` : yearToken;
  const firstNumber = Number(first);
  const secondNumber = Number(second);

  if (firstNumber > 12) {
    return normalizeIsoDate(`${year}-${second}-${first}`, 'date');
  }

  if (secondNumber > 12) {
    return normalizeIsoDate(`${year}-${first}-${second}`, 'date');
  }

  // Ambiguous slash dates default to MM/DD/YYYY for the MVP parser.
  return normalizeIsoDate(`${year}-${first}-${second}`, 'date');
}

function deriveYearForShortDate(monthToken, dayToken, statementContext) {
  const month = Number(monthToken);
  const day = Number(dayToken);
  if (!Number.isInteger(month) || !Number.isInteger(day)) {
    throw new ImportHttpError(422, 'date must be a valid statement date');
  }

  const periodStart = statementContext?.periodStart ?? null;
  const periodEnd = statementContext?.periodEnd ?? null;
  if (!periodStart || !periodEnd) {
    return new Date().getUTCFullYear();
  }

  const startYear = Number(periodStart.slice(0, 4));
  const endYear = Number(periodEnd.slice(0, 4));
  const candidates = [...new Set([startYear, endYear])];

  for (const year of candidates) {
    const isoDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const normalized = normalizeIsoDate(isoDate, 'date');
    if (normalized >= periodStart && normalized <= periodEnd) {
      return year;
    }
  }

  return endYear;
}

function normalizeStatementDate(value, statementContext = null) {
  const raw = String(value ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return normalizeIsoDate(raw, 'date');
  }

  const slashDateWithYear = parseSlashDateWithYear(raw);
  if (slashDateWithYear) {
    return slashDateWithYear;
  }

  const shortSlashMatch = raw.match(/^(\d{2})\/(\d{2})$/);
  if (!shortSlashMatch) {
    throw new ImportHttpError(422, 'date must be a valid statement date');
  }

  const [, monthToken, dayToken] = shortSlashMatch;
  const derivedYear = deriveYearForShortDate(monthToken, dayToken, statementContext);
  return normalizeIsoDate(`${derivedYear}-${monthToken}-${dayToken}`, 'date');
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
    status: 'unreviewed',
    classificationType: null,
    linkedTransactionId: null,
    linkedDebtId: null,
    linkedFixedBillId: null,
    reviewedAt: null,
    reviewNote: null,
  };
}

const dateTokenPattern = /\b(?:\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}(?:\/\d{2,4})?)\b/g;
const amountTokenPattern = /(?:\(?-?\$?\d[\d,]*\.\d{2}\)?(?:\s*(?:CR|DR))?)/g;
const leadingDatePattern = /^(?<date>\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}(?:\/\d{2,4})?)\b/;
const noiseLinePattern = /^(?:statement\s+period|page\s+\d+|beginning\s+balance|ending\s+balance|account\s+number|account\s+summary|transactions?|description|date|amount|balance|deposits?|withdrawals?|payments?|checks?)\b/i;
const headerNoiseFragmentPattern = /(?:sample\s+bank\s+statement|account\s+holder|account\s+number|statement\s+period|datedescriptionamount(?:\s*\([^)]+\))?balance|opening\s+balance)/gi;

function stripHeaderNoiseFragments(value) {
  return String(value ?? '').replace(headerNoiseFragmentPattern, ' ');
}

function extractStatementContext(text) {
  const normalizedText = String(text ?? '').replace(/\s+/g, ' ').trim();
  const fullDateMatches = [...normalizedText.matchAll(/\b(?:\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{2,4})\b/g)]
    .map((match) => {
      try {
        return normalizeStatementDate(match[0]);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort();

  if (fullDateMatches.length < 2) {
    return {
      periodStart: null,
      periodEnd: fullDateMatches[0] ?? null,
    };
  }

  return {
    periodStart: fullDateMatches[0],
    periodEnd: fullDateMatches.at(-1),
  };
}

function splitStatementRows(decodedText) {
  const normalizedText = String(decodedText ?? '')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();

  if (!normalizedText) {
    return [];
  }

  const rawLines = normalizedText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const source = rawLines.length > 3
    ? rawLines.join('\n')
    : normalizedText.replace(/\n+/g, ' ');

  return source
    .replace(/(?=\d{4}-\d{2}-\d{2})/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function splitIntoCandidateLines(text) {
  return splitStatementRows(text)
    .map((line) => stripHeaderNoiseFragments(line))
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function isNoiseLine(line) {
  const normalized = String(line ?? '').trim().replace(/\s+/g, ' ');
  if (!normalized) {
    return true;
  }

  if (noiseLinePattern.test(normalized)) {
    return true;
  }

  const amountMatches = [...normalized.matchAll(amountTokenPattern)];
  if (amountMatches.length >= 2 && !leadingDatePattern.test(normalized)) {
    return true;
  }

  return false;
}

function selectTrailingAmountTokens(rest) {
  const matches = [...rest.matchAll(amountTokenPattern)];
  if (matches.length === 0) {
    return { amountMatch: null, balanceMatch: null };
  }

  if (matches.length === 1) {
    return { amountMatch: matches[0], balanceMatch: null };
  }

  const last = matches.at(-1);
  const secondLast = matches.at(-2);
  const lastNormalized = String(last[0] ?? '').trim().toUpperCase();
  const looksLikeSignedAmount = lastNormalized.includes('CR')
    || lastNormalized.includes('DR')
    || lastNormalized.startsWith('(')
    || lastNormalized.startsWith('-');

  if (looksLikeSignedAmount) {
    return { amountMatch: last, balanceMatch: null };
  }

  return { amountMatch: secondLast, balanceMatch: last };
}

function parseStatementLine(line, statementContext = null) {
  const trimmed = String(line ?? '').trim().replace(/\s+/g, ' ');
  if (!trimmed) {
    return { row: null, reason: 'empty_line' };
  }

  if (
    /sample bank statement|account holder|account number|statement period|datedescriptionamount|balance/i.test(trimmed)
    && !leadingDatePattern.test(trimmed)
  ) {
    return { row: null, reason: 'header_or_footer_noise' };
  }

  if (/opening balance/i.test(trimmed)) {
    return { row: null, reason: 'opening_balance_row' };
  }

  const mergedDates = trimmed.match(/\d{4}-\d{2}-\d{2}/g);
  if (mergedDates && mergedDates.length > 1) {
    return { row: null, reason: 'merged_multiple_transactions' };
  }

  const txWithBalanceMatch = trimmed.match(
    /^(?<date>\d{4}-\d{2}-\d{2})(?<description>.*?)(?<amount>-?\$?\d[\d,]*\.\d{2})(?<balance>-?\$?\d[\d,]*\.\d{2})$/,
  );
  const txAmountOnlyMatch = txWithBalanceMatch
    ? null
    : trimmed.match(
      /^(?<date>\d{4}-\d{2}-\d{2})(?<description>.*?)(?<amount>-?\$?\d[\d,]*\.\d{2})$/,
    );
  const txMatch = txWithBalanceMatch ?? txAmountOnlyMatch;

  if (!txMatch) {
    if (isNoiseLine(trimmed)) {
      return { row: null, reason: 'header_or_footer_noise' };
    }

    return { row: null, reason: 'unrecognized_format' };
  }

  const description = txMatch.groups.description
    .replace(headerNoiseFragmentPattern, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (!description) {
    return { row: null, reason: 'missing_description' };
  }

  const referenceMatch = description.match(/\b(?:REF|REFERENCE|CONFIRMATION|TRACE)[#:\s-]+([A-Z0-9-]+)\b/i);

  try {
    return {
      row: {
        date: normalizeStatementDate(txMatch.groups.date, statementContext),
        description,
        amount: normalizeAmountToken(txMatch.groups.amount),
        rawDescription: description,
        referenceNumber: referenceMatch?.[1] ?? null,
        balanceAfterTransaction: txMatch.groups.balance
          ? normalizeAmountToken(txMatch.groups.balance)
          : null,
      },
      reason: null,
    };
  } catch (error) {
    if (error instanceof ImportHttpError) {
      return { row: null, reason: error.message };
    }

    throw error;
  }
}

function buildParseDiagnostics(text) {
  const statementContext = extractStatementContext(text);
  const lines = splitIntoCandidateLines(text);
  const matchedRows = [];
  const rejectedCandidates = [];
  const seen = new Set();

  for (const line of lines) {
    const normalizedLine = line.trim().replace(/\s+/g, ' ');
    if (!normalizedLine || seen.has(normalizedLine)) {
      continue;
    }

    seen.add(normalizedLine);
    const { row, reason } = parseStatementLine(normalizedLine, statementContext);
    if (row) {
      matchedRows.push(row);
      continue;
    }

    rejectedCandidates.push({
      line: normalizedLine,
      reason: reason ?? 'unrecognized_layout',
    });
  }

  return {
    statementContext,
    lines,
    matchedRows,
    rejectedCandidates,
  };
}

export async function extractImportedTransactionsFromPdf(pdfBuffer, options = {}) {
  const text = await extractPdfText(pdfBuffer, options);
  if (!text) {
    throw new ImportHttpError(422, 'statement PDF does not contain extractable text', {
      extracted_text_preview: '',
      lines_scanned: 0,
      matched_rows_count: 0,
      rejected_candidates: [],
    });
  }
  logPdfTextPreview(text);

  const diagnostics = buildParseDiagnostics(text);
  logNormalizedLines(diagnostics.lines);
  logRejectedCandidates(diagnostics.rejectedCandidates);
  logParseSummary(diagnostics.lines, diagnostics.matchedRows.length);

  if (diagnostics.matchedRows.length === 0) {
    throw new ImportHttpError(422, 'statement_parse_failed', {
      message: 'Extracted text was found, but no valid transaction rows were parsed.',
      extracted_text_preview: text.slice(0, 3000),
      lines_scanned: diagnostics.lines.length,
      matched_rows_count: 0,
      rejected_candidates: diagnostics.rejectedCandidates.slice(0, 25),
    });
  }

  const suspiciousBlob = diagnostics.matchedRows.length === 1
    && /\d{4}-\d{2}-\d{2}.*\d{4}-\d{2}-\d{2}/.test(diagnostics.matchedRows[0].description ?? '');
  if (suspiciousBlob) {
    throw new ImportHttpError(422, 'statement_parse_failed', {
      message: 'Import stopped because multiple transactions were merged into one parsed row.',
      extracted_text_preview: text.slice(0, 3000),
      lines_scanned: diagnostics.lines.length,
      matched_rows_count: diagnostics.matchedRows.length,
    });
  }

  return diagnostics.matchedRows;
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
    status: row.status ?? 'unreviewed',
    classification_type: row.classificationType ?? null,
    linked_transaction_id: row.linkedTransactionId ?? null,
    linked_debt_id: row.linkedDebtId ?? null,
    linked_fixed_bill_id: row.linkedFixedBillId ?? null,
    reviewed_at: row.reviewedAt ?? null,
    review_note: row.reviewNote ?? null,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

export async function importBankStatement({ db, householdId, input, pdfTextExtractor }) {
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

  const extractedRows = (await extractImportedTransactionsFromPdf(parsedInput.pdfBuffer, {
    pdfTextExtractor,
  }))
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
  normalizeDecodedPdfText,
  splitStatementRows,
  splitIntoCandidateLines,
  selectTrailingAmountTokens,
  normalizeAmountToken,
  normalizeStatementDate,
  parseStatementLine,
  extractStatementContext,
  buildParseDiagnostics,
  isNoiseLine,
  formatImportedTransaction,
  buildImportedTransactionRow,
  parseMoneyToCents,
};
