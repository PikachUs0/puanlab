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

export type StudyEventType = 'studied' | 'status_changed';

/**
 * Canonical, append-only study history entry for MVP 0.2.
 * `occurredAt` is when the event happened, `createdAt` when it was persisted;
 * both are ISO 8601 strings. Status fields are null for `studied` events and
 * set for `status_changed` events. Validation happens at the repository
 * boundary, not in the migration.
 */
export type StudyEvent = {
  id: string;
  topicId: string;
  eventType: StudyEventType;
  occurredAt: string;
  previousStatus: TopicStatus | null;
  newStatus: TopicStatus | null;
  createdAt: string;
};
