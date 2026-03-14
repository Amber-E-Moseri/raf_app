import { useEffect, useMemo, useState } from "react";

import { getAllocationCategories } from "../api/allocationCategoriesApi";
import { getDebts } from "../api/debtsApi";
import { getFixedBills } from "../api/fixedBillsApi";
import {
  deleteImportReviewRule,
  getImportReviewRules,
  updateImportReviewRule,
} from "../api/importsApi";
import { getGoals } from "../api/goalsApi";
import { ErrorState } from "../components/feedback/ErrorState";
import { LoadingState } from "../components/feedback/LoadingState";
import { SuccessNotice } from "../components/feedback/SuccessNotice";
import {
  buildImportRuleDraft,
  ImportRuleEditor,
  mapRuleDraftToPayload,
} from "../components/imports/ImportRuleEditor";
import { useAppearance } from "../components/layout/AppearanceProvider";
import { PageShell } from "../components/layout/PageShell";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { useAsyncData } from "../hooks/useAsyncData";
import {
  APPEARANCE_MODE_OPTIONS,
  DEFAULT_APPEARANCE,
  FONT_OPTIONS,
  INTERFACE_SCALE_OPTIONS,
  THEME_OPTIONS,
} from "../lib/appearance";
import type { AppearancePreferences, ThemeColor } from "../lib/appearance";
import type {
  AllocationCategory,
  Debt,
  FixedBill,
  Goal,
  ImportReviewRule,
} from "../lib/types";

interface ProfileSettingsViewModel {
  categories: AllocationCategory[];
  debts: Debt[];
  fixedBills: FixedBill[];
  goals: Goal[];
  rules: ImportReviewRule[];
}

type SettingsTab = "preferences" | "import_rules";

const settingsTabs: Array<{ id: SettingsTab; label: string; description: string }> = [
  {
    id: "preferences",
    label: "Preferences",
    description: "Theme, typography, and scale for this device.",
  },
  {
    id: "import_rules",
    label: "Import Rules",
    description: "Suggestions, reusable rules, and auto-apply controls.",
  },
];

const themeGroups: Array<{
  mood: string;
  values: ThemeColor[];
  helper: string;
}> = [
  { mood: "Professional", values: ["blue", "black"], helper: "Calm contrast for focused daily finance work." },
  { mood: "Balanced", values: ["green"], helper: "RAF's default look with steady contrast and warmth." },
  { mood: "Playful", values: ["pink"], helper: "A softer accent with a little more personality." },
];

function ruleActionLabel(rule: ImportReviewRule) {
  if (rule.classification_type === "income") {
    return "Add to income deposit";
  }
  if (rule.classification_type === "transaction") {
    return "Approve as transaction";
  }
  if (rule.classification_type === "debt_payment") {
    return "Link to debt payment";
  }
  if (rule.classification_type === "fixed_bill_payment") {
    return "Link to fixed bill";
  }
  if (rule.classification_type === "goal_funding") {
    return "Internal transfer to savings goal";
  }
  if (rule.classification_type === "duplicate") {
    return "Mark duplicate";
  }
  if (rule.classification_type === "transfer") {
    return "Mark transfer";
  }
  return "Ignore";
}

function selectedCardClasses(selected: boolean) {
  return selected
    ? "border-[var(--primary-color)] bg-[var(--primary-soft)] shadow-focus"
    : "border-[var(--border-color)] hover:-translate-y-0.5 hover:shadow-lift";
}

