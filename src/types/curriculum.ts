import type { ExamType } from './exam';

/** A single study topic within a lesson. */
export type Topic = {
  id: string;
  name: string;
};

/** A lesson (ders) and the topics it contains. */
export type Lesson = {
  id: string;
  name: string;
  topics: Topic[];
};

/**
 * Score type a curriculum group targets, exactly as provided by the dataset.
 * `ALL` is used for exam types that are not split by score type (TYT).
 */
export type CurriculumScoreType = 'ALL' | 'SAY' | 'EA' | 'SOZ';

/**
 * A versioned curriculum for a given exam type (TYT / AYT) and score type.
 * Curriculums are static datasets; `version` identifies the release so stored
 * progress can be traced back to the curriculum it was created against.
 * Lesson/topic ids are expected to be stable and unique within a curriculum.
 */
export type Curriculum = {
  version: string;
  examType: ExamType;
  scoreType: CurriculumScoreType;
  lessons: Lesson[];
};
