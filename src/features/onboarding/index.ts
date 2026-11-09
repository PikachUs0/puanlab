export { OnboardingProvider, useOnboarding } from './OnboardingProvider';
export {
  GUEST_ROUTES,
  PROTECTED_ROUTES,
  canAccessRoute,
  type GuestRoute,
  type ProtectedRoute,
} from './routeProtection';
export { OnboardingScreen } from './OnboardingScreen';
export {
  GRADE_LEVEL_OPTIONS,
  SCORE_TYPE_OPTIONS,
  type OnboardingData,
  type OnboardingDraft,
  type SelectOption,
} from './types';
export {
  buildOnboardingData,
  hasOnboardingErrors,
  validateOnboarding,
  type OnboardingErrors,
} from './validation';
