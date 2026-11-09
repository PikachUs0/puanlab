import type { LessonResult, PracticeExam } from '@/types';

import {
  InconsistentExamError,
  assertExamConsistent,
  calculateBlank,
  calculateExamTotals,
  calculateNet,
  checkExamConsistency,
  createDefaultLessonResults,
  sortExamsNewestFirst,
  validateLessonResult,
} from '../examCalculations';

/** Builds a fully-formed exam, overriding only the fields a test cares about. */
function makeExam(overrides: Partial<PracticeExam> & Pick<PracticeExam, 'id'>): PracticeExam {
  return {
    type: 'TYT',
    scoreTypeSnapshot: 'DIL',
    name: 'Deneme',
    date: '2026-03-01T00:00:00.000Z',
    results: [],
    totalCorrect: 0,
    totalIncorrect: 0,
    totalBlank: 0,
    totalNet: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** A lesson result with already-derived blank and net. */
function lessonResult(
  lessonId: string,
  correct: number,
  incorrect: number,
  total: number,
): LessonResult {
  return {
    lessonId,
    correct,
    incorrect,
    blank: calculateBlank(total, correct, incorrect),
    net: calculateNet(correct, incorrect),
  };
}

describe('calculateBlank', () => {
  it('1. computes blank as total minus correct minus incorrect', () => {
    expect(calculateBlank(40, 28, 6)).toBe(6);
    expect(calculateBlank(20, 15, 3)).toBe(2);
  });
});

describe('calculateNet', () => {
  it('2. computes net as correct minus one quarter of incorrect', () => {
    expect(calculateNet(28, 6)).toBe(26.5);
    expect(calculateNet(34, 4)).toBe(33);
  });

  it('3. returns zero when there are no correct and no incorrect answers', () => {
    expect(calculateNet(0, 0)).toBe(0);
    expect(calculateBlank(40, 0, 0)).toBe(40);
  });

  it('4. keeps the full score when every answer is correct', () => {
    expect(calculateNet(40, 0)).toBe(40);
    expect(calculateBlank(40, 40, 0)).toBe(0);
  });

  it('5. reduces the net by one quarter per incorrect answer', () => {
    expect(calculateNet(10, 1)).toBe(9.75);
    expect(calculateNet(10, 4)).toBe(9);
    expect(calculateNet(10, 0) - calculateNet(10, 4)).toBe(1);
  });
});

describe('validateLessonResult', () => {
  it('6. rejects a negative correct count', () => {
    expect(validateLessonResult(40, -1, 0)).toEqual({ valid: false, reason: 'negative' });
  });

  it('7. rejects a negative incorrect count', () => {
    expect(validateLessonResult(40, 0, -1)).toEqual({ valid: false, reason: 'negative' });
  });

  it('8. rejects a decimal correct count', () => {
    expect(validateLessonResult(40, 10.5, 0)).toEqual({ valid: false, reason: 'non_integer' });
  });

  it('9. rejects a decimal incorrect count', () => {
    expect(validateLessonResult(40, 0, 2.5)).toEqual({ valid: false, reason: 'non_integer' });
  });

  it('10. rejects correct + incorrect exceeding the section total', () => {
    expect(validateLessonResult(40, 30, 15).valid).toBe(false);
    expect(validateLessonResult(40, 30, 15)).toEqual({ valid: false, reason: 'exceeds_total' });
    expect(validateLessonResult(20, 20, 1).valid).toBe(false);
  });

  it('11. never allows a negative blank', () => {
    // A valid result can never exceed the total, so its blank is never negative.
    expect(validateLessonResult(40, 40, 0).valid).toBe(true);
    expect(calculateBlank(40, 40, 0)).toBe(0);

    // The only case that could produce a negative blank is rejected up front.
    expect(validateLessonResult(20, 15, 6).valid).toBe(false);
    expect(validateLessonResult(40, 25, 20).valid).toBe(false);
  });
});

describe('calculateExamTotals', () => {
  it('12. equals the sum of the lesson results', () => {
    const results: LessonResult[] = [
      lessonResult('tyt_turkce', 34, 4, 40),
      lessonResult('tyt_sosyal_bilimler', 15, 3, 20),
      lessonResult('tyt_temel_matematik', 28, 6, 40),
      lessonResult('tyt_fen_bilimleri', 13, 4, 20),
    ];

    expect(calculateExamTotals(results)).toEqual({
      totalCorrect: 90,
      totalIncorrect: 17,
      totalBlank: 13,
      totalNet: 85.75,
    });
  });
});

describe('sortExamsNewestFirst', () => {
  it('17. sorts by exam date, then updatedAt, then id, all descending', () => {
    const exams: PracticeExam[] = [
      makeExam({ id: 'a', date: '2026-03-01T00:00:00.000Z' }),
      makeExam({ id: 'b', date: '2026-03-05T00:00:00.000Z', updatedAt: '2026-03-05T00:00:00.000Z' }),
      makeExam({ id: 'c', date: '2026-03-05T00:00:00.000Z', updatedAt: '2026-03-06T00:00:00.000Z' }),
      makeExam({ id: 'd', date: '2026-03-05T00:00:00.000Z', updatedAt: '2026-03-06T00:00:00.000Z' }),
    ];

    expect(sortExamsNewestFirst(exams).map((exam) => exam.id)).toEqual(['d', 'c', 'b', 'a']);
  });
});

describe('checkExamConsistency', () => {
  it('accepts a fully consistent exam', () => {
    const results = createDefaultLessonResults('TYT', 'SAY');
    const exam = makeExam({ id: 'ok', results, ...calculateExamTotals(results) });

    expect(checkExamConsistency(exam)).toEqual({ consistent: true });
  });

  it('18. rejects inconsistent stored totals before writing', () => {
    const results = createDefaultLessonResults('TYT', 'SAY');
    const totals = calculateExamTotals(results);
    const exam = makeExam({ id: 'bad', results, ...totals, totalNet: totals.totalNet + 1 });

    expect(checkExamConsistency(exam)).toEqual({
      consistent: false,
      issue: 'inconsistent_exam_totals',
    });
    expect(() => assertExamConsistent(exam)).toThrow(InconsistentExamError);
  });

  it('rejects a section whose derived blank/net do not match its counts', () => {
    const results = createDefaultLessonResults('TYT', 'SAY');
    const tampered = results.map((result, index) =>
      index === 0 ? { ...result, blank: result.blank - 1 } : result,
    );
    const exam = makeExam({
      id: 'tampered',
      results: tampered,
      ...calculateExamTotals(tampered),
    });

    expect(checkExamConsistency(exam)).toEqual({
      consistent: false,
      issue: 'inconsistent_lesson_totals',
    });
  });
});
