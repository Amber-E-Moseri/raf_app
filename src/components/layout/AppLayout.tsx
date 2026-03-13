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
    ? "rounded-2xl bg-raf-moss px-4 py-3 text-sm font-semibold text-white shadow-sm"
    : "rounded-2xl px-4 py-3 text-sm font-medium text-stone-600 transition duration-150 hover:bg-white hover:text-raf-ink hover:shadow-sm";
}

export function AppLayout() {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(216,230,221,0.65),_transparent_38%),linear-gradient(180deg,_#f3f1eb_0%,_#f8f7f3_52%,_#ece7dd_100%)]">
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col gap-6 px-4 py-6 lg:flex-row lg:px-6 lg:py-8">
        <aside className="ui-card px-5 py-6 lg:w-72 lg:px-6">
          <div className="mb-7">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-stone-500">Revenue Allocation Framework</p>
            <h1 className="mt-2 font-display text-3xl font-semibold text-raf-ink">{APP_NAME}</h1>
            <p className="mt-2 text-sm leading-6 text-stone-500">Deposit-driven finance, kept legible.</p>
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
