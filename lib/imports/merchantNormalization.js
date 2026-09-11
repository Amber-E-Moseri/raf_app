// Conservative merchant key extraction. Strips store numbers and location codes
// to produce a stable identity across statement variations like:
//   "WHOLE FOODS #1042" and "WHOLE FOODS MARKET 00142" → "whole foods"
//
// Deliberately avoids word-boundary splits that could merge distinct brands:
//   UBER / UBER EATS → kept separate (one is a prefix of the other only with a suffix)
//   APPLE / APPLEBEES → kept separate (different words)
//
// Returns null for empty or unrecognisable input.

const PAYMENT_PROCESSOR_PREFIX = /^(paypal\s*\*|sq\s*\*|stripe\s*\*|tst\*|amzn\s*\*)\s*/i;
const TRAILING_STORE_NUMBER = /\s*#\s*\d+\s*$/;
const TRAILING_LONG_DIGIT_CODE = /\s+\d{4,}\s*$/;
const TRAILING_SHORT_TLD = /\.(com|ca|net|org|co|io)\s*$/i;

export function extractMerchantKey(description) {
  if (!description) return null;

  const key = String(description)
    .toLowerCase()
    .replace(PAYMENT_PROCESSOR_PREFIX, '')
    .replace(TRAILING_STORE_NUMBER, '')
    .replace(TRAILING_LONG_DIGIT_CODE, '')
    .replace(TRAILING_SHORT_TLD, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return key || null;
}

// Tests for false-positive merchant collisions — called from tests only.
export const __internal = { extractMerchantKey };
