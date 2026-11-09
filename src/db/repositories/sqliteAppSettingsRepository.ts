import type { SQLiteDatabase } from 'expo-sqlite';

import type { ThemePreference } from '@/types';

import type { AppSettingsRepository } from './appSettingsRepository';

/** `app_settings` row the theme preference is stored in. */
export const THEME_PREFERENCE_KEY = 'theme_preference';

export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark'];

export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'system';

export type AppSettingsRepositoryOptions = {
  /**
   * Injectable clock. Production uses the real clock; tests pass a fixed date
   * so the persisted `updated_at` value is deterministic.
   */
  now?: () => Date;
};

function isThemePreference(value: string): value is ThemePreference {
  return (THEME_PREFERENCES as readonly string[]).includes(value);
}

/** SQLite-backed implementation of the `AppSettingsRepository` contract. */
export function createSqliteAppSettingsRepository(
  db: SQLiteDatabase,
  options: AppSettingsRepositoryOptions = {},
): AppSettingsRepository {
  const now = options.now ?? (() => new Date());

  return {
    getThemePreference: async () => {
      const row = await db.getFirstAsync<{ value: string }>(
        'SELECT value FROM app_settings WHERE key = ?;',
        [THEME_PREFERENCE_KEY],
      );

      // A missing row and an unreadable value both resolve to the default. The
      // stored row is deliberately left untouched so it can be inspected later,
      // and an invalid value must never crash the app.
      if (!row || !isThemePreference(row.value)) {
        return DEFAULT_THEME_PREFERENCE;
      }

      return row.value;
    },

    // Upsert on the primary key: repeated saves replace the single row and can
    // never create duplicates or touch any other setting.
    setThemePreference: async (preference) => {
      if (!isThemePreference(preference)) {
        throw new Error(`Geçersiz tema tercihi: "${String(preference)}"`);
      }

      await db.runAsync(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           value = excluded.value,
           updated_at = excluded.updated_at;`,
        [THEME_PREFERENCE_KEY, preference, now().toISOString()],
      );
    },

    // Only the theme key is removed; unrelated settings are never deleted.
    clearThemePreference: async () => {
      await db.runAsync('DELETE FROM app_settings WHERE key = ?;', [THEME_PREFERENCE_KEY]);
    },
  };
}
