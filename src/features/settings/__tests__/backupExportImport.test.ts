/// <reference types="node" />

import { DatabaseSync } from 'node:sqlite';

import type { SQLiteDatabase } from 'expo-sqlite';

import {
  createSqliteAppSettingsRepository,
  createSqlitePracticeExamRepository,
  createSqliteTopicProgressRepository,
  createSqliteUserProfileRepository,
} from '@/db/repositories';
import {
  CREATE_APP_SETTINGS_TABLE,
  CREATE_PRACTICE_EXAMS_TABLE,
  CREATE_PRACTICE_EXAM_RESULTS_TABLE,
  CREATE_TOPIC_PROGRESS_TABLE,
  CREATE_USER_PROFILE_TABLE,
  PRACTICE_EXAMS_ARCHIVE_BASE_NAME,
  SCHEMA_VERSION,
} from '@/db/schema';
import { canAccessRoute } from '@/features/onboarding/routeProtection';
import { useExamStore } from '@/store/examStore';
import { useProfileStore } from '@/store/profileStore';
import { useTopicStore } from '@/store/topicStore';
import { createThemePreferenceSelection } from '@/theme/themePreferenceSelection';
import type {
  GradeLevel,
  PracticeExam,
  ScoreType,
  ThemePreference,
  TopicProgress,
  TopicStatus,
  UserProfile,
} from '@/types';

import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  buildBackupFileName,
  CURRICULUM_VERSION,
  INVALID_BACKUP_MESSAGE,
  MAX_BACKUP_BYTES,
  parseBackup,
  parseBackupText,
  serializeBackup,
  UNSUPPORTED_BACKUP_VERSION_MESSAGE,
  type PuanLabBackup,
} from '../backupFormat';
import { buildBackupSnapshot } from '../backupSnapshot';
import { USER_DATA_TABLES } from '../clearLocalData';
import { createRestoreBackupRunner, restoreBackup } from '../restoreBackup';

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { version: '0.1.0' } },
}));

type BindValue = string | number | null;

type ProfileRow = {
  id: number;
  grade_level: string;
  score_type: string;
  target_department: string | null;
  target_university: string | null;
  onboarding_completed: number;
  created_at: string;
  updated_at: string;
};

type TopicRow = {
  topic_id: string;
  status: string;
  note: string | null;
  last_studied_at: string | null;
  updated_at: string;
};

type ExamRow = {
  id: string;
  exam_type: string;
  score_type_snapshot: string;
  name: string;
  exam_date: string;
  total_correct: number;
  total_incorrect: number;
  total_blank: number;
  total_net: number;
  created_at: string;
  updated_at: string;
};

type ResultRow = {
  exam_id: string;
  lesson_id: string;
  correct: number;
  incorrect: number;
  blank: number;
  net: number;
};

type SettingsRow = {
  key: string;
  value: string;
  updated_at: string;
};

/**
 * In-memory SQLite adapter exposing exactly the `expo-sqlite` surface the
 * backup, the restore and the repositories use. `failOnDelete` simulates a
 * transaction failure and `holdNextTransaction` lets a restore be observed
 * while it is still in flight.
 */
class TestDatabase {
  readonly db = new DatabaseSync(':memory:');

  failOnDelete: string | null = null;
  transactionCount = 0;

  private releaseHeld: (() => void) | null = null;
  private heldTransaction: Promise<void> | null = null;

  async execAsync(sql: string): Promise<void> {
    this.db.exec(sql);
  }

