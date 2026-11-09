import type { TopicProgress } from '@/types';

/**
 * Persistence contract for `TopicProgress` records.
 *
 * Implemented by `createSqliteTopicProgressRepository`. Stores must not depend
 * on this module directly; orchestration lives in `@/features/topics`.
 */
export type TopicProgressRepository = {
  getAll: () => Promise<TopicProgress[]>;
  getByTopicId: (topicId: string) => Promise<TopicProgress | null>;
  upsert: (progress: TopicProgress) => Promise<void>;
  remove: (topicId: string) => Promise<void>;
};
