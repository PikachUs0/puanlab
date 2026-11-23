/// <reference types="node" />

import { DatabaseSync } from 'node:sqlite';

import type { SQLiteDatabase } from 'expo-sqlite';

import { tyt2026 } from '@/data/curriculum/datasets';
import { createSqliteStudyEventRepository, createSqliteTopicProgressRepository } from '@/db';
import { CREATE_STUDY_EVENTS_TABLE, CREATE_TOPIC_PROGRESS_TABLE } from '@/db/schema';
import type { TopicProgress, TopicStatus } from '@/types';

import {
  applyStatusChange,
  buildStatusChangedEvent,
  createSingleFlightRunner,
  persistStatusChange,
  resolvePreviousStatus,
} from '../topicProgressUpdates';

type BindValue = string | number | null;

/**
 * In-memory SQLite adapter mirroring the expo-sqlite surface, including a real
 * BEGIN/COMMIT/ROLLBACK transaction, so the atomicity claims are exercised
 * against an actual SQLite engine.
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
const TIMESTAMP = '2026-06-07T08:09:10.000Z';
const EARLIER_STUDY = '2026-01-02T03:04:05.000Z';

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

function buildTransition(current: TopicProgress | null, next: TopicStatus, id: string) {
  const previousStatus = resolvePreviousStatus(current, next);

  if (previousStatus === null) {
    throw new Error('expected a real status transition');
  }

  return {
    progress: applyStatusChange(TOPIC_ID, current, next, TIMESTAMP),
    event: buildStatusChangedEvent(TOPIC_ID, TIMESTAMP, previousStatus, next, id),
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

describe('status change events', () => {
  it('records a transition from the implicit not_started status', async () => {
    const { progress, event } = buildTransition(null, 'learning', 'status-1');

    await persistStatusChange(db, progressRepo, eventRepo, progress, event);

    expect((await readProgress())?.status).toBe('learning');

    const [stored] = await eventRepo.getByTopicId(TOPIC_ID);
    expect(stored).toMatchObject({
      eventType: 'status_changed',
      previousStatus: 'not_started',
      newStatus: 'learning',
    });
  });

  it('records a transition between two existing statuses', async () => {
    const current = makeProgress({ status: 'learning' });
    await progressRepo.upsert(current);

    const { progress, event } = buildTransition(current, 'practice', 'status-2');
    await persistStatusChange(db, progressRepo, eventRepo, progress, event);

    expect((await readProgress())?.status).toBe('practice');

    const [stored] = await eventRepo.getByTopicId(TOPIC_ID);
    expect(stored).toMatchObject({
      eventType: 'status_changed',
      previousStatus: 'learning',
      newStatus: 'practice',
    });
  });

  it('treats selecting the saved status as a no-op', () => {
    expect(resolvePreviousStatus(null, 'not_started')).toBeNull();
    expect(resolvePreviousStatus(makeProgress({ status: 'learning' }), 'learning')).toBeNull();
    expect(resolvePreviousStatus(makeProgress({ status: 'review' }), 'strong')).toBe('review');
  });

  it('leaves lastStudiedAt unchanged', async () => {
    const current = makeProgress({ status: 'learning', lastStudiedAt: EARLIER_STUDY });
    await progressRepo.upsert(current);

    const { progress, event } = buildTransition(current, 'strong', 'status-3');
    await persistStatusChange(db, progressRepo, eventRepo, progress, event);

    expect((await readProgress())?.last_studied_at).toBe(EARLIER_STUDY);
  });

  it('stamps progress and event with the identical timestamp', async () => {
    const current = makeProgress({ status: 'learning' });
    const { progress, event } = buildTransition(current, 'practice', 'status-4');

    await persistStatusChange(db, progressRepo, eventRepo, progress, event);

    const progressRow = await readProgress();
    const eventRow = await db.getFirstAsync<{ occurred_at: string; created_at: string }>(
      'SELECT occurred_at, created_at FROM study_events WHERE id = ?;',
      ['status-4'],
    );

    expect(progressRow?.updated_at).toBe(TIMESTAMP);
    expect(eventRow?.occurred_at).toBe(TIMESTAMP);
    expect(eventRow?.created_at).toBe(TIMESTAMP);
  });

  it('rolls the progress back when the event insert fails', async () => {
    const current = makeProgress({ status: 'learning' });
    await progressRepo.upsert(current);
    await eventRepo.create(
      buildStatusChangedEvent(TOPIC_ID, TIMESTAMP, 'not_started', 'learning', 'status-dup'),
    );

    const { progress, event } = buildTransition(current, 'practice', 'status-dup');

    await expect(persistStatusChange(db, progressRepo, eventRepo, progress, event)).rejects.toThrow();

    const row = await readProgress();
    expect(row?.status).toBe('learning');
    expect(row?.updated_at).toBe(current.updatedAt);
    expect(await eventRepo.getByTopicId(TOPIC_ID)).toHaveLength(1);
  });

  it('serializes rapid duplicate selection into a single event', async () => {
    const runner = createSingleFlightRunner();
    const { progress, event } = buildTransition(null, 'learning', 'status-rapid');
    const task = () => persistStatusChange(db, progressRepo, eventRepo, progress, event);

    await Promise.all([runner.run(task), runner.run(task), runner.run(task)]);

    expect(runner.isRunning()).toBe(false);
    expect((await readProgress())?.status).toBe('learning');
    expect(await eventRepo.getByTopicId(TOPIC_ID)).toHaveLength(1);
  });
});