  async runAsync(sql: string, params: BindValue[] = []): Promise<void> {
    if (this.failOnDelete !== null && sql.startsWith(`DELETE FROM ${this.failOnDelete}`)) {
      throw new Error('SQLITE_DELETE_FAILED: disk I/O error');
    }

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
    this.transactionCount += 1;
    this.db.exec('BEGIN');

    try {
      if (this.heldTransaction !== null) {
        await this.heldTransaction;
      }

      await task();
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  holdNextTransaction(): void {
    this.heldTransaction = new Promise<void>((resolve) => {
      this.releaseHeld = resolve;
    });
  }

  releaseHeldTransaction(): void {
    this.releaseHeld?.();
  }

  run(sql: string): void {
    this.db.exec(sql);
  }

  rows<T>(sql: string): T[] {
    return this.db.prepare(sql).all() as unknown as T[];
  }

  countOf(table: string): number {
    const row = this.db.prepare(`SELECT COUNT(*) AS n FROM ${table};`).get() as
      | { n: number }
      | undefined;

    return row?.n ?? 0;
  }

  tables(): string[] {
    return this.rows<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name;",
    ).map((row) => row.name);
  }

  userVersion(): number {
    return (this.db.prepare('PRAGMA user_version;').get() as { user_version: number })
      .user_version;
  }
}

let adapter: TestDatabase;

/** Deterministic fixed clock: no test reads the real time. */
const FIXED_NOW = new Date('2026-03-04T10:15:00.000Z');

function db(): SQLiteDatabase {
  return adapter as unknown as SQLiteDatabase;
}

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

function makeRestoredProfile(): UserProfile {
  return {
    gradeLevel: 'grade_11',
    scoreType: 'EA',
    targetDepartment: 'Hukuk',
    targetUniversity: 'Ankara Üniversitesi',
    onboardingCompleted: true,
    createdAt: '2026-02-01T08:00:00.000Z',
    updatedAt: '2026-02-02T08:00:00.000Z',
  };
}

function makeRestoredTopicProgress(
  topicId: string,
  status: TopicStatus,
): TopicProgress {
  return {
    topicId,
    status,
    note: status === 'strong' ? 'Tekrar edildi' : null,
    lastStudiedAt: status === 'strong' ? '2026-02-03T10:00:00.000Z' : null,
    updatedAt: '2026-02-04T10:00:00.000Z',
  };
}

/** TYT exam with two real sections, in definition order, with exact totals. */
function makeRestoredExam(): PracticeExam {
  return {
    id: 'exam-restored',
    type: 'TYT',
    scoreTypeSnapshot: 'SAY',
    name: 'Mart TYT Denemesi',
    date: '2026-03-02T09:00:00.000Z',
    results: [
      { lessonId: 'tyt_turkce', correct: 25, incorrect: 5, blank: 10, net: 23.75 },
      { lessonId: 'tyt_sosyal_bilimler', correct: 12, incorrect: 3, blank: 5, net: 11.25 },
    ],
    totalCorrect: 37,
    totalIncorrect: 8,
    totalBlank: 15,
    totalNet: 35,
    createdAt: '2026-03-02T09:00:00.000Z',
    updatedAt: '2026-03-02T09:30:00.000Z',
  };
}

function makeCurrentProfile(): UserProfile {
  return {
    gradeLevel: 'grade_12',
    scoreType: 'SAY',
    targetDepartment: 'Tıp',
    onboardingCompleted: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-05T00:00:00.000Z',
  };
}

const CURRENT_TOPIC_PROGRESS: TopicProgress = {
  topicId: 'tyt_turkce_ses_bilgisi',
  status: 'learning',
  note: 'eski not',
  lastStudiedAt: null,
  updatedAt: '2026-01-02T00:00:00.000Z',
};

const CURRENT_EXAM: PracticeExam = {
  id: 'exam-current',
  type: 'TYT',
  scoreTypeSnapshot: 'SAY',
  name: 'Ocak TYT Denemesi',
  date: '2026-01-10T09:00:00.000Z',
  results: [{ lessonId: 'tyt_turkce', correct: 20, incorrect: 5, blank: 15, net: 18.75 }],
  totalCorrect: 20,
  totalIncorrect: 5,
  totalBlank: 15,
  totalNet: 18.75,
  createdAt: '2026-01-10T09:00:00.000Z',
  updatedAt: '2026-01-10T09:00:00.000Z',
};

type BackupOverrides = {
  profile?: UserProfile | null;
  topicProgress?: TopicProgress[];
  practiceExams?: PracticeExam[];
  themePreference?: ThemePreference;
};

/** Fresh, valid, fully deterministic backup document. */
function makeBackup(overrides: BackupOverrides = {}): PuanLabBackup {
  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: '2026-03-01T09:00:00.000Z',
    appVersion: '0.1.0',
    schemaVersion: SCHEMA_VERSION,
    curriculumVersion: CURRICULUM_VERSION,
    data: {
      profile: overrides.profile === undefined ? makeRestoredProfile() : overrides.profile,
      topicProgress: overrides.topicProgress ?? [
        makeRestoredTopicProgress('tyt_turkce_sozcukte_anlam', 'strong'),
        makeRestoredTopicProgress('tyt_turkce_paragraf', 'practice'),
      ],
      practiceExams: overrides.practiceExams ?? [makeRestoredExam()],
      settings: { themePreference: overrides.themePreference ?? 'dark' },
    },
  };
}

