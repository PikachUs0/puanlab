import type { SQLiteDatabase } from 'expo-sqlite';

import {
  assertExamConsistent,
  calculateExamTotals,
  checkExamConsistency,
  orderLessonResults,
  sortExamsNewestFirst,
} from '@/features/exams';
import type { ExamType, LessonResult, PracticeExam, ScoreType } from '@/types';

import type { PracticeExamRepository } from './practiceExamRepository';

type PracticeExamRow = {
  id: string;
  exam_type: string;
  score_type_snapshot: string;
  name: string;
  exam_date: string;
  total_correct: number;
  total_incorrect: number;
  total_blank: number;
  total_net: number;
  created_at: string;
  updated_at: string;
};

type PracticeExamResultRow = {
  exam_id: string;
  lesson_id: string;
  correct: number;
  incorrect: number;
  blank: number;
  net: number;
};

const EXAM_COLUMNS =
  'id, exam_type, score_type_snapshot, name, exam_date, total_correct, total_incorrect, total_blank, total_net, created_at, updated_at';
const RESULT_COLUMNS = 'exam_id, lesson_id, correct, incorrect, blank, net';

const EXAM_TYPES: readonly ExamType[] = ['TYT', 'AYT'];
const SCORE_TYPES: readonly ScoreType[] = ['SAY', 'EA', 'SOZ', 'DIL'];

function isExamType(value: string): value is ExamType {
  return (EXAM_TYPES as readonly string[]).includes(value);
}

function isScoreType(value: string): value is ScoreType {
  return (SCORE_TYPES as readonly string[]).includes(value);
}

/** The database is a trust boundary: only valid ISO 8601 strings are accepted. */
function parseIsoDate(value: string): string | null {
  return Number.isNaN(new Date(value).getTime()) ? null : value;
}

function toLessonResult(row: PracticeExamResultRow): LessonResult {
  return {
    lessonId: row.lesson_id,
    correct: row.correct,
    incorrect: row.incorrect,
    blank: row.blank,
    net: row.net,
  };
}

/**
 * Maps a stored exam row plus its section rows into a `PracticeExam`.
 * Returns `null` for rows that cannot be read as a valid exam (unknown exam
 * type or score type, malformed dates) so the caller can skip them without
 * deleting anything.
 */
function toPracticeExam(
  row: PracticeExamRow,
  resultRows: PracticeExamResultRow[],
): PracticeExam | null {
  if (!isExamType(row.exam_type) || !isScoreType(row.score_type_snapshot)) {
    return null;
  }

  const date = parseIsoDate(row.exam_date);
  const createdAt = parseIsoDate(row.created_at);
  const updatedAt = parseIsoDate(row.updated_at);

  if (date === null || createdAt === null || updatedAt === null) {
    return null;
  }

  const results = orderLessonResults(
    row.exam_type,
    row.score_type_snapshot,
    resultRows.map(toLessonResult),
  );

  return {
    id: row.id,
    type: row.exam_type,
    scoreTypeSnapshot: row.score_type_snapshot,
    name: row.name,
    date,
    results,
    totalCorrect: row.total_correct,
    totalIncorrect: row.total_incorrect,
    totalBlank: row.total_blank,
    totalNet: row.total_net,
    createdAt,
    updatedAt,
  };
}

/**
 * Rebuilds an exam from stored rows and drops it when it is inconsistent.
 * Corrupted rows are skipped defensively but never deleted, so they survive
 * for later inspection or repair.
 */
function readExam(
  row: PracticeExamRow,
  resultRows: PracticeExamResultRow[],
): PracticeExam | null {
  const exam = toPracticeExam(row, resultRows);

  if (exam === null || !checkExamConsistency(exam).consistent) {
    return null;
  }

  return exam;
}

function groupResultsByExamId(rows: PracticeExamResultRow[]): Map<string, PracticeExamResultRow[]> {
  const grouped = new Map<string, PracticeExamResultRow[]>();

  for (const row of rows) {
    const bucket = grouped.get(row.exam_id);

    if (bucket) {
      bucket.push(row);
    } else {
      grouped.set(row.exam_id, [row]);
    }
  }

  return grouped;
}

