import { getAllocationCategories } from "../api/allocationCategoriesApi";
import { ApiError } from "../api/client";
import { getGoals } from "../api/goalsApi";
import { getMonthlyReviews } from "../api/monthlyReviewApi";
import { ErrorState } from "../components/feedback/ErrorState";
import { LoadingState } from "../components/feedback/LoadingState";
import { PageShell } from "../components/layout/PageShell";
import { Badge } from "../components/ui/Badge";
import { Card } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { useAsyncData } from "../hooks/useAsyncData";

interface ProfileViewModel {
  allocationCount: number;
  activeAllocationCount: number;
  goalCount: number;
  monthlyReviewCount: number;
}

export function Profile() {
  const { data, error, isLoading, reload } = useAsyncData<ProfileViewModel>(async () => {
    const currentYear = new Date().getFullYear();
    const [categories, goalsResponse, monthlyReviewsResponse] = await Promise.all([
      getAllocationCategories().catch((requestError) => {
        if (requestError instanceof ApiError && requestError.status === 404) {
          return [];
        }

        throw requestError;
      }),
      getGoals(),
      getMonthlyReviews({
        from: `${currentYear}-01-01`,
        to: `${currentYear}-12-01`,
      }),
    ]);

    return {
      allocationCount: categories.length,
      activeAllocationCount: categories.filter((item) => item.isActive !== false).length,
      goalCount: goalsResponse.items.length,
      monthlyReviewCount: monthlyReviewsResponse.items.length,
    };
  }, []);

  return (
    <PageShell
      eyebrow="Profile"
      title="Profile"
      description="Account and planning summary placeholders for future profile features."
    >
      {isLoading ? <LoadingState label="Loading profile overview..." /> : null}
      {!isLoading && error ? (
        <ErrorState
          title="Failed to load profile"
          message={error}
          onRetry={() => void reload()}
        />
      ) : null}
      {!isLoading && !error && data ? (
        <section className="grid gap-4">
          <Card title="User Information" subtitle="Current placeholder content until account profile APIs are connected.">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-raf-ink">Jane Doe</h2>
                <p className="mt-1 text-sm text-stone-500">Local RAF profile placeholder</p>
              </div>
              <Badge tone="neutral">Profile placeholder</Badge>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-stone-500">Household</p>
                <p className="mt-2 text-sm font-medium text-raf-ink">Local RAF Household</p>
                <p className="mt-1 text-sm text-stone-500">Household/account details can be surfaced here when backend profile data exists.</p>
              </div>
              <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-stone-500">Account</p>
                <p className="mt-2 text-sm font-medium text-raf-ink">Google-auth account placeholder</p>
                <p className="mt-1 text-sm text-stone-500">Connected user details are not available in the current frontend contract.</p>
              </div>
            </div>
          </Card>

          <section className="grid gap-4 md:grid-cols-3">
            <Card title="Monthly Review" subtitle="Planning summary placeholder.">
              <p className="text-2xl font-bold tracking-tight text-raf-ink">{data.monthlyReviewCount}</p>
              <p className="mt-2 text-sm text-stone-500">Saved monthly reviews this year</p>
            </Card>
            <Card title="Allocations" subtitle="Current allocation setup summary.">
              <p className="text-2xl font-bold tracking-tight text-raf-ink">{data.activeAllocationCount}</p>
              <p className="mt-2 text-sm text-stone-500">{data.allocationCount} total buckets configured</p>
            </Card>
            <Card title="Goals" subtitle="Goal planning placeholder.">
              <p className="text-2xl font-bold tracking-tight text-raf-ink">{data.goalCount}</p>
              <p className="mt-2 text-sm text-stone-500">Active and planned goals currently tracked</p>
            </Card>
          </section>
        </section>
      ) : null}
      {!isLoading && !error && !data ? (
        <EmptyState
          title="No profile data yet"
          message="Profile details and planning summaries will appear here as more account data becomes available."
        />
      ) : null}
    </PageShell>
  );
}
