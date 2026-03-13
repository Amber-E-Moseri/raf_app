export const IMPORT_BATCH_STATUSES = new Set(['uploaded', 'parsing', 'review', 'approved', 'failed']);
export const IMPORT_ROW_STATUSES = new Set(['pending', 'approved', 'duplicate', 'skipped', 'rejected']);
export const IMPORT_DIRECTIONS = new Set(['debit', 'credit']);

export class ImportHttpError extends Error {
  constructor(status, message, details = undefined) {
    super(message);
    this.name = 'ImportHttpError';
    this.status = status;
    if (details !== undefined) {
      this.details = details;
    }
  }
}

export function normalizeOptionalString(value) {
  if (value == null) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized || null;
}

export function normalizeIsoDate(value, fieldName) {
  const asString = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asString)) {
    throw new ImportHttpError(422, `${fieldName} must be a valid ISO date`);
  }

  const parsed = new Date(`${asString}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== asString) {
    throw new ImportHttpError(422, `${fieldName} must be a valid ISO date`);
  }

  return asString;
}

export function normalizeMoney(value, fieldName) {
  const asString = typeof value === 'number' ? value.toFixed(2) : String(value ?? '').trim();
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(asString)) {
    throw new ImportHttpError(422, `${fieldName} must be a decimal with up to 2 places`);
  }

  const negative = asString.startsWith('-');
  const unsigned = negative ? asString.slice(1) : asString;
  const [whole, fraction = ''] = unsigned.split('.');
  const normalized = `${negative ? '-' : ''}${whole}.${(fraction + '00').slice(0, 2)}`;
  if (normalized === '0.00' || normalized === '-0.00') {
    throw new ImportHttpError(422, `${fieldName} must not be 0`);
  }

  return normalized;
}

export function parseDirection(value) {
  const normalized = normalizeOptionalString(value);
  if (normalized == null) {
    return 'debit';
  }

  if (!IMPORT_DIRECTIONS.has(normalized)) {
    throw new ImportHttpError(422, 'parsedDirection must be debit or credit');
  }

  return normalized;
}

export function parseMoneyToCents(value, fieldName) {
  const normalized = normalizeMoney(value, fieldName);
  const negative = normalized.startsWith('-');
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [whole, fraction = '00'] = unsigned.split('.');
  const cents = Number(whole) * 100 + Number(fraction);
  return negative ? -cents : cents;
}

export function formatImportRow(row) {
  return {
    id: row.id,
    rawDate: row.rawDate ?? null,
    rawDescription: row.rawDescription ?? null,
    rawMerchant: row.rawMerchant ?? null,
    rawAmount: row.rawAmount ?? null,
    rawDirection: row.rawDirection ?? null,
    parsedDate: row.parsedDate,
    parsedDescription: row.parsedDescription,
    parsedMerchant: row.parsedMerchant,
    parsedAmount: row.parsedAmount,
    parsedDirection: row.parsedDirection,
    suggestedCategoryId: row.suggestedCategoryId,
    suggestedDebtId: row.suggestedDebtId ?? null,
    suggestedByRuleId: row.suggestedByRuleId ?? null,
    suggestionReason: row.suggestionReason ?? null,
    duplicateOfId: row.duplicateOfId ?? null,
    duplicateReason: row.duplicateReason ?? null,
    status: row.status,
  };
}

export function formatImportBatchReview({ batch, rows }) {
  return {
    batchId: batch.id,
    filename: batch.filename,
    status: batch.status,
    rowCount: batch.rowCount ?? rows.length,
    rows,
  };
}
