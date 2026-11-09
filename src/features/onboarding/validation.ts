import type { OnboardingData, OnboardingDraft } from './types';

export type OnboardingErrors = {
  gradeLevel?: string;
  scoreType?: string;
};

export function validateOnboarding(draft: OnboardingDraft): OnboardingErrors {
  const errors: OnboardingErrors = {};

  if (draft.gradeLevel === null) {
    errors.gradeLevel = 'Sınıf düzeyi seçmelisin.';
  }

  if (draft.scoreType === null) {
    errors.scoreType = 'Puan türü seçmelisin.';
  }

  return errors;
}

export function hasOnboardingErrors(errors: OnboardingErrors): boolean {
  return Object.keys(errors).length > 0;
}

export function buildOnboardingData(draft: OnboardingDraft): OnboardingData | null {
  if (draft.gradeLevel === null || draft.scoreType === null) {
    return null;
  }

  const targetDepartment = draft.targetDepartment.trim();
  const targetUniversity = draft.targetUniversity.trim();

  return {
    gradeLevel: draft.gradeLevel,
    scoreType: draft.scoreType,
    targetDepartment: targetDepartment.length > 0 ? targetDepartment : undefined,
    targetUniversity: targetUniversity.length > 0 ? targetUniversity : undefined,
  };
}
