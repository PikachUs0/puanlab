/// <reference types="node" />

import { DatabaseSync, type StatementSync } from 'node:sqlite';

import { ensureAppSettingsSchema, type SchemaExecutor } from '../migrations';
import {
  APP_SETTINGS_ARCHIVE_BASE_NAME,
  APP_SETTINGS_REQUIRED_COLUMNS,
  APP_SETTINGS_TABLE_NAME,
  CREATE_APP_SETTINGS_TABLE,
  CREATE_PRACTICE_EXAMS_TABLE,
  CREATE_PRACTICE_EXAM_RESULTS_TABLE,
  CREATE_TOPIC_PROGRESS_TABLE,
  CREATE_USER_PROFILE_TABLE,
  SCHEMA_VERSION,
} from '../schema';

/**
 * In-memory SQLite adapter that satisfies `SchemaExecutor` exactly like
 * `expo-sqlite`'s `SQLiteDatabase` does, so the v5 -> v6 step runs against a
 * real SQLite engine without touching the device database.
 */
class TestDatabase implements SchemaExecutor {
  private readonly db = new DatabaseSync(':memory:');

  async execAsync(sql: string): Promise<void> {
    this.db.exec(sql);
  }

  async getAllAsync<T>(sql: string): Promise<T[]> {
    return this.prepare(sql).all() as unknown as T[];
  }

  /** Mirrors expo-sqlite's `withTransactionAsync`: BEGIN, COMMIT, ROLLBACK. */
  async transaction(task: () => Promise<void>): Promise<void> {
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

  private prepare(sql: string): StatementSync {
    return this.db.prepare(sql);
  }

  tableNames(): string[] {
    const rows = this.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name;",
    ).all() as unknown as { name: string }[];
    return rows.map((row) => row.name);
  }

  tableExists(name: string): boolean {
    const rows = this.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?;",
    ).all(name) as unknown as { name: string }[];
    return rows.length > 0;
  }

  columnNames(table: string): string[] {
    const rows = this.prepare(`PRAGMA table_info(${table});`).all() as unknown as {
      name: string;
    }[];
    return rows.map((row) => row.name);
  }

  count(table: string): number {
    const rows = this.prepare(`SELECT COUNT(*) AS count FROM ${table};`).all() as unknown as {
      count: number;
    }[];
    return rows[0]?.count ?? 0;
  }

  getUserVersion(): number {
    const rows = this.prepare('PRAGMA user_version;').all() as unknown as {
      user_version: number;
    }[];
    return rows[0]?.user_version ?? 0;
  }

  setUserVersion(version: number): void {
    this.db.exec(`PRAGMA user_version = ${version};`);
  }
}

/** Fails while the settings table is created, to exercise the rollback path. */
class FailingDatabase extends TestDatabase {
  async execAsync(sql: string): Promise<void> {
    if (sql.includes(`CREATE TABLE IF NOT EXISTS ${APP_SETTINGS_TABLE_NAME}`)) {
      throw new Error('simulated settings failure');
    }

    return super.execAsync(sql);
  }
}

/** A populated v5 database: profile, topic progress and normalised exams. */
function createExistingData(database: TestDatabase): void {
  database.run(CREATE_USER_PROFILE_TABLE);
  database.run(CREATE_TOPIC_PROGRESS_TABLE);
  database.run(CREATE_PRACTICE_EXAMS_TABLE);
  database.run(CREATE_PRACTICE_EXAM_RESULTS_TABLE);

  database.run(
    `INSERT INTO user_profile (id, grade_level, score_type, target_department, target_university, onboarding_completed, created_at, updated_at)
     VALUES (1, 'grade_12', 'SAY', 'Bilgisayar Mühendisliği', NULL, 1, '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z');`,
  );
  database.run(
    `INSERT INTO topic_progress (topic_id, status, note, last_studied_at, updated_at)
     VALUES ('tyt_turkce_1', 'learning', 'not', NULL, '2026-01-01T00:00:00.000Z');`,
  );
  database.run(
    `INSERT INTO practice_exams (id, exam_type, score_type_snapshot, name, exam_date, total_correct, total_incorrect, total_blank, total_net, created_at, updated_at)
     VALUES ('e1', 'TYT', 'SAY', 'Deneme', '2026-01-01T00:00:00.000Z', 20, 5, 15, 18.75, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');`,
  );
  database.run(
    `INSERT INTO practice_exam_results (exam_id, lesson_id, correct, incorrect, blank, net)
     VALUES ('e1', 'tyt_turkce', 20, 5, 15, 18.75);`,
  );
}

/** Mirrors `migrateDatabase`'s v5 -> v6 step: settings + version stamp. */
async function runV5ToV6Migration(database: TestDatabase): Promise<void> {
  await database.transaction(async () => {
    await ensureAppSettingsSchema(database);
    database.setUserVersion(SCHEMA_VERSION);
  });
}

let db: TestDatabase;

