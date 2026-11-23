import type { SQLiteDatabase } from 'expo-sqlite';

import type { StudyEventRepository, TopicProgressRepository } from '@/db';
import type { StudyEvent, TopicProgress, TopicStatus } from '@/types';

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
 * "Bugün Çalıştım": stamps `lastStudiedAt` and `updatedAt` with the supplied
 * ISO `timestamp` and promotes `not_started` to `learning`. Every other status
 * is preserved as-is. The caller passes the same timestamp to
 * `buildStudiedEvent`, so the progress row and its event never disagree.
 */
export function applyStudiedToday(
  topicId: string,
  current: TopicProgress | null,
  timestamp: string = currentIsoTimestamp(),
): TopicProgress {
  const status = current?.status ?? 'not_started';

  return {
    topicId,
    status: status === 'not_started' ? 'learning' : status,
    note: current?.note ?? null,
    lastStudiedAt: timestamp,
    updatedAt: timestamp,
  };
}

/**
 * Builds the append-only `studied` event for a "Bugün Çalıştım" action. It
 * records no status transition (that would be a separate `status_changed`
 * event) and reuses the progress timestamp for both event timestamps.
 */
export function buildStudiedEvent(
  topicId: string,
  timestamp: string,
  id: string,
): StudyEvent {
  return {
    id,
    topicId,
    eventType: 'studied',
    occurredAt: timestamp,
    previousStatus: null,
    newStatus: null,
    createdAt: timestamp,
  };
}

/**
 * Persists the progress row and the study event in one transaction on the
 * existing connection. Neither repository method starts its own transaction,
 * so this wrapping is flat; if either write fails SQLite rolls both back, so
 * the log can never disagree with the progress it describes.
 */
export async function persistStudiedToday(
  db: Pick<SQLiteDatabase, 'withTransactionAsync'>,
  progressRepository: Pick<TopicProgressRepository, 'upsert'>,
  studyEventRepository: Pick<StudyEventRepository, 'create'>,
  progress: TopicProgress,
  event: StudyEvent,
): Promise<void> {
  await db.withTransactionAsync(async () => {
    await progressRepository.upsert(progress);
    await studyEventRepository.create(event);
  });
}

export type StudiedTodayRunner = {
  /** True while a studied write is in flight. */
  isRunning: () => boolean;
  /**
   * Runs at most one write at a time. A tap that arrives while a write is in
   * flight is ignored and resolves `false`, so a double tap cannot append a
   * second event. Resolves `true` only when the write actually ran and
   * succeeded.
   */
  run: (task: () => Promise<void>) => Promise<boolean>;
};

/**
 * Single-flight guard for "Bugün Çalıştım". Reuses the pattern of the local
 * data reset runner: the first tap wins and rapid follow-up taps are dropped.
 */
export function createStudiedTodayRunner(): StudiedTodayRunner {
  let running = false;

  return {
    isRunning: () => running,
    run: async (task) => {
      if (running) {
        return false;
      }

      running = true;

      try {
        await task();
        return true;
      } finally {
        running = false;
      }
    },
  };
}
