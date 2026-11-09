import type { TopicStatus } from '@/types';

/**
 * Central review thresholds for MVP 0.1.
 *
 * These are product defaults picked for the Home previews, not scientific
 * learning rules. They are isolated here so a later version can tune the
 * behaviour in a single place instead of hunting through the UI.
 */
export const STALE_AFTER_DAYS = {
  /** A topic still being learned after a week without study. */
  learning: 7,
  /** A topic being practised after ten days. */
  practice: 10,
  /** A reinforced topic only after a much longer gap. */
  strong: 45,
} as const;

/** Statuses that can go stale, i.e. the keys of {@link STALE_AFTER_DAYS}. */
export type StaleStatus = keyof typeof STALE_AFTER_DAYS;

/**
 * `review` topics are always surfaced in "Öncelikli Tekrarlar" and never appear
 * in the stale list, so they have no staleness threshold.
 */
export const PRIORITY_REVIEW_STATUS: TopicStatus = 'review';

/** Maximum number of items any Home preview section returns. */
export const HOME_PREVIEW_LIMIT = 3;

function isStaleStatus(status: TopicStatus): status is StaleStatus {
  return status in STALE_AFTER_DAYS;
}

/**
 * Calendar days after which a status counts as stale, or `null` when the status
 * never becomes stale: `not_started` (nothing studied yet) and `review` (always
 * prioritized instead).
 */
export function getStaleAfterDays(status: TopicStatus): number | null {
  return isStaleStatus(status) ? STALE_AFTER_DAYS[status] : null;
}
