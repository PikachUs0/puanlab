/// <reference types="node" />

import { DatabaseSync } from 'node:sqlite';

import type { SQLiteDatabase } from 'expo-sqlite';

import { createSqliteAppSettingsRepository } from '../repositories/sqliteAppSettingsRepository';
import { createSqliteUserProfileRepository } from '../repositories/sqliteUserProfileRepository';
import {
  CREATE_APP_SETTINGS_TABLE,
  CREATE_PRACTICE_EXAMS_TABLE,
  CREATE_PRACTICE_EXAM_RESULTS_TABLE,
  CREATE_TOPIC_PROGRESS_TABLE,
  CREATE_USER_PROFILE_TABLE,
  SCHEMA_VERSION,
} from '../schema';

/**
 * In-memory SQLite adapter exposing exactly the `expo-sqlite` surface
 * `initializeDatabase` and the schema reconciliation use, so the real startup
 * path runs against a real engine without touching the device database.
 */
class Adapter {
  readonly db = new DatabaseSync(':memory:');

  async execAsync(sql: string): Promise<void> {
    this.db.exec(sql);
  }

  async runAsync(sql: string, params: unknown[] = []): Promise<unknown> {
    return this.db.prepare(sql).run(...(params as never[]));
  }

  async getFirstAsync<T>(sql: string, params: unknown[] = []): Promise<T | null> {
    const row = this.db.prepare(sql).get(...(params as never[]));
    return (row as T | undefined) ?? null;
  }

  async getAllAsync<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.db.prepare(sql).all(...(params as never[])) as unknown as T[];
  }

  async withTransactionAsync(task: () => Promise<void>): Promise<void> {
    this.db.exec('BEGIN');
    try {
      await task();
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  tables(): string[] {
    return (
      this.db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name;")
        .all() as { name: string }[]
    ).map((row) => row.name);
  }

  columns(table: string): string[] {
    return (
      this.db.prepare(`PRAGMA table_info(${table});`).all() as { name: string }[]
    ).map((row) => row.name);
  }

  userVersion(): number {
    return (this.db.prepare('PRAGMA user_version;').get() as { user_version: number })
      .user_version;
  }
}

let adapter: Adapter;
const mockGetAdapter = () => adapter;

jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn(async () => mockGetAdapter()),
}));

// The connection is cached at module scope, so each test re-requires the module
// for a fresh one bound to its own adapter.
function loadInitializeDatabase(): typeof import('../database').initializeDatabase {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (require('../database') as typeof import('../database')).initializeDatabase;
}

/** A populated database: profile, topic progress, a normalised exam and a result. */
function seedExistingData(): void {
  adapter.db.exec(CREATE_USER_PROFILE_TABLE);
  adapter.db.exec(CREATE_TOPIC_PROGRESS_TABLE);
  adapter.db.exec(CREATE_PRACTICE_EXAMS_TABLE);
  adapter.db.exec(CREATE_PRACTICE_EXAM_RESULTS_TABLE);

  adapter.db.exec(
    `INSERT INTO user_profile (id, grade_level, score_type, target_department, target_university, onboarding_completed, created_at, updated_at)
     VALUES (1, 'grade_12', 'SAY', 'Bilgisayar Mühendisliği', NULL, 1, '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z');`,
  );
  adapter.db.exec(
    `INSERT INTO topic_progress (topic_id, status, note, last_studied_at, updated_at)
     VALUES ('tyt_turkce_1', 'learning', NULL, NULL, '2026-01-01T00:00:00.000Z');`,
  );
  adapter.db.exec(
    `INSERT INTO practice_exams (id, exam_type, score_type_snapshot, name, exam_date, total_correct, total_incorrect, total_blank, total_net, created_at, updated_at)
     VALUES ('e1', 'TYT', 'SAY', 'Deneme', '2026-01-01T00:00:00.000Z', 20, 5, 15, 18.75, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');`,
  );
  adapter.db.exec(
    `INSERT INTO practice_exam_results (exam_id, lesson_id, correct, incorrect, blank, net)
     VALUES ('e1', 'tyt_turkce', 20, 5, 15, 18.75);`,
  );
}

beforeEach(() => {
  adapter = new Adapter();
  jest.resetModules();
});

