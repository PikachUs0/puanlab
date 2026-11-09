import type { SQLiteDatabase } from 'expo-sqlite';

/**
 * Startup state of the single database connection.
 *
 * `database`/`isReady` only become set once the initialization flow resolved,
 * and `error` is the *original* Error that prevented that. A failure never
 * clears a previously ready database into a "missing profile" state: it is
 * exposed so the composition root can show a startup error screen instead of
 * rendering the app against unavailable repositories.
 */
export type DatabaseStartupState = {
  database: SQLiteDatabase | null;
  error: Error | null;
  /** True while a user-triggered retry is in flight. */
  isRetrying: boolean;
  isReady: boolean;
};

export const INITIAL_DATABASE_STARTUP_STATE: DatabaseStartupState = {
  database: null,
  error: null,
  isRetrying: false,
  isReady: false,
};

/** Which startup gate the composition root must render. */
export type DatabaseStartupGate = 'splash' | 'error' | 'ready';

/** True once a connection is open and no failure is being shown. */
export function isDatabaseUsable(state: DatabaseStartupState): boolean {
  return state.isReady && state.database !== null && state.error === null;
}

/**
 * Maps the startup state to the screen the app must render:
 *
 * - `error`  — initialization failed (or is being retried): show the safe
 *              startup error screen instead of the app.
 * - `splash` — the database is still opening: show the neutral splash.
 * - `ready`  — a usable connection exists: hydrate and render the app.
 */
export function selectDatabaseStartupGate(state: DatabaseStartupState): DatabaseStartupGate {
  if (state.error !== null || state.isRetrying) {
    return 'error';
  }

  return isDatabaseUsable(state) ? 'ready' : 'splash';
}

/** Stage a failure came from, for development diagnostics only. */
export type DatabaseStartupFailureStage = 'schema-assertion' | 'unknown';

/**
 * The message every schema assertion in `migrations.ts` starts with. It is a
 * marker this app throws itself, so the classification is deterministic and
 * never guesses from an arbitrary native error string.
 */
const SCHEMA_ASSERTION_MARKER = 'Veritabanı şeması bozuk';

/**
 * Classifies a startup failure for development logging. Never used for the
 * user-facing copy.
 */
export function classifyDatabaseStartupFailure(error: Error): DatabaseStartupFailureStage {
  return error.message.includes(SCHEMA_ASSERTION_MARKER) ? 'schema-assertion' : 'unknown';
}

/** Keeps the original Error object; only a non-Error throw is wrapped. */
export function toDatabaseStartupError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

export type DatabaseStartupControllerOptions = {
  /** The existing initialization flow, e.g. `initializeDatabase`. */
  initialize: () => Promise<SQLiteDatabase>;
};

export type DatabaseStartupController = {
  getState(): DatabaseStartupState;
  subscribe(listener: () => void): () => void;
  /** Runs the initial open. Ignored while another run is already in flight. */
  start(): void;
  /** Retries after a failure. Ignored while another run is in flight. */
  retry(): void;
};

/**
 * Single-flight startup state machine.
 *
 * It is plain TypeScript (no React, no SQLite) so the loading/error/retry/ready
 * transitions can be tested directly; `DatabaseProvider` only mirrors
 * `getState()` into React through `useSyncExternalStore`.
 *
 * `initialize` is the one and only initialization flow, so retrying re-uses the
 * cached connection from `openDatabase()` and can never open a second one.
 * A retry is only accepted while a failure is being shown, and overlapping runs
 * are ignored, so a double tap cannot start two initializations.
 */
export function createDatabaseStartupController(
  options: DatabaseStartupControllerOptions,
): DatabaseStartupController {
  let state = INITIAL_DATABASE_STARTUP_STATE;
  let isRunning = false;
  const listeners = new Set<() => void>();

  function commit(patch: Partial<DatabaseStartupState>): void {
    state = { ...state, ...patch };

    for (const listener of listeners) {
      listener();
    }
  }

  function run(mode: 'initial' | 'retry'): void {
    if (isRunning) {
      return;
    }

    isRunning = true;

    if (mode === 'retry') {
      // The previous failure is cleared exactly when a new attempt begins, so a
      // failed retry keeps the original error until the next attempt starts.
      commit({ error: null, isRetrying: true });
    }

    options.initialize().then(
      (database) => {
        isRunning = false;
        commit({ database, error: null, isRetrying: false, isReady: true });
      },
      (cause: unknown) => {
        isRunning = false;
        // No database is exposed and no store is touched: the failure is
        // surfaced instead of pretending the app started with no profile.
        commit({
          database: null,
          error: toDatabaseStartupError(cause),
          isRetrying: false,
          isReady: false,
        });
      },
    );
  }

  return {
    getState: () => state,

    subscribe(listener) {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },

    start: () => run('initial'),

    retry: () => {
      // Only a shown failure can be retried; a ready app is never interrupted.
      if (state.error === null) {
        return;
      }

      run('retry');
    },
  };
}

/** User-facing copy. Deliberately free of any SQL, table or path detail. */
export const DATABASE_STARTUP_COPY = {
  title: 'Verilerine şu anda erişilemedi',
  message:
    'Uygulama veritabanını açamadı. Yeniden deneyebilirsin. Sorun devam ederse uygulamayı kapatıp tekrar aç.',
  retryAction: 'Yeniden Dene',
  retryActionBusy: 'Yeniden deneniyor...',
  safetyNote: 'Bu işlem verilerini silmez.',
  retryAccessibilityLabel: 'Veritabanını yeniden açmayı dene',
} as const;
