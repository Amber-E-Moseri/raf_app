import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { PropsWithChildren } from "react";

import {
  PERIOD_STORAGE_KEY,
  formatMonthLabel,
  getCurrentMonthKey,
  monthRangeFromKey,
  normalizeMonthKey,
  shiftMonthKey,
} from "../../lib/period";

interface PeriodContextValue {
  activeMonth: string;
  activeMonthLabel: string;
  activeRange: { from: string; to: string };
  setActiveMonth: (month: string) => void;
  goToPreviousMonth: () => void;
  goToNextMonth: () => void;
  jumpToCurrentMonth: () => void;
}

const PeriodContext = createContext<PeriodContextValue | null>(null);

function readInitialMonth() {
  if (typeof window === "undefined") {
    return getCurrentMonthKey();
  }

  return normalizeMonthKey(window.localStorage.getItem(PERIOD_STORAGE_KEY));
}

export function PeriodProvider({ children }: PropsWithChildren) {
  const [activeMonth, setActiveMonthState] = useState<string>(readInitialMonth);

  useEffect(() => {
    window.localStorage.setItem(PERIOD_STORAGE_KEY, activeMonth);
  }, [activeMonth]);

  const value = useMemo<PeriodContextValue>(() => ({
    activeMonth,
    activeMonthLabel: formatMonthLabel(activeMonth),
    activeRange: monthRangeFromKey(activeMonth),
    setActiveMonth: (month) => setActiveMonthState(normalizeMonthKey(month, activeMonth)),
    goToPreviousMonth: () => setActiveMonthState((current) => shiftMonthKey(current, -1)),
    goToNextMonth: () => setActiveMonthState((current) => shiftMonthKey(current, 1)),
    jumpToCurrentMonth: () => setActiveMonthState(getCurrentMonthKey()),
  }), [activeMonth]);

  return (
    <PeriodContext.Provider value={value}>
      {children}
    </PeriodContext.Provider>
  );
}

export function usePeriod() {
  const context = useContext(PeriodContext);
  if (!context) {
    throw new Error("usePeriod must be used within a PeriodProvider");
  }

  return context;
}
