const positiveMoneyPattern = /^(?:0|[1-9]\d*)(?:\.\d{0,2})?$/;
const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

export function isPositiveMoneyInput(value: string) {
  return positiveMoneyPattern.test(value);
}

export function normalizeMoneyInput(value: string) {
  const trimmed = value.trim();
  if (!trimmed || !isPositiveMoneyInput(trimmed)) {
    return null;
  }

  const [whole, fraction = ""] = trimmed.split(".");
  const normalizedWhole = String(Number(whole));
  return `${normalizedWhole}.${(fraction + "00").slice(0, 2)}`;
}

export function validatePositiveMoney(value: string, label: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return `${label} is required`;
  }

  if (!isPositiveMoneyInput(trimmed)) {
    return `${label} must be a positive decimal with up to 2 places`;
  }

  const normalized = normalizeMoneyInput(trimmed);
  if (normalized == null || normalized === "0.00") {
    return `${label} must be greater than 0`;
  }

  return null;
}

export function validateNonNegativeMoney(value: string, label: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return `${label} is required`;
  }

  if (!isPositiveMoneyInput(trimmed)) {
    return `${label} must be a non-negative decimal with up to 2 places`;
  }

  return null;
}

export function validateIsoDate(value: string, label: string) {
  if (!value.trim()) {
    return `${label} is required`;
  }

  if (!isoDatePattern.test(value)) {
    return `${label} must be a valid ISO date`;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    return `${label} must be a valid ISO date`;
  }

  return null;
}

export function validateFirstDayOfMonth(value: string, label: string) {
  const dateError = validateIsoDate(value, label);
  if (dateError) {
    return dateError;
  }

  if (!value.endsWith("-01")) {
    return `${label} must be the first day of the month`;
  }

  return null;
}

export function validateRequiredText(value: string, label: string) {
  if (!value.trim()) {
    return `${label} is required`;
  }

  return null;
}

export function validateApr(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "APR is required";
  }

  if (!/^(?:0|[1-9]\d*)(?:\.\d{0,2})?$/.test(trimmed)) {
    return "APR must be a non-negative decimal with up to 2 places";
  }

  const numeric = Number(trimmed);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100) {
    return "APR must be between 0 and 100";
  }

  return null;
}
