import test from 'node:test';
import assert from 'node:assert/strict';

import { monthBounds } from '../lib/dates.js';

test('monthBounds returns January boundaries', () => {
  assert.deepEqual(monthBounds(2026, 1), {
    start: '2026-01-01',
    end: '2026-01-31',
  });
});

test('monthBounds returns December boundaries', () => {
  assert.deepEqual(monthBounds(2026, 12), {
    start: '2026-12-01',
    end: '2026-12-31',
  });
});

test('monthBounds handles leap-year February', () => {
  assert.deepEqual(monthBounds(2024, 2), {
    start: '2024-02-01',
    end: '2024-02-29',
  });
});
