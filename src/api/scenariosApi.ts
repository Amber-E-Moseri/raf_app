import { postJson } from "./client";

export type ScenarioType =
  | "extra_debt_payment"
  | "expense_increase"
  | "income_drop"
  | "goal_savings"
  | "one_time_purchase"
  | "surplus_redirect"
  | "emergency_floor_change";

export interface Scenario {
  type: ScenarioType;
  // extra_debt_payment
  debtId?: string;
  extraAmountCents?: number;
  // expense_increase
  name?: string;
  amountCents?: number;
  percentIncrease?: number;
  // income_drop
  percentDrop?: number;
  // goal_savings
  goalId?: string;
  monthlyContributionCents?: number;
  // surplus_redirect
  targetSlug?: string;
  // emergency_floor_change
  newBufferPct?: number;
}

export interface DebtPayoffRow {
  id: string;
  name: string;
  months: number;
  currentBalance: string;
  minimumPayment: string;
}

export interface GoalCompletionRow {
  id: string;
  name: string;
  months: number | null;
  targetAmount: string;
  reservedAmount: string;
  remainingAmount: string;
  monthlyContribution: string;
}

export interface CashFlowMonth {
  month: number;
  income: string;
  allocated: string;
  surplus: string;
  debtPaid: string;
  goalSaved: string;
  totalDebtBalance: string;
  totalGoalProgress: string;
  netCashFlow: string;
}

export interface ScenarioMetrics {
  monthlyIncome: string;
  totalAllocated: string;
  surplus: string;
  bufferAmount: string;
  monthlyFlexibility: string;
  fixedBillsTotal: string;
  debtMinimums: string;
  debtPayoff: DebtPayoffRow[];
  maxDebtPayoffMonths: number;
  goalCompletion: GoalCompletionRow[];
  cashFlow12m: CashFlowMonth[];
}

export interface DeltaField {
  cents: number;
  formatted: string;
}

export interface ScenarioDelta {
  monthlyIncome: DeltaField;
  surplus: DeltaField;
  bufferAmount: DeltaField;
  monthlyFlexibility: DeltaField;
  maxDebtPayoffMonths: number;
}

export interface ScenarioPreviewResponse {
  current: ScenarioMetrics;
  scenario: ScenarioMetrics;
  delta: ScenarioDelta;
  snapshot: {
    monthlyIncome: string;
    incomeEntryCount: number;
    debtCount: number;
    goalCount: number;
    fixedBillCount: number;
  };
}

export interface ChangeSetEntry {
  resource: string;
  id: string | null;
  label: string;
  field: string | null;
  from: string | null;
  to: string | null;
  description: string;
}

export interface ScenarioApplyResponse {
  changeSet?: ChangeSetEntry[];
  requiresConfirmation?: boolean;
  applied?: ChangeSetEntry[];
  errors?: Array<{ change: ChangeSetEntry; error: string }>;
  changeCount?: number;
  metrics?: ScenarioMetrics;
}

export function previewScenario(scenario: Scenario): Promise<ScenarioPreviewResponse> {
  return postJson<ScenarioPreviewResponse>("/scenarios", { scenario });
}

export function getScenarioChangeSet(scenario: Scenario): Promise<ScenarioApplyResponse> {
  return postJson<ScenarioApplyResponse>("/scenarios/apply", { scenario, confirmed: false });
}

export function applyScenario(scenario: Scenario): Promise<ScenarioApplyResponse> {
  return postJson<ScenarioApplyResponse>("/scenarios/apply", { scenario, confirmed: true });
}