async function insertLessonResults(db: SQLiteDatabase, exam: PracticeExam): Promise<void> {
  for (const result of exam.results) {
    await db.runAsync(
      `INSERT INTO practice_exam_results (exam_id, lesson_id, correct, incorrect, blank, net)
       VALUES (?, ?, ?, ?, ?, ?);`,
      [exam.id, result.lessonId, result.correct, result.incorrect, result.blank, result.net],
    );
  }
}

/** SQLite-backed implementation of the `PracticeExamRepository` contract. */
export function createSqlitePracticeExamRepository(db: SQLiteDatabase): PracticeExamRepository {
  return {
    getAll: async () => {
      const examRows = await db.getAllAsync<PracticeExamRow>(
        `SELECT ${EXAM_COLUMNS} FROM practice_exams;`,
      );
      const resultRows = await db.getAllAsync<PracticeExamResultRow>(
        `SELECT ${RESULT_COLUMNS} FROM practice_exam_results;`,
      );
      const resultsByExamId = groupResultsByExamId(resultRows);

      const exams: PracticeExam[] = [];

      for (const row of examRows) {
        const exam = readExam(row, resultsByExamId.get(row.id) ?? []);

        if (exam) {
          exams.push(exam);
        }
      }

      return sortExamsNewestFirst(exams);
    },

    getById: async (id) => {
      const row = await db.getFirstAsync<PracticeExamRow>(
        `SELECT ${EXAM_COLUMNS} FROM practice_exams WHERE id = ?;`,
        [id],
      );

      if (!row) {
        return null;
      }

      const resultRows = await db.getAllAsync<PracticeExamResultRow>(
        `SELECT ${RESULT_COLUMNS} FROM practice_exam_results WHERE exam_id = ?;`,
        [id],
      );

      return readExam(row, resultRows);
    },

    create: async (exam) => {
      assertExamConsistent(exam);

      const totals = calculateExamTotals(exam.results);

      await db.withTransactionAsync(async () => {
        await db.runAsync(
          `INSERT INTO practice_exams
             (id, exam_type, score_type_snapshot, name, exam_date, total_correct, total_incorrect, total_blank, total_net, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
          [
            exam.id,
            exam.type,
            exam.scoreTypeSnapshot,
            exam.name,
            exam.date,
            totals.totalCorrect,
            totals.totalIncorrect,
            totals.totalBlank,
            totals.totalNet,
            exam.createdAt,
            exam.updatedAt,
          ],
        );

        await insertLessonResults(db, exam);
      });
    },

    update: async (exam) => {
      assertExamConsistent(exam);

      const totals = calculateExamTotals(exam.results);

      await db.withTransactionAsync(async () => {
        await db.runAsync(
          `UPDATE practice_exams SET
             exam_type = ?,
             score_type_snapshot = ?,
             name = ?,
             exam_date = ?,
             total_correct = ?,
             total_incorrect = ?,
             total_blank = ?,
             total_net = ?,
             updated_at = ?
           WHERE id = ?;`,
          [
            exam.type,
            exam.scoreTypeSnapshot,
            exam.name,
            exam.date,
            totals.totalCorrect,
            totals.totalIncorrect,
            totals.totalBlank,
            totals.totalNet,
            exam.updatedAt,
            exam.id,
          ],
        );

        // Sections are fully replaced so removed sections do not linger.
        await db.runAsync('DELETE FROM practice_exam_results WHERE exam_id = ?;', [exam.id]);
        await insertLessonResults(db, exam);
      });
    },

    remove: async (id) => {
      // `practice_exam_results` cascades on delete (foreign_keys is ON), so only
      // the parent row is deleted here.
      //
      // Documented no-op: deleting an unknown `id` affects no row and resolves
      // normally. That keeps a repeated or stale delete safe and idempotent
      // instead of surfacing a spurious error, and it can never touch another
      // exam or the archived legacy tables.
      await db.runAsync('DELETE FROM practice_exams WHERE id = ?;', [id]);
    },
  };
}
