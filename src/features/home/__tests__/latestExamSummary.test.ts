import type { PracticeExam } from '@/types';

import { selectHomeState } from '../homeSelectors';
import {
  UNKNOWN_EXAM_DATE_LABEL,
  UNNAMED_EXAM_LABEL,
  selectLatestExam,
  selectLatestExamSummary,
} from '../latestExamSummary';

/** Fixed reference date: 9 November 2026, 09:00 local time. Never the real clock. */
const EXAM_DATE = new Date(2026, 10, 9, 9, 0, 0).toISOString();

/** The untouched exam every fixture starts from. */
const BASE_EXAM: PracticeExam = {
  id: 'exam-base',
  type: 'TYT',
  scoreTypeSnapshot: 'SAY',
  name: 'TYT Denemesi - 9 Kasım',
  date: EXAM_DATE,
  results: [],
  totalCorrect: 80,
  totalIncorrect: 30,
  totalBlank: 10,
  totalNet: 72.5,
  createdAt: new Date(2026, 10, 9, 10, 0, 0).toISOString(),
  updatedAt: new Date(2026, 10, 9, 10, 0, 0).toISOString(),
};

function makeExam(overrides: Partial<PracticeExam> = {}): PracticeExam {
  return { ...BASE_EXAM, ...overrides };
}

/** Builds the store's `Record<id, exam>` shape from a list of exams. */
function byId(...exams: PracticeExam[]): Record<string, PracticeExam> {
  return Object.fromEntries(exams.map((exam) => [exam.id, exam]));
}

describe('Home latest-exam summary — the four data states', () => {
  it('1. reports noData and an empty summary when nothing exists', () => {
    expect(selectHomeState({ topicProgressCount: 0, examCount: 0 })).toBe('noData');
    expect(selectLatestExamSummary({ isHydrated: true, examsById: {} })).toEqual({
      status: 'empty',
    });
  });

  it('2. reports topicsOnly and an empty summary when only topics exist', () => {
    expect(selectHomeState({ topicProgressCount: 3, examCount: 0 })).toBe('topicsOnly');
    expect(selectLatestExamSummary({ isHydrated: true, examsById: {} })).toEqual({
      status: 'empty',
    });
  });

  it('3. reports examsOnly and a ready summary when only exams exist', () => {
    const exam = makeExam();

    expect(selectHomeState({ topicProgressCount: 0, examCount: 1 })).toBe('examsOnly');
    expect(selectLatestExamSummary({ isHydrated: true, examsById: byId(exam) })).toEqual({
      status: 'ready',
      summary: expect.objectContaining({ id: exam.id }),
    });
  });

  it('4. reports mixed and a ready summary when both sources exist', () => {
    const exam = makeExam();

    expect(selectHomeState({ topicProgressCount: 2, examCount: 1 })).toBe('mixed');
    expect(selectLatestExamSummary({ isHydrated: true, examsById: byId(exam) })).toEqual({
      status: 'ready',
      summary: expect.objectContaining({ id: exam.id }),
    });
  });
});