const INVALID_RESULT = { valid: false, reason: 'invalid', message: INVALID_BACKUP_MESSAGE };

/* ------------------------------------------------------------------ */
/* Harness                                                             */
/* ------------------------------------------------------------------ */

function createSchema(): void {
  adapter.run('PRAGMA foreign_keys = ON;');

  for (const statement of [
    CREATE_USER_PROFILE_TABLE,
    CREATE_TOPIC_PROGRESS_TABLE,
    CREATE_PRACTICE_EXAMS_TABLE,
    CREATE_PRACTICE_EXAM_RESULTS_TABLE,
    CREATE_APP_SETTINGS_TABLE,
  ]) {
    adapter.run(statement);
  }

  adapter.run(`PRAGMA user_version = ${SCHEMA_VERSION};`);
}

type SeedData = {
  profile: UserProfile | null;
  topicProgress?: TopicProgress[];
  exams?: PracticeExam[];
  themePreference?: ThemePreference;
};

/** Builds the schema, stamps version 6 and writes the rows through the real repositories. */
async function seedDatabase({
  profile,
  topicProgress = [],
  exams = [],
  themePreference = 'system',
}: SeedData): Promise<void> {
  createSchema();

  if (profile !== null) {
    await createSqliteUserProfileRepository(db()).saveProfile(profile);
  }

  for (const progress of topicProgress) {
    await createSqliteTopicProgressRepository(db()).upsert(progress);
  }

  for (const exam of exams) {
    await createSqlitePracticeExamRepository(db()).create(exam);
  }

  await createSqliteAppSettingsRepository(db(), { now: () => FIXED_NOW }).setThemePreference(
    themePreference,
  );
}

function readProfileRows(): ProfileRow[] {
  return adapter.rows<ProfileRow>('SELECT * FROM user_profile;');
}

function readTopicRows(): TopicRow[] {
  return adapter.rows<TopicRow>(
    `SELECT topic_id, status, note, last_studied_at, updated_at
       FROM topic_progress ORDER BY topic_id;`,
  );
}

function readExamRows(): ExamRow[] {
  return adapter.rows<ExamRow>('SELECT * FROM practice_exams ORDER BY id;');
}

function readResultRows(): ResultRow[] {
  return adapter.rows<ResultRow>(
    'SELECT exam_id, lesson_id, correct, incorrect, blank, net FROM practice_exam_results ORDER BY rowid;',
  );
}

function readSettingsRows(): SettingsRow[] {
  return adapter.rows<SettingsRow>('SELECT key, value, updated_at FROM app_settings ORDER BY key;');
}

function dumpActiveTables(): Record<string, unknown[]> {
  return Object.fromEntries(
    USER_DATA_TABLES.map((table) => [table, adapter.rows<Record<string, unknown>>(`SELECT * FROM ${table};`)]),
  );
}

function seedStores(): void {
  useProfileStore.getState().hydrateProfile(makeCurrentProfile());
  useTopicStore.getState().setProgress(CURRENT_TOPIC_PROGRESS);
  useExamStore.getState().setExam(CURRENT_EXAM);
}

function resetStores(): void {
  useProfileStore.setState({
    gradeLevel: null,
    scoreType: null,
    targetDepartment: null,
    targetUniversity: null,
    onboardingCompleted: false,
  });
  useTopicStore.setState({ progressByTopicId: {} });
  useExamStore.setState({ examsById: {}, isHydrated: false });
}

function snapshotStores() {
  const profile = useProfileStore.getState();

  return {
    gradeLevel: profile.gradeLevel,
    scoreType: profile.scoreType,
    targetDepartment: profile.targetDepartment,
    targetUniversity: profile.targetUniversity,
    onboardingCompleted: profile.onboardingCompleted,
    topicProgress: useTopicStore.getState().progressByTopicId,
    exams: useExamStore.getState().examsById,
  };
}

beforeEach(() => {
  adapter = new TestDatabase();
  jest.clearAllMocks();
  resetStores();
});

/* ------------------------------------------------------------------ */
/* 1-6: backup generation                                              */
/* ------------------------------------------------------------------ */

