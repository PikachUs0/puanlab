import {
  APP_SETTINGS_ARCHIVE_BASE_NAME,
  APP_SETTINGS_REQUIRED_COLUMNS,
  APP_SETTINGS_TABLE_NAME,
  CREATE_APP_SETTINGS_TABLE,
  CREATE_PRACTICE_EXAMS_INDEX,
  CREATE_PRACTICE_EXAMS_TABLE,
  CREATE_PRACTICE_EXAM_RESULTS_TABLE,
  PRACTICE_EXAMS_ARCHIVE_BASE_NAME,
  PRACTICE_EXAMS_INDEX_NAME,
  PRACTICE_EXAMS_REQUIRED_COLUMNS,
  PRACTICE_EXAM_RESULTS_ARCHIVE_BASE_NAME,
  PRACTICE_EXAM_RESULTS_REQUIRED_COLUMNS,
  SCHEMA_VERSION,
} from './schema';

/**
 * The minimal database surface the schema reconciliation needs. It is
 * deliberately tiny so it is satisfied by `expo-sqlite`'s `SQLiteDatabase` at
 * runtime and by an in-memory `node:sqlite` adapter in tests, without importing
 * either here.
 */
export interface SchemaExecutor {
  execAsync(sql: string): Promise<void>;
  getAllAsync<T>(sql: string): Promise<T[]>;
}

const PRACTICE_EXAMS_TABLE = 'practice_exams';
const PRACTICE_EXAM_RESULTS_TABLE = 'practice_exam_results';

export interface ExamSchemaReconciliation {
  /** Archival name the incompatible `practice_exams` was moved to, if any. */
  archivedExamsTable: string | null;
  /** Archival name the incompatible `practice_exam_results` was moved to, if any. */
  archivedResultsTable: string | null;
  createdExamsTable: boolean;
  createdResultsTable: boolean;
  createdIndex: boolean;
}

/**
 * Physical column names of `table`, or `null` when the table does not exist.
 * `PRAGMA table_info` returns no rows for a missing table, so `sqlite_master`
 * is consulted to tell "missing" apart from "exists but empty".
 */
async function tableColumns(db: SchemaExecutor, table: string): Promise<string[] | null> {
  const columns = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table});`);

  if (columns.length > 0) {
    return columns.map((column) => column.name);
  }

  const exists = await db.getAllAsync<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${table}';`,
  );

  return exists.length > 0 ? [] : null;
}

function hasAllColumns(columns: readonly string[], required: readonly string[]): boolean {
  return required.every((column) => columns.includes(column));
}

