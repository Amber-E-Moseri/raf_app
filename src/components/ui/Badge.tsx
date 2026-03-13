import type { ReactNode } from "react";

interface BadgeProps {
  tone?: "neutral" | "success" | "warning" | "danger";
  children: ReactNode;
}

export function Badge({ tone = "neutral", children }: BadgeProps) {
  const classes = {
    neutral: "bg-[var(--badge-neutral-bg)] text-[var(--badge-neutral-text)] ring-1 ring-[var(--badge-neutral-ring)]",
    success: "bg-[var(--badge-success-bg)] text-[var(--badge-success-text)] ring-1 ring-[var(--badge-success-ring)]",
    warning: "bg-amber-100 text-amber-800 ring-1 ring-amber-200",
    danger: "bg-rose-100 text-rose-700 ring-1 ring-rose-200",
  }[tone];

  return <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold tracking-[0.01em] ${classes}`}>{children}</span>;
}
