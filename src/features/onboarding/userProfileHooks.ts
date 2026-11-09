import { useMemo } from 'react';

import { createSqliteUserProfileRepository, useDatabase } from '@/db';
import type { UserProfileRepository } from '@/db';

/**
 * Builds the profile repository for the active connection. Returns null while
 * the database is still opening or when initialization failed, so callers can
 * keep running without persistence.
 */
export function useUserProfileRepository(): UserProfileRepository | null {
  const { database, isReady, error } = useDatabase();

  return useMemo(
    () => (isReady && database && !error ? createSqliteUserProfileRepository(database) : null),
    [database, isReady, error],
  );
}
