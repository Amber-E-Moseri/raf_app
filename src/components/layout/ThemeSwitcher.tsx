import { useEffect, useRef, useState } from "react";

import { useAppearance } from "./AppearanceProvider";
import { THEME_OPTIONS } from "../../lib/appearance";

export function ThemeSwitcher() {
  const { preferences, saveAppearance } = useAppearance();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const activeTheme = THEME_OPTIONS.find((theme) => theme.value === preferences.theme_color) ?? THEME_OPTIONS[0];

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleClickOutside(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    window.addEventListener("mousedown", handleClickOutside);
    return () => window.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  return (
    <div className="theme-switcher" ref={rootRef}>
      <button
        type="button"
        className="theme-switcher-trigger"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="M12 3a9 9 0 1 0 9 9c0-3-2-4-3.5-4s-3 .8-4.3-.5c-1.3-1.3-.5-2.8-.5-4.2S15 3 12 3Z" />
          <circle cx="8" cy="10" r="1" />
          <circle cx="13" cy="8" r="1" />
          <circle cx="16" cy="12" r="1" />
        </svg>
        <span>{activeTheme.label}</span>
        <svg viewBox="0 0 20 20" className="h-4 w-4 text-[var(--text-subtle)]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="m6 8 4 4 4-4" />
        </svg>
      </button>

      {open ? (
        <div className="theme-switcher-menu" role="menu" aria-label="Theme">
          <div className="theme-switcher-menu-header">
            <p className="theme-switcher-title">Theme</p>
            <p className="theme-switcher-subtitle">Choose your interface style</p>
          </div>
          <div className="theme-switcher-options">
            {THEME_OPTIONS.map((option) => {
              const selected = option.value === preferences.theme_color;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  className={`theme-option ${selected ? "theme-option-active" : ""}`}
                  onClick={() => {
                    saveAppearance({ ...preferences, theme_color: option.value });
                    setOpen(false);
                  }}
                >
                  <span className="theme-preview" aria-hidden="true">
                    <span style={{ backgroundColor: option.swatch }} />
                    <span style={{ backgroundColor: option.accent }} />
                    <span style={{ backgroundColor: "var(--surface-ink-soft)" }} />
                  </span>
                  <span className="theme-option-copy">
                    <span className="theme-option-name">{option.label}</span>
                    <span className="theme-option-desc">{option.descriptor}</span>
                  </span>
                  {selected ? (
                    <svg viewBox="0 0 20 20" className="h-4 w-4 text-[var(--theme-primary)]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="m5 10 3 3 7-7" />
                    </svg>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

