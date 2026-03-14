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
  THEME_OPTIONS,
} from "../lib/appearance";
import type { AppearancePreferences } from "../lib/appearance";
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
    description: "Appearance and device-level profile settings.",
  },
  {
    id: "import_rules",
    label: "Import Rules",
    description: "Suggestions, reusable rules, and auto-apply controls for bank imports.",
  },
];

function ruleActionLabel(rule: ImportReviewRule) {
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
    return "Link to goal funding";
  }
  if (rule.classification_type === "duplicate") {
    return "Mark duplicate";
  }
  if (rule.classification_type === "transfer") {
    return "Mark transfer";
  }
  return "Ignore";
}

export function AppearanceSettings() {
  const {
    preferences,
    resetAppearance,
    saveAppearance,
  } = useAppearance();
  const [activeTab, setActiveTab] = useState<SettingsTab>("preferences");
  const [draft, setDraft] = useState<AppearancePreferences>(preferences);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [ruleMessage, setRuleMessage] = useState<string | null>(null);
  const [ruleError, setRuleError] = useState<string | null>(null);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [ruleDrafts, setRuleDrafts] = useState<Record<string, ReturnType<typeof buildImportRuleDraft>>>({});
  const [pendingRuleId, setPendingRuleId] = useState<string | null>(null);

  const rulesData = useAsyncData<ProfileSettingsViewModel>(async () => {
    const [categoriesResponse, debtsResponse, fixedBillsResponse, goalsResponse, rulesResponse] = await Promise.all([
      getAllocationCategories(),
      getDebts(),
      getFixedBills(),
      getGoals(),
      getImportReviewRules(),
    ]);

    return {
      categories: categoriesResponse.items,
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
      eyebrow="Profile"
      title="Profile"
      description="Settings for appearance and import review behavior."
      actions={activeTab === "preferences" ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={handleResetDraft}>Reset form</Button>
          <Button type="button" variant="secondary" onClick={resetAppearance}>Restore saved defaults</Button>
          <Button type="button" disabled={!hasChanges} onClick={handleSave}>Save Appearance</Button>
        </div>
      ) : null}
    >
      <section className="grid gap-4 xl:grid-cols-[220px,1fr]">
        <Card title="Settings" subtitle="Profile">
          <div className="space-y-2">
            {settingsTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                  activeTab === tab.id
                    ? "border-[var(--primary-color)] bg-[var(--primary-soft)]"
                    : "border-[var(--border-color)] bg-[var(--surface-color)]"
                }`}
                onClick={() => setActiveTab(tab.id)}
              >
                <div className="text-sm font-semibold text-[var(--text-strong)]">{tab.label}</div>
                <div className="mt-1 text-xs text-stone-500">{tab.description}</div>
              </button>
            ))}
          </div>
        </Card>

        <div className="space-y-4">
          {activeTab === "preferences" ? (
            <>
              {saveMessage ? <SuccessNotice title="Profile updated" message={saveMessage} /> : null}
              <section className="grid gap-4 xl:grid-cols-[0.9fr,1.1fr]">
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

              <section className="grid gap-4 xl:grid-cols-[0.9fr,1.1fr]">
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
      </section>
    </PageShell>
  );
}
