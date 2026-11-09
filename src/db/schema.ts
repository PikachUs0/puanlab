export const DATABASE_NAME = 'puanlab.db';

/**
 * Current schema version, stored in SQLite's `user_version` pragma.
 * Increment this when the schema changes and add the matching migration
 * step in `database.ts`.
 *
 * 1 -> 2: `topic_progress` timestamps moved from Unix epoch milliseconds
 *         (INTEGER) to ISO 8601 strings (TEXT).
 * 2 -> 3: `user_profile` timestamps moved from Unix epoch milliseconds
 *         (INTEGER) to ISO 8601 strings (TEXT).
 * 3 -> 4: `practice_exams` normalised (TEXT id, score type snapshot, name,
 *         totals, ISO 8601 dates) plus a `practice_exam_results` child table.
 *         The pre-v4 `practice_exams` table is renamed to
 *         `practice_exams_legacy` so its rows are preserved.
 * 4 -> 5: reconciliation of the practice exam tables. A database could report
 *         `user_version = 4` while `practice_exams` still had its pre-v4 shape:
 *         the fresh-install path used `CREATE TABLE IF NOT EXISTS` (which never
 *         changes an existing table) and stamped the version without inspecting
 *         the physical columns, and the v3 -> v4 step was selected from the
 *         version alone. The v4 -> v5 step inspects `PRAGMA table_info(...)`,
 *         archives any legacy/partial exam table under a collision-free
 *         `practice_exams_legacy_v3` name (preserving every row) and rebuilds
 *         the normalised tables before the version is stamped.
 * 5 -> 6: adds the `app_settings` key/value table used for local settings such
 *         as the saved theme preference. It is created inside the same
 *         transaction as the version stamp and its physical columns are
 *         verified, so an existing database only advances to 6 once the table
 *         really exists.
 */
export const SCHEMA_VERSION = 6;

