/**
 * Pure state and rules for the "Deneme Ekle" (Add Practice Exam) form.
 *
 * Everything here is a plain function over plain data: no React, no React
 * Native, no Zustand, no SQLite. The screen owns the React wiring and calls
 * these functions, which keeps every rule (name generation, date validation,
 * count clamping, save readiness, totals) unit-testable.
 *
 * Lesson ids, lesson names and question counts are never repeated here — they
 * are always read from the central `examDefinitions` module.
 */

import { parseIsoTimestamp, startOfLocalDay } from '@/features/home/dateUtils';
import type { ExamType, LessonResult, PracticeExam, ScoreType } from '@/types';

import {
  calculateBlank,
  calculateExamTotals,
  calculateNet,
  orderLessonResults,
  validateLessonResult,
  type ExamTotals,
  type LessonResultInvalidReason,
} from './examCalculations';
import { getExamDefinition, isExamSupported } from './examDefinitions';

/** Maximum length of a (trimmed) manual exam name. */
export const EXAM_NAME_MAX_LENGTH = 80;

/** Shown when a DIL candidate opens the exam type selector. */
export const DIL_AYT_UNAVAILABLE_MESSAGE =
  "DİL öğrencileri için MVP 0.1'de yalnızca TYT denemeleri destekleniyor. YDT desteği sonraki sürümlerde gelecek.";

const MONTH_NAMES_TR = [
  'Ocak',
  'Şubat',
  'Mart',
  'Nisan',
  'Mayıs',
  'Haziran',
  'Temmuz',
  'Ağustos',
  'Eylül',
  'Ekim',
  'Kasım',
  'Aralık',
] as const;

/** The two countable fields of a section, each with its own text input. */
export type ExamFormCountField = 'correct' | 'incorrect';

/** Raw, user-typed text for one exam section. Counts are parsed on demand. */
export type LessonDraft = {
  lessonId: string;
  correctText: string;
  incorrectText: string;
};

export type ExamFormState = {
  examType: ExamType;
  name: string;
  /** True while `name` still mirrors the auto-generated value. */
  nameIsAuto: boolean;
  /** The exam's local calendar day, stored as an ISO 8601 string. */
  date: string;
  lessons: LessonDraft[];
};

/** The untouched values an empty form starts with, used for the leave guard. */
export type ExamFormBaseline = {
  examType: ExamType;
  date: string;
};

export type LessonDraftValidation =
  | { valid: true; correct: number; incorrect: number; blank: number; net: number }
  | { valid: false; message: string };

export type ExamLessonValidation = {
  lessonId: string;
  name: string;
  questionCount: number;
  draft: LessonDraft;
  validation: LessonDraftValidation;
};

export type ExamFormIssue =
  | 'no_score_type'
  | 'exam_type_unavailable'
  | 'name_empty'
  | 'name_too_long'
  | 'date_invalid'
  | 'date_future'
  | 'lesson_invalid';

export const EXAM_FORM_ISSUE_MESSAGES: Record<ExamFormIssue, string> = {
  no_score_type:
    'Profil bilgilerine ulaşılamadı. Deneme kaydetmek için profiline bir puan türü seçmen gerekiyor.',
  exam_type_unavailable: 'Bu deneme türü puan türün için kullanılamıyor.',
  name_empty: 'Deneme adı boş bırakılamaz.',
  name_too_long: `Deneme adı en fazla ${EXAM_NAME_MAX_LENGTH} karakter olabilir.`,
  date_invalid: 'Geçerli bir tarih seç.',
  date_future: 'Gelecek bir tarih seçilemez.',
  lesson_invalid: 'Geçersiz değer içeren dersler var. Kaydetmeden önce düzelt.',
};

export type ExamFormValidation = {
  /** Step 1 (temel bilgiler) is complete and the user may continue. */
  canProceed: boolean;
  /** The whole form may be saved. */
  canSave: boolean;
  issues: ExamFormIssue[];
  lessons: ExamLessonValidation[];
  /** Totals over the currently valid sections only; never user input. */
  totals: ExamTotals;
};

type ValidLessonValidation = Extract<LessonDraftValidation, { valid: true }>;

function isValidLesson(
  lesson: ExamLessonValidation,
): lesson is ExamLessonValidation & { validation: ValidLessonValidation } {
  return lesson.validation.valid;
}

