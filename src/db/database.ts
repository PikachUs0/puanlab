import * as SQLite from 'expo-sqlite';

import {
  assertAppSettingsSchemaReady,
  assertExamSchemaReady,
  ensureAppSettingsSchema,
  reconcileExamSchema,
} from './migrations';
import {
  CREATE_TOPIC_PROGRESS_TABLE,
  CREATE_USER_PROFILE_TABLE,
  DATABASE_NAME,
  MIGRATION_PRACTICE_EXAMS_NORMALIZED,
  MIGRATION_TOPIC_PROGRESS_ISO_TIMESTAMPS,
  MIGRATION_USER_PROFILE_ISO_TIMESTAMPS,
  PRACTICE_EXAMS_LEGACY_TABLE_NAME,
  SCHEMA_VERSION,
} from './schema';

let database: SQLite.SQLiteDatabase | null = null;

/** Opens the single application connection once and reuses it afterwards. */
export async function openDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (database) {
    return database;
  }

  database = await SQLite.openDatabaseAsync(DATABASE_NAME);
  return database;
}

/** Returns the initialized connection. Throws if `initializeDatabase` has not run. */
export function getDatabase(): SQLite.SQLiteDatabase {
  if (!database) {
    throw new Error('Database is not initialized. Call initializeDatabase() first.');
  }

  return database;
}

export async function getSchemaVersion(db: SQLite.SQLiteDatabase): Promise<number> {
  const result = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version;');
  return result?.user_version ?? 0;
}

/**
 * Brings an existing database up to `SCHEMA_VERSION` without losing data.
 * Every step and the version stamp run in one transaction, so a failure rolls
 * back instead of leaving the schema half-applied. Migration steps are selected
 * from the recorded version, and the v4 -> v5 and v5 -> v6 steps additionally
 * inspect the physical table columns, so a database that claimed an older
 * version while keeping an incompatible table shape is repaired.
 */
async function migrateDatabase(db: SQLite.SQLiteDatabase, fromVersion: number): Promise<void> {
  await db.withTransactionAsync(async () => {
    if (fromVersion < 2) {
      await db.execAsync(MIGRATION_TOPIC_PROGRESS_ISO_TIMESTAMPS);
    }

    if (fromVersion < 3) {
      await db.execAsync(MIGRATION_USER_PROFILE_ISO_TIMESTAMPS);
    }

    if (fromVersion < 4) {
      // The pre-v4 practice_exams shape cannot become a complete PracticeExam
      // without inventing data. Preserve its rows by renaming the table aside,
      // then create the normalised tables. Legacy rows stay on disk but are
      // excluded from repository reads until they can be converted safely.
      const legacyTable = await db.getFirstAsync<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'practice_exams';`,
      );

      if (legacyTable) {
        await db.execAsync(
          `ALTER TABLE practice_exams RENAME TO ${PRACTICE_EXAMS_LEGACY_TABLE_NAME};`,
        );
      }

      await db.execAsync(MIGRATION_PRACTICE_EXAMS_NORMALIZED);
    }

    if (fromVersion < 5) {
      // Repair the version/table-shape mismatch: a database could reach
      // user_version 4 while practice_exams kept its pre-v4 columns, because
      // `CREATE TABLE IF NOT EXISTS` never modifies an existing table. Decide
      // from the physical schema and archive anything incompatible instead of
      // guessing at missing data.
      await reconcileExamSchema(db);
    }

    if (fromVersion < 6) {
      // Adds the `app_settings` key/value table. Like the exam step, the
      // decision comes from the physical schema, so a database whose table is
      // missing (or has the wrong shape) is repaired before the version stamp.
      await ensureAppSettingsSchema(db);
    }

    await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION};`);
  });
}

/**
 * Creates the schema on a fresh install, or migrates an existing database
 * forward. The database file is never deleted or recreated.
 */
export async function initializeDatabase(): Promise<SQLite.SQLiteDatabase> {
  const db = await openDatabase();

  await db.execAsync('PRAGMA journal_mode = WAL;');
  await db.execAsync('PRAGMA foreign_keys = ON;');

  const currentVersion = await getSchemaVersion(db);

  if (currentVersion === 0) {
    await db.withTransactionAsync(async () => {
      await db.execAsync(CREATE_USER_PROFILE_TABLE);
      await db.execAsync(CREATE_TOPIC_PROGRESS_TABLE);
      // The exam tables are created through the reconciliation so a leftover
      // pre-v4 `practice_exams` is archived rather than silently kept by
      // `CREATE TABLE IF NOT EXISTS`.
      await reconcileExamSchema(db);
      // The settings table is created the same way, so a partially written
      // table from an interrupted first run is archived instead of kept broken.
      await ensureAppSettingsSchema(db);
      await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION};`);
    });
  } else if (currentVersion < SCHEMA_VERSION) {
    await migrateDatabase(db, currentVersion);
  } else if (currentVersion === SCHEMA_VERSION) {
    // `PRAGMA user_version` is only a claim. A database can already be stamped
    // at the current version while a table this version owns is physically
    // missing or has the wrong shape: an earlier build stamped the version
    // before the table existed, or a previous run was interrupted between the
    // two steps. Re-running the (idempotent, non-destructive) reconciliation
    // repairs such a database in place, instead of hard-failing the startup
    // assert on every single launch and leaving the app permanently unusable.
    await db.withTransactionAsync(async () => {
      await reconcileExamSchema(db);
      await ensureAppSettingsSchema(db);
    });
  }
  // A newer `user_version` (a downgrade) is left untouched and only verified.

  // Never trust `PRAGMA user_version` alone: verify the physical table columns
  // before the app is allowed to read or write its local data.
  await assertExamSchemaReady(db);
  await assertAppSettingsSchemaReady(db);

  return db;
}
