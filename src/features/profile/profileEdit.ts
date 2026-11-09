import type { UserProfileRepository } from '@/db';
import { GRADE_LEVEL_OPTIONS, SCORE_TYPE_OPTIONS, type SelectOption } from '@/features/onboarding/types';
import type { GradeLevel, ScoreType, UserProfile } from '@/types';

/** Maximum length accepted for the optional target department / university. */
export const OPTIONAL_TARGET_MAX_LENGTH = 80;

/** Shown wherever an optional target field has no value. */
export const OPTIONAL_TARGET_EMPTY_LABEL = 'Belirtilmedi';

/**
 * Editable values of the profile form. The optional targets are kept as plain
 * strings (empty when unset) so a `TextInput` can bind to them directly; they
 * are trimmed and normalised when the update is built.
 */
export type ProfileDraft = {
  gradeLevel: GradeLevel;
  scoreType: ScoreType;
  targetDepartment: string;
  targetUniversity: string;
};

function findLabel<T extends string>(options: readonly SelectOption<T>[], value: T): string {
  return options.find((option) => option.value === value)?.label ?? value;
}

/** Visible Turkish label for a stored grade level (never the technical value). */
export function formatGradeLevelLabel(value: GradeLevel): string {
  return findLabel(GRADE_LEVEL_OPTIONS, value);
}

/** Visible Turkish label for a stored score type (`SOZ` -> `SÖZ`, `DIL` -> `DİL`). */
export function formatScoreTypeLabel(value: ScoreType): string {
  return findLabel(SCORE_TYPE_OPTIONS, value);
}

/** Trims a target field and enforces the maximum length. */
export function normalizeTargetText(value: string): string {
  return value.trim().slice(0, OPTIONAL_TARGET_MAX_LENGTH);
}

/** Trailing whitespace and overflow are removed; an empty target is `undefined`. */
export function toProfileTarget(value: string): string | undefined {
  const normalized = normalizeTargetText(value);
  return normalized.length > 0 ? normalized : undefined;
}

/** Displays an optional target, falling back to `Belirtilmedi` when it is empty. */
export function formatOptionalTarget(value: string | null | undefined): string {
  const normalized = typeof value === 'string' ? normalizeTargetText(value) : '';
  return normalized.length > 0 ? normalized : OPTIONAL_TARGET_EMPTY_LABEL;
}

/** Seeds the editable draft from a persisted profile. */
export function toProfileDraft(profile: UserProfile): ProfileDraft {
  return {
    gradeLevel: profile.gradeLevel,
    scoreType: profile.scoreType,
    targetDepartment: profile.targetDepartment ?? '',
    targetUniversity: profile.targetUniversity ?? '',
  };
}

/**
 * Builds the record to persist from an edited draft.
 *
 * `createdAt` is copied from the saved profile so an edit never rewrites the
 * profile's origin, and `updatedAt` moves forward to `now`.
 */
export function buildProfileUpdate(params: {
  savedProfile: UserProfile;
  draft: ProfileDraft;
  now: Date;
}): UserProfile {
  const { savedProfile, draft, now } = params;

  return {
    gradeLevel: draft.gradeLevel,
    scoreType: draft.scoreType,
    targetDepartment: toProfileTarget(draft.targetDepartment),
    targetUniversity: toProfileTarget(draft.targetUniversity),
    onboardingCompleted: savedProfile.onboardingCompleted,
    createdAt: savedProfile.createdAt,
    updatedAt: now.toISOString(),
  };
}

/**
 * Whether the draft differs from the saved profile. Optional targets are
 * compared after trimming, so a whitespace-only change is not "dirty".
 */
export function isProfileDraftDirty(savedProfile: UserProfile, draft: ProfileDraft): boolean {
  if (savedProfile.gradeLevel !== draft.gradeLevel) {
    return true;
  }

  if (savedProfile.scoreType !== draft.scoreType) {
    return true;
  }

  if (
    normalizeTargetText(savedProfile.targetDepartment ?? '') !==
    normalizeTargetText(draft.targetDepartment)
  ) {
    return true;
  }

  return (
    normalizeTargetText(savedProfile.targetUniversity ?? '') !==
    normalizeTargetText(draft.targetUniversity)
  );
}

export type SaveProfileUpdateParams = {
  /** The active repository, or `null` while the database is not ready. */
  repository: UserProfileRepository | null;
  savedProfile: UserProfile;
  draft: ProfileDraft;
  now: Date;
  /** Mirrors the saved record into the store; only called after SQLite accepted the write. */
  onSaved: (profile: UserProfile) => void;
};

/**
 * Persists an edited profile.
 *
 * The write happens first and `onSaved` (the store update) runs only after the
 * repository resolved, so a failed write can never leave the UI store and the
 * database out of sync. The profile is always updated through the repository's
 * `updateProfile`, which targets the singleton row and can never create a
 * second profile.
 */
export async function saveProfileUpdate(
  params: SaveProfileUpdateParams,
): Promise<UserProfile> {
  const { repository, savedProfile, draft, now, onSaved } = params;

  if (repository === null) {
    throw new Error('Profil kaydedilemedi: veritabanına erişilemiyor.');
  }

  const updated = buildProfileUpdate({ savedProfile, draft, now });

  await repository.updateProfile(updated);
  onSaved(updated);

  return updated;
}