/** "9 Kasım" — day and month in the device's local calendar. */
function formatTurkishDayMonth(date: Date): string {
  return `${date.getDate()} ${MONTH_NAMES_TR[date.getMonth()]}`;
}

/** "9 Kasım 2026" — full Turkish display date for an ISO 8601 value. */
export function formatExamDateForDisplay(dateIso: string): string {
  const date = parseIsoTimestamp(dateIso);

  if (!date) {
    return dateIso;
  }

  return `${formatTurkishDayMonth(date)} ${date.getFullYear()}`;
}

/**
 * Turkish net display: comma decimal separator, at most two decimals, trailing
 * zeros trimmed. Formatting only — stored precision is never rounded.
 */
export function formatNetForDisplay(net: number): string {
  return net.toFixed(2).replace(/\.?0+$/, '').replace('.', ',');
}

/** "TYT Denemesi - 9 Kasım" / "AYT Denemesi - 9 Kasım". */
export function buildDefaultExamName(examType: ExamType, dateIso: string): string {
  const date = parseIsoTimestamp(dateIso);

  if (!date) {
    return `${examType} Denemesi`;
  }

  return `${examType} Denemesi - ${formatTurkishDayMonth(date)}`;
}

/**
 * The exam types a score type may sit in MVP 0.1.
 *
 * TYT is available to every score type; AYT is available only to SAY, EA and
 * SOZ (DIL sits TYT only, and YDT is out of scope). A missing score type
 * returns an empty list so progression and saving stay blocked.
 */
export function availableExamTypes(scoreType: ScoreType | null): ExamType[] {
  if (scoreType === null) {
    return [];
  }

  return (['TYT', 'AYT'] as const).filter((examType) => isExamSupported(examType, scoreType));
}

/** ISO 8601 string for the local calendar day of `date` (local midnight). */
export function toLocalDateIso(date: Date): string {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).toISOString();
}

/** Parses a stored ISO 8601 date value, returning `null` when it is unusable. */
export function parseExamDate(value: string): Date | null {
  return parseIsoTimestamp(value);
}

/** Whether the stored date falls after the device's current local calendar day. */
export function isFutureExamDate(value: string, now: Date): boolean {
  const date = parseIsoTimestamp(value);

  if (!date) {
    return false;
  }

  return startOfLocalDay(date) > startOfLocalDay(now);
}

function createLessonDrafts(examType: ExamType, scoreType: ScoreType): LessonDraft[] {
  const definition = getExamDefinition(examType, scoreType);

  if (!definition) {
    return [];
  }

  return definition.lessons.map((lesson) => ({
    lessonId: lesson.lessonId,
    correctText: '0',
    incorrectText: '0',
  }));
}

/** A new, untouched form: default exam type, auto name and today's date. */
export function createInitialFormState(scoreType: ScoreType | null, now: Date): ExamFormState {
  const examType = availableExamTypes(scoreType)[0] ?? 'TYT';
  const date = toLocalDateIso(now);

  return {
    examType,
    name: buildDefaultExamName(examType, date),
    nameIsAuto: true,
    date,
    lessons: scoreType ? createLessonDrafts(examType, scoreType) : [],
  };
}

/** The untouched values of a fresh form, used to detect meaningful changes. */
export function createFormBaseline(
  scoreType: ScoreType | null,
  now: Date,
): ExamFormBaseline {
  return {
    examType: availableExamTypes(scoreType)[0] ?? 'TYT',
    date: toLocalDateIso(now),
  };
}

export type CountParseResult =
  | { ok: true; value: number }
  | { ok: false; reason: 'empty' | 'not_whole_number' };

/** Parses a raw count field. Only empty text and non-negative whole numbers pass. */
export function parseCountText(text: string): CountParseResult {
  const trimmed = text.trim();

  if (trimmed.length === 0) {
    return { ok: false, reason: 'empty' };
  }

  if (!/^\d+$/.test(trimmed)) {
    return { ok: false, reason: 'not_whole_number' };
  }

  const value = Number.parseInt(trimmed, 10);

  if (!Number.isSafeInteger(value)) {
    return { ok: false, reason: 'not_whole_number' };
  }

  return { ok: true, value };
}

