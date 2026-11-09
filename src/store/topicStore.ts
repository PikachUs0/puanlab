import { create } from 'zustand';

import type { TopicProgress, TopicStatus } from '@/types';

export type TopicState = {
  progressByTopicId: Record<string, TopicProgress>;
};

const initialTopicState: TopicState = {
  progressByTopicId: {},
};

export type TopicActions = {
  setProgress: (progress: TopicProgress) => void;
  setProgressBatch: (progressList: TopicProgress[]) => void;
  removeProgress: (topicId: string) => void;
  /** Removes every stored topic progress in a single update. */
  clearProgress: () => void;
};

export type TopicStore = TopicState & TopicActions;

export const useTopicStore = create<TopicStore>()((set) => ({
  ...initialTopicState,
  setProgress: (progress) =>
    set((state) => ({
      progressByTopicId: { ...state.progressByTopicId, [progress.topicId]: progress },
    })),
  setProgressBatch: (progressList) =>
    set((state) => {
      const progressByTopicId = { ...state.progressByTopicId };

      for (const progress of progressList) {
        progressByTopicId[progress.topicId] = progress;
      }

      return { progressByTopicId };
    }),
  removeProgress: (topicId) =>
    set((state) => {
      const progressByTopicId = { ...state.progressByTopicId };
      delete progressByTopicId[topicId];

      return { progressByTopicId };
    }),
  clearProgress: () => set({ ...initialTopicState }),
}));

export const topicSelectors = {
  progressByTopicId: (state: TopicStore) => state.progressByTopicId,
  progressFor: (topicId: string) => (state: TopicStore): TopicProgress | null =>
    state.progressByTopicId[topicId] ?? null,
  statusFor: (topicId: string) => (state: TopicStore): TopicStatus | null =>
    state.progressByTopicId[topicId]?.status ?? null,
  noteFor: (topicId: string) => (state: TopicStore): string | null =>
    state.progressByTopicId[topicId]?.note ?? null,
  lastStudiedAtFor: (topicId: string) => (state: TopicStore): string | null =>
    state.progressByTopicId[topicId]?.lastStudiedAt ?? null,
} as const;
