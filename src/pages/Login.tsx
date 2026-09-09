import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { apiLogin, apiSignup } from "../api/authApi";
import { ApiError } from "../api/client";
import rafLogo from "../assets/raf-logo.png";

type Tab = "login" | "signup";

export function Login() {
  const { setSession } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: { pathname: string } })?.from?.pathname ?? "/dashboard";

  const [tab, setTab] = useState<Tab>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [householdName, setHouseholdName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const session = tab === "login"
        ? await apiLogin(email, password)
        : await apiSignup(email, password, householdName || undefined);
      setSession(session);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center px-4"
      style={{ background: "var(--surface-app)" }}
    >
      <div className="w-full max-w-sm">
        {/* Brand */}
        <div className="mb-8 flex flex-col items-center gap-4">
          <img src={rafLogo} alt="RAF" className="brand-logo brand-logo-lg" />
          <div className="text-center">
            <p className="text-[22px] font-bold tracking-[-0.02em] text-[var(--text-strong)]">RAF</p>
            <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]">Resource Allocation Framework</p>
          </div>
        </div>

        {/* Card */}
        <div
          className="rounded-[1.75rem] border border-[var(--border-color)] p-6 shadow-panel"
          style={{ background: "var(--surface-color)" }}
        >
          {/* Tab switcher */}
          <div className="mb-6 flex gap-1 rounded-[1rem] border border-[var(--border-color)] p-1" style={{ background: "var(--surface-elevated)" }}>
            {(["login", "signup"] as Tab[]).map((t) => (
              <button
                key={t}
                type="button"
                className="flex-1 rounded-[0.75rem] py-2 text-sm font-semibold transition duration-150"
                style={tab === t
                  ? { background: "var(--surface-color)", color: "var(--text-strong)", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }
                  : { color: "var(--text-muted)" }}
                onClick={() => { setTab(t); setError(null); }}
              >
                {t === "login" ? "Sign in" : "Create account"}
              </button>
            ))}
          </div>

          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
            {tab === "signup" && (
              <div>
                <label className="mb-1.5 block text-sm font-medium text-[var(--text-strong)]">
                  Household name
                </label>
                <input
                  type="text"
                  className="ui-field"
                  placeholder="My Household"
                  value={householdName}
                  onChange={(e) => setHouseholdName(e.target.value)}
                  autoComplete="organization"
                />
              </div>
            )}

            <div>
              <label className="mb-1.5 block text-sm font-medium text-[var(--text-strong)]">
                Email
              </label>
              <input
                type="email"
                className="ui-field"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                autoFocus
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-[var(--text-strong)]">
                Password
              </label>
              <input
                type="password"
                className="ui-field"
                placeholder={tab === "signup" ? "At least 8 characters" : "Your password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete={tab === "login" ? "current-password" : "new-password"}
              />
            </div>

            {error && (
              <p className="rounded-[0.75rem] border border-[var(--badge-danger-ring)] bg-[var(--badge-danger-bg)] px-4 py-3 text-sm text-[var(--badge-danger-text)]">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="mt-1 w-full rounded-full bg-[var(--primary-color)] py-2.5 text-sm font-semibold text-[var(--primary-contrast)] shadow-sm transition hover:opacity-90 disabled:opacity-50"
            >
              {loading
                ? (tab === "login" ? "Signing in…" : "Creating account…")
                : (tab === "login" ? "Sign in" : "Create account")}
            </button>
          </form>
        </div>

        <p className="mt-5 text-center text-[12px] text-[var(--text-muted)]">
          {tab === "login"
            ? "Don't have an account? Switch to Create account above."
            : "Already have an account? Switch to Sign in above."}
        </p>
      </div>
    </div>
  );
}