describe('initializeDatabase startup repair', () => {
  it('creates the full schema on a fresh install', async () => {
    await loadInitializeDatabase()();

    expect(adapter.userVersion()).toBe(SCHEMA_VERSION);
    expect(adapter.tables()).toEqual(
      expect.arrayContaining([
        'user_profile',
        'topic_progress',
        'practice_exams',
        'practice_exam_results',
        'app_settings',
      ]),
    );
  });

  it('migrates a v5 database to v6 and preserves its rows', async () => {
    seedExistingData();
    adapter.db.exec('PRAGMA user_version = 5;');

    await loadInitializeDatabase()();

    expect(adapter.userVersion()).toBe(SCHEMA_VERSION);
    expect(adapter.tables()).toContain('app_settings');
    expect(await adapter.getAllAsync('SELECT * FROM user_profile;')).toHaveLength(1);
    expect(await adapter.getAllAsync('SELECT * FROM topic_progress;')).toHaveLength(1);
    expect(await adapter.getAllAsync('SELECT * FROM practice_exams;')).toHaveLength(1);
    expect(await adapter.getAllAsync('SELECT * FROM practice_exam_results;')).toHaveLength(1);
  });

  it('repairs a v6 database whose app_settings table is missing, without deleting data', async () => {
    seedExistingData();
    // `PRAGMA user_version` is only a claim: this database reports 6 while the
    // settings table this version owns never made it to disk. Startup must
    // rebuild the table in place instead of throwing on the schema assert.
    adapter.db.exec('PRAGMA user_version = 6;');
    expect(adapter.tables()).not.toContain('app_settings');

    const profileBefore = await adapter.getAllAsync('SELECT * FROM user_profile;');
    const topicsBefore = await adapter.getAllAsync('SELECT * FROM topic_progress;');
    const examsBefore = await adapter.getAllAsync('SELECT * FROM practice_exams;');

    await expect(loadInitializeDatabase()()).resolves.toBeDefined();

    expect(adapter.tables()).toContain('app_settings');
    expect(adapter.columns('app_settings')).toEqual(
      expect.arrayContaining(['key', 'value', 'updated_at']),
    );
    expect(adapter.userVersion()).toBe(SCHEMA_VERSION);
    // Nothing was dropped, archived or rewritten.
    expect(await adapter.getAllAsync('SELECT * FROM user_profile;')).toEqual(profileBefore);
    expect(await adapter.getAllAsync('SELECT * FROM topic_progress;')).toEqual(topicsBefore);
    expect(await adapter.getAllAsync('SELECT * FROM practice_exams;')).toEqual(examsBefore);
  });

  it('repairs a v6 database whose app_settings has the wrong shape, archiving the old table', async () => {
    seedExistingData();
    // Missing `updated_at`: the physical shape, not the version, decides.
    adapter.db.exec(
      'CREATE TABLE app_settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);',
    );
    adapter.db.exec(
      `INSERT INTO app_settings (key, value) VALUES ('theme_preference', 'dark');`,
    );
    adapter.db.exec('PRAGMA user_version = 6;');

    const profileBefore = await adapter.getAllAsync('SELECT * FROM user_profile;');

    await expect(loadInitializeDatabase()()).resolves.toBeDefined();

    expect(adapter.columns('app_settings')).toEqual(
      expect.arrayContaining(['key', 'value', 'updated_at']),
    );
    // The incompatible table is preserved under a deterministic archival name.
    expect(adapter.tables()).toContain('app_settings_legacy_v5');
    expect(
      await adapter.getAllAsync('SELECT * FROM app_settings_legacy_v5;'),
    ).toEqual([{ key: 'theme_preference', value: 'dark' }]);
    expect(adapter.userVersion()).toBe(SCHEMA_VERSION);
    expect(await adapter.getAllAsync('SELECT * FROM user_profile;')).toEqual(profileBefore);
  });

  it('leaves a complete v6 database and its stored theme preference untouched', async () => {
    seedExistingData();
    adapter.db.exec(CREATE_APP_SETTINGS_TABLE);
    adapter.db.exec(
      `INSERT INTO app_settings (key, value, updated_at) VALUES ('theme_preference', 'dark', '2026-01-01T00:00:00.000Z');`,
    );
    adapter.db.exec('PRAGMA user_version = 6;');
    const tablesBefore = adapter.tables();

    await loadInitializeDatabase()();

    expect(adapter.tables()).toEqual(tablesBefore);
    expect(await adapter.getAllAsync('SELECT value FROM app_settings;')).toEqual([
      { value: 'dark' },
    ]);
    expect(adapter.userVersion()).toBe(SCHEMA_VERSION);
  });

  it('is idempotent: a repaired database survives a second startup without archival churn', async () => {
    seedExistingData();
    adapter.db.exec('PRAGMA user_version = 6;');

    await loadInitializeDatabase()();
    const tablesAfterFirstRun = adapter.tables();

    await loadInitializeDatabase()();

    expect(adapter.tables()).toEqual(tablesAfterFirstRun);
    expect(adapter.tables()).not.toContain('app_settings_legacy_v5_2');
  });

  it('makes both repositories usable once the repair has run, reading the preserved rows', async () => {
    seedExistingData();
    adapter.db.exec('PRAGMA user_version = 6;');

    // A repository built before readiness would read against a table that does
    // not exist yet; after the repair the same connection serves both reads.
    await loadInitializeDatabase()();

    const settingsRepository = createSqliteAppSettingsRepository(
      adapter as unknown as SQLiteDatabase,
    );
    // Missing theme row resolves to the default instead of throwing.
    await expect(settingsRepository.getThemePreference()).resolves.toBe('system');
    await settingsRepository.setThemePreference('dark');
    await expect(settingsRepository.getThemePreference()).resolves.toBe('dark');

    const profileRepository = createSqliteUserProfileRepository(
      adapter as unknown as SQLiteDatabase,
    );
    await expect(profileRepository.getProfile()).resolves.toMatchObject({
      gradeLevel: 'grade_12',
      scoreType: 'SAY',
      onboardingCompleted: true,
    });
  });
});
