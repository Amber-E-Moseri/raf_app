import { useMemo, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";

import { APP_NAME } from "../../lib/constants";
import { buildMonthOptions } from "../../lib/period";
import { usePeriod } from "./PeriodProvider";

const navigationGroups = [
  {
    label: "Workspace",
    items: [
      { to: "/dashboard", label: "Dashboard", icon: "home" },
      { to: "/income/new", label: "Add Income", icon: "plus" },
      { to: "/transactions", label: "Transactions", icon: "list" },
      { to: "/debts", label: "Debts", icon: "wallet" },
    ],
  },
  {
    label: "Planning",
    items: [
      { to: "/monthly-review", label: "Monthly Review", icon: "calendar" },
      { to: "/allocation-preferences", label: "Allocation", icon: "pie" },
      { to: "/profile", label: "Profile", icon: "user" },
    ],
  },
];

function navClassName(isActive: boolean) {
  return isActive
    ? "nav-link nav-link-active"
    : "nav-link";
}

function profileIconClassName(isActive: boolean) {
  return isActive
    ? "inline-flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--primary-color)] text-[var(--primary-contrast)] shadow-panel"
    : "inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--surface-color)] text-[var(--text-muted)] transition duration-150 hover:-translate-y-0.5 hover:text-[var(--text-strong)] hover:shadow-lift";
}

function NavIcon({ type }: { type: string }) {
  if (type === "plus") {
    return (
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <path d="M12 5v14M5 12h14" />
      </svg>
    );
  }

  if (type === "list") {
    return (
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <path d="M8 6h11M8 12h11M8 18h11M4 6h.01M4 12h.01M4 18h.01" />
      </svg>
    );
  }

  if (type === "wallet") {
    return (
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 7h18v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
        <path d="M16 13h2" />
        <path d="M3 9V7a2 2 0 0 1 2-2h12" />
      </svg>
    );
  }

  if (type === "calendar") {
    return (
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M7 3v4M17 3v4M4 9h16M5 5h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" />
      </svg>
    );
  }

  if (type === "pie") {
    return (
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3v9h9" />
        <path d="M20.5 13a8.5 8.5 0 1 1-9.5-9.5" />
      </svg>
    );
  }

  if (type === "user") {
    return (
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 21a8 8 0 0 0-16 0" />
        <circle cx="12" cy="8" r="4" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 11.5 12 4l9 7.5" />
      <path d="M5 10.5V20h14v-9.5" />
    </svg>
  );
}

function NavGroup({ label, items }: { label: string; items: Array<{ to: string; label: string; icon: string }> }) {
  return (
    <div className="space-y-1.5">
      <p className="px-1.5 text-[8px] font-semibold uppercase tracking-[0.28em] text-stone-500">{label}</p>
      <div className="space-y-1">
        {items.map((item) => (
          <NavLink key={item.to} to={item.to} className={({ isActive }) => navClassName(isActive)}>
            <span className="inline-flex h-3.5 w-3.5 items-center justify-center">
              <NavIcon type={item.icon} />
            </span>
            <span>{item.label}</span>
          </NavLink>
        ))}
      </div>
    </div>
  );
}

export function AppLayout() {
  const {
    activeMonth,
    activeMonthLabel,
    isCurrentMonth,
    nextMonth,
    prevMonth,
    jumpToCurrentMonth,
    setActiveMonth,
  } = usePeriod();
  const [isPeriodMenuOpen, setIsPeriodMenuOpen] = useState(false);
  const monthOptions = useMemo(() => buildMonthOptions(activeMonth), [activeMonth]);

  return (
    <div className="theme-shell min-h-screen">
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col gap-4 px-6 py-5 md:px-6 lg:flex-row">
        <div className="md:hidden">
          <div className="ui-card space-y-4 border-b border-r border-[var(--border-color)] p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--primary-color)] text-xs font-bold text-[var(--primary-contrast)]">R</div>
                <div className="leading-none">
                  <div className="text-[15px] font-bold text-raf-ink">{APP_NAME}</div>
                  <div className="mt-1 text-[9px] font-medium uppercase tracking-[0.18em] text-stone-500">Finance</div>
                </div>
              </div>
              <NavLink
                to="/profile"
                aria-label="Profile"
                title="Profile"
                className={({ isActive }) => profileIconClassName(isActive)}
              >
                <NavIcon type="user" />
              </NavLink>
            </div>
            <div className="relative">
              <button
                type="button"
                className="flex w-full items-center justify-between rounded-full border border-[var(--border-color)] bg-[var(--surface-elevated)] px-3 py-2 text-[11px] font-medium text-stone-600"
                onClick={() => setIsPeriodMenuOpen((current) => !current)}
              >
                <span>{activeMonthLabel}</span>
                <span aria-hidden="true">v</span>
              </button>
              {isPeriodMenuOpen ? (
                <div className="mt-2 rounded-2xl border border-[var(--border-color)] bg-[var(--surface-color)] p-3 shadow-panel">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <button type="button" className="text-[11px] font-medium text-stone-500" onClick={prevMonth}>
                      Previous
                    </button>
                    <span className="text-[11px] font-semibold text-raf-ink">{activeMonthLabel}</span>
                    <button
                      type="button"
                      className={`text-[11px] font-medium ${isCurrentMonth ? "cursor-not-allowed text-stone-300" : "text-stone-500"}`}
                      onClick={nextMonth}
                      disabled={isCurrentMonth}
                    >
                      Next
                    </button>
                  </div>
                  <button
                    type="button"
                    className="mb-2 w-full rounded-xl border border-[var(--border-color)] px-3 py-2 text-[11px] font-medium text-stone-600 hover:bg-[var(--surface-elevated)]"
                    onClick={() => {
                      jumpToCurrentMonth();
                      setIsPeriodMenuOpen(false);
                    }}
                  >
                    Current month
                  </button>
                  <div className="max-h-56 space-y-1 overflow-y-auto">
                    {monthOptions.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-[11px] ${
                          option.value === activeMonth ? "bg-[var(--primary-soft)] text-[var(--primary-color)]" : "text-stone-600 hover:bg-[var(--surface-elevated)]"
                        }`}
                        onClick={() => {
                          setActiveMonth(option.value);
                          setIsPeriodMenuOpen(false);
                        }}
                      >
                        <span>{option.label}</span>
                        {option.value === activeMonth ? <span>Current</span> : null}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
            <div className="space-y-3 border-t border-[var(--border-color)] pt-3">
              {navigationGroups.map((group) => (
                <div key={group.label} className="space-y-2">
                  <p className="text-[8px] font-semibold uppercase tracking-[0.28em] text-stone-500">{group.label}</p>
                  <div className="grid grid-cols-2 gap-2">
                    {group.items.map((item) => (
                      <NavLink key={item.to} to={item.to} className={({ isActive }) => navClassName(isActive)}>
                        <span className="inline-flex h-3.5 w-3.5 items-center justify-center">
                          <NavIcon type={item.icon} />
                        </span>
                        <span>{item.label}</span>
                      </NavLink>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 border-t border-[var(--border-color)] pt-3">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--surface-elevated)] text-[11px] font-semibold text-raf-ink">J</div>
              <div className="leading-none">
                <div className="text-[12px] font-semibold text-raf-ink">Jane Doe</div>
                <div className="mt-1 text-[9px] uppercase tracking-[0.16em] text-stone-500">Pro Plan</div>
              </div>
            </div>
          </div>
        </div>

        <aside className="hidden md:flex md:w-64 md:flex-col md:border-r md:border-[var(--border-color)] md:pr-4 lg:w-72 lg:pr-5">
          <div className="ui-card flex min-h-full flex-col border-r border-[var(--border-color)] px-4 py-4">
            <div className="flex items-start justify-between gap-3 border-b border-[var(--border-color)] pb-4">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--primary-color)] text-xs font-bold text-[var(--primary-contrast)]">R</div>
                <div className="leading-none">
                  <div className="text-[15px] font-bold text-raf-ink">{APP_NAME}</div>
                  <div className="mt-1 text-[9px] font-medium uppercase tracking-[0.18em] text-stone-500">Finance</div>
                </div>
              </div>
              <NavLink
                to="/profile"
                aria-label="Profile"
                title="Profile"
                className={({ isActive }) => profileIconClassName(isActive)}
              >
                <NavIcon type="user" />
              </NavLink>
            </div>

            <div className="border-b border-[var(--border-color)] py-4">
              <div className="relative">
                <button
                  type="button"
                  className="flex w-full items-center justify-between rounded-full border border-[var(--border-color)] bg-[var(--surface-elevated)] px-3 py-2 text-[11px] font-medium text-stone-600"
                  onClick={() => setIsPeriodMenuOpen((current) => !current)}
                >
                  <span>{activeMonthLabel}</span>
                  <span aria-hidden="true">v</span>
                </button>
                {isPeriodMenuOpen ? (
                  <div className="mt-2 rounded-2xl border border-[var(--border-color)] bg-[var(--surface-color)] p-3 shadow-panel">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <button type="button" className="text-[11px] font-medium text-stone-500" onClick={prevMonth}>
                        Previous
                      </button>
                      <span className="text-[11px] font-semibold text-raf-ink">{activeMonthLabel}</span>
                      <button
                        type="button"
                        className={`text-[11px] font-medium ${isCurrentMonth ? "cursor-not-allowed text-stone-300" : "text-stone-500"}`}
                        onClick={nextMonth}
                        disabled={isCurrentMonth}
                      >
                        Next
                      </button>
                    </div>
                    <button
                      type="button"
                      className="mb-2 w-full rounded-xl border border-[var(--border-color)] px-3 py-2 text-[11px] font-medium text-stone-600 hover:bg-[var(--surface-elevated)]"
                      onClick={() => {
                        jumpToCurrentMonth();
                        setIsPeriodMenuOpen(false);
                      }}
                    >
                      Current month
                    </button>
                    <div className="max-h-64 space-y-1 overflow-y-auto">
                      {monthOptions.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-[11px] ${
                            option.value === activeMonth ? "bg-[var(--primary-soft)] text-[var(--primary-color)]" : "text-stone-600 hover:bg-[var(--surface-elevated)]"
                          }`}
                          onClick={() => {
                            setActiveMonth(option.value);
                            setIsPeriodMenuOpen(false);
                          }}
                        >
                          <span>{option.label}</span>
                          {option.value === activeMonth ? <span>Current</span> : null}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            <nav className="space-y-4 py-4">
              <NavGroup {...navigationGroups[0]} />
              <div className="border-t border-[var(--border-color)] pt-4">
                <NavGroup {...navigationGroups[1]} />
              </div>
            </nav>

            <div className="mt-auto flex items-center gap-2 border-t border-[var(--border-color)] pt-4">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--surface-elevated)] text-[11px] font-semibold text-raf-ink">J</div>
              <div className="leading-none">
                <div className="text-[12px] font-semibold text-raf-ink">Jane Doe</div>
                <div className="mt-1 text-[9px] uppercase tracking-[0.16em] text-stone-500">Pro Plan</div>
              </div>
            </div>
          </div>
        </aside>

        <main className="flex-1 pb-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
