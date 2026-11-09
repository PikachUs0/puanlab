/// <reference types="node" />

import { DatabaseSync, type StatementSync } from 'node:sqlite';

import { assertExamSchemaReady, reconcileExamSchema, type SchemaExecutor } from '../migrations';
import {
  CREATE_PRACTICE_EXAMS_INDEX,
  CREATE_PRACTICE_EXAMS_TABLE,
  CREATE_PRACTICE_EXAM_RESULTS_TABLE,
  CREATE_TOPIC_PROGRESS_TABLE,
  CREATE_USER_PROFILE_TABLE,
  PRACTICE_EXAMS_INDEX_NAME,
  PRACTICE_EXAMS_REQUIRED_COLUMNS,
  PRACTICE_EXAM_RESULTS_REQUIRED_COLUMNS,
  SCHEMA_VERSION,
} from '../schema';

/**
 * In-memory SQLite adapter that satisfies `SchemaExecutor` exactly like
 * `expo-sqlite`'s `SQLiteDatabase` does, so the reconciliation is exercised
 * against a real SQLite engine without touching the device database.
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
    const rows = this.prepare('SELECT name FROM sqlite_master WHERE name = ?;').all(
      name,
    ) as unknown as { name: string }[];
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

/** Fails while the reconciliation creates the listing index. */
class FailingDatabase extends TestDatabase {
  async execAsync(sql: string): Promise<void> {
    if (sql.includes('CREATE INDEX')) {
      throw new Error('simulated index failure');
    }

    return super.execAsync(sql);
  }
}

function createLegacyExamTable(database: TestDatabase): void {
  database.run(`
    CREATE TABLE practice_exams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      exam_type TEXT NOT NULL,
      exam_date INTEGER NOT NULL,
      correct INTEGER NOT NULL,
      incorrect INTEGER NOT NULL,
      net REAL NOT NULL
    );
  `);
}

function createPartialExamTable(database: TestDatabase): void {
  database.run(`
    CREATE TABLE practice_exams (
      id TEXT PRIMARY KEY NOT NULL,
      exam_type TEXT NOT NULL,
      score_type_snapshot TEXT NOT NULL,
      name TEXT NOT NULL
    );
  `);
}

function createPartialResultsTable(database: TestDatabase): void {
  database.run(`
    CREATE TABLE practice_exam_results (
      exam_id TEXT NOT NULL,
      lesson_id TEXT NOT NULL
    );
  `);
}

function createNormalizedSchema(database: TestDatabase): void {
  database.run(CREATE_PRACTICE_EXAMS_TABLE);
  database.run(CREATE_PRACTICE_EXAM_RESULTS_TABLE);
  database.run(CREATE_PRACTICE_EXAMS_INDEX);
}

function createUnrelatedTables(database: TestDatabase): void {
  database.run(CREATE_USER_PROFILE_TABLE);
  database.run(CREATE_TOPIC_PROGRESS_TABLE);
  database.run(
    `INSERT INTO user_profile (id, grade_level, score_type, target_department, target_university, onboarding_completed, created_at, updated_at)
     VALUES (1, '12', 'SAY', 'Bilgisayar Mühendisliği', NULL, 1, '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z');`,
  );
  database.run(
    `INSERT INTO topic_progress (topic_id, status, note, last_studied_at, updated_at)
     VALUES ('tyt_turkce_1', 'learning', 'not', NULL, '2026-01-01T00:00:00.000Z');`,
  );
}

/** Mirrors `migrateDatabase`'s v4 -> v5 step: reconciliation + version stamp. */
async function runV4ToV5Migration(database: TestDatabase): Promise<void> {
  await database.transaction(async () => {
    await reconcileExamSchema(database);
    database.setUserVersion(SCHEMA_VERSION);
  });
}

let db: TestDatabase;

beforeEach(() => {
  db = new TestDatabase();
  db.run('PRAGMA foreign_keys = ON;');
});

