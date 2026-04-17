import { createContext, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { calculatePlanAllocation, getInitialPlanState } from "../lib/planEngine";

type Frequency = "monthly" | "weekly" | "biweekly" | "annual";

type IncomeRow = { id: string; label: string; amount: number; frequency: Frequency };
type ExpenseRow = { id: string; label: string; amount: number; category: string; frequency: Frequency };
type DebtRow = { id: string; label: string; balance: number; apr: number; minPayment: number; priority: number };
type GoalRow = { id: string; label: string; target: number; deadline: string; monthlyContribution: number };

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

type PlanContextType = {
  plan: PlanState;
  allocation: ReturnType<typeof calculatePlanAllocation>;
  updatePlan: (updater: (draft: PlanState) => void) => void;
};

const PlanContext = createContext<PlanContextType | null>(null);

export function PlanProvider({ children }: { children: ReactNode }) {
  const [plan, setPlan] = useState<PlanState>(() => getInitialPlanState());

  const allocation = useMemo(() => calculatePlanAllocation(plan), [plan]);

  const updatePlan = (updater: (draft: PlanState) => void) => {
    setPlan((current) => {
      const draft = JSON.parse(JSON.stringify(current)) as PlanState;
      updater(draft);
      return draft;
    });
  };

  return (
    <PlanContext.Provider value={{ plan, allocation, updatePlan }}>
      {children}
    </PlanContext.Provider>
  );
}

export function usePlan() {
  const context = useContext(PlanContext);
  if (!context) {
    throw new Error("usePlan must be used within PlanProvider");
  }
  return context;
}
