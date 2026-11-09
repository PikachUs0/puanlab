/** Persisted grade level. Technical values are stable and never localised. */
export type GradeLevel = 'grade_11' | 'grade_12' | 'graduate';

/** Persisted score type. Technical values are stable and never localised. */
export type ScoreType = 'SAY' | 'EA' | 'SOZ' | 'DIL';

/**
 * Canonical user profile for MVP 0.1, persisted as a singleton row (id = 1).
 * Timestamps are ISO 8601 strings generated with `new Date().toISOString()`.
 */
export type UserProfile = {
  gradeLevel: GradeLevel;
  scoreType: ScoreType;
  targetDepartment?: string;
  targetUniversity?: string;
  onboardingCompleted: boolean;
  createdAt: string;
  updatedAt: string;
};