describe('Home latest-exam selection ordering', () => {
  it('5. selects the exam with the newest exam date', () => {
    const older = makeExam({ id: 'exam-older', date: new Date(2026, 10, 5, 9, 0, 0).toISOString() });
    const newer = makeExam({ id: 'exam-newer', date: new Date(2026, 10, 8, 9, 0, 0).toISOString() });

    // Insertion order is deliberately "wrong" so it cannot influence the result.
    expect(selectLatestExam(byId(newer, older))?.id).toBe('exam-newer');
  });

  it('6. breaks equal-date ties with the later updatedAt', () => {
    const earlierUpdate = makeExam({
      id: 'exam-a',
      date: EXAM_DATE,
      updatedAt: new Date(2026, 10, 9, 10, 0, 0).toISOString(),
    });
    const laterUpdate = makeExam({
      id: 'exam-b',
      date: EXAM_DATE,
      updatedAt: new Date(2026, 10, 9, 12, 0, 0).toISOString(),
    });

    expect(selectLatestExam(byId(earlierUpdate, laterUpdate))?.id).toBe('exam-b');
  });

  it('7. breaks remaining ties by id, deterministically', () => {
    const sharedUpdatedAt = new Date(2026, 10, 9, 10, 0, 0).toISOString();
    const lowerId = makeExam({ id: 'exam-a', date: EXAM_DATE, updatedAt: sharedUpdatedAt });
    const higherId = makeExam({ id: 'exam-b', date: EXAM_DATE, updatedAt: sharedUpdatedAt });

    expect(selectLatestExam(byId(lowerId, higherId))?.id).toBe('exam-b');
    // Same inputs, reversed insertion order — the same exam still wins.
    expect(selectLatestExam(byId(higherId, lowerId))?.id).toBe('exam-b');
  });

  it('8. deleting the latest exam reveals the next latest', () => {
    const newest = makeExam({ id: 'exam-newest', date: new Date(2026, 10, 9, 9, 0, 0).toISOString() });
    const next = makeExam({ id: 'exam-next', date: new Date(2026, 10, 7, 9, 0, 0).toISOString() });

    const before = byId(newest, next);
    expect(selectLatestExam(before)?.id).toBe('exam-newest');

    const afterDelete = { ...before };
    delete afterDelete['exam-newest'];

    expect(selectLatestExam(afterDelete)?.id).toBe('exam-next');
  });

  it('9. an edited date can make an older exam the newest', () => {
    const examA = makeExam({ id: 'exam-a', date: new Date(2026, 10, 9, 9, 0, 0).toISOString() });
    const examB = makeExam({ id: 'exam-b', date: new Date(2026, 10, 5, 9, 0, 0).toISOString() });

    expect(selectLatestExam(byId(examA, examB))?.id).toBe('exam-a');

    const edited = makeExam({ ...examB, date: new Date(2026, 10, 12, 9, 0, 0).toISOString() });
    expect(selectLatestExam(byId(examA, edited))?.id).toBe('exam-b');
  });
});

describe('Home latest-exam Turkish formatting', () => {
  it('10. formats the total net with a comma, at most two decimals', () => {
    const cases: [number, string][] = [
      [72.5, '72,5'],
      [72, '72'],
      [72.456, '72,46'],
      [100, '100'],
    ];

    for (const [net, expected] of cases) {
      const result = selectLatestExamSummary({
        isHydrated: true,
        examsById: byId(makeExam({ totalNet: net })),
      });

      expect(result.status).toBe('ready');
      expect(result.status === 'ready' ? result.summary.netLabel : null).toBe(expected);
    }
  });

  it('11. formats the exam date in Turkish', () => {
    const result = selectLatestExamSummary({
      isHydrated: true,
      examsById: byId(makeExam({ date: new Date(2026, 10, 9, 9, 0, 0).toISOString() })),
    });

    expect(result.status === 'ready' ? result.summary.dateLabel : null).toBe('9 Kasım 2026');
    expect(result.status === 'ready' ? result.summary.typeLabel : null).toBe('TYT');
  });
});

describe('Home latest-exam resilience', () => {
  it('12. renders malformed records without crashing', () => {
    const malformed = {
      id: 'exam-malformed',
      name: 42,
      type: 'BILINMEYEN',
      date: 'gecersiz-tarih',
      totalNet: Number.NaN,
    } as unknown as PracticeExam;

    const result = selectLatestExamSummary({ isHydrated: true, examsById: byId(malformed) });

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') {
      throw new Error('expected a ready summary');
    }

    expect(result.summary.name).toBe(UNNAMED_EXAM_LABEL);
    expect(result.summary.typeLabel).toBe('TYT');
    expect(result.summary.dateLabel).toBe(UNKNOWN_EXAM_DATE_LABEL);
    expect(result.summary.netLabel).toBe('0');
  });

  it('12b. ignores records that cannot be opened', () => {
    const withoutId = { name: 'Kimliksiz' } as unknown as PracticeExam;

    expect(selectLatestExamSummary({ isHydrated: true, examsById: { weird: withoutId } })).toEqual({
      status: 'empty',
    });
  });

  it('13. does not flash the empty state while exams are still loading', () => {
    const exam = makeExam();

    // Exams already present but the store is not hydrated yet → still loading.
    expect(selectLatestExamSummary({ isHydrated: false, examsById: byId(exam) })).toEqual({
      status: 'loading',
    });

    // Nothing present and not hydrated → still loading, never a false "empty".
    expect(selectLatestExamSummary({ isHydrated: false, examsById: {} })).toEqual({
      status: 'loading',
    });
  });
});
