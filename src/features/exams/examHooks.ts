import { useMemo } from 'react';

import { createSqlitePracticeExamRepository, useDatabase } from '@/db';
import type { PracticeExamRepository } from '@/db';
import { useExamStore } from '@/store';
import type { PracticeExam } from '@/types';

/**
 * Builds the practice exam repository for the active connection. Returns null
 * while the database is still opening or when initialization failed, so callers
 * can keep running against in-memory state only.
 */
export function usePracticeExamRepository(): PracticeExamRepository | null {
  const { database, isReady, error } = useDatabase();

  return useMemo(
    () => (isReady && database && !error ? createSqlitePracticeExamRepository(database) : null),
    [database, isReady, error],
  );
}

/**
 * App-wide write queue. Every persistence action is chained onto the previous
 * write so two actions can never interleave their store updates or race on the
 * same rows. Kept at module scope (not in a component ref) because the actions
 * are used from more than one screen.
 */
let pendingWrite: Promise<void> = Promise.resolve();

function enqueueWrite(task: () => Promise<void>): Promise<void> {
  const write = pendingWrite.then(task);

  // A failed write is surfaced to its caller, but the queue itself must always
  // keep accepting writes, so it advances on a settled (never rejected) promise.
  pendingWrite = write.catch(() => undefined);

  return write;
}

export type ExamPersistenceActions = {
  createExam: (exam: PracticeExam) => Promise<void>;
  updateExam: (exam: PracticeExam) => Promise<void>;
  deleteExam: (id: string) => Promise<void>;
};

/**
 * Store + repository orchestration for practice exams.
 *
 * Each action writes through the repository first and only then updates the
 * store, so the store never holds a record the database rejected. The
 * repository owns the transaction that keeps an exam row and its section rows
 * in sync, and the queue serialises writes globally.
 *
 * Exported separately from the hook so this ordering can be exercised in tests
 * without rendering React; the hook simply binds it to the live repository.
 */
export function createExamPersistenceActions(
  repository: PracticeExamRepository | null,
): ExamPersistenceActions {
  const requireRepository = (): PracticeExamRepository => {
    if (repository === null) {
      throw new Error('Deneme kaydedilemedi: veritabanına erişilemiyor.');
    }

    return repository;
  };

  return {
    createExam: async (exam) => {
      const repo = requireRepository();

      await enqueueWrite(() => repo.create(exam));
      useExamStore.getState().setExam(exam);
    },

    updateExam: async (exam) => {
      const repo = requireRepository();

      await enqueueWrite(() => repo.update(exam));
      useExamStore.getState().setExam(exam);
    },

    deleteExam: async (id) => {
      const repo = requireRepository();

      await enqueueWrite(() => repo.remove(id));
      useExamStore.getState().removeExam(id);
    },
  };
}

/** Binds the persistence actions to the repository of the active connection. */
export function useExamPersistenceActions(): ExamPersistenceActions {
  const repository = usePracticeExamRepository();

  return useMemo(() => createExamPersistenceActions(repository), [repository]);
}
