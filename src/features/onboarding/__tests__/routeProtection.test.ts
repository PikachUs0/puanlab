import { GUEST_ROUTES, PROTECTED_ROUTES, canAccessRoute } from '../routeProtection';

describe('root route protection', () => {
  it('1. allows the tabs for a completed profile', () => {
    expect(canAccessRoute('(tabs)', true)).toBe(true);
  });

  it('2. allows the profile route for a completed profile', () => {
    expect(canAccessRoute('profile/index', true)).toBe(true);
  });

  it('3. allows the exam add, detail and edit routes for a completed profile', () => {
    expect(canAccessRoute('exam/add', true)).toBe(true);
    expect(canAccessRoute('exam/[id]', true)).toBe(true);
    expect(canAccessRoute('exam/[id]/edit', true)).toBe(true);
  });

  it('4. makes every protected route unavailable once the profile is cleared', () => {
    for (const route of PROTECTED_ROUTES) {
      expect(canAccessRoute(route, false)).toBe(false);
    }
  });

  it('5. allows onboarding only for an incomplete profile', () => {
    expect(canAccessRoute('onboarding', false)).toBe(true);
    expect(canAccessRoute('onboarding', true)).toBe(false);
  });

  it('6. cannot remain on Add Exam with an incomplete profile', () => {
    expect(canAccessRoute('exam/add', false)).toBe(false);
    expect(PROTECTED_ROUTES).toContain('exam/add');
  });

  it('7. blocks the whole protected history after a reset', () => {
    // Mirrors the Android back stack of a user who opened Profile and Add Exam:
    // none of the previously visited protected screens may be reopened.
    const visited = ['(tabs)', 'profile/index', 'exam/add'] as const;

    for (const route of visited) {
      expect(canAccessRoute(route, false)).toBe(false);
    }
  });

  it('12. declares exactly one onboarding route', () => {
    expect(GUEST_ROUTES).toEqual(['onboarding']);
    expect(new Set(GUEST_ROUTES).size).toBe(GUEST_ROUTES.length);
    expect(PROTECTED_ROUTES).not.toContain('onboarding');
  });
});
