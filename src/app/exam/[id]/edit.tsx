import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';

import { AppText, Screen } from '@/components';
import { PracticeExamForm } from '@/features/exams/PracticeExamForm';
import { normalizeExamIdParam, resolveExamDetailStatus } from '@/features/exams';
import { examSelectors, useExamStore } from '@/store';
import { spacing, typography, useTheme } from '@/theme';

const NOT_FOUND_MESSAGE = 'Bu deneme bulunamadı.';

/** Subtle "shadow-sm" surface elevation shared by the header and cards. */
const SURFACE_SHADOW: ViewStyle = {
  shadowColor: '#0F1B34',
  shadowOffset: { width: 0, height: 1 },
  shadowOpacity: 0.05,
  shadowRadius: 8,
  elevation: 1,
};

/**
 * Edit route for one saved practice exam (`/exam/{id}/edit`).
 *
 * The record is selected with a stable per-id selector; while the store is not
 * hydrated a themed loading state is shown, and an unknown id shows a calm
 * not-found state instead of crashing. When the record is ready the shared form
 * renders in `edit` mode, loading its values from the stored exam.
 */
export default function EditExamScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string | string[] }>();

  const examId = useMemo(() => normalizeExamIdParam(params.id), [params.id]);

  const isHydrated = useExamStore(examSelectors.isHydrated);

  // Zustand 5 subscribes with raw `useSyncExternalStore` (no equality check), so
  // the selector must return a stable reference. `examById` is curried and
  // returns the stored record reference (or `null`) — never a freshly built
  // object — so the snapshot stays stable and no render loop occurs.
  const selectExamById = useMemo(() => examSelectors.examById(examId ?? ''), [examId]);
  const exam = useExamStore(selectExamById);

  const status = resolveExamDetailStatus({ isHydrated, examId, exam });

  const goBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }

    // Deep-link fallback: no history to pop back to.
    router.replace('/exams');
  }, [router]);

  const goToExams = useCallback(() => {
    router.replace('/exams');
  }, [router]);

  if (status === 'ready' && exam) {
    return <PracticeExamForm mode="edit" exam={exam} />;
  }

  return (
    <Screen>
      <View style={[styles.header, SURFACE_SHADOW, { backgroundColor: colors.surface }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Geri"
          accessibilityHint="Deneme detayına döner"
          onPress={goBack}
          style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}
        >
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </Pressable>

        <AppText variant="subtitle" style={styles.headerTitle} numberOfLines={1}>
          Deneme Düzenle
        </AppText>
      </View>

      {status === 'loading' ? (
        <View style={styles.stateBlock}>
          <ActivityIndicator color={colors.primary} />
          <AppText variant="caption" color="secondary">
            Yükleniyor...
          </AppText>
        </View>
      ) : (
        <View style={styles.stateWrap}>
          <View style={[styles.stateCard, SURFACE_SHADOW, { backgroundColor: colors.surface }]}>
            <View
              style={[styles.stateIcon, { backgroundColor: `${colors.primary}14` }]}
              accessible={false}
              importantForAccessibility="no"
            >
              <Ionicons name="document-text-outline" size={24} color={colors.primary} />
            </View>

            <AppText variant="body" color="secondary" style={styles.centeredText}>
              {NOT_FOUND_MESSAGE}
            </AppText>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Denemelere Dön"
              accessibilityHint="Deneme listesine döner"
              onPress={goToExams}
              style={({ pressed }) => [
                styles.primaryButton,
                SURFACE_SHADOW,
                { backgroundColor: colors.primary },
                pressed && styles.pressed,
              ]}
            >
              <Ionicons name="list-outline" size={20} color={colors.surface} />
              <AppText variant="body" style={[styles.primaryButtonLabel, { color: colors.surface }]}>
                Denemelere Dön
              </AppText>
            </Pressable>
          </View>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: 56,
    paddingHorizontal: spacing.sm,
  },
  headerButton: {
    width: spacing.xxl,
    height: spacing.xxl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flexShrink: 1,
    fontWeight: typography.subtitle.fontWeight,
  },
  stateBlock: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingTop: spacing.xxl,
  },
  stateWrap: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  stateCard: {
    alignItems: 'center',
    borderRadius: 12,
    padding: spacing.md,
    gap: spacing.md,
  },
  stateIcon: {
    width: spacing.xxl,
    height: spacing.xxl,
    borderRadius: spacing.xxl / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centeredText: {
    textAlign: 'center',
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    alignSelf: 'stretch',
    minHeight: spacing.xxl,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  primaryButtonLabel: {
    flexShrink: 1,
    fontWeight: typography.subtitle.fontWeight,
  },
  pressed: {
    opacity: 0.85,
  },
});
