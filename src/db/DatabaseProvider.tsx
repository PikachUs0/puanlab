import type { SQLiteDatabase } from 'expo-sqlite';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

import { initializeDatabase } from './database';
import { createDatabaseStartupController } from './databaseStartup';

type DatabaseContextValue = {
  database: SQLiteDatabase | null;
  isReady: boolean;
  error: Error | null;
  /** True while a user-triggered retry of a failed initialization is running. */
  isRetrying: boolean;
  /** Re-runs the startup initialization. Ignored while a run is in flight. */
  retryInitialization: () => void;
};

const DatabaseContext = createContext<DatabaseContextValue | null>(null);

/**
 * Owns the single application connection and its startup lifecycle.
 *
 * The transitions live in `createDatabaseStartupController`; this component
 * only mirrors them into React. Retrying calls the same `initializeDatabase`
 * flow, which re-uses the connection cached by `openDatabase()`, so no second
 * connection is ever opened.
 */
export function DatabaseProvider({ children }: { children: ReactNode }) {
  const [controller] = useState(() =>
    createDatabaseStartupController({ initialize: initializeDatabase }),
  );

  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getState,
    controller.getState,
  );

  useEffect(() => {
    controller.start();
  }, [controller]);

  const retryInitialization = useCallback(() => {
    controller.retry();
  }, [controller]);

  const value = useMemo<DatabaseContextValue>(
    () => ({
      database: state.database,
      isReady: state.isReady,
      error: state.error,
      isRetrying: state.isRetrying,
      retryInitialization,
    }),
    [state, retryInitialization],
  );

  return <DatabaseContext.Provider value={value}>{children}</DatabaseContext.Provider>;
}

export function useDatabase(): DatabaseContextValue {
  const context = useContext(DatabaseContext);

  if (!context) {
    throw new Error('useDatabase must be used within a DatabaseProvider');
  }

  return context;
}
