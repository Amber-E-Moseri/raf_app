/** Fraction scale for allocation/surplus-split percentages (stored as 0.1000). */
export const FRACTION_SCALE = 10000;

/** Allocation percentages must sum to this value (within ALLOCATION_TOLERANCE). */
export const ALLOCATION_SUM = 1;

/** Tolerance for allocation sum validation. */
export const ALLOCATION_TOLERANCE = 0.0001;

/** Debt ratio thresholds used in alert status and plan health checks. */
export const DEBT_RATIO_RISKY = 0.35;
export const DEBT_RATIO_ELEVATED = 0.25;
