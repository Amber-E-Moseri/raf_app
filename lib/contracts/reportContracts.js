import { z } from 'zod';

const moneyString = z.string().regex(/^-?(?:0|[1-9]\d*)\.\d{2}$/);

export const dashboardPeriodSchema = z.object({
  month: z.string(),
  incomeTotal: moneyString,
  spendingTotal: moneyString,
  surplusOrDeficit: moneyString,
  savingsActual: moneyString,
  alertStatus: z.enum(['ok', 'elevated', 'risky']),
});

export const monthlyBucketProgressSchema = z.object({
  bucket_id: z.string(),
  bucket_name: z.string(),
  slug: z.string().optional(),
  allocated_this_month: moneyString,
  added_this_month: moneyString,
  used_this_month: moneyString,
  reserved_for_goals_this_month: moneyString,
  available_this_month: moneyString,
  remaining_this_month: moneyString,
  percent_used_this_month: z.number(),
  percent_reserved_for_goals_this_month: z.number(),
});

export const dashboardReportSchema = z.object({
  periods: z.array(dashboardPeriodSchema),
  upcoming_fixed_bills_this_month: z.array(z.object({
    id: z.string(),
    name: z.string(),
    category_slug: z.string(),
    expected_amount: moneyString,
    due_day_of_month: z.number().int(),
  })),
  total_expected_fixed_bills_this_month: moneyString,
  bucket_balances: z.array(z.object({
    bucket_id: z.string(),
    bucket_name: z.string(),
    slug: z.string(),
    balance: moneyString,
    percent_of_total: z.number(),
  })),
  monthly_bucket_progress: z.array(monthlyBucketProgressSchema),
  ytd_bucket_progress: z.array(monthlyBucketProgressSchema),
  ttd_bucket_progress: z.array(monthlyBucketProgressSchema),
  goal_progress: z.array(z.object({
    goal_id: z.string(),
    goal_name: z.string(),
    bucket_id: z.string(),
    bucket: z.string().nullable().optional(),
    bucket_name: z.string().nullable().optional(),
    bucket_balance: moneyString.optional(),
    target_amount: moneyString,
    reserved_amount: moneyString,
    current_amount: moneyString,
    remaining_amount: moneyString,
    progress_percent: z.number(),
  })),
});

export const financialHealthReportSchema = z.object({
  reviewMonth: z.string().optional(),
  activeMonthIncome: moneyString,
  monthlyDebtPayments: moneyString,
  debtRatio: z.string(),
  savingsBalance: moneyString,
  savingsFloor: moneyString,
  savingsFloorEnabled: z.boolean(),
  availableSavings: moneyString,
  emergencyFundBalance: moneyString,
  monthlyEssentials: moneyString,
  emergencyCoverageMonths: z.number().nullable(),
  healthScore: z.number(),
  healthPillars: z.array(z.object({
    key: z.enum(['budget_discipline', 'surplus_generation', 'debt_ratio', 'debt_reduction', 'savings_coverage', 'spending_stability']),
    label: z.string(),
    score: z.number(),
    value: z.string(),
  })),
  alertStatus: z.enum(['ok', 'elevated', 'risky']),
});

export const surplusRecommendationsSchema = z.object({
  reviewMonth: z.string().optional(),
  netSurplus: moneyString,
  distributions: z.array(z.object({
    slug: z.string(),
    label: z.string(),
    amount: moneyString,
    splitPercent: z.string().optional(),
    destinationType: z.enum(['bucket', 'goal', 'debt']).optional(),
    destinationBucketSlug: z.string().nullable().optional(),
    destinationGoalId: z.string().nullable().optional(),
    destinationDebtId: z.string().nullable().optional(),
    isMissing: z.boolean().optional(),
  })),
  alertStatus: z.enum(['ok', 'elevated', 'risky']),
}).passthrough();

export const dashboardAggregateReportSchema = z.object({
  dashboard: dashboardReportSchema,
  financialHealth: financialHealthReportSchema,
  surplusRecommendations: surplusRecommendationsSchema,
});
