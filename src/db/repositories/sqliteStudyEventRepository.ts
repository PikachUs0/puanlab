import type { SQLiteDatabase } from 'expo-sqlite';

import { getTopicById } from '@/data/curriculum';
import type { StudyEvent, StudyEventType, TopicStatus } from '@/types';

import type { StudyEventRepository } from './studyEventRepository';

type StudyEventRow = {
  id: string;
  topic_id: string;
  event_type: string;
  occurred_at: string;
  previous_status: string | null;
  new_status: string | null;
  created_at: string;
};

const EVENT_COLUMNS =
  'id, topic_id, event_type, occurred_at, previous_status, new_status, created_at';

const STUDY_EVENT_TYPES: readonly StudyEventType[] = ['studied', 'status_changed'];

const TOPIC_STATUSES: readonly TopicStatus[] = [
  'not_started',
  'learning',
  'practice',
  'review',
  'strong',
];

/** Hard ceiling for `getRecent` so a bad caller cannot load the whole log. */
export const MAX_RECENT_STUDY_EVENTS = 100;

/**
 * Newest-first reads are served by `idx_study_events_occurred_at`; `id` makes
 * the order fully deterministic when two events share both timestamps.
 */
const NEWEST_FIRST_ORDER = 'ORDER BY occurred_at DESC, created_at DESC, id DESC';

function isStudyEventType(value: string): value is StudyEventType {
  return (STUDY_EVENT_TYPES as readonly string[]).includes(value);
}

function isTopicStatus(value: string): value is TopicStatus {
  return (TOPIC_STATUSES as readonly string[]).includes(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** The database is a trust boundary: only valid ISO 8601 strings are accepted. */
function parseIsoDate(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  return Number.isNaN(new Date(value).getTime()) ? null : value;
}

/**
 * `null` is a stored SQL NULL, `undefined` means the text is not a topic
 * status at all (a corrupted row).
 */
function readTopicStatus(value: string | null): TopicStatus | null | undefined {
  if (value === null) {
    return null;
  }

  return isTopicStatus(value) ? value : undefined;
}

/**
 * Maps a stored row into a `StudyEvent`, or `null` when the row cannot be read
 * as a valid event. Corrupted rows are skipped but never deleted, so they stay
 * available for later inspection or repair.
 */
function toStudyEvent(row: StudyEventRow): StudyEvent | null {
  if (!isNonEmptyString(row.id) || !isNonEmptyString(row.topic_id)) {
    return null;
  }

  const eventType = row.event_type;

  if (!isStudyEventType(eventType)) {
    return null;
  }

  const occurredAt = parseIsoDate(row.occurred_at);
  const createdAt = parseIsoDate(row.created_at);
  const previousStatus = readTopicStatus(row.previous_status);
  const newStatus = readTopicStatus(row.new_status);

  if (
    occurredAt === null ||
    createdAt === null ||
    previousStatus === undefined ||
    newStatus === undefined
  ) {
    return null;
  }

  // A status change must name both endpoints and actually change something.
  if (
    eventType === 'status_changed' &&
    (previousStatus === null || newStatus === null || previousStatus === newStatus)
  ) {
    return null;
  }

  return {
    id: row.id,
    topicId: row.topic_id,
    eventType,
    occurredAt,
    previousStatus,
    newStatus,
    createdAt,
  };
}

function readEvents(rows: StudyEventRow[]): StudyEvent[] {
  const events: StudyEvent[] = [];

  for (const row of rows) {
    const event = toStudyEvent(row);

    if (event) {
      events.push(event);
    }
  }

  return events;
}

/**
 * Validates an event before it is appended. The curriculum registry is the
 * source of truth for topic ids, so an event can never reference a topic the
 * app does not know about.
 */
function assertValidStudyEvent(event: StudyEvent): void {
  if (!isNonEmptyString(event.id)) {
    throw new Error('Çalışma olayı kimliği boş olamaz.');
  }

  if (!isNonEmptyString(event.topicId)) {
    throw new Error('Konu kimliği boş olamaz.');
  }

  if (getTopicById(event.topicId) === null) {
    throw new Error(`Bilinmeyen konu: "${event.topicId}"`);
  }

  if (!isStudyEventType(event.eventType)) {
    throw new Error(`Geçersiz çalışma olayı türü: "${String(event.eventType)}"`);
  }

  if (parseIsoDate(event.occurredAt) === null) {
    throw new Error(`Geçersiz gerçekleşme zamanı: "${String(event.occurredAt)}"`);
  }

  if (parseIsoDate(event.createdAt) === null) {
    throw new Error(`Geçersiz kayıt zamanı: "${String(event.createdAt)}"`);
  }

  const previousStatus = readTopicStatus(event.previousStatus);
  const newStatus = readTopicStatus(event.newStatus);

  if (previousStatus === undefined || newStatus === undefined) {
    throw new Error('Geçersiz konu durumu.');
  }

  if (event.eventType === 'status_changed') {
    if (previousStatus === null || newStatus === null) {
      throw new Error('Durum değişikliğinde önceki ve yeni durum zorunludur.');
    }

    if (previousStatus === newStatus) {
      throw new Error('Durum değişikliğinde önceki ve yeni durum farklı olmalı.');
    }
  }
}

/** SQLite-backed implementation of the `StudyEventRepository` contract. */
export function createSqliteStudyEventRepository(db: SQLiteDatabase): StudyEventRepository {
  return {
    getAll: async () => {
      const rows = await db.getAllAsync<StudyEventRow>(
        `SELECT ${EVENT_COLUMNS} FROM study_events ${NEWEST_FIRST_ORDER};`,
      );

      return readEvents(rows);
    },

    getByTopicId: async (topicId) => {
      const rows = await db.getAllAsync<StudyEventRow>(
        `SELECT ${EVENT_COLUMNS} FROM study_events WHERE topic_id = ? ${NEWEST_FIRST_ORDER};`,
        [topicId],
      );

      return readEvents(rows);
    },

    getRecent: async (limit) => {
      if (!Number.isInteger(limit) || limit < 1) {
        throw new Error(`Geçersiz limit: "${String(limit)}"`);
      }

      const cappedLimit = Math.min(limit, MAX_RECENT_STUDY_EVENTS);
      const rows = await db.getAllAsync<StudyEventRow>(
        `SELECT ${EVENT_COLUMNS} FROM study_events ${NEWEST_FIRST_ORDER} LIMIT ?;`,
        [cappedLimit],
      );

      return readEvents(rows);
    },

    create: async (event) => {
      assertValidStudyEvent(event);

      const existing = await db.getFirstAsync<{ id: string }>(
        'SELECT id FROM study_events WHERE id = ?;',
        [event.id],
      );

      if (existing) {
        throw new Error(`Bu kimliğe sahip çalışma olayı zaten var: "${event.id}"`);
      }

      await db.runAsync(
        `INSERT INTO study_events
           (id, topic_id, event_type, occurred_at, previous_status, new_status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?);`,
        [
          event.id,
          event.topicId,
          event.eventType,
          event.occurredAt,
          event.previousStatus,
          event.newStatus,
          event.createdAt,
        ],
      );
    },

    removeAll: async () => {
      await db.runAsync('DELETE FROM study_events;');
    },
  };
}
