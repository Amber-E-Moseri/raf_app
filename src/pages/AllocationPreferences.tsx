import { useEffect, useMemo, useState } from "react";

import { ApiError } from "../api/client";
import { getAllocationCategories, saveAllocationCategories } from "../api/allocationCategoriesApi";
import { ErrorState } from "../components/feedback/ErrorState";
import { LoadingState } from "../components/feedback/LoadingState";
import { SuccessNotice } from "../components/feedback/SuccessNotice";
import { PageShell } from "../components/layout/PageShell";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { formatPercentWithDigits } from "../lib/format";
import type { AllocationCategory, AllocationCategoryWriteItem } from "../lib/types";

interface DraftCategory extends AllocationCategory {
  isNew: boolean;
  slugEdited: boolean;
}

interface CategoryErrors {
  label?: string;
  slug?: string;
  allocationPercent?: string;
  sortOrder?: string;
}

interface NewCategoryFormState {
  label: string;
  allocationPercent: string;
  isActive: boolean;
}

function toPercentInput(allocationPercent: string) {
  return (Number(allocationPercent) * 100).toFixed(2);
}

function toFractionString(percentInput: string) {
  const normalized = Number(percentInput || "0");
  if (!Number.isFinite(normalized)) {
    return "0.0000";
  }

  return (normalized / 100).toFixed(4);
}

function approximatelyOne(total: number) {
  return Math.abs(total - 1) <= 0.0001;
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

function toDraftCategory(item: AllocationCategory): DraftCategory {
  return {
    ...item,
    isNew: false,
    slugEdited: true,
  };
}

function createNewCategoryDraft(sortOrder: number, form?: Partial<NewCategoryFormState>): DraftCategory {
  const tempId = `draft_${crypto.randomUUID()}`;
  const label = form?.label?.trim() ?? "";

  return {
    id: tempId,
    slug: slugify(label),
    label,
    sortOrder,
    allocationPercent: toFractionString(form?.allocationPercent ?? "0"),
    isActive: form?.isActive ?? true,
    isSystem: false,
    isNew: true,
    slugEdited: Boolean(label),
  };
}

function validateCategory(category: DraftCategory): CategoryErrors {
  const errors: CategoryErrors = {};

  if (!category.label.trim()) {
    errors.label = "Category name is required.";
  }

  if (!category.slug.trim()) {
    errors.slug = "Slug is required.";
  } else if (!/^[a-z0-9_]+$/.test(category.slug.trim())) {
    errors.slug = "Use lowercase letters, numbers, and underscores only.";
  }

  const allocationPercent = Number(category.allocationPercent);
  if (!Number.isFinite(allocationPercent) || allocationPercent < 0 || allocationPercent > 1) {
    errors.allocationPercent = "Use a valid percentage between 0.00 and 100.00.";
  }

  if (!Number.isInteger(category.sortOrder)) {
    errors.sortOrder = "Sort order must be a whole number.";
  }

  return errors;
}

function buildInlineValidationMessage(activeTotalPercent: number, isValidTotal: boolean) {
  if (isValidTotal) {
    return `Total Allocated: ${activeTotalPercent.toFixed(2)}% - balanced`;
  }

  if (activeTotalPercent < 100) {
    return `Total Allocated: ${activeTotalPercent.toFixed(2)}% - add ${(100 - activeTotalPercent).toFixed(2)}% to reach 100%.`;
  }

  return `Total Allocated: ${activeTotalPercent.toFixed(2)}% - reduce ${(activeTotalPercent - 100).toFixed(2)}% to reach 100%.`;
}

function buildTotalTone(activeTotalPercent: number, isValidTotal: boolean): "success" | "warning" | "danger" {
  if (isValidTotal) {
    return "success";
  }

  return activeTotalPercent > 100 ? "danger" : "warning";
}

function allocationBarWidth(activeTotalPercent: number) {
  return `${Math.max(0, Math.min(activeTotalPercent, 100))}%`;
}

function normalizePercentDraft(value: string) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "0.00";
  }

  return numeric.toFixed(2);
}