describe('backup generation', () => {
  it('1. produces a deterministic document from fixed inputs', async () => {
    await seedDatabase({
      profile: makeCurrentProfile(),
      topicProgress: [CURRENT_TOPIC_PROGRESS],
      exams: [CURRENT_EXAM],
      themePreference: 'light',
    });

    const options = { db: db(), now: () => FIXED_NOW, appVersion: '0.1.0' };
    const first = await buildBackupSnapshot(options);
    const second = await buildBackupSnapshot(options);

    expect(second).toEqual(first);
    expect(serializeBackup(second)).toBe(serializeBackup(first));
    expect(first.exportedAt).toBe('2026-03-04T10:15:00.000Z');

    // File name uses the device's local calendar date, not the UTC one.
    expect(buildBackupFileName(new Date(2026, 2, 4, 12, 0, 0))).toBe(
      'puanlab-yedek-2026-03-04.json',
    );
  });

  it('2. carries every required metadata field', async () => {
    await seedDatabase({ profile: makeCurrentProfile() });

    const backup = await buildBackupSnapshot({
      db: db(),
      now: () => FIXED_NOW,
      appVersion: '0.1.0',
    });

    expect(backup).toMatchObject({
      format: 'puanlab-backup',
      formatVersion: 1,
      exportedAt: FIXED_NOW.toISOString(),
      appVersion: '0.1.0',
      schemaVersion: SCHEMA_VERSION,
      curriculumVersion: 2026,
    });
    expect(Object.keys(backup).sort()).toEqual([
      'appVersion',
      'curriculumVersion',
      'data',
      'exportedAt',
      'format',
      'formatVersion',
      'schemaVersion',
    ]);
  });

  it('3. exports a null profile when none is stored', async () => {
    await seedDatabase({ profile: null, themePreference: 'system' });

    const backup = await buildBackupSnapshot({ db: db(), now: () => FIXED_NOW });

    expect(backup.data.profile).toBeNull();
    expect(backup.data.topicProgress).toEqual([]);
    expect(backup.data.practiceExams).toEqual([]);
    expect(parseBackup(backup).valid).toBe(true);
  });

  it('4. exports topic progress sorted by topic id with every field intact', async () => {
    const sozcuk = makeRestoredTopicProgress('tyt_turkce_sozcukte_anlam', 'strong');
    const paragraf = makeRestoredTopicProgress('tyt_turkce_paragraf', 'practice');

    await seedDatabase({
      profile: makeCurrentProfile(),
      topicProgress: [sozcuk, paragraf],
    });

    const backup = await buildBackupSnapshot({ db: db(), now: () => FIXED_NOW });

    expect(backup.data.topicProgress).toEqual([paragraf, sozcuk]);
  });

  it('5. exports a practice exam with its lesson results in definition order', async () => {
    const exam = makeRestoredExam();
    // Stored out of order; the export must follow the TYT section order.
    const shuffled: PracticeExam = { ...exam, results: [...exam.results].reverse() };

    await seedDatabase({ profile: makeCurrentProfile(), exams: [shuffled] });

    const backup = await buildBackupSnapshot({ db: db(), now: () => FIXED_NOW });

    expect(backup.data.practiceExams).toHaveLength(1);
    expect(backup.data.practiceExams[0].results.map((result) => result.lessonId)).toEqual([
      'tyt_turkce',
      'tyt_sosyal_bilimler',
    ]);
    expect(backup.data.practiceExams[0]).toMatchObject({
      id: 'exam-restored',
      scoreTypeSnapshot: 'SAY',
      totalCorrect: 37,
      totalIncorrect: 8,
      totalBlank: 15,
      totalNet: 35,
      createdAt: '2026-03-02T09:00:00.000Z',
      updatedAt: '2026-03-02T09:30:00.000Z',
    });
  });

  it('6. exports the stored theme preference', async () => {
    await seedDatabase({ profile: makeCurrentProfile(), themePreference: 'dark' });

    const backup = await buildBackupSnapshot({ db: db(), now: () => FIXED_NOW });

    expect(backup.data.settings).toEqual({ themePreference: 'dark' });
  });
});

/* ------------------------------------------------------------------ */
/* 7-20: backup validation                                             */
/* ------------------------------------------------------------------ */

