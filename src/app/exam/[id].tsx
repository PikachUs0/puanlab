import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';

import { AppText, Screen } from '@/components';
import {
  DELETE_CONFIRM_TITLE,
  DELETE_ERROR_MESSAGE,
  buildDeleteConfirmMessage,
  buildExamLessonRows,
  createDeleteGuard,
  formatExamDateForDisplay,
  formatNetForDisplay,
  normalizeExamIdParam,
  resolveExamDetailStatus,
  useExamPersistenceActions,
  type ExamLessonRow,
} from '@/features/exams';
import { examSelectors, useExamStore } from '@/store';
import { spacing, typography, useTheme } from '@/theme';
import type { PracticeExam } from '@/types';

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
 * Practice exam detail screen.
 *
 * The mode is decided by `resolveExamDetailStatus`: the exam record is selected
 * with a stable per-id selector, a missing id or unknown exam shows a calm
 * not-found state, and the "Düzenle" and "Sil" actions open the edit form and
 * the delete confirmation respectively. When an exam is deleted the store loses
 * it immediately, so this screen falls back to the same not-found state instead
 * of reading properties of a missing record.
 */
export default function ExamDetailScreen() {
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

  return (
    <Screen>
      <View style={[styles.header, SURFACE_SHADOW, { backgroundColor: colors.surface }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Geri"
          accessibilityHint="Deneme listesine döner"
          onPress={goBack}
          style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}
        >
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </Pressable>

        <AppText variant="subtitle" style={styles.headerTitle} numberOfLines={1}>
          Deneme Detayı
        </AppText>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {status === 'loading' ? (
          <View style={styles.stateBlock}>
            <ActivityIndicator color={colors.primary} />
            <AppText variant="caption" color="secondary">
              Yükleniyor...
            </AppText>
          </View>
        ) : null}

        {status === 'not_found' ? <NotFoundState onGoToExams={goToExams} /> : null}

        {status === 'ready' && exam ? <ExamDetail exam={exam} /> : null}
      </ScrollView>
    </Screen>
  );
}

function NotFoundState({ onGoToExams }: { onGoToExams: () => void }) {
  const { colors } = useTheme();

  return (
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
        onPress={onGoToExams}
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
  );
}

function ExamDetail({ exam }: { exam: PracticeExam }) {
  const { colors } = useTheme();

  // Derived rows only depend on the stored exam record, so memoizing on its
  // identity keeps the computation stable across unrelated re-renders.
  const rows = useMemo(() => buildExamLessonRows(exam), [exam]);

  return (
    <>
      <View style={[styles.identityCard, SURFACE_SHADOW, { backgroundColor: colors.surface }]}>
        <View style={styles.identityTopRow}>
          <View style={[styles.typePill, { backgroundColor: `${colors.primary}14` }]}>
            <AppText variant="caption" style={[styles.typePillLabel, { color: colors.primary }]}>
              {exam.type}
            </AppText>
          </View>

          <View style={styles.dateRow}>
            <Ionicons name="calendar-outline" size={14} color={colors.secondary} />
            <AppText
              variant="caption"
              color="secondary"
              numberOfLines={1}
              style={styles.dateValue}
            >
              {formatExamDateForDisplay(exam.date)}
            </AppText>
          </View>
        </View>

        <AppText variant="subtitle" style={styles.examName}>
          {exam.name}
        </AppText>
      </View>

      <View style={[styles.netCard, SURFACE_SHADOW, { backgroundColor: colors.primary }]}>
        <View style={styles.netCardText}>
          <AppText variant="caption" style={[styles.onPrimaryText, { color: colors.surface }]}>
            Toplam Net
          </AppText>
          <AppText variant="title" style={[styles.netCardValue, { color: colors.surface }]}>
            {formatNetForDisplay(exam.totalNet)}
          </AppText>
        </View>

        <View
          style={[styles.netCardIcon, { backgroundColor: `${colors.surface}26` }]}
          accessible={false}
          importantForAccessibility="no"
        >
          <Ionicons name="calculator-outline" size={26} color={colors.surface} />
        </View>
      </View>

      <View style={styles.summaryGrid}>
        <SummaryTile label="Doğru" value={exam.totalCorrect} tone="positive" />
        <SummaryTile label="Yanlış" value={exam.totalIncorrect} tone="negative" />
        <SummaryTile label="Boş" value={exam.totalBlank} tone="neutral" />
      </View>

      <View style={styles.lessonSection}>
        <AppText variant="body" style={styles.sectionTitle}>
          Ders Sonuçları
        </AppText>

        {rows.map((row) => (
          <LessonResultCard key={row.lessonId} row={row} />
        ))}
      </View>

      <ExamActions examId={exam.id} examName={exam.name} />
    </>
  );
}

type SummaryTone = 'positive' | 'negative' | 'neutral';

function SummaryTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: SummaryTone;
}) {
  const { colors, status } = useTheme();

  const valueColor =
    tone === 'positive' ? status.strong : tone === 'negative' ? colors.danger : colors.secondary;

  return (
    <View style={[styles.summaryTile, SURFACE_SHADOW, { backgroundColor: colors.surface }]}>
      <AppText variant="caption" color="secondary" style={styles.summaryTileLabel}>
        {label}
      </AppText>
      <AppText variant="subtitle" style={[styles.summaryTileValue, { color: valueColor }]}>
        {String(value)}
      </AppText>
      <AppText variant="caption" color="secondary" style={styles.summaryTileSublabel}>
        Soru
      </AppText>
    </View>
  );
}

