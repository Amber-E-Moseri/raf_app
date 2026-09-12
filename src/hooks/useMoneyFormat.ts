import { useCallback } from "react";
import { useAppearance } from "../components/layout/AppearanceProvider";
import { formatCurrency, PRIVACY_MASK } from "../lib/format";

export function useMoneyFormat(): (value: string | number | null | undefined) => string {
  const { preferences } = useAppearance();
  const isPrivate = preferences.privacy_mode;

  return useCallback(
    (value: string | number | null | undefined) => {
      return isPrivate ? PRIVACY_MASK : formatCurrency(value);
    },
    [isPrivate],
  );
}
