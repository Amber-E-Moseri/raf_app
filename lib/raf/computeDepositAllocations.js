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

function compareCategoryOrder(left, right) {
  return (left.sortOrder ?? 0) - (right.sortOrder ?? 0)
    || String(left.slug ?? '').localeCompare(String(right.slug ?? ''))
    || String(left.id ?? '').localeCompare(String(right.id ?? ''));
}

function compareRemainderRecipients(left, right) {
  return right.allocatedCents - left.allocatedCents
    || right.allocationBps - left.allocationBps
    || compareCategoryOrder(left, right);
}

function pickRemainderRecipientIndex(allocations) {
  const bufferIndex = allocations.findIndex((allocation) => allocation.slug === 'buffer');
  if (bufferIndex >= 0) {
    return bufferIndex;
  }

  let bestIndex = 0;
  for (let index = 1; index < allocations.length; index += 1) {
    if (compareRemainderRecipients(allocations[index], allocations[bestIndex]) < 0) {
      bestIndex = index;
    }
  }

  return bestIndex;
}

/**
 * Deterministically allocates a deposit across active categories.
 * Rounding remainder goes to the active `buffer` slug when present.
 * If no active `buffer` exists, the remainder goes to the largest allocation,
 * with deterministic tie-breakers.
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
    .sort(compareCategoryOrder);

  if (activeCategories.length === 0) {
    throw new Error('At least one active allocation category is required.');
  }

  const totalBps = activeCategories.reduce((sum, category) => sum + category.allocationBps, 0);
  if (Math.abs(totalBps - FRACTION_SCALE) > SUM_TOLERANCE_BPS) {
    throw new Error('Active allocation percents must sum to 1.0000 +/- 0.0001.');
  }

  const allocations = activeCategories.map((category) => {
    const allocatedCents = Math.floor((amountCents * category.allocationBps) / FRACTION_SCALE);
    return {
      categoryId: category.id,
      slug: category.slug,
      allocationPercent: category.allocationPercent,
      sortOrder: category.sortOrder ?? 0,
      allocationBps: category.allocationBps,
      allocatedAmount: formatCents(allocatedCents),
      allocatedCents,
    };
  });

  const assignedCents = allocations.reduce((sum, allocation) => sum + allocation.allocatedCents, 0);
  const remainderCents = amountCents - assignedCents;
  const recipientIndex = pickRemainderRecipientIndex(allocations);

  allocations[recipientIndex].allocatedCents += remainderCents;
  allocations[recipientIndex].allocatedAmount = formatCents(allocations[recipientIndex].allocatedCents);

  const finalAssignedCents = allocations.reduce((sum, allocation) => sum + allocation.allocatedCents, 0);
  if (finalAssignedCents !== amountCents) {
    throw new Error('Allocation engine invariant failed: allocations do not equal deposit amount.');
  }

  return allocations.map((allocation) => {
    const {
      allocatedCents: _allocatedCents,
      allocationBps: _allocationBps,
      sortOrder: _sortOrder,
      ...rest
    } = allocation;
    return rest;
  });
}

export const __internal = {
  compareCategoryOrder,
  compareRemainderRecipients,
  formatCents,
  parseFractionToBps,
  parseMoneyToCents,
  pickRemainderRecipientIndex,
};
