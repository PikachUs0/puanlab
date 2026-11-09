import type { ThemePreference } from '@/types';

/** State the UI mirrors: the confirmed value and the optimistically shown one. */
export type ThemePreferenceSelectionState = {
  /** Last preference that was successfully persisted (or hydrated from SQLite). */
  confirmed: ThemePreference;
  /** Preference currently shown; equals `confirmed`, except while a newer one saves. */
  visible: ThemePreference;
};

export type ThemePreferenceSelection = {
  getState(): ThemePreferenceSelectionState;
  subscribe(listener: () => void): () => void;
  /** Seeds the confirmed preference from the value read during startup. */
  hydrate(preference: ThemePreference): void;
  /**
   * Shows `preference` immediately, persists it, and reverts to the last
   * confirmed preference when the write fails. Writes never overlap: they run
   * one at a time in request order, so rapid selections cannot interleave.
   */
  select(preference: ThemePreference): Promise<void>;
};

/**
 * Keeps the visible theme and the persisted theme from disagreeing.
 *
 * The state machine is plain TypeScript (no React, no SQLite) so both the
 * rollback-on-failure behaviour and the write serialisation can be tested
 * directly; `ThemeProvider` only mirrors `getState()` into React state.
 */
export function createThemePreferenceSelection(options: {
  /** Persists a preference; must reject when the write fails. */
  persist: (preference: ThemePreference) => Promise<void>;
}): ThemePreferenceSelection {
  let state: ThemePreferenceSelectionState = { confirmed: 'system', visible: 'system' };

  const listeners = new Set<() => void>();

  // Serialises the writes; a rejected write never breaks the chain.
  let queue: Promise<unknown> = Promise.resolve();

  // Identifies the newest request so a superseded one cannot overwrite it.
  let latestRequestId = 0;

  function commit(next: ThemePreferenceSelectionState): void {
    state = next;

    for (const listener of listeners) {
      listener();
    }
  }

  return {
    getState: () => state,

    subscribe(listener) {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },

    hydrate(preference) {
      commit({ confirmed: preference, visible: preference });
    },

    select(preference) {
      latestRequestId += 1;
      const requestId = latestRequestId;

      // The chosen theme is applied immediately, before the write settles.
      commit({ confirmed: state.confirmed, visible: preference });

      const write = queue.then(() => options.persist(preference));
      queue = write.then(
        () => undefined,
        () => undefined,
      );

      return write.then(
        () => {
          if (requestId === latestRequestId) {
            commit({ confirmed: preference, visible: preference });
            return;
          }

          // A newer selection is already on screen and owns `visible`.
          commit({ confirmed: preference, visible: state.visible });
        },
        (error: unknown) => {
          if (requestId === latestRequestId) {
            // Keep the previous confirmed preference: revert the optimistic UI.
            commit({ confirmed: state.confirmed, visible: state.confirmed });
          }

          throw error;
        },
      );
    },
  };
}
