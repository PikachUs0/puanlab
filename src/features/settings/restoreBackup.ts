import type { SQLiteDatabase } from 'expo-sqlite';

import { THEME_PREFERENCE_KEY } from '@/db/repositories/sqliteAppSettingsRepository';
import { assertExamConsistent } from '@/features/exams/examCalculations';
import { useExamStore, useProfileStore, useTopicStore } from '@/store';
import type { ThemePreference } from '@/types';

import { parseBackup, type PuanLabBackup } from './backupFormat';

const PROFILE_ID = 1;

export type RestoreBackupOptions = {
  db: SQLiteDatabase | null;
  backup: PuanLabBackup;
  /**
   * Applies the restored theme to the in-memory theme state without writing it
   * again (the row was already written inside the restore transaction).
   */
  applyThemePreference: (preference: ThemePreference) => void;
  /** Injectable clock for the `app_settings.updated_at` value. */
  now?: () => Date;
};

async function countRows(
  db: SQLiteDatabase,
  table: 'user_profile' | 'topic_progress' | 'practice_exams' | 'practice_exam_results',
): Promise<number> {
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) AS count FROM ${table};`,
  );

  return row?.count ?? 0;
}

/**
 * Verifies inside the transaction that every expected row exists. Any mismatch
 * throws, so the transaction rolls back and the previous data survives.
 */
async function verifyRestoredRows(db: SQLiteDatabase, backup: PuanLabBackup): Promise<void> {
  const { profile, topicProgress, practiceExams, settings } = backup.data;
  const expectedResults = practiceExams.reduce(
    (total, exam) => total + exam.results.length,
    0,
  );

  const profileCount = await countRows(db, 'user_profile');
  const topicCount = await countRows(db, 'topic_progress');
  const examCount = await countRows(db, 'practice_exams');
  const resultCount = await countRows(db, 'practice_exam_results');

  if (profileCount !== (profile === null ? 0 : 1)) {
    throw new Error('Yedek geri yüklenemedi: profil satırı doğrulanamadı.');
  }

  if (topicCount !== topicProgress.length) {
    throw new Error('Yedek geri yüklenemedi: konu ilerlemeleri doğrulanamadı.');
  }

  if (examCount !== practiceExams.length) {
    throw new Error('Yedek geri yüklenemedi: denemeler doğrulanamadı.');
  }

  if (resultCount !== expectedResults) {
    throw new Error('Yedek geri yüklenemedi: deneme sonuçları doğrulanamadı.');
  }

  const themeRow = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM app_settings WHERE key = ?;',
    [THEME_PREFERENCE_KEY],
  );

  if (!themeRow || themeRow.value !== settings.themePreference) {
    throw new Error('Yedek geri yüklenemedi: tema tercihi doğrulanamadı.');
  }
}

/**
 * Fully replaces the active user data with the backup, inside one SQLite
 * transaction. The current data is only deleted once the backup has been
 * validated, and any failure rolls the whole replacement back.
 *
 * In-memory stores are hydrated only after the transaction has committed.
 */
export async function restoreBackup({
  db,
  backup,
  applyThemePreference,
  now = () => new Date(),
}: RestoreBackupOptions): Promise<void> {
  if (db === null) {
    throw new Error('Yedek geri yüklenemedi: veritabanına erişilemiyor.');
  }

  // Re-validate immediately before writing so no caller can bypass the rules.
  const validation = parseBackup(backup);

  if (!validation.valid) {
    throw new Error(validation.message);
  }

  const restored = validation.backup;
  const { profile, topicProgress, practiceExams, settings } = restored.data;
  const themeUpdatedAt = now().toISOString();

  await db.withTransactionAsync(async () => {
    // Children before parents; only the theme row of `app_settings` is removed.
    await db.runAsync('DELETE FROM practice_exam_results;');
    await db.runAsync('DELETE FROM practice_exams;');
    await db.runAsync('DELETE FROM topic_progress;');
    await db.runAsync('DELETE FROM user_profile;');
    await db.runAsync('DELETE FROM app_settings WHERE key = ?;', [THEME_PREFERENCE_KEY]);

    if (profile !== null) {
      await db.runAsync(
        `INSERT INTO user_profile
           (id, grade_level, score_type, target_department, target_university, onboarding_completed, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
        [
          PROFILE_ID,
          profile.gradeLevel,
          profile.scoreType,
          profile.targetDepartment ?? null,
          profile.targetUniversity ?? null,
          profile.onboardingCompleted ? 1 : 0,
          profile.createdAt,
          profile.updatedAt,
        ],
      );
    }

    for (const progress of topicProgress) {
      await db.runAsync(
        `INSERT INTO topic_progress (topic_id, status, note, last_studied_at, updated_at)
         VALUES (?, ?, ?, ?, ?);`,
        [progress.topicId, progress.status, progress.note, progress.lastStudiedAt, progress.updatedAt],
      );
    }

    for (const exam of practiceExams) {
      // Reuses the shared exam rules instead of trusting the backup blindly.
      assertExamConsistent(exam);

      await db.runAsync(
        `INSERT INTO practice_exams
           (id, exam_type, score_type_snapshot, name, exam_date, total_correct, total_incorrect, total_blank, total_net, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        [
          exam.id,
          exam.type,
          exam.scoreTypeSnapshot,
          exam.name,
          exam.date,
          exam.totalCorrect,
          exam.totalIncorrect,
          exam.totalBlank,
          exam.totalNet,
          exam.createdAt,
          exam.updatedAt,
        ],
      );

      // Parent exam rows are always inserted before their lesson results.
      for (const result of exam.results) {
        await db.runAsync(
          `INSERT INTO practice_exam_results (exam_id, lesson_id, correct, incorrect, blank, net)
           VALUES (?, ?, ?, ?, ?, ?);`,
          [exam.id, result.lessonId, result.correct, result.incorrect, result.blank, result.net],
        );
      }
    }

    await db.runAsync(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES (?, ?, ?);`,
      [THEME_PREFERENCE_KEY, settings.themePreference, themeUpdatedAt],
    );

    await verifyRestoredRows(db, restored);
  });

  // SQLite committed: only now may the in-memory stores be replaced.
  const topicStore = useTopicStore.getState();
  topicStore.clearProgress();
  topicStore.setProgressBatch(restored.data.topicProgress);

  useExamStore.getState().hydrateExams(restored.data.practiceExams);

  const profileStore = useProfileStore.getState();

  if (restored.data.profile !== null) {
    profileStore.hydrateProfile(restored.data.profile);
  } else {
    profileStore.clearProfile();
  }

  applyThemePreference(restored.data.settings.themePreference);
}

export type RestoreBackupRunner = {
  isRunning: () => boolean;
  run: (options: RestoreBackupOptions) => Promise<void>;
};

/** Single-flight guard: a repeated import while one is running is a no-op. */
export function createRestoreBackupRunner(): RestoreBackupRunner {
  let running = false;

  return {
    isRunning: () => running,
    run: async (options) => {
      if (running) {
        return;
      }

      running = true;

      try {
        await restoreBackup(options);
      } finally {
        running = false;
      }
    },
  };
}
