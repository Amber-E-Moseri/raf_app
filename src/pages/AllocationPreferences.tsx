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
  bufferSelected: boolean;
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

    try {
      const items = await getAllocationCategories();
      setCategories(items.map((item) => ({ ...item, bufferSelected: item.slug === "buffer" })));
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

  const activeTotalFraction = useMemo(() => {
    return categories.reduce((sum, category) => {
      if (!category.isActive) {
        return sum;
      }

      return sum + Number(category.allocationPercent);
    }, 0);
  }, [categories]);

  const activeTotalPercent = useMemo(() => activeTotalFraction * 100, [activeTotalFraction]);
  const activeBuffer = categories.find((category) => category.bufferSelected);
  const isValidTotal = approximatelyOne(activeTotalFraction);
  const canSave = categories.length > 0 && isValidTotal && Boolean(activeBuffer) && !updateEndpointMissing;

  function updateCategory(id: string, updates: Partial<DraftCategory>) {
    setCategories((current) => current.map((category) => (
      category.id === id ? { ...category, ...updates } : category
    )));
    setSaveError(null);
    setSaveSuccess(null);
  }

  function handleBufferSelection(id: string) {
    setCategories((current) => current.map((category) => ({
      ...category,
      bufferSelected: category.id === id,
    })));
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
        slug: category.slug,
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
        setSaveError("Backend gap: no allocation category update endpoint is available yet. The page is scaffolded for the expected contract.");
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
      description="Edit allocation category labels, percentages, active status, and ordering from backend-sourced category data."
      actions={
        <Button type="button" disabled={!canSave || isSaving} onClick={() => void handleSave()}>
          {isSaving ? "Saving..." : "Save Preferences"}
        </Button>
      }
    >
      <section className="grid gap-6 xl:grid-cols-[1.15fr,0.85fr]">
        <Card title="Categories" subtitle="This editor uses API category data only. No UI defaults are baked in.">
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
              {categories.map((category) => (
                <div key={category.id} className="rounded-3xl border border-stone-200 bg-stone-50 p-4">
                  <div className="grid gap-4 md:grid-cols-[1.6fr,0.8fr,0.8fr,auto]">
                    <label className="block">
                      <span className="mb-2 block text-sm font-medium text-raf-ink">Category name</span>
                      <input
                        className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-raf-ink outline-none transition focus:border-raf-moss focus:ring-2 focus:ring-raf-sage"
                        value={category.label}
                        disabled={category.isSystem}
                        onChange={(event) => updateCategory(category.id, { label: event.target.value })}
                      />
                    </label>
                    <label className="block">
                      <span className="mb-2 block text-sm font-medium text-raf-ink">Percentage</span>
                      <input
                        className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-raf-ink outline-none transition focus:border-raf-moss focus:ring-2 focus:ring-raf-sage"
                        type="number"
                        step="0.01"
                        min="0"
                        value={toPercentInput(category.allocationPercent)}
                        onChange={(event) => updateCategory(category.id, { allocationPercent: toFractionString(event.target.value) })}
                      />
                    </label>
                    <label className="block">
                      <span className="mb-2 block text-sm font-medium text-raf-ink">Sort order</span>
                      <input
                        className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-raf-ink outline-none transition focus:border-raf-moss focus:ring-2 focus:ring-raf-sage"
                        type="number"
                        step="1"
                        value={category.sortOrder}
                        onChange={(event) => updateCategory(category.id, { sortOrder: Number(event.target.value || "0") })}
                      />
                    </label>
                    <div className="grid gap-3">
                      <label className="flex items-center gap-2 text-sm text-raf-ink">
                        <input
                          type="checkbox"
                          checked={category.isActive}
                          onChange={(event) => updateCategory(category.id, { isActive: event.target.checked })}
                        />
                        Active
                      </label>
                      <label className="flex items-center gap-2 text-sm text-raf-ink">
                        <input
                          type="radio"
                          name="buffer-category"
                          checked={category.bufferSelected}
                          disabled
                          onChange={() => handleBufferSelection(category.id)}
                        />
                        Buffer
                      </label>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                    <Badge tone={category.isActive ? "success" : "neutral"}>{category.isActive ? "active" : "inactive"}</Badge>
                    {category.isSystem ? <Badge tone="warning">system</Badge> : null}
                    <span className="text-stone-500">Slug: {category.slug}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </Card>

        <div className="space-y-6">
          <Card title="Validation" subtitle="The backend remains the source of truth, but the editor blocks obviously invalid totals.">
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
              {!activeBuffer ? (
                <ErrorState
                  title="Buffer category missing"
                  message="A single buffer category selection is required for deterministic remainder handling."
                />
              ) : null}
            </div>
          </Card>

          <Card title="Backend Gaps" subtitle="Current runtime limitations for allocation preference editing.">
            <ul className="space-y-3 text-sm text-stone-600">
              <li>The runnable backend does not currently expose `GET /allocation-categories` or `PUT /allocation-categories`.</li>
              <li>The authoritative spec expects `GET` and `PUT` at `/household/allocation-categories`.</li>
              <li>Remainder routing is hardwired to the `buffer` slug in backend logic, so buffer selection is displayed but not editable here.</li>
            </ul>
          </Card>

          {saveError ? <ErrorState title="Failed to save allocation preferences" message={saveError} /> : null}
          {saveSuccess ? <SuccessNotice title="Preferences saved" message={saveSuccess} /> : null}
        </div>
      </section>
    </PageShell>
  );
}
