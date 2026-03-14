import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { PropsWithChildren } from "react";

import {
  APPEARANCE_STORAGE_KEY,
  DEFAULT_APPEARANCE,
  parseAppearancePreferences,
} from "../../lib/appearance";
import type { AppearancePreferences } from "../../lib/appearance";

interface AppearanceContextValue {
  preferences: AppearancePreferences;
  saveAppearance: (nextPreferences: AppearancePreferences) => void;
  resetAppearance: () => void;
}

const AppearanceContext = createContext<AppearanceContextValue | null>(null);

function applyAppearance(preferences: AppearancePreferences) {
  if (typeof document === "undefined") {
    return;
  }

  const root = document.documentElement;
  const appRoot = document.getElementById("root");

  root.dataset.theme = preferences.theme_color;
  root.dataset.font = preferences.font_family;
  root.dataset.mode = preferences.appearance_mode;
  root.dataset.scale = preferences.interface_scale;

  if (appRoot) {
    appRoot.dataset.theme = preferences.theme_color;
    appRoot.dataset.font = preferences.font_family;
    appRoot.dataset.mode = preferences.appearance_mode;
    appRoot.dataset.scale = preferences.interface_scale;
  }
}

function readInitialAppearance() {
  if (typeof window === "undefined") {
    return DEFAULT_APPEARANCE;
  }

  return parseAppearancePreferences(window.localStorage.getItem(APPEARANCE_STORAGE_KEY));
}

export function AppearanceProvider({ children }: PropsWithChildren) {
  const [preferences, setPreferences] = useState<AppearancePreferences>(readInitialAppearance);

  useEffect(() => {
    applyAppearance(preferences);
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(preferences));
  }, [preferences]);

  const value = useMemo<AppearanceContextValue>(() => ({
    preferences,
    saveAppearance: (nextPreferences) => setPreferences(nextPreferences),
    resetAppearance: () => setPreferences(DEFAULT_APPEARANCE),
  }), [preferences]);

  return (
    <AppearanceContext.Provider value={value}>
      {children}
    </AppearanceContext.Provider>
  );
}

export function useAppearance() {
  const context = useContext(AppearanceContext);
  if (!context) {
    throw new Error("useAppearance must be used within an AppearanceProvider");
  }

  return context;
}