describe('backup validation', () => {
  it('7. accepts a generated backup', () => {
    const backup = makeBackup();

    expect(parseBackup(backup)).toEqual({ valid: true, backup });
  });

  it('8. rejects text that is not JSON', () => {
    expect(parseBackupText('{ "format": "puanlab-backup"')).toEqual(INVALID_RESULT);
  });

  it('9. rejects a document with a different format marker', () => {
    const document: Record<string, unknown> = { ...makeBackup(), format: 'other-backup' };

    expect(parseBackup(document)).toEqual(INVALID_RESULT);
  });

  it('10. rejects a newer format version with the calm message', () => {
    const document: Record<string, unknown> = { ...makeBackup(), formatVersion: 2 };

    expect(parseBackup(document)).toEqual({
      valid: false,
      reason: 'unsupported_version',
      message: UNSUPPORTED_BACKUP_VERSION_MESSAGE,
    });
  });

  it('11. rejects an unknown grade level', () => {
    const backup = makeBackup({
      profile: { ...makeRestoredProfile(), gradeLevel: 'grade_9' as GradeLevel },
    });

    expect(parseBackup(backup)).toEqual(INVALID_RESULT);
  });

  it('12. rejects an unknown score type', () => {
    const backup = makeBackup({
      profile: { ...makeRestoredProfile(), scoreType: 'TM' as ScoreType },
    });

    expect(parseBackup(backup)).toEqual(INVALID_RESULT);
  });

  it('13. rejects an unknown topic status', () => {
    const backup = makeBackup({
      topicProgress: [
        { ...makeRestoredTopicProgress('tyt_turkce_paragraf', 'practice'), status: 'done' as TopicStatus },
      ],
    });

    expect(parseBackup(backup)).toEqual(INVALID_RESULT);
  });

  it('14. rejects a topic id the current curriculum does not know', () => {
    const backup = makeBackup({
      topicProgress: [makeRestoredTopicProgress('tyt_turkce_1', 'learning')],
    });

    expect(parseBackup(backup)).toEqual(INVALID_RESULT);
  });

  it('15. rejects duplicate topic ids', () => {
    const progress = makeRestoredTopicProgress('tyt_turkce_paragraf', 'practice');
    const backup = makeBackup({ topicProgress: [progress, { ...progress }] });

    expect(parseBackup(backup)).toEqual(INVALID_RESULT);
  });

  it('16. rejects duplicate exam ids', () => {
    const backup = makeBackup({
      practiceExams: [makeRestoredExam(), makeRestoredExam()],
    });

    expect(parseBackup(backup)).toEqual(INVALID_RESULT);
  });

  it('17. rejects an exam whose totals do not match its sections', () => {
    const exam = makeRestoredExam();
    exam.totalNet = 99;

    expect(parseBackup(makeBackup({ practiceExams: [exam] }))).toEqual(INVALID_RESULT);
  });

  it('18. rejects an exam section that does not belong to the exam type', () => {
    const exam = makeRestoredExam();
    exam.results[0] = { ...exam.results[0], lessonId: 'tyt_matematik' };

    expect(parseBackup(makeBackup({ practiceExams: [exam] }))).toEqual(INVALID_RESULT);
  });

  it('19. rejects a malformed ISO timestamp', () => {
    const backup = makeBackup({
      profile: { ...makeRestoredProfile(), createdAt: '3 Mart 2026' },
    });

    expect(parseBackup(backup)).toEqual(INVALID_RESULT);
  });

  it('20. rejects text larger than the size limit', () => {
    const oversized = 'a'.repeat(MAX_BACKUP_BYTES + 1);

    expect(parseBackupText(oversized)).toEqual(INVALID_RESULT);
  });
});

/* ------------------------------------------------------------------ */
/* 21-30: restore                                                      */
/* ------------------------------------------------------------------ */

async function seedCurrentUserData(): Promise<void> {
  await seedDatabase({
    profile: makeCurrentProfile(),
    topicProgress: [CURRENT_TOPIC_PROGRESS],
    exams: [CURRENT_EXAM],
    themePreference: 'light',
  });
}

