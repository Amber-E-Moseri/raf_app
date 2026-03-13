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

function createNewCategoryDraft(sortOrder: number): DraftCategory {
  const tempId = `draft_${crypto.randomUUID()}`;
  return {
    id: tempId,
    slug: "",
    label: "",
    sortOrder,
    allocationPercent: "0.0000",
    isActive: true,
    isSystem: false,
    isNew: true,
    slugEdited: false,
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

export function AllocationPreferences() {
  const [categories, setCategories] = useState<DraftCategory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [updateEndpointMissing, setUpdateEndpointMissing] = useState(false);

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

  function updateCategory(id: string, updater: (category: DraftCategory) => DraftCategory) {
    setCategories((current) => current.map((category) => (
      category.id === id ? updater(category) : category
    )));
    setSaveError(null);
    setSaveSuccess(null);
  }

  function addCategory() {
    const nextSortOrder = categories.reduce((max, category) => Math.max(max, category.sortOrder), 0) + 1;
    setCategories((current) => [...current, createNewCategoryDraft(nextSortOrder)]);
    setSaveError(null);
    setSaveSuccess(null);
  }

  function removeDraftCategory(id: string) {
    setCategories((current) => current.filter((category) => category.id !== id));
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
      eyebrow="Configuration"
      title="Allocation Preferences"
      description="Edit allocation categories as normal rows. Buffer is optional and behaves like any other category in the editor."
      actions={(
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="secondary" onClick={addCategory}>
            Add Category
          </Button>
          <Button type="button" disabled={!canSave || isSaving} onClick={() => void handleSave()}>
            {isSaving ? "Saving..." : "Save Preferences"}
          </Button>
        </div>
      )}
    >
      <section className="grid gap-4 xl:grid-cols-[1.15fr,0.85fr]">
        <Card title="Categories" subtitle="Every category is edited the same way. Future rounding is handled by the backend.">
          {isLoading ? <LoadingState label="Loading allocation categories..." /> : null}
          {!isLoading && loadError ? <ErrorState title="Failed to load allocation preferences" message={loadError} onRetry={() => void loadCategories()} /> : null}
          {!isLoading && !loadError && !categories.length ? (
            <EmptyState
              title="No categories available"
              message="The backend did not return allocation categories, so preferences cannot be edited yet."
            />
          ) : null}
          {!isLoading && !loadError && categories.length ? (
            <div className="space-y-4">
              {categories.map((category) => {
                const errors = validation.get(category.id) ?? {};

                return (
                  <div key={category.id} className="rounded-3xl border border-stone-200 bg-stone-50 p-4">
                    <div className="grid gap-4 md:grid-cols-[1.4fr,1fr,0.8fr,0.8fr,auto]">
                      <label className="block">
                        <span className="mb-2 block text-sm font-medium text-raf-ink">Category name</span>
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
                        {errors.label ? <p className="mt-2 text-xs text-rose-600">{errors.label}</p> : null}
                      </label>
                      <label className="block">
                        <span className="mb-2 block text-sm font-medium text-raf-ink">Slug</span>
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
                        <span className="mb-2 block text-sm font-medium text-raf-ink">Percentage</span>
                        <input
                          className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-raf-ink outline-none transition focus:border-raf-moss focus:ring-2 focus:ring-raf-sage"
                          type="number"
                          step="0.01"
                          min="0"
                          value={toPercentInput(category.allocationPercent)}
                          onChange={(event) => updateCategory(category.id, (current) => ({
                            ...current,
                            allocationPercent: toFractionString(event.target.value),
                          }))}
                        />
                        {errors.allocationPercent ? <p className="mt-2 text-xs text-rose-600">{errors.allocationPercent}</p> : null}
                      </label>
                      <label className="block">
                        <span className="mb-2 block text-sm font-medium text-raf-ink">Sort order</span>
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
                      <div className="grid gap-3">
                        <label className="flex items-center gap-2 text-sm text-raf-ink">
                          <input
                            type="checkbox"
                            checked={category.isActive}
                            onChange={(event) => updateCategory(category.id, (current) => ({
                              ...current,
                              isActive: event.target.checked,
                            }))}
                          />
                          Active
                        </label>
                        {category.isNew ? (
                          <Button type="button" variant="ghost" className="justify-start px-0 py-0 text-rose-700" onClick={() => removeDraftCategory(category.id)}>
                            Remove
                          </Button>
                        ) : null}
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                      <Badge tone={category.isActive ? "success" : "neutral"}>{category.isActive ? "active" : "inactive"}</Badge>
                      {category.isSystem ? <Badge tone="warning">system</Badge> : <Badge tone="neutral">custom</Badge>}
                      {category.slug === "buffer" ? <Badge tone="success">buffer slug</Badge> : null}
                      <span className="text-stone-500">Slug: {category.slug || "pending"}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </Card>

        <div className="space-y-4">
          <Card title="Validation" subtitle="The editor only validates shape and totals. The backend remains the source of truth for allocation logic.">
            <div className="space-y-4">
              <div className="rounded-2xl bg-stone-50 p-4">
                <p className="text-sm text-stone-500">Active total</p>
                <p className="mt-1 text-2xl font-semibold text-raf-ink">{activeTotalPercent.toFixed(2)}%</p>
                <p className="mt-2 text-sm text-stone-500">Fraction stored: {activeTotalFraction.toFixed(4)}</p>
              </div>
              <div className="flex items-center gap-3">
                <Badge tone={isValidTotal ? "success" : "danger"}>
                  {isValidTotal ? "sum valid" : "sum invalid"}
                </Badge>
                <span className="text-sm text-stone-600">
                  Target is {formatPercentWithDigits("1", 2)} of active allocations.
                </span>
              </div>
              {!isValidTotal ? (
                <ErrorState
                  title="Percentages do not sum correctly"
                  message="Active allocation percentages must equal 100.00% before save is allowed."
                />
              ) : null}
              {hasFieldErrors ? (
                <ErrorState
                  title="Category fields need attention"
                  message="Each category needs a unique slug, a name, a valid percentage, and a whole-number sort order."
                />
              ) : null}
            </div>
          </Card>

          <Card title="Rounding" subtitle="The UI does not pick a special remainder target. The backend handles it deterministically.">
            <ul className="space-y-3 text-sm text-stone-600">
              <li>If an active category with slug `buffer` exists, it receives any rounding remainder.</li>
              <li>If no active `buffer` category exists, the largest allocation receives the remainder.</li>
              <li>Ties are broken by percent descending, then sort order ascending, then slug ascending.</li>
            </ul>
          </Card>

          {saveError ? <ErrorState title="Failed to save allocation preferences" message={saveError} /> : null}
          {saveSuccess ? <SuccessNotice title="Preferences saved" message={saveSuccess} /> : null}
        </div>
      </section>
    </PageShell>
  );
}
