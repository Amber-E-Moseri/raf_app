import { useMemo, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";

import { APP_NAME } from "../../lib/constants";
import { useAuth } from "../../context/AuthContext";
import { buildMonthOptions } from "../../lib/period";
import { usePeriod } from "./PeriodProvider";

const desktopNavigation = [
  {
    label: "Overview",
    items: [
      { to: "/dashboard", label: "Dashboard", icon: "home" },
      { to: "/insights", label: "Insights", icon: "chart" },
    ],
  },
  {
    label: "Money",
    items: [
      { to: "/income/new", label: "Add Income", icon: "plus" },
      { to: "/transactions", label: "Transactions", icon: "list" },
      { to: "/debts", label: "Debts", icon: "wallet" },
      { to: "/goals", label: "Goals", icon: "target" },
    ],
  },
  {
    label: "Planning",
    items: [
      { to: "/cash-flow-forecast", label: "Cash-Flow Forecast", icon: "chart" },
      { to: "/monthly-review", label: "Monthly Review", icon: "calendar" },
      { to: "/allocation-preferences", label: "Categories", icon: "pie" },
      { to: "/scenarios", label: "Scenarios", icon: "scenarios" },
      { to: "/settings", label: "Settings", icon: "user" },
    ],
  },
  {
    label: "Household",
    items: [
      { to: "/members", label: "Stewards", icon: "people" },
    ],
  },
  {
    label: "AI Advisor",
    items: [
      { to: "/remi", label: "Remi", icon: "remi" },
    ],
  },
];

const mobileTabs = [
  { to: "/dashboard", label: "Home", icon: "home" },
  { to: "/transactions", label: "Transactions", icon: "list" },
  { to: "/remi", label: "Remi", icon: "remi" },
  { to: "/monthly-review", label: "Review", icon: "calendar" },
  { to: "/settings", label: "Settings", icon: "user" },
];

function navClassName(isActive: boolean) {
  return isActive ? "nav-link nav-link-active" : "nav-link";
}

function mobileTabClassName(isActive: boolean) {
  return isActive ? "mobile-tab mobile-tab-active" : "mobile-tab";
}

function NavIcon({ type }: { type: string }) {
  if (type === "plus") {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
        <path d="M12 5v14M5 12h14" />
      </svg>
    );
  }

  if (type === "list") {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
        <path d="M8 6h11M8 12h11M8 18h11M4 6h.01M4 12h.01M4 18h.01" />
      </svg>
    );
  }

  if (type === "wallet") {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 7h18v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
        <path d="M16 13h2" />
        <path d="M3 9V7a2 2 0 0 1 2-2h12" />
      </svg>
    );
  }

  if (type === "calendar") {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M7 3v4M17 3v4M4 9h16M5 5h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" />
      </svg>
    );
  }

  if (type === "pie") {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3v9h9" />
        <path d="M20.5 13a8.5 8.5 0 1 1-9.5-9.5" />
      </svg>
    );
  }

  if (type === "user") {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 21a8 8 0 0 0-16 0" />
        <circle cx="12" cy="8" r="4" />
      </svg>
    );
  }

  if (type === "target") {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="8" />
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M22 12h-2M12 22v-2M2 12h2" />
      </svg>
    );
  }

  if (type === "chart") {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 19h16" />
        <path d="M7 16V9" />
        <path d="M12 16V5" />
        <path d="M17 16v-3" />
      </svg>
    );
  }

  if (type === "people") {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21a5 5 0 0 0-10 0" />
        <circle cx="12" cy="8" r="4" />
        <path d="M23 21a5 5 0 0 0-5-5" />
        <path d="M1 21a5 5 0 0 1 5-5" />
        <path d="M19 7a3 3 0 1 0 0-6M5 7a3 3 0 1 1 0-6" />
      </svg>
    );
  }

  if (type === "remi") {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        <path d="M8 10h.01M12 10h.01M16 10h.01" />
      </svg>
    );
  }

  if (type === "scenarios") {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 3v18h18" />
        <path d="m7 16 4-4 4 4 4-4" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 11.5 12 4l9 7.5" />
      <path d="M5 10.5V20h14v-9.5" />
    </svg>
  );
}

