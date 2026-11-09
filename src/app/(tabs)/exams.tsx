import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useCallback, useMemo } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';

import { AppText, Screen } from '@/components';
import { sortExamsNewestFirst } from '@/features/exams';
import { examSelectors, useExamStore } from '@/store';
import { spacing, typography, useTheme } from '@/theme';
import type { PracticeExam } from '@/types';

const EMPTY_STATE_MESSAGE =
  'Deneme geçmişin burada oluşacak. İlk TYT veya AYT denemeni ekleyerek netlerini takip etmeye başlayabilirsin.';

const MONTH_NAMES = [
  'Ocak',
  'Şubat',
  'Mart',
  'Nisan',
  'Mayıs',
  'Haziran',
  'Temmuz',
  'Ağustos',
  'Eylül',
  'Ekim',
  'Kasım',
  'Aralık',
] as const;

/** Subtle "shadow-sm" surface elevation shared by the header and cards. */
const SURFACE_SHADOW: ViewStyle = {
  shadowColor: '#0F1B34',
  shadowOffset: { width: 0, height: 1 },
  shadowOpacity: 0.05,
  shadowRadius: 8,
  elevation: 1,
};

/** Turkish display date, e.g. "9 Kasım 2026". */
function formatExamDate(isoDate: string): string {
  const date = new Date(isoDate);

  if (Number.isNaN(date.getTime())) {
    return isoDate;
  }

  return `${date.getDate()} ${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
}

/**
 * Turkish net display: comma decimal separator with at most two decimals and
 * trailing zeros trimmed. This only formats output; stored precision is never
 * rounded.
 */
function formatTotalNet(net: number): string {
  return net
    .toFixed(2)
    .replace(/\.?0+$/, '')
    .replace('.', ',');
}

export default function ExamsScreen() {
  const { colors } = useTheme();
  const router = useRouter();

  const isHydrated = useExamStore(examSelectors.isHydrated);
  const examsById = useExamStore(examSelectors.examsById);

  // Zustand 5 subscribes with raw `useSyncExternalStore` (no equality check), so
  // a selector must return a stable reference or a primitive. Deriving the
  // sorted list here (instead of inside the selector) keeps the snapshot stable:
  // it only recomputes when `examsById` identity changes.
  const exams = useMemo(() => sortExamsNewestFirst(Object.values(examsById)), [examsById]);

  const goToAddExam = useCallback(() => {
    router.navigate('/exam/add');
  }, [router]);

  return (
    <Screen edges={['top']}>
      <View style={[styles.brandHeader, SURFACE_SHADOW, { backgroundColor: colors.surface }]}>
        <View
          style={[styles.brandDot, { backgroundColor: colors.primary }]}
          accessible={false}
          importantForAccessibility="no"
        />
        <AppText variant="subtitle" style={styles.brandName}>
          PuanLab
        </AppText>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.heading}>
          <AppText variant="title" style={styles.pageTitle}>
            Denemeler
          </AppText>
          <AppText variant="body" color="secondary">
            TYT ve AYT denemelerini kaydet, net ortalamanı zaman içinde takip et.
          </AppText>
        </View>

        {!isHydrated ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : exams.length === 0 ? (
          <View style={[styles.card, SURFACE_SHADOW, { backgroundColor: colors.surface }]}>
            <View
              style={[styles.iconBadge, { backgroundColor: `${colors.primary}14` }]}
              accessible={false}
              importantForAccessibility="no"
            >
              <Ionicons name="document-text-outline" size={24} color={colors.primary} />
            </View>

            <AppText variant="body" color="secondary" style={styles.centeredText}>
              {EMPTY_STATE_MESSAGE}
            </AppText>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="İlk Denemeni Ekle"
              onPress={goToAddExam}
              style={({ pressed }) => [
                styles.primaryButton,
                SURFACE_SHADOW,
                { backgroundColor: colors.primary },
                pressed && styles.pressed,
              ]}
            >
              <Ionicons name="add" size={20} color={colors.surface} />
              <AppText
                variant="body"
                style={[styles.primaryButtonLabel, { color: colors.surface }]}
              >
                İlk Denemeni Ekle
              </AppText>
            </Pressable>
          </View>
        ) : (
          <View style={[styles.listCard, SURFACE_SHADOW, { backgroundColor: colors.surface }]}>
            {exams.map((exam, index) => (
              <ExamRow key={exam.id} exam={exam} separated={index > 0} />
            ))}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

type ExamRowProps = {
  exam: PracticeExam;
  /** Draws a top separator so consecutive rows read as distinct items. */
  separated: boolean;
};

/**
 * Pressable exam row. The exam type is shown as a text label so TYT and AYT are
 * never distinguished by colour alone. Tapping the whole row opens the exam
 * detail screen; the chevron signals that the row is navigable.
 */
function ExamRow({ exam, separated }: ExamRowProps) {
  const { colors } = useTheme();
  const router = useRouter();

  const openDetail = useCallback(() => {
    router.push({ pathname: '/exam/[id]', params: { id: exam.id } });
  }, [router, exam.id]);

  return (
    <Pressable
      accessible
      accessibilityRole="button"
      accessibilityLabel={`${exam.name}, ${exam.type}, ${formatExamDate(
        exam.date,
      )}, toplam net ${formatTotalNet(exam.totalNet)}`}
      accessibilityHint="Deneme detayını açar"
      onPress={openDetail}
      style={({ pressed }) => [
        styles.examRow,
        separated && [styles.examRowSeparated, { borderTopColor: colors.border }],
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.examRowMain}>
        <AppText variant="body" numberOfLines={2} style={styles.examName}>
          {exam.name}
        </AppText>

        <View style={styles.examMeta}>
          <View style={[styles.typePill, { backgroundColor: `${colors.primary}14` }]}>
            <AppText variant="caption" color="secondary" style={styles.typePillLabel}>
              {exam.type}
            </AppText>
          </View>
          <AppText variant="caption" color="secondary" numberOfLines={1} style={styles.examDate}>
            {formatExamDate(exam.date)}
          </AppText>
        </View>
      </View>

      <View style={styles.netBlock}>
        <AppText variant="caption" color="secondary">
          Net
        </AppText>
        <AppText variant="subtitle" style={styles.netValue}>
          {formatTotalNet(exam.totalNet)}
        </AppText>
      </View>

      <Ionicons name="chevron-forward" size={20} color={colors.secondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  brandHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 64,
    paddingHorizontal: spacing.md,
  },
  brandDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  brandName: {
    fontWeight: typography.subtitle.fontWeight,
    letterSpacing: -0.5,
  },
  content: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
  },
  heading: {
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  pageTitle: {
    fontWeight: typography.subtitle.fontWeight,
    letterSpacing: -0.5,
  },
  loading: {
    paddingVertical: spacing.xl,
  },
  card: {
    alignItems: 'center',
    borderRadius: 12,
    padding: spacing.md,
    gap: spacing.md,
  },
  iconBadge: {
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
  listCard: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  examRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  examRowSeparated: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  examRowMain: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
  examName: {
    flexShrink: 1,
  },
  examMeta: {
    flexDirection: 'row',
    alignItems: 'center',
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
  examDate: {
    flexShrink: 1,
  },
  netBlock: {
    alignItems: 'flex-end',
    flexShrink: 0,
  },
  netValue: {
    fontWeight: typography.subtitle.fontWeight,
  },
  pressed: {
    opacity: 0.85,
  },
});
