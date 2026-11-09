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
  PRACTICE_EXAMS_ARCHIVE_BASE_NAME,
} from '../schema';

type BindValue = string | number | null;

/**
 * In-memory SQLite adapter exposing exactly the `expo-sqlite` surface the
 * repository uses, so delete/cascade behaviour is exercised against a real
 * SQLite engine with `foreign_keys = ON`.
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

  run(sql: string): void {
    this.db.exec(sql);
  }

  count(sql: string): number {
    const row = this.db.prepare(sql).get() as { n: number } | undefined;
    return row?.n ?? 0;
  }
}

const TYT_RESULTS: LessonResult[] = [
  { lessonId: 'tyt_turkce', correct: 30, incorrect: 4, blank: 6, net: 29 },
  { lessonId: 'tyt_sosyal_bilimler', correct: 10, incorrect: 0, blank: 10, net: 10 },
  { lessonId: 'tyt_temel_matematik', correct: 0, incorrect: 0, blank: 40, net: 0 },
  { lessonId: 'tyt_fen_bilimleri', correct: 0, incorrect: 0, blank: 20, net: 0 },
];

function makeExam(id: string, date: string): PracticeExam {
  return {
    id,
    type: 'TYT',
    scoreTypeSnapshot: 'SAY',
    name: `${id} denemesi`,
    date,
    results: TYT_RESULTS,
    ...calculateExamTotals(TYT_RESULTS),
    createdAt: '2026-11-09T08:00:00.000Z',
    updatedAt: '2026-11-09T08:00:00.000Z',
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

describe('sqlitePracticeExamRepository.remove', () => {
  it('1./2. deletes only the requested exam and cascades its section rows', async () => {
    await repo.create(makeExam('exam-1', '2026-11-09T00:00:00.000Z'));
    await repo.create(makeExam('exam-2', '2026-11-08T00:00:00.000Z'));

    expect(db.count('SELECT COUNT(*) AS n FROM practice_exams;')).toBe(2);
    expect(db.count('SELECT COUNT(*) AS n FROM practice_exam_results;')).toBe(8);

    await repo.remove('exam-1');

    // Parent gone, its four children cascaded away.
    expect(await repo.getById('exam-1')).toBeNull();
    expect(db.count('SELECT COUNT(*) AS n FROM practice_exams;')).toBe(1);
    expect(
      db.count("SELECT COUNT(*) AS n FROM practice_exam_results WHERE exam_id = 'exam-1';"),
    ).toBe(0);
    expect(db.count('SELECT COUNT(*) AS n FROM practice_exam_results;')).toBe(4);
  });

  it('3. leaves every other exam and its sections completely unchanged', async () => {
    const survivor = makeExam('exam-2', '2026-11-08T00:00:00.000Z');
    await repo.create(makeExam('exam-1', '2026-11-09T00:00:00.000Z'));
    await repo.create(survivor);

    await repo.remove('exam-1');

    expect(await repo.getById('exam-2')).toEqual(survivor);
    expect(await repo.getAll()).toHaveLength(1);
  });

  it('8. handles a missing exam safely as a documented no-op', async () => {
    const only = makeExam('exam-1', '2026-11-09T00:00:00.000Z');
    await repo.create(only);

    await expect(repo.remove('does-not-exist')).resolves.toBeUndefined();

    // Nothing was touched.
    expect(await repo.getAll()).toEqual([only]);
    expect(db.count('SELECT COUNT(*) AS n FROM practice_exam_results;')).toBe(4);
  });

  it('9. never removes an archived legacy exam table or its rows', async () => {
    await repo.create(makeExam('exam-1', '2026-11-09T00:00:00.000Z'));
    db.run(`
      CREATE TABLE ${PRACTICE_EXAMS_ARCHIVE_BASE_NAME} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        exam_type TEXT NOT NULL,
        exam_date INTEGER NOT NULL,
        correct INTEGER NOT NULL,
        incorrect INTEGER NOT NULL,
        net REAL NOT NULL
      );
    `);
    db.run(
      `INSERT INTO ${PRACTICE_EXAMS_ARCHIVE_BASE_NAME} (exam_type, exam_date, correct, incorrect, net)
       VALUES ('TYT', 1000, 20, 5, 18.75), ('AYT', 2000, 30, 2, 29.5);`,
    );

    await repo.remove('exam-1');

    expect(db.count(`SELECT COUNT(*) AS n FROM ${PRACTICE_EXAMS_ARCHIVE_BASE_NAME};`)).toBe(2);
  });
});
