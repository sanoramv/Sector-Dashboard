import { DEFAULT_SETTINGS, type AppSettings } from "../../types/config";

const SETTINGS_KEY = "nse-sector-dashboard:settings:v1";

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw);
    // Shallow-merge over defaults so a future added field is never undefined for existing users.
    return {
      scoring: { ...DEFAULT_SETTINGS.scoring, ...parsed.scoring },
      regime: { ...DEFAULT_SETTINGS.regime, ...parsed.regime },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Storage disabled/full - settings simply won't persist across reloads.
  }
}

export function resetSettings(): void {
  try {
    localStorage.removeItem(SETTINGS_KEY);
  } catch {
    // no-op
  }
}
