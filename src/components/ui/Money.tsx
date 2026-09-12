import { useAppearance } from "../layout/AppearanceProvider";
import { formatCurrency, PRIVACY_MASK } from "../../lib/format";

interface MoneyProps {
  value: string | number | null | undefined;
  signed?: boolean;
  className?: string;
}

export function Money({ value, signed = false, className }: MoneyProps) {
  const { preferences } = useAppearance();
  const isPrivate = preferences.privacy_mode;

  let display: string;
  let ariaLabel: string;

  if (isPrivate) {
    display = PRIVACY_MASK;
    ariaLabel = "Amount hidden";
  } else {
    const formatted = formatCurrency(value);
    const numeric = typeof value === "number" ? value : Number(value ?? 0);
    display = signed && Number.isFinite(numeric) && numeric > 0 ? `+${formatted}` : formatted;
    ariaLabel = display;
  }

  return (
    <span
      className={[
        "motion-safe:transition-opacity motion-safe:duration-150",
        isPrivate ? "select-none tracking-widest" : "",
        className ?? "",
      ].filter(Boolean).join(" ")}
      aria-label={ariaLabel}
      aria-atomic="true"
    >
      {display}
    </span>
  );
}
