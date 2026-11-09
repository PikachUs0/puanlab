/// <reference types="node" />

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { SQLiteDatabase } from 'expo-sqlite';

import {
  classifyDatabaseStartupFailure,
  createDatabaseStartupController,
  DATABASE_STARTUP_COPY,
  isDatabaseUsable,
  selectDatabaseStartupGate,
  toDatabaseStartupError,
} from '../databaseStartup';
import { createSqliteAppSettingsRepository } from '../repositories';
import {
  CREATE_APP_SETTINGS_TABLE,
  CREATE_PRACTICE_EXAMS_TABLE,
  CREATE_PRACTICE_EXAM_RESULTS_TABLE,
  CREATE_TOPIC_PROGRESS_TABLE,
  CREATE_USER_PROFILE_TABLE,
  SCHEMA_VERSION,
} from '../schema';

type BindValue = string | number | null;

/** Minimal in-memory adapter exposing exactly the `expo-sqlite` surface used. */
class TestDatabase {
  readonly db = new DatabaseSync(':memory:');

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

  run(sql: string): void {
    this.db.exec(sql);
  }

  countOf(table: string): number {
    const row = this.db.prepare(`SELECT COUNT(*) AS n FROM ${table};`).get() as
      | { n: number }
      | undefined;
    return row?.n ?? 0;
  }
}

let adapter: TestDatabase;
const mockGetAdapter = () => adapter;

jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn(async () => mockGetAdapter()),
}));

// The connection is cached at module scope, so each test re-requires the module
// for a fresh one bound to its own adapter.
function loadInitializeDatabase(): typeof import('../database')['initializeDatabase'] {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (require('../database') as typeof import('../database')).initializeDatabase;
}

/** Deterministic fixed clock: no test reads the real time. */
const FIXED_NOW = new Date('2026-03-04T10:15:00.000Z');

const FAKE_DATABASE = { name: 'fake' } as unknown as SQLiteDatabase;

