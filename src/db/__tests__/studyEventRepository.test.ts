/// <reference types="node" />

import { DatabaseSync } from 'node:sqlite';

import type { SQLiteDatabase } from 'expo-sqlite';

import { tyt2026 } from '@/data/curriculum/datasets';
import type { StudyEvent, StudyEventType, TopicStatus } from '@/types';

import { createSqliteStudyEventRepository } from '../repositories/sqliteStudyEventRepository';
import {
  CREATE_STUDY_EVENTS_OCCURRED_AT_INDEX,
  CREATE_STUDY_EVENTS_TABLE,
  CREATE_STUDY_EVENTS_TOPIC_OCCURRED_AT_INDEX,
} from '../schema';

type BindValue = string | number | null;

/** In-memory SQLite adapter exposing the exact surface the repository uses. */
class TestDatabase {
  private readonly db = new DatabaseSync(':memory:');

  async execAsync(sql: string): Promise<void> {
    this.db.exec(sql);
  }

  async runAsync(sql: string, params: BindValue[] = []): Promise<void> {
    this.db.prepare(sql).run(...params);
  }

  async getFirstAsync<T>(sql: string, params: BindValue[] = []): Promise<T | null> {
    const row = this.db.prepare(sql).get(...params);
    return (row as T | undefined) ?? null;
  }

  async getAllAsync<T>(sql: string, params: BindValue[] = []): Promise<T[]> {
    return this.db.prepare(sql).all(...params) as unknown as T[];
  }
}

const topics = tyt2026.lessons.flatMap((lesson) => lesson.topics);
const TOPIC_A = topics[0].id;
const TOPIC_B = topics[1].id;

let db: TestDatabase;
let repo: ReturnType<typeof createSqliteStudyEventRepository>;

function studiedEvent(overrides: Partial<StudyEvent> = {}): StudyEvent {
  return {
    id: 'event-1',
    topicId: TOPIC_A,
    eventType: 'studied',
    occurredAt: '2026-03-04T10:00:00.000Z',
    previousStatus: null,
    newStatus: null,
    createdAt: '2026-03-04T10:00:05.000Z',
    ...overrides,
  };
}

async function insertRaw(event: {
  id: string;
  topicId: string;
  eventType: string;
  occurredAt: string;
  previousStatus: TopicStatus | null;
  newStatus: TopicStatus | null;
  createdAt: string;
}): Promise<void> {
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
}

beforeEach(async () => {
  db = new TestDatabase();
  await db.execAsync(CREATE_STUDY_EVENTS_TABLE);
  await db.execAsync(CREATE_STUDY_EVENTS_TOPIC_OCCURRED_AT_INDEX);
  await db.execAsync(CREATE_STUDY_EVENTS_OCCURRED_AT_INDEX);
  repo = createSqliteStudyEventRepository(db as unknown as SQLiteDatabase);
});

