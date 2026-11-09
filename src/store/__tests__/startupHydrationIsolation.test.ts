/// <reference types="node" />

import { DatabaseSync } from 'node:sqlite';

import type { SQLiteDatabase } from 'expo-sqlite';

import { createSqliteAppSettingsRepository } from '@/db/repositories/sqliteAppSettingsRepository';
import { createSqliteUserProfileRepository } from '@/db/repositories/sqliteUserProfileRepository';
import {
  CREATE_APP_SETTINGS_TABLE,
  CREATE_USER_PROFILE_TABLE,
} from '@/db/schema';
import { createThemePreferenceSelection } from '@/theme/themePreferenceSelection';
import type { PracticeExam, TopicProgress, UserProfile } from '@/types';

import { useExamStore } from '../examStore';
import { useProfileStore } from '../profileStore';
import { useTopicStore } from '../topicStore';

type BindValue = string | number | null;

/**
 * In-memory SQLite adapter exposing the exact `expo-sqlite` surface the two
 * repositories use. `failReads` simulates a repository read failure so the test
 * can prove the stored row is reported but never deleted.
 */
class TestDatabase {
  private readonly db = new DatabaseSync(':memory:');

  failReads = false;

  async execAsync(sql: string): Promise<void> {
    this.db.exec(sql);
  }

  async runAsync(sql: string, params: BindValue[] = []): Promise<void> {
    this.db.prepare(sql).run(...params);
  }

  async getFirstAsync<T>(sql: string, params: BindValue[] = []): Promise<T | null> {
    if (this.failReads) {
      throw new Error('SQLITE_READ_FAILED: disk I/O error');
    }

    const row = this.db.prepare(sql).get(...params);
    return (row as T | undefined) ?? null;
  }

  async getAllAsync<T>(sql: string, params: BindValue[] = []): Promise<T[]> {
    return this.db.prepare(sql).all(...params) as unknown as T[];
  }

  run(sql: string): void {
    this.db.exec(sql);
  }
}

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
  note: null,
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

let db: TestDatabase;
let settingsRepository: ReturnType<typeof createSqliteAppSettingsRepository>;

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

beforeEach(async () => {
  db = new TestDatabase();
  await db.execAsync(CREATE_APP_SETTINGS_TABLE);
  await db.execAsync(CREATE_USER_PROFILE_TABLE);
  settingsRepository = createSqliteAppSettingsRepository(db as unknown as SQLiteDatabase);
  resetStores();
});

describe('profile hydration', () => {
  it('mirrors an existing user_profile row into profileStore', async () => {
    const repository = createSqliteUserProfileRepository(db as unknown as SQLiteDatabase);
    await repository.saveProfile(PROFILE);

    // Before hydration the guard has nothing to route on.
    expect(useProfileStore.getState().onboardingCompleted).toBe(false);

    const loaded = await repository.getProfile();
    expect(loaded).not.toBeNull();
    useProfileStore.getState().hydrateProfile(loaded as UserProfile);

    const state = useProfileStore.getState();
    expect(state.scoreType).toBe('SAY');
    expect(state.gradeLevel).toBe('grade_12');
    expect(state.onboardingCompleted).toBe(true);
  });

  it('leaves the stored row untouched when the read fails', async () => {
    const repository = createSqliteUserProfileRepository(db as unknown as SQLiteDatabase);
    await repository.saveProfile(PROFILE);

    db.failReads = true;
    await expect(repository.getProfile()).rejects.toThrow(/SQLITE_READ_FAILED/);
    db.failReads = false;

    expect(await db.getAllAsync('SELECT * FROM user_profile;')).toHaveLength(1);
  });
});

describe('theme selection isolation', () => {
  it('persists the chosen theme without clearing profileStore', async () => {
    useProfileStore.getState().hydrateProfile(PROFILE);
    const profileBefore = useProfileStore.getState();

    const selection = createThemePreferenceSelection({
      persist: (preference) => settingsRepository.setThemePreference(preference),
    });

    selection.hydrate(await settingsRepository.getThemePreference());
    await selection.select('dark');

    expect(await settingsRepository.getThemePreference()).toBe('dark');
    expect(selection.getState()).toEqual({ confirmed: 'dark', visible: 'dark' });
    // The profile state is identical, reference-wise: nothing reset it.
    expect(useProfileStore.getState()).toBe(profileBefore);
    expect(useProfileStore.getState().scoreType).toBe('SAY');
    expect(useProfileStore.getState().onboardingCompleted).toBe(true);
  });

  it('leaves topic and exam stores unchanged while the theme is selected', async () => {
    const progressBefore = useTopicStore.getState().progressByTopicId;
    const examsBefore = useExamStore.getState().examsById;

    useTopicStore.getState().setProgress(TOPIC_PROGRESS);
    useExamStore.getState().setExam(EXAM);

    const selection = createThemePreferenceSelection({
      persist: (preference) => settingsRepository.setThemePreference(preference),
    });

    await selection.select('light');
    await selection.select('system');

    expect(useTopicStore.getState().progressByTopicId['tyt_turkce_1']).toEqual(TOPIC_PROGRESS);
    expect(useExamStore.getState().examsById['e1']).toEqual(EXAM);
    expect(progressBefore).toEqual({});
    expect(examsBefore).toEqual({});
  });

  it('reports a failed settings read without deleting the stored preference', async () => {
    await settingsRepository.setThemePreference('dark');

    db.failReads = true;
    await expect(settingsRepository.getThemePreference()).rejects.toThrow(/SQLITE_READ_FAILED/);
    db.failReads = false;

    expect(await db.getAllAsync('SELECT value FROM app_settings;')).toEqual([{ value: 'dark' }]);
  });
});
