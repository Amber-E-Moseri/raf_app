export interface ApiErrorPayload {
  error: string | { code: string; message: string };
}

export interface HealthResponse {
  status: "ok";
  service: string;
}

export interface AllocationCategory {
  id: string;
  snapshotId?: string | null;
  effectiveFrom?: string | null;
  supersededAt?: string | null;
  slug: string;
  label: string;
  sortOrder: number;
  allocationPercent: string;
  isSystem?: boolean;
  isActive: boolean;
  isBuffer?: boolean;
}

export interface AllocationCategoryWriteItem {
  slug: string;
  label: string;
  sortOrder: number;
  allocationPercent: string;
  isActive: boolean;
  isBuffer?: boolean;
}

export interface AllocationCategoriesResponse {
  items: AllocationCategory[];
  history?: AllocationCategorySnapshot[];
}

export interface AllocationCategoriesWriteResponse {
  items: AllocationCategory[];
  history?: AllocationCategorySnapshot[];
}

export interface AllocationCategorySnapshot {
  snapshotId: string;
  effectiveFrom: string | null;
  supersededAt: string | null;
  items: AllocationCategory[];
}

export interface IncomeAllocationLine {
  category: string;
  slug: string;
  amount: string;
}

export interface IncomeCreateRequest {
  sourceName: string;
  amount: string;
  receivedDate: string;
  notes?: string;
}

export interface IncomeCreateResponse {
  incomeId: string;
  allocations: IncomeAllocationLine[];
}

export interface IncomeListItem {
  incomeId: string;
  sourceName: string;
  amount: string;
  receivedDate: string;
  notes: string | null;
}

export interface IncomeListResponse {
  items: IncomeListItem[];
  total: string;
}

export interface Transaction {
  id: string;
  transactionDate: string;
  description: string;
  merchant: string | null;
  amount: string;
  direction: "debit" | "credit";
  categoryId: string | null;
  linkedDebtId: string | null;
}

export interface TransactionCreateRequest {
  transactionDate: string;
  description: string;
  merchant?: string | null;
  amount: string;
  direction: "debit" | "credit";
  categoryId?: string | null;
  linkedDebtId?: string | null;
}

export interface TransactionListResponse {
  items: Transaction[];
  nextCursor: string | null;
}

export interface ImportedTransaction {
  id: string;
  household_id: string;
  date: string;
  description: string;
  amount: string;
  currency: string;
  source: string;
  raw_description: string | null;
  reference_number: string | null;
  balance_after_transaction: string | null;
  status: "unreviewed" | "classified" | "ignored" | string;
  classification_type: string | null;
  linked_transaction_id: string | null;
  linked_debt_id: string | null;
  linked_fixed_bill_id: string | null;
  linked_goal_id?: string | null;
  normalized_description?: string | null;
  suggestion?: ImportReviewSuggestion | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
  updated_at: string;
}

export interface ImportReviewSuggestion {
  id: string;
  normalized_description: string;
  match_type?: "contains" | "exact";
  match_value?: string;
  classification_type: string;
  category_id: string | null;
  linked_debt_id: string | null;
  linked_fixed_bill_id: string | null;
  linked_goal_id: string | null;
  rule_type?: "suggestion" | "reusable_rule";
  auto_apply: boolean;
  created_at: string;
  updated_at: string;
  last_used_at?: string | null;
}

export interface ImportedTransactionListResponse {
  items: ImportedTransaction[];
}

export interface BankStatementImportResponse {
  extracted: number;
  currency: string;
  items: ImportedTransaction[];
}

export interface ImportClassificationPayload {
  classification_type: "transaction" | "debt_payment" | "fixed_bill_payment" | "goal_funding" | "duplicate" | "transfer" | "ignore";
  transaction_date?: string;
  description?: string;
  merchant?: string | null;
  category_id?: string | null;
  debt_id?: string | null;
  fixed_bill_id?: string | null;
  goal_id?: string | null;
  remember_choice?: boolean;
  save_rule_mode?: "suggestion" | "reusable_rule";
  auto_apply_rule?: boolean;
  review_note?: string | null;
}

export interface ImportReviewRule {
  id: string;
  household_id: string;
  match_type: "contains" | "exact";
  match_value: string;
  normalized_description: string | null;
  classification_type: ImportClassificationPayload["classification_type"];
  category_id: string | null;
  linked_debt_id: string | null;
  linked_fixed_bill_id: string | null;
  linked_goal_id: string | null;
  rule_type: "suggestion" | "reusable_rule";
  auto_apply: boolean;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
}

