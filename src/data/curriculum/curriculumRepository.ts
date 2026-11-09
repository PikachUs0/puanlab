import type { Curriculum, CurriculumScoreType, ExamType } from '@/types';

/**
 * Read contract for curriculum datasets.
 *
 * Curriculums are static, versioned data bundled with the app rather than rows
 * in SQLite, so this contract is kept separate from the database repositories.
 * A curriculum is identified by its exam type (TYT / AYT) and score type
 * (`ALL` for TYT, `SAY` / `EA` / `SOZ` for AYT).
 */
export type CurriculumRepository = {
  /** Returns the requested version of a group, or the active one when `version` is omitted. */
  getCurriculum: (
    examType: ExamType,
    scoreType: CurriculumScoreType,
    version?: string,
  ) => Curriculum | null;
  /** All bundles for an exam type, optionally narrowed to one score type, newest first. */
  listCurricula: (
    examType: ExamType,
    scoreType?: CurriculumScoreType,
  ) => readonly Curriculum[];
  /** All bundled versions for a group, newest first. */
  listCurriculumVersions: (
    examType: ExamType,
    scoreType: CurriculumScoreType,
  ) => readonly Curriculum[];
};
