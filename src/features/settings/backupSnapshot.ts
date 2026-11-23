import type { SQLiteDatabase } from 'expo-sqlite';

import {
  createSqliteAppSettingsRepository,
  createSqlitePracticeExamRepository,
  createSqliteTopicProgressRepository,
  createSqliteUserProfileRepository,
} from '@/db/repositories';
import { SCHEMA_VERSION } from '@/db/schema';
import { sortExamsNewestFirst } from '@/features/exams/examCalculations';
import type { PracticeExam, ThemePreference, TopicProgress, UserProfile } from '@/types';

import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  CURRICULUM_VERSION,
  getAppVersion,
  parseBackup,
  type PuanLabBackup,
} from './backupFormat';

export type BuildBackupSnapshotOptions = {
  db: SQLiteDatabase;
  /** Injectable clock so `exportedAt` and the file name stay deterministic in tests. */
  now?: () => Date;
  /** Build metadata; defaults to the running app version. */
  appVersion?: string;
};

type BackupSnapshot = {
  profile: UserProfile | null;
  topicProgress: TopicProgress[];
  practiceExams: PracticeExam[];
  themePreference: ThemePreference;
};

function compareTopicIds(a: TopicProgress, b: TopicProgress): number {
  if (a.topicId === b.topicId) {
    return 0;
  }

  return a.topicId < b.topicId ? -1 : 1;
}

/**
 * Reads every exported record from one SQLite transaction and returns the
 * canonical backup document. Read-only: nothing is written, and repositories
 * are only queried (they never open a nested write transaction here).
 *
 * The generated document is validated before it is returned, so an invalid
 * backup can never reach the file system.
 */
export async function buildBackupSnapshot({
  db,
  now = () => new Date(),
  appVersion = getAppVersion(),
}: BuildBackupSnapshotOptions): Promise<PuanLabBackup> {
  const profileRepository = createSqliteUserProfileRepository(db);
  const topicProgressRepository = createSqliteTopicProgressRepository(db);
  const practiceExamRepository = createSqlitePracticeExamRepository(db);
  const appSettingsRepository = createSqliteAppSettingsRepository(db);

  // Held in an object because the snapshot is assigned inside the transaction
  // callback, which the compiler does not trace back to this scope.
  const holder: { snapshot: BackupSnapshot | null } = { snapshot: null };

  // One transaction gives a consistent view even if another write is queued
  // between the awaits below.
  await db.withTransactionAsync(async () => {
    const profile = await profileRepository.getProfile();
    const topicProgress = await topicProgressRepository.getAll();
    const practiceExams = await practiceExamRepository.getAll();
    const themePreference = await appSettingsRepository.getThemePreference();

    holder.snapshot = { profile, topicProgress, practiceExams, themePreference };
  });

  const snapshot = holder.snapshot;

  if (snapshot === null) {
    throw new Error('Yedek verisi okunamadı.');
  }

  const backup: PuanLabBackup = {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: now().toISOString(),
    appVersion,
    schemaVersion: SCHEMA_VERSION,
    curriculumVersion: CURRICULUM_VERSION,
    data: {
      profile: snapshot.profile,
      topicProgress: [...snapshot.topicProgress].sort(compareTopicIds),
      practiceExams: sortExamsNewestFirst(snapshot.practiceExams),
      settings: { themePreference: snapshot.themePreference },
    },
  };

  const validation = parseBackup(backup);

  if (!validation.valid) {
    throw new Error('Oluşturulan yedek doğrulanamadı.');
  }

  return validation.backup;
}
