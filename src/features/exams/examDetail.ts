/**
 * Pure read-only helpers for the practice exam detail screen.
 *
 * Everything here is a plain function over plain data: no React, no React
 * Native, no Zustand, no SQLite. Lesson names and question counts are never
 * repeated here — they are always resolved through the central
 * `examDefinitions` module, and the official section order comes from
 * `orderLessonResults`.
 */

import type { LessonResult, PracticeExam } from '@/types';

import { orderLessonResults } from './examCalculations';
import { getExamLessonDefinition } from './examDefinitions';

/** One display row of an exam's section breakdown. */
export type ExamLessonRow = {
  lessonId: string;
  name: string;
  /** Official question count, or `null` when the lesson id is not part of the exam. */
  questionCount: number | null;
  correct: number;
  incorrect: number;
  blank: number;
  net: number;
};

/** Which body the detail route renders. */
export type ExamDetailStatus = 'loading' | 'not_found' | 'ready';

/** Coerces a missing or non-finite stored value into a finite number for display. */
function toFiniteNumber(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function isUsableResult(result: LessonResult | null | undefined): result is LessonResult {
  return Boolean(result) && typeof result?.lessonId === 'string';
}

/**
 * Builds the display rows of an exam's sections.
 *
 * Results follow the official definition order (unknown lesson ids are appended
 * last) and every name/question count is resolved through the central exam
 * definition. Malformed historical data — unknown ids, missing or non-finite
 * values — is handled safely and never throws.
 */
export function buildExamLessonRows(exam: PracticeExam): ExamLessonRow[] {
  const results = (Array.isArray(exam.results) ? exam.results : []).filter(isUsableResult);

  return orderLessonResults(exam.type, exam.scoreTypeSnapshot, results).map((result) => {
    const lesson = getExamLessonDefinition(exam.type, exam.scoreTypeSnapshot, result.lessonId);

    return {
      lessonId: result.lessonId,
      name: lesson?.name ?? result.lessonId,
      questionCount: lesson ? lesson.questionCount : null,
      correct: toFiniteNumber(result.correct),
      incorrect: toFiniteNumber(result.incorrect),
      blank: toFiniteNumber(result.blank),
      net: toFiniteNumber(result.net),
    };
  });
}

/** Normalizes the route's `id` search param into a single non-empty string. */
export function normalizeExamIdParam(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;

  if (typeof raw !== 'string') {
    return null;
  }

  const trimmed = raw.trim();

  return trimmed.length > 0 ? trimmed : null;
}

/** Decides which state the detail route renders; never throws on a missing id. */
export function resolveExamDetailStatus(params: {
  isHydrated: boolean;
  examId: string | null;
  exam: PracticeExam | null;
}): ExamDetailStatus {
  if (!params.isHydrated) {
    return 'loading';
  }

  if (!params.examId || !params.exam) {
    return 'not_found';
  }

  return 'ready';
}
