import type { ButtonHTMLAttributes, PropsWithChildren } from "react";

function buttonClasses(variant: "primary" | "secondary" | "ghost", disabled?: boolean) {
  const base = "inline-flex min-h-11 items-center justify-center rounded-full px-4 py-2.5 text-sm font-semibold tracking-[0.01em] transition duration-200";

  if (disabled) {
    return `${base} cursor-not-allowed bg-[var(--surface-elevated)] text-[var(--text-muted)] ring-1 ring-[var(--border-color)] shadow-none`;
  }

  if (variant === "secondary") {
    return `${base} bg-[var(--surface-color)] text-[var(--text-strong)] ring-1 ring-[var(--border-color)] shadow-sm hover:-translate-y-0.5 hover:bg-[var(--surface-elevated)] hover:shadow-lift`;
  }

  if (variant === "ghost") {
    return `${base} bg-transparent text-[var(--primary-color)] hover:bg-[var(--primary-soft)]`;
  }

  return `${base} bg-[var(--primary-color)] text-[var(--primary-contrast)] shadow-panel hover:-translate-y-0.5 hover:bg-[var(--primary-color-strong)] hover:shadow-lift`;
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost";
}

export function Button({
  children,
  className = "",
  disabled,
  variant = "primary",
  ...props
}: PropsWithChildren<ButtonProps>) {
  return (
    <button
      className={`${buttonClasses(variant, disabled)} ${className}`.trim()}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  );
}
