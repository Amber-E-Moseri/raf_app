import type { PropsWithChildren, ReactNode } from "react";

interface CardProps {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  className?: string;
}

export function Card({ title, subtitle, actions, className = "", children }: PropsWithChildren<CardProps>) {
  return (
    <section className={`ui-card ui-card-hover p-6 sm:p-7 ${className}`.trim()}>
      {(title || subtitle || actions) ? (
        <header className="mb-5 flex items-start justify-between gap-4">
          <div className="min-w-0">
            {title ? <h2 className="font-display text-[1.35rem] font-semibold text-raf-ink">{title}</h2> : null}
            {subtitle ? <p className="mt-1.5 max-w-2xl text-sm leading-6 text-stone-500">{subtitle}</p> : null}
          </div>
          {actions}
        </header>
      ) : null}
      {children}
    </section>
  );
}
