/// <reference types="node" />

import { DatabaseSync } from 'node:sqlite';

import type { SQLiteDatabase } from 'expo-sqlite';

import { calculateExamTotals } from '@/features/exams';
import type { LessonResult, PracticeExam } from '@/types';

import { createSqlitePracticeExamRepository } from '../repositories/sqlitePracticeExamRepository';
import {
  CREATE_PRACTICE_EXAMS_INDEX,
  CREATE_PRACTICE_EXAMS_TABLE,
  CREATE_PRACTICE_EXAM_RESULTS_TABLE,
} from '../schema';

type BindValue = string | number | null;

/**
 * In-memory SQLite adapter exposing exactly the `expo-sqlite` surface the
 * repository uses. It lets the real `update` transaction run against a real
 * SQLite engine — including BEGIN/COMMIT/ROLLBACK — without a device database.
 */
class TestDatabase {
  private readonly db = new DatabaseSync(':memory:');

  /** When set, the next section-row insert throws, forcing a mid-transaction failure. */
  failNextResultInsert = false;

  async execAsync(sql: string): Promise<void> {
    this.db.exec(sql);
  }

  async runAsync(sql: string, params: BindValue[] = []): Promise<void> {
    if (this.failNextResultInsert && sql.includes('INSERT INTO practice_exam_results')) {
      this.failNextResultInsert = false;
      throw new Error('simulated result insert failure');
    }

    this.db.prepare(sql).run(...params);
  }

  async getFirstAsync<T>(sql: string, params: BindValue[] = []): Promise<T | null> {
    const row = this.db.prepare(sql).get(...params);
    return (row as T | undefined) ?? null;
  }

  async getAllAsync<T>(sql: string, params: BindValue[] = []): Promise<T[]> {
    return this.db.prepare(sql).all(...params) as unknown as T[];
  }

  /** Mirrors expo-sqlite's `withTransactionAsync`: BEGIN, COMMIT, ROLLBACK. */
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

  run(sql: string): void {
    this.db.exec(sql);
  }
}

const CREATED_AT = '2026-11-09T08:00:00.000Z';

const ORIGINAL_RESULTS: LessonResult[] = [
  { lessonId: 'tyt_turkce', correct: 30, incorrect: 4, blank: 6, net: 29 },
  { lessonId: 'tyt_sosyal_bilimler', correct: 10, incorrect: 0, blank: 10, net: 10 },
  { lessonId: 'tyt_temel_matematik', correct: 0, incorrect: 0, blank: 40, net: 0 },
  { lessonId: 'tyt_fen_bilimleri', correct: 0, incorrect: 0, blank: 20, net: 0 },
];

function makeExam(overrides: Partial<PracticeExam> = {}): PracticeExam {
  const results = overrides.results ?? ORIGINAL_RESULTS;

  return {
    id: 'exam-1',
    type: 'TYT',
    scoreTypeSnapshot: 'SAY',
    name: 'Özdebir TYT 2',
    date: '2026-11-09T00:00:00.000Z',
    results,
    ...calculateExamTotals(results),
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

let db: TestDatabase;
let repo: ReturnType<typeof createSqlitePracticeExamRepository>;

beforeEach(async () => {
  db = new TestDatabase();
  db.run('PRAGMA foreign_keys = ON;');
  await db.execAsync(CREATE_PRACTICE_EXAMS_TABLE);
  await db.execAsync(CREATE_PRACTICE_EXAM_RESULTS_TABLE);
  await db.execAsync(CREATE_PRACTICE_EXAMS_INDEX);

  repo = createSqlitePracticeExamRepository(db as unknown as SQLiteDatabase);
});

describe('sqlitePracticeExamRepository.update', () => {
  it('replaces the section rows, keeps createdAt and never creates a second record', async () => {
    await repo.create(makeExam());

    const editedResults: LessonResult[] = [
      { lessonId: 'tyt_turkce', correct: 12, incorrect: 1, blank: 27, net: 11.75 },
      { lessonId: 'tyt_sosyal_bilimler', correct: 8, incorrect: 2, blank: 10, net: 7.5 },
      { lessonId: 'tyt_temel_matematik', correct: 5, incorrect: 0, blank: 35, net: 5 },
      { lessonId: 'tyt_fen_bilimleri', correct: 3, incorrect: 1, blank: 16, net: 2.75 },
    ];

    await repo.update(
      makeExam({
        name: 'Güncellenmiş Deneme',
        results: editedResults,
        updatedAt: '2026-11-12T09:00:00.000Z',
      }),
    );

    const all = await repo.getAll();
    expect(all).toHaveLength(1);

    const stored = await repo.getById('exam-1');
    expect(stored?.id).toBe('exam-1');
    expect(stored?.name).toBe('Güncellenmiş Deneme');
    expect(stored?.createdAt).toBe(CREATED_AT);
    expect(stored?.updatedAt).toBe('2026-11-12T09:00:00.000Z');
    // Old section rows are gone: no mixing of old and new answers.
    expect(stored?.results).toEqual(editedResults);
    expect(stored?.totalCorrect).toBe(28);
    expect(stored?.totalNet).toBe(12 - 1 / 4 + (8 - 2 / 4) + 5 + (3 - 1 / 4));
  });

  it('rolls back and preserves the previous complete record when a write fails', async () => {
    const original = makeExam();
    await repo.create(original);

    const editedResults: LessonResult[] = [
      { lessonId: 'tyt_turkce', correct: 1, incorrect: 0, blank: 39, net: 1 },
      { lessonId: 'tyt_sosyal_bilimler', correct: 1, incorrect: 0, blank: 19, net: 1 },
      { lessonId: 'tyt_temel_matematik', correct: 1, incorrect: 0, blank: 39, net: 1 },
      { lessonId: 'tyt_fen_bilimleri', correct: 1, incorrect: 0, blank: 19, net: 1 },
    ];

    const edited = makeExam({
      name: 'Bozuk Güncelleme',
      results: editedResults,
      updatedAt: '2026-11-12T09:00:00.000Z',
    });

    db.failNextResultInsert = true;

    await expect(repo.update(edited)).rejects.toThrow(/simulated result insert failure/);

    // The whole transaction was rolled back: the parent row, the totals and
    // every section row are exactly what they were before the failed update.
    const stored = await repo.getById('exam-1');
    expect(stored).toEqual(original);
  });
});
