import type { GradeLevel, ScoreType } from '@/types';

export type SelectOption<T extends string> = {
  value: T;
  label: string;
};

export const GRADE_LEVEL_OPTIONS: readonly SelectOption<GradeLevel>[] = [
  { value: 'grade_11', label: '11. Sınıf' },
  { value: 'grade_12', label: '12. Sınıf' },
  { value: 'graduate', label: 'Mezun' },
];

export const SCORE_TYPE_OPTIONS: readonly SelectOption<ScoreType>[] = [
  { value: 'SAY', label: 'SAY' },
  { value: 'EA', label: 'EA' },
  { value: 'SOZ', label: 'SÖZ' },
  { value: 'DIL', label: 'DİL' },
];

export type OnboardingData = {
  gradeLevel: GradeLevel;
  scoreType: ScoreType;
  targetDepartment?: string;
  targetUniversity?: string;
};

export type OnboardingDraft = {
  gradeLevel: GradeLevel | null;
  scoreType: ScoreType | null;
  targetDepartment: string;
  targetUniversity: string;
};