describe('create', () => {
  it('persists and reads a studied event with null statuses', async () => {
    const event = studiedEvent();

    await repo.create(event);

    await expect(repo.getAll()).resolves.toEqual([event]);
    await expect(repo.getByTopicId(TOPIC_A)).resolves.toEqual([event]);
  });

  it('persists a valid status_changed event for its topic only', async () => {
    const event = studiedEvent({
      id: 'event-2',
      eventType: 'status_changed',
      previousStatus: 'learning',
      newStatus: 'practice',
    });

    await repo.create(event);

    await expect(repo.getByTopicId(TOPIC_A)).resolves.toEqual([event]);
    await expect(repo.getByTopicId(TOPIC_B)).resolves.toEqual([]);
  });

  it('rejects an unknown topic and empty identifiers before writing', async () => {
    await expect(repo.create(studiedEvent({ topicId: 'unknown-topic' }))).rejects.toThrow(
      /Bilinmeyen konu/,
    );
    await expect(repo.create(studiedEvent({ id: '  ' }))).rejects.toThrow(/kimliği boş olamaz/);
    await expect(repo.create(studiedEvent({ topicId: '' }))).rejects.toThrow(
      /Konu kimliği boş olamaz/,
    );

    await expect(repo.getAll()).resolves.toEqual([]);
  });

  it('rejects invalid event types and statuses', async () => {
    await expect(
      repo.create(studiedEvent({ eventType: 'studied_again' as StudyEventType })),
    ).rejects.toThrow(/Geçersiz çalışma olayı türü/);

    await expect(
      repo.create(studiedEvent({ previousStatus: 'mastered' as TopicStatus })),
    ).rejects.toThrow(/Geçersiz konu durumu/);

    await expect(
      repo.create(
        studiedEvent({ eventType: 'status_changed', previousStatus: null, newStatus: 'learning' }),
      ),
    ).rejects.toThrow(/zorunludur/);

    await expect(
      repo.create(
        studiedEvent({
          eventType: 'status_changed',
          previousStatus: 'review',
          newStatus: 'review',
        }),
      ),
    ).rejects.toThrow(/farklı olmalı/);

    await expect(repo.getAll()).resolves.toEqual([]);
  });

  it('rejects timestamps that are not valid ISO 8601 strings', async () => {
    await expect(repo.create(studiedEvent({ occurredAt: 'yesterday' }))).rejects.toThrow(
      /Geçersiz gerçekleşme zamanı/,
    );
    await expect(
      repo.create(studiedEvent({ createdAt: '2026-13-45T00:00:00.000Z' })),
    ).rejects.toThrow(/Geçersiz kayıt zamanı/);

    await expect(repo.getAll()).resolves.toEqual([]);
  });

  it('rejects a duplicate id and keeps the original row', async () => {
    await repo.create(studiedEvent());

    await expect(
      repo.create(studiedEvent({ occurredAt: '2026-03-05T10:00:00.000Z' })),
    ).rejects.toThrow(/zaten var/);

    const rows = await db.getAllAsync<{ id: string }>('SELECT id FROM study_events;');
    expect(rows).toEqual([{ id: 'event-1' }]);
  });
});

describe('reads', () => {
  it('orders newest first with createdAt and id as deterministic tie-breaks', async () => {
    await insertRaw(studiedEvent({ id: 'oldest', occurredAt: '2026-03-01T09:00:00.000Z' }));
    await insertRaw(studiedEvent({ id: 'newer', occurredAt: '2026-03-02T09:00:00.000Z' }));
    await insertRaw(
      studiedEvent({
        id: 'b',
        occurredAt: '2026-03-03T09:00:00.000Z',
        createdAt: '2026-03-03T09:10:00.000Z',
      }),
    );
    await insertRaw(
      studiedEvent({
        id: 'c',
        occurredAt: '2026-03-03T09:00:00.000Z',
        createdAt: '2026-03-03T09:10:00.000Z',
      }),
    );
    // Corrupted row: unknown event type must be skipped, never deleted.
    await insertRaw({
      id: 'broken',
      topicId: TOPIC_A,
      eventType: 'mystery',
      occurredAt: '2026-03-04T10:00:00.000Z',
      previousStatus: null,
      newStatus: null,
      createdAt: '2026-03-04T10:00:05.000Z',
    });

    const ids = (await repo.getAll()).map((event) => event.id);

    expect(ids).toEqual(['c', 'b', 'newer', 'oldest']);
    const rows = await db.getAllAsync<{ id: string }>('SELECT id FROM study_events;');
    expect(rows).toHaveLength(5);
  });

  it('validates the getRecent limit, caps it at 100 and clears on removeAll', async () => {
    await expect(repo.getRecent(0)).rejects.toThrow(/Geçersiz limit/);
    await expect(repo.getRecent(-5)).rejects.toThrow(/Geçersiz limit/);
    await expect(repo.getRecent(1.5)).rejects.toThrow(/Geçersiz limit/);

    for (let index = 0; index < 105; index += 1) {
      const timestamp = new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString();
      await insertRaw(studiedEvent({ id: `event-${index}`, occurredAt: timestamp }));
    }

    await expect(repo.getRecent(2)).resolves.toMatchObject([
      { id: 'event-104' },
      { id: 'event-103' },
    ]);
    await expect(repo.getRecent(100)).resolves.toHaveLength(100);

    await repo.removeAll();

    await expect(repo.getAll()).resolves.toEqual([]);
    await expect(repo.getRecent(10)).resolves.toEqual([]);
  });
});