function PeriodPicker({
  activeMonth,
  activeMonthLabel,
  isCurrentMonth,
  monthOptions,
  onPrev,
  onNext,
  onCurrent,
  onSelect,
}: {
  activeMonth: string;
  activeMonthLabel: string;
  isCurrentMonth: boolean;
  monthOptions: Array<{ value: string; label: string }>;
  onPrev: () => void;
  onNext: () => void;
  onCurrent: () => void;
  onSelect: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button type="button" className="period-trigger" onClick={() => setOpen((current) => !current)}>
        <span>{activeMonthLabel}</span>
        <span aria-hidden="true">v</span>
      </button>

      {open ? (
        <div className="period-menu">
          <div className="mb-2 flex items-center justify-between gap-2">
            <button type="button" className="period-menu-button" onClick={onPrev}>Previous</button>
            <span className="text-[11px] font-semibold text-[var(--text-primary)]">{activeMonthLabel}</span>
            <button type="button" className="period-menu-button" disabled={isCurrentMonth} onClick={onNext}>Next</button>
          </div>
          <button
            type="button"
            className="period-menu-current"
            onClick={() => {
              onCurrent();
              setOpen(false);
            }}
          >
            Current month
          </button>
          <div className="max-h-56 space-y-1 overflow-y-auto">
            {monthOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`period-option ${option.value === activeMonth ? "period-option-active" : ""}`}
                onClick={() => {
                  onSelect(option.value);
                  setOpen(false);
                }}
              >
                <span>{option.label}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SidebarGroup({ label, items }: { label: string; items: Array<{ to: string; label: string; icon: string }> }) {
  return (
    <section className="space-y-2">
      <h3 className="nav-group-title">{label}</h3>
      <div className="space-y-1">
        {items.map((item) => (
          <NavLink key={item.to} to={item.to} className={({ isActive }) => navClassName(isActive)}>
            <span className="inline-flex h-4 w-4 items-center justify-center">
              <NavIcon type={item.icon} />
            </span>
            <span>{item.label}</span>
          </NavLink>
        ))}
      </div>
    </section>
  );
}

export function AppLayout() {
  const { session, switchWorkspace } = useAuth();
  const {
    activeMonth,
    activeMonthLabel,
    isCurrentMonth,
    nextMonth,
    prevMonth,
    jumpToCurrentMonth,
    setActiveMonth,
  } = usePeriod();
  const monthOptions = useMemo(() => buildMonthOptions(activeMonth), [activeMonth]);
  const workspaces = session?.workspaces ?? [];
  const activeWorkspaceId = session?.workspaceId ?? session?.householdId;

  return (
    <div className="theme-shell min-h-screen">
      <header className="mobile-top md:hidden">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="brand-mark">R</div>
            <div className="leading-none">
              <p className="text-[15px] font-bold text-[var(--text-primary)]">{APP_NAME}</p>
              <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--text-secondary)]">Finance OS</p>
            </div>
          </div>
        </div>
        <PeriodPicker
          activeMonth={activeMonth}
          activeMonthLabel={activeMonthLabel}
          isCurrentMonth={isCurrentMonth}
          monthOptions={monthOptions}
          onPrev={prevMonth}
          onNext={nextMonth}
          onCurrent={jumpToCurrentMonth}
          onSelect={setActiveMonth}
        />
      </header>

      <div className="mx-auto flex max-w-[1320px] gap-6 px-4 pb-[calc(92px+env(safe-area-inset-bottom))] pt-4 md:px-6 md:pb-6 md:pt-6">
        <aside className="hidden w-56 shrink-0 md:block">
          <div className="sidebar-shell">
            <div className="space-y-4 border-b border-[var(--border-subtle)] pb-4">
              <div className="flex items-center gap-3">
                <div className="brand-mark">R</div>
                <div>
                  <p className="text-[16px] font-bold tracking-[-0.01em] text-[var(--text-primary)]">{APP_NAME}</p>
                  <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--text-secondary)]">Finance OS</p>
                </div>
              </div>
              <PeriodPicker
                activeMonth={activeMonth}
                activeMonthLabel={activeMonthLabel}
                isCurrentMonth={isCurrentMonth}
                monthOptions={monthOptions}
                onPrev={prevMonth}
                onNext={nextMonth}
                onCurrent={jumpToCurrentMonth}
                onSelect={setActiveMonth}
              />
              {workspaces.length > 1 ? (
                <select
                  className="ui-field min-h-[40px] text-[12px] font-semibold"
                  aria-label="Active household"
                  value={activeWorkspaceId}
                  onChange={(event) => switchWorkspace(event.target.value)}
                >
                  {workspaces.map((workspace) => (
                    <option key={workspace.id} value={workspace.id}>{workspace.name}</option>
                  ))}
                </select>
              ) : null}
            </div>

            <nav className="space-y-6 py-5">
              {desktopNavigation.map((group) => (
                <SidebarGroup key={group.label} label={group.label} items={group.items} />
              ))}
            </nav>

            <div className="mt-auto space-y-3 border-t border-[var(--border-subtle)] pt-4">
              <NavLink to="/profile" className={({ isActive }) => navClassName(isActive)}>
                <span className="inline-flex h-4 w-4 items-center justify-center">
                  <NavIcon type="user" />
                </span>
                <span>Profile</span>
              </NavLink>
            </div>
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>

      <nav className="mobile-bottom-nav md:hidden">
        {mobileTabs.map((item) => (
          <NavLink key={item.to} to={item.to} className={({ isActive }) => mobileTabClassName(isActive)}>
            <span className="inline-flex h-4 w-4 items-center justify-center">
              <NavIcon type={item.icon} />
            </span>
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
