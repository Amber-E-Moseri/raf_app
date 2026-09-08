import { createContext, useCallback, useContext, useEffect, useState } from "react";

const STORAGE_KEY = "raf_auth";

export interface AuthSession {
  token: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number | null;
  userId: string;
  email: string;
  householdId: string;
  householdName: string;
  workspaceId?: string;
  workspaceName?: string;
  workspaces?: WorkspaceMembership[];
  remiTier?: "free" | "paid";
}

export interface WorkspaceMembership {
  id: string;
  name: string;
  type: "personal" | "household" | string;
  role: "owner" | "admin" | "member" | "viewer" | string;
  status?: "active" | "invited" | "suspended" | string;
}

interface AuthContextValue {
  session: AuthSession | null;
  isAuthenticated: boolean;
  setSession: (session: AuthSession) => void;
  switchWorkspace: (workspaceId: string) => void;
  clearSession: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function loadSession(): AuthSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthSession;
    const workspaceId = parsed.workspaceId ?? parsed.householdId;
    const workspaceName = parsed.workspaceName ?? parsed.householdName;
    return {
      ...parsed,
      workspaceId,
      workspaceName,
      householdId: workspaceId,
      householdName: workspaceName,
    };
  } catch {
    return null;
  }
}

export function saveSession(session: AuthSession) {
  const workspaceId = session.workspaceId ?? session.householdId;
  const workspaceName = session.workspaceName ?? session.householdName;
  const normalized = {
    ...session,
    token: session.accessToken ?? session.token,
    accessToken: session.accessToken ?? session.token,
    workspaceId,
    workspaceName,
    householdId: workspaceId,
    householdName: workspaceName,
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  } catch {}
}

export function removeSession() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

export function getStoredSession(): AuthSession | null {
  return loadSession();
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSessionState] = useState<AuthSession | null>(loadSession);

  const setSession = useCallback((s: AuthSession) => {
    const workspaceId = s.workspaceId ?? s.householdId;
    const workspaceName = s.workspaceName ?? s.householdName;
    const normalized = {
      ...s,
      token: s.accessToken ?? s.token,
      accessToken: s.accessToken ?? s.token,
      workspaceId,
      workspaceName,
      householdId: workspaceId,
      householdName: workspaceName,
    };
    saveSession(normalized);
    setSessionState(normalized);
  }, []);

  const switchWorkspace = useCallback((workspaceId: string) => {
    setSessionState((current) => {
      if (!current || current.workspaceId === workspaceId) {
        return current;
      }

      const workspace = current.workspaces?.find((item) => item.id === workspaceId);
      if (!workspace) {
        return current;
      }

      const next = {
        ...current,
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        householdId: workspace.id,
        householdName: workspace.name,
      };
      saveSession(next);
      window.dispatchEvent(new CustomEvent("raf:workspace-changed", {
        detail: { workspaceId: workspace.id },
      }));
      return next;
    });
  }, []);

  const clearSession = useCallback(() => {
    removeSession();
    setSessionState(null);
  }, []);

  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === STORAGE_KEY) {
        setSessionState(e.newValue ? (JSON.parse(e.newValue) as AuthSession) : null);
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return (
    <AuthContext.Provider value={{ session, isAuthenticated: !!session, setSession, switchWorkspace, clearSession }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
