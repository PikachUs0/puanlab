import * as Crypto from 'expo-crypto';
import { useCallback, useMemo, useRef } from 'react';

import {
  createSqliteStudyEventRepository,
  createSqliteTopicProgressRepository,
  useDatabase,
} from '@/db';
import type { StudyEventRepository, TopicProgressRepository } from '@/db';
import { useTopicStore } from '@/store';
import type { TopicProgress, TopicStatus } from '@/types';

import {
  applyNoteChange,
  applyStatusChange,
  applyStudiedToday,
  buildStudiedEvent,
  createStudiedTodayRunner,
  currentIsoTimestamp,
  persistStudiedToday,
  type StudiedTodayRunner,
} from './topicProgressUpdates';

/**
 * Builds the repository for the active connection. Returns null while the
 * database is still opening or when initialization failed, so callers can keep
 * running against in-memory state only.
 */
export function useTopicProgressRepository(): TopicProgressRepository | null {
  const { database, isReady, error } = useDatabase();

  return useMemo(
    () => (isReady && database && !error ? createSqliteTopicProgressRepository(database) : null),
    [database, isReady, error],
  );
}

/** Study-event repository bound to the same single connection. */
function useStudyEventRepository(): StudyEventRepository | null {
  const { database, isReady, error } = useDatabase();

  return useMemo(
    () => (isReady && database && !error ? createSqliteStudyEventRepository(database) : null),
    [database, isReady, error],
  );
}

export type TopicProgressActions = {
  setStatus: (status: TopicStatus) => void;
  setNote: (note: string | null) => void;
  markStudiedToday: () => void;
};

/**
 * Store + repository orchestration for a single topic.
 *
 * The next record is always derived from the latest store state at call time
 * (never from a render-time closure), and writes are chained through a single
 * promise so rapid taps can neither interleave nor clobber each other. A write
 * that is already queued still completes if the sheet unmounts.
 */
export function useTopicProgressActions(topicId: string): TopicProgressActions {
  const { database } = useDatabase();
  const progressRepository = useTopicProgressRepository();
  const studyEventRepository = useStudyEventRepository();
  const pendingWrite = useRef<Promise<void>>(Promise.resolve());
  const studiedRunner = useRef<StudiedTodayRunner | null>(null);

  if (studiedRunner.current === null) {
    studiedRunner.current = createStudiedTodayRunner();
  }

  /** Appends a write to the serialized queue and returns the queued run. */
  const enqueueWrite = useCallback((write: () => Promise<void>): Promise<void> => {
    const run = pendingWrite.current.then(write);
    pendingWrite.current = run.catch(() => undefined);
    return run;
  }, []);

  const commit = useCallback(
    (build: (current: TopicProgress | null) => TopicProgress) => {
      const store = useTopicStore.getState();
      const current = store.progressByTopicId[topicId] ?? null;
      const next = build(current);

      store.setProgress(next);

      if (progressRepository === null) {
        return;
      }

      // Swallow write failures: the session keeps working from the in-memory
      // store instead of surfacing a crash, and the next write retries the row.
      void enqueueWrite(() => progressRepository.upsert(next)).catch(() => undefined);
    },
    [enqueueWrite, progressRepository, topicId],
  );

  /**
   * "Bugün Çalıştım": one timestamp feeds the progress row and one `studied`
   * event, both committed in the same transaction. The store is updated only
   * after that transaction succeeds, so a failed write leaves the previous
   * progress (and the UI) untouched.
   */
  const markStudiedToday = useCallback(() => {
    const runner = studiedRunner.current;

    if (runner === null) {
      return;
    }

    const store = useTopicStore.getState();
    const current = store.progressByTopicId[topicId] ?? null;
    const timestamp = currentIsoTimestamp();
    const progress = applyStudiedToday(topicId, current, timestamp);
    const event = buildStudiedEvent(topicId, timestamp, Crypto.randomUUID());

    if (database === null || progressRepository === null || studyEventRepository === null) {
      // No persistent connection yet: keep the session usable in memory only.
      store.setProgress(progress);
      return;
    }

    void runner
      .run(() =>
        enqueueWrite(() =>
          persistStudiedToday(database, progressRepository, studyEventRepository, progress, event),
        ),
      )
      .then((executed) => {
        // Only after the transaction committed may the UI see the new row.
        if (executed) {
          useTopicStore.getState().setProgress(progress);
        }
      })
      // Calm failure: the previous progress stays in place and no event exists.
      .catch(() => undefined);
  }, [database, enqueueWrite, progressRepository, studyEventRepository, topicId]);

  return {
    setStatus: useCallback(
      (status: TopicStatus) => commit((current) => applyStatusChange(topicId, current, status)),
      [commit, topicId],
    ),
    setNote: useCallback(
      (note: string | null) => commit((current) => applyNoteChange(topicId, current, note)),
      [commit, topicId],
    ),
    markStudiedToday,
  };
}
