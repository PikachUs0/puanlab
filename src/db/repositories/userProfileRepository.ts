import type { UserProfile } from '@/types';

/**
 * Persistence contract for the `UserProfile` singleton row (id = 1).
 *
 * Implemented by `createSqliteUserProfileRepository`. Stores must not depend on
 * this module directly; orchestration lives in `@/features/onboarding`.
 */
export type UserProfileRepository = {
  getProfile: () => Promise<UserProfile | null>;
  saveProfile: (profile: UserProfile) => Promise<void>;
  updateProfile: (profile: UserProfile) => Promise<void>;
  clearProfile: () => Promise<void>;
};
