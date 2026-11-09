import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { classifyDatabaseStartupFailure, DATABASE_STARTUP_COPY } from '@/db/databaseStartup';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';

export type DatabaseStartupErrorProps = {
  /** The original startup failure, or `null` while a retry is in flight. */
  error: Error | null;
  isRetrying: boolean;
  onRetry: () => void;
};

/**
 * Bootstrap colours only.
 *
 * This screen is rendered by the composition root *before* `ThemeProvider` is
 * mounted (the database failed, so no settings repository exists), therefore it
 * must not use `useTheme`, `AppText` or `Screen` — those would throw
 * "Theme hooks must be used within a ThemeProvider". The palette continues the
 * native splash colour, so it is legible in both light and dark situations and
 * never flashes a wrong theme.
 */
const BACKGROUND_COLOR = '#208AEF';
const CONTENT_COLOR = '#FFFFFF';
const CONTENT_MUTED_COLOR = '#E4EFFB';
const BUTTON_BACKGROUND_COLOR = '#FFFFFF';
const BUTTON_CONTENT_COLOR = '#0B5FBF';
const BUTTON_DISABLED_BACKGROUND_COLOR = 'rgba(255, 255, 255, 0.28)';

/**
 * Safe startup failure screen. Shown instead of the app when SQLite could not
 * be opened, migrated or verified, with a working retry.
 *
 * It deliberately offers no destructive action: a temporary or repairable
 * failure must never invite the user to delete their data.
 */
export function DatabaseStartupError({ error, isRetrying, onRetry }: DatabaseStartupErrorProps) {
  useEffect(() => {
    if (!__DEV__ || error === null) {
      return;
    }

    // Development diagnostics only; the technical Error is preserved verbatim
    // and never reaches the user-facing copy.
    console.error(
      `[DatabaseStartup] Initialization failed [${classifyDatabaseStartupFailure(error)}]`,
      error,
    );
  }, [error]);

  return (
    <View style={styles.container}>
      <Ionicons name="cloud-offline-outline" size={48} color={CONTENT_COLOR} />

      <Text style={styles.title} accessibilityRole="header">
        {DATABASE_STARTUP_COPY.title}
      </Text>

      <Text style={styles.message}>{DATABASE_STARTUP_COPY.message}</Text>

      <Pressable
        onPress={onRetry}
        disabled={isRetrying}
        accessibilityRole="button"
        accessibilityLabel={DATABASE_STARTUP_COPY.retryAccessibilityLabel}
        accessibilityState={{ busy: isRetrying, disabled: isRetrying }}
        style={({ pressed }) => [
          styles.button,
          isRetrying && styles.buttonDisabled,
          pressed && !isRetrying && styles.buttonPressed,
        ]}
      >
        {isRetrying ? (
          <>
            <ActivityIndicator color={CONTENT_COLOR} />
            <Text style={styles.buttonLabel}>{DATABASE_STARTUP_COPY.retryActionBusy}</Text>
          </>
        ) : (
          <>
            <Ionicons name="refresh-outline" size={20} color={BUTTON_CONTENT_COLOR} />
            <Text style={[styles.buttonLabel, styles.buttonLabelEnabled]}>
              {DATABASE_STARTUP_COPY.retryAction}
            </Text>
          </>
        )}
      </Pressable>

      <Text style={styles.safetyNote}>{DATABASE_STARTUP_COPY.safetyNote}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
    backgroundColor: BACKGROUND_COLOR,
  },
  title: {
    ...typography.title,
    color: CONTENT_COLOR,
    textAlign: 'center',
  },
  message: {
    ...typography.body,
    color: CONTENT_MUTED_COLOR,
    textAlign: 'center',
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: 48,
    minWidth: 48,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.xl,
    borderRadius: 12,
    backgroundColor: BUTTON_BACKGROUND_COLOR,
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonDisabled: {
    backgroundColor: BUTTON_DISABLED_BACKGROUND_COLOR,
  },
  buttonLabel: {
    ...typography.subtitle,
    color: CONTENT_COLOR,
  },
  buttonLabelEnabled: {
    color: BUTTON_CONTENT_COLOR,
  },
  safetyNote: {
    ...typography.caption,
    color: CONTENT_MUTED_COLOR,
    textAlign: 'center',
  },
});
