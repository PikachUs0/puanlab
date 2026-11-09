import type { Lesson, TopicProgress, TopicStatus } from '@/types';

import { calendarDayDiff, effectiveStudiedAtMs, isToday } from './dateUtils';
import { getStaleAfterDays, HOME_PREVIEW_LIMIT, PRIORITY_REVIEW_STATUS } from './reviewThresholds';

/**
 * Home topic rules and selectors.
 *
 * Pure business rules for the Home previews: they take typed inputs (stored
 * topic progress plus the static curriculum lessons and a reference `now`) and
 * return display-ready data. Nothing here imports React Native, Zustand or
 * SQLite, so the same rules can be reused by the future Home screen and by tests.
 */

/** Minimal display data resolved from the static curriculum for a topic. */
export type TopicCatalogEntry = {
  topicId: string;
  topicName: string;
  lessonId: string;
  lessonName: string;
};

/** A topic together with the progress state needed by the Home previews. */
export type HomeTopicItem = TopicCatalogEntry & {
  status: TopicStatus;
  lastStudiedAt: string | null;
};

/** A capped preview list plus the full match count for a future "Tümünü gör". */
export type HomeTopicSection = {
  /** At most {@link HOME_PREVIEW_LIMIT} items, sorted by the section rules. */
  items: readonly HomeTopicItem[];
  /** Total number of matching topics, regardless of the preview limit. */
  total: number;
};

/** Shared input for the topic-based selectors. */
export type HomeTopicSelectorInput = {
  progress: readonly TopicProgress[];
  lessons: readonly Lesson[];
  now: Date;
};

/** Topic names studied today, most recent first, plus the full count. */
export type TopicsStudiedToday = {
  /** At most {@link HOME_PREVIEW_LIMIT} topic names, most recent first. */
  names: readonly string[];
  /** Total number of topics whose `lastStudiedAt` is today. */
  total: number;
};

/** The four Home states the summary can be in for MVP 0.1. */
export type HomeState = 'noData' | 'topicsOnly' | 'examsOnly' | 'mixed';

/** Home-state input derived from record counts, so no exam row is fabricated. */
export type HomeStateInput = {
  /** Number of stored topic progress records. */
  topicProgressCount: number;
  /** Number of stored practice exams (exam storage lands in a later step). */
  examCount: number;
};

/**
 * Turkish collation order used for the deterministic name tie-break.
 *
 * Turkish sorts `ı` before `i` and treats `ç ğ ö ş ü` as letters that follow
 * their base letter, which a plain code-point comparison gets wrong. Keeping the
 * order explicit also keeps the sort stable across JS engines without relying on
 * ICU / Intl locale data.
 */
const TURKISH_COLLATION_ORDER = 'aâbcçdefgğhıiîjklmnoöprsştuüûvyz0123456789';

/**
 * Turkish-aware, case-insensitive fold. `İ→i` and `I→ı` are applied before the
 * generic lower-casing so dotted and dotless i behave as Turkish expects.
 */
function foldTurkish(value: string): string {
  return value.replace(/İ/g, 'i').replace(/I/g, 'ı').toLowerCase();
}

function collationRank(char: string): number {
  const rank = TURKISH_COLLATION_ORDER.indexOf(char);

  // Unknown characters sort after the known alphabet, ordered by code point so
  // the comparison stays deterministic.
  return rank === -1 ? TURKISH_COLLATION_ORDER.length + char.charCodeAt(0) : rank;
}

/** Turkish-aware comparison of two display names. */
function compareTurkish(a: string, b: string): number {
  const foldedA = foldTurkish(a);
  const foldedB = foldTurkish(b);
  const sharedLength = Math.min(foldedA.length, foldedB.length);

  for (let index = 0; index < sharedLength; index += 1) {
    const rankDifference = collationRank(foldedA[index]) - collationRank(foldedB[index]);

    if (rankDifference !== 0) {
      return rankDifference;
    }
  }

  return foldedA.length - foldedB.length;
}

/** Lesson name, then topic name, then id — the shared, deterministic tie-break. */
function compareTopicNames(a: HomeTopicItem, b: HomeTopicItem): number {
  const lessonComparison = compareTurkish(a.lessonName, b.lessonName);

  if (lessonComparison !== 0) {
    return lessonComparison;
  }

  const topicComparison = compareTurkish(a.topicName, b.topicName);

  if (topicComparison !== 0) {
    return topicComparison;
  }

  if (a.topicId === b.topicId) {
    return 0;
  }

  return a.topicId < b.topicId ? -1 : 1;
}

/** Undated first, then oldest study date first, then the name tie-break. */
function compareByOldestFirst(a: HomeTopicItem, b: HomeTopicItem, now: Date): number {
  const aMs = effectiveStudiedAtMs(a.lastStudiedAt, now);
  const bMs = effectiveStudiedAtMs(b.lastStudiedAt, now);

  if (aMs === null && bMs !== null) {
    return -1;
  }

  if (aMs !== null && bMs === null) {
    return 1;
  }

  if (aMs !== null && bMs !== null && aMs !== bMs) {
    return aMs - bMs;
  }

  return compareTopicNames(a, b);
}

