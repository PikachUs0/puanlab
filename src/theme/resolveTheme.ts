import type { ThemePreference } from '@/types';

import type { ColorScheme } from './types';

/**
 * Resolves the visual scheme actually applied from the saved preference and the
 * device scheme.
 *
 * - `system` follows the device (`null`/unknown counts as light)
 * - `light` / `dark` are hard overrides that ignore the device
 *
 * Pure (no React Native import) so the resolution rules are unit-testable and
 * the device scheme is never stored as the user's preference.
 */
export function resolveColorScheme(
  preference: ThemePreference,
  systemScheme: ColorScheme | null | undefined,
): ColorScheme {
  if (preference === 'light') {
    return 'light';
  }

  if (preference === 'dark') {
    return 'dark';
  }

  return systemScheme === 'dark' ? 'dark' : 'light';
}
