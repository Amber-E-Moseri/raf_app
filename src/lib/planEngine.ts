export type Frequency = "monthly" | "weekly" | "biweekly" | "annual";

export type IncomeRow = { id: string; label: string; amount: number; frequency: Frequency };
export type ExpenseRow = { id: string; label: string; amount: number; category: string; frequency: Frequency };
export type DebtRow = { id: string; label: string; balance: number; apr: number; minPayment: number; priority: number };
export type GoalRow = { id: string; label: string; target: number; deadline: string; monthlyContribution: number };

export type PlanState = {
  income: IncomeRow[];
  fixedExpenses: ExpenseRow[];
  variableExpenses: ExpenseRow[];
  debts: DebtRow[];
  goals: GoalRow[];
  givingPercent: number;
  bufferPercent: number;
  strictMode: boolean;
};

export function normalizeToMonthly(amount: number, frequency: Frequency) {
  switch (frequency) {
    case "weekly":
      return amount * 52 / 12;
    case "biweekly":
      return amount * 26 / 12;
    case "annual":
      return amount / 12;
    case "monthly":
    default:
      return amount;
  }
}

export function getInitialPlanState(): PlanState {
  return {
    income: [],
    fixedExpenses: [],
    variableExpenses: [],
    debts: [],
    goals: [],
    givingPercent: 10,
    bufferPercent: 10,
    strictMode: false,
  };
}

export function calculatePlanAllocation(plan: PlanState) {
  const totalIncome = plan.income.reduce((sum: number, item: IncomeRow) => sum + normalizeToMonthly(item.amount, item.frequency), 0);
  const totalFixed = plan.fixedExpenses.reduce((sum: number, item: ExpenseRow) => sum + normalizeToMonthly(item.amount, item.frequency), 0);
  const totalVariable = plan.variableExpenses.reduce((sum: number, item: ExpenseRow) => sum + normalizeToMonthly(item.amount, item.frequency), 0);

  const givingTarget = totalIncome * (plan.givingPercent / 100);
  const bufferTarget = totalIncome * (plan.bufferPercent / 100);

  const baseAfterEssentials = totalIncome - totalFixed - totalVariable;
  const beforeDebt = baseAfterEssentials - givingTarget - bufferTarget;

  const debtsDue = plan.debts.reduce((acc: number, debt: DebtRow) => acc + debt.minPayment, 0);
  const additionalDebt = Math.max(0, beforeDebt - debtsDue);
  const surplus = beforeDebt - debtsDue;

  const deficit = surplus < 0;

  const goalFunding = plan.goals.reduce((acc: number, goal: GoalRow) => acc + goal.monthlyContribution, 0);

  return {
    totalIncome,
    totalFixed,
    totalVariable,
    givingTarget,
    bufferTarget,
    debtsDue,
    additionalDebt: deficit ? 0 : additionalDebt,
    goalFunding,
    surplus: Math.max(0, surplus - goalFunding),
    deficitAmount: deficit ? Math.abs(surplus) : 0,
    status: deficit ? "deficit" : "surplus",
  };
}
