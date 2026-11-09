export type TopicStatus = 'not_started' | 'learning' | 'practice' | 'review' | 'strong';

/**
 * Canonical per-topic progress for MVP 0.1.
 * Dates are stored as ISO 8601 strings and generated with `new Date().toISOString()`.
 * `lastStudiedAt` stays null until the topic has been studied at least once,
 * while `updatedAt` is always a valid ISO 8601 string.
 */
export type TopicProgress = {
  topicId: string;
  status: TopicStatus;
  note: string | null;
  lastStudiedAt: string | null;
  updatedAt: string;
};
