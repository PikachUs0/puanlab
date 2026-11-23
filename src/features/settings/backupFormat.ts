import Constants from 'expo-constants';

import { getTopicById } from '@/data/curriculum';
import {
  GRADE_LEVELS,
  SCORE_TYPES,
  THEME_PREFERENCES,
  TOPIC_STATUSES,
} from '@/db/repositories';
import { SCHEMA_VERSION } from '@/db/schema';
import { checkExamConsistency } from '@/features/exams/examCalculations';
import type {
  GradeLevel,
  LessonResult,
  PracticeExam,
  ScoreType,
  ThemePreference,
  TopicProgress,
  TopicStatus,
  UserProfile,
} from '@/types';

/** Stable marker every PuanLab backup must carry. */
export const BACKUP_FORMAT = 'puanlab-backup';

/** Only this format version is generated and accepted by MVP 0.2. */
export const BACKUP_FORMAT_VERSION = 1;

/** Hard upper bound for a selected backup file (10 MB). */
export const MAX_BACKUP_BYTES = 10 * 1024 * 1024;

/**
 * Curriculum dataset version stored in the backup. Curriculum datasets declare
 * `version: '2026'` as a string; the backup uses the numeric form so the file
 * stays comparable across implementations.
 */
export const CURRICULUM_VERSION = 2026;

export const INVALID_BACKUP_MESSAGE = 'Bu dosya geçerli bir PuanLab yedeği değil.';

export const UNSUPPORTED_BACKUP_VERSION_MESSAGE =
  'Bu yedek, uygulamanın daha yeni bir sürümüyle oluşturulmuş.';

export const BACKUP_FILE_PREFIX = 'puanlab-yedek';
export const BACKUP_FILE_EXTENSION = '.json';

const FALLBACK_APP_VERSION = '0.1.0';

export type BackupSettings = {
  themePreference: ThemePreference;
};

export type PuanLabBackupData = {
  profile: UserProfile | null;
  topicProgress: TopicProgress[];
  practiceExams: PracticeExam[];
  settings: BackupSettings;
};

/** Canonical, versioned PuanLab backup document. */
export type PuanLabBackup = {
  format: typeof BACKUP_FORMAT;
  formatVersion: number;
  exportedAt: string;
  appVersion: string;
  schemaVersion: number;
  curriculumVersion: number;
  data: PuanLabBackupData;
};

export type BackupValidationFailureReason = 'invalid' | 'unsupported_version';

export type BackupValidationResult =
  | { valid: true; backup: PuanLabBackup }
  | { valid: false; reason: BackupValidationFailureReason; message: string };

/** Raised internally while reading an untrusted backup shape. */
class InvalidBackupShapeError extends Error {
  constructor(reason: string) {
    super(`Invalid backup: ${reason}`);
    this.name = 'InvalidBackupShapeError';
  }
}

function requireValid(condition: unknown, reason: string): asserts condition {
  if (!condition) {
    throw new InvalidBackupShapeError(reason);
  }
}

function invalidBackup(): BackupValidationResult {
  return { valid: false, reason: 'invalid', message: INVALID_BACKUP_MESSAGE };
}

function unsupportedBackupVersion(): BackupValidationResult {
  return {
    valid: false,
    reason: 'unsupported_version',
    message: UNSUPPORTED_BACKUP_VERSION_MESSAGE,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * `new Date()` accepts loose, locale-ish input ("3 Mart 2026"), so the shape is
 * checked first and the parser only confirms the calendar value.
 */
function isIsoTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    ISO_TIMESTAMP_PATTERN.test(value) &&
    !Number.isNaN(new Date(value).getTime())
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isOneOf<T extends string>(allowed: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

/** UTF-8 byte length without relying on platform text encoders. */
export function utf8ByteLength(value: string): number {
  let bytes = 0;

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);

    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      // Surrogate pair: a single 4-byte code point.
      bytes += 4;
      index += 1;
    } else {
      bytes += 3;
    }
  }

  return bytes;
}

export function isWithinBackupSizeLimit(byteLength: number): boolean {
  return (
    Number.isFinite(byteLength) && byteLength >= 0 && byteLength <= MAX_BACKUP_BYTES
  );
}

/** Runs on the app build, not the exported metadata. */
export function getAppVersion(): string {
  return Constants.expoConfig?.version ?? FALLBACK_APP_VERSION;
}

/**
 * File name uses the device's local calendar date so the name matches what the
 * user sees. The `exportedAt` field stays UTC.
 */
