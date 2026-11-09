import type { ThemePreference } from '@/types';

import { createThemePreferenceSelection } from '../themePreferenceSelection';

/**
 * The selection state machine owns the write-before-confirmed rule and the
 * write serialisation. It is plain TypeScript, so both behaviours are asserted
 * here without rendering React.
 */
describe('createThemePreferenceSelection', () => {
  it('starts on the system preference before anything is hydrated', () => {
    const selection = createThemePreferenceSelection({ persist: async () => undefined });

    expect(selection.getState()).toEqual({ confirmed: 'system', visible: 'system' });
  });

  it('seeds the confirmed preference from the value read at startup', () => {
    const selection = createThemePreferenceSelection({ persist: async () => undefined });

    selection.hydrate('dark');

    expect(selection.getState()).toEqual({ confirmed: 'dark', visible: 'dark' });
  });

  it('shows the chosen preference immediately and keeps the previous one when the write fails', async () => {
    const selection = createThemePreferenceSelection({
      persist: () => Promise.reject(new Error('write failed')),
    });

    const pending = selection.select('dark');

    // Applied before the write settles.
    expect(selection.getState().visible).toBe('dark');

    await expect(pending).rejects.toThrow('write failed');

    // The failed preference is rolled back; the previous confirmed one is kept.
    expect(selection.getState()).toEqual({ confirmed: 'system', visible: 'system' });
  });

  it('confirms the preference only after the repository write succeeds', async () => {
    const resolvers: (() => void)[] = [];
    const selection = createThemePreferenceSelection({
      persist: () =>
        new Promise<void>((resolve) => {
          resolvers.push(resolve);
        }),
    });

    const pending = selection.select('light');

    // Optimistically on screen, but not persisted yet.
    expect(selection.getState()).toEqual({ confirmed: 'system', visible: 'light' });

    // Let the serialised write start, then let it succeed.
    await Promise.resolve();
    expect(resolvers).toHaveLength(1);

    resolvers[0]?.();
    await pending;

    expect(selection.getState()).toEqual({ confirmed: 'light', visible: 'light' });
  });

  it('serialises rapid selections so writes never overlap', async () => {
    const calls: ThemePreference[] = [];
    const resolvers: (() => void)[] = [];
    let activeWrites = 0;
    let maxActiveWrites = 0;

    const selection = createThemePreferenceSelection({
      persist: (preference) => {
        calls.push(preference);
        activeWrites += 1;
        maxActiveWrites = Math.max(maxActiveWrites, activeWrites);

        return new Promise<void>((resolve) => {
          resolvers.push(() => {
            activeWrites -= 1;
            resolve();
          });
        });
      },
    });

    const first = selection.select('light');
    const second = selection.select('dark');

    // The newest choice already owns what is shown.
    expect(selection.getState().visible).toBe('dark');

    // Only the first write has started; the second is queued behind it.
    await Promise.resolve();
    expect(calls).toEqual(['light']);
    expect(resolvers).toHaveLength(1);

    resolvers[0]?.();
    await first;

    // The queued write now runs, and no two writes were ever in flight.
    expect(calls).toEqual(['light', 'dark']);
    expect(resolvers).toHaveLength(2);

    resolvers[1]?.();
    await second;

    expect(calls).toEqual(['light', 'dark']);
    expect(maxActiveWrites).toBe(1);
    expect(selection.getState()).toEqual({ confirmed: 'dark', visible: 'dark' });
  });

  it('handles repeated changes on one long-lived instance, so the provider never remounts', async () => {
    const persisted: ThemePreference[] = [];
    const selection = createThemePreferenceSelection({
      persist: async (preference) => {
        persisted.push(preference);
      },
    });

    let notifications = 0;
    const unsubscribe = selection.subscribe(() => {
      notifications += 1;
    });

    // The provider creates the instance once and only ever calls into it; a
    // preference change must not require re-creating it.
    selection.hydrate('system');
    await selection.select('dark');
    await selection.select('light');
    await selection.select('system');

    expect(persisted).toEqual(['dark', 'light', 'system']);
    expect(selection.getState()).toEqual({ confirmed: 'system', visible: 'system' });
    // hydrate + (optimistic + confirmed) for each of the three selections.
    expect(notifications).toBe(7);

    unsubscribe();
  });
});
