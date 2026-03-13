import type { ReactNode } from "react";

interface BadgeProps {
  tone?: "neutral" | "success" | "warning" | "danger";
  children: ReactNode;
}

export function Badge({ tone = "neutral", children }: BadgeProps) {
  const classes = {
    neutral: "bg-stone-100/90 text-stone-700 ring-1 ring-stone-200",
    success: "bg-raf-sage/85 text-raf-ink ring-1 ring-raf-sage",
    warning: "bg-amber-100 text-amber-800 ring-1 ring-amber-200",
    danger: "bg-rose-100 text-rose-700 ring-1 ring-rose-200",
  }[tone];

  return <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold tracking-[0.01em] ${classes}`}>{children}</span>;
}
