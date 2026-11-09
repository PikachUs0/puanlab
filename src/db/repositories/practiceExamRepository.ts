import type { PracticeExam } from '@/types';

/**
 * Persistence contract for `PracticeExam` records.
 *
 * Implemented by `createSqlitePracticeExamRepository`. Stores must not depend
 * on this module directly; orchestration lives outside `@/store`.
 */
export type PracticeExamRepository = {
  getAll: () => Promise<PracticeExam[]>;
  getById: (id: string) => Promise<PracticeExam | null>;
  create: (exam: PracticeExam) => Promise<void>;
  update: (exam: PracticeExam) => Promise<void>;
  remove: (id: string) => Promise<void>;
};
