/// <reference types="node" />

import { DatabaseSync } from 'node:sqlite';

import type { SQLiteDatabase } from 'expo-sqlite';

import { tyt2026 } from '@/data/curriculum/datasets';
import { createSqliteAppSettingsRepository } from '@/db/repositories/sqliteAppSettingsRepository';
import {
  CREATE_APP_SETTINGS_TABLE,
  CREATE_PRACTICE_EXAMS_TABLE,
  CREATE_PRACTICE_EXAM_RESULTS_TABLE,
  CREATE_TOPIC_PROGRESS_TABLE,
  CREATE_USER_PROFILE_TABLE,
  PRACTICE_EXAMS_ARCHIVE_BASE_NAME,
  SCHEMA_VERSION,
} from '@/db/schema';
import { getExamTotalQuestionCount, TYT_EXAM_DEFINITION } from '@/features/exams';
import { useExamStore } from '@/store/examStore';
import { useProfileStore } from '@/store/profileStore';
import { useTopicStore } from '@/store/topicStore';
import { createThemePreferenceSelection } from '@/theme/themePreferenceSelection';
import type { PracticeExam, TopicProgress, UserProfile } from '@/types';

import {
  clearLocalUserData,
  createClearLocalDataRunner,
  resetLocalUserData,
  USER_DATA_TABLES,
} from '../clearLocalData';

type BindValue = string | number | null;

/**
 * In-memory SQLite adapter exposing exactly the `expo-sqlite` surface the
 * reset, the repositories and `initializeDatabase` use. `failOnDelete`
 * simulates a transaction failure and `holdNextTransaction` lets a reset be
 * observed while it is still in flight.
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

  count(sql: string): number {
    const row = this.db.prepare(sql).get() as { n: number } | undefined;
    return row?.n ?? 0;
  }

  countOf(table: string): number {
    return this.count(`SELECT COUNT(*) AS n FROM ${table};`);
  }

  tables(): string[] {
    return (
      this.db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name;")
        .all() as { name: string }[]
    ).map((row) => row.name);
  }

  userVersion(): number {
    return (this.db.prepare('PRAGMA user_version;').get() as { user_version: number })
      .user_version;
  }
}

let adapter: TestDatabase;
const mockGetAdapter = () => adapter;

jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn(async () => mockGetAdapter()),
}));

// The connection is cached at module scope, so each test re-requires the module
// for a fresh one bound to its own adapter.
function loadInitializeDatabase(): typeof import('../../../db/database').initializeDatabase {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (require('../../../db/database') as typeof import('../../../db/database'))
    .initializeDatabase;
}

/** Deterministic fixed clock: no test reads the real time. */
const FIXED_NOW = new Date('2026-03-04T10:15:00.000Z');

