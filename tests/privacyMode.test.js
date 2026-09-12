import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// ── format.ts ─────────────────────────────────────────────────────────────────

test("format.ts exports PRIVACY_MASK as the bullet-dot string ••••", async () => {
  const src = await readFile(new URL("../src/lib/format.ts", import.meta.url), "utf8");
  assert.match(src, /export const PRIVACY_MASK = "••••"/, "PRIVACY_MASK constant is declared and exported");
  assert.doesNotMatch(src, /formatCurrency.*privacy|privacy.*formatCurrency/, "formatCurrency is not privacy-aware — data layer unchanged");
});

// ── appearance.ts ─────────────────────────────────────────────────────────────

test("appearance.ts AppearancePreferences interface includes privacy_mode: boolean", async () => {
  const src = await readFile(new URL("../src/lib/appearance.ts", import.meta.url), "utf8");
  assert.match(src, /privacy_mode: boolean/, "interface has privacy_mode field");
});

test("appearance.ts DEFAULT_APPEARANCE sets privacy_mode to false", async () => {
  const src = await readFile(new URL("../src/lib/appearance.ts", import.meta.url), "utf8");
  assert.match(src, /privacy_mode: false/, "DEFAULT_APPEARANCE.privacy_mode is false");
});

test("parseAppearancePreferences uses strict boolean check to prevent non-boolean truthy values", async () => {
  const src = await readFile(new URL("../src/lib/appearance.ts", import.meta.url), "utf8");
  assert.match(src, /parsed\.privacy_mode === true/, "uses strict equality to reject non-boolean values like strings");
});

test("parseAppearancePreferences includes privacy_mode in return value", async () => {
  const src = await readFile(new URL("../src/lib/appearance.ts", import.meta.url), "utf8");
  assert.match(src, /privacy_mode.*theme_color.*font_family|theme_color.*privacy_mode/, "privacy_mode is destructured into return object");
});

// ── Money component ───────────────────────────────────────────────────────────

test("Money component renders PRIVACY_MASK when privacy_mode is true", async () => {
  const src = await readFile(new URL("../src/components/ui/Money.tsx", import.meta.url), "utf8");
  assert.match(src, /PRIVACY_MASK/, "uses PRIVACY_MASK constant");
  assert.match(src, /privacy_mode/, "reads privacy_mode from preferences");
  assert.match(src, /isPrivate/, "derives isPrivate from privacy_mode");
});

test("Money component sets aria-label to 'Amount hidden' string when masked", async () => {
  const src = await readFile(new URL("../src/components/ui/Money.tsx", import.meta.url), "utf8");
  assert.match(src, /ariaLabel = "Amount hidden"/, "assigns 'Amount hidden' as the aria label string when masked");
  assert.match(src, /aria-label=\{ariaLabel\}/, "applies aria-label from variable on the span");
  assert.match(src, /aria-atomic="true"/, "marks span as atomic for screen readers");
});

test("Money component includes motion-safe transition animation class", async () => {
  const src = await readFile(new URL("../src/components/ui/Money.tsx", import.meta.url), "utf8");
  assert.match(src, /motion-safe:transition-opacity/, "respects prefers-reduced-motion via Tailwind class");
});

// ── useMoneyFormat hook ───────────────────────────────────────────────────────

test("useMoneyFormat returns PRIVACY_MASK when privacy_mode is true", async () => {
  const src = await readFile(new URL("../src/hooks/useMoneyFormat.ts", import.meta.url), "utf8");
  assert.match(src, /PRIVACY_MASK/, "uses PRIVACY_MASK constant");
  assert.match(src, /isPrivate.*PRIVACY_MASK|PRIVACY_MASK.*isPrivate/, "returns mask when private");
  assert.match(src, /useCallback/, "memoized to avoid unnecessary re-renders");
});

// ── AppearanceProvider ────────────────────────────────────────────────────────

test("AppearanceProvider exposes togglePrivacyMode that flips privacy_mode", async () => {
  const src = await readFile(new URL("../src/components/layout/AppearanceProvider.tsx", import.meta.url), "utf8");
  assert.match(src, /togglePrivacyMode/, "context interface exposes togglePrivacyMode");
  assert.match(src, /privacy_mode: !current\.privacy_mode/, "toggle flips the boolean");
});

test("AppearanceProvider persists privacy_mode via the existing localStorage key", async () => {
  const src = await readFile(new URL("../src/components/layout/AppearanceProvider.tsx", import.meta.url), "utf8");
  assert.match(src, /APPEARANCE_STORAGE_KEY/, "uses the shared localStorage key");
  assert.match(src, /localStorage\.setItem/, "writes to localStorage on change");
});

// ── AppLayout sidebar toggle ──────────────────────────────────────────────────

test("AppLayout sidebar has aria-pressed toggle button for privacy mode", async () => {
  const src = await readFile(new URL("../src/components/layout/AppLayout.tsx", import.meta.url), "utf8");
  assert.match(src, /aria-pressed=\{preferences\.privacy_mode\}/, "button exposes toggle state via aria-pressed");
  assert.match(src, /togglePrivacyMode/, "button calls togglePrivacyMode on click");
});

// ── AppearanceSettings ────────────────────────────────────────────────────────

test("AppearanceSettings page includes privacy mode toggle UI", async () => {
  const src = await readFile(new URL("../src/pages/AppearanceSettings.tsx", import.meta.url), "utf8");
  assert.match(src, /privacy_mode/, "references privacy_mode preference");
  assert.match(src, /togglePrivacyMode/, "calls togglePrivacyMode on interaction");
});
