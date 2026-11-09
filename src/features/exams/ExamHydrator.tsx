import { useEffect, type ReactNode } from 'react';

import { useExamStore } from '@/store';

import { usePracticeExamRepository } from './examHooks';

/**
 * Loads persisted practice exams into the Zustand store once the database is
 * ready. Mount as a child of `DatabaseProvider`, alongside the other hydrators;
 * it only fills the store and never gates rendering.
 *
 * A failed read settles into an empty, hydrated store instead of crashing, and
 * no stored record is ever deleted.
 */
export function ExamHydrator({ children }: { children: ReactNode }) {
  const repository = usePracticeExamRepository();
  const hydrateExams = useExamStore((state) => state.hydrateExams);

  useEffect(() => {
    if (repository === null) {
      return;
    }

    let isActive = true;

    repository
      .getAll()
      .then((exams) => {
        if (isActive) {
          hydrateExams(exams);
        }
      })
      .catch(() => {
        // The read settled but failed. Mark the store hydrated with no data so
        // the Exams screen shows its empty state instead of loading forever.
        if (isActive) {
          hydrateExams([]);
        }
      });

    return () => {
      isActive = false;
    };
  }, [repository, hydrateExams]);

  return <>{children}</>;
}