/**
 * Numeric reading of a count field for control bounds. Invalid or empty text
 * reads as 0 so the plus/minus controls stay usable; the invalid text itself is
 * never rewritten and is still reported by `validateLessonDraft`.
 */
export function readCountValue(text: string): number {
  const parsed = parseCountText(text);

  return parsed.ok ? parsed.value : 0;
}

const LESSON_INVALID_MESSAGES: Record<LessonResultInvalidReason, string> = {
  non_integer: 'Doğru ve yanlış sayıları tam sayı olmalıdır.',
  negative: 'Doğru ve yanlış sayıları negatif olamaz.',
  exceeds_total: 'Doğru ve yanlış toplamı soru sayısını aşamaz.',
};

/**
 * Validates one section's raw text and derives its blank and net. Delegates the
 * arithmetic rules to the central `examCalculations` helpers.
 */
export function validateLessonDraft(
  draft: LessonDraft,
  questionCount: number,
): LessonDraftValidation {
  const correct = parseCountText(draft.correctText);

  if (!correct.ok) {
    return {
      valid: false,
      message:
        correct.reason === 'empty'
          ? 'Doğru sayısı boş bırakılamaz.'
          : 'Doğru sayısı tam sayı olmalıdır.',
    };
  }

  const incorrect = parseCountText(draft.incorrectText);

  if (!incorrect.ok) {
    return {
      valid: false,
      message:
        incorrect.reason === 'empty'
          ? 'Yanlış sayısı boş bırakılamaz.'
          : 'Yanlış sayısı tam sayı olmalıdır.',
    };
  }

  const validation = validateLessonResult(questionCount, correct.value, incorrect.value);

  if (!validation.valid) {
    return { valid: false, message: LESSON_INVALID_MESSAGES[validation.reason] };
  }

  return {
    valid: true,
    correct: correct.value,
    incorrect: incorrect.value,
    blank: calculateBlank(questionCount, correct.value, incorrect.value),
    net: calculateNet(correct.value, incorrect.value),
  };
}

function getStepOneIssues(
  form: ExamFormState,
  scoreType: ScoreType | null,
  now: Date,
): ExamFormIssue[] {
  const issues: ExamFormIssue[] = [];

  if (scoreType === null) {
    issues.push('no_score_type');

    return issues;
  }

  if (!isExamSupported(form.examType, scoreType)) {
    issues.push('exam_type_unavailable');
  }

  const trimmedName = form.name.trim();

  if (trimmedName.length === 0) {
    issues.push('name_empty');
  } else if (trimmedName.length > EXAM_NAME_MAX_LENGTH) {
    issues.push('name_too_long');
  }

  if (!parseIsoTimestamp(form.date)) {
    issues.push('date_invalid');
  } else if (isFutureExamDate(form.date, now)) {
    issues.push('date_future');
  }

  return issues;
}

function toLessonResults(lessons: ExamLessonValidation[]): LessonResult[] {
  return lessons.filter(isValidLesson).map((lesson) => ({
    lessonId: lesson.lessonId,
    correct: lesson.validation.correct,
    incorrect: lesson.validation.incorrect,
    blank: lesson.validation.blank,
    net: lesson.validation.net,
  }));
}

/**
 * Full form validation. Sections come from the central exam definition for the
 * form's exam type, so the UI renders exactly the official lesson list.
 */
export function validateExamForm(
  form: ExamFormState,
  scoreType: ScoreType | null,
  now: Date,
): ExamFormValidation {
  const issues = getStepOneIssues(form, scoreType, now);

  const definition = scoreType ? getExamDefinition(form.examType, scoreType) : null;

  const lessons: ExamLessonValidation[] = (definition?.lessons ?? []).map((lesson) => {
    const draft = form.lessons.find((entry) => entry.lessonId === lesson.lessonId) ?? {
      lessonId: lesson.lessonId,
      correctText: '',
      incorrectText: '',
    };

    return {
      lessonId: lesson.lessonId,
      name: lesson.name,
      questionCount: lesson.questionCount,
      draft,
      validation: validateLessonDraft(draft, lesson.questionCount),
    };
  });

  const hasInvalidLesson = lessons.some((lesson) => !lesson.validation.valid);
  const totals = calculateExamTotals(toLessonResults(lessons));

  if (hasInvalidLesson) {
    issues.push('lesson_invalid');
  }

  const canProceed = issues.length === 0 || (issues.length === 1 && issues[0] === 'lesson_invalid');

  return {
    canProceed,
    canSave: canProceed && lessons.length > 0 && !hasInvalidLesson,
    issues,
    lessons,
    totals,
  };
}

