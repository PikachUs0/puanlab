/// <reference types="node" />

import { DatabaseSync } from 'node:sqlite';

import type { SQLiteDatabase } from 'expo-sqlite';

import type { ThemePreference } from '@/types';

import {
  createSqliteAppSettingsRepository,
  DEFAULT_THEME_PREFERENCE,
  THEME_PREFERENCE_KEY,
} from '../repositories/sqliteAppSettingsRepository';
import { CREATE_APP_SETTINGS_TABLE } from '../schema';

type BindValue = string | number | null;

/** In-memory SQLite adapter exposing the exact surface the repository uses. */
class TestDatabase {
  private readonly db = new DatabaseSync(':memory:');

  async execAsync(sql: string): Promise<void> {
    this.db.exec(sql);
  }

  async runAsync(sql: string, params: BindValue[] = []): Promise<void> {
    this.db.prepare(sql).run(...params);
  }

  async getFirstAsync<T>(sql: string, params: BindValue[] = []): Promise<T | null> {
    const row = this.db.prepare(sql).get(...params);
    return (row as T | undefined) ?? null;
  }

  async getAllAsync<T>(sql: string, params: BindValue[] = []): Promise<T[]> {
    return this.db.prepare(sql).all(...params) as unknown as T[];
  }

  run(sql: string): void {
    this.db.exec(sql);
  }
}

/** Deterministic fixed clock: the repository never reads the real time here. */
const FIXED_NOW = new Date('2026-03-04T10:15:00.000Z');
const FIXED_NOW_ISO = FIXED_NOW.toISOString();

/** Unrelated setting that must always survive the theme operations untouched. */
const UNRELATED_KEY = 'some_other_setting';

let db: TestDatabase;
let repo: ReturnType<typeof createSqliteAppSettingsRepository>;

async function seed(key: string, value: string): Promise<void> {
  await db.runAsync('INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?);', [
    key,
    value,
    FIXED_NOW_ISO,
  ]);
}

beforeEach(async () => {
  db = new TestDatabase();
  await db.execAsync(CREATE_APP_SETTINGS_TABLE);
  repo = createSqliteAppSettingsRepository(db as unknown as SQLiteDatabase, {
    now: () => FIXED_NOW,
  });
});

describe('getThemePreference', () => {
  it('returns system when no preference is stored', async () => {
    await expect(repo.getThemePreference()).resolves.toBe(DEFAULT_THEME_PREFERENCE);
    await expect(repo.getThemePreference()).resolves.toBe('system');
  });

  it('loads a stored system preference', async () => {
    await seed(THEME_PREFERENCE_KEY, 'system');

    await expect(repo.getThemePreference()).resolves.toBe('system');
  });

  it('loads a stored light preference', async () => {
    await seed(THEME_PREFERENCE_KEY, 'light');

    await expect(repo.getThemePreference()).resolves.toBe('light');
  });

  it('loads a stored dark preference', async () => {
    await seed(THEME_PREFERENCE_KEY, 'dark');

    await expect(repo.getThemePreference()).resolves.toBe('dark');
  });

  it('falls back to system for an invalid stored value without crashing or deleting it', async () => {
    await seed(THEME_PREFERENCE_KEY, 'neon');

    await expect(repo.getThemePreference()).resolves.toBe('system');

    // The bad row is left in place so it can still be inspected later.
    const rows = await db.getAllAsync<{ value: string }>(
      'SELECT value FROM app_settings WHERE key = ?;',
      [THEME_PREFERENCE_KEY],
    );
    expect(rows).toEqual([{ value: 'neon' }]);
  });
});

describe('setThemePreference', () => {
  it('persists the selected preference with a deterministic timestamp', async () => {
    await repo.setThemePreference('dark');

    const rows = await db.getAllAsync<{ key: string; value: string; updated_at: string }>(
      'SELECT key, value, updated_at FROM app_settings;',
    );
    expect(rows).toEqual([
      { key: THEME_PREFERENCE_KEY, value: 'dark', updated_at: FIXED_NOW_ISO },
    ]);
    await expect(repo.getThemePreference()).resolves.toBe('dark');
  });

  it('replaces the single row instead of adding another on repeated saves', async () => {
    await repo.setThemePreference('light');
    await repo.setThemePreference('dark');

    const rows = await db.getAllAsync<{ key: string; value: string }>(
      'SELECT key, value FROM app_settings;',
    );
    expect(rows).toEqual([{ key: THEME_PREFERENCE_KEY, value: 'dark' }]);
  });

  it('rejects an invalid preference before writing anything', async () => {
    await expect(repo.setThemePreference('neon' as ThemePreference)).rejects.toThrow(
      /Geçersiz tema tercihi/,
    );

    await expect(db.getAllAsync('SELECT * FROM app_settings;')).resolves.toEqual([]);
  });

  it('leaves unrelated settings untouched', async () => {
    await seed(UNRELATED_KEY, 'keep');

    await repo.setThemePreference('dark');

    const rows = await db.getAllAsync<{ key: string; value: string }>(
      'SELECT key, value FROM app_settings ORDER BY key;',
    );
    expect(rows).toEqual([
      { key: UNRELATED_KEY, value: 'keep' },
      { key: THEME_PREFERENCE_KEY, value: 'dark' },
    ]);
  });
});

describe('clearThemePreference', () => {
  it('returns to the system default and removes only the theme key', async () => {
    await repo.setThemePreference('dark');
    await seed(UNRELATED_KEY, 'keep');

    await repo.clearThemePreference();

    await expect(repo.getThemePreference()).resolves.toBe('system');

    const rows = await db.getAllAsync<{ key: string; value: string }>(
      'SELECT key, value FROM app_settings;',
    );
    expect(rows).toEqual([{ key: UNRELATED_KEY, value: 'keep' }]);
  });
});
