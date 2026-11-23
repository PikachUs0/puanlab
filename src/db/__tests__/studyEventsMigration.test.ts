/// <reference types="node" />

import { DatabaseSync, type StatementSync } from 'node:sqlite';

import {
  assertStudyEventsSchemaReady,
  ensureStudyEventsSchema,
  type SchemaExecutor,
} from '../migrations';
import {
  CREATE_APP_SETTINGS_TABLE,
  CREATE_PRACTICE_EXAMS_TABLE,
  CREATE_PRACTICE_EXAM_RESULTS_TABLE,
  CREATE_STUDY_EVENTS_TABLE,
  CREATE_TOPIC_PROGRESS_TABLE,
  CREATE_USER_PROFILE_TABLE,
  SCHEMA_VERSION,
  STUDY_EVENTS_OCCURRED_AT_INDEX_NAME,
  STUDY_EVENTS_REQUIRED_COLUMNS,
  STUDY_EVENTS_TABLE_NAME,
  STUDY_EVENTS_TOPIC_OCCURRED_AT_INDEX_NAME,
} from '../schema';

/**
 * In-memory SQLite adapter that satisfies `SchemaExecutor` exactly like
 * `expo-sqlite`'s `SQLiteDatabase` does, so the v6 -> v7 step runs against a
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

  indexExists(name: string): boolean {
    const rows = this.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?;",
    ).all(name) as unknown as { name: string }[];
    return rows.length > 0;
  }

  /** Column names of an index, in index order (`PRAGMA index_info`). */
  indexColumns(name: string): string[] {
    const rows = this.prepare(`PRAGMA index_info(${name});`).all() as unknown as {
      name: string;
    }[];
    return rows.map((row) => row.name);
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

/** Fails while the study_events table is created, to exercise rollback. */
class FailingDatabase extends TestDatabase {
  async execAsync(sql: string): Promise<void> {
    if (sql.includes(`CREATE TABLE IF NOT EXISTS ${STUDY_EVENTS_TABLE_NAME}`)) {
      throw new Error('simulated study events failure');
    }

    return super.execAsync(sql);
  }
}

/** A populated v6 database: profile, progress, exams and settings. */
function createExistingData(database: TestDatabase): void {
  database.run(CREATE_USER_PROFILE_TABLE);
  database.run(CREATE_TOPIC_PROGRESS_TABLE);
  database.run(CREATE_PRACTICE_EXAMS_TABLE);
  database.run(CREATE_PRACTICE_EXAM_RESULTS_TABLE);
  database.run(CREATE_APP_SETTINGS_TABLE);

  database.run(
    `INSERT INTO user_profile (id, grade_level, score_type, target_department, target_university, onboarding_completed, created_at, updated_at)
     VALUES (1, 'grade_12', 'SAY', 'Bilgisayar Mühendisliği', NULL, 1, '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z');`,
  );
  database.run(
    `INSERT INTO topic_progress (topic_id, status, note, last_studied_at, updated_at)
     VALUES ('tyt_turkce_1', 'learning', 'not', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');`,
  );
  database.run(
    `INSERT INTO practice_exams (id, exam_type, score_type_snapshot, name, exam_date, total_correct, total_incorrect, total_blank, total_net, created_at, updated_at)
     VALUES ('e1', 'TYT', 'SAY', 'Deneme', '2026-01-01T00:00:00.000Z', 20, 5, 15, 18.75, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');`,
  );
  database.run(
    `INSERT INTO practice_exam_results (exam_id, lesson_id, correct, incorrect, blank, net)
     VALUES ('e1', 'tyt_turkce', 20, 5, 15, 18.75);`,
  );
  database.run(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ('theme_preference', 'dark', '2026-01-01T00:00:00.000Z');`,
  );
}

/** Mirrors `migrateDatabase`'s v6 -> v7 step: table + version stamp. */
async function runV6ToV7Migration(database: TestDatabase): Promise<void> {
  await database.transaction(async () => {
    await ensureStudyEventsSchema(database);
    database.setUserVersion(SCHEMA_VERSION);
  });
}

let db: TestDatabase;

beforeEach(() => {
  db = new TestDatabase();
  db.run('PRAGMA foreign_keys = ON;');
});

describe('ensureStudyEventsSchema', () => {
  it('creates study_events with the required physical columns on a fresh schema', async () => {
    const result = await ensureStudyEventsSchema(db);

    expect(result).toEqual({ archivedTable: null, createdTable: true, createdIndexes: true });
    expect(db.tableExists(STUDY_EVENTS_TABLE_NAME)).toBe(true);
    expect(db.columnNames(STUDY_EVENTS_TABLE_NAME)).toEqual([
      ...STUDY_EVENTS_REQUIRED_COLUMNS,
    ]);
    await expect(assertStudyEventsSchemaReady(db)).resolves.toBeUndefined();
  });

  it('creates both justified indexes in the right column order', async () => {
    await ensureStudyEventsSchema(db);

    expect(db.indexExists(STUDY_EVENTS_TOPIC_OCCURRED_AT_INDEX_NAME)).toBe(true);
    expect(db.indexExists(STUDY_EVENTS_OCCURRED_AT_INDEX_NAME)).toBe(true);
    expect(db.indexColumns(STUDY_EVENTS_TOPIC_OCCURRED_AT_INDEX_NAME)).toEqual([
      'topic_id',
      'occurred_at',
    ]);
    expect(db.indexColumns(STUDY_EVENTS_OCCURRED_AT_INDEX_NAME)).toEqual(['occurred_at']);
  });

  it('is idempotent when it runs twice', async () => {
    await ensureStudyEventsSchema(db);
    const tablesAfterFirstRun = db.tableNames();

    const second = await ensureStudyEventsSchema(db);

    expect(second).toEqual({ archivedTable: null, createdTable: false, createdIndexes: false });
    expect(db.tableNames()).toEqual(tablesAfterFirstRun);
    expect(db.tableExists(`${STUDY_EVENTS_TABLE_NAME}_legacy_v6`)).toBe(false);
  });
});

describe('v6 -> v7 migration', () => {
  it('stamps user_version = 7 only after the study_events table exists', async () => {
    expect(SCHEMA_VERSION).toBe(7);
    db.setUserVersion(6);

    await ensureStudyEventsSchema(db);
    expect(db.getUserVersion()).toBe(6);

    await runV6ToV7Migration(db);
    expect(db.getUserVersion()).toBe(7);
    expect(db.tableExists(STUDY_EVENTS_TABLE_NAME)).toBe(true);
  });

  it('preserves existing profile, topic, exam and settings data without backfilling events', async () => {
    createExistingData(db);
    const beforeProfile = await db.getAllAsync('SELECT * FROM user_profile;');
    const beforeTopics = await db.getAllAsync('SELECT * FROM topic_progress;');
    const beforeExams = await db.getAllAsync('SELECT * FROM practice_exams;');
    const beforeResults = await db.getAllAsync('SELECT * FROM practice_exam_results;');
    const beforeSettings = await db.getAllAsync('SELECT * FROM app_settings;');

    db.setUserVersion(6);
    await runV6ToV7Migration(db);

    expect(await db.getAllAsync('SELECT * FROM user_profile;')).toEqual(beforeProfile);
    expect(await db.getAllAsync('SELECT * FROM topic_progress;')).toEqual(beforeTopics);
    expect(await db.getAllAsync('SELECT * FROM practice_exams;')).toEqual(beforeExams);
    expect(await db.getAllAsync('SELECT * FROM practice_exam_results;')).toEqual(beforeResults);
    expect(await db.getAllAsync('SELECT * FROM app_settings;')).toEqual(beforeSettings);
    // `last_studied_at` is NOT turned into a historical event.
    expect(db.count(STUDY_EVENTS_TABLE_NAME)).toBe(0);
  });

  it('archives an incompatible study_events table and rebuilds the correct shape', async () => {
    db.run(`CREATE TABLE study_events (id TEXT PRIMARY KEY NOT NULL, topic_id TEXT NOT NULL);`);
    db.run(
      `INSERT INTO study_events (id, topic_id) VALUES ('old', 'tyt_turkce_1');`,
    );

    const result = await ensureStudyEventsSchema(db);

    expect(result.archivedTable).toBe('study_events_legacy_v6');
    expect(db.count('study_events_legacy_v6')).toBe(1);
    expect(db.columnNames(STUDY_EVENTS_TABLE_NAME)).toEqual([
      ...STUDY_EVENTS_REQUIRED_COLUMNS,
    ]);
    expect(db.indexExists(STUDY_EVENTS_TOPIC_OCCURRED_AT_INDEX_NAME)).toBe(true);
  });

  it('rolls back the table and the version stamp when the migration fails', async () => {
    const failing = new FailingDatabase();
    failing.setUserVersion(6);

    await expect(
      failing.transaction(async () => {
        await ensureStudyEventsSchema(failing);
        failing.setUserVersion(SCHEMA_VERSION);
      }),
    ).rejects.toThrow(/simulated study events failure/);

    expect(failing.getUserVersion()).toBe(6);
    expect(failing.tableExists(STUDY_EVENTS_TABLE_NAME)).toBe(false);
  });

  it('is idempotent when initialisation runs twice', async () => {
    createExistingData(db);
    db.setUserVersion(6);

    await runV6ToV7Migration(db);
    const tablesAfterFirstRun = db.tableNames();

    await runV6ToV7Migration(db);

    expect(db.getUserVersion()).toBe(7);
    expect(db.tableNames()).toEqual(tablesAfterFirstRun);
    expect(db.tableExists('study_events_legacy_v6')).toBe(false);
    expect(db.count(STUDY_EVENTS_TABLE_NAME)).toBe(0);
  });
});

describe('assertStudyEventsSchemaReady', () => {
  it('throws a clear error when the table is missing or incomplete', async () => {
    await expect(assertStudyEventsSchemaReady(db)).rejects.toThrow(
      /study_events|Veritabanı şeması/,
    );

    db.run(CREATE_STUDY_EVENTS_TABLE);
    await expect(assertStudyEventsSchemaReady(db)).resolves.toBeUndefined();
  });
});
