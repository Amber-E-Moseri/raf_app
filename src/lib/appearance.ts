export type ThemeColor = "green" | "pink" | "blue" | "black";
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
  theme_color: "green",
  font_family: "inter",
  appearance_mode: "light",
  interface_scale: "medium",
};

export const THEME_OPTIONS: Array<{
  value: ThemeColor;
  label: string;
  swatch: string;
  accent: string;
}> = [
  { value: "green", label: "Green", swatch: "#1f7a4f", accent: "#d8e6dd" },
  { value: "pink", label: "Pink", swatch: "#d14d8b", accent: "#f7d7e7" },
  { value: "blue", label: "Blue", swatch: "#2563eb", accent: "#dbe8ff" },
  { value: "black", label: "Black", swatch: "#111111", accent: "#d8d8d8" },
];

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
    const theme_color = THEME_OPTIONS.some((option) => option.value === parsed.theme_color)
      ? parsed.theme_color as ThemeColor
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
