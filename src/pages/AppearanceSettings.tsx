import { useEffect, useMemo, useState } from "react";

import { SuccessNotice } from "../components/feedback/SuccessNotice";
import { useAppearance } from "../components/layout/AppearanceProvider";
import { PageShell } from "../components/layout/PageShell";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import {
  APPEARANCE_MODE_OPTIONS,
  DEFAULT_APPEARANCE,
  FONT_OPTIONS,
  THEME_OPTIONS,
} from "../lib/appearance";
import type { AppearancePreferences } from "../lib/appearance";

export function AppearanceSettings() {
  const {
    preferences,
    resetAppearance,
    saveAppearance,
  } = useAppearance();
  const [draft, setDraft] = useState<AppearancePreferences>(preferences);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  useEffect(() => {
    setDraft(preferences);
  }, [preferences]);

  const hasChanges = useMemo(() => (
    draft.theme_color !== preferences.theme_color
    || draft.font_family !== preferences.font_family
    || draft.appearance_mode !== preferences.appearance_mode
  ), [draft, preferences]);

  function updateDraft(next: Partial<AppearancePreferences>) {
    setDraft((current) => ({ ...current, ...next }));
    setSaveMessage(null);
  }

  function handleSave() {
    saveAppearance(draft);
    setSaveMessage("Profile appearance updated.");
  }

  function handleResetDraft() {
    setDraft(DEFAULT_APPEARANCE);
    setSaveMessage(null);
  }

  return (
    <PageShell
      eyebrow="Profile"
      title="Profile"
      description="Manage personal appearance preferences for RAF, then save them to this device when you are ready."
      actions={(
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={handleResetDraft}>Reset form</Button>
          <Button type="button" variant="secondary" onClick={resetAppearance}>Restore saved defaults</Button>
          <Button type="button" disabled={!hasChanges} onClick={handleSave}>Save Appearance</Button>
        </div>
      )}
    >
      {saveMessage ? <SuccessNotice title="Profile updated" message={saveMessage} /> : null}
      <section className="grid gap-6 xl:grid-cols-[0.9fr,1.1fr]">
        <Card title="Appearance Settings" subtitle="Choose a curated accent, font, and viewing mode, then confirm with Save Appearance.">
          <div className="grid gap-3 sm:grid-cols-2">
            {THEME_OPTIONS.map((option) => {
              const selected = draft.theme_color === option.value;

              return (
                <button
                  key={option.value}
                  type="button"
                  className={`rounded-[1.5rem] border p-4 text-left transition duration-200 ${
                    selected
                      ? "border-[var(--primary-color)] bg-[var(--primary-soft)] shadow-focus"
                      : "border-[var(--border-color)] bg-[var(--surface-color)] hover:-translate-y-0.5 hover:shadow-lift"
                  }`}
                  onClick={() => updateDraft({ theme_color: option.value })}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span
                        className="h-10 w-10 rounded-full border border-white/80 shadow-sm"
                        style={{ background: `linear-gradient(135deg, ${option.swatch}, ${option.accent})` }}
                      />
                      <div>
                        <div className="font-semibold text-[var(--text-strong)]">{option.label}</div>
                        <div className="text-sm text-stone-500">{option.value} theme</div>
                      </div>
                    </div>
                    {selected ? <Badge tone="success">Selected</Badge> : null}
                  </div>
                </button>
              );
            })}
          </div>
        </Card>

        <Card title="Live Preview" subtitle="Preview the selected appearance here, then save to apply it globally.">
          <div
            className="space-y-4 rounded-[1.75rem] border border-[var(--border-color)] bg-[var(--surface-elevated)] p-5"
            data-theme={draft.theme_color}
            data-font={draft.font_family}
            data-mode={draft.appearance_mode}
          >
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">Current preset</div>
                <h3 className="mt-2 text-2xl font-semibold text-[var(--text-strong)]">RAF Preview</h3>
              </div>
              <Badge tone="neutral">{draft.appearance_mode}</Badge>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-[1.5rem] border border-[var(--border-color)] bg-[var(--surface-color)] p-4">
                <div className="text-sm font-medium text-stone-500">Accent action</div>
                <button
                  type="button"
                  className="mt-3 inline-flex rounded-full bg-[var(--primary-color)] px-4 py-2.5 text-sm font-semibold text-[var(--primary-contrast)] transition"
                >
                  Record deposit
                </button>
              </div>
              <div className="rounded-[1.5rem] border border-[var(--border-color)] bg-[var(--surface-color)] p-4">
                <div className="text-sm font-medium text-stone-500">Data surface</div>
                <div className="mt-3 flex items-center justify-between rounded-2xl bg-[var(--surface-elevated)] px-3 py-2">
                  <span className="text-sm text-[var(--text-strong)]">Buffer balance</span>
                  <span className="text-sm font-semibold text-[var(--primary-color)]">$2,930.28</span>
                </div>
              </div>
            </div>
            <p className="text-sm leading-6 text-stone-500">
              The selected font and theme apply to layout, navigation, cards, forms, and transaction screens.
            </p>
          </div>
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-[0.9fr,1.1fr]">
        <Card title="Font Family" subtitle="Pick a display language that suits how you read financial information.">
          <div className="space-y-3">
            {FONT_OPTIONS.map((option) => {
              const selected = draft.font_family === option.value;

              return (
                <button
                  key={option.value}
                  type="button"
                  data-font={option.value}
                  className={`w-full rounded-[1.5rem] border px-4 py-4 text-left transition duration-200 ${
                    selected
                      ? "border-[var(--primary-color)] bg-[var(--primary-soft)] shadow-focus"
                      : "border-[var(--border-color)] bg-[var(--surface-color)] hover:-translate-y-0.5 hover:shadow-lift"
                  }`}
                  onClick={() => updateDraft({ font_family: option.value })}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-lg font-semibold text-[var(--text-strong)]" style={{ fontFamily: `var(--font-${option.value})` }}>
                        {option.label}
                      </div>
                      <div className="mt-1 text-sm text-stone-500" style={{ fontFamily: `var(--font-${option.value})` }}>
                        {option.preview}
                      </div>
                    </div>
                    {selected ? <Badge tone="success">Selected</Badge> : null}
                  </div>
                </button>
              );
            })}
          </div>
        </Card>

        <Card title="Appearance Mode" subtitle="Switch between light and dark surfaces while keeping the RAF color system intact.">
          <div className="grid gap-3 sm:grid-cols-2">
            {APPEARANCE_MODE_OPTIONS.map((option) => {
              const selected = draft.appearance_mode === option.value;

              return (
                <button
                  key={option.value}
                  type="button"
                  className={`rounded-[1.5rem] border p-4 text-left transition duration-200 ${
                    selected
                      ? "border-[var(--primary-color)] bg-[var(--primary-soft)] shadow-focus"
                      : "border-[var(--border-color)] bg-[var(--surface-color)] hover:-translate-y-0.5 hover:shadow-lift"
                  }`}
                  onClick={() => updateDraft({ appearance_mode: option.value })}
                >
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="font-semibold text-[var(--text-strong)]">{option.label}</div>
                      <div className="mt-1 text-sm text-stone-500">{option.description}</div>
                    </div>
                    {selected ? <Badge tone="success">Active</Badge> : null}
                  </div>
                </button>
              );
            })}
          </div>
        </Card>
      </section>
    </PageShell>
  );
}
