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
    <div className="space-y-4">
      <header className="ui-card px-6 py-5">
        <div className="flex flex-col gap-3 sm:gap-2">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              {eyebrow ? <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-stone-500">{eyebrow}</p> : null}
            </div>
            {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
          </div>
          <div className="min-w-0">
            <h2 className="text-[22px] font-bold tracking-tight text-raf-ink">{title}</h2>
            <p className="mt-1 max-w-[60ch] truncate text-[13px] leading-5 text-stone-500">{description}</p>
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}
