/**
 * Pure derivation logic for the Plan Execution table.
 * No React, no build-time dependencies.
 *
 * Terminology (audit SC-1):
 *   "Allocated" = income that flowed to a bucket via allocation percentages
 *   Labels: Allocated / Used / Remaining — never "Planned".
 *
 * @module lib/planExecution/derivePlanExecutionRows
 */

/**
 * Parse a money string like "123.45" to a rounded-cent integer.
 * Returns 0 for null / undefined / non-finite values.
 * @param {string|number|null|undefined} value
 * @returns {number}
 */
export function parseMoneyToCents(value) {
  const numeric = typeof value === 'number' ? value : Number(value ?? '0');
  if (!Number.isFinite(numeric)) return 0;
  return Math.round(numeric * 100);
}

/**
 * Derive a single plan-execution row from raw bucket metrics.
 * Returns null if the bucket has no activity worth showing (all zeros).
 * @returns {object|null}
 */
export function derivePlanExecutionRow(item) {
  const allocatedCents = parseMoneyToCents(item.thisMonth.allocated);
  const addedCents    = parseMoneyToCents(item.thisMonth.added);
  const usedCents     = parseMoneyToCents(item.thisMonth.used);
  const remainingCents = allocatedCents + addedCents - usedCents;

  const hasActivity = allocatedCents !== 0 || usedCents !== 0 || addedCents !== 0;
  if (!hasActivity) return null;

  // No income allocated but spending occurred
  if (allocatedCents === 0 && addedCents === 0 && usedCents > 0) {
    return { bucketId: item.bucketId, slug: item.slug ?? null, label: item.label,
      allocatedCents, addedCents, usedCents, remainingCents, status: 'NO_ALLOCATION_USED' };
  }

  const status = remainingCents < 0 ? 'ABOVE_ALLOCATION' : 'WITHIN_ALLOCATION';
  return { bucketId: item.bucketId, slug: item.slug ?? null, label: item.label,
    allocatedCents, addedCents, usedCents, remainingCents, status };
}

/**
 * Derive all plan-execution rows; preserves input order.
 * @param {Array} items
 * @returns {Array}
 */
export function derivePlanExecutionRows(items) {
  return items.map((item) => derivePlanExecutionRow(item)).filter((r) => r !== null);
}
