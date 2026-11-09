import type { UserProfileRepository } from '@/db';
import { availableExamTypes, calculateExamTotals, getExamDefinition, isExamSupported } from '@/features/exams';
import { useProfileStore } from '@/store';
import type { LessonResult, PracticeExam, UserProfile } from '@/types';

import {
  OPTIONAL_TARGET_EMPTY_LABEL,
  OPTIONAL_TARGET_MAX_LENGTH,
  buildProfileUpdate,
  formatGradeLevelLabel,
  formatOptionalTarget,
  formatScoreTypeLabel,
  isProfileDraftDirty,
  normalizeTargetText,
  saveProfileUpdate,
  toProfileDraft,
} from '../profileEdit';

/** Deterministic fixed dates: the real clock is never read by these tests. */
const CREATED_AT = '2026-01-05T07:30:00.000Z';
const FIXED_NOW = new Date('2026-11-09T06:00:00.000Z');

function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    gradeLevel: 'grade_12',
    scoreType: 'SAY',
    targetDepartment: undefined,
    targetUniversity: undefined,
    onboardingCompleted: true,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

const EXAM_RESULTS: LessonResult[] = [
  { lessonId: 'ayt_matematik', correct: 20, incorrect: 5, blank: 15, net: 18.75 },
  { lessonId: 'ayt_fizik', correct: 8, incorrect: 2, blank: 4, net: 7.5 },
];

