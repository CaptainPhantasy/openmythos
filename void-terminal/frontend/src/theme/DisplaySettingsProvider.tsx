import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  DEFAULT_DISPLAY_SETTINGS,
  DISPLAY_SETTINGS_STORAGE_KEY,
  DisplaySettings,
  getDisplayFont,
  getDisplayTheme,
  sanitizeDisplaySettings,
} from "./displaySettings";

interface DisplaySettingsContextValue {
  settings: DisplaySettings;
  activeTheme: ReturnType<typeof getDisplayTheme>;
  activeFont: ReturnType<typeof getDisplayFont>;
  updateSettings: (patch: Partial<DisplaySettings>) => void;
  resetSettings: () => void;
}

const DisplaySettingsContext = createContext<DisplaySettingsContextValue | null>(null);

function loadInitialSettings(): DisplaySettings {
  if (typeof window === "undefined") return DEFAULT_DISPLAY_SETTINGS;
  try {
    const raw = window.localStorage.getItem(DISPLAY_SETTINGS_STORAGE_KEY);
    return raw ? sanitizeDisplaySettings(JSON.parse(raw)) : DEFAULT_DISPLAY_SETTINGS;
  } catch {
    return DEFAULT_DISPLAY_SETTINGS;
  }
}

function persistSettings(settings: DisplaySettings) {
  try {
    window.localStorage.setItem(DISPLAY_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Display preferences are non-critical. Failed persistence must not break the UI.
  }
}

function applyDisplaySettings(settings: DisplaySettings) {
  const root = document.documentElement;
  const theme = getDisplayTheme(settings.themeId);
  const font = getDisplayFont(settings.fontId);
  const densityScale = settings.density === "compact" ? "0.9" : settings.density === "spacious" ? "1.12" : "1";

  root.dataset.displayTheme = theme.id;
  root.dataset.displayDensity = settings.density;
  root.dataset.displayMotion = settings.motion;
  root.dataset.displayEffects = settings.showBackgroundEffects ? "on" : "off";
  root.dataset.displayContrast = settings.highContrast ? "high" : "standard";

  for (const [token, value] of Object.entries(theme.tokens)) {
    root.style.setProperty(`--${token}`, value);
  }

  root.style.setProperty("--app-font-family", font.stack);
  root.style.setProperty("--app-font-size", `${settings.fontSize}px`);
  root.style.setProperty("--display-density-scale", densityScale);

  if (settings.highContrast) {
    root.style.setProperty("--line", "color-mix(in srgb, var(--text) 22%, transparent)");
    root.style.setProperty("--line-soft", "color-mix(in srgb, var(--text) 14%, transparent)");
    root.style.setProperty("--line-strong", "color-mix(in srgb, var(--text) 32%, transparent)");
    root.style.setProperty("--muted", "color-mix(in srgb, var(--text) 72%, transparent)");
    root.style.setProperty("--dim", "color-mix(in srgb, var(--text) 58%, transparent)");
  }

  root.style.setProperty("--border-color", "var(--line)");
}

export function DisplaySettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<DisplaySettings>(loadInitialSettings);

  useEffect(() => {
    applyDisplaySettings(settings);
    persistSettings(settings);
  }, [settings]);

  const updateSettings = useCallback((patch: Partial<DisplaySettings>) => {
    setSettings((current) => sanitizeDisplaySettings({ ...current, ...patch }));
  }, []);

  const resetSettings = useCallback(() => {
    setSettings(DEFAULT_DISPLAY_SETTINGS);
  }, []);

  const value = useMemo<DisplaySettingsContextValue>(
    () => ({
      settings,
      activeTheme: getDisplayTheme(settings.themeId),
      activeFont: getDisplayFont(settings.fontId),
      updateSettings,
      resetSettings,
    }),
    [resetSettings, settings, updateSettings]
  );

  return <DisplaySettingsContext.Provider value={value}>{children}</DisplaySettingsContext.Provider>;
}

export function useDisplaySettings() {
  const context = useContext(DisplaySettingsContext);
  if (!context) {
    throw new Error("useDisplaySettings must be used inside DisplaySettingsProvider");
  }
  return context;
}
