import { NavLink, Outlet } from "react-router-dom";

import { APP_NAME } from "../../lib/constants";

const navigation = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/allocation-preferences", label: "Allocation Preferences" },
  { to: "/income/new", label: "Add Income" },
  { to: "/transactions", label: "Transactions" },
  { to: "/debts", label: "Debts" },
  { to: "/monthly-review", label: "Monthly Review" },
];

function navClassName(isActive: boolean) {
  return isActive
    ? "nav-link nav-link-active"
    : "nav-link";
}

function profileIconClassName(isActive: boolean) {
  return isActive
    ? "inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--primary-color)] text-[var(--primary-contrast)] shadow-panel"
    : "inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--surface-color)] text-[var(--text-muted)] transition duration-150 hover:-translate-y-0.5 hover:text-[var(--text-strong)] hover:shadow-lift";
}

export function AppLayout() {
  return (
    <div className="theme-shell min-h-screen">
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col gap-6 px-4 py-6 lg:flex-row lg:px-6 lg:py-8">
        <aside className="ui-card px-5 py-6 lg:w-72 lg:px-6">
          <div className="mb-7 flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-stone-500">Revenue Allocation Framework</p>
              <h1 className="mt-2 font-display text-3xl font-semibold text-raf-ink">{APP_NAME}</h1>
              <p className="mt-2 text-sm leading-6 text-stone-500">Deposit-driven finance, kept legible.</p>
            </div>
            <NavLink
              to="/profile"
              aria-label="Profile"
              title="Profile"
              className={({ isActive }) => profileIconClassName(isActive)}
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M20 21a8 8 0 0 0-16 0" />
                <circle cx="12" cy="8" r="4" />
              </svg>
            </NavLink>
          </div>
          <nav className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
            {navigation.map((item) => (
              <NavLink key={item.to} to={item.to} className={({ isActive }) => navClassName(isActive)}>
                {item.label}
              </NavLink>
            ))}
          </nav>
        </aside>
        <main className="flex-1 pb-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
