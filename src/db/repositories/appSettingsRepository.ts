import type { ThemePreference } from '@/types';

/**
 * Local key/value settings persisted in the `app_settings` table. The theme
 * preference is the only setting in MVP 0.1, so the contract stays focused on
 * it instead of exposing a generic get/set surface.
 */
export interface AppSettingsRepository {
  /** Saved theme preference; `'system'` when the setting is missing or invalid. */
  getThemePreference(): Promise<ThemePreference>;
  /** Persists the theme preference after validating it. */
  setThemePreference(preference: ThemePreference): Promise<void>;
  /** Removes only the theme preference, falling back to `'system'`. */
  clearThemePreference(): Promise<void>;
}