export function buildBackupFileName(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${BACKUP_FILE_PREFIX}-${year}-${month}-${day}${BACKUP_FILE_EXTENSION}`;
}

/** Readable, UTF-8 JSON with stable two-space indentation. */
export function serializeBackup(backup: PuanLabBackup): string {
  return JSON.stringify(backup, null, 2);
}

function readProfile(value: unknown): UserProfile | null {
  if (value === null) {
    return null;
  }

  requireValid(isRecord(value), 'profile must be an object or null');
  requireValid(isOneOf(GRADE_LEVELS, value.gradeLevel), 'profile.gradeLevel');
  requireValid(isOneOf(SCORE_TYPES, value.scoreType), 'profile.scoreType');
  requireValid(
    typeof value.onboardingCompleted === 'boolean',
    'profile.onboardingCompleted',
  );
  requireValid(
    value.targetDepartment === undefined || typeof value.targetDepartment === 'string',
    'profile.targetDepartment',
  );
  requireValid(
    value.targetUniversity === undefined || typeof value.targetUniversity === 'string',
    'profile.targetUniversity',
  );
  requireValid(isIsoTimestamp(value.createdAt), 'profile.createdAt');
  requireValid(isIsoTimestamp(value.updatedAt), 'profile.updatedAt');

  // Rebuilt from known fields only: unknown future fields are ignored.
  return {
    gradeLevel: value.gradeLevel as GradeLevel,
    scoreType: value.scoreType as ScoreType,
    ...(typeof value.targetDepartment === 'string'
      ? { targetDepartment: value.targetDepartment }
      : {}),
    ...(typeof value.targetUniversity === 'string'
      ? { targetUniversity: value.targetUniversity }
      : {}),
    onboardingCompleted: value.onboardingCompleted,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function readTopicProgress(value: unknown): TopicProgress[] {
  requireValid(Array.isArray(value), 'data.topicProgress must be an array');

  const seenTopicIds = new Set<string>();

  return value.map((entry) => {
    requireValid(isRecord(entry), 'topicProgress entry must be an object');
    requireValid(isNonEmptyString(entry.topicId), 'topicProgress.topicId');
    requireValid(
      getTopicById(entry.topicId) !== null,
      `unknown topic id "${entry.topicId}"`,
    );
    requireValid(
      !seenTopicIds.has(entry.topicId),
      `duplicate topic id "${entry.topicId}"`,
    );
    seenTopicIds.add(entry.topicId);

    requireValid(isOneOf(TOPIC_STATUSES, entry.status), 'topicProgress.status');
    requireValid(
      entry.note === null || typeof entry.note === 'string',
      'topicProgress.note',
    );
    requireValid(
      entry.lastStudiedAt === null || isIsoTimestamp(entry.lastStudiedAt),
      'topicProgress.lastStudiedAt',
    );
    requireValid(isIsoTimestamp(entry.updatedAt), 'topicProgress.updatedAt');

    return {
      topicId: entry.topicId,
      status: entry.status as TopicStatus,
      note: entry.note as string | null,
      lastStudiedAt: entry.lastStudiedAt as string | null,
      updatedAt: entry.updatedAt,
    };
  });
}

function readLessonResults(value: unknown): LessonResult[] {
  requireValid(Array.isArray(value), 'exam.results must be an array');

  const seenLessonIds = new Set<string>();

  return value.map((entry) => {
    requireValid(isRecord(entry), 'lesson result must be an object');
    requireValid(isNonEmptyString(entry.lessonId), 'lesson result.lessonId');
    requireValid(
      !seenLessonIds.has(entry.lessonId),
      `duplicate lesson id "${entry.lessonId}"`,
    );
    seenLessonIds.add(entry.lessonId);

    requireValid(isCount(entry.correct), 'lesson result.correct');
    requireValid(isCount(entry.incorrect), 'lesson result.incorrect');
    requireValid(isCount(entry.blank), 'lesson result.blank');
    requireValid(isFiniteNumber(entry.net), 'lesson result.net');

    return {
      lessonId: entry.lessonId,
      correct: entry.correct,
      incorrect: entry.incorrect,
      blank: entry.blank,
      net: entry.net,
    };
  });
}

function readPracticeExams(value: unknown): PracticeExam[] {
  requireValid(Array.isArray(value), 'data.practiceExams must be an array');

  const seenExamIds = new Set<string>();

  return value.map((entry) => {
    requireValid(isRecord(entry), 'exam must be an object');
    requireValid(isNonEmptyString(entry.id), 'exam.id');
    requireValid(!seenExamIds.has(entry.id), `duplicate exam id "${entry.id}"`);
    seenExamIds.add(entry.id);

    requireValid(entry.type === 'TYT' || entry.type === 'AYT', 'exam.type');
    requireValid(
      isOneOf(SCORE_TYPES, entry.scoreTypeSnapshot),
      'exam.scoreTypeSnapshot',
    );
    requireValid(typeof entry.name === 'string', 'exam.name');
    requireValid(isIsoTimestamp(entry.date), 'exam.date');
    requireValid(isIsoTimestamp(entry.createdAt), 'exam.createdAt');
    requireValid(isIsoTimestamp(entry.updatedAt), 'exam.updatedAt');
    requireValid(isFiniteNumber(entry.totalCorrect), 'exam.totalCorrect');
    requireValid(isFiniteNumber(entry.totalIncorrect), 'exam.totalIncorrect');
    requireValid(isFiniteNumber(entry.totalBlank), 'exam.totalBlank');
    requireValid(isFiniteNumber(entry.totalNet), 'exam.totalNet');

    const exam: PracticeExam = {
      id: entry.id,
      type: entry.type,
      scoreTypeSnapshot: entry.scoreTypeSnapshot as ScoreType,
      name: entry.name,
      date: entry.date,
      results: readLessonResults(entry.results),
      totalCorrect: entry.totalCorrect,
      totalIncorrect: entry.totalIncorrect,
      totalBlank: entry.totalBlank,
      totalNet: entry.totalNet,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    };

    // Reuses the single exam rule set: sections belong to the exam definition,
    // derived blank/net match, and totals equal the sum of the sections.
    requireValid(checkExamConsistency(exam).consistent, `exam "${exam.id}" consistency`);

    return exam;
  });
}

function readSettings(value: unknown): BackupSettings {
  requireValid(isRecord(value), 'data.settings must be an object');
  requireValid(
    isOneOf(THEME_PREFERENCES, value.themePreference),
    'settings.themePreference',
  );

  return { themePreference: value.themePreference as ThemePreference };
}

function readBackup(input: Record<string, unknown>): PuanLabBackup {
  requireValid(isIsoTimestamp(input.exportedAt), 'exportedAt');
  requireValid(isNonEmptyString(input.appVersion), 'appVersion');
  requireValid(input.schemaVersion === SCHEMA_VERSION, 'schemaVersion');
  requireValid(input.curriculumVersion === CURRICULUM_VERSION, 'curriculumVersion');
  requireValid(isRecord(input.data), 'data must be an object');

  const data = input.data;

  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: input.exportedAt,
    appVersion: input.appVersion,
    schemaVersion: input.schemaVersion,
    curriculumVersion: input.curriculumVersion,
    data: {
      profile: readProfile(data.profile),
      topicProgress: readTopicProgress(data.topicProgress),
      practiceExams: readPracticeExams(data.practiceExams),
      settings: readSettings(data.settings),
    },
  };
}

/**
 * Validates an untrusted parsed document. `format` and `formatVersion` are
 * always checked first; a newer format version resolves to the calm
 * "created by a newer version" message instead of a generic error.
 */
export function parseBackup(input: unknown): BackupValidationResult {
  if (!isRecord(input)) {
    return invalidBackup();
  }

  if (input.format !== BACKUP_FORMAT) {
    return invalidBackup();
  }

  if (
    typeof input.formatVersion !== 'number' ||
    !Number.isInteger(input.formatVersion) ||
    input.formatVersion < 1
  ) {
    return invalidBackup();
  }

  if (input.formatVersion > BACKUP_FORMAT_VERSION) {
    return unsupportedBackupVersion();
  }

  if (input.formatVersion !== BACKUP_FORMAT_VERSION) {
    return invalidBackup();
  }

  try {
    return { valid: true, backup: readBackup(input) };
  } catch {
    // Any structural problem rejects the whole file: a backup is imported
    // completely or not at all.
    return invalidBackup();
  }
}

/** Parses and validates raw file text; oversized or malformed text is rejected. */
export function parseBackupText(text: string): BackupValidationResult {
  if (!isWithinBackupSizeLimit(utf8ByteLength(text))) {
    return invalidBackup();
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    return invalidBackup();
  }

  return parseBackup(parsed);
}