const DEFAULT_NEW_CATEGORY_FORM: NewCategoryFormState = {
  label: "",
  allocationPercent: "0.00",
  isActive: true,
};

export function AllocationPreferences() {
  const [categories, setCategories] = useState<DraftCategory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [updateEndpointMissing, setUpdateEndpointMissing] = useState(false);
  const [expandedAdvanced, setExpandedAdvanced] = useState<Record<string, boolean>>({});
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newCategoryForm, setNewCategoryForm] = useState<NewCategoryFormState>(DEFAULT_NEW_CATEGORY_FORM);

  async function loadCategories() {
    setIsLoading(true);
    setLoadError(null);
    setUpdateEndpointMissing(false);

    try {
      const items = await getAllocationCategories();
      setCategories(items.map(toDraftCategory));
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        setLoadError("The backend does not currently expose allocation category endpoints.");
      } else {
        setLoadError(error instanceof Error ? error.message : "Allocation categories could not be loaded.");
      }
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadCategories();
  }, []);

  const validation = useMemo(() => {
    const errorsById = new Map<string, CategoryErrors>();
    const slugCounts = new Map<string, number>();

    for (const category of categories) {
      const trimmedSlug = category.slug.trim();
      if (trimmedSlug) {
        slugCounts.set(trimmedSlug, (slugCounts.get(trimmedSlug) ?? 0) + 1);
      }
    }

    for (const category of categories) {
      const errors = validateCategory(category);
      const trimmedSlug = category.slug.trim();

      if (trimmedSlug && (slugCounts.get(trimmedSlug) ?? 0) > 1) {
        errors.slug = "Slug must be unique.";
      }

      errorsById.set(category.id, errors);
    }

    return errorsById;
  }, [categories]);

  const activeTotalFraction = useMemo(() => {
    return categories.reduce((sum, category) => {
      if (!category.isActive) {
        return sum;
      }

      return sum + Number(category.allocationPercent);
    }, 0);
  }, [categories]);

  const activeTotalPercent = useMemo(() => activeTotalFraction * 100, [activeTotalFraction]);
  const isValidTotal = approximatelyOne(activeTotalFraction);
  const hasFieldErrors = Array.from(validation.values()).some((errors) => Object.keys(errors).length > 0);
  const canSave = categories.length > 0 && isValidTotal && !hasFieldErrors && !updateEndpointMissing;
  const activeCategoryCount = categories.filter((category) => category.isActive).length;
  const inlineValidationMessage = buildInlineValidationMessage(activeTotalPercent, isValidTotal);
  const totalTone = buildTotalTone(activeTotalPercent, isValidTotal);

  function updateCategory(id: string, updater: (category: DraftCategory) => DraftCategory) {
    setCategories((current) => current.map((category) => (
      category.id === id ? updater(category) : category
    )));
    setSaveError(null);
    setSaveSuccess(null);
  }

  function toggleAdvanced(id: string) {
    setExpandedAdvanced((current) => ({
      ...current,
      [id]: !current[id],
    }));
  }

  function openAddCategoryModal() {
    setNewCategoryForm(DEFAULT_NEW_CATEGORY_FORM);
    setIsAddModalOpen(true);
    setSaveError(null);
    setSaveSuccess(null);
  }

  function closeAddCategoryModal() {
    setIsAddModalOpen(false);
    setNewCategoryForm(DEFAULT_NEW_CATEGORY_FORM);
  }

  function addCategoryFromModal() {
    if (!newCategoryForm.label.trim()) {
      return;
    }

    const nextSortOrder = categories.reduce((max, category) => Math.max(max, category.sortOrder), 0) + 1;
    const draft = createNewCategoryDraft(nextSortOrder, {
      ...newCategoryForm,
      allocationPercent: normalizePercentDraft(newCategoryForm.allocationPercent),
    });

    setCategories((current) => [...current, draft]);
    setExpandedAdvanced((current) => ({
      ...current,
      [draft.id]: false,
    }));
    closeAddCategoryModal();
  }

  function removeDraftCategory(id: string) {
    setCategories((current) => current.filter((category) => category.id !== id));
    setExpandedAdvanced((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    setSaveError(null);
    setSaveSuccess(null);
  }

  async function handleSave() {
    if (!canSave) {
      return;
    }

    setIsSaving(true);
    setSaveError(null);
    setSaveSuccess(null);

    try {
      const payload: AllocationCategoryWriteItem[] = categories.map((category) => ({
        slug: category.slug.trim(),
        label: category.label.trim(),
        sortOrder: category.sortOrder,
        allocationPercent: category.allocationPercent,
        isActive: category.isActive,
      }));

      await saveAllocationCategories(payload);
      setSaveSuccess("Allocation preferences saved.");
      await loadCategories();
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        setUpdateEndpointMissing(true);
        setSaveError("The backend allocation category update endpoint is not available.");
      } else {
        setSaveError(error instanceof Error ? error.message : "Allocation preferences could not be saved.");
      }
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <PageShell
      eyebrow="Planning"
      title="Allocation Preferences"
      description="Adjust bucket percentages and keep the active total balanced."
      actions={(
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="secondary" onClick={openAddCategoryModal}>
            Add Category
          </Button>
          <Button type="button" disabled={!canSave || isSaving} onClick={() => void handleSave()}>
            {isSaving ? "Saving..." : "Save Preferences"}
          </Button>
        </div>
      )}
    >
      <section className="grid gap-4">
        <Card
          title="Allocation Summary"
          subtitle="Keep active buckets at exactly 100% before saving."
          actions={(
            <Badge tone={totalTone}>
              {activeCategoryCount} active
            </Badge>
          )}
        >
          <div className="space-y-4">
            <div>
              <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                <div>
                  <p className="text-[11px] font-medium text-stone-500">Total allocated</p>
                  <p className="mt-1 text-3xl font-bold tracking-tight text-raf-ink">{activeTotalPercent.toFixed(2)}%</p>
                </div>
                <div className="max-w-sm text-right text-sm text-stone-600">
                  {inlineValidationMessage}
                </div>
              </div>
              <div className="mt-4 h-3 overflow-hidden rounded-full bg-stone-200">
                <div
                  className="h-full rounded-full bg-[var(--primary-color)] transition-[width] duration-200"
                  style={{ width: allocationBarWidth(activeTotalPercent) }}
                />
              </div>
            </div>
            {!isValidTotal ? (
              <p className="text-sm text-amber-700">
                Active allocation percentages must equal {formatPercentWithDigits("1", 2)} before save is allowed.
              </p>
            ) : null}
            {hasFieldErrors ? (
              <p className="text-sm text-rose-700">
                One or more categories still need attention before preferences can be saved.
              </p>
            ) : null}
          </div>
        </Card>

        <Card title="Allocation Buckets" subtitle="Focus on names, percentages, and whether each bucket is active.">
          {isLoading ? <LoadingState label="Loading allocation categories..." /> : null}
          {!isLoading && loadError ? <ErrorState title="Failed to load allocation preferences" message={loadError} onRetry={() => void loadCategories()} /> : null}
          {!isLoading && !loadError && !categories.length ? (
            <EmptyState
              title="No categories available"
              message="Add your first allocation bucket to start splitting each deposit."
            />
          ) : null}
          {!isLoading && !loadError && categories.length ? (
            <div className="space-y-4">
              {categories.map((category) => {
                const errors = validation.get(category.id) ?? {};
                const percentInput = toPercentInput(category.allocationPercent);
                const isAdvancedOpen = expandedAdvanced[category.id] ?? false;

                return (
                  <div
                    key={category.id}
                    className={`rounded-3xl border border-stone-200 bg-stone-50 p-5 transition ${category.isActive ? "" : "opacity-80"}`.trim()}
                  >
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <label className="block">
                              <span className="mb-2 block text-[11px] font-medium uppercase tracking-[0.14em] text-stone-500">
                                Category name
                              </span>
                              <input
                                className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-raf-ink outline-none transition focus:border-raf-moss focus:ring-2 focus:ring-raf-sage"
                                value={category.label}
                                onChange={(event) => updateCategory(category.id, (current) => {
                                  const nextLabel = event.target.value;
                                  return {
                                    ...current,
                                    label: nextLabel,
                                    slug: current.isNew && !current.slugEdited ? slugify(nextLabel) : current.slug,
                                  };
                                })}
                              />
                            </label>
                            {errors.label ? <p className="mt-2 text-xs text-rose-600">{errors.label}</p> : null}
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge tone={category.isActive ? "success" : "neutral"}>
                              {category.isActive ? "Active" : "Inactive"}
                            </Badge>
                            {category.isSystem ? <Badge tone="warning">System</Badge> : <Badge tone="neutral">Custom</Badge>}
                          </div>
                        </div>

                        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr),148px,120px]">
                          <label className="block">
                            <span className="mb-2 block text-[11px] font-medium uppercase tracking-[0.14em] text-stone-500">
                              Percentage slider
                            </span>
                            <div className="rounded-2xl border border-stone-300 bg-white px-4 py-4">
                              <input
                                className="h-2 w-full cursor-pointer accent-[var(--primary-color)]"
                                type="range"
                                min="0"
                                max="100"
                                step="0.25"
                                value={percentInput}
                                onChange={(event) => updateCategory(category.id, (current) => ({
                                  ...current,
                                  allocationPercent: toFractionString(event.target.value),
                                }))}
                              />
                            </div>
                          </label>

                          <label className="block">
                            <span className="mb-2 block text-[11px] font-medium uppercase tracking-[0.14em] text-stone-500">
                              Percentage
                            </span>
                            <div className="relative">
                              <input
                                className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 pr-10 text-sm text-raf-ink outline-none transition focus:border-raf-moss focus:ring-2 focus:ring-raf-sage"
                                type="number"
                                step="0.01"
                                min="0"
                                max="100"
                                value={percentInput}
                                onChange={(event) => updateCategory(category.id, (current) => ({
                                  ...current,
                                  allocationPercent: toFractionString(event.target.value),
                                }))}
                              />
                              <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-sm text-stone-500">%</span>
                            </div>
                            {errors.allocationPercent ? <p className="mt-2 text-xs text-rose-600">{errors.allocationPercent}</p> : null}
                          </label>

                          <div className="flex flex-col gap-3">
                            <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-stone-500">
                              Controls
                            </span>
                            <label className="flex items-center justify-between rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-raf-ink">
                              <span>Active</span>
                              <input
                                type="checkbox"
                                checked={category.isActive}
                                onChange={(event) => updateCategory(category.id, (current) => ({
                                  ...current,
                                  isActive: event.target.checked,
                                }))}
                              />
                            </label>
                            <button
                              type="button"
                              className="flex items-center justify-between rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-raf-ink transition hover:border-stone-400"
                              onClick={() => toggleAdvanced(category.id)}
                            >
                              <span>Advanced settings</span>
                              <span className="text-base">{isAdvancedOpen ? "v" : ">"}</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>

                    {isAdvancedOpen ? (
                      <div className="mt-4 rounded-2xl border border-stone-200 bg-white p-4">
                        <div className="grid gap-4 md:grid-cols-[1fr,160px,auto]">
                          <label className="block">
                            <span className="mb-2 block text-[11px] font-medium uppercase tracking-[0.14em] text-stone-500">
                              Slug
                            </span>
                            <input
                              className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-raf-ink outline-none transition focus:border-raf-moss focus:ring-2 focus:ring-raf-sage disabled:bg-stone-100 disabled:text-stone-500"
                              value={category.slug}
                              disabled={!category.isNew}
                              onChange={(event) => updateCategory(category.id, (current) => ({
                                ...current,
                                slug: slugify(event.target.value),
                                slugEdited: true,
                              }))}
                            />
                            {errors.slug ? <p className="mt-2 text-xs text-rose-600">{errors.slug}</p> : null}
                          </label>
                          <label className="block">
                            <span className="mb-2 block text-[11px] font-medium uppercase tracking-[0.14em] text-stone-500">
                              Sort order
                            </span>
                            <input
                              className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-raf-ink outline-none transition focus:border-raf-moss focus:ring-2 focus:ring-raf-sage"
                              type="number"
                              step="1"
                              value={category.sortOrder}
                              onChange={(event) => updateCategory(category.id, (current) => ({
                                ...current,
                                sortOrder: Number.parseInt(event.target.value || "0", 10),
                              }))}
                            />
                            {errors.sortOrder ? <p className="mt-2 text-xs text-rose-600">{errors.sortOrder}</p> : null}
                          </label>
                          <div className="flex items-end justify-start">
                            {category.isNew ? (
                              <Button
                                type="button"
                                variant="ghost"
                                className="h-auto rounded-2xl px-0 py-0 text-rose-700"
                                onClick={() => removeDraftCategory(category.id)}
                              >
                                Remove category
                              </Button>
                            ) : (
                              <p className="text-sm text-stone-500">
                                Backend fields stay tucked away here unless you need them.
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}
        </Card>

        {saveError ? <ErrorState title="Failed to save allocation preferences" message={saveError} /> : null}
        {saveSuccess ? <SuccessNotice title="Preferences saved" message={saveSuccess} /> : null}
      </section>

      {isAddModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/35 px-4">
          <div className="w-full max-w-lg rounded-[28px] border border-stone-200 bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-stone-500">New Bucket</p>
                <h3 className="mt-2 text-xl font-bold tracking-tight text-raf-ink">Add Category</h3>
                <p className="mt-2 text-sm text-stone-500">
                  Start with the name, percentage, and active state. Backend details stay hidden until needed.
                </p>
              </div>
              <button
                type="button"
                className="rounded-full border border-stone-300 px-3 py-1 text-sm text-stone-600 transition hover:border-stone-400"
                onClick={closeAddCategoryModal}
              >
                Close
              </button>
            </div>

            <div className="mt-6 grid gap-4">
              <label className="block">
                <span className="mb-2 block text-[11px] font-medium uppercase tracking-[0.14em] text-stone-500">
                  Category name
                </span>
                <input
                  className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-raf-ink outline-none transition focus:border-raf-moss focus:ring-2 focus:ring-raf-sage"
                  value={newCategoryForm.label}
                  onChange={(event) => setNewCategoryForm((current) => ({
                    ...current,
                    label: event.target.value,
                  }))}
                  placeholder="Emergency Fund"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-[11px] font-medium uppercase tracking-[0.14em] text-stone-500">
                  Starting percentage
                </span>
                <div className="relative">
                  <input
                    className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 pr-10 text-sm text-raf-ink outline-none transition focus:border-raf-moss focus:ring-2 focus:ring-raf-sage"
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    value={newCategoryForm.allocationPercent}
                    onChange={(event) => setNewCategoryForm((current) => ({
                      ...current,
                      allocationPercent: event.target.value,
                    }))}
                  />
                  <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-sm text-stone-500">%</span>
                </div>
              </label>

              <label className="flex items-center justify-between rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm text-raf-ink">
                <span>Active right away</span>
                <input
                  type="checkbox"
                  checked={newCategoryForm.isActive}
                  onChange={(event) => setNewCategoryForm((current) => ({
                    ...current,
                    isActive: event.target.checked,
                  }))}
                />
              </label>
            </div>

            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <Button type="button" variant="secondary" onClick={closeAddCategoryModal}>
                Cancel
              </Button>
              <Button type="button" disabled={!newCategoryForm.label.trim()} onClick={addCategoryFromModal}>
                Add Category
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </PageShell>
  );
}
