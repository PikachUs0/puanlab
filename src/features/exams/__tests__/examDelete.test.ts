import { examSelectors, useExamStore } from '@/store';
import type { PracticeExamRepository } from '@/db';
import type { LessonResult, PracticeExam } from '@/types';

import { resolveExamDetailStatus } from '../examDetail';
import {
  DELETE_CONFIRM_TITLE,
  DELETE_ERROR_MESSAGE,
  buildDeleteConfirmMessage,
  createDeleteGuard,
} from '../examDelete';
import { createExamPersistenceActions } from '../examHooks';

const RESULTS: LessonResult[] = [
  { lessonId: 'tyt_turkce', correct: 30, incorrect: 4, blank: 6, net: 29 },
  { lessonId: 'tyt_sosyal_bilimler', correct: 10, incorrect: 0, blank: 10, net: 10 },
  { lessonId: 'tyt_temel_matematik', correct: 0, incorrect: 0, blank: 40, net: 0 },
  { lessonId: 'tyt_fen_bilimleri', correct: 0, incorrect: 0, blank: 20, net: 0 },
];

/** Deterministic stored exam; no clock is ever read. */
function makeExam(id: string): PracticeExam {
  return {
    id,
    type: 'TYT',
    scoreTypeSnapshot: 'SAY',
    name: 'Özdebir TYT 2',
    date: '2026-11-09T00:00:00.000Z',
    results: RESULTS,
    totalCorrect: 40,
    totalIncorrect: 4,
    totalBlank: 76,
    totalNet: 39,
    createdAt: '2026-11-09T08:00:00.000Z',
    updatedAt: '2026-11-09T08:00:00.000Z',
  };
}

function createFakeRepository(remove: (id: string) => Promise<void>): PracticeExamRepository {
  return {
    getAll: async () => [],
    getById: async () => null,
    create: async () => undefined,
    update: async () => undefined,
    remove,
  };
}

beforeEach(() => {
  useExamStore.getState().hydrateExams([]);
});

describe('delete practice exam helpers', () => {
  it('names the exact exam in the confirmation dialog text', () => {
    expect(DELETE_CONFIRM_TITLE).toBe('Deneme silinsin mi?');
    expect(buildDeleteConfirmMessage('Özdebir TYT 2')).toBe(
      '“Özdebir TYT 2” kalıcı olarak silinecek. Bu işlem geri alınamaz.',
    );
    expect(DELETE_ERROR_MESSAGE).toBe('Deneme silinemedi. Lütfen tekrar dene.');
  });

  it('6. prevents duplicate delete requests with a single-flight guard', () => {
    const guard = createDeleteGuard();

    expect(guard.tryStart()).toBe(true);
    // A second press while one delete is still running is refused.
    expect(guard.tryStart()).toBe(false);
    expect(guard.isInFlight()).toBe(true);

    guard.finish();
    expect(guard.isInFlight()).toBe(false);
    expect(guard.tryStart()).toBe(true);
  });
});

describe('deleteExam persistence orchestration', () => {
  it('4. keeps the store record when the repository delete fails', async () => {
    const exam = makeExam('exam-1');
    useExamStore.getState().hydrateExams([exam]);

    const actions = createExamPersistenceActions(
      createFakeRepository(async () => {
        throw new Error('disk failure');
      }),
    );

    await expect(actions.deleteExam('exam-1')).rejects.toThrow('disk failure');

    // The write failed, so the store must still hold the exam untouched.
    expect(examSelectors.examById('exam-1')(useExamStore.getState())).toEqual(exam);
  });

  it('5. removes the store record after a successful repository delete', async () => {
    const exam = makeExam('exam-1');
    useExamStore.getState().hydrateExams([exam]);

    const remove = jest.fn(async (_id: string) => undefined);
    const actions = createExamPersistenceActions(createFakeRepository(remove));

    await actions.deleteExam('exam-1');

    expect(remove).toHaveBeenCalledWith('exam-1');
    expect(examSelectors.examById('exam-1')(useExamStore.getState())).toBeNull();
  });

  it('7. resolves a deleted exam id to the safe not-found state', () => {
    const exam = makeExam('exam-1');
    useExamStore.getState().hydrateExams([exam]);

    useExamStore.getState().removeExam('exam-1');

    const state = useExamStore.getState();

    expect(examSelectors.examById('exam-1')(state)).toBeNull();
    expect(
      resolveExamDetailStatus({ isHydrated: state.isHydrated, examId: 'exam-1', exam: null }),
    ).toBe('not_found');
  });

  it('10. resolves only after the repository write and the store update both succeed', async () => {
    const exam = makeExam('exam-1');
    useExamStore.getState().hydrateExams([exam]);

    const order: string[] = [];
    let releaseRemove!: () => void;

    const remove = jest.fn(
      (id: string) =>
        new Promise<void>((resolve) => {
          order.push(`remove:${id}`);
          releaseRemove = () => {
            order.push('remove-resolved');
            resolve();
          };
        }),
    );

    const actions = createExamPersistenceActions(createFakeRepository(remove));

    const pending = actions.deleteExam('exam-1');

    // Let the global write queue reach the repository call.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(order).toEqual(['remove:exam-1']);
    // Store still holds the exam while the write is in flight — so navigation,
    // which only happens after this promise resolves, can never run first.
    expect(examSelectors.examById('exam-1')(useExamStore.getState())).not.toBeNull();

    releaseRemove();
    await pending;

    expect(order).toEqual(['remove:exam-1', 'remove-resolved']);
    expect(examSelectors.examById('exam-1')(useExamStore.getState())).toBeNull();
  });
});
