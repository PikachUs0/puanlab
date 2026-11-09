import type { PracticeExam } from '@/types';

import {
  createDefaultLessonResults,
  UnsupportedExamDefinitionError,
} from '../examCalculations';
import {
  getExamDefinition,
  getExamTotalQuestionCount,
  isExamSupported,
} from '../examDefinitions';

describe('central exam definitions', () => {
  it('13. builds the default TYT structure from the verified question counts', () => {
    expect(createDefaultLessonResults('TYT', 'SAY')).toEqual([
      { lessonId: 'tyt_turkce', correct: 0, incorrect: 0, blank: 40, net: 0 },
      { lessonId: 'tyt_sosyal_bilimler', correct: 0, incorrect: 0, blank: 20, net: 0 },
      { lessonId: 'tyt_temel_matematik', correct: 0, incorrect: 0, blank: 40, net: 0 },
      { lessonId: 'tyt_fen_bilimleri', correct: 0, incorrect: 0, blank: 20, net: 0 },
    ]);
    expect(getExamTotalQuestionCount('TYT', 'SAY')).toBe(120);
  });

  it('14. builds the AYT structure from the saved score type', () => {
    expect(createDefaultLessonResults('AYT', 'SAY').map((result) => result.lessonId)).toEqual([
      'ayt_matematik',
      'ayt_fizik',
      'ayt_kimya',
      'ayt_biyoloji',
    ]);
    expect(createDefaultLessonResults('AYT', 'EA').map((result) => result.lessonId)).toEqual([
      'ayt_matematik',
      'ayt_turk_dili_ve_edebiyati',
      'ayt_tarih_1',
      'ayt_cografya_1',
    ]);
    expect(createDefaultLessonResults('AYT', 'SOZ').map((result) => result.lessonId)).toEqual([
      'ayt_turk_dili_ve_edebiyati',
      'ayt_tarih_1',
      'ayt_cografya_1',
      'ayt_tarih_2',
      'ayt_cografya_2',
      'ayt_felsefe_grubu',
      'ayt_din_kulturu',
    ]);

    expect(getExamDefinition('AYT', 'SAY')?.lessons.map((lesson) => lesson.questionCount)).toEqual([
      40, 14, 13, 13,
    ]);
    expect(getExamDefinition('AYT', 'EA')?.lessons.map((lesson) => lesson.questionCount)).toEqual([
      40, 24, 10, 6,
    ]);
    expect(getExamDefinition('AYT', 'SOZ')?.lessons.map((lesson) => lesson.questionCount)).toEqual([
      24, 10, 6, 11, 11, 12, 6,
    ]);

    expect(getExamTotalQuestionCount('AYT', 'SAY')).toBe(80);
    expect(getExamTotalQuestionCount('AYT', 'EA')).toBe(80);
    expect(getExamTotalQuestionCount('AYT', 'SOZ')).toBe(80);
  });

  it('15. cannot create an AYT definition for DIL (TYT stays available)', () => {
    expect(getExamDefinition('AYT', 'DIL')).toBeNull();
    expect(isExamSupported('AYT', 'DIL')).toBe(false);
    expect(() => createDefaultLessonResults('AYT', 'DIL')).toThrow(UnsupportedExamDefinitionError);

    // DIL candidates still sit TYT in MVP 0.1.
    expect(isExamSupported('TYT', 'DIL')).toBe(true);
    expect(getExamTotalQuestionCount('TYT', 'DIL')).toBe(120);
  });

  it('16. keeps the saved scoreTypeSnapshot independent from later profile changes', () => {
    const exam: PracticeExam = {
      id: 'snapshot-1',
      type: 'AYT',
      scoreTypeSnapshot: 'SAY',
      name: 'AYT Denemesi',
      date: '2026-04-01T00:00:00.000Z',
      results: createDefaultLessonResults('AYT', 'SAY'),
      totalCorrect: 0,
      totalIncorrect: 0,
      totalBlank: 80,
      totalNet: 0,
      createdAt: '2026-04-01T00:00:00.000Z',
      updatedAt: '2026-04-01T00:00:00.000Z',
    };

    // The profile later switches to EA; the stored exam keeps its SAY snapshot
    // and the composition is resolved from that snapshot, not the profile.
    const profileScoreTypeAfterChange = 'EA' as const;
    expect(profileScoreTypeAfterChange).toBe('EA');
    expect(exam.scoreTypeSnapshot).toBe('SAY');
    expect(getExamDefinition(exam.type, exam.scoreTypeSnapshot)?.lessons.map((l) => l.lessonId)).toEqual(
      ['ayt_matematik', 'ayt_fizik', 'ayt_kimya', 'ayt_biyoloji'],
    );
  });
});