describe('reconcileExamSchema', () => {
  it('creates the complete normalised exam schema on a fresh database', async () => {
    const result = await reconcileExamSchema(db);

    expect(result).toEqual({
      archivedExamsTable: null,
      archivedResultsTable: null,
      createdExamsTable: true,
      createdResultsTable: true,
      createdIndex: true,
    });
    expect(db.columnNames('practice_exams')).toEqual(
      expect.arrayContaining([...PRACTICE_EXAMS_REQUIRED_COLUMNS]),
    );
    expect(db.columnNames('practice_exam_results')).toEqual(
      expect.arrayContaining([...PRACTICE_EXAM_RESULTS_REQUIRED_COLUMNS]),
    );
    expect(db.indexExists(PRACTICE_EXAMS_INDEX_NAME)).toBe(true);
    await expect(assertExamSchemaReady(db)).resolves.toBeUndefined();
  });

  it('archives a legacy minimal practice_exams and replaces it', async () => {
    createLegacyExamTable(db);

    const result = await reconcileExamSchema(db);

    expect(result.archivedExamsTable).toBe('practice_exams_legacy_v3');
    expect(db.tableExists('practice_exams_legacy_v3')).toBe(true);
    const examColumns = db.columnNames('practice_exams');
    expect(examColumns).toEqual(expect.arrayContaining([...PRACTICE_EXAMS_REQUIRED_COLUMNS]));
    expect(examColumns).not.toContain('correct');
  });

  it('preserves every row of the archived legacy table', async () => {
    createLegacyExamTable(db);
    db.run(
      `INSERT INTO practice_exams (exam_type, exam_date, correct, incorrect, net)
       VALUES ('TYT', 1000, 20, 5, 18.75), ('AYT', 2000, 30, 2, 29.5);`,
    );

    await reconcileExamSchema(db);

    expect(db.count('practice_exams_legacy_v3')).toBe(2);
    expect(db.count('practice_exams')).toBe(0);
    const rows = await db.getAllAsync<{ exam_type: string; correct: number }>(
      'SELECT exam_type, correct FROM practice_exams_legacy_v3 ORDER BY id;',
    );
    expect(rows).toEqual([
      { exam_type: 'TYT', correct: 20 },
      { exam_type: 'AYT', correct: 30 },
    ]);
  });

  it('leaves an already-correct normalised schema intact', async () => {
    createNormalizedSchema(db);
    db.run(
      `INSERT INTO practice_exams (id, exam_type, score_type_snapshot, name, exam_date, total_correct, total_incorrect, total_blank, total_net, created_at, updated_at)
       VALUES ('e1', 'TYT', 'SAY', 'Deneme', '2026-01-01T00:00:00.000Z', 20, 5, 15, 18.75, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');`,
    );

    const result = await reconcileExamSchema(db);

    expect(result.archivedExamsTable).toBeNull();
    expect(result.archivedResultsTable).toBeNull();
    expect(result.createdExamsTable).toBe(false);
    expect(result.createdResultsTable).toBe(false);
    expect(result.createdIndex).toBe(false);
    expect(db.count('practice_exams')).toBe(1);
    expect(db.tableExists('practice_exams_legacy_v3')).toBe(false);
  });

  it('archives a partially migrated schema safely', async () => {
    createPartialExamTable(db);
    createPartialResultsTable(db);
    db.run(
      `INSERT INTO practice_exams (id, exam_type, score_type_snapshot, name)
       VALUES ('e1', 'TYT', 'SAY', 'Deneme');`,
    );
    db.run(`INSERT INTO practice_exam_results (exam_id, lesson_id) VALUES ('e1', 'tyt_turkce');`);

    const result = await reconcileExamSchema(db);

    expect(result.archivedExamsTable).toBe('practice_exams_legacy_v3');
    expect(result.archivedResultsTable).toBe('practice_exam_results_legacy_v3');
    expect(db.count('practice_exams_legacy_v3')).toBe(1);
    expect(db.count('practice_exam_results_legacy_v3')).toBe(1);
    expect(db.columnNames('practice_exams')).toEqual(
      expect.arrayContaining([...PRACTICE_EXAMS_REQUIRED_COLUMNS]),
    );
    expect(db.columnNames('practice_exam_results')).toEqual(
      expect.arrayContaining([...PRACTICE_EXAM_RESULTS_REQUIRED_COLUMNS]),
    );
  });

  it('picks a deterministic archive name when the preferred one is taken', async () => {
    createLegacyExamTable(db);
    db.run('ALTER TABLE practice_exams RENAME TO practice_exams_legacy_v3;');
    createLegacyExamTable(db);

    const result = await reconcileExamSchema(db);

    expect(result.archivedExamsTable).toBe('practice_exams_legacy_v3_2');
    expect(db.count('practice_exams_legacy_v3')).toBe(0);
    expect(db.tableExists('practice_exams_legacy_v3_2')).toBe(true);
  });

  it('ensures practice_exam_results exists after migration', async () => {
    createLegacyExamTable(db);

    await reconcileExamSchema(db);

    expect(db.tableExists('practice_exam_results')).toBe(true);
    expect(db.columnNames('practice_exam_results')).toEqual(
      expect.arrayContaining([...PRACTICE_EXAM_RESULTS_REQUIRED_COLUMNS]),
    );
  });

  it('ensures the score_type_snapshot column exists after migration', async () => {
    createLegacyExamTable(db);

    await reconcileExamSchema(db);

    expect(db.columnNames('practice_exams')).toContain('score_type_snapshot');
  });

  it('leaves user_profile untouched', async () => {
    createUnrelatedTables(db);
    createLegacyExamTable(db);
    const before = await db.getAllAsync('SELECT * FROM user_profile;');

    await reconcileExamSchema(db);

    const after = await db.getAllAsync('SELECT * FROM user_profile;');
    expect(after).toEqual(before);
  });

  it('leaves topic_progress untouched', async () => {
    createUnrelatedTables(db);
    createLegacyExamTable(db);
    const before = await db.getAllAsync('SELECT * FROM topic_progress;');

    await reconcileExamSchema(db);

    const after = await db.getAllAsync('SELECT * FROM topic_progress;');
    expect(after).toEqual(before);
  });
});

