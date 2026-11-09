/**
 * Central date helpers for the Home rules.
 *
 * These are pure functions: nothing here touches React Native, Zustand or SQLite,
 * and every date-dependent helper receives its own reference `now` so behaviour
 * is deterministic and testable. Stored dates are ISO 8601 strings produced by
 * `new Date().toISOString()`; `lastStudiedAt` is `null` until the topic has been
 * studied at least once.
 */

const DAY_IN_MS = 24 * 60 * 60 * 1000;

/** Local-calendar start-of-day in epoch milliseconds for a given date. */
export function startOfLocalDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/**
 * Parses a stored ISO 8601 timestamp.
 *
 * Returns `null` for `null`, `undefined` and anything unparsable, so an invalid
 * value never reaches arithmetic and never throws.
 */
export function parseIsoTimestamp(value: string | null | undefined): Date | null {
  if (value === null || value === undefined) {
    return null;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Whole calendar days between a stored timestamp and `now`, measured on the
 * device's local calendar day. A study session at 23:59 therefore counts as one
 * day ago the next morning regardless of the hours actually elapsed.
 *
 * Returns `null` when the timestamp is missing or invalid because no difference
 * can be computed. Future timestamps (the device clock moved back) are clamped to
 * `0` and consequently treated as "today" for both display and priority rules.
 */
export function calendarDayDiff(value: string | null, now: Date): number | null {
  const studiedAt = parseIsoTimestamp(value);

  if (!studiedAt) {
    return null;
  }

  const elapsedDays = Math.round((startOfLocalDay(now) - startOfLocalDay(studiedAt)) / DAY_IN_MS);

  return elapsedDays < 0 ? 0 : elapsedDays;
}

/** True when the timestamp falls on the device's current local calendar day. */
export function isToday(value: string | null, now: Date): boolean {
  return calendarDayDiff(value, now) === 0;
}

/** True when the timestamp falls on the previous local calendar day. */
export function isYesterday(value: string | null, now: Date): boolean {
  return calendarDayDiff(value, now) === 1;
}

/**
 * Relative study label for a stored timestamp.
 *
 * Returns `null` when there is no usable date — both a missing (`null`) value and
 * an invalid one — so callers omit the text instead of showing a replaced date.
 */
export function formatRelativeStudyLabel(value: string | null, now: Date): string | null {
  const elapsedDays = calendarDayDiff(value, now);

  if (elapsedDays === null) {
    return null;
  }

  if (elapsedDays === 0) {
    return 'Bugün çalışıldı';
  }

  if (elapsedDays === 1) {
    return 'Dün çalışıldı';
  }

  return `${elapsedDays} gün önce çalışıldı`;
}

/**
 * Effective study timestamp in epoch milliseconds, used for ordering.
 *
 * Missing and invalid values return `null`. Future values are clamped to `now` so
 * a forward-moved device clock cannot make a topic look fresher than today.
 */
export function effectiveStudiedAtMs(value: string | null, now: Date): number | null {
  const studiedAt = parseIsoTimestamp(value);

  if (!studiedAt) {
    return null;
  }

  return Math.min(studiedAt.getTime(), now.getTime());
}
