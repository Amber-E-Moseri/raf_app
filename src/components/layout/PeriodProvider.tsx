import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { PropsWithChildren } from "react";

import {
  PERIOD_STORAGE_KEY,
  formatMonthLabel,
  getCurrentMonthKey,
  isFutureMonthKey,
  monthKeyToPeriod,
  monthRangeFromKey,
  normalizeMonthKey,
  normalizeStoredPeriod,
  periodToMonthKey,
  shiftMonthKey,
} from "../../lib/period";
import type { Period } from "../../lib/period";

interface PeriodContextValue {
  period: Period;
  setPeriod: (period: Period) => void;
  periodLabel: string;
  isCurrentMonth: boolean;
  prevMonth: () => void;
  nextMonth: () => void;
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

  return normalizeStoredPeriod(window.localStorage.getItem(PERIOD_STORAGE_KEY));
}

export function PeriodProvider({ children }: PropsWithChildren) {
  const [activeMonth, setActiveMonthState] = useState<string>(readInitialMonth);

  useEffect(() => {
    window.localStorage.setItem(PERIOD_STORAGE_KEY, activeMonth);
  }, [activeMonth]);

  const value = useMemo<PeriodContextValue>(() => {
    const currentMonthKey = getCurrentMonthKey();

    function clampMonthKey(nextMonthKey: string) {
      return isFutureMonthKey(nextMonthKey) ? currentMonthKey : nextMonthKey;
    }

    return {
      period: monthKeyToPeriod(activeMonth),
      setPeriod: (period) => setActiveMonthState(clampMonthKey(periodToMonthKey(period))),
      periodLabel: formatMonthLabel(activeMonth),
      isCurrentMonth: activeMonth === currentMonthKey,
      prevMonth: () => setActiveMonthState((current) => shiftMonthKey(current, -1)),
      nextMonth: () => setActiveMonthState((current) => clampMonthKey(shiftMonthKey(current, 1))),
      activeMonth,
      activeMonthLabel: formatMonthLabel(activeMonth),
      activeRange: monthRangeFromKey(activeMonth),
      setActiveMonth: (month) => setActiveMonthState(clampMonthKey(normalizeMonthKey(month, activeMonth))),
      goToPreviousMonth: () => setActiveMonthState((current) => shiftMonthKey(current, -1)),
      goToNextMonth: () => setActiveMonthState((current) => clampMonthKey(shiftMonthKey(current, 1))),
      jumpToCurrentMonth: () => setActiveMonthState(currentMonthKey),
    };
  }, [activeMonth]);

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