export function AppearanceSettings() {
  const { preferences, saveAppearance } = useAppearance();
  const [activeTab, setActiveTab] = useState<SettingsTab>("preferences");
  const [draft, setDraft] = useState<AppearancePreferences>(preferences);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [ruleMessage, setRuleMessage] = useState<string | null>(null);
  const [ruleError, setRuleError] = useState<string | null>(null);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [ruleDrafts, setRuleDrafts] = useState<Record<string, ReturnType<typeof buildImportRuleDraft>>>({});
  const [pendingRuleId, setPendingRuleId] = useState<string | null>(null);

  const rulesData = useAsyncData<ProfileSettingsViewModel>(async () => {
    const [categories, debtsResponse, fixedBillsResponse, goalsResponse, rulesResponse] = await Promise.all([
      getAllocationCategories(),
      getDebts(),
      getFixedBills(),
      getGoals(),
      getImportReviewRules(),
    ]);

    return {
      categories,
      debts: debtsResponse.items,
      fixedBills: fixedBillsResponse.items,
      goals: goalsResponse.items,
      rules: rulesResponse.items,
    };
  }, []);

  useEffect(() => {
    setDraft(preferences);
  }, [preferences]);

  const hasChanges = useMemo(() => (
    draft.theme_color !== preferences.theme_color
    || draft.font_family !== preferences.font_family
    || draft.appearance_mode !== preferences.appearance_mode
    || draft.interface_scale !== preferences.interface_scale
  ), [draft, preferences]);

  const activeTheme = useMemo(
    () => THEME_OPTIONS.find((option) => option.value === draft.theme_color) ?? THEME_OPTIONS[0],
    [draft.theme_color],
  );
  const activeFont = useMemo(
    () => FONT_OPTIONS.find((option) => option.value === draft.font_family) ?? FONT_OPTIONS[0],
    [draft.font_family],
  );
  const activeScale = useMemo(
    () => INTERFACE_SCALE_OPTIONS.find((option) => option.value === draft.interface_scale) ?? INTERFACE_SCALE_OPTIONS[1],
    [draft.interface_scale],
  );
  const activeMode = useMemo(
    () => APPEARANCE_MODE_OPTIONS.find((option) => option.value === draft.appearance_mode) ?? APPEARANCE_MODE_OPTIONS[0],
    [draft.appearance_mode],
  );

  function updateDraft(next: Partial<AppearancePreferences>) {
    setDraft((current) => ({ ...current, ...next }));
    setSaveMessage(null);
  }

  function handleSave() {
    saveAppearance(draft);
    setSaveMessage("Appearance settings updated.");
  }

  function handleCancel() {
    setDraft(preferences);
    setSaveMessage(null);
  }

  function handleRestoreDefaults() {
    setDraft(DEFAULT_APPEARANCE);
    setSaveMessage(null);
  }

  function getRuleDraft(rule: ImportReviewRule) {
    return ruleDrafts[rule.id] ?? buildImportRuleDraft(rule);
  }

  function updateRuleDraft(rule: ImportReviewRule, patch: Partial<ReturnType<typeof buildImportRuleDraft>>) {
    setRuleDrafts((current) => ({
      ...current,
      [rule.id]: {
        ...(current[rule.id] ?? buildImportRuleDraft(rule)),
        ...patch,
      },
    }));
  }

  async function handleSaveRule(rule: ImportReviewRule) {
    const currentDraft = getRuleDraft(rule);
    setPendingRuleId(rule.id);
    setRuleError(null);
    setRuleMessage(null);

    try {
      await updateImportReviewRule(rule.id, mapRuleDraftToPayload(currentDraft));
      setEditingRuleId(null);
      setRuleMessage("Import rule updated.");
      await rulesData.reload();
    } catch (error) {
      setRuleError(error instanceof Error ? error.message : "Import rule update failed.");
    } finally {
      setPendingRuleId(null);
    }
  }

  async function handleDeleteRule(ruleId: string) {
    setPendingRuleId(ruleId);
    setRuleError(null);
    setRuleMessage(null);

    try {
      await deleteImportReviewRule(ruleId);
      setEditingRuleId((current) => current === ruleId ? null : current);
      setRuleMessage("Import rule deleted.");
      await rulesData.reload();
    } catch (error) {
      setRuleError(error instanceof Error ? error.message : "Import rule delete failed.");
    } finally {
      setPendingRuleId(null);
    }
  }

  async function handleRuleModeChange(rule: ImportReviewRule, nextMode: "suggestion" | "reusable_rule", autoApply: boolean) {
    setPendingRuleId(rule.id);
    setRuleError(null);
    setRuleMessage(null);

    try {
      await updateImportReviewRule(rule.id, {
        rule_type: nextMode,
        auto_apply: nextMode === "reusable_rule" ? autoApply : false,
      });
      setRuleMessage(nextMode === "suggestion" ? "Rule converted to suggestion only." : "Reusable rule updated.");
      await rulesData.reload();
    } catch (error) {
      setRuleError(error instanceof Error ? error.message : "Rule update failed.");
    } finally {
      setPendingRuleId(null);
    }
  }

  return (
    <PageShell
      eyebrow="Settings"
      title="Appearance Settings"
      description="Customize how RAF looks on this device and preview changes instantly."
    >
      <section className="grid gap-7 xl:grid-cols-[minmax(180px,20%),minmax(0,45%),minmax(320px,35%)]">
        <aside className="xl:sticky xl:top-6 xl:self-start">
          <Card title="Settings Navigation" subtitle="Choose what you want to adjust.">
            <div className="space-y-2">
              {settingsTabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={`w-full rounded-[1.25rem] border px-4 py-3 text-left transition duration-200 ${selectedCardClasses(activeTab === tab.id)}`}
                  onClick={() => setActiveTab(tab.id)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-[var(--text-strong)]">{tab.label}</div>
                      <div className="mt-1 text-[12px] italic leading-5 text-[var(--text-muted)]">{tab.description}</div>
                    </div>
                    {activeTab === tab.id ? <Badge tone="success">Active</Badge> : null}
                  </div>
                </button>
              ))}
            </div>
          </Card>
        </aside>

        <div className="space-y-6">
          {activeTab === "preferences" ? (
            <>
              {saveMessage ? <SuccessNotice title="Appearance updated" message={saveMessage} /> : null}

              <Card title="Theme">
                <div className="space-y-6">
                  <div className="border-b border-[var(--border-color)] pb-6">
                    <div className="text-[17px] font-semibold text-[var(--text-strong)]">Theme</div>
                    <p className="mt-2 max-w-2xl text-[13px] italic leading-6 text-[var(--text-muted)]">
                      Choose a mood that fits how you want RAF to feel while you review income, allocations, and transactions.
                    </p>
                  </div>

                  <div className="grid gap-5 lg:grid-cols-2">
                    {themeGroups.map((group, index) => (
                      <div
                        key={group.mood}
                        className={`space-y-3 ${index === 0 ? "lg:col-span-2" : ""}`}
                      >
                        <div>
                          <div className="text-sm font-semibold text-[var(--text-strong)]">{group.mood}</div>
                          <p className="mt-1 text-[12px] italic text-[var(--text-muted)]">{group.helper}</p>
                        </div>
                        <div className={`grid gap-3 ${group.values.length > 1 ? "md:grid-cols-2" : ""}`}>
                          {group.values.map((themeValue) => {
                            const option = THEME_OPTIONS.find((item) => item.value === themeValue);
                            if (!option) {
                              return null;
                            }
                            const selected = draft.theme_color === option.value;

                            return (
                              <button
                                key={option.value}
                                type="button"
                                className={`rounded-[1.5rem] border p-5 text-left transition duration-200 ${selectedCardClasses(selected)}`}
                                style={{ background: selected ? undefined : "var(--surface-plain)" }}
                                onClick={() => updateDraft({ theme_color: option.value })}
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="flex items-start gap-4">
                                    <span
                                      className="h-12 w-12 shrink-0 rounded-2xl border border-white/80 shadow-sm"
                                      style={{ background: `linear-gradient(145deg, ${option.swatch}, ${option.accent})` }}
                                    />
                                    <div>
                                      <div className="text-base font-semibold text-[var(--text-strong)]">{option.label}</div>
                                      <div className="mt-1 text-[13px] italic text-[var(--text-muted)]">{group.mood} theme</div>
                                    </div>
                                  </div>
                                  {selected ? (
                                    <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[var(--primary-color)] text-[var(--primary-contrast)] shadow-sm">
                                      <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="m5 10 3 3 7-7" />
                                      </svg>
                                    </span>
                                  ) : null}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </Card>

              <Card title="Font Family">
                <div className="space-y-5">
                  <div className="border-b border-[var(--border-color)] pb-6">
                    <div className="text-[17px] font-semibold text-[var(--text-strong)]">Font family</div>
                    <p className="mt-2 max-w-2xl text-[13px] italic leading-6 text-[var(--text-muted)]">
                      Pick the reading voice you want across RAF. The preview updates instantly so dense financial data stays easy to judge.
                    </p>
                  </div>

                  <div className="grid gap-3">
                    {FONT_OPTIONS.map((option) => {
                      const selected = draft.font_family === option.value;

                      return (
                        <button
                          key={option.value}
                          type="button"
                          className={`rounded-[1.5rem] border p-5 text-left transition duration-200 ${selectedCardClasses(selected)}`}
                          style={{ background: selected ? undefined : "var(--surface-plain)" }}
                          onClick={() => updateDraft({ font_family: option.value })}
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <div
                                className="text-lg font-semibold text-[var(--text-strong)]"
                                style={{ fontFamily: `var(--font-${option.value})` }}
                              >
                                {option.label}
                              </div>
                              <p className="mt-1 text-[13px] italic leading-6 text-[var(--text-muted)]">
                                {option.preview}
                              </p>
                            </div>
                            {selected ? (
                              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[var(--primary-color)] text-[var(--primary-contrast)] shadow-sm">
                                <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="m5 10 3 3 7-7" />
                                </svg>
                              </span>
                            ) : null}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </Card>

              <Card title="Interface Scale">
                <div className="space-y-5">
                  <div className="border-b border-[var(--border-color)] pb-6">
                    <div className="text-[17px] font-semibold text-[var(--text-strong)]">Scale</div>
                    <p className="mt-2 max-w-2xl text-[13px] italic leading-6 text-[var(--text-muted)]">
                      Adjust how compact or spacious the interface feels without changing the structure of the application.
                    </p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3">
                    {INTERFACE_SCALE_OPTIONS.map((option) => {
                      const selected = draft.interface_scale === option.value;
                      const sizeClass = option.value === "small"
                        ? "text-base"
                        : option.value === "medium"
                          ? "text-lg"
                          : "text-xl";

                      return (
                        <button
                          key={option.value}
                          type="button"
                          className={`rounded-[1.5rem] border p-5 text-left transition duration-200 ${selectedCardClasses(selected)}`}
                          style={{ background: selected ? undefined : "var(--surface-plain)" }}
                          onClick={() => updateDraft({ interface_scale: option.value })}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className={`${sizeClass} font-semibold text-[var(--text-strong)]`}>
                              {option.label}
                            </div>
                            {selected ? (
                              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[var(--primary-color)] text-[var(--primary-contrast)] shadow-sm">
                                <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="m5 10 3 3 7-7" />
                                </svg>
                              </span>
                            ) : null}
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  <div className="border-t border-[var(--border-color)] pt-6">
                    <div className="text-[17px] font-semibold text-[var(--text-strong)]">Mode</div>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      {APPEARANCE_MODE_OPTIONS.map((option) => {
                        const selected = draft.appearance_mode === option.value;

                        return (
                          <button
                            key={option.value}
                            type="button"
                            className={`rounded-[1.5rem] border p-5 text-left transition duration-200 ${selectedCardClasses(selected)}`}
                            style={{ background: selected ? undefined : "var(--surface-plain)" }}
                            onClick={() => updateDraft({ appearance_mode: option.value })}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="text-base font-semibold text-[var(--text-strong)]">{option.label}</div>
                              {selected ? (
                                <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[var(--primary-color)] text-[var(--primary-contrast)] shadow-sm">
                                  <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="m5 10 3 3 7-7" />
                                  </svg>
                                </span>
                              ) : null}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </Card>

              <div className="pt-1">
                <Card title="Apply Appearance Changes">
                  <div className="space-y-4">
                    <p className="text-[13px] leading-6 text-[var(--text-muted)]">
                      Saving will update your appearance across RAF. Cancel keeps your current look. Restoring defaults resets everything to the RAF preset.
                    </p>
                    <div className="flex flex-col gap-3">
                      <Button type="button" className="w-full" disabled={!hasChanges} onClick={handleSave}>
                        Save Appearance
                      </Button>
                      <Button type="button" variant="secondary" className="w-full" disabled={!hasChanges} onClick={handleCancel}>
                        Cancel
                      </Button>
                    </div>
                    <div className="pt-1">
                      <button
                        type="button"
                        className="text-sm font-medium text-rose-700 transition hover:text-rose-800"
                        onClick={handleRestoreDefaults}
                      >
                        Restore defaults
                      </button>
                    </div>
                  </div>
                </Card>
              </div>
            </>
          ) : (
            <>
              {rulesData.isLoading ? <LoadingState label="Loading import rules..." /> : null}
              {!rulesData.isLoading && rulesData.error ? <ErrorState title="Failed to load import rules" message={rulesData.error} onRetry={() => void rulesData.reload()} /> : null}
              {ruleError ? <ErrorState title="Rule action failed" message={ruleError} /> : null}
              {ruleMessage ? <SuccessNotice title="Import rules updated" message={ruleMessage} /> : null}
              {!rulesData.isLoading && !rulesData.error && rulesData.data ? (
                <Card title="Import Rules" subtitle="Suggestions stay review-only. Reusable rules can have auto-apply enabled or disabled at any time.">
                  {rulesData.data.rules.length ? (
                    <div className="space-y-3">
                      {rulesData.data.rules.map((rule) => {
                        const isEditing = editingRuleId === rule.id;
                        const isPending = pendingRuleId === rule.id;

                        return (
                          <div key={rule.id} className="rounded-2xl border border-[var(--border-color)] bg-[var(--surface-color)]">
                            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                              <div className="space-y-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-sm font-semibold text-[var(--text-strong)]">
                                    {rule.match_type === "contains" ? `Description contains "${rule.match_value}"` : `Description equals "${rule.match_value}"`}
                                  </span>
                                  <Badge tone={rule.rule_type === "reusable_rule" ? "neutral" : "warning"}>
                                    {rule.rule_type === "reusable_rule" ? "Reusable rule" : "Suggestion"}
                                  </Badge>
                                  <Badge tone={rule.auto_apply ? "success" : "neutral"}>
                                    {rule.auto_apply ? "Auto-apply on" : "Auto-apply off"}
                                  </Badge>
                                </div>
                                <div className="text-sm text-stone-500">
                                  {ruleActionLabel(rule)}
                                  {rule.category_id ? ` • ${rulesData.data.categories.find((item) => item.id === rule.category_id)?.label ?? rule.category_id}` : ""}
                                  {rule.last_used_at ? ` • last used ${new Date(rule.last_used_at).toLocaleDateString()}` : " • not used yet"}
                                </div>
                              </div>

                              <div className="flex flex-wrap items-center gap-2">
                                <Button type="button" variant="ghost" onClick={() => setEditingRuleId((current) => current === rule.id ? null : rule.id)}>
                                  {isEditing ? "Close editor" : "Edit rule"}
                                </Button>
                                {rule.rule_type === "reusable_rule" && rule.auto_apply ? (
                                  <Button type="button" variant="secondary" disabled={isPending} onClick={() => void handleRuleModeChange(rule, "reusable_rule", false)}>
                                    Disable auto-apply
                                  </Button>
                                ) : null}
                                {rule.rule_type === "reusable_rule" && !rule.auto_apply ? (
                                  <Button type="button" variant="secondary" disabled={isPending} onClick={() => void handleRuleModeChange(rule, "reusable_rule", true)}>
                                    Enable auto-apply
                                  </Button>
                                ) : null}
                                {rule.rule_type !== "suggestion" ? (
                                  <Button type="button" variant="secondary" disabled={isPending} onClick={() => void handleRuleModeChange(rule, "suggestion", false)}>
                                    Convert to suggestion only
                                  </Button>
                                ) : null}
                                <Button type="button" variant="ghost" disabled={isPending} onClick={() => void handleDeleteRule(rule.id)}>
                                  Delete rule
                                </Button>
                              </div>
                            </div>

                            {isEditing ? (
                              <div className="border-t border-[var(--border-color)] px-4 py-4">
                                <ImportRuleEditor
                                  categories={rulesData.data.categories}
                                  debts={rulesData.data.debts}
                                  fixedBills={rulesData.data.fixedBills}
                                  goals={rulesData.data.goals}
                                  draft={getRuleDraft(rule)}
                                  isSaving={isPending}
                                  saveLabel="Save rule"
                                  onChange={(patch) => updateRuleDraft(rule, patch)}
                                  onCancel={() => setEditingRuleId(null)}
                                  onSave={() => void handleSaveRule(rule)}
                                />
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <EmptyState
                      title="No import rules saved"
                      message="Use transaction review to save suggestions or reusable rules, then manage them here."
                    />
                  )}
                </Card>
              ) : null}
            </>
          )}
        </div>

        <aside className="xl:sticky xl:top-6 xl:self-start">
          {activeTab === "preferences" ? (
            <Card title="Live Preview">
              <div
                className="space-y-4 rounded-[1.75rem] border border-[var(--border-color)] bg-[var(--surface-elevated)] p-5"
                data-theme={draft.theme_color}
                data-font={draft.font_family}
                data-mode={draft.appearance_mode}
                data-scale={draft.interface_scale}
              >
                <div className="space-y-3 border-b border-[var(--border-color)] pb-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="neutral">{`Theme: ${activeTheme.label}`}</Badge>
                    <Badge tone="neutral">{`Font: ${activeFont.label}`}</Badge>
                    <Badge tone="neutral">{`Size: ${activeScale.label}`}</Badge>
                    <Badge tone="neutral">{`Mode: ${activeMode.label}`}</Badge>
                  </div>
                  <div>
                    <div className="text-[18px] font-semibold text-[var(--text-strong)]">Live Preview</div>
                    <p className="mt-1 text-[13px] italic leading-5 text-[var(--text-muted)]">
                      This preview mirrors the kinds of cards, balances, and transaction rows you see across RAF.
                    </p>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="rounded-[1.5rem] border border-[var(--border-color)] bg-[var(--surface-color)] p-4 shadow-panel">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-[12px] font-medium text-[var(--text-muted)]">Accent action</div>
                        <div className="mt-1 text-sm font-semibold text-[var(--text-strong)]">Record deposit</div>
                      </div>
                      <button
                        type="button"
                        className="inline-flex rounded-full bg-[var(--primary-color)] px-3.5 py-2 text-sm font-semibold text-[var(--primary-contrast)] shadow-sm"
                      >
                        Record deposit
                      </button>
                    </div>
                  </div>

                  <div className="rounded-[1.5rem] border border-[var(--border-color)] bg-[var(--surface-color)] p-4 shadow-panel">
                    <div className="text-[12px] font-medium text-[var(--text-muted)]">Financial data surface</div>
                    <div className="mt-3 flex items-end justify-between gap-4">
                      <div>
                        <div className="text-sm text-[var(--text-muted)]">Buffer balance</div>
                        <div className="mt-1.5 text-[1.75rem] font-semibold tracking-tight text-[var(--text-strong)]">$2,930.28</div>
                      </div>
                      <Badge tone="success">Healthy</Badge>
                    </div>
                  </div>

                  <div className="rounded-[1.5rem] border border-[var(--border-color)] bg-[var(--surface-color)] p-4 shadow-panel">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="text-[12px] font-medium text-[var(--text-muted)]">Transaction example</div>
                        <div className="mt-2.5 space-y-0.5">
                          <div className="text-xs text-[var(--text-muted)]">Mar 7</div>
                          <div className="text-sm font-semibold text-[var(--text-strong)]">Gas Station</div>
                          <div className="text-xs text-[var(--text-muted)]">Personal Spending</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-base font-semibold text-[var(--text-strong)]">-$45.00</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          ) : (
            <Card title="Rule Management">
              <div className="space-y-4 rounded-[1.75rem] border border-[var(--border-color)] bg-[var(--surface-elevated)] p-6">
                <div>
                  <div className="text-[18px] font-semibold text-[var(--text-strong)]">Import rule controls</div>
                  <p className="mt-2 text-[13px] italic leading-6 text-[var(--text-muted)]">
                    Suggestions remain review-only. Reusable rules can be enabled, disabled, edited, or converted back to suggestions at any time.
                  </p>
                </div>
                <div className="space-y-3">
                  <div className="rounded-[1.5rem] border border-[var(--border-color)] bg-[var(--surface-color)] p-4">
                    <div className="text-sm font-semibold text-[var(--text-strong)]">Suggestion</div>
                    <div className="mt-1 text-[13px] italic text-[var(--text-muted)]">Prefills the next similar import but never auto-applies it.</div>
                  </div>
                  <div className="rounded-[1.5rem] border border-[var(--border-color)] bg-[var(--surface-color)] p-4">
                    <div className="text-sm font-semibold text-[var(--text-strong)]">Reusable rule</div>
                    <div className="mt-1 text-[13px] italic text-[var(--text-muted)]">Keeps the same review intent saved for later, with auto-apply always visible and reversible.</div>
                  </div>
                  <div className="rounded-[1.5rem] border border-dashed border-[var(--border-color)] bg-[var(--surface-color)] p-4">
                    <div className="text-sm font-semibold text-[var(--text-strong)]">Safety reminder</div>
                    <div className="mt-1 text-[13px] italic text-[var(--text-muted)]">Rules shape future review drafts, but they do not remove the audit trail for imported transactions.</div>
                  </div>
                </div>
              </div>
            </Card>
          )}
        </aside>
      </section>
    </PageShell>
  );
}
