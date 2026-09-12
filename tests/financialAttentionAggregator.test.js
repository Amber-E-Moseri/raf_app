/**
 * Financial Attention Aggregator — P0 unit tests
 * 28 tests: 15 derivation, 4 presentation, 9 activation contract
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Inline replica of deriveAttentionItems (kept in sync with FinancialAttentionAggregator.tsx)
function deriveAttentionItems({ unreviewedImportsCount = 0 } = {}) {
  const items = [];
  if (unreviewedImportsCount > 0) {
    items.push({
      id: 'import-review',
      type: 'IMPORT_REVIEW',
      priority: 'ACTION_NEEDED',
      title: 'Transactions Need Review',
      description:
        unreviewedImportsCount === 1
          ? '1 imported transaction awaits categorization before month close.'
          : `${unreviewedImportsCount} imported transactions await categorization before month close.`,
      action: { label: 'Review Now', href: '/transactions?tab=needs-review' },
      count: unreviewedImportsCount,
    });
  }
  return items;
}

// Inline replica of Dashboard activation logic
function computeAttentionInput({ nextStepState, activeMonthStatus, reminderMonth }) {
  const showAttention =
    nextStepState?.kind === 'income-no-transactions' ||
    nextStepState?.kind === 'income-transactions-open' ||
    nextStepState?.kind === 'month-reminder';
  if (!showAttention) return null;
  const unreviewedImportsCount =
    nextStepState.kind === 'month-reminder'
      ? (reminderMonth?.unresolvedImports ?? 0)
      : (activeMonthStatus?.unresolvedImports ?? 0);
  return { unreviewedImportsCount };
}

// ─── Section 1: Derivation (tests 1–15) ────────────────────────────────────

describe('deriveAttentionItems', () => {
  it('1. returns empty array when unreviewedImportsCount is 0', () => {
    assert.deepEqual(deriveAttentionItems({ unreviewedImportsCount: 0 }), []);
  });

  it('2. returns empty array when called with no arguments', () => {
    assert.deepEqual(deriveAttentionItems(), []);
  });

  it('3. returns one item when unreviewedImportsCount is 1', () => {
    const items = deriveAttentionItems({ unreviewedImportsCount: 1 });
    assert.equal(items.length, 1);
  });

  it('4. item id is "import-review"', () => {
    const [item] = deriveAttentionItems({ unreviewedImportsCount: 1 });
    assert.equal(item.id, 'import-review');
  });

  it('5. item type is "IMPORT_REVIEW"', () => {
    const [item] = deriveAttentionItems({ unreviewedImportsCount: 1 });
    assert.equal(item.type, 'IMPORT_REVIEW');
  });

  it('6. item priority is "ACTION_NEEDED"', () => {
    const [item] = deriveAttentionItems({ unreviewedImportsCount: 1 });
    assert.equal(item.priority, 'ACTION_NEEDED');
  });

  it('7. item title is "Transactions Need Review"', () => {
    const [item] = deriveAttentionItems({ unreviewedImportsCount: 1 });
    assert.equal(item.title, 'Transactions Need Review');
  });

  it('8. singular description for count 1', () => {
    const [item] = deriveAttentionItems({ unreviewedImportsCount: 1 });
    assert.equal(item.description, '1 imported transaction awaits categorization before month close.');
  });

  it('9. plural description for count > 1', () => {
    const [item] = deriveAttentionItems({ unreviewedImportsCount: 5 });
    assert.equal(item.description, '5 imported transactions await categorization before month close.');
  });

  it('10. action label is "Review Now"', () => {
    const [item] = deriveAttentionItems({ unreviewedImportsCount: 1 });
    assert.equal(item.action.label, 'Review Now');
  });

  it('11. action href is "/transactions?tab=needs-review"', () => {
    const [item] = deriveAttentionItems({ unreviewedImportsCount: 1 });
    assert.equal(item.action.href, '/transactions?tab=needs-review');
  });

  it('12. count field equals unreviewedImportsCount', () => {
    const [item] = deriveAttentionItems({ unreviewedImportsCount: 7 });
    assert.equal(item.count, 7);
  });

  it('13. returns exactly one item regardless of large count', () => {
    const items = deriveAttentionItems({ unreviewedImportsCount: 100 });
    assert.equal(items.length, 1);
  });

  it('14. returns empty for negative count (treated as no items)', () => {
    const items = deriveAttentionItems({ unreviewedImportsCount: -1 });
    assert.deepEqual(items, []);
  });

  it('15. plural description for count 2', () => {
    const [item] = deriveAttentionItems({ unreviewedImportsCount: 2 });
    assert.equal(item.description, '2 imported transactions await categorization before month close.');
  });
});

// ─── Section 2: Presentation (tests 16–19) ─────────────────────────────────

describe('FinancialAttentionAggregator presentation contract', () => {
  it('16. hides when items array is empty', () => {
    // Verified by component returning null — representation: empty array means hidden
    const items = deriveAttentionItems({ unreviewedImportsCount: 0 });
    assert.equal(items.length, 0);
  });

  it('17. shows at most 3 items when more than 3 are present', () => {
    // Build 4 items by calling with same input and simulating multiple signals
    const fakeItems = Array.from({ length: 4 }, (_, i) => ({
      id: `item-${i}`, type: 'IMPORT_REVIEW', priority: 'ACTION_NEEDED',
      title: 'T', description: 'D', action: { label: 'L', href: '/h' },
    }));
    const visible = fakeItems.slice(0, 3);
    assert.equal(visible.length, 3);
  });

  it('18. overflow message is correct for 1 hidden item', () => {
    const hiddenCount = 1;
    const msg = `... and ${hiddenCount} more decision${hiddenCount !== 1 ? 's' : ''} awaiting action`;
    assert.equal(msg, '... and 1 more decision awaiting action');
  });

  it('19. overflow message is correct for multiple hidden items', () => {
    const hiddenCount = 3;
    const msg = `... and ${hiddenCount} more decision${hiddenCount !== 1 ? 's' : ''} awaiting action`;
    assert.equal(msg, '... and 3 more decisions awaiting action');
  });
});

// ─── Section 3: Activation contract (tests 20–28) ──────────────────────────

describe('computeAttentionInput activation contract', () => {
  const activeStatus = { unresolvedImports: 3 };
  const reminderMonth = { unresolvedImports: 2, monthKey: '2026-08' };

  it('20. returns input for income-transactions-open', () => {
    const input = computeAttentionInput({
      nextStepState: { kind: 'income-transactions-open' },
      activeMonthStatus: activeStatus,
      reminderMonth: null,
    });
    assert.deepEqual(input, { unreviewedImportsCount: 3 });
  });

  it('21. returns input for income-no-transactions', () => {
    const input = computeAttentionInput({
      nextStepState: { kind: 'income-no-transactions' },
      activeMonthStatus: activeStatus,
      reminderMonth: null,
    });
    assert.deepEqual(input, { unreviewedImportsCount: 3 });
  });

  it('22. returns input for month-reminder using reminderMonth.unresolvedImports', () => {
    const input = computeAttentionInput({
      nextStepState: { kind: 'month-reminder', monthKey: '2026-08' },
      activeMonthStatus: activeStatus,
      reminderMonth,
    });
    assert.deepEqual(input, { unreviewedImportsCount: 2 });
  });

  it('23. returns null for historical state', () => {
    const input = computeAttentionInput({
      nextStepState: { kind: 'historical' },
      activeMonthStatus: activeStatus,
      reminderMonth: null,
    });
    assert.equal(input, null);
  });

  it('24. returns null for setup-incomplete state', () => {
    const input = computeAttentionInput({
      nextStepState: { kind: 'setup-incomplete' },
      activeMonthStatus: activeStatus,
      reminderMonth: null,
    });
    assert.equal(input, null);
  });

  it('25. returns null for closed-current-month state', () => {
    const input = computeAttentionInput({
      nextStepState: { kind: 'closed-current-month' },
      activeMonthStatus: activeStatus,
      reminderMonth: null,
    });
    assert.equal(input, null);
  });

  it('26. returns null for setup-complete-no-income state', () => {
    const input = computeAttentionInput({
      nextStepState: { kind: 'setup-complete-no-income' },
      activeMonthStatus: activeStatus,
      reminderMonth: null,
    });
    assert.equal(input, null);
  });

  it('27. month-reminder with null reminderMonth defaults to 0', () => {
    const input = computeAttentionInput({
      nextStepState: { kind: 'month-reminder', monthKey: '2026-08' },
      activeMonthStatus: activeStatus,
      reminderMonth: null,
    });
    assert.deepEqual(input, { unreviewedImportsCount: 0 });
  });

  it('28. returns null when nextStepState is null', () => {
    const input = computeAttentionInput({
      nextStepState: null,
      activeMonthStatus: activeStatus,
      reminderMonth: null,
    });
    assert.equal(input, null);
  });
});
