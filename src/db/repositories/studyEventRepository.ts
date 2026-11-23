import type { StudyEvent } from '@/types';

/**
 * Persistence contract for the append-only `StudyEvent` history.
 *
 * The log is append-only: there is deliberately no `update`, and the only
 * removal operation clears everything (used by the local-data reset). Rows are
 * validated at this boundary, so malformed events never reach SQLite and
 * corrupted stored rows are skipped on read instead of crashing.
 */
export type StudyEventRepository = {
  /** Every event, newest `occurredAt` first. */
  getAll: () => Promise<StudyEvent[]>;
  /** Events of a single topic, newest `occurredAt` first. */
  getByTopicId: (topicId: string) => Promise<StudyEvent[]>;
  /** The newest `limit` events, capped at 100. */
  getRecent: (limit: number) => Promise<StudyEvent[]>;
  /** Appends one event. Rejects duplicate ids and invalid payloads. */
  create: (event: StudyEvent) => Promise<void>;
  /** Removes every event (local-data reset). */
  removeAll: () => Promise<void>;
};
