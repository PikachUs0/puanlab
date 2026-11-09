import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useColorScheme as useSystemColorScheme } from 'react-native';

import type { AppSettingsRepository } from '@/db';
import type { ThemePreference } from '@/types';

import { darkColors, lightColors, statusColors } from './colors';
import { resolveColorScheme } from './resolveTheme';
import { spacing } from './spacing';
import {
  createThemePreferenceSelection,
  type ThemePreferenceSelectionState,
} from './themePreferenceSelection';
import { typography } from './typography';
import type { ColorScheme, Theme } from './types';

type ThemeControls = {
  /** Saved user choice (optimistic while a write is in flight). */
  preference: ThemePreference;
  /** The scheme actually rendered right now, derived from `preference`. */
  resolvedScheme: ColorScheme;
  isDark: boolean;
  /** False until the saved preference has been read (or its read has settled). */
  isHydrated: boolean;
  /** Applies the theme immediately and persists it; rejects when the write fails. */
  setThemePreference: (preference: ThemePreference) => Promise<void>;
  /**
   * Resets the in-memory preference back to `system` without writing to the
   * database. Used after the local settings row has been deleted, so the app
   * follows the device theme again and no replacement row is created.
   */
  resetThemePreference: () => void;
};

type ThemeContextValue = ThemeControls & {
  theme: Theme;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function createTheme(scheme: ColorScheme): Theme {
  return {
    scheme,
    colors: scheme === 'dark' ? darkColors : lightColors,
    status: statusColors,
    spacing,
    typography,
  };
}

export type ThemeProviderProps = {
  children: ReactNode;
  /**
   * Settings repository for the active database connection, or `null` when the
   * database failed to open. It is injected by the composition root, which only
   * mounts this provider once the database has settled: SQLite stays out of
   * `ThemeProvider`, and the repository is final by the time it is captured.
   */
  repository: AppSettingsRepository | null;
};

/**
 * Resolves and persists the theme.
 *
 * `preference` is the saved user choice (`system` | `light` | `dark`) and
 * `resolvedScheme` is what is actually painted; a `system` preference keeps
 * following the device and is never written back as a concrete scheme. The
 * saved value is read before the app renders, so an override is never briefly
 * replaced by the device scheme.
 */
export function ThemeProvider({ children, repository }: ThemeProviderProps) {
  const systemScheme = useSystemColorScheme();

  // Created once with the repository this provider was mounted with, which the
  // composition root has already settled. No SQLite import and no ref is needed
  // to track a value that can no longer change.
  const [selection] = useState(() =>
    createThemePreferenceSelection({
      persist: (preference) => {
        if (repository === null) {
          return Promise.reject(
            new Error('Tema tercihi kaydedilemedi: veritabanına erişilemiyor.'),
          );
        }

        return repository.setThemePreference(preference);
      },
    }),
  );

  const [selectionState, setSelectionState] = useState<ThemePreferenceSelectionState>(() =>
    selection.getState(),
  );

  useEffect(() => selection.subscribe(() => setSelectionState(selection.getState())), [selection]);

  const [hasLoaded, setHasLoaded] = useState(false);

  // Reads the saved preference once. A `null` repository means the database
  // failed to open: the `system` default is kept and the app still starts.
  useEffect(() => {
    if (hasLoaded || repository === null) {
      return;
    }

    let isActive = true;

    repository
      .getThemePreference()
      .then((preference) => {
        if (!isActive) {
          return;
        }

        selection.hydrate(preference);
        setHasLoaded(true);
      })
      .catch((cause: unknown) => {
        if (!isActive) {
          return;
        }

        // The default `system` preference is kept; the app still starts.
        if (__DEV__) {
          console.error('[ThemePreference] Read failed', cause);
        }

        setHasLoaded(true);
      });

    return () => {
      isActive = false;
    };
  }, [hasLoaded, repository, selection]);

  useEffect(() => {
    if (repository === null && __DEV__) {
      console.error('[ThemePreference] Settings could not be read: database unavailable');
    }
  }, [repository]);

  const isHydrated = hasLoaded || repository === null;

  const setThemePreference = useCallback(
    async (preference: ThemePreference) => {
      try {
        await selection.select(preference);
      } catch (error) {
        if (__DEV__) {
          console.error('[ThemePreference] Save failed', error);
        }

        // The caller decides how to surface the failure; the confirmed
        // preference has already been restored by the state machine.
        throw error;
      }
    },
    [selection],
  );

  const resetThemePreference = useCallback(() => {
    // Seeds both the confirmed and visible preference to `system`; nothing is
    // written, so a deleted settings row is not recreated.
    selection.hydrate('system');
  }, [selection]);

  const { visible } = selectionState;
  const resolvedScheme = resolveColorScheme(visible, systemScheme);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme: createTheme(resolvedScheme),
      preference: visible,
      resolvedScheme,
      isDark: resolvedScheme === 'dark',
      isHydrated,
      setThemePreference,
      resetThemePreference,
    }),
    [resolvedScheme, visible, isHydrated, setThemePreference, resetThemePreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

function useThemeContext(): ThemeContextValue {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error('Theme hooks must be used within a ThemeProvider');
  }

  return context;
}

export function useTheme(): Theme {
  return useThemeContext().theme;
}

export function useThemeControls(): ThemeControls {
  const { preference, resolvedScheme, isDark, isHydrated, setThemePreference, resetThemePreference } =
    useThemeContext();

  return { preference, resolvedScheme, isDark, isHydrated, setThemePreference, resetThemePreference };
}
