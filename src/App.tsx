import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { AppearanceProvider } from "./components/layout/AppearanceProvider";
import { AppLayout } from "./components/layout/AppLayout";
import { AllocationPreferences } from "./pages/AllocationPreferences";
import { AddIncome } from "./pages/AddIncome";
import { AppearanceSettings } from "./pages/AppearanceSettings";
import { Dashboard } from "./pages/Dashboard";
import { Debts } from "./pages/Debts";
import { MonthlyReview } from "./pages/MonthlyReview";
import { NotFound } from "./pages/NotFound";
import { Transactions } from "./pages/Transactions";

export default function App() {
  return (
    <AppearanceProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<AppLayout />}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="allocation-preferences" element={<AllocationPreferences />} />
            <Route path="profile" element={<AppearanceSettings />} />
            <Route path="appearance" element={<Navigate to="/profile" replace />} />
            <Route path="income/new" element={<AddIncome />} />
            <Route path="transactions" element={<Transactions />} />
            <Route path="debts" element={<Debts />} />
            <Route path="monthly-review" element={<MonthlyReview />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AppearanceProvider>
  );
}
