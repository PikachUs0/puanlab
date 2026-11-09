import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { useDatabase } from '@/db';
import { profileSelectors, useProfileStore } from '@/store';
import type { UserProfile } from '@/types';

import type { OnboardingData } from './types';
import { useUserProfileRepository } from './userProfileHooks';

type OnboardingContextValue = {
  /** True once the persisted profile has been read (or the read has settled). */
  isHydrated: boolean;
  /** Mirrors the persisted profile in `profileStore`; the single source of truth. */
  isCompleted: boolean;
  /** Surfaced when the profile could not be read or written. */
  error: Error | null;
  complete: (data: OnboardingData) => Promise<void>;
};

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

/** Builds the complete profile persisted when onboarding is submitted. */
function buildUserProfile(data: OnboardingData): UserProfile {
  const timestamp = new Date().toISOString();

  return {
    gradeLevel: data.gradeLevel,
    scoreType: data.scoreType,
    targetDepartment: data.targetDepartment,
    targetUniversity: data.targetUniversity,
    onboardingCompleted: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

/**
 * Reads the persisted profile once the database is ready and mirrors it into
 * `profileStore`. The store stays free of SQLite imports; this provider owns
 * all persistence orchestration.
 *
 * A missing profile (fresh install) falls back to onboarding. A corrupted row
 * is reported through `error` but never deleted, and also falls back to
 * onboarding because no valid completed profile can be loaded.
 */
export function OnboardingProvider({ children }: { children: ReactNode }) {
  const { isReady, error: databaseError } = useDatabase();
  const repository = useUserProfileRepository();
  const isCompleted = useProfileStore(profileSelectors.onboardingCompleted);
  const hydrateProfile = useProfileStore((state) => state.hydrateProfile);

  const [hasLoadedProfile, setHasLoadedProfile] = useState(false);
  const [loadError, setLoadError] = useState<Error | null>(null);

  useEffect(() => {
    // Wait for the database, then read the profile exactly once.
    if (hasLoadedProfile || databaseError !== null || !isReady || repository === null) {
      return;
    }

    let isActive = true;

    repository
      .getProfile()
      .then((profile) => {
        if (!isActive) {
          return;
        }

        if (profile !== null) {
          hydrateProfile(profile);
        }

        setHasLoadedProfile(true);
      })
      .catch((cause: unknown) => {
        if (!isActive) {
          return;
        }

        // A corrupted row is reported but never deleted; onboarding is shown
        // because no valid completed profile could be loaded.
        if (__DEV__) {
          console.error('[UserProfile] Hydration failed', cause);
        }

        setLoadError(cause instanceof Error ? cause : new Error(String(cause)));
        setHasLoadedProfile(true);
      });

    return () => {
      isActive = false;
    };
  }, [hasLoadedProfile, isReady, databaseError, repository, hydrateProfile]);

  // If the database failed to open, no profile can be read: settle into
  // onboarding instead of blocking the app on the loading screen.
  const isHydrated = hasLoadedProfile || databaseError !== null;
  const error = databaseError ?? loadError;

  const complete = useCallback(
    async (data: OnboardingData) => {
      if (repository === null) {
        throw new Error('Profil kaydedilemedi: veritabanına erişilemiyor.');
      }

      const profile = buildUserProfile(data);

      await repository.saveProfile(profile);
      hydrateProfile(profile);
    },
    [repository, hydrateProfile],
  );

  const value = useMemo<OnboardingContextValue>(
    () => ({ isHydrated, isCompleted, error, complete }),
    [isHydrated, isCompleted, error, complete],
  );

  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}

export function useOnboarding(): OnboardingContextValue {
  const context = useContext(OnboardingContext);

  if (!context) {
    throw new Error('useOnboarding must be used within an OnboardingProvider');
  }

  return context;
}
