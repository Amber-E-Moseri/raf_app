const monthLabelFormatter = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
});

export const PERIOD_STORAGE_KEY = "raf_active_month";

export function getCurrentMonthKey(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function isMonthKey(value: string | null | undefined): value is string {
  return Boolean(value && /^\d{4}-\d{2}$/.test(value));
}

export function normalizeMonthKey(value: string | null | undefined, fallback = getCurrentMonthKey()) {
  return isMonthKey(value) ? value : fallback;
}

export function monthKeyToDate(monthKey: string) {
  return new Date(`${monthKey}-15T12:00:00`);
}

export function formatMonthLabel(monthKey: string) {
  return monthLabelFormatter.format(monthKeyToDate(monthKey));
}

export function shiftMonthKey(monthKey: string, offset: number) {
  const next = monthKeyToDate(monthKey);
  next.setUTCMonth(next.getUTCMonth() + offset);
  return next.toISOString().slice(0, 7);
}

export function compareMonthKeys(left: string, right: string) {
  return left.localeCompare(right);
}

export function monthRangeFromKey(monthKey: string) {
  const start = monthKeyToDate(monthKey);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  end.setUTCDate(0);

  return {
    from: start.toISOString().slice(0, 10),
    to: end.toISOString().slice(0, 10),
  };
}

export function buildMonthOptions(activeMonth: string, monthsBack = 18, monthsForward = 12) {
  const currentMonth = getCurrentMonthKey();
  const earliestAnchor = compareMonthKeys(activeMonth, currentMonth) <= 0 ? activeMonth : currentMonth;
  const latestAnchor = compareMonthKeys(activeMonth, currentMonth) >= 0 ? activeMonth : currentMonth;
  const startMonth = shiftMonthKey(earliestAnchor, -monthsBack);
  const endMonth = shiftMonthKey(latestAnchor, monthsForward);
  const options = [];

  let cursor = startMonth;
  while (compareMonthKeys(cursor, endMonth) <= 0) {
    options.push({
      value: cursor,
      label: formatMonthLabel(cursor),
    });
    cursor = shiftMonthKey(cursor, 1);
  }

  return options;
}

export function getMonthKeyFromDate(dateValue: string | null | undefined) {
  if (!dateValue || !/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
    return null;
  }

  return dateValue.slice(0, 7);
}

export function defaultReviewDateForMonth(monthKey: string, now = new Date()) {
  const currentMonthKey = getCurrentMonthKey(now);
  if (monthKey === currentMonthKey) {
    const today = now.toISOString().slice(0, 10);
    return today.startsWith(monthKey) ? today : `${monthKey}-01`;
  }

  return `${monthKey}-01`;
}
