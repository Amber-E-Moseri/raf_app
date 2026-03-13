const SUM_TOLERANCE_BPS = 1;
const FRACTION_SCALE = 10000;

function parseMoneyToCents(value) {
  const asString = typeof value === 'number' ? value.toFixed(2) : String(value).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(asString)) {
    throw new Error(`Invalid money amount: ${value}`);
  }

  const [whole, fraction = ''] = asString.split('.');
  return Number(whole) * 100 + Number((fraction + '00').slice(0, 2));
}

function parseFractionToBps(value) {
  const asString = typeof value === 'number' ? value.toFixed(4) : String(value).trim();
  if (!/^\d+(\.\d{1,4})?$/.test(asString)) {
    throw new Error(`Invalid allocation percent: ${value}`);
  }

  const [whole, fraction = ''] = asString.split('.');
  return Number(whole) * FRACTION_SCALE + Number((fraction + '0000').slice(0, 4));
}

function formatCents(cents) {
  const whole = Math.floor(cents / 100);
  const fraction = String(cents % 100).padStart(2, '0');
  return `${whole}.${fraction}`;
}

/**
 * Deterministically allocates a deposit across active categories.
 * Rounding remainder is always routed to the `buffer` slug.
 */
export function computeDepositAllocations(amount, categories) {
  const amountCents = parseMoneyToCents(amount);
  if (amountCents <= 0) {
    throw new Error('Deposit amount must be greater than 0.');
  }

  const activeCategories = categories
    .filter((category) => category.isActive !== false)
    .map((category) => ({
      ...category,
      allocationBps: parseFractionToBps(category.allocationPercent),
    }))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  if (activeCategories.length === 0) {
    throw new Error('At least one active allocation category is required.');
  }

  const bufferIndex = activeCategories.findIndex((category) => category.slug === 'buffer');
  if (bufferIndex === -1) {
    throw new Error('Active allocation categories must include the `buffer` slug.');
  }

  const totalBps = activeCategories.reduce((sum, category) => sum + category.allocationBps, 0);
  if (Math.abs(totalBps - FRACTION_SCALE) > SUM_TOLERANCE_BPS) {
    throw new Error('Active allocation percents must sum to 1.0000 ± 0.0001.');
  }

  const allocations = activeCategories.map((category) => {
    const allocatedCents = Math.floor((amountCents * category.allocationBps) / FRACTION_SCALE);
    return {
      categoryId: category.id,
      slug: category.slug,
      allocationPercent: category.allocationPercent,
      allocatedAmount: formatCents(allocatedCents),
      allocatedCents,
    };
  });

  const assignedCents = allocations.reduce((sum, allocation) => sum + allocation.allocatedCents, 0);
  const remainderCents = amountCents - assignedCents;
  allocations[bufferIndex].allocatedCents += remainderCents;
  allocations[bufferIndex].allocatedAmount = formatCents(allocations[bufferIndex].allocatedCents);

  const finalAssignedCents = allocations.reduce((sum, allocation) => sum + allocation.allocatedCents, 0);
  if (finalAssignedCents !== amountCents) {
    throw new Error('Allocation engine invariant failed: allocations do not equal deposit amount.');
  }

  return allocations.map(({ allocatedCents, ...allocation }) => allocation);
}

export const __internal = {
  formatCents,
  parseFractionToBps,
  parseMoneyToCents,
};