function makeExam(): PracticeExam {
  return {
    id: 'exam-1',
    type: 'AYT',
    scoreTypeSnapshot: 'SAY',
    name: 'AYT Denemesi - 1',
    date: '2026-11-01T00:00:00.000Z',
    results: EXAM_RESULTS,
    ...calculateExamTotals(EXAM_RESULTS),
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
}

beforeEach(() => {
  useProfileStore.getState().clearProfile();
});

describe('profile labels', () => {
  it('maps grade technical values to Turkish labels', () => {
    expect(formatGradeLevelLabel('grade_11')).toBe('11. Sınıf');
    expect(formatGradeLevelLabel('grade_12')).toBe('12. Sınıf');
    expect(formatGradeLevelLabel('graduate')).toBe('Mezun');
  });

  it('displays SOZ as SÖZ', () => {
    expect(formatScoreTypeLabel('SOZ')).toBe('SÖZ');
  });

  it('displays DIL as DİL', () => {
    expect(formatScoreTypeLabel('DIL')).toBe('DİL');
  });

  it('displays an empty optional target as Belirtilmedi', () => {
    expect(formatOptionalTarget('')).toBe(OPTIONAL_TARGET_EMPTY_LABEL);
    expect(formatOptionalTarget('   ')).toBe(OPTIONAL_TARGET_EMPTY_LABEL);
    expect(formatOptionalTarget(null)).toBe(OPTIONAL_TARGET_EMPTY_LABEL);
    expect(formatOptionalTarget(undefined)).toBe(OPTIONAL_TARGET_EMPTY_LABEL);
    expect(formatOptionalTarget('  ODTÜ  ')).toBe('ODTÜ');
  });
});

describe('buildProfileUpdate', () => {
  it('preserves createdAt on an edited profile', () => {
    const saved = makeProfile();
    const draft = { ...toProfileDraft(saved), scoreType: 'EA' as const };

    const updated = buildProfileUpdate({ savedProfile: saved, draft, now: FIXED_NOW });

    expect(updated.createdAt).toBe(CREATED_AT);
  });

  it('changes updatedAt on an edited profile', () => {
    const saved = makeProfile();
    const draft = { ...toProfileDraft(saved), gradeLevel: 'graduate' as const };

    const updated = buildProfileUpdate({ savedProfile: saved, draft, now: FIXED_NOW });

    expect(updated.updatedAt).toBe(FIXED_NOW.toISOString());
    expect(updated.updatedAt).not.toBe(CREATED_AT);
  });

  it('trims optional fields and drops whitespace-only values', () => {
    const saved = makeProfile();
    const draft = {
      ...toProfileDraft(saved),
      targetDepartment: '  Bilgisayar Mühendisliği  ',
      targetUniversity: '   ',
    };

    const updated = buildProfileUpdate({ savedProfile: saved, draft, now: FIXED_NOW });

    expect(updated.targetDepartment).toBe('Bilgisayar Mühendisliği');
    expect(updated.targetUniversity).toBeUndefined();
  });

  it('enforces the 80-character limit on optional fields', () => {
    const long = 'a'.repeat(OPTIONAL_TARGET_MAX_LENGTH + 40);
    const saved = makeProfile();

    expect(normalizeTargetText(long)).toHaveLength(OPTIONAL_TARGET_MAX_LENGTH);

    const updated = buildProfileUpdate({
      savedProfile: saved,
      draft: { ...toProfileDraft(saved), targetUniversity: long },
      now: FIXED_NOW,
    });

    expect(updated.targetUniversity).toHaveLength(OPTIONAL_TARGET_MAX_LENGTH);
  });
});

describe('isProfileDraftDirty', () => {
  it('treats an unchanged profile as not dirty', () => {
    const saved = makeProfile({
      targetDepartment: 'Bilgisayar Mühendisliği',
      targetUniversity: 'ODTÜ',
    });

    expect(isProfileDraftDirty(saved, toProfileDraft(saved))).toBe(false);
    // Trailing whitespace alone is not a meaningful change.
    expect(
      isProfileDraftDirty(saved, {
        ...toProfileDraft(saved),
        targetDepartment: '  Bilgisayar Mühendisliği ',
      }),
    ).toBe(false);
    expect(
      isProfileDraftDirty(saved, { ...toProfileDraft(saved), targetUniversity: '' }),
    ).toBe(true);
  });

  it('treats a changed score type as dirty', () => {
    const saved = makeProfile({ scoreType: 'SAY' });

    expect(isProfileDraftDirty(saved, { ...toProfileDraft(saved), scoreType: 'EA' })).toBe(true);
  });

  it('treats a changed grade or target as dirty', () => {
    const saved = makeProfile();

    expect(isProfileDraftDirty(saved, { ...toProfileDraft(saved), gradeLevel: 'graduate' })).toBe(
      true,
    );
    expect(
      isProfileDraftDirty(saved, { ...toProfileDraft(saved), targetUniversity: 'ODTÜ' }),
    ).toBe(true);
  });
});

describe('score type change safety', () => {
  it('leaves an existing exam scoreTypeSnapshot unchanged after a profile update', () => {
    const exam = makeExam();
    const saved = makeProfile({ scoreType: 'SAY' });

    const updated = buildProfileUpdate({
      savedProfile: saved,
      draft: { ...toProfileDraft(saved), scoreType: 'EA' },
      now: FIXED_NOW,
    });

    expect(updated.scoreType).toBe('EA');
    // The exam keeps its own frozen snapshot and its AYT lesson composition.
    expect(exam.scoreTypeSnapshot).toBe('SAY');
    expect(getExamDefinition('AYT', exam.scoreTypeSnapshot)?.lessons.map((lesson) => lesson.lessonId))
      .toEqual(['ayt_matematik', 'ayt_fizik', 'ayt_kimya', 'ayt_biyoloji']);
  });

  it('stops new AYT definitions for a DIL profile without removing old AYT exams', () => {
    const exam = makeExam();
    const exams: PracticeExam[] = [exam];
    const countBefore = exams.length;

    const saved = makeProfile({ scoreType: 'SAY' });
    const updated = buildProfileUpdate({
      savedProfile: saved,
      draft: { ...toProfileDraft(saved), scoreType: 'DIL' },
      now: FIXED_NOW,
    });

    expect(updated.scoreType).toBe('DIL');
    expect(availableExamTypes(updated.scoreType)).toEqual(['TYT']);
    expect(isExamSupported('AYT', updated.scoreType)).toBe(false);

    // Already saved AYT exams are never touched by a profile change.
    expect(exams).toHaveLength(countBefore);
    expect(exams[0]).toEqual(exam);
    expect(isExamSupported('AYT', exams[0].scoreTypeSnapshot)).toBe(true);
  });
});

describe('saveProfileUpdate', () => {
  it('does not update the store when the repository write fails', async () => {
    const saved = makeProfile();
    const hydrateProfile = useProfileStore.getState().hydrateProfile;
    hydrateProfile(saved);

    const failingRepository: UserProfileRepository = {
      getProfile: async () => saved,
      saveProfile: async () => undefined,
      updateProfile: async () => {
        throw new Error('simulated write failure');
      },
      clearProfile: async () => undefined,
    };

    await expect(
      saveProfileUpdate({
        repository: failingRepository,
        savedProfile: saved,
        draft: { ...toProfileDraft(saved), scoreType: 'EA' },
        now: FIXED_NOW,
        onSaved: hydrateProfile,
      }),
    ).rejects.toThrow('simulated write failure');

    expect(useProfileStore.getState().scoreType).toBe('SAY');
  });

  it('does not update the store when no repository is available', async () => {
    const saved = makeProfile();
    const hydrateProfile = useProfileStore.getState().hydrateProfile;
    hydrateProfile(saved);

    await expect(
      saveProfileUpdate({
        repository: null,
        savedProfile: saved,
        draft: { ...toProfileDraft(saved), scoreType: 'EA' },
        now: FIXED_NOW,
        onSaved: hydrateProfile,
      }),
    ).rejects.toThrow();

    expect(useProfileStore.getState().scoreType).toBe('SAY');
  });
});
