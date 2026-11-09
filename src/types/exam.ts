import type { ScoreType } from './profile';

export type ExamType = 'TYT' | 'AYT';

/**
 * Per-lesson (exam section) breakdown of a practice exam.
 * `lessonId` is an exam-section identifier, not a curriculum lesson id.
 * `blank` and `net` are always derived (`blank = total - correct - incorrect`,
 * `net = correct - incorrect / 4`), never taken from user input.
 */
export type LessonResult = {
  lessonId: string;
  correct: number;
  incorrect: number;
  blank: number;
  net: number;
};

/**
 * Canonical practice exam for MVP 0.1.
 *
 * All timestamps (`date`, `createdAt`, `updatedAt`) are ISO 8601 strings.
 * `scoreTypeSnapshot` records the profile score type the exam was created for
 * and is frozen at creation time: a later profile change must never alter an
 * existing exam's lesson composition.
 */
export type PracticeExam = {
  id: string;
  type: ExamType;
  scoreTypeSnapshot: ScoreType;
  name: string;
  date: string;
  results: LessonResult[];
  totalCorrect: number;
  totalIncorrect: number;
  totalBlank: number;
  totalNet: number;
  createdAt: string;
  updatedAt: string;
};
