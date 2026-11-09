import type { SQLiteDatabase } from 'expo-sqlite';

import type { TopicProgress, TopicStatus } from '@/types';

import type { TopicProgressRepository } from './topicProgressRepository';

type TopicProgressRow = {
  topic_id: string;
  status: string;
  note: string | null;
  last_studied_at: string | null;
  updated_at: string;
};

const TOPIC_STATUSES: readonly TopicStatus[] = [
  'not_started',
  'learning',
  'practice',
  'review',
  'strong',
];

const SELECT_COLUMNS = 'topic_id, status, note, last_studied_at, updated_at';

function isTopicStatus(value: string): value is TopicStatus {
  return (TOPIC_STATUSES as readonly string[]).includes(value);
}

/**
 * The database is a trust boundary: only keep values that are valid ISO 8601
 * strings so a malformed row can never reach the UI as `Invalid Date`.
 */
function parseIsoDate(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : value;
}

function toTopicProgress(row: TopicProgressRow): TopicProgress | null {
  if (!isTopicStatus(row.status)) {
    return null;
  }

  const updatedAt = parseIsoDate(row.updated_at);

  if (updatedAt === null) {
    return null;
  }

  return {
    topicId: row.topic_id,
    status: row.status,
    note: row.note,
    lastStudiedAt: parseIsoDate(row.last_studied_at),
    updatedAt,
  };
}

/** SQLite-backed implementation of the `TopicProgressRepository` contract. */
export function createSqliteTopicProgressRepository(
  db: SQLiteDatabase,
): TopicProgressRepository {
  return {
    getAll: async () => {
      const rows = await db.getAllAsync<TopicProgressRow>(
        `SELECT ${SELECT_COLUMNS} FROM topic_progress;`,
      );

      const progressList: TopicProgress[] = [];

      for (const row of rows) {
        const progress = toTopicProgress(row);

        if (progress) {
          progressList.push(progress);
        }
      }

      return progressList;
    },

    getByTopicId: async (topicId) => {
      const row = await db.getFirstAsync<TopicProgressRow>(
        `SELECT ${SELECT_COLUMNS} FROM topic_progress WHERE topic_id = ?;`,
        [topicId],
      );

      return row ? toTopicProgress(row) : null;
    },

    upsert: async (progress) => {
      await db.runAsync(
        `INSERT INTO topic_progress (topic_id, status, note, last_studied_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(topic_id) DO UPDATE SET
           status = excluded.status,
           note = excluded.note,
           last_studied_at = excluded.last_studied_at,
           updated_at = excluded.updated_at;`,
        [
          progress.topicId,
          progress.status,
          progress.note,
          progress.lastStudiedAt,
          progress.updatedAt,
        ],
      );
    },

    remove: async (topicId) => {
      await db.runAsync('DELETE FROM topic_progress WHERE topic_id = ?;', [topicId]);
    },
  };
}
