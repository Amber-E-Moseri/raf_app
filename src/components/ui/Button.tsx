import type { ButtonHTMLAttributes, PropsWithChildren } from "react";

function buttonClasses(variant: "primary" | "secondary" | "ghost", disabled?: boolean) {
  const base = "inline-flex min-h-11 items-center justify-center rounded-full px-4 py-2.5 text-sm font-semibold tracking-[0.01em] transition duration-150";

  if (disabled) {
    return `${base} cursor-not-allowed bg-stone-300 text-stone-500 shadow-none`;
  }

  if (variant === "secondary") {
    return `${base} bg-white text-raf-ink ring-1 ring-stone-200 shadow-sm hover:-translate-y-0.5 hover:bg-stone-50 hover:shadow-lift`;
  }

  if (variant === "ghost") {
    return `${base} bg-transparent text-raf-moss hover:bg-raf-sage/40`;
  }

  return `${base} bg-raf-moss text-white shadow-panel hover:-translate-y-0.5 hover:bg-raf-ink hover:shadow-lift`;
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