describe('backup restore', () => {
  it('21. replaces the active user data with the backup', async () => {
    await seedCurrentUserData();
    const backup = makeBackup();

    await restoreBackup({
      db: db(),
      backup,
      applyThemePreference: jest.fn(),
      now: () => FIXED_NOW,
    });

    expect(readProfileRows()).toEqual([
      {
        id: 1,
        grade_level: 'grade_11',
        score_type: 'EA',
        target_department: 'Hukuk',
        target_university: 'Ankara Üniversitesi',
        onboarding_completed: 1,
        created_at: '2026-02-01T08:00:00.000Z',
        updated_at: '2026-02-02T08:00:00.000Z',
      },
    ]);
    expect(readTopicRows()).toEqual([
      {
        topic_id: 'tyt_turkce_paragraf',
        status: 'practice',
        note: null,
        last_studied_at: null,
        updated_at: '2026-02-04T10:00:00.000Z',
      },
      {
        topic_id: 'tyt_turkce_sozcukte_anlam',
        status: 'strong',
        note: 'Tekrar edildi',
        last_studied_at: '2026-02-03T10:00:00.000Z',
        updated_at: '2026-02-04T10:00:00.000Z',
      },
    ]);
    expect(readExamRows()).toEqual([
      {
        id: 'exam-restored',
        exam_type: 'TYT',
        score_type_snapshot: 'SAY',
        name: 'Mart TYT Denemesi',
        exam_date: '2026-03-02T09:00:00.000Z',
        total_correct: 37,
        total_incorrect: 8,
        total_blank: 15,
        total_net: 35,
        created_at: '2026-03-02T09:00:00.000Z',
        updated_at: '2026-03-02T09:30:00.000Z',
      },
    ]);
    expect(readResultRows()).toEqual([
      {
        exam_id: 'exam-restored',
        lesson_id: 'tyt_turkce',
        correct: 25,
        incorrect: 5,
        blank: 10,
        net: 23.75,
      },
      {
        exam_id: 'exam-restored',
        lesson_id: 'tyt_sosyal_bilimler',
        correct: 12,
        incorrect: 3,
        blank: 5,
        net: 11.25,
      },
    ]);
    expect(readSettingsRows()).toEqual([
      { key: 'theme_preference', value: 'dark', updated_at: FIXED_NOW.toISOString() },
    ]);
  });

  it('22. rolls the whole replacement back when a write fails', async () => {
    await seedCurrentUserData();
    const before = dumpActiveTables();

    // Fails after the exam tables were already cleared.
    adapter.failOnDelete = 'topic_progress';

    await expect(
      restoreBackup({
        db: db(),
        backup: makeBackup(),
        applyThemePreference: jest.fn(),
        now: () => FIXED_NOW,
      }),
    ).rejects.toThrow(/SQLITE_DELETE_FAILED/);

    expect(dumpActiveTables()).toEqual(before);
  });

  it('23. never touches an archived legacy table', async () => {
    await seedCurrentUserData();
    adapter.run(
      `CREATE TABLE ${PRACTICE_EXAMS_ARCHIVE_BASE_NAME} (id INTEGER PRIMARY KEY, note TEXT);`,
    );
    adapter.run(`INSERT INTO ${PRACTICE_EXAMS_ARCHIVE_BASE_NAME} (note) VALUES ('a'), ('b');`);

    await restoreBackup({
      db: db(),
      backup: makeBackup(),
      applyThemePreference: jest.fn(),
      now: () => FIXED_NOW,
    });

    expect(adapter.tables()).toContain(PRACTICE_EXAMS_ARCHIVE_BASE_NAME);
    expect(adapter.rows(`SELECT note FROM ${PRACTICE_EXAMS_ARCHIVE_BASE_NAME} ORDER BY id;`)).toEqual([
      { note: 'a' },
      { note: 'b' },
    ]);
    expect(adapter.countOf(PRACTICE_EXAMS_ARCHIVE_BASE_NAME)).toBe(2);
  });

  it('24. keeps the schema version and every active table in place', async () => {
    await seedCurrentUserData();

    await restoreBackup({
      db: db(),
      backup: makeBackup(),
      applyThemePreference: jest.fn(),
      now: () => FIXED_NOW,
    });

    expect(SCHEMA_VERSION).toBe(7);
    expect(adapter.userVersion()).toBe(7);
    expect(adapter.tables()).toEqual(expect.arrayContaining([...USER_DATA_TABLES]));
  });

  it('25. hydrates the stores only after the transaction committed', async () => {
    await seedCurrentUserData();
    seedStores();
    const before = snapshotStores();

    adapter.transactionCount = 0;
    adapter.holdNextTransaction();

    const restorePromise = restoreBackup({
      db: db(),
      backup: makeBackup(),
      applyThemePreference: jest.fn(),
      now: () => FIXED_NOW,
    });

    // The transaction is open but not committed: in-memory state is untouched.
    expect(adapter.transactionCount).toBe(1);
    expect(snapshotStores()).toEqual(before);

    adapter.releaseHeldTransaction();
    await restorePromise;

    expect(useProfileStore.getState().scoreType).toBe('EA');
    expect(useProfileStore.getState().gradeLevel).toBe('grade_11');
    expect(Object.keys(useTopicStore.getState().progressByTopicId).sort()).toEqual([
      'tyt_turkce_paragraf',
      'tyt_turkce_sozcukte_anlam',
    ]);
    expect(Object.keys(useExamStore.getState().examsById)).toEqual(['exam-restored']);
    expect(useExamStore.getState().isHydrated).toBe(true);
  });

  it('26. leaves every store untouched when the restore fails', async () => {
    await seedCurrentUserData();
    seedStores();
    const before = snapshotStores();
    const applyThemePreference = jest.fn();

    adapter.failOnDelete = 'user_profile';

    await expect(
      restoreBackup({
        db: db(),
        backup: makeBackup(),
        applyThemePreference,
        now: () => FIXED_NOW,
      }),
    ).rejects.toThrow(/SQLITE_DELETE_FAILED/);

    expect(snapshotStores()).toEqual(before);
    expect(applyThemePreference).not.toHaveBeenCalled();
  });

  it('27. applies the restored theme without writing it again', async () => {
    await seedCurrentUserData();

    const persist = jest.fn(async () => {});
    const selection = createThemePreferenceSelection({ persist });
    selection.hydrate('light');

    await restoreBackup({
      db: db(),
      backup: makeBackup({ themePreference: 'dark' }),
      applyThemePreference: selection.hydrate,
      now: () => FIXED_NOW,
    });

    expect(selection.getState()).toEqual({ confirmed: 'dark', visible: 'dark' });
    expect(persist).not.toHaveBeenCalled();
  });

  it('28. opens the protected routes for a restored completed profile', async () => {
    await seedCurrentUserData();
    resetStores();
    expect(useProfileStore.getState().onboardingCompleted).toBe(false);

    await restoreBackup({
      db: db(),
      backup: makeBackup(),
      applyThemePreference: jest.fn(),
      now: () => FIXED_NOW,
    });

    const isCompleted = useProfileStore.getState().onboardingCompleted;

    expect(isCompleted).toBe(true);
    expect(canAccessRoute('(tabs)', isCompleted)).toBe(true);
    expect(canAccessRoute('profile/index', isCompleted)).toBe(true);
    expect(canAccessRoute('onboarding', isCompleted)).toBe(false);
  });

  it('29. sends a backup without a profile back to onboarding', async () => {
    await seedCurrentUserData();
    seedStores();
    expect(useProfileStore.getState().onboardingCompleted).toBe(true);

    await restoreBackup({
      db: db(),
      backup: makeBackup({ profile: null }),
      applyThemePreference: jest.fn(),
      now: () => FIXED_NOW,
    });

    const isCompleted = useProfileStore.getState().onboardingCompleted;

    expect(isCompleted).toBe(false);
    expect(useProfileStore.getState().scoreType).toBeNull();
    expect(canAccessRoute('(tabs)', isCompleted)).toBe(false);
    expect(canAccessRoute('onboarding', isCompleted)).toBe(true);
  });

  it('30. ignores a repeated import while one is still running', async () => {
    await seedCurrentUserData();
    adapter.transactionCount = 0;
    adapter.holdNextTransaction();

    const runner = createRestoreBackupRunner();
    const options = {
      db: db(),
      backup: makeBackup(),
      applyThemePreference: jest.fn(),
      now: () => FIXED_NOW,
    };

    const first = runner.run(options);
    const second = runner.run(options);

    await second;
    expect(adapter.transactionCount).toBe(1);
    expect(runner.isRunning()).toBe(true);

    adapter.releaseHeldTransaction();
    await first;

    expect(adapter.transactionCount).toBe(1);
    expect(runner.isRunning()).toBe(false);
    expect(adapter.countOf('practice_exams')).toBe(1);
  });
});
