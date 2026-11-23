/// <reference types="node" />

import { DatabaseSync } from 'node:sqlite';

import type { SQLiteDatabase } from 'expo-sqlite';

import { tyt2026 } from '@/data/curriculum/datasets';
import { createSqliteStudyEventRepository, createSqliteTopicProgressRepository } from '@/db';
import { CREATE_STUDY_EVENTS_TABLE, CREATE_TOPIC_PROGRESS_TABLE } from '@/db/schema';
import type { TopicProgress } from '@/types';

import {
  applyStudiedToday,
  buildStudiedEvent,
  createSingleFlightRunner,
  persistStudiedToday,
} from '../topicProgressUpdates';

type BindValue = string | number | null;

/**
 * In-memory SQLite adapter that mirrors the expo-sqlite surface used by the
 * repositories, including a real BEGIN/COMMIT/ROLLBACK transaction, so the
 * atomicity claims are exercised against an actual SQLite engine.
 */
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

  async withTransactionAsync(task: () => Promise<void>): Promise<void> {
    this.db.exec('BEGIN');

    try {
      await task();
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}

const topics = tyt2026.lessons.flatMap((lesson) => lesson.topics);
const TOPIC_ID = topics[0].id;
const TIMESTAMP = '2026-05-06T07:08:09.000Z';

let db: TestDatabase;
let progressRepo: ReturnType<typeof createSqliteTopicProgressRepository>;
let eventRepo: ReturnType<typeof createSqliteStudyEventRepository>;

type ProgressRow = {
  status: string;
  last_studied_at: string | null;
  updated_at: string;
};

function makeProgress(overrides: Partial<TopicProgress> = {}): TopicProgress {
  return {
    topicId: TOPIC_ID,
    status: 'not_started',
    note: null,
    lastStudiedAt: null,
    updatedAt: '2026-05-01T00:00:00.000Z',
    ...overrides,
  };
}

function readProgress(): Promise<ProgressRow | null> {
  return db.getFirstAsync<ProgressRow>(
    'SELECT status, last_studied_at, updated_at FROM topic_progress WHERE topic_id = ?;',
    [TOPIC_ID],
  );
}

beforeEach(async () => {
  db = new TestDatabase();
  await db.execAsync(CREATE_TOPIC_PROGRESS_TABLE);
  await db.execAsync(CREATE_STUDY_EVENTS_TABLE);

  progressRepo = createSqliteTopicProgressRepository(db as unknown as SQLiteDatabase);
  eventRepo = createSqliteStudyEventRepository(db as unknown as SQLiteDatabase);
});

describe('markStudiedToday persistence', () => {
  it('promotes not_started to learning and appends one studied event', async () => {
    await progressRepo.upsert(makeProgress({ status: 'not_started' }));

    const progress = applyStudiedToday(TOPIC_ID, makeProgress({ status: 'not_started' }), TIMESTAMP);
    const event = buildStudiedEvent(TOPIC_ID, TIMESTAMP, 'event-1');

    await persistStudiedToday(db, progressRepo, eventRepo, progress, event);

    expect((await readProgress())?.status).toBe('learning');

    const events = await eventRepo.getByTopicId(TOPIC_ID);
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe('studied');
  });

  it('keeps a learning topic learning', async () => {
    const current = makeProgress({ status: 'learning' });
    await progressRepo.upsert(current);

    const progress = applyStudiedToday(TOPIC_ID, current, TIMESTAMP);
    await persistStudiedToday(
      db,
      progressRepo,
      eventRepo,
      progress,
      buildStudiedEvent(TOPIC_ID, TIMESTAMP, 'event-2'),
    );

    expect((await readProgress())?.status).toBe('learning');
  });

  it('gives the progress row and the event the identical timestamp', async () => {
    const current = makeProgress({ status: 'practice' });
    const progress = applyStudiedToday(TOPIC_ID, current, TIMESTAMP);

    await persistStudiedToday(
      db,
      progressRepo,
      eventRepo,
      progress,
      buildStudiedEvent(TOPIC_ID, TIMESTAMP, 'event-3'),
    );

    const progressRow = await readProgress();
    const eventRow = await db.getFirstAsync<{ occurred_at: string; created_at: string }>(
      'SELECT occurred_at, created_at FROM study_events WHERE id = ?;',
      ['event-3'],
    );

    expect(progressRow?.last_studied_at).toBe(TIMESTAMP);
    expect(progressRow?.updated_at).toBe(TIMESTAMP);
    expect(eventRow?.occurred_at).toBe(TIMESTAMP);
    expect(eventRow?.created_at).toBe(TIMESTAMP);
  });

  it('writes a studied event with the correct fields', async () => {
    const event = buildStudiedEvent(TOPIC_ID, TIMESTAMP, 'event-4');

    await persistStudiedToday(
      db,
      progressRepo,
      eventRepo,
      applyStudiedToday(TOPIC_ID, null, TIMESTAMP),
      event,
    );

    const [stored] = await eventRepo.getByTopicId(TOPIC_ID);

    expect(stored).toEqual({
      id: 'event-4',
      topicId: TOPIC_ID,
      eventType: 'studied',
      occurredAt: TIMESTAMP,
      previousStatus: null,
      newStatus: null,
      createdAt: TIMESTAMP,
    });
  });

  it('rolls the progress back when the event insert fails', async () => {
    await eventRepo.create(buildStudiedEvent(TOPIC_ID, TIMESTAMP, 'event-dup'));

    const progress = applyStudiedToday(TOPIC_ID, makeProgress({ status: 'not_started' }), TIMESTAMP);

    await expect(
      persistStudiedToday(
        db,
        progressRepo,
        eventRepo,
        progress,
        buildStudiedEvent(TOPIC_ID, TIMESTAMP, 'event-dup'),
      ),
    ).rejects.toThrow();

    expect(await readProgress()).toBeNull();
    expect(await eventRepo.getByTopicId(TOPIC_ID)).toHaveLength(1);
  });

  it('creates no event when the progress write fails', async () => {
    const progress = applyStudiedToday(TOPIC_ID, makeProgress({ status: 'learning' }), TIMESTAMP);
    // `updated_at` is NOT NULL, so this violates a real constraint mid-transaction.
    const brokenProgress = { ...progress, updatedAt: null as unknown as string };

    await expect(
      persistStudiedToday(
        db,
        progressRepo,
        eventRepo,
        brokenProgress,
        buildStudiedEvent(TOPIC_ID, TIMESTAMP, 'event-5'),
      ),
    ).rejects.toThrow();

    expect(await eventRepo.getByTopicId(TOPIC_ID)).toHaveLength(0);
    expect(await readProgress()).toBeNull();
  });

  it('serializes rapid taps into a single studied write', async () => {
    const runner = createSingleFlightRunner();
    const current = makeProgress({ status: 'learning' });
    const progress = applyStudiedToday(TOPIC_ID, current, TIMESTAMP);
    const event = buildStudiedEvent(TOPIC_ID, TIMESTAMP, 'event-rapid');
    const task = () => persistStudiedToday(db, progressRepo, eventRepo, progress, event);

    await Promise.all([runner.run(task), runner.run(task), runner.run(task)]);

    expect(runner.isRunning()).toBe(false);
    expect((await readProgress())?.status).toBe('learning');
    expect(await eventRepo.getByTopicId(TOPIC_ID)).toHaveLength(1);
  });
});