async function objectExists(db: SchemaExecutor, name: string): Promise<boolean> {
  const rows = await db.getAllAsync<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE name = '${name}';`,
  );

  return rows.length > 0;
}

/** First free archival name: `base`, then `base_2`, `base_3`, ... */
async function freeArchiveName(db: SchemaExecutor, base: string): Promise<string> {
  let candidate = base;
  let suffix = 1;

  while (await objectExists(db, candidate)) {
    suffix += 1;
    candidate = `${base}_${suffix}`;
  }

  return candidate;
}

/**
 * v4 -> v5 reconciliation of the practice exam tables. Must run inside a single
 * transaction opened by the caller (this function never opens its own, so the
 * caller's transaction can roll the whole step back on failure).
 *
 * The decision is made from the *physical* schema (`PRAGMA table_info`) rather
 * than from `PRAGMA user_version`:
 *
 * - complete normalised schema   -> left untouched, missing pieces added
 * - legacy or partial schema     -> preserved under a collision-free archival
 *                                   name, then rebuilt normalised
 *
 * No row is ever deleted or fabricated, and the database file is never
 * recreated.
 */
export async function reconcileExamSchema(
  db: SchemaExecutor,
): Promise<ExamSchemaReconciliation> {
  const reconciliation: ExamSchemaReconciliation = {
    archivedExamsTable: null,
    archivedResultsTable: null,
    createdExamsTable: false,
    createdResultsTable: false,
    createdIndex: false,
  };

  const examColumns = await tableColumns(db, PRACTICE_EXAMS_TABLE);
  const resultColumns = await tableColumns(db, PRACTICE_EXAM_RESULTS_TABLE);

  const examsExist = examColumns !== null;
  const resultsExist = resultColumns !== null;
  const examsComplete =
    examColumns !== null && hasAllColumns(examColumns, PRACTICE_EXAMS_REQUIRED_COLUMNS);
  const resultsComplete =
    resultColumns !== null && hasAllColumns(resultColumns, PRACTICE_EXAM_RESULTS_REQUIRED_COLUMNS);

  // Move the child table aside first: when the parent is rebuilt, SQLite
  // rewrites the child's foreign key to the archived parent, so the child must
  // not be left behind with a stale shape pointing at the fresh parent.
  if (resultsExist && (!examsComplete || !resultsComplete)) {
    const archivalName = await freeArchiveName(db, PRACTICE_EXAM_RESULTS_ARCHIVE_BASE_NAME);
    await db.execAsync(
      `ALTER TABLE ${PRACTICE_EXAM_RESULTS_TABLE} RENAME TO ${archivalName};`,
    );
    reconciliation.archivedResultsTable = archivalName;
  }

  if (examsExist && !examsComplete) {
    // The listing index travels with the renamed table; drop it so it can be
    // recreated on the fresh `practice_exams`.
    await db.execAsync(`DROP INDEX IF EXISTS ${PRACTICE_EXAMS_INDEX_NAME};`);

    const archivalName = await freeArchiveName(db, PRACTICE_EXAMS_ARCHIVE_BASE_NAME);
    await db.execAsync(`ALTER TABLE ${PRACTICE_EXAMS_TABLE} RENAME TO ${archivalName};`);
    reconciliation.archivedExamsTable = archivalName;
  }

  if (!examsComplete) {
    await db.execAsync(CREATE_PRACTICE_EXAMS_TABLE);
    reconciliation.createdExamsTable = true;
  }

  if (!examsComplete || !resultsComplete) {
    await db.execAsync(CREATE_PRACTICE_EXAM_RESULTS_TABLE);
    reconciliation.createdResultsTable = true;
  }

  if (!(await objectExists(db, PRACTICE_EXAMS_INDEX_NAME))) {
    await db.execAsync(CREATE_PRACTICE_EXAMS_INDEX);
    reconciliation.createdIndex = true;
  }

  return reconciliation;
}

/**
 * Startup guard. `PRAGMA user_version` is a claim; this checks the physical
 * columns so the app never runs against a broken schema. Throwing here is
 * intentional and single-shot: nothing re-runs the reconciliation, so a broken
 * database fails loudly instead of entering a migration loop.
 */
export async function assertExamSchemaReady(db: SchemaExecutor): Promise<void> {
  const examColumns = await tableColumns(db, PRACTICE_EXAMS_TABLE);
  const resultColumns = await tableColumns(db, PRACTICE_EXAM_RESULTS_TABLE);

  const missingExamColumns = PRACTICE_EXAMS_REQUIRED_COLUMNS.filter(
    (column) => !examColumns?.includes(column),
  );
  const missingResultColumns = PRACTICE_EXAM_RESULTS_REQUIRED_COLUMNS.filter(
    (column) => !resultColumns?.includes(column),
  );

  if (missingExamColumns.length === 0 && missingResultColumns.length === 0) {
    return;
  }

  const details = [
    missingExamColumns.length > 0
      ? `${PRACTICE_EXAMS_TABLE} eksik kolonlar: [${missingExamColumns.join(', ')}]`
      : null,
    missingResultColumns.length > 0
      ? `${PRACTICE_EXAM_RESULTS_TABLE} eksik kolonlar: [${missingResultColumns.join(', ')}]`
      : null,
  ].filter((entry): entry is string => entry !== null);

  throw new Error(
    `Veritabanı şeması bozuk (beklenen sürüm ${SCHEMA_VERSION}). ${details.join(' | ')}. ` +
      'Uygulama eksik şema ile başlatılamaz.',
  );
}

export interface AppSettingsReconciliation {
  /** Archival name an incompatible `app_settings` was moved to, if any. */
  archivedTable: string | null;
  createdTable: boolean;
}

/**
 * v5 -> v6 step: makes sure `app_settings` exists with the expected columns.
 * Must run inside the caller's transaction so a failure rolls the whole step
 * back (and the version stamp with it).
 *
 * The decision is made from the *physical* schema, not from
 * `PRAGMA user_version`:
 *
 * - complete table      -> left untouched
 * - missing table       -> created
 * - incompatible table  -> preserved under a collision-free archival name,
 *                          then created
 *
 * No row is ever deleted and the database file is never recreated.
 */
export async function ensureAppSettingsSchema(
  db: SchemaExecutor,
): Promise<AppSettingsReconciliation> {
  const reconciliation: AppSettingsReconciliation = {
    archivedTable: null,
    createdTable: false,
  };

  const columns = await tableColumns(db, APP_SETTINGS_TABLE_NAME);
  const isComplete =
    columns !== null && hasAllColumns(columns, APP_SETTINGS_REQUIRED_COLUMNS);

  if (isComplete) {
    return reconciliation;
  }

  if (columns !== null) {
    const archivalName = await freeArchiveName(db, APP_SETTINGS_ARCHIVE_BASE_NAME);
    await db.execAsync(`ALTER TABLE ${APP_SETTINGS_TABLE_NAME} RENAME TO ${archivalName};`);
    reconciliation.archivedTable = archivalName;
  }

  await db.execAsync(CREATE_APP_SETTINGS_TABLE);
  reconciliation.createdTable = true;

  return reconciliation;
}

/**
 * Startup guard for `app_settings`, mirroring `assertExamSchemaReady`: the
 * physical columns are verified so the app never reads or writes settings
 * against a broken schema.
 */
export async function assertAppSettingsSchemaReady(db: SchemaExecutor): Promise<void> {
  const columns = await tableColumns(db, APP_SETTINGS_TABLE_NAME);

  const missingColumns = APP_SETTINGS_REQUIRED_COLUMNS.filter(
    (column) => !columns?.includes(column),
  );

  if (missingColumns.length === 0) {
    return;
  }

  throw new Error(
    `Veritabanı şeması bozuk (beklenen sürüm ${SCHEMA_VERSION}). ` +
      `${APP_SETTINGS_TABLE_NAME} eksik kolonlar: [${missingColumns.join(', ')}].`,
  );
}