function flush(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/** Creates the full schema, stamps the current version and seeds one row per table. */
function seedAll(): void {
  adapter.run(CREATE_USER_PROFILE_TABLE);
  adapter.run(CREATE_TOPIC_PROGRESS_TABLE);
  adapter.run(CREATE_PRACTICE_EXAMS_TABLE);
  adapter.run(CREATE_PRACTICE_EXAM_RESULTS_TABLE);
  adapter.run(CREATE_APP_SETTINGS_TABLE);

  adapter.run(
    `INSERT INTO user_profile (id, grade_level, score_type, target_department, target_university, onboarding_completed, created_at, updated_at)
     VALUES (1, 'grade_12', 'SAY', 'Bilgisayar Mühendisliği', NULL, 1, '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z');`,
  );
  adapter.run(
    `INSERT INTO topic_progress (topic_id, status, note, last_studied_at, updated_at)
     VALUES ('tyt_turkce_1', 'learning', 'not', NULL, '2026-01-01T00:00:00.000Z');`,
  );
  adapter.run(
    `INSERT INTO practice_exams (id, exam_type, score_type_snapshot, name, exam_date, total_correct, total_incorrect, total_blank, total_net, created_at, updated_at)
     VALUES ('e1', 'TYT', 'SAY', 'TYT Denemesi', '2026-01-01T00:00:00.000Z', 20, 5, 15, 18.75, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');`,
  );
  adapter.run(
    `INSERT INTO practice_exam_results (exam_id, lesson_id, correct, incorrect, blank, net)
     VALUES ('e1', 'tyt_turkce', 20, 5, 15, 18.75);`,
  );
  adapter.run(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ('theme_preference', 'dark', '2026-01-01T00:00:00.000Z');`,
  );

  adapter.run(`PRAGMA user_version = ${SCHEMA_VERSION};`);
}

beforeEach(() => {
  adapter = new TestDatabase();
  jest.resetModules();
});

describe('database startup transitions', () => {
  it('1. reaches the ready state after a successful initialization', async () => {
    const controller = createDatabaseStartupController({
      initialize: async () => FAKE_DATABASE,
    });

    controller.start();
    await flush();

    expect(controller.getState()).toEqual({
      database: FAKE_DATABASE,
      error: null,
      isRetrying: false,
      isReady: true,
    });
    expect(selectDatabaseStartupGate(controller.getState())).toBe('ready');
  });

  it('2. exposes the original Error when the initialization fails', async () => {
    const failure = new Error('SQLITE_CANTOPEN: unable to open database file');
    const controller = createDatabaseStartupController({
      initialize: async () => {
        throw failure;
      },
    });

    controller.start();
    await flush();

    const state = controller.getState();
    expect(state.error).toBe(failure);
    expect(state.isReady).toBe(false);
    expect(state.database).toBeNull();
  });

  it('3. does not settle into a "missing profile" state on failure', async () => {
    const controller = createDatabaseStartupController({
      initialize: async () => {
        throw new Error('migration failed');
      },
    });

    controller.start();
    await flush();

    const state = controller.getState();
    // With no usable database there is no repository, so profile hydration can
    // never run and the app is never treated as an un-onboarded user.
    expect(isDatabaseUsable(state)).toBe(false);
    expect(selectDatabaseStartupGate(state)).toBe('error');
  });

  it('4. never selects the ready gate (protected routes) on failure', async () => {
    const controller = createDatabaseStartupController({
      initialize: async () => {
        throw new Error('schema assertion failed');
      },
    });

    controller.start();
    await flush();

    expect(selectDatabaseStartupGate(controller.getState())).not.toBe('ready');
  });

  it('5. retry runs the initialization flow again', async () => {
    const initialize = jest
      .fn()
      .mockRejectedValueOnce(new Error('open failed'))
      .mockResolvedValueOnce(FAKE_DATABASE);

    const controller = createDatabaseStartupController({ initialize });

    controller.start();
    await flush();
    expect(initialize).toHaveBeenCalledTimes(1);

    controller.retry();
    await flush();
    expect(initialize).toHaveBeenCalledTimes(2);
  });

  it('6. prevents duplicate retry requests', async () => {
    let releaseRetry: (database: SQLiteDatabase) => void = () => undefined;

    const initialize = jest
      .fn()
      .mockRejectedValueOnce(new Error('open failed'))
      .mockImplementationOnce(
        () =>
          new Promise<SQLiteDatabase>((resolve) => {
            releaseRetry = resolve;
          }),
      );

    const controller = createDatabaseStartupController({ initialize });

    controller.start();
    await flush();
    expect(initialize).toHaveBeenCalledTimes(1);

    controller.retry();
    controller.retry();

    // The second tap is ignored: no competing run is started.
    expect(initialize).toHaveBeenCalledTimes(2);

    releaseRetry(FAKE_DATABASE);
    await flush();

    expect(initialize).toHaveBeenCalledTimes(2);
    expect(controller.getState().isReady).toBe(true);
  });

  it('7. a successful retry replaces the error with the ready database', async () => {
    const initialize = jest
      .fn()
      .mockRejectedValueOnce(new Error('open failed'))
      .mockResolvedValueOnce(FAKE_DATABASE);

    const controller = createDatabaseStartupController({ initialize });

    controller.start();
    await flush();
    expect(controller.getState().error).not.toBeNull();

    controller.retry();

    // The error is cleared exactly when the new attempt starts, and the error
    // screen stays mounted while the retry is in flight.
    expect(controller.getState().error).toBeNull();
    expect(controller.getState().isRetrying).toBe(true);
    expect(selectDatabaseStartupGate(controller.getState())).toBe('error');

    await flush();

    expect(controller.getState()).toEqual({
      database: FAKE_DATABASE,
      error: null,
      isRetrying: false,
      isReady: true,
    });
    expect(selectDatabaseStartupGate(controller.getState())).toBe('ready');
  });

  it('8. a failed retry keeps the error and stays on the error gate', async () => {
    const firstFailure = new Error('open failed');
    const secondFailure = new Error('migration failed');

    const initialize = jest
      .fn()
      .mockRejectedValueOnce(firstFailure)
      .mockRejectedValueOnce(secondFailure);

    const controller = createDatabaseStartupController({ initialize });

    controller.start();
    await flush();

    controller.retry();
    await flush();

    const state = controller.getState();
    expect(state.error).toBe(secondFailure);
    expect(isDatabaseUsable(state)).toBe(false);
    expect(selectDatabaseStartupGate(state)).toBe('error');
  });
});

describe('retry preserves every stored record', () => {
  /** Fails the first open, then delegates to the real initialization flow. */
  function createRetryingController() {
    let hasFailedOnce = false;

    return createDatabaseStartupController({
      initialize: () => {
        if (!hasFailedOnce) {
          hasFailedOnce = true;
          return Promise.reject(new Error('SQLITE_CANTOPEN: unable to open database file'));
        }

        return loadInitializeDatabase()();
      },
    });
  }

  it('9. retry does not clear user_profile', async () => {
    seedAll();
    const controller = createRetryingController();

    controller.start();
    await flush();
    expect(selectDatabaseStartupGate(controller.getState())).toBe('error');

    controller.retry();
    await flush();

    expect(controller.getState().isReady).toBe(true);
    expect(adapter.countOf('user_profile')).toBe(1);
  });

  it('10. retry does not clear topic_progress', async () => {
    seedAll();
    const controller = createRetryingController();

    controller.start();
    await flush();
    controller.retry();
    await flush();

    expect(adapter.countOf('topic_progress')).toBe(1);
  });

  it('11. retry does not clear practice_exams', async () => {
    seedAll();
    const controller = createRetryingController();

    controller.start();
    await flush();
    controller.retry();
    await flush();

    expect(adapter.countOf('practice_exams')).toBe(1);
    expect(adapter.countOf('practice_exam_results')).toBe(1);
  });

  it('12. retry does not clear app_settings', async () => {
    seedAll();
    const controller = createRetryingController();

    controller.start();
    await flush();
    controller.retry();
    await flush();

    expect(adapter.countOf('app_settings')).toBe(1);
  });

  it('13. a successful retry allows the hydrators to read the database', async () => {
    seedAll();
    const controller = createRetryingController();

    controller.start();
    await flush();
    controller.retry();
    await flush();

    const state = controller.getState();
    expect(isDatabaseUsable(state)).toBe(true);

    // The repository the settings hydrator builds from the exposed connection
    // reads the persisted preference, proving hydration can continue.
    const settingsRepository = createSqliteAppSettingsRepository(
      state.database as SQLiteDatabase,
      { now: () => FIXED_NOW },
    );
    await expect(settingsRepository.getThemePreference()).resolves.toBe('dark');
  });
});

describe('startup error copy and diagnostics', () => {
  it('14. the startup error screen does not depend on ThemeProvider', () => {
    const source = readFileSync(
      join(__dirname, '..', '..', 'components', 'DatabaseStartupError.tsx'),
      'utf8',
    );
    // Comments may name the themed APIs while explaining why they are avoided,
    // so only the executable code is inspected.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

    // Rendered before `ThemeProvider` exists, it must use plain React Native
    // primitives only and never the themed components or hooks.
    expect(code).toMatch(/from 'react-native'/);
    expect(code).not.toMatch(/useTheme/);
    expect(code).not.toMatch(/\bAppText\b/);
    expect(code).not.toMatch(/\bScreen\b/);
    expect(code).not.toMatch(/from '@\/theme'/);
  });

  it('15. development diagnostics preserve the technical Error', async () => {
    const failure = new Error(
      'Veritabanı şeması bozuk (beklenen sürüm 6). practice_exams eksik kolonlar: [name].',
    );

    expect(toDatabaseStartupError(failure)).toBe(failure);
    expect(classifyDatabaseStartupFailure(failure)).toBe('schema-assertion');
    expect(classifyDatabaseStartupFailure(new Error('SQLITE_CANTOPEN'))).toBe('unknown');

    const controller = createDatabaseStartupController({
      initialize: async () => {
        throw failure;
      },
    });

    controller.start();
    await flush();

    // The original instance is kept verbatim; only a non-Error throw is wrapped.
    expect(controller.getState().error).toBe(failure);
    expect(toDatabaseStartupError('boom')).toBeInstanceOf(Error);
  });

  it('16. production user copy contains no SQL or path details', () => {
    const values = Object.values(DATABASE_STARTUP_COPY);
    expect(values.length).toBeGreaterThan(0);

    for (const value of values) {
      expect(value).not.toMatch(
        /select|pragma|sqlite|insert|update|delete|drop table|alter table|\/data\/|\.db\b/i,
      );
    }
  });
});