export const CREATE_USER_PROFILE_TABLE = `
CREATE TABLE IF NOT EXISTS user_profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  grade_level TEXT NOT NULL,
  score_type TEXT NOT NULL,
  target_department TEXT,
  target_university TEXT,
  onboarding_completed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

export const CREATE_TOPIC_PROGRESS_TABLE = `
CREATE TABLE IF NOT EXISTS topic_progress (
  topic_id TEXT PRIMARY KEY NOT NULL,
  status TEXT NOT NULL,
  note TEXT,
  last_studied_at TEXT,
  updated_at TEXT NOT NULL
);
`;

export const CREATE_PRACTICE_EXAMS_TABLE = `
CREATE TABLE IF NOT EXISTS practice_exams (
  id TEXT PRIMARY KEY NOT NULL,
  exam_type TEXT NOT NULL,
  score_type_snapshot TEXT NOT NULL,
  name TEXT NOT NULL,
  exam_date TEXT NOT NULL,
  total_correct INTEGER NOT NULL,
  total_incorrect INTEGER NOT NULL,
  total_blank INTEGER NOT NULL,
  total_net REAL NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

/**
 * Per-section results of a practice exam. `exam_id` references `practice_exams`
 * and cascades on delete, so removing an exam removes its sections.
 */
export const CREATE_PRACTICE_EXAM_RESULTS_TABLE = `
CREATE TABLE IF NOT EXISTS practice_exam_results (
  exam_id TEXT NOT NULL,
  lesson_id TEXT NOT NULL,
  correct INTEGER NOT NULL,
  incorrect INTEGER NOT NULL,
  blank INTEGER NOT NULL,
  net REAL NOT NULL,
  PRIMARY KEY (exam_id, lesson_id),
  FOREIGN KEY (exam_id) REFERENCES practice_exams (id) ON DELETE CASCADE
);
`;

/**
 * Supports the newest-first listing used by the exam repository.
 * The `(exam_id, lesson_id)` primary key already indexes result lookups by
 * exam, so no extra index is added to `practice_exam_results`.
 */
export const PRACTICE_EXAMS_INDEX_NAME = 'idx_practice_exams_exam_date';

export const CREATE_PRACTICE_EXAMS_INDEX = `
CREATE INDEX IF NOT EXISTS ${PRACTICE_EXAMS_INDEX_NAME}
  ON practice_exams (exam_date DESC, updated_at DESC, id DESC);
`;

/**
 * Columns the normalised `practice_exams` / `practice_exam_results` tables must
 * physically contain. The reconciliation migration compares these against
 * `PRAGMA table_info(...)` so a table's shape — not just `PRAGMA user_version`
 * — decides whether a database is complete.
 */
export const PRACTICE_EXAMS_REQUIRED_COLUMNS: readonly string[] = [
  'id',
  'exam_type',
  'score_type_snapshot',
  'name',
  'exam_date',
  'total_correct',
  'total_incorrect',
  'total_blank',
  'total_net',
  'created_at',
  'updated_at',
];

export const PRACTICE_EXAM_RESULTS_REQUIRED_COLUMNS: readonly string[] = [
  'exam_id',
  'lesson_id',
  'correct',
  'incorrect',
  'blank',
  'net',
];

/**
 * Base names the v4 -> v5 reconciliation renames an incompatible
 * `practice_exams` / `practice_exam_results` table to. When a base name is
 * already taken a deterministic numeric suffix (`_2`, `_3`, ...) is appended,
 * so an existing archival table — and none of its rows — is never overwritten.
 */
export const PRACTICE_EXAMS_ARCHIVE_BASE_NAME = 'practice_exams_legacy_v3';
export const PRACTICE_EXAM_RESULTS_ARCHIVE_BASE_NAME = 'practice_exam_results_legacy_v3';

/**
 * v1 -> v2 migration for `topic_progress`.
 *
 * SQLite cannot change a column's declared type, so the table is rebuilt:
 * existing rows are copied into the new table (converting Unix epoch
 * milliseconds into ISO 8601 strings with `strftime`) before the old table is
 * dropped. No row is deleted and the database file is never recreated.
 */
export const MIGRATION_TOPIC_PROGRESS_ISO_TIMESTAMPS = `
CREATE TABLE topic_progress_v2 (
  topic_id TEXT PRIMARY KEY NOT NULL,
  status TEXT NOT NULL,
  note TEXT,
  last_studied_at TEXT,
  updated_at TEXT NOT NULL
);

INSERT INTO topic_progress_v2 (topic_id, status, note, last_studied_at, updated_at)
SELECT
  topic_id,
  status,
  note,
  CASE
    WHEN last_studied_at IS NULL THEN NULL
    ELSE strftime('%Y-%m-%dT%H:%M:%fZ', last_studied_at / 1000.0, 'unixepoch')
  END,
  strftime('%Y-%m-%dT%H:%M:%fZ', updated_at / 1000.0, 'unixepoch')
FROM topic_progress;

DROP TABLE topic_progress;

ALTER TABLE topic_progress_v2 RENAME TO topic_progress;
`;

/**
 * v2 -> v3 migration for `user_profile`.
 *
 * Same rebuild strategy as the topic_progress migration: SQLite cannot change a
 * column's declared type, so the singleton table is rebuilt and its row (if any)
 * is copied with the epoch-millisecond timestamps converted to ISO 8601. The
 * database file is never recreated and no row is deleted.
 */
export const MIGRATION_USER_PROFILE_ISO_TIMESTAMPS = `
CREATE TABLE user_profile_v3 (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  grade_level TEXT NOT NULL,
  score_type TEXT NOT NULL,
  target_department TEXT,
  target_university TEXT,
  onboarding_completed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO user_profile_v3 (id, grade_level, score_type, target_department, target_university, onboarding_completed, created_at, updated_at)
SELECT
  id,
  grade_level,
  score_type,
  target_department,
  target_university,
  onboarding_completed,
  strftime('%Y-%m-%dT%H:%M:%fZ', created_at / 1000.0, 'unixepoch'),
  strftime('%Y-%m-%dT%H:%M:%fZ', updated_at / 1000.0, 'unixepoch')
FROM user_profile;

DROP TABLE user_profile;

ALTER TABLE user_profile_v3 RENAME TO user_profile;
`;

/**
 * Table the pre-v4 `practice_exams` is renamed to during the v3 -> v4
 * migration. The old shape (INTEGER id, no name/score type/totals, no section
 * results) cannot be converted into a complete `PracticeExam` without
 * inventing data, so its rows are preserved here and excluded from repository
 * results rather than deleted or guessed at.
 */
export const PRACTICE_EXAMS_LEGACY_TABLE_NAME = 'practice_exams_legacy';

/**
 * v3 -> v4 migration for the practice exam tables.
 *
 * The caller first renames the old `practice_exams` table to
 * `PRACTICE_EXAMS_LEGACY_TABLE_NAME` (when it exists), then runs this
 * statement set to create the normalised `practice_exams` and
 * `practice_exam_results` tables plus the listing index. `user_profile` and
 * `topic_progress` are left untouched and the database file is never recreated.
 */
export const MIGRATION_PRACTICE_EXAMS_NORMALIZED = `
${CREATE_PRACTICE_EXAMS_TABLE}
${CREATE_PRACTICE_EXAM_RESULTS_TABLE}
${CREATE_PRACTICE_EXAMS_INDEX}
`;

/**
 * v5 -> v6 table for local, non-relational settings (key/value). The theme
 * preference is stored under the `theme_preference` key. Only `updated_at` is
 * a timestamp; `value` stays a plain validated TEXT.
 */
export const APP_SETTINGS_TABLE_NAME = 'app_settings';

export const CREATE_APP_SETTINGS_TABLE = `
CREATE TABLE IF NOT EXISTS ${APP_SETTINGS_TABLE_NAME} (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

/**
 * Physical columns `app_settings` must contain. The v5 -> v6 step compares
 * these against `PRAGMA table_info(...)` so the table's shape — not just
 * `PRAGMA user_version` — decides whether the database is complete.
 */
export const APP_SETTINGS_REQUIRED_COLUMNS: readonly string[] = ['key', 'value', 'updated_at'];

/**
 * Base name an incompatible `app_settings` table is archived under before the
 * correct one is created. A deterministic numeric suffix keeps any existing
 * archival table (and its rows) from being overwritten.
 */
export const APP_SETTINGS_ARCHIVE_BASE_NAME = 'app_settings_legacy_v5';
