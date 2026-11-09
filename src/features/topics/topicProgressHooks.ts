import { useCallback, useMemo, useRef } from 'react';

import { createSqliteTopicProgressRepository, useDatabase } from '@/db';
import type { TopicProgressRepository } from '@/db';
import { useTopicStore } from '@/store';
import type { TopicProgress, TopicStatus } from '@/types';

import { applyNoteChange, applyStatusChange, applyStudiedToday } from './topicProgressUpdates';

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
  const repository = useTopicProgressRepository();
  const pendingWrite = useRef<Promise<void>>(Promise.resolve());

  const commit = useCallback(
    (build: (current: TopicProgress | null) => TopicProgress) => {
      const store = useTopicStore.getState();
      const current = store.progressByTopicId[topicId] ?? null;
      const next = build(current);

      store.setProgress(next);

      if (repository === null) {
        return;
      }

      const write = pendingWrite.current.then(() => repository.upsert(next));

      // Swallow write failures: the session keeps working from the in-memory
      // store instead of surfacing a crash, and the next write retries the row.
      pendingWrite.current = write.catch(() => undefined);
    },
    [repository, topicId],
  );

  return {
    setStatus: useCallback(
      (status: TopicStatus) => commit((current) => applyStatusChange(topicId, current, status)),
      [commit, topicId],
    ),
    setNote: useCallback(
      (note: string | null) => commit((current) => applyNoteChange(topicId, current, note)),
      [commit, topicId],
    ),
    markStudiedToday: useCallback(
      () => commit((current) => applyStudiedToday(topicId, current)),
      [commit, topicId],
    ),
  };
}