const PROFILE: UserProfile = {
  gradeLevel: 'grade_12',
  scoreType: 'SAY',
  targetDepartment: 'Bilgisayar Mühendisliği',
  targetUniversity: undefined,
  onboardingCompleted: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const TOPIC_PROGRESS: TopicProgress = {
  topicId: 'tyt_turkce_1',
  status: 'learning',
  note: 'not',
  lastStudiedAt: null,
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const EXAM: PracticeExam = {
  id: 'e1',
  type: 'TYT',
  scoreTypeSnapshot: 'SAY',
  name: 'TYT Denemesi',
  date: '2026-01-01T00:00:00.000Z',
  results: [{ lessonId: 'tyt_turkce', correct: 20, incorrect: 5, blank: 15, net: 18.75 }],
  totalCorrect: 20,
  totalIncorrect: 5,
  totalBlank: 15,
  totalNet: 18.75,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function db(): SQLiteDatabase {
  return adapter as unknown as SQLiteDatabase;
}

/** Creates the full schema and stamps the current version, then seeds one row per table. */
function seedAll(): void {
  adapter.run('PRAGMA foreign_keys = ON;');
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

function seedStores(): void {
  useProfileStore.getState().hydrateProfile(PROFILE);
  useTopicStore.getState().setProgress(TOPIC_PROGRESS);
  useExamStore.getState().setExam(EXAM);
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

function snapshotCounts(): Record<string, number> {
  return Object.fromEntries(USER_DATA_TABLES.map((table) => [table, adapter.countOf(table)]));
}

beforeEach(() => {
  adapter = new TestDatabase();
  jest.resetModules();
  resetStores();
});

describe('clearLocalUserData (SQLite scope)', () => {
  it('1. deletes user_profile', async () => {
    seedAll();
    expect(adapter.countOf('user_profile')).toBe(1);

    await clearLocalUserData(db());

    expect(adapter.countOf('user_profile')).toBe(0);
  });

  it('2. deletes topic_progress', async () => {
    seedAll();

    await clearLocalUserData(db());

    expect(adapter.countOf('topic_progress')).toBe(0);
  });

  it('3. deletes practice_exams', async () => {
    seedAll();

    await clearLocalUserData(db());

    expect(adapter.countOf('practice_exams')).toBe(0);
  });

  it('4. deletes the related practice_exam_results', async () => {
    seedAll();
    expect(adapter.countOf('practice_exam_results')).toBe(1);

    await clearLocalUserData(db());

    expect(adapter.countOf('practice_exam_results')).toBe(0);
  });

  it('5. deletes app_settings', async () => {
    seedAll();

    await clearLocalUserData(db());

    expect(adapter.countOf('app_settings')).toBe(0);
  });

  it('6. leaves the schema version at 6', async () => {
    seedAll();

    await clearLocalUserData(db());

    expect(SCHEMA_VERSION).toBe(6);
    expect(adapter.userVersion()).toBe(6);
  });

  it('7. keeps every required table in place', async () => {
    seedAll();

    await clearLocalUserData(db());

    expect(adapter.tables()).toEqual(expect.arrayContaining([...USER_DATA_TABLES]));
  });

  it('8. never touches an archived legacy table', async () => {
    seedAll();
    adapter.run(
      `CREATE TABLE ${PRACTICE_EXAMS_ARCHIVE_BASE_NAME} (id INTEGER PRIMARY KEY, note TEXT);`,
    );
    adapter.run(`INSERT INTO ${PRACTICE_EXAMS_ARCHIVE_BASE_NAME} (note) VALUES ('a'), ('b');`);

    await clearLocalUserData(db());

    expect(adapter.tables()).toContain(PRACTICE_EXAMS_ARCHIVE_BASE_NAME);
    expect(adapter.countOf(PRACTICE_EXAMS_ARCHIVE_BASE_NAME)).toBe(2);
  });

  it('19. succeeds safely when the tables are already empty', async () => {
    seedAll();

    await clearLocalUserData(db());
    await expect(clearLocalUserData(db())).resolves.toBeUndefined();

    expect(snapshotCounts()).toEqual(
      Object.fromEntries(USER_DATA_TABLES.map((table) => [table, 0])),
    );
  });

  it('14. rolls back every deletion when the transaction fails', async () => {
    seedAll();
    const before = snapshotCounts();

    // Fails after the two exam tables were already cleared.
    adapter.failOnDelete = 'topic_progress';

    await expect(clearLocalUserData(db())).rejects.toThrow(/SQLITE_DELETE_FAILED/);

    expect(snapshotCounts()).toEqual(before);
  });
});

describe('resetLocalUserData (store ordering)', () => {
  it('9. clears profileStore only after the reset succeeds', async () => {
    seedAll();
    seedStores();
    expect(useProfileStore.getState().onboardingCompleted).toBe(true);

    await resetLocalUserData({ db: db(), resetThemePreference: jest.fn() });

    expect(useProfileStore.getState().onboardingCompleted).toBe(false);
    expect(useProfileStore.getState().scoreType).toBeNull();
  });

  it('10. clears topicStore', async () => {
    seedAll();
    seedStores();

    await resetLocalUserData({ db: db(), resetThemePreference: jest.fn() });

    expect(useTopicStore.getState().progressByTopicId).toEqual({});
  });

  it('11. clears examStore', async () => {
    seedAll();
    seedStores();

    await resetLocalUserData({ db: db(), resetThemePreference: jest.fn() });

    expect(useExamStore.getState().examsById).toEqual({});
  });

  it('16. sets onboardingCompleted to false after success', async () => {
    seedAll();
    seedStores();

    const runner = createClearLocalDataRunner();
    await runner.run({ db: db(), resetThemePreference: jest.fn() });

    expect(useProfileStore.getState().onboardingCompleted).toBe(false);
  });

  it('12. returns the theme preference to system after a successful reset', async () => {
    seedAll();
    const settingsRepository = createSqliteAppSettingsRepository(db(), { now: () => FIXED_NOW });
    await settingsRepository.setThemePreference('dark');
    await expect(settingsRepository.getThemePreference()).resolves.toBe('dark');

    // Mirrors `ThemeProvider`: the selection is seeded from SQLite and reset
    // through the same `hydrate` path the provider's reset method uses.
    const selection = createThemePreferenceSelection({
      persist: (preference) => settingsRepository.setThemePreference(preference),
    });
    selection.hydrate(await settingsRepository.getThemePreference());

    await resetLocalUserData({
      db: db(),
      resetThemePreference: () => selection.hydrate('system'),
    });

    expect(selection.getState()).toEqual({ confirmed: 'system', visible: 'system' });
    await expect(settingsRepository.getThemePreference()).resolves.toBe('system');
  });

  it('13. leaves every store untouched when the database reset fails', async () => {
    seedAll();
    seedStores();
    const resetThemePreference = jest.fn();

    adapter.failOnDelete = 'user_profile';

    await expect(resetLocalUserData({ db: db(), resetThemePreference })).rejects.toThrow(
      /SQLITE_DELETE_FAILED/,
    );

    expect(useProfileStore.getState().onboardingCompleted).toBe(true);
    expect(useProfileStore.getState().scoreType).toBe('SAY');
    expect(useTopicStore.getState().progressByTopicId['tyt_turkce_1']).toEqual(TOPIC_PROGRESS);
    expect(useExamStore.getState().examsById['e1']).toEqual(EXAM);
    expect(resetThemePreference).not.toHaveBeenCalled();
  });

  it('15. prevents duplicate reset requests', async () => {
    seedAll();
    adapter.holdNextTransaction();

    const runner = createClearLocalDataRunner();

    const first = runner.run({ db: db(), resetThemePreference: jest.fn() });
    const second = runner.run({ db: db(), resetThemePreference: jest.fn() });

    // The duplicate resolves without starting a second transaction.
    await second;
    expect(adapter.transactionCount).toBe(1);
    expect(runner.isRunning()).toBe(true);

    adapter.releaseHeldTransaction();
    await first;

    expect(adapter.transactionCount).toBe(1);
    expect(runner.isRunning()).toBe(false);
  });
});

describe('reset navigation (safe hand-off to onboarding)', () => {
  it('8. navigates only after the SQLite reset fully succeeded', async () => {
    seedAll();
    seedStores();

    const navigateToOnboarding = jest.fn(() => {
      // Called last: the database tables and every store are already cleared.
      expect(adapter.countOf('user_profile')).toBe(0);
      expect(adapter.countOf('app_settings')).toBe(0);
      expect(useProfileStore.getState().onboardingCompleted).toBe(false);
      expect(useTopicStore.getState().progressByTopicId).toEqual({});
      expect(useExamStore.getState().examsById).toEqual({});
    });

    await resetLocalUserData({
      db: db(),
      resetThemePreference: jest.fn(),
      navigateToOnboarding,
    });

    expect(navigateToOnboarding).toHaveBeenCalledTimes(1);
  });

  it('9. keeps the current route and every store when the reset fails', async () => {
    seedAll();
    seedStores();
    const navigateToOnboarding = jest.fn();

    adapter.failOnDelete = 'topic_progress';

    await expect(
      resetLocalUserData({ db: db(), resetThemePreference: jest.fn(), navigateToOnboarding }),
    ).rejects.toThrow(/SQLITE_DELETE_FAILED/);

    expect(navigateToOnboarding).not.toHaveBeenCalled();
    expect(useProfileStore.getState().onboardingCompleted).toBe(true);
    expect(useProfileStore.getState().scoreType).toBe('SAY');
    expect(useTopicStore.getState().progressByTopicId['tyt_turkce_1']).toEqual(TOPIC_PROGRESS);
    expect(useExamStore.getState().examsById['e1']).toEqual(EXAM);
  });

  it('10. does not report a navigation failure as a deletion failure', async () => {
    seedAll();
    seedStores();

    // A successful deletion whose navigation throws must still resolve: the
    // navigation error is isolated and must never surface as a delete error.
    await expect(
      resetLocalUserData({
        db: db(),
        resetThemePreference: jest.fn(),
        navigateToOnboarding: () => {
          throw new Error('navigation failed');
        },
      }),
    ).resolves.toBeUndefined();

    expect(adapter.countOf('user_profile')).toBe(0);
    expect(adapter.countOf('topic_progress')).toBe(0);
    expect(adapter.countOf('practice_exams')).toBe(0);
    expect(adapter.countOf('practice_exam_results')).toBe(0);
    expect(adapter.countOf('app_settings')).toBe(0);
    expect(useProfileStore.getState().onboardingCompleted).toBe(false);
  });

  it('11. leaves every store empty after the transition', async () => {
    seedAll();
    seedStores();

    await resetLocalUserData({
      db: db(),
      resetThemePreference: jest.fn(),
      navigateToOnboarding: jest.fn(),
    });

    expect(useProfileStore.getState().onboardingCompleted).toBe(false);
    expect(useProfileStore.getState().scoreType).toBeNull();
    expect(useTopicStore.getState().progressByTopicId).toEqual({});
    expect(useExamStore.getState().examsById).toEqual({});
  });
});

describe('initialization after a reset', () => {
  it('17. remains valid', async () => {
    seedAll();
    seedStores();

    await resetLocalUserData({ db: db(), resetThemePreference: jest.fn() });

    await expect(loadInitializeDatabase()()).resolves.toBeDefined();

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

    // The schema is still writable after the reset.
    const settingsRepository = createSqliteAppSettingsRepository(db(), { now: () => FIXED_NOW });
    await settingsRepository.setThemePreference('light');
    await expect(settingsRepository.getThemePreference()).resolves.toBe('light');
  });

  it('18. is idempotent', async () => {
    seedAll();

    await resetLocalUserData({ db: db(), resetThemePreference: jest.fn() });

    await loadInitializeDatabase()();
    const tablesAfterFirstRun = adapter.tables();

    await loadInitializeDatabase()();

    expect(adapter.tables()).toEqual(tablesAfterFirstRun);
    expect(adapter.tables()).not.toContain(`${PRACTICE_EXAMS_ARCHIVE_BASE_NAME}_2`);
  });
});

describe('static definitions', () => {
  it('20. leaves the curriculum and exam definitions unaffected', async () => {
    seedAll();
    const curriculumBefore = tyt2026;
    const examBefore = TYT_EXAM_DEFINITION;
    const questionCountBefore = getExamTotalQuestionCount('TYT', 'SAY');

    await resetLocalUserData({ db: db(), resetThemePreference: jest.fn() });

    expect(tyt2026).toBe(curriculumBefore);
    expect(tyt2026.lessons.length).toBeGreaterThan(0);
    expect(TYT_EXAM_DEFINITION).toBe(examBefore);
    expect(getExamTotalQuestionCount('TYT', 'SAY')).toBe(questionCountBefore);
    expect(questionCountBefore).toBe(120);
  });
});
