import { monthStart } from '../raf/reporting.js';

export class MonthlyReviewHttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'MonthlyReviewHttpError';
    this.status = status;
  }
}

export function requireDbContract(db) {
  if (typeof db?.transaction !== 'function') {
    throw new Error('Monthly review DB adapter must implement transaction().');
  }
}

export function normalizeReviewMonth(value) {
  let normalized;
  try {
    normalized = monthStart(value);
  } catch {
    throw new MonthlyReviewHttpError(400, 'reviewMonth must be a valid ISO date');
  }

  if (String(value).trim() !== normalized) {
    throw new MonthlyReviewHttpError(400, 'reviewMonth must be the first day of the month');
  }

  return normalized;
}

export function normalizeOptionalNotes(value) {
  if (value == null) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized || null;
}
