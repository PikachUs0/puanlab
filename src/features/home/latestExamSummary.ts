/**
 * Pure rules behind the Home "Son Deneme" (latest practice exam) summary.
 *
 * Everything here is a plain function over plain data: no React, no React
 * Native, no Zustand, no SQLite. The Home screen subscribes to the exam store
 * and calls these helpers inside `useMemo`, which keeps the latest-exam
 * ordering and every display label unit-testable.
 *
 * "Newest first" is never re-implemented here: `sortExamsNewestFirst` is the
 * single centralized ordering (exam date, then `updatedAt`, then id), so the
 * Home summary, the Denemeler list and the detail screen always agree.
 */

import { sortExamsNewestFirst } from '@/features/exams/examCalculations';
import { formatExamDateForDisplay, formatNetForDisplay } from '@/features/exams/examForm';
import type { PracticeExam } from '@/types';

import { parseIsoTimestamp } from './dateUtils';

/** Fallback name for a stored record whose name is missing or blank. */
export const UNNAMED_EXAM_LABEL = 'Deneme';

/** Fallback date for a stored record whose date cannot be parsed. */
export const UNKNOWN_EXAM_DATE_LABEL = 'Tarih bilinmiyor';

/** The display fields the Home card needs for the latest exam. */
export type LatestExamSummary = {
  id: string;
  name: string;
  /** A visible "TYT" / "AYT" text label — never conveyed by colour alone. */
  typeLabel: string;
  /** Turkish display date, e.g. "9 Kasım 2026". */
  dateLabel: string;
  /** Turkish net, e.g. "72,5". Display only; stored precision is untouched. */
  netLabel: string;
  /** Spoken label for the whole card. */
  accessibilityLabel: string;
};

/** Which body the Home exam-summary area renders. */
export type LatestExamSummaryState =
  | { status: 'loading' }
  | { status: 'empty' }
  | { status: 'ready'; summary: LatestExamSummary };

export type LatestExamSummaryInput = {
  /** Whether the exam store has finished restoring records. */
  isHydrated: boolean;
  /** The store's stable `examsById` map, subscribed by reference. */
  examsById: Record<string, PracticeExam | undefined>;
};

/** Rejects records that cannot be opened or navigated to. */
function isUsableExamRecord(exam: PracticeExam | undefined): exam is PracticeExam {
  if (!exam || typeof exam.id !== 'string') {
    return false;
  }

  return exam.id.trim().length > 0;
}

/**
 * The newest stored exam, or `null` when no usable record exists.
 * Reuses the centralized ordering so Home, the list and the detail agree.
 */
export function selectLatestExam(
  examsById: Record<string, PracticeExam | undefined>,
): PracticeExam | null {
  const usable = Object.values(examsById).filter(isUsableExamRecord);

  return sortExamsNewestFirst(usable)[0] ?? null;
}

function resolveName(value: unknown): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : UNNAMED_EXAM_LABEL;
}

function resolveTypeLabel(value: unknown): string {
  return value === 'AYT' ? 'AYT' : 'TYT';
}

function resolveDateLabel(value: unknown): string {
  if (typeof value !== 'string' || !parseIsoTimestamp(value)) {
    return UNKNOWN_EXAM_DATE_LABEL;
  }

  return formatExamDateForDisplay(value);
}

function resolveNetLabel(value: unknown): string {
  return formatNetForDisplay(typeof value === 'number' && Number.isFinite(value) ? value : 0);
}

/**
 * Builds every display label of the latest-exam card from a stored exam.
 * Malformed historical values fall back to a readable label instead of throwing.
 */
export function buildLatestExamSummary(exam: PracticeExam): LatestExamSummary {
  const name = resolveName(exam.name);
  const typeLabel = resolveTypeLabel(exam.type);
  const dateLabel = resolveDateLabel(exam.date);
  const netLabel = resolveNetLabel(exam.totalNet);

  return {
    id: exam.id,
    name,
    typeLabel,
    dateLabel,
    netLabel,
    accessibilityLabel: `${name}, ${typeLabel}, ${dateLabel}, toplam net ${netLabel}`,
  };
}

/**
 * The Home exam-summary state: `loading` until the exam store is hydrated,
 * `empty` when no usable exam exists, otherwise `ready` with the newest exam.
 */
export function selectLatestExamSummary({
  isHydrated,
  examsById,
}: LatestExamSummaryInput): LatestExamSummaryState {
  if (!isHydrated) {
    return { status: 'loading' };
  }

  const latest = selectLatestExam(examsById);

  if (!latest) {
    return { status: 'empty' };
  }

  return { status: 'ready', summary: buildLatestExamSummary(latest) };
}
