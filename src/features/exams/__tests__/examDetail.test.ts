import type { LessonResult, PracticeExam } from '@/types';

import {
  buildExamLessonRows,
  normalizeExamIdParam,
  resolveExamDetailStatus,
} from '../examDetail';
import { formatExamDateForDisplay, formatNetForDisplay } from '../examForm';

function makeExam(overrides: Partial<PracticeExam> = {}): PracticeExam {
  return {
    id: 'exam-1',
    type: 'TYT',
    scoreTypeSnapshot: 'SAY',
    name: '3D Türkiye Geneli - 1',
    date: '2026-11-09T12:00:00.000Z',
    results: [
      { lessonId: 'tyt_turkce', correct: 34, incorrect: 4, blank: 2, net: 33 },
      { lessonId: 'tyt_sosyal_bilimler', correct: 15, incorrect: 3, blank: 2, net: 14.25 },
      { lessonId: 'tyt_temel_matematik', correct: 28, incorrect: 6, blank: 6, net: 26.5 },
      { lessonId: 'tyt_fen_bilimleri', correct: 13, incorrect: 4, blank: 3, net: 12 },
    ],
    totalCorrect: 90,
    totalIncorrect: 17,
    totalBlank: 13,
    totalNet: 85.75,
    createdAt: '2026-11-09T12:00:00.000Z',
    updatedAt: '2026-11-09T12:00:00.000Z',
    ...overrides,
  };
}

describe('exam detail helpers', () => {
  it('1. formats dates in Turkish and leaves invalid input untouched', () => {
    expect(formatExamDateForDisplay('2026-11-09T12:00:00.000Z')).toBe('9 Kasım 2026');
    expect(formatExamDateForDisplay('2024-10-18T09:00:00.000Z')).toBe('18 Ekim 2024');
    expect(formatExamDateForDisplay('geçersiz')).toBe('geçersiz');
  });

  it('2. formats nets with Turkish decimals and at most two places', () => {
    expect(formatNetForDisplay(85.75)).toBe('85,75');
    expect(formatNetForDisplay(26.5)).toBe('26,5');
    expect(formatNetForDisplay(29)).toBe('29');
    expect(formatNetForDisplay(-0.25)).toBe('-0,25');
  });

  it('3. resolves lesson names/counts and preserves the official section order', () => {
    // Results deliberately shuffled; the rows must follow the TYT definition order.
    const exam = makeExam({
      results: [
        { lessonId: 'tyt_fen_bilimleri', correct: 13, incorrect: 4, blank: 3, net: 12 },
        { lessonId: 'tyt_temel_matematik', correct: 28, incorrect: 6, blank: 6, net: 26.5 },
        { lessonId: 'tyt_sosyal_bilimler', correct: 15, incorrect: 3, blank: 2, net: 14.25 },
        { lessonId: 'tyt_turkce', correct: 34, incorrect: 4, blank: 2, net: 33 },
      ],
    });

    const rows = buildExamLessonRows(exam);

    expect(rows.map((row) => row.lessonId)).toEqual([
      'tyt_turkce',
      'tyt_sosyal_bilimler',
      'tyt_temel_matematik',
      'tyt_fen_bilimleri',
    ]);
    expect(rows.map((row) => row.name)).toEqual([
      'Türkçe',
      'Sosyal Bilimler',
      'Temel Matematik',
      'Fen Bilimleri',
    ]);
    expect(rows.map((row) => row.questionCount)).toEqual([40, 20, 40, 20]);
    expect(rows[0]).toEqual({
      lessonId: 'tyt_turkce',
      name: 'Türkçe',
      questionCount: 40,
      correct: 34,
      incorrect: 4,
      blank: 2,
      net: 33,
    });
  });

  it('4. resolves the AYT layout from the saved score type snapshot', () => {
    const exam = makeExam({
      type: 'AYT',
      scoreTypeSnapshot: 'SOZ',
      results: [
        { lessonId: 'ayt_din_kulturu', correct: 5, incorrect: 1, blank: 0, net: 4.75 },
        { lessonId: 'ayt_turk_dili_ve_edebiyati', correct: 20, incorrect: 4, blank: 0, net: 19 },
      ],
    });

    const rows = buildExamLessonRows(exam);

    expect(rows.map((row) => row.lessonId)).toEqual([
      'ayt_turk_dili_ve_edebiyati',
      'ayt_din_kulturu',
    ]);
    expect(rows.map((row) => row.name)).toEqual([
      'Türk Dili ve Edebiyatı',
      'Din Kültürü ve Ahlak Bilgisi',
    ]);
    expect(rows.map((row) => row.questionCount)).toEqual([24, 6]);
  });

  it('5. handles an unknown lesson id safely and appends it last', () => {
    const exam = makeExam({
      results: [
        { lessonId: 'tyt_bilinmeyen_ders', correct: 1, incorrect: 0, blank: 0, net: 1 },
        { lessonId: 'tyt_turkce', correct: 34, incorrect: 4, blank: 2, net: 33 },
      ],
    });

    const rows = buildExamLessonRows(exam);

    expect(rows.map((row) => row.lessonId)).toEqual(['tyt_turkce', 'tyt_bilinmeyen_ders']);

    const unknown = rows[1];

    expect(unknown.name).toBe('tyt_bilinmeyen_ders');
    expect(unknown.questionCount).toBeNull();
    expect(unknown.correct).toBe(1);
  });

  it('6. does not crash on malformed historical data', () => {
    const malformed = makeExam({
      results: [
        { lessonId: 'tyt_turkce', correct: 10, incorrect: 2, blank: 28, net: 9.5 },
        null as unknown as LessonResult,
        { lessonId: 'tyt_fen_bilimleri', correct: Number.NaN, incorrect: 4, blank: 3, net: Number.NaN },
      ],
    });

    const rows = buildExamLessonRows(malformed);

    expect(rows.map((row) => row.lessonId)).toEqual(['tyt_turkce', 'tyt_fen_bilimleri']);
    expect(rows[1].correct).toBe(0);
    expect(rows[1].net).toBe(0);
    expect(rows[1].incorrect).toBe(4);

    expect(buildExamLessonRows(makeExam({ results: undefined as unknown as LessonResult[] }))).toEqual(
      [],
    );
  });

  it('7. normalizes the route id param and never crashes on a missing id', () => {
    expect(normalizeExamIdParam('exam-1')).toBe('exam-1');
    expect(normalizeExamIdParam('  exam-1  ')).toBe('exam-1');
    expect(normalizeExamIdParam(['exam-1', 'exam-2'])).toBe('exam-1');
    expect(normalizeExamIdParam('   ')).toBeNull();
    expect(normalizeExamIdParam(undefined)).toBeNull();

    // A missing/unknown id never reaches the ready state.
    expect(resolveExamDetailStatus({ isHydrated: true, examId: null, exam: null })).toBe(
      'not_found',
    );
    expect(resolveExamDetailStatus({ isHydrated: true, examId: 'exam-1', exam: null })).toBe(
      'not_found',
    );
    expect(resolveExamDetailStatus({ isHydrated: false, examId: 'exam-1', exam: makeExam() })).toBe(
      'loading',
    );
    expect(resolveExamDetailStatus({ isHydrated: true, examId: 'exam-1', exam: makeExam() })).toBe(
      'ready',
    );
  });
});
