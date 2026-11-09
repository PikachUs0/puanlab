import type { TopicProgress, TopicStatus } from '@/types';

/**
 * The single place timestamps are generated, per the MVP date specification.
 * Kept outside component scope so the render path stays pure.
 */
export function currentIsoTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Status selection. `lastStudiedAt` is deliberately left untouched: only
 * "Bugün Çalıştım" may move the study date.
 */
export function applyStatusChange(
  topicId: string,
  current: TopicProgress | null,
  status: TopicStatus,
): TopicProgress {
  return {
    topicId,
    status,
    note: current?.note ?? null,
    lastStudiedAt: current?.lastStudiedAt ?? null,
    updatedAt: currentIsoTimestamp(),
  };
}

/** Personal note change. `lastStudiedAt` is deliberately left untouched. */
export function applyNoteChange(
  topicId: string,
  current: TopicProgress | null,
  note: string | null,
): TopicProgress {
  return {
    topicId,
    status: current?.status ?? 'not_started',
    note,
    lastStudiedAt: current?.lastStudiedAt ?? null,
    updatedAt: currentIsoTimestamp(),
  };
}

/**
 * "Bugün Çalıştım": stamps `lastStudiedAt` and `updatedAt` with the current ISO
 * timestamp and promotes `not_started` to `learning`. Every other status is
 * preserved as-is.
 */
export function applyStudiedToday(
  topicId: string,
  current: TopicProgress | null,
): TopicProgress {
  const timestamp = currentIsoTimestamp();
  const status = current?.status ?? 'not_started';

  return {
    topicId,
    status: status === 'not_started' ? 'learning' : status,
    note: current?.note ?? null,
    lastStudiedAt: timestamp,
    updatedAt: timestamp,
  };
}