export interface ImportReviewRuleListResponse {
  items: ImportReviewRule[];
}

export interface ImportReviewRuleUpdatePayload {
  match_value?: string;
  match_type?: "contains" | "exact";
  classification_type?: ImportClassificationPayload["classification_type"];
  category_id?: string | null;
  debt_id?: string | null;
  fixed_bill_id?: string | null;
  goal_id?: string | null;
  rule_type?: "suggestion" | "reusable_rule";
  auto_apply?: boolean;
}

export interface Debt {
  id: string;
  name: string;
  startingBalance: string;
  currentBalance: string;
  apr: number;
  minimumPayment: string;
  monthlyPayment: string;
  status: string;
  sortOrder: number;
  isActive?: boolean;
}

export interface DebtCreateRequest {
  name: string;
  startingBalance: string;
  apr: number | string;
  minimumPayment: string;
  monthlyPayment: string;
  sortOrder?: number;
}

export interface DebtListResponse {
  items: Debt[];
  summary: {
    totalStarting: string;
    totalRemaining: string;
    totalPaidAllTime: string;
  };
}

export interface FixedBill {
  id: string;
  household_id: string;
  name: string;
  category_slug: string;
  expected_amount: string;
  due_day_of_month: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface FixedBillListResponse {
  items: FixedBill[];
}

export interface Goal {
  id: string;
  household_id: string;
  bucket_id: string;
  name: string;
  target_amount: string;
  target_date: string | null;
  notes: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface GoalListResponse {
  items: Goal[];
}

export interface DashboardPeriod {
  month: string;
  incomeTotal: string;
  spendingTotal: string;
  surplusOrDeficit: string;
  savingsActual: string;
  alertStatus: "ok" | "elevated" | "risky";
}

export interface BucketBalance {
  bucket_id: string;
  bucket_name: string;
  slug: string;
  balance: string;
  percent_of_total: number;
}

export interface GoalProgress {
  goal_id: string;
  goal_name: string;
  bucket_id: string;
  bucket?: string;
  bucket_name: string;
  reserved_amount: string;
  current_amount: string;
  target_amount: string;
  remaining_amount: string;
  progress_percent: number;
}

export interface MonthlyBucketProgress {
  bucket_id: string;
  bucket_name: string;
  allocated_this_month: string;
  used_this_month: string;
  remaining_this_month: string;
  percent_used_this_month: number;
}

export interface DashboardReport {
  periods: DashboardPeriod[];
  upcoming_fixed_bills_this_month: Array<{
    id: string;
    name: string;
    category_slug: string;
    expected_amount: string;
    due_day_of_month: number;
  }>;
  total_expected_fixed_bills_this_month: string;
  bucket_balances: BucketBalance[];
  monthly_bucket_progress: MonthlyBucketProgress[];
  goal_progress: GoalProgress[];
}

export interface FinancialHealthReport {
  activeMonthIncome: string;
  monthlyDebtPayments: string;
  debtRatio: string;
  savingsBalance: string;
  savingsFloor: string;
  availableSavings: string;
  emergencyFundBalance: string;
  monthlyEssentials: string;
  emergencyCoverageMonths: number | null;
  alertStatus: "ok" | "elevated" | "risky";
}

export interface DistributionLine {
  slug: string;
  label: string;
  amount: string;
}

export interface SurplusRecommendationsReport {
  netSurplus: string;
  distributions: DistributionLine[];
  targetDebtName?: string | null;
  alertStatus: "ok" | "elevated" | "risky";
}

export interface MonthlyReviewRequest {
  reviewMonth: string;
  notes?: string;
}

export interface MonthlyReviewResponse {
  id: string;
  reviewMonth: string;
  netSurplus: string;
  splitApplied: Record<string, string>;
  distributions: Record<string, string>;
  alertStatus: "ok" | "elevated" | "risky";
  notes: string | null;
}

export interface MonthlyReviewListResponse {
  items: MonthlyReviewResponse[];
}

export interface AppliedMonthlyReviewTransaction {
  id: string;
  transactionDate: string;
  description: string;
  merchant: string | null;
  amount: string;
  direction: "debit" | "credit";
  categoryId: string | null;
  linkedDebtId: string | null;
}

export interface ApplyMonthlyReviewResponse {
  review: MonthlyReviewResponse;
  appliedTransactions: AppliedMonthlyReviewTransaction[];
}

export interface IncomeAllocationReport {
  sourceName: string;
  amount: string;
  receivedDate: string;
  allocations: DistributionLine[];
}