beforeEach(() => {
  db = new TestDatabase();
  db.run('PRAGMA foreign_keys = ON;');
});

describe('ensureAppSettingsSchema', () => {
  it('creates app_settings with the required physical columns', async () => {
    const result = await ensureAppSettingsSchema(db);

    expect(result).toEqual({ archivedTable: null, createdTable: true });
    expect(db.tableExists(APP_SETTINGS_TABLE_NAME)).toBe(true);
    expect(db.columnNames(APP_SETTINGS_TABLE_NAME)).toEqual(
      expect.arrayContaining([...APP_SETTINGS_REQUIRED_COLUMNS]),
    );
  });

  it('leaves an already-correct app_settings table intact', async () => {
    db.run(CREATE_APP_SETTINGS_TABLE);
    db.run(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES ('theme_preference', 'dark', '2026-01-01T00:00:00.000Z');`,
    );

    const result = await ensureAppSettingsSchema(db);

    expect(result).toEqual({ archivedTable: null, createdTable: false });
    expect(db.count(APP_SETTINGS_TABLE_NAME)).toBe(1);
  });

  it('archives an incompatible app_settings table instead of keeping a broken shape', async () => {
    db.run(`CREATE TABLE app_settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);`);

    const result = await ensureAppSettingsSchema(db);

    expect(result.archivedTable).toBe(APP_SETTINGS_ARCHIVE_BASE_NAME);
    expect(db.tableExists(APP_SETTINGS_ARCHIVE_BASE_NAME)).toBe(true);
    expect(db.columnNames(APP_SETTINGS_TABLE_NAME)).toEqual(
      expect.arrayContaining([...APP_SETTINGS_REQUIRED_COLUMNS]),
    );
  });

  it('is idempotent when it runs twice', async () => {
    await ensureAppSettingsSchema(db);
    const tablesAfterFirstRun = db.tableNames();

    const second = await ensureAppSettingsSchema(db);

    expect(second).toEqual({ archivedTable: null, createdTable: false });
    expect(db.tableNames()).toEqual(tablesAfterFirstRun);
    expect(db.tableExists(`${APP_SETTINGS_ARCHIVE_BASE_NAME}_2`)).toBe(false);
  });
});

describe('v5 -> v6 migration', () => {
  it('stamps user_version = 6 only after the settings table exists', async () => {
    expect(SCHEMA_VERSION).toBe(6);

    db.setUserVersion(5);

    await ensureAppSettingsSchema(db);
    expect(db.getUserVersion()).toBe(5);

    await runV5ToV6Migration(db);
    expect(db.getUserVersion()).toBe(SCHEMA_VERSION);
    expect(db.tableExists(APP_SETTINGS_TABLE_NAME)).toBe(true);
  });

  it('preserves existing profile data', async () => {
    createExistingData(db);
    const before = await db.getAllAsync('SELECT * FROM user_profile;');

    db.setUserVersion(5);
    await runV5ToV6Migration(db);

    expect(await db.getAllAsync('SELECT * FROM user_profile;')).toEqual(before);
  });

  it('preserves existing topic progress', async () => {
    createExistingData(db);
    const before = await db.getAllAsync('SELECT * FROM topic_progress;');

    db.setUserVersion(5);
    await runV5ToV6Migration(db);

    expect(await db.getAllAsync('SELECT * FROM topic_progress;')).toEqual(before);
  });

  it('preserves existing exams and their result rows', async () => {
    createExistingData(db);
    const beforeExams = await db.getAllAsync('SELECT * FROM practice_exams;');
    const beforeResults = await db.getAllAsync('SELECT * FROM practice_exam_results;');

    db.setUserVersion(5);
    await runV5ToV6Migration(db);

    expect(await db.getAllAsync('SELECT * FROM practice_exams;')).toEqual(beforeExams);
    expect(await db.getAllAsync('SELECT * FROM practice_exam_results;')).toEqual(beforeResults);
  });

  it('is idempotent when initialisation runs twice', async () => {
    createExistingData(db);
    db.setUserVersion(5);

    await runV5ToV6Migration(db);
    const tablesAfterFirstRun = db.tableNames();

    await runV5ToV6Migration(db);

    expect(db.getUserVersion()).toBe(SCHEMA_VERSION);
    expect(db.tableNames()).toEqual(tablesAfterFirstRun);
    expect(db.tableExists(`${APP_SETTINGS_ARCHIVE_BASE_NAME}_2`)).toBe(false);
  });

  it('rolls back the settings table and the version stamp when the migration fails', async () => {
    const failing = new FailingDatabase();
    failing.setUserVersion(5);

    await expect(
      failing.transaction(async () => {
        await ensureAppSettingsSchema(failing);
        failing.setUserVersion(SCHEMA_VERSION);
      }),
    ).rejects.toThrow(/simulated settings failure/);

    expect(failing.getUserVersion()).toBe(5);
    expect(failing.tableExists(APP_SETTINGS_TABLE_NAME)).toBe(false);
  });
});
