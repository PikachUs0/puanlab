import { create } from 'zustand';

import { sortExamsNewestFirst } from '@/features/exams';
import type { PracticeExam } from '@/types';

export type ExamState = {
  examsById: Record<string, PracticeExam>;
  isHydrated: boolean;
};

const initialExamState: ExamState = {
  examsById: {},
  isHydrated: false,
};

export type ExamActions = {
  /** Replaces the whole exam collection from persisted records. */
  hydrateExams: (exams: PracticeExam[]) => void;
  /** Inserts or replaces a single exam. */
  setExam: (exam: PracticeExam) => void;
  removeExam: (id: string) => void;
  clearExams: () => void;
};

export type ExamStore = ExamState & ExamActions;

export const useExamStore = create<ExamStore>()((set) => ({
  ...initialExamState,
  hydrateExams: (exams) =>
    set({
      examsById: Object.fromEntries(exams.map((exam) => [exam.id, exam])),
      isHydrated: true,
    }),
  setExam: (exam) => set((state) => ({ examsById: { ...state.examsById, [exam.id]: exam } })),
  removeExam: (id) =>
    set((state) => {
      const examsById = { ...state.examsById };
      delete examsById[id];

      return { examsById };
    }),
  clearExams: () => set({ examsById: {} }),
}));

export const examSelectors = {
  examsById: (state: ExamStore) => state.examsById,
  isHydrated: (state: ExamStore) => state.isHydrated,
  examById: (id: string) => (state: ExamStore): PracticeExam | null => state.examsById[id] ?? null,
  latestExam: (state: ExamStore): PracticeExam | null =>
    sortExamsNewestFirst(Object.values(state.examsById))[0] ?? null,
  examCount: (state: ExamStore): number => Object.keys(state.examsById).length,
} as const;
