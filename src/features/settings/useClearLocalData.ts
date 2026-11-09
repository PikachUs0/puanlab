import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useDatabase } from '@/db';
import { useThemeControls } from '@/theme';

import { createClearLocalDataRunner, type ClearLocalDataRunner } from './clearLocalData';

export const CLEAR_LOCAL_DATA_ERROR_MESSAGE = 'Veriler silinemedi. Lütfen tekrar dene.';

export type ClearLocalDataController = {
  /** True while the reset transaction is in flight. */
  isClearing: boolean;
  /** Localized failure message, or `null` when the last attempt did not fail. */
  error: string | null;
  /** Starts a reset. Safe to call from a tap: duplicate calls are ignored. */
  clearLocalData: () => Promise<void>;
};

/**
 * Binds the local-data reset to the live connection and the theme controls.
 *
 * The reset itself lives in `clearLocalData.ts` (outside React and outside the
 * stores); this hook only mirrors the in-flight/failed state for the UI. On
 * success the cleared `profileStore` makes the root route guard return to
 * onboarding; a `replace('/onboarding')` fallback is supplied in case the
 * active route is not left immediately, and its failure is never surfaced as a
 * deletion error.
 */
export function useClearLocalData(): ClearLocalDataController {
  const { database } = useDatabase();
  const { resetThemePreference } = useThemeControls();
  const router = useRouter();

  const [isClearing, setIsClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isMountedRef = useRef(true);

  // Created once. Its connection and theme reset are passed on every call, so
  // nothing has to be read during render and the single-flight flag survives
  // for the lifetime of the screen.
  const [runner] = useState<ClearLocalDataRunner>(() => createClearLocalDataRunner());

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const clearLocalData = useCallback(async () => {
    // Also guarded inside the runner; checked first so a duplicate tap cannot
    // clear the busy state of the reset that is still running.
    if (runner.isRunning()) {
      return;
    }

    setError(null);
    setIsClearing(true);

    try {
      await runner.run({
        db: database,
        resetThemePreference,
        // Runs only after the SQLite transaction committed, every store was
        // cleared and the theme was reset; the root guard has already removed
        // the protected screens by then. This is the safe fallback for the
        // active route, and its errors are isolated inside the reset module so
        // they are never shown as "Veriler silinemedi.".
        navigateToOnboarding: () => router.replace('/onboarding'),
      });
    } catch (cause) {
      if (__DEV__) {
        console.error('[ClearLocalData] Delete failed', cause);
      }

      if (isMountedRef.current) {
        setError(CLEAR_LOCAL_DATA_ERROR_MESSAGE);
      }
    } finally {
      if (isMountedRef.current) {
        setIsClearing(false);
      }
    }
  }, [runner, database, resetThemePreference, router]);

  return { isClearing, error, clearLocalData };
}