/** Switches the exam type, rebuilding the section list from the definition. */
export function changeExamType(
  form: ExamFormState,
  examType: ExamType,
  scoreType: ScoreType | null,
): ExamFormState {
  return {
    ...form,
    examType,
    name: form.nameIsAuto ? buildDefaultExamName(examType, form.date) : form.name,
    lessons: scoreType ? createLessonDrafts(examType, scoreType) : form.lessons,
  };
}

/** Marks the name as manually edited so type/date changes never overwrite it. */
export function changeName(form: ExamFormState, name: string): ExamFormState {
  return { ...form, name, nameIsAuto: false };
}

/** Sets the exam date, refreshing the name while it is still auto-generated. */
export function changeDate(form: ExamFormState, dateIso: string): ExamFormState {
  return {
    ...form,
    date: dateIso,
    name: form.nameIsAuto ? buildDefaultExamName(form.examType, dateIso) : form.name,
  };
}

/** Stores raw text for one count field without correcting it. */
export function changeLessonCount(
  form: ExamFormState,
  lessonId: string,
  field: ExamFormCountField,
  text: string,
): ExamFormState {
  return {
    ...form,
    lessons: form.lessons.map((draft) => {
      if (draft.lessonId !== lessonId) {
        return draft;
      }

      return field === 'correct'
        ? { ...draft, correctText: text }
        : { ...draft, incorrectText: text };
    }),
  };
}

/** Largest value the given field may take without exceeding the question count. */
export function getLessonCountMax(questionCount: number, otherText: string): number {
  return Math.max(0, questionCount - readCountValue(otherText));
}

/** Steps one count field by ±1, clamped to 0 and to the remaining questions. */
export function bumpLessonCount(
  form: ExamFormState,
  lessonId: string,
  field: ExamFormCountField,
  delta: 1 | -1,
  questionCount: number,
): ExamFormState {
  const draft = form.lessons.find((entry) => entry.lessonId === lessonId);

  if (!draft) {
    return form;
  }

  const currentText = field === 'correct' ? draft.correctText : draft.incorrectText;
  const otherText = field === 'correct' ? draft.incorrectText : draft.correctText;
  const max = getLessonCountMax(questionCount, otherText);
  const next = Math.min(max, Math.max(0, readCountValue(currentText) + delta));

  return changeLessonCount(form, lessonId, field, String(next));
}

function hasEnteredCount(text: string): boolean {
  const parsed = parseCountText(text);

  return parsed.ok && parsed.value > 0;
}

/**
 * Whether the form holds anything worth protecting: a different exam type or
 * date than the untouched baseline, a manually edited name, or any entered
 * answer count.
 */
export function hasMeaningfulChanges(
  form: ExamFormState,
  baseline: ExamFormBaseline,
): boolean {
  if (form.examType !== baseline.examType || form.date !== baseline.date) {
    return true;
  }

  if (!form.nameIsAuto && form.name.trim() !== buildDefaultExamName(form.examType, form.date)) {
    return true;
  }

  return form.lessons.some(
    (draft) => hasEnteredCount(draft.correctText) || hasEnteredCount(draft.incorrectText),
  );
}

/**
 * The values an edit form loads from a stored exam. Unlike the create-mode
 * baseline it captures the saved name and every saved count, so an untouched
 * loaded exam compares equal and is never treated as dirty.
 */
export type ExamEditBaseline = {
  examType: ExamType;
  name: string;
  date: string;
  lessons: LessonDraft[];
};

/**
 * Rebuilds an editable form from a stored exam.
 *
 * Correct/incorrect come from the saved section results, and the official
 * lesson list is resolved from the exam's frozen `scoreTypeSnapshot` — never
 * from the current profile score type, so an exam created under EA keeps its
 * EA structure even after the profile changes to SAY.
 */
