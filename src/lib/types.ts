export interface ApiErrorPayload {
  error: string | { code: string; message: string };
}

export interface HealthResponse {
  status: "ok";
  service: string;
}

export interface AllocationCategory {
  id: string;
  slug: string;
  label: string;
  sortOrder: number;
  allocationPercent: string;
  isSystem?: boolean;
  isActive: boolean;
}

export interface AllocationCategoryWriteItem {
  slug: string;
  label: string;
  sortOrder: number;
  allocationPercent: string;
  isActive: boolean;
}

export interface AllocationCategoriesResponse {
  items: AllocationCategory[];
}

export interface AllocationCategoriesWriteResponse {
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

export interface DashboardPeriod {
  month: string;
  incomeTotal: string;
  spendingTotal: string;
  surplusOrDeficit: string;
  savingsActual: string;
  alertStatus: "ok" | "elevated" | "risky";
}

export interface DashboardReport {
  periods: DashboardPeriod[];
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

export interface IncomeAllocationReport {
  sourceName: string;
  amount: string;
  receivedDate: string;
  allocations: DistributionLine[];
}
