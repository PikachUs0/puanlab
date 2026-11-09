import { Stack } from 'expo-router';
import { useMemo, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { AppText } from '@/components';
import { DatabaseStartupError } from '@/components/DatabaseStartupError';
import {
  DatabaseProvider,
  createSqliteAppSettingsRepository,
  selectDatabaseStartupGate,
  useDatabase,
} from '@/db';
import { ExamHydrator } from '@/features/exams';
import {
  GUEST_ROUTES,
  OnboardingProvider,
  PROTECTED_ROUTES,
  useOnboarding,
} from '@/features/onboarding';
import { TopicProgressHydrator } from '@/features/topics';
import { ThemeProvider, spacing, typography, useTheme, useThemeControls } from '@/theme';

export default function RootLayout() {
  return (
    <DatabaseProvider>
      <ThemeProviderBoundary>
        <TopicProgressHydrator>
          <ExamHydrator>
            <OnboardingProvider>
              <RootNavigator />
            </OnboardingProvider>
          </ExamHydrator>
        </TopicProgressHydrator>
      </ThemeProviderBoundary>
    </DatabaseProvider>
  );
}

/**
 * Injects the SQLite-backed settings repository into `ThemeProvider`, which is
 * deliberately kept free of SQLite imports.
 *
 * The provider is only mounted once the database has settled, so it captures a
 * final repository and needs no ref to track a late one. Until then the startup
 * splash is shown, so no themed frame is painted before the saved theme is
 * known. Topic, exam and profile hydration are unaffected: they already wait
 * for the database and start as soon as it is ready.
 *
 * A failed initialization replaces the whole subtree with the startup error
 * screen: no `ThemeProvider`, no hydrators and no navigation are mounted, so
 * the app never runs against unavailable repositories and never falls through
 * to onboarding as if the profile were simply missing.
 */
function ThemeProviderBoundary({ children }: { children: ReactNode }) {
  const { database, isReady, error, isRetrying, retryInitialization } = useDatabase();

  const repository = useMemo(
    () =>
      isReady && database !== null && error === null
        ? createSqliteAppSettingsRepository(database)
        : null,
    [database, isReady, error],
  );

  const gate = selectDatabaseStartupGate({ database, error, isReady, isRetrying });

  if (gate === 'error') {
    return (
      <DatabaseStartupError error={error} isRetrying={isRetrying} onRetry={retryInitialization} />
    );
  }

  if (gate === 'splash') {
    return <SplashGate />;
  }

  return <ThemeProvider repository={repository}>{children}</ThemeProvider>;
}

function RootNavigator() {
  const { isHydrated: isThemeHydrated } = useThemeControls();
  const { isHydrated: isProfileHydrated, isCompleted } = useOnboarding();

  // The saved theme has to be known before the first themed frame, otherwise a
  // saved `dark`/`light` override would flash the device scheme first.
  if (!isThemeHydrated) {
    return <SplashGate />;
  }

  // The persisted profile must be read before the route is chosen, otherwise an
  // already-onboarded user would briefly see the onboarding screen.
  if (!isProfileHydrated) {
    return <ProfileLoadingScreen />;
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      {/*
        Every route that needs a completed profile is guarded together, so the
        moment `profileStore` is cleared (`onboardingCompleted === false`) the
        whole authenticated shell — tabs, profile and exam routes — is removed
        from navigation history and the user lands on onboarding. Leaving any of
        these screens outside the guard is what previously kept `/exam/add`
        active after a reset.
      */}
      <Stack.Protected guard={isCompleted}>
        {PROTECTED_ROUTES.map((name) => (
          <Stack.Screen key={name} name={name} />
        ))}
      </Stack.Protected>
      <Stack.Protected guard={!isCompleted}>
        {GUEST_ROUTES.map((name) => (
          <Stack.Screen key={name} name={name} />
        ))}
      </Stack.Protected>
    </Stack>
  );
}

/**
 * Startup gate shown until the saved theme is known.
 *
 * It is rendered by `ThemeProviderBoundary` while the database is still
 * opening, i.e. *before* `ThemeProvider` is mounted, so it must not use any
 * themed component (`AppText`, `Screen`, `useTheme`, `useThemeControls`) —
 * those would throw "Theme hooks must be used within a ThemeProvider". Only
 * `View`, `Text` and `ActivityIndicator` are used here.
 *
 * It also deliberately mirrors the native splash screen (`app.json` ->
 * `expo-splash-screen`) instead of using theme tokens: no theme can be painted
 * before the saved preference is read, so the splash colour is carried straight
 * through and the app never shows a light screen before switching to dark.
 */
const SPLASH_BACKGROUND_COLOR = '#208AEF';
const SPLASH_CONTENT_COLOR = '#FFFFFF';

function SplashGate() {
  return (
    <View style={[styles.loading, { backgroundColor: SPLASH_BACKGROUND_COLOR }]}>
      <ActivityIndicator color={SPLASH_CONTENT_COLOR} />
      <Text style={[typography.caption, styles.splashLabel]}>Yükleniyor...</Text>
    </View>
  );
}

/** Themed loading state for the phase where only the profile is still unknown. */
function ProfileLoadingScreen() {
  const { colors } = useTheme();

  return (
    <View style={[styles.loading, { backgroundColor: colors.background }]}>
      <ActivityIndicator color={colors.primary} />
      <AppText variant="caption" color="secondary">
        Yükleniyor...
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  splashLabel: {
    color: SPLASH_CONTENT_COLOR,
  },
});
