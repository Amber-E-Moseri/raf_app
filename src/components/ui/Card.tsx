import type { PropsWithChildren, ReactNode } from "react";

interface CardProps {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  className?: string;
}

export function Card({ title, subtitle, actions, className = "", children }: PropsWithChildren<CardProps>) {
  return (
    <section className={`ui-card ui-card-hover p-4 ${className}`.trim()}>
      {(title || subtitle || actions) ? (
        <header className="mb-2.5 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {title ? <h2 className="text-[9px] font-semibold uppercase tracking-[0.22em] text-stone-500">{title}</h2> : null}
            {subtitle ? <p className="mt-2.5 max-w-2xl text-[13px] leading-5 text-stone-500">{subtitle}</p> : null}
          </div>
          {actions}
        </header>
      ) : null}
      {children}
    </section>
  );
}
