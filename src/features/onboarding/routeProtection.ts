/**
 * Root Stack route names, grouped by the profile state each requires.
 *
 * The names are relative to `src/app/_layout.tsx` (the root Stack) and match
 * the file-based names Expo Router generates: the `(tabs)` group, the
 * `profile/index` screen and the flat `exam/add`, `exam/[id]` and nested
 * `exam/[id]/edit` screens. Index files keep their `/index` segment because no
 * intermediate `profile/_layout.tsx` exists.
 *
 * Keeping the lists here (instead of inline in the layout) makes the guard
 * logic unit-testable and gives the root navigator a single source of truth.
 */
export const PROTECTED_ROUTES = [
  '(tabs)',
  'profile/index',
  'exam/add',
  'exam/[id]',
  'exam/[id]/edit',
] as const;

/** The only route a user without a completed profile may see. */
export const GUEST_ROUTES = ['onboarding'] as const;

export type ProtectedRoute = (typeof PROTECTED_ROUTES)[number];
export type GuestRoute = (typeof GUEST_ROUTES)[number];

/**
 * Whether `route` may be shown for the given onboarding state.
 *
 * A protected route is unavailable the moment `onboardingCompleted` becomes
 * false, which is what removes it (and every other protected screen) from
 * navigation history after a local-data reset — so the Android back button
 * cannot reopen Profile, Add Exam, Exam Detail or Edit Exam.
 */
export function canAccessRoute(route: string, isCompleted: boolean): boolean {
  if ((PROTECTED_ROUTES as readonly string[]).includes(route)) {
    return isCompleted;
  }

  if ((GUEST_ROUTES as readonly string[]).includes(route)) {
    return !isCompleted;
  }

  // Routes outside both groups (e.g. `_sitemap`) are not part of this guard.
  return true;
}
