import {
  calendarDayDiff,
  effectiveStudiedAtMs,
  formatRelativeStudyLabel,
  isToday,
  isYesterday,
  parseIsoTimestamp,
} from '../dateUtils';

/** Fixed reference "now": 15 March 2026, 12:00 local time. Never the real clock. */
const NOW = new Date(2026, 2, 15, 12, 0, 0);

/** A local date converted to the ISO 8601 string the app would store. */
function isoLocal(year: number, monthIndex: number, day: number, hour = 9): string {
  return new Date(year, monthIndex, day, hour).toISOString();
}

/** ISO string `days` calendar days before NOW, at the given local hour. */
function isoDaysBefore(days: number, hour = 9): string {
  const date = new Date(NOW);
  date.setDate(date.getDate() - days);
  date.setHours(hour, 0, 0, 0);

  return date.toISOString();
}

/** ISO string `days` calendar days after NOW, at the given local hour. */
function isoDaysAfter(days: number, hour = 9): string {
  const date = new Date(NOW);
  date.setDate(date.getDate() + days);
  date.setHours(hour, 0, 0, 0);

  return date.toISOString();
}

describe('parseIsoTimestamp', () => {
  it('parses a valid ISO 8601 string', () => {
    const parsed = parseIsoTimestamp('2026-03-15T09:00:00.000Z');

    expect(parsed).toBeInstanceOf(Date);
    expect(parsed?.toISOString()).toBe('2026-03-15T09:00:00.000Z');
  });

  it('returns null for a missing value', () => {
    expect(parseIsoTimestamp(null)).toBeNull();
    expect(parseIsoTimestamp(undefined)).toBeNull();
  });

  it('returns null for an invalid value instead of throwing', () => {
    expect(parseIsoTimestamp('')).toBeNull();
    expect(parseIsoTimestamp('not-a-date')).toBeNull();
  });
});

describe('calendarDayDiff', () => {
  it('returns 0 for any time within the same local calendar day', () => {
    const endOfDayNow = new Date(2026, 2, 15, 23, 30, 0);

    expect(calendarDayDiff(isoLocal(2026, 2, 15, 0), endOfDayNow)).toBe(0);
    expect(calendarDayDiff(isoLocal(2026, 2, 15, 12), endOfDayNow)).toBe(0);
    expect(calendarDayDiff(isoLocal(2026, 2, 15, 23), endOfDayNow)).toBe(0);
  });

  it('returns 1 for the previous local calendar day', () => {
    expect(calendarDayDiff(isoDaysBefore(1), NOW)).toBe(1);
  });

  it('counts whole calendar days for older dates', () => {
    expect(calendarDayDiff(isoDaysBefore(7), NOW)).toBe(7);
    expect(calendarDayDiff(isoDaysBefore(45), NOW)).toBe(45);
  });

  it('returns null for a missing value', () => {
    expect(calendarDayDiff(null, NOW)).toBeNull();
  });

  it('returns null for an invalid value', () => {
    expect(calendarDayDiff('not-a-date', NOW)).toBeNull();
  });

  it('clamps future timestamps to 0 so they read as today', () => {
    expect(calendarDayDiff(isoDaysAfter(3), NOW)).toBe(0);
  });
});

describe('isToday / isYesterday', () => {
  it('identifies today', () => {
    expect(isToday(isoLocal(2026, 2, 15, 8), NOW)).toBe(true);
    expect(isToday(isoDaysBefore(1), NOW)).toBe(false);
    expect(isToday(null, NOW)).toBe(false);
  });

  it('identifies yesterday', () => {
    expect(isYesterday(isoDaysBefore(1), NOW)).toBe(true);
    expect(isYesterday(isoLocal(2026, 2, 15, 8), NOW)).toBe(false);
  });
});

describe('formatRelativeStudyLabel', () => {
  it('formats a study date from today', () => {
    expect(formatRelativeStudyLabel(isoLocal(2026, 2, 15, 8), NOW)).toBe('Bugün çalışıldı');
  });

  it('formats a study date from yesterday', () => {
    expect(formatRelativeStudyLabel(isoDaysBefore(1), NOW)).toBe('Dün çalışıldı');
  });

  it('formats older study dates as "X gün önce çalışıldı"', () => {
    expect(formatRelativeStudyLabel(isoDaysBefore(5), NOW)).toBe('5 gün önce çalışıldı');
  });

  it('returns null for a missing date so it is not silently replaced', () => {
    expect(formatRelativeStudyLabel(null, NOW)).toBeNull();
  });

  it('returns null for an invalid date instead of crashing', () => {
    expect(formatRelativeStudyLabel('not-a-date', NOW)).toBeNull();
  });

  it('treats a future date as today', () => {
    expect(formatRelativeStudyLabel(isoDaysAfter(2), NOW)).toBe('Bugün çalışıldı');
  });
});

describe('effectiveStudiedAtMs', () => {
  it('returns the stored timestamp in milliseconds', () => {
    const stored = '2026-03-15T09:00:00.000Z';

    expect(effectiveStudiedAtMs(stored, NOW)).toBe(new Date(stored).getTime());
  });

  it('clamps future timestamps to now', () => {
    expect(effectiveStudiedAtMs(isoDaysAfter(3), NOW)).toBe(NOW.getTime());
  });

  it('returns null for missing and invalid values', () => {
    expect(effectiveStudiedAtMs(null, NOW)).toBeNull();
    expect(effectiveStudiedAtMs('not-a-date', NOW)).toBeNull();
  });
});