export function createEditFormState(exam: PracticeExam): ExamFormState {
  const definition = getExamDefinition(exam.type, exam.scoreTypeSnapshot);

  const lessons: LessonDraft[] = (definition?.lessons ?? []).map((lesson) => {
    const result = exam.results.find((entry) => entry.lessonId === lesson.lessonId);

    return {
      lessonId: lesson.lessonId,
      correctText: result ? String(result.correct) : '0',
      incorrectText: result ? String(result.incorrect) : '0',
    };
  });

  return {
    examType: exam.type,
    name: exam.name,
    nameIsAuto: false,
    date: exam.date,
    lessons,
  };
}

/** Captures the loaded exam's editable values for the leave guard. */
export function createEditBaseline(exam: PracticeExam): ExamEditBaseline {
  const state = createEditFormState(exam);

  return {
    examType: state.examType,
    name: state.name,
    date: state.date,
    lessons: state.lessons,
  };
}

/**
 * Whether an edit form differs from the record it was loaded from. An untouched
 * loaded exam is never dirty, so leaving it asks for no confirmation; a changed
 * name, date or any count is dirty and is protected by the discard dialog.
 */
export function hasEditMeaningfulChanges(
  form: ExamFormState,
  baseline: ExamEditBaseline,
): boolean {
  if (form.examType !== baseline.examType || form.date !== baseline.date) {
    return true;
  }

  if (form.name.trim() !== baseline.name.trim()) {
    return true;
  }

  return baseline.lessons.some((draft) => {
    const current = form.lessons.find((entry) => entry.lessonId === draft.lessonId);

    if (!current) {
      return true;
    }

    return (
      current.correctText.trim() !== draft.correctText.trim() ||
      current.incorrectText.trim() !== draft.incorrectText.trim()
    );
  });
}

export type BuildPracticeExamParams = {
  form: ExamFormState;
  /** The profile score type at creation time; stored as the frozen snapshot. */
  scoreType: ScoreType;
  /** Collision-resistant id supplied by the caller. */
  id: string;
  now: Date;
};

/**
 * Builds the complete `PracticeExam` for persistence. Every section result and
 * every total is derived here — nothing is taken from user input — and the
 * stored `scoreTypeSnapshot` is the profile score type at creation time.
 * Returns `null` when the form is not save-ready.
 */
export function buildPracticeExam({
  form,
  scoreType,
  id,
  now,
}: BuildPracticeExamParams): PracticeExam | null {
  const validation = validateExamForm(form, scoreType, now);

  if (!validation.canSave) {
    return null;
  }

  const results = orderLessonResults(form.examType, scoreType, toLessonResults(validation.lessons));
  const totals = calculateExamTotals(results);
  const timestamp = now.toISOString();

  return {
    id,
    type: form.examType,
    scoreTypeSnapshot: scoreType,
    name: form.name.trim(),
    date: form.date,
    results,
    totalCorrect: totals.totalCorrect,
    totalIncorrect: totals.totalIncorrect,
    totalBlank: totals.totalBlank,
    totalNet: totals.totalNet,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export type BuildExamUpdateParams = {
  form: ExamFormState;
  /** The stored record being edited. */
  exam: PracticeExam;
  /** The moment the update is saved; becomes `updatedAt`. */
  now: Date;
};

/**
 * Builds the updated `PracticeExam` for an edit.
 *
 * The id, exam type, frozen `scoreTypeSnapshot` and `createdAt` are taken from
 * the stored record and never from the form; only the name, date, section
 * results, totals and `updatedAt` change. Validation runs against the record's
 * snapshot so the official lesson structure stays exactly as it was saved.
 * Returns `null` when the form is not save-ready.
 */
export function buildExamUpdate({
  form,
  exam,
  now,
}: BuildExamUpdateParams): PracticeExam | null {
  const validation = validateExamForm(form, exam.scoreTypeSnapshot, now);

  if (!validation.canSave) {
    return null;
  }

  const results = orderLessonResults(
    exam.type,
    exam.scoreTypeSnapshot,
    toLessonResults(validation.lessons),
  );
  const totals = calculateExamTotals(results);

  return {
    id: exam.id,
    type: exam.type,
    scoreTypeSnapshot: exam.scoreTypeSnapshot,
    name: form.name.trim(),
    date: form.date,
    results,
    totalCorrect: totals.totalCorrect,
    totalIncorrect: totals.totalIncorrect,
    totalBlank: totals.totalBlank,
    totalNet: totals.totalNet,
    createdAt: exam.createdAt,
    updatedAt: now.toISOString(),
  };
}