function LessonResultCard({ row }: { row: ExamLessonRow }) {
  const { colors, status } = useTheme();

  return (
    <View style={[styles.lessonCard, SURFACE_SHADOW, { backgroundColor: colors.surface }]}>
      <View style={styles.lessonTopRow}>
        <View style={styles.lessonIdentity}>
          <AppText variant="body" style={styles.lessonName}>
            {row.name}
          </AppText>
          {row.questionCount !== null ? (
            <AppText variant="caption" color="secondary">
              {`(${row.questionCount} Soru)`}
            </AppText>
          ) : null}
        </View>

        <View style={styles.lessonNetBlock}>
          <AppText variant="caption" color="secondary">
            Net:
          </AppText>
          <AppText variant="subtitle" style={[styles.lessonNetValue, { color: colors.primary }]}>
            {formatNetForDisplay(row.net)}
          </AppText>
        </View>
      </View>

      <View style={[styles.lessonBreakdown, { backgroundColor: colors.background }]}>
        <BreakdownItem dotColor={status.strong} value={row.correct} label="Doğru" />
        <BreakdownItem dotColor={colors.danger} value={row.incorrect} label="Yanlış" />
        <BreakdownItem dotColor={colors.secondary} value={row.blank} label="Boş" />
      </View>
    </View>
  );
}

function BreakdownItem({
  dotColor,
  value,
  label,
}: {
  dotColor: string;
  value: number;
  label: string;
}) {
  return (
    <View style={styles.breakdownItem}>
      <View
        style={[styles.breakdownDot, { backgroundColor: dotColor }]}
        accessible={false}
        importantForAccessibility="no"
      />
      <AppText variant="caption" style={styles.breakdownValue}>
        {String(value)}
      </AppText>
      <AppText variant="caption" color="secondary" numberOfLines={1} style={styles.breakdownLabel}>
        {label}
      </AppText>
    </View>
  );
}

/**
 * Edit and Delete actions for one exam.
 *
 * "Düzenle" opens the edit form. "Sil" first asks for confirmation naming the
 * exam, then deletes it through the existing persistence action, which writes to
 * SQLite before touching the store. Both controls are disabled while the delete
 * is running and the delete control shows a progress state.
 */