describe('v4 -> v5 migration', () => {
  it('stamps user_version = 5 only after a successful migration', async () => {
    db.setUserVersion(4);
    createLegacyExamTable(db);

    await reconcileExamSchema(db);
    expect(db.getUserVersion()).toBe(4);

    await runV4ToV5Migration(db);
    expect(db.getUserVersion()).toBe(SCHEMA_VERSION);
  });

  it('is idempotent when initialisation runs twice', async () => {
    db.setUserVersion(4);
    createLegacyExamTable(db);

    await runV4ToV5Migration(db);
    const archivesAfterFirstRun = db
      .tableNames()
      .filter((name) => name.startsWith('practice_exams_legacy'));

    await runV4ToV5Migration(db);

    expect(db.getUserVersion()).toBe(SCHEMA_VERSION);
    expect(
      db.tableNames().filter((name) => name.startsWith('practice_exams_legacy')),
    ).toEqual(archivesAfterFirstRun);
    expect(db.tableExists('practice_exams_legacy_v3_2')).toBe(false);
  });

  it('rolls back fully when the migration fails', async () => {
    const failing = new FailingDatabase();
    failing.run('PRAGMA foreign_keys = ON;');
    failing.setUserVersion(4);
    createLegacyExamTable(failing);
    failing.run(
      `INSERT INTO practice_exams (exam_type, exam_date, correct, incorrect, net)
       VALUES ('TYT', 1000, 20, 5, 18.75);`,
    );

    await expect(
      failing.transaction(async () => {
        await reconcileExamSchema(failing);
        failing.setUserVersion(SCHEMA_VERSION);
      }),
    ).rejects.toThrow(/simulated index failure/);

    expect(failing.getUserVersion()).toBe(4);
    expect(failing.columnNames('practice_exams')).not.toContain('score_type_snapshot');
    expect(failing.tableExists('practice_exams_legacy_v3')).toBe(false);
    expect(failing.tableExists('practice_exam_results')).toBe(false);
    expect(failing.count('practice_exams')).toBe(1);
  });
});

describe('assertExamSchemaReady', () => {
  it('throws a clear error when the schema is incomplete', async () => {
    createLegacyExamTable(db);

    await expect(assertExamSchemaReady(db)).rejects.toThrow(
      /score_type_snapshot|practice_exams/,
    );
  });
});
