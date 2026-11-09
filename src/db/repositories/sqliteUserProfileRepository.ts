import type { SQLiteDatabase } from 'expo-sqlite';

import type { GradeLevel, ScoreType, UserProfile } from '@/types';

import type { UserProfileRepository } from './userProfileRepository';

/** MVP 0.1 models the profile as a singleton row with a fixed id. */
const PROFILE_ID = 1;

type UserProfileRow = {
  grade_level: string;
  score_type: string;
  target_department: string | null;
  target_university: string | null;
  onboarding_completed: number;
  created_at: string;
  updated_at: string;
};

const GRADE_LEVELS: readonly GradeLevel[] = ['grade_11', 'grade_12', 'graduate'];
const SCORE_TYPES: readonly ScoreType[] = ['SAY', 'EA', 'SOZ', 'DIL'];

const SELECT_COLUMNS =
  'grade_level, score_type, target_department, target_university, onboarding_completed, created_at, updated_at';

function isGradeLevel(value: string): value is GradeLevel {
  return (GRADE_LEVELS as readonly string[]).includes(value);
}

function isScoreType(value: string): value is ScoreType {
  return (SCORE_TYPES as readonly string[]).includes(value);
}

/** The database is a trust boundary: only valid ISO 8601 strings are accepted. */
function isValidIsoDate(value: string): boolean {
  return !Number.isNaN(new Date(value).getTime());
}

/**
 * Raised when a persisted row exists but cannot be read as a valid profile.
 * The row is intentionally left untouched (never deleted) so it can be
 * inspected or repaired later; callers fall back to onboarding.
 */
class CorruptedUserProfileError extends Error {
  constructor(reason: string) {
    super(`user_profile row is invalid: ${reason}`);
    this.name = 'CorruptedUserProfileError';
  }
}

function toUserProfile(row: UserProfileRow): UserProfile {
  if (!isGradeLevel(row.grade_level)) {
    throw new CorruptedUserProfileError(`unknown grade_level "${row.grade_level}"`);
  }

  if (!isScoreType(row.score_type)) {
    throw new CorruptedUserProfileError(`unknown score_type "${row.score_type}"`);
  }

  if (!isValidIsoDate(row.created_at)) {
    throw new CorruptedUserProfileError(`created_at "${row.created_at}" is not ISO 8601`);
  }

  if (!isValidIsoDate(row.updated_at)) {
    throw new CorruptedUserProfileError(`updated_at "${row.updated_at}" is not ISO 8601`);
  }

  return {
    gradeLevel: row.grade_level,
    scoreType: row.score_type,
    targetDepartment: row.target_department ?? undefined,
    targetUniversity: row.target_university ?? undefined,
    onboardingCompleted: row.onboarding_completed === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** SQLite-backed implementation of the `UserProfileRepository` contract. */
export function createSqliteUserProfileRepository(db: SQLiteDatabase): UserProfileRepository {
  return {
    getProfile: async () => {
      const row = await db.getFirstAsync<UserProfileRow>(
        `SELECT ${SELECT_COLUMNS} FROM user_profile WHERE id = ?;`,
        [PROFILE_ID],
      );

      return row ? toUserProfile(row) : null;
    },

    // Upsert into the single fixed-id row: repeated saves can never create a
    // second profile, they only replace the existing one.
    saveProfile: async (profile) => {
      await db.runAsync(
        `INSERT INTO user_profile
           (id, grade_level, score_type, target_department, target_university, onboarding_completed, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           grade_level = excluded.grade_level,
           score_type = excluded.score_type,
           target_department = excluded.target_department,
           target_university = excluded.target_university,
           onboarding_completed = excluded.onboarding_completed,
           created_at = excluded.created_at,
           updated_at = excluded.updated_at;`,
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
    },

    // Edits keep the original `created_at`; only `updated_at` moves forward.
    updateProfile: async (profile) => {
      await db.runAsync(
        `UPDATE user_profile SET
           grade_level = ?,
           score_type = ?,
           target_department = ?,
           target_university = ?,
           onboarding_completed = ?,
           updated_at = ?
         WHERE id = ?;`,
        [
          profile.gradeLevel,
          profile.scoreType,
          profile.targetDepartment ?? null,
          profile.targetUniversity ?? null,
          profile.onboardingCompleted ? 1 : 0,
          profile.updatedAt,
          PROFILE_ID,
        ],
      );
    },

    clearProfile: async () => {
      await db.runAsync('DELETE FROM user_profile WHERE id = ?;', [PROFILE_ID]);
    },
  };
}
