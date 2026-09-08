export const IMPORT_BATCH_STATUS = Object.freeze({
  UPLOADED: 'uploaded',
  PARSING: 'parsing',
  REVIEW: 'review',
  APPROVED: 'approved',
  FAILED: 'failed',
});

export const IMPORT_BATCH_STATUSES = new Set(Object.values(IMPORT_BATCH_STATUS));
export const IMPORT_ROW_STATUSES = new Set(['pending', 'approved', 'duplicate', 'skipped', 'rejected']);
export const IMPORT_DIRECTIONS = new Set(['debit', 'credit']);

export const IMPORT_BATCH_ALLOWED_TRANSITIONS = new Map([
  [IMPORT_BATCH_STATUS.UPLOADED, new Set([IMPORT_BATCH_STATUS.PARSING, IMPORT_BATCH_STATUS.FAILED])],
  [IMPORT_BATCH_STATUS.PARSING, new Set([IMPORT_BATCH_STATUS.REVIEW, IMPORT_BATCH_STATUS.FAILED])],
  [IMPORT_BATCH_STATUS.REVIEW, new Set([IMPORT_BATCH_STATUS.PARSING, IMPORT_BATCH_STATUS.APPROVED, IMPORT_BATCH_STATUS.FAILED])],
  [IMPORT_BATCH_STATUS.APPROVED, new Set()],
  [IMPORT_BATCH_STATUS.FAILED, new Set([IMPORT_BATCH_STATUS.PARSING])],
]);

export const IMPORT_ROW_ALLOWED_STATUS_TRANSITIONS = new Map([
  ['pending', new Set(['pending', 'approved', 'duplicate', 'skipped', 'rejected'])],
  ['approved', new Set(['approved', 'skipped', 'rejected'])],
  ['duplicate', new Set(['duplicate', 'approved', 'skipped', 'rejected'])],
  ['skipped', new Set(['skipped', 'approved', 'rejected'])],
  ['rejected', new Set(['rejected'])],
]);

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

export function normalizeBatchStatus(value) {
  const normalized = normalizeOptionalString(value)?.toLowerCase() ?? null;
  if (!normalized || !IMPORT_BATCH_STATUSES.has(normalized)) {
    throw new ImportHttpError(422, `invalid import batch status: ${value ?? '(missing)'}`);
  }

  return normalized;
}

export function normalizeRowStatus(value) {
  const normalized = normalizeOptionalString(value)?.toLowerCase() ?? null;
  if (!normalized || !IMPORT_ROW_STATUSES.has(normalized)) {
    throw new ImportHttpError(422, `invalid import row status: ${value ?? '(missing)'}`);
  }

  return normalized;
}

export function assertImportBatchStatus(batch, allowedStatuses, message) {
  const currentStatus = normalizeBatchStatus(batch?.status);
  if (!allowedStatuses.has(currentStatus)) {
    throw new ImportHttpError(422, message);
  }

  return currentStatus;
}

export function assertImportBatchTransition({ currentStatus, nextStatus, action }) {
  const normalizedCurrent = normalizeBatchStatus(currentStatus);
  const normalizedNext = normalizeBatchStatus(nextStatus);
  const allowedTargets = IMPORT_BATCH_ALLOWED_TRANSITIONS.get(normalizedCurrent) ?? new Set();
  if (!allowedTargets.has(normalizedNext)) {
    throw new ImportHttpError(
      422,
      `import batch cannot transition from ${normalizedCurrent} to ${normalizedNext}${action ? ` during ${action}` : ''}`,
    );
  }
}

export function assertImportRowStatusTransition({ currentStatus, nextStatus }) {
  const normalizedCurrent = normalizeRowStatus(currentStatus);
  const normalizedNext = normalizeRowStatus(nextStatus);
  const allowedTargets = IMPORT_ROW_ALLOWED_STATUS_TRANSITIONS.get(normalizedCurrent) ?? new Set();
  if (!allowedTargets.has(normalizedNext)) {
    throw new ImportHttpError(422, `import row cannot transition from ${normalizedCurrent} to ${normalizedNext}`);
  }
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
  const normalized = normalizeOptionalString(value)?.toLowerCase() ?? null;
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
