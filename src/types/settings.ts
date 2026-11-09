/**
 * Saved theme choice, persisted in `app_settings` under the `theme_preference`
 * key. `system` follows the device colour scheme; `light` and `dark` are hard
 * overrides. This is the *preference*, never the resolved visual scheme.
 */
export type ThemePreference = 'system' | 'light' | 'dark';
