import type { ExamType, LessonResult, PracticeExam, ScoreType } from '@/types';

import { getExamDefinition } from './examDefinitions';

/** Each incorrect answer cancels one quarter of a correct answer. */
export const NET_DIVISOR = 4;

/** Tolerance used only when comparing a stored net against a recomputed net. */
const NET_EPSILON = 1e-9;

function netsMatch(a: number, b: number): boolean {
  return Math.abs(a - b) < NET_EPSILON;
}

/** `blank = totalQuestions - correct - incorrect`. Derived, never user input. */
export function calculateBlank(
  totalQuestions: number,
  correct: number,
  incorrect: number,
): number {
  return totalQuestions - correct - incorrect;
}

/** `net = correct - incorrect / 4`, keeping full numerical precision. */
export function calculateNet(correct: number, incorrect: number): number {
  return correct - incorrect / NET_DIVISOR;
}

export type LessonResultInvalidReason = 'non_integer' | 'negative' | 'exceeds_total';

export type LessonResultValidation =
  | { valid: true }
  | { valid: false; reason: LessonResultInvalidReason };

/**
 * Validates raw user-entered counts for one exam section.
 * Correct and incorrect must be non-negative integers and their sum must not
 * exceed the section's question count (which also guarantees a non-negative
 * blank). `blank` and `net` are derived and are never validated as input.
 */
export function validateLessonResult(
  totalQuestions: number,
  correct: number,
  incorrect: number,
): LessonResultValidation {
  if (!Number.isInteger(correct) || !Number.isInteger(incorrect)) {
    return { valid: false, reason: 'non_integer' };
  }

  if (correct < 0 || incorrect < 0) {
    return { valid: false, reason: 'negative' };
  }

  if (correct + incorrect > totalQuestions) {
    return { valid: false, reason: 'exceeds_total' };
  }

  return { valid: true };
}

export type ExamTotals = {
  totalCorrect: number;
  totalIncorrect: number;
  totalBlank: number;
  totalNet: number;
};

/** Totals are always recalculated by summing the lesson results. */
export function calculateExamTotals(results: LessonResult[]): ExamTotals {
  let totalCorrect = 0;
  let totalIncorrect = 0;
  let totalBlank = 0;
  let totalNet = 0;

  for (const result of results) {
    totalCorrect += result.correct;
    totalIncorrect += result.incorrect;
    totalBlank += result.blank;
    totalNet += result.net;
  }

  return { totalCorrect, totalIncorrect, totalBlank, totalNet };
}

/** Raised when an exam is requested for a score type that has no definition. */
export class UnsupportedExamDefinitionError extends Error {
  constructor(
    public readonly examType: ExamType,
    public readonly scoreType: ScoreType,
  ) {
    super(`No exam definition is available for ${examType} / ${scoreType}.`);
    this.name = 'UnsupportedExamDefinitionError';
  }
}

/**
 * Builds the empty section list for an exam: every section starts with zero
 * correct/incorrect answers, so its blank equals the section's question count.
 * Throws when the exam is not defined for the score type (e.g. AYT for DIL).
 */
export function createDefaultLessonResults(
  examType: ExamType,
  scoreType: ScoreType,
): LessonResult[] {
  const definition = getExamDefinition(examType, scoreType);

  if (!definition) {
    throw new UnsupportedExamDefinitionError(examType, scoreType);
  }

  return definition.lessons.map((lesson) => ({
    lessonId: lesson.lessonId,
    correct: 0,
    incorrect: 0,
    blank: calculateBlank(lesson.questionCount, 0, 0),
    net: calculateNet(0, 0),
  }));
}

export type ExamConsistencyIssue =
  | 'unsupported_exam'
  | 'unknown_lesson'
  | 'invalid_lesson_result'
  | 'inconsistent_lesson_totals'
  | 'inconsistent_exam_totals';

export type ExamConsistencyResult =
  | { consistent: true }
  | { consistent: false; issue: ExamConsistencyIssue };

/**
 * Verifies that a practice exam is internally consistent:
 * every section belongs to the exam's definition, its derived `blank`/`net`
 * match its `correct`/`incorrect`, and the stored totals equal the sum of the
 * section results. Used before writing and when reading stored rows.
 */
export function checkExamConsistency(exam: PracticeExam): ExamConsistencyResult {
  const definition = getExamDefinition(exam.type, exam.scoreTypeSnapshot);

  if (!definition) {
    return { consistent: false, issue: 'unsupported_exam' };
  }

  for (const result of exam.results) {
    const lesson = definition.lessons.find((entry) => entry.lessonId === result.lessonId);

    if (!lesson) {
      return { consistent: false, issue: 'unknown_lesson' };
    }

    if (!validateLessonResult(lesson.questionCount, result.correct, result.incorrect).valid) {
      return { consistent: false, issue: 'invalid_lesson_result' };
    }

    const expectedBlank = calculateBlank(lesson.questionCount, result.correct, result.incorrect);
    const expectedNet = calculateNet(result.correct, result.incorrect);

    if (result.blank !== expectedBlank || !netsMatch(result.net, expectedNet)) {
      return { consistent: false, issue: 'inconsistent_lesson_totals' };
    }
  }

  const totals = calculateExamTotals(exam.results);

  if (
    totals.totalCorrect !== exam.totalCorrect ||
    totals.totalIncorrect !== exam.totalIncorrect ||
    totals.totalBlank !== exam.totalBlank ||
    !netsMatch(totals.totalNet, exam.totalNet)
  ) {
    return { consistent: false, issue: 'inconsistent_exam_totals' };
  }

  return { consistent: true };
}

export class InconsistentExamError extends Error {
  constructor(public readonly issue: ExamConsistencyIssue) {
    super(`Practice exam is inconsistent: ${issue}.`);
    this.name = 'InconsistentExamError';
  }
}

/** Throws `InconsistentExamError` when the exam must not be written. */
export function assertExamConsistent(exam: PracticeExam): void {
  const result = checkExamConsistency(exam);

  if (!result.consistent) {
    throw new InconsistentExamError(result.issue);
  }
}

/**
 * Orders results to match the exam definition's section order, so the stored
 * and displayed sections always follow the official test order.
 */
export function orderLessonResults(
  examType: ExamType,
  scoreType: ScoreType,
  results: LessonResult[],
): LessonResult[] {
  const definition = getExamDefinition(examType, scoreType);

  if (!definition) {
    return results;
  }

  const position = new Map(
    definition.lessons.map((lesson, index) => [lesson.lessonId, index] as const),
  );

  return [...results].sort(
    (a, b) =>
      (position.get(a.lessonId) ?? Number.MAX_SAFE_INTEGER) -
      (position.get(b.lessonId) ?? Number.MAX_SAFE_INTEGER),
  );
}

/**
 * Newest exam date first, with `updatedAt` then `id` descending as
 * deterministic tie-breakers.
 */
export function compareExamsNewestFirst(a: PracticeExam, b: PracticeExam): number {
  const aDate = Date.parse(a.date);
  const bDate = Date.parse(b.date);

  if (aDate !== bDate) {
    return bDate - aDate;
  }

  if (a.updatedAt !== b.updatedAt) {
    return a.updatedAt < b.updatedAt ? 1 : -1;
  }

  if (a.id !== b.id) {
    return a.id < b.id ? 1 : -1;
  }

  return 0;
}

/** Returns a new array sorted newest first; the input array is not mutated. */
export function sortExamsNewestFirst(exams: PracticeExam[]): PracticeExam[] {
  return [...exams].sort(compareExamsNewestFirst);
}
