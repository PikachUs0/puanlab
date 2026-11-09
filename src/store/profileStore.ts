import { create } from 'zustand';

import type { GradeLevel, ScoreType, UserProfile } from '@/types';

export type ProfileState = {
  gradeLevel: GradeLevel | null;
  scoreType: ScoreType | null;
  targetDepartment: string | null;
  targetUniversity: string | null;
  onboardingCompleted: boolean;
};

const initialProfileState: ProfileState = {
  gradeLevel: null,
  scoreType: null,
  targetDepartment: null,
  targetUniversity: null,
  onboardingCompleted: false,
};

export type ProfileActions = {
  setGradeLevel: (gradeLevel: GradeLevel) => void;
  setScoreType: (scoreType: ScoreType) => void;
  setTargetDepartment: (targetDepartment: string | null) => void;
  setTargetUniversity: (targetUniversity: string | null) => void;
  setOnboardingCompleted: (onboardingCompleted: boolean) => void;
  /** Replaces the whole profile from a persisted record in a single update. */
  hydrateProfile: (profile: UserProfile) => void;
  /** Resets the profile back to its initial, not-onboarded state. */
  clearProfile: () => void;
};

export type ProfileStore = ProfileState & ProfileActions;

export const useProfileStore = create<ProfileStore>()((set) => ({
  ...initialProfileState,
  setGradeLevel: (gradeLevel) => set({ gradeLevel }),
  setScoreType: (scoreType) => set({ scoreType }),
  setTargetDepartment: (targetDepartment) => set({ targetDepartment }),
  setTargetUniversity: (targetUniversity) => set({ targetUniversity }),
  setOnboardingCompleted: (onboardingCompleted) => set({ onboardingCompleted }),
  hydrateProfile: (profile) =>
    set({
      gradeLevel: profile.gradeLevel,
      scoreType: profile.scoreType,
      targetDepartment: profile.targetDepartment ?? null,
      targetUniversity: profile.targetUniversity ?? null,
      onboardingCompleted: profile.onboardingCompleted,
    }),
  clearProfile: () => set({ ...initialProfileState }),
}));

export const profileSelectors = {
  gradeLevel: (state: ProfileStore) => state.gradeLevel,
  scoreType: (state: ProfileStore) => state.scoreType,
  targetDepartment: (state: ProfileStore) => state.targetDepartment,
  targetUniversity: (state: ProfileStore) => state.targetUniversity,
  onboardingCompleted: (state: ProfileStore) => state.onboardingCompleted,
} as const;
