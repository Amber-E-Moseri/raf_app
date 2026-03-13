const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

export function formatCurrency(value: string | number | null | undefined): string {
  if (value == null || value === "") {
    return "$0.00";
  }

  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return "$0.00";
  }

  return currencyFormatter.format(numeric);
}

export function formatIsoDate(value: string | null | undefined): string {
  if (!value) {
    return "N/A";
  }

  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return dateFormatter.format(date);
}

export function formatPercent(value: string | number | null | undefined): string {
  return formatPercentWithDigits(value, 2);
}

export function formatPercentWithDigits(
  value: string | number | null | undefined,
  digits = 2,
): string {
  if (value == null || value === "") {
    return "N/A";
  }

  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return "N/A";
  }

  return `${(numeric * 100).toFixed(digits)}%`;
}

export function percentPaidOff(startingBalance: string, currentBalance: string): number | null {
  const starting = Number(startingBalance);
  const current = Number(currentBalance);

  if (!Number.isFinite(starting) || !Number.isFinite(current) || starting <= 0) {
    return null;
  }

  const paid = ((starting - current) / starting) * 100;
  return Math.min(100, Math.max(0, paid));
}

export function monthRange(date = new Date()): { from: string; to: string } {
  const year = date.getFullYear();
  const month = date.getMonth();
  const first = new Date(Date.UTC(year, month, 1));
  const last = new Date(Date.UTC(year, month + 1, 0));

  return {
    from: first.toISOString().slice(0, 10),
    to: last.toISOString().slice(0, 10),
  };
}