function ExamActions({ examId, examName }: { examId: string; examName: string }) {
  const { colors } = useTheme();
  const router = useRouter();
  const { deleteExam } = useExamPersistenceActions();

  // Synchronous single-flight guard: state updates are async, so it prevents a
  // second confirmation dialog and a duplicate delete before `isDeleting` renders.
  const deleteGuard = useRef(createDeleteGuard());
  const isMountedRef = useRef(true);

  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [technicalError, setTechnicalError] = useState<string | null>(null);

  useEffect(
    () => () => {
      // The store update unmounts this screen; never touch state afterwards.
      isMountedRef.current = false;
    },
    [],
  );

  const goToEdit = useCallback(() => {
    router.push({ pathname: '/exam/[id]/edit', params: { id: examId } });
  }, [router, examId]);

  const runDelete = useCallback(async () => {
    setIsDeleting(true);
    setDeleteError(null);
    setTechnicalError(null);

    if (__DEV__) {
      console.log('[DeleteExam] repository delete started');
    }

    // Stage 1: persistence, then the store. A failure here deleted nothing, so
    // the user stays on the detail screen with the exam still visible.
    try {
      await deleteExam(examId);

      if (__DEV__) {
        console.log('[DeleteExam] repository delete completed');
        console.log('[DeleteExam] store updated');
      }
    } catch (error) {
      if (__DEV__) {
        console.error('[DeleteExam] Delete failed', error);
      }

      if (isMountedRef.current) {
        setDeleteError(DELETE_ERROR_MESSAGE);

        if (__DEV__) {
          setTechnicalError(
            error instanceof Error ? `${error.name}: ${error.message}` : String(error),
          );
        }

        setIsDeleting(false);
      }

      deleteGuard.current.finish();
      return;
    }

    // Stage 2: navigation. Handled separately so a navigation failure is never
    // reported as a failed delete — the record really is gone at this point.
    if (__DEV__) {
      console.log('[DeleteExam] navigation started');
    }

    try {
      if (router.canGoBack()) {
        // Returns to the Denemeler tab and drops the deleted detail from history.
        router.back();
      } else {
        router.replace('/exams');
      }
    } catch (error) {
      if (__DEV__) {
        console.error('[DeleteExam] Navigation failed after a successful delete', error);
      }
    }
  }, [deleteExam, examId, router]);

  const requestDelete = useCallback(() => {
    if (isDeleting || !deleteGuard.current.tryStart()) {
      return;
    }

    Alert.alert(DELETE_CONFIRM_TITLE, buildDeleteConfirmMessage(examName), [
      {
        text: 'İptal',
        style: 'cancel',
        onPress: () => deleteGuard.current.finish(),
      },
      {
        text: 'Sil',
        style: 'destructive',
        onPress: () => {
          void runDelete();
        },
      },
    ], {
      cancelable: true,
      onDismiss: () => deleteGuard.current.finish(),
    });
  }, [examName, isDeleting, runDelete]);

  return (
    <View style={styles.actionsSection}>
      <View style={styles.actionsRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Düzenle"
          accessibilityHint="Deneme düzenleme formunu açar"
          accessibilityState={{ disabled: isDeleting }}
          disabled={isDeleting}
          onPress={goToEdit}
          style={({ pressed }) => [
            styles.actionButton,
            { backgroundColor: colors.surface, borderColor: colors.border },
            isDeleting && styles.disabled,
            pressed && styles.pressed,
          ]}
        >
          <Ionicons
            name="create-outline"
            size={20}
            color={isDeleting ? colors.secondary : colors.text}
          />
          <AppText
            variant="body"
            style={[styles.actionLabel, { color: isDeleting ? colors.secondary : colors.text }]}
          >
            Düzenle
          </AppText>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${examName} denemesini sil`}
          accessibilityHint="Silmeden önce onay istenir"
          accessibilityState={{ disabled: isDeleting, busy: isDeleting }}
          disabled={isDeleting}
          onPress={requestDelete}
          style={({ pressed }) => [
            styles.actionButton,
            { backgroundColor: colors.surface, borderColor: colors.danger },
            isDeleting && styles.disabled,
            pressed && styles.pressed,
          ]}
        >
          {isDeleting ? (
            <ActivityIndicator color={colors.danger} />
          ) : (
            <Ionicons name="trash-outline" size={20} color={colors.danger} />
          )}
          <AppText
            variant="body"
            style={[styles.actionLabel, { color: colors.danger }]}
            accessibilityLiveRegion="polite"
          >
            {isDeleting ? 'Siliniyor...' : 'Sil'}
          </AppText>
        </Pressable>
      </View>

      {deleteError ? (
        <View style={styles.errorRow}>
          <Ionicons
            name="alert-circle-outline"
            size={16}
            color={colors.danger}
            style={styles.errorIcon}
          />
          <AppText variant="caption" style={[styles.errorText, { color: colors.danger }]}>
            {deleteError}
          </AppText>
        </View>
      ) : null}

      {__DEV__ && technicalError ? (
        <AppText variant="caption" color="secondary" style={styles.technicalText}>
          {`Teknik hata: ${technicalError}`}
        </AppText>
      ) : null}
    </View>
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
  content: {
    flexGrow: 1,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  stateBlock: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingTop: spacing.xxl,
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
  identityCard: {
    borderRadius: 12,
    padding: spacing.md,
    gap: spacing.xs,
  },
  identityTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  typePill: {
    borderRadius: spacing.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs / 2,
    flexShrink: 0,
  },
  typePillLabel: {
    fontWeight: typography.subtitle.fontWeight,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flexShrink: 1,
    minWidth: 0,
  },
  dateValue: {
    flexShrink: 1,
  },
  examName: {
    fontWeight: typography.subtitle.fontWeight,
  },
  netCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    borderRadius: 12,
    padding: spacing.md,
  },
  netCardText: {
    flexShrink: 1,
    minWidth: 0,
    gap: spacing.xs / 2,
  },
  onPrimaryText: {
    fontWeight: typography.subtitle.fontWeight,
  },
  netCardValue: {
    fontWeight: typography.title.fontWeight,
    letterSpacing: -0.5,
  },
  netCardIcon: {
    width: spacing.xxl,
    height: spacing.xxl,
    borderRadius: spacing.xxl / 2,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  summaryGrid: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  summaryTile: {
    flex: 1,
    alignItems: 'center',
    borderRadius: 12,
    padding: spacing.md,
    gap: spacing.xs / 2,
  },
  summaryTileLabel: {
    textAlign: 'center',
  },
  summaryTileValue: {
    fontWeight: typography.subtitle.fontWeight,
  },
  summaryTileSublabel: {
    textAlign: 'center',
  },
  lessonSection: {
    gap: spacing.sm,
  },
  sectionTitle: {
    fontWeight: typography.subtitle.fontWeight,
    paddingHorizontal: spacing.xs,
  },
  lessonCard: {
    borderRadius: 12,
    padding: spacing.md,
    gap: spacing.sm,
  },
  lessonTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  lessonIdentity: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    gap: spacing.xs,
  },
  lessonName: {
    flexShrink: 1,
    fontWeight: typography.subtitle.fontWeight,
  },
  lessonNetBlock: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.xs / 2,
    flexShrink: 0,
  },
  lessonNetValue: {
    fontWeight: typography.subtitle.fontWeight,
  },
  lessonBreakdown: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  breakdownItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minWidth: 0,
  },
  breakdownDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  breakdownValue: {
    fontWeight: typography.subtitle.fontWeight,
  },
  breakdownLabel: {
    flexShrink: 1,
  },
  actionsSection: {
    gap: spacing.sm,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    minHeight: spacing.xxl,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  actionLabel: {
    flexShrink: 1,
    fontWeight: typography.subtitle.fontWeight,
  },
  disabled: {
    opacity: 0.5,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  errorIcon: {
    marginTop: 1,
  },
  errorText: {
    flex: 1,
    minWidth: 0,
  },
  technicalText: {
    paddingHorizontal: spacing.xs,
  },
  pressed: {
    opacity: 0.85,
  },
});