/** Most recent study date first, then the name tie-break. */
function compareByMostRecent(a: HomeTopicItem, b: HomeTopicItem, now: Date): number {
  const aMs = effectiveStudiedAtMs(a.lastStudiedAt, now);
  const bMs = effectiveStudiedAtMs(b.lastStudiedAt, now);

  if (aMs !== bMs) {
    return (bMs ?? 0) - (aMs ?? 0);
  }

  return compareTopicNames(a, b);
}

/**
 * Builds a `topicId → display data` lookup from the static curriculum lessons.
 * Progress can outlive a curriculum change, so unresolved ids are skipped.
 */
export function buildTopicCatalog(lessons: readonly Lesson[]): Map<string, TopicCatalogEntry> {
  const catalog = new Map<string, TopicCatalogEntry>();

  for (const lesson of lessons) {
    for (const topic of lesson.topics) {
      catalog.set(topic.id, {
        topicId: topic.id,
        topicName: topic.name,
        lessonId: lesson.id,
        lessonName: lesson.name,
      });
    }
  }

  return catalog;
}

function toHomeTopicItem(
  progress: TopicProgress,
  catalog: Map<string, TopicCatalogEntry>,
): HomeTopicItem | null {
  const entry = catalog.get(progress.topicId);

  if (!entry) {
    return null;
  }

  return { ...entry, status: progress.status, lastStudiedAt: progress.lastStudiedAt };
}

/**
 * "Öncelikli Tekrarlar".
 *
 * Only `review` topics, undated ones before dated ones, then dated ones by oldest
 * study date. Capped to {@link HOME_PREVIEW_LIMIT} items with the full match
 * count exposed for a future "Tümünü gör".
 */
export function selectPriorityReviews({
  progress,
  lessons,
  now,
}: HomeTopicSelectorInput): HomeTopicSection {
  const catalog = buildTopicCatalog(lessons);

  const matches = progress
    .filter((item) => item.status === PRIORITY_REVIEW_STATUS)
    .map((item) => toHomeTopicItem(item, catalog))
    .filter((item): item is HomeTopicItem => item !== null)
    .sort((a, b) => compareByOldestFirst(a, b, now));

  return { items: matches.slice(0, HOME_PREVIEW_LIMIT), total: matches.length };
}

/**
 * "Uzun Süredir Çalışmadıkların".
 *
 * Excludes `not_started` (never studied) and `review` (shown as a priority
 * repeat) and any topic without a usable study date. The remaining statuses are
 * included once their status threshold has passed. Capped to
 * {@link HOME_PREVIEW_LIMIT} items with the full match count exposed.
 */
export function selectStaleTopics({
  progress,
  lessons,
  now,
}: HomeTopicSelectorInput): HomeTopicSection {
  const catalog = buildTopicCatalog(lessons);

  const matches = progress
    .filter((item) => item.status !== 'not_started' && item.status !== PRIORITY_REVIEW_STATUS)
    .filter((item) => {
      const threshold = getStaleAfterDays(item.status);
      const elapsedDays = calendarDayDiff(item.lastStudiedAt, now);

      return threshold !== null && elapsedDays !== null && elapsedDays >= threshold;
    })
    .map((item) => toHomeTopicItem(item, catalog))
    .filter((item): item is HomeTopicItem => item !== null)
    .sort((a, b) => compareByOldestFirst(a, b, now));

  return { items: matches.slice(0, HOME_PREVIEW_LIMIT), total: matches.length };
}

/**
 * Resolves the Home state from record counts. Uses counts (or an equivalent
 * boolean) instead of exam rows because exam storage is not implemented yet.
 */
export function selectHomeState({ topicProgressCount, examCount }: HomeStateInput): HomeState {
  const hasTopics = topicProgressCount > 0;
  const hasExams = examCount > 0;

  if (hasTopics && hasExams) {
    return 'mixed';
  }

  if (hasTopics) {
    return 'topicsOnly';
  }

  if (hasExams) {
    return 'examsOnly';
  }

  return 'noData';
}

/**
 * Topics studied today, most recent first.
 *
 * Returns at most {@link HOME_PREVIEW_LIMIT} topic names for the Home summary and
 * the full count of topics studied today.
 */
export function selectTopicsStudiedToday({
  progress,
  lessons,
  now,
}: HomeTopicSelectorInput): TopicsStudiedToday {
  const catalog = buildTopicCatalog(lessons);

  const studiedToday = progress
    .map((item) => toHomeTopicItem(item, catalog))
    .filter((item): item is HomeTopicItem => item !== null && isToday(item.lastStudiedAt, now))
    .sort((a, b) => compareByMostRecent(a, b, now));

  return {
    names: studiedToday.slice(0, HOME_PREVIEW_LIMIT).map((item) => item.topicName),
    total: studiedToday.length,
  };
}
