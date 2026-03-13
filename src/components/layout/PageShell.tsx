import type { ReactNode } from "react";

interface PageShellProps {
  eyebrow?: string;
  title: string;
  description: string;
  actions?: ReactNode;
  children: ReactNode;
}

export function PageShell({ eyebrow, title, description, actions, children }: PageShellProps) {
  return (
    <div className="space-y-7">
      <header className="ui-card flex flex-col gap-4 px-6 py-7 sm:flex-row sm:items-end sm:justify-between">
        <div>
          {eyebrow ? <p className="text-xs font-semibold uppercase tracking-[0.25em] text-stone-500">{eyebrow}</p> : null}
          <h2 className="mt-2 font-display text-4xl font-semibold text-raf-ink sm:text-[2.5rem]">{title}</h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-stone-500 sm:text-[0.95rem]">{description}</p>
        </div>
        {actions}
      </header>
      {children}
    </div>
  );
}
