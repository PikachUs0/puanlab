import { useEffect, type ReactNode } from 'react';

import { useTopicStore } from '@/store';

import { useTopicProgressRepository } from './topicProgressHooks';

/**
 * Loads persisted topic progress into the Zustand store once the database is
 * ready. Mount as a child of `DatabaseProvider`.
 *
 * Read failures are swallowed on purpose: the app starts with an empty
 * in-memory store rather than crashing on launch.
 */
export function TopicProgressHydrator({ children }: { children: ReactNode }) {
  const repository = useTopicProgressRepository();
  const setProgressBatch = useTopicStore((state) => state.setProgressBatch);

  useEffect(() => {
    if (repository === null) {
      return;
    }

    let isActive = true;

    repository
      .getAll()
      .then((progressList) => {
        if (isActive) {
          setProgressBatch(progressList);
        }
      })
      .catch(() => undefined);

    return () => {
      isActive = false;
    };
  }, [repository, setProgressBatch]);

  return <>{children}</>;
}
