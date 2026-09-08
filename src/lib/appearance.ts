export type ThemeColor = "emerald" | "blush" | "violet" | "minimal";
export type FontFamilyOption = "inter" | "barlow" | "playfair-display" | "libre-franklin";
export type AppearanceMode = "light" | "dark";
export type InterfaceScale = "small" | "medium" | "large";

export interface AppearancePreferences {
  theme_color: ThemeColor;
  font_family: FontFamilyOption;
  appearance_mode: AppearanceMode;
  interface_scale: InterfaceScale;
}

export const APPEARANCE_STORAGE_KEY = "raf_appearance_preferences";

export const DEFAULT_APPEARANCE: AppearancePreferences = {
  theme_color: "emerald",
  font_family: "inter",
  appearance_mode: "light",
  interface_scale: "medium",
};

export const THEME_OPTIONS: Array<{
  value: ThemeColor;
  label: string;
  swatch: string;
  accent: string;
  descriptor: string;
}> = [
  { value: "emerald", label: "Emerald", swatch: "#10b981", accent: "#059669", descriptor: "Focused and fresh" },
  { value: "blush", label: "Blush", swatch: "#ec4899", accent: "#db2777", descriptor: "Soft and warm" },
  { value: "violet", label: "Violet", swatch: "#8b5cf6", accent: "#7c3aed", descriptor: "Bold and expressive" },
  { value: "minimal", label: "Minimal", swatch: "#111827", accent: "#374151", descriptor: "Clean and neutral" },
];

const LEGACY_THEME_MAP: Record<string, ThemeColor> = {
  green: "emerald",
  pink: "blush",
  blue: "violet",
  black: "minimal",
};

export const FONT_OPTIONS: Array<{
  value: FontFamilyOption;
  label: string;
  preview: string;
}> = [
  { value: "inter", label: "Inter", preview: "Inter keeps dense financial data crisp." },
  { value: "barlow", label: "Barlow", preview: "Barlow feels structured and contemporary." },
  { value: "playfair-display", label: "Playfair Display", preview: "Playfair Display adds a more editorial feel." },
  { value: "libre-franklin", label: "Libre Franklin", preview: "Libre Franklin balances polish and neutrality." },
];

export const APPEARANCE_MODE_OPTIONS: Array<{
  value: AppearanceMode;
  label: string;
  description: string;
}> = [
  { value: "light", label: "Light", description: "Bright surfaces with soft contrast." },
  { value: "dark", label: "Dark", description: "Lower-glare surfaces for night sessions." },
];

export const INTERFACE_SCALE_OPTIONS: Array<{
  value: InterfaceScale;
  label: string;
  description: string;
}> = [
  { value: "small", label: "Small", description: "Fits more data into every view." },
  { value: "medium", label: "Medium", description: "Balanced spacing for daily use." },
  { value: "large", label: "Large", description: "More breathing room and larger text." },
];

export function parseAppearancePreferences(rawValue: string | null): AppearancePreferences {
  if (!rawValue) {
    return DEFAULT_APPEARANCE;
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<AppearancePreferences>;
    const candidateTheme = typeof parsed.theme_color === "string"
      ? (LEGACY_THEME_MAP[parsed.theme_color] ?? parsed.theme_color)
      : DEFAULT_APPEARANCE.theme_color;
    const theme_color = THEME_OPTIONS.some((option) => option.value === candidateTheme)
      ? candidateTheme as ThemeColor
      : DEFAULT_APPEARANCE.theme_color;
    const font_family = FONT_OPTIONS.some((option) => option.value === parsed.font_family)
      ? parsed.font_family as FontFamilyOption
      : DEFAULT_APPEARANCE.font_family;
    const appearance_mode = APPEARANCE_MODE_OPTIONS.some((option) => option.value === parsed.appearance_mode)
      ? parsed.appearance_mode as AppearanceMode
      : DEFAULT_APPEARANCE.appearance_mode;
    const interface_scale = INTERFACE_SCALE_OPTIONS.some((option) => option.value === parsed.interface_scale)
      ? parsed.interface_scale as InterfaceScale
      : DEFAULT_APPEARANCE.interface_scale;

    return {
      theme_color,
      font_family,
      appearance_mode,
      interface_scale,
    };
  } catch {
    return DEFAULT_APPEARANCE;
  }
}
