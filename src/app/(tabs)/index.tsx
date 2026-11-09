import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, type ComponentProps } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';

import { AppText, Screen } from '@/components';
import { listAllCurricula } from '@/data/curriculum';
import {
  formatRelativeStudyLabel,
  selectHomeState,
  selectLatestExamSummary,
  selectPriorityReviews,
  selectStaleTopics,
  selectTopicsStudiedToday,
  type HomeTopicItem,
  type HomeTopicSection,
  type LatestExamSummary,
  type TopicsStudiedToday,
} from '@/features/home';
import {
  examSelectors,
  profileSelectors,
  topicSelectors,
  useExamStore,
  useProfileStore,
  useTopicStore,
} from '@/store';
import { spacing, typography, useTheme } from '@/theme';
import type { TopicStatus } from '@/types';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

/** Display labels for the five MVP study states (mirrors the Topics screen). */
const STATUS_LABELS: Record<TopicStatus, string> = {
  not_started: 'Başlamadım',
  learning: 'Öğreniyorum',
  practice: 'Pratik',
  review: 'Tekrar',
  strong: 'Güçlü',
};

const GREETING = 'Bugün kaldığın yerden devam edebilirsin.';
const EMPTY_STATE_MESSAGE =
  'Çalışma geçmişin burada oluşacak. İlk denemeni ekleyebilir veya bugün çalıştığın bir konuyu işaretleyebilirsin.';
const RESUMED_MESSAGE = 'Kaldığın yerden devam edebilirsin.';
const EXAM_PLACEHOLDER_MESSAGE =
  'İlk denemeni eklediğinde son deneme özetin burada görünecek.';
const NO_REVIEW_MESSAGE = 'Şu an öne çıkan bir tekrar yok. Konuları işaretledikçe bu alan şekillenir.';
const PRIORITY_SECTION_TITLE = 'Öncelikli Tekrarlar';
const STALE_SECTION_TITLE = 'Uzun Süredir Çalışmadıkların';
const LATEST_EXAM_SECTION_TITLE = 'Son Deneme';
const NET_LABEL = 'Toplam Net';
const EXAM_LOADING_MESSAGE = 'Denemeler yükleniyor...';
const TOPIC_PROMPT_MESSAGE =
  'Çalıştığın bir konuyu işaretlediğinde tekrar durumlarını burada görebilirsin.';
const TOPIC_PROMPT_ACTION = 'Konu İşaretle';
const ADD_EXAM_ACTION = 'Yeni Deneme Ekle';

/** Subtle "shadow-sm" surface elevation shared by the header and cards. */
const SURFACE_SHADOW: ViewStyle = {
  shadowColor: '#0F1B34',
  shadowOffset: { width: 0, height: 1 },
  shadowOpacity: 0.05,
  shadowRadius: 8,
  elevation: 1,
};

/**
 * "Hedefin: ODTÜ · Bilgisayar Mühendisliği", or `null` when neither a target
 * university nor a target department is stored, so the row is never empty.
 */
function buildTargetLabel(university: string | null, department: string | null): string | null {
  const parts = [university, department].filter(
    (part): part is string => part !== null && part.trim().length > 0,
  );

  if (parts.length === 0) {
    return null;
  }

  return `Hedefin: ${parts.join(' · ')}`;
}

export default function HomeScreen() {
  const { colors } = useTheme();
  const router = useRouter();

  const targetDepartment = useProfileStore(profileSelectors.targetDepartment);
  const targetUniversity = useProfileStore(profileSelectors.targetUniversity);
  const progressByTopicId = useTopicStore(topicSelectors.progressByTopicId);

  // `examsById` and `isHydrated` are stable subscription targets (a stable map
  // reference and a primitive). The newest exam is derived below with `useMemo`
  // so no selector ever returns a fresh array on every render.
  const examsById = useExamStore(examSelectors.examsById);
  const examsHydrated = useExamStore(examSelectors.isHydrated);
  const examCount = useExamStore(examSelectors.examCount);

  // The curriculum is static and bundled, so the full lesson catalogue resolves
  // synchronously and every selector below reuses the same reference.
  const lessons = useMemo(() => listAllCurricula().flatMap((curriculum) => curriculum.lessons), []);

  const progress = useMemo(() => Object.values(progressByTopicId), [progressByTopicId]);

  // Reference date for the date rules. Stable for the lifetime of the screen;
  // all thresholds, sorting and staleness live in the Step 20 selectors.
  const now = useMemo(() => new Date(), []);

  const homeState = useMemo(
    () => selectHomeState({ topicProgressCount: progress.length, examCount }),
    [progress.length, examCount],
  );

  // Latest-exam selection reuses the centralized `sortExamsNewestFirst`
  // ordering (date, then `updatedAt`, then id) and never queries SQLite.
  const latestExamState = useMemo(
    () => selectLatestExamSummary({ isHydrated: examsHydrated, examsById }),
    [examsHydrated, examsById],
  );

  const priorityReviews = useMemo(
    () => selectPriorityReviews({ progress, lessons, now }),
    [progress, lessons, now],
  );
  const staleTopics = useMemo(
    () => selectStaleTopics({ progress, lessons, now }),
    [progress, lessons, now],
  );
  const studiedToday = useMemo(
    () => selectTopicsStudiedToday({ progress, lessons, now }),
    [progress, lessons, now],
  );

  const targetLabel = buildTargetLabel(targetUniversity, targetDepartment);
  const hasTopics = homeState === 'topicsOnly' || homeState === 'mixed';
  const hasReviewSection = priorityReviews.items.length > 0 || staleTopics.items.length > 0;

  const goToTopics = useCallback(() => {
    router.navigate('/topics');
  }, [router]);

  const goToAddExam = useCallback(() => {
    router.navigate('/exam/add');
  }, [router]);

  const openExam = useCallback(
    (examId: string) => {
      router.push({ pathname: '/exam/[id]', params: { id: examId } });
    },
    [router],
  );

  const goToProfile = useCallback(() => {
    // `src/app/profile/index.tsx` generates the public route `/profile`; the
    // directory index is never addressed as `/profile/index`.
    router.push('/profile');
  }, [router]);

  return (
    <Screen edges={['top']}>
      <View style={[styles.brandHeader, SURFACE_SHADOW, { backgroundColor: colors.surface }]}>
        <View style={styles.brandIdentity}>
          <View
            style={[styles.brandDot, { backgroundColor: colors.primary }]}
            accessible={false}
            importantForAccessibility="no"
          />
          <AppText variant="subtitle" style={styles.brandName}>
            PuanLab
          </AppText>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Profil ve ayarlar"
          accessibilityHint="Profil ve ayarlar ekranını açar"
          onPress={goToProfile}
          style={({ pressed }) => [styles.settingsButton, pressed && styles.pressed]}
        >
          <Ionicons name="settings-outline" size={22} color={colors.secondary} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.heading}>
          <AppText variant="title" style={styles.pageTitle}>
            {GREETING}
          </AppText>
          {targetLabel ? (
            <AppText variant="body" color="secondary">
              {targetLabel}
            </AppText>
          ) : null}
        </View>

        <View style={styles.quickActions}>
          <QuickActionButton label={ADD_EXAM_ACTION} icon="add" onPress={goToAddExam} />
          <QuickActionButton label={TOPIC_PROMPT_ACTION} icon="bookmark-outline" onPress={goToTopics} />
        </View>

        {hasTopics ? (
          <View style={[styles.card, SURFACE_SHADOW, { backgroundColor: colors.surface }]}>
            {studiedToday.total > 0 ? (
              <DailySummary studiedToday={studiedToday} />
            ) : (
              <AppText variant="body" color="secondary">
                {RESUMED_MESSAGE}
              </AppText>
            )}
          </View>
        ) : null}

        {latestExamState.status === 'loading' ? (
          <View
            style={[
              styles.card,
              styles.examLoadingCard,
              SURFACE_SHADOW,
              { backgroundColor: colors.surface },
            ]}
          >
            <ActivityIndicator color={colors.primary} />
            <AppText variant="caption" color="secondary">
              {EXAM_LOADING_MESSAGE}
            </AppText>
          </View>
        ) : null}

        {latestExamState.status === 'ready' ? (
          <LatestExamSection summary={latestExamState.summary} onPressExam={openExam} />
        ) : null}

        {latestExamState.status === 'empty' && hasTopics ? (
          <View
            style={[
              styles.card,
              styles.examPlaceholder,
              SURFACE_SHADOW,
              { backgroundColor: colors.surface },
            ]}
          >
            <View
              style={[styles.iconBadge, { backgroundColor: `${colors.primary}14` }]}
              accessible={false}
              importantForAccessibility="no"
            >
              <Ionicons name="document-text-outline" size={22} color={colors.primary} />
            </View>
            <AppText variant="body" color="secondary" style={styles.centeredText}>
              {EXAM_PLACEHOLDER_MESSAGE}
            </AppText>
          </View>
        ) : null}

        {hasTopics && priorityReviews.items.length > 0 ? (
          <TopicSection
            title={PRIORITY_SECTION_TITLE}
            section={priorityReviews}
            now={now}
            onPressTopic={goToTopics}
          />
        ) : null}

        {hasTopics && staleTopics.items.length > 0 ? (
          <TopicSection
            title={STALE_SECTION_TITLE}
            section={staleTopics}
            now={now}
            onPressTopic={goToTopics}
          />
        ) : null}

        {hasTopics && !hasReviewSection ? (
          <View style={[styles.card, SURFACE_SHADOW, { backgroundColor: colors.surface }]}>
            <AppText variant="body" color="secondary" style={styles.centeredText}>
              {NO_REVIEW_MESSAGE}
            </AppText>
          </View>
        ) : null}

        {homeState === 'examsOnly' ? (
          <View style={[styles.card, SURFACE_SHADOW, { backgroundColor: colors.surface }]}>
            <View
              style={[styles.iconBadge, styles.promptIcon, { backgroundColor: `${colors.primary}14` }]}
              accessible={false}
              importantForAccessibility="no"
            >
              <Ionicons name="bookmark-outline" size={22} color={colors.primary} />
            </View>
            <AppText variant="body" color="secondary" style={styles.centeredText}>
              {TOPIC_PROMPT_MESSAGE}
            </AppText>
            <QuickActionButton
              label={TOPIC_PROMPT_ACTION}
              icon="bookmark-outline"
              onPress={goToTopics}
            />
          </View>
        ) : null}

        {homeState === 'noData' && latestExamState.status !== 'loading' ? (
          <View
            style={[styles.card, styles.emptyCard, SURFACE_SHADOW, { backgroundColor: colors.surface }]}
          >
            <View
              style={[styles.iconBadge, { backgroundColor: `${colors.primary}14` }]}
              accessible={false}
              importantForAccessibility="no"
            >
              <Ionicons name="book-outline" size={24} color={colors.primary} />
            </View>
            <AppText variant="subtitle" style={styles.centeredText}>
              Henüz veri bulunmuyor
            </AppText>
            <AppText variant="body" color="secondary" style={styles.centeredText}>
              {EMPTY_STATE_MESSAGE}
            </AppText>
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

type QuickActionButtonProps = {
  label: string;
  icon: IoniconName;
  onPress?: () => void;
  disabled?: boolean;
};

/**
 * A full-width Home quick action. Disabled actions keep a 48dp touch target.
 */
function QuickActionButton({ label, icon, onPress, disabled = false }: QuickActionButtonProps) {
  const { colors } = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        disabled
          ? [
              styles.actionButtonDisabled,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]
          : [SURFACE_SHADOW, { backgroundColor: colors.primary }],
        pressed && !disabled && styles.pressed,
      ]}
    >
      <Ionicons name={icon} size={20} color={disabled ? colors.secondary : colors.surface} />
      <AppText
        variant="body"
        style={[styles.actionLabel, { color: disabled ? colors.secondary : colors.surface }]}
      >
        {label}
      </AppText>
    </Pressable>
  );
}

type DailySummaryProps = {
  studiedToday: TopicsStudiedToday;
};

/** Calm "today" summary: the count, up to three names and any remainder. */
function DailySummary({ studiedToday }: DailySummaryProps) {
  const { colors } = useTheme();
  const remaining = studiedToday.total - studiedToday.names.length;

  return (
    <>
      <AppText variant="subtitle">Bugün {studiedToday.total} konu işaretledin.</AppText>

      <View style={styles.todayList}>
        {studiedToday.names.map((name) => (
          <View key={name} style={styles.todayRow}>
            <View
              style={[styles.todayDot, { backgroundColor: colors.primary }]}
              accessible={false}
              importantForAccessibility="no"
            />
            <AppText variant="body" style={styles.todayName}>
              {name}
            </AppText>
          </View>
        ))}
      </View>

      {remaining > 0 ? (
        <AppText variant="caption" color="secondary">
          +{remaining} konu daha
        </AppText>
      ) : null}
    </>
  );
}

type LatestExamSectionProps = {
  summary: LatestExamSummary;
  onPressExam: (examId: string) => void;
};

/**
 * "Son Deneme": the newest stored exam. The whole card opens the read-only
 * exam detail; TYT/AYT is shown as a text label so it is never conveyed by
 * colour alone.
 */
function LatestExamSection({ summary, onPressExam }: LatestExamSectionProps) {
  const { colors } = useTheme();

  return (
    <View style={styles.section}>
      <AppText variant="subtitle">{LATEST_EXAM_SECTION_TITLE}</AppText>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={summary.accessibilityLabel}
        onPress={() => onPressExam(summary.id)}
        style={({ pressed }) => [
          styles.examCard,
          SURFACE_SHADOW,
          { backgroundColor: colors.surface },
          pressed && styles.pressed,
        ]}
      >
        <AppText variant="subtitle" numberOfLines={2} style={styles.examName}>
          {summary.name}
        </AppText>

        <AppText variant="caption" color="secondary" numberOfLines={1}>
          {`${summary.typeLabel} · ${summary.dateLabel}`}
        </AppText>

        <View style={styles.examNetRow}>
          <AppText variant="caption" color="secondary">
            {NET_LABEL}
          </AppText>
          <View style={styles.examNetValueRow}>
            <AppText variant="title" numberOfLines={1} style={styles.examNetValue}>
              {summary.netLabel}
            </AppText>
            <Ionicons name="chevron-forward" size={20} color={colors.secondary} />
          </View>
        </View>
      </Pressable>
    </View>
  );
}

type TopicSectionProps = {
  title: string;
  section: HomeTopicSection;
  now: Date;
  onPressTopic: () => void;
};

/** A capped preview section (max three rows) with its heading. */
function TopicSection({ title, section, now, onPressTopic }: TopicSectionProps) {
  const { colors } = useTheme();

  return (
    <View style={styles.section}>
      <AppText variant="subtitle">{title}</AppText>
      <View style={[styles.listCard, SURFACE_SHADOW, { backgroundColor: colors.surface }]}>
        {section.items.map((item, index) => (
          <HomeTopicRow
            key={item.topicId}
            item={item}
            now={now}
            separated={index > 0}
            onPress={onPressTopic}
          />
        ))}
      </View>
    </View>
  );
}

type HomeTopicRowProps = {
  item: HomeTopicItem;
  now: Date;
  separated: boolean;
  onPress: () => void;
};

/**
 * A pressable Home topic row. Opening `TopicDetailSheet` from Home is out of
 * scope for this step, so every row simply routes to the Topics tab.
 */
function HomeTopicRow({ item, now, separated, onPress }: HomeTopicRowProps) {
  const { colors, status } = useTheme();
  const statusLabel = STATUS_LABELS[item.status];
  const relativeLabel = formatRelativeStudyLabel(item.lastStudiedAt, now);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.lessonName}, ${item.topicName}, durum: ${statusLabel}${
        relativeLabel ? `, ${relativeLabel}` : ''
      }`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.topicRow,
        separated && [styles.topicRowSeparated, { borderTopColor: colors.border }],
        pressed && { backgroundColor: `${colors.primary}0D` },
      ]}
    >
      <View style={styles.topicRowMain}>
        <AppText variant="caption" color="secondary" numberOfLines={1}>
          {item.lessonName}
        </AppText>
        <AppText variant="body" numberOfLines={2} style={styles.topicName}>
          {item.topicName}
        </AppText>
        {relativeLabel ? (
          <AppText variant="caption" color="secondary" numberOfLines={1}>
            {relativeLabel}
          </AppText>
        ) : null}
      </View>

      <View style={[styles.statusPill, { backgroundColor: `${status[item.status]}1A` }]}>
        <View style={[styles.statusDot, { backgroundColor: status[item.status] }]} />
        <AppText variant="caption" style={[styles.statusPillLabel, { color: colors.text }]}>
          {statusLabel}
        </AppText>
      </View>

      <Ionicons name="chevron-forward" size={18} color={colors.secondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  brandHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    minHeight: 64,
    paddingHorizontal: spacing.md,
  },
  brandIdentity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexShrink: 1,
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
  settingsButton: {
    width: spacing.xxl,
    height: spacing.xxl,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: spacing.xxl / 2,
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
  quickActions: {
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: spacing.xxl,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  actionButtonDisabled: {
    borderWidth: StyleSheet.hairlineWidth,
  },
  actionLabel: {
    flexShrink: 1,
    fontWeight: typography.subtitle.fontWeight,
  },
  card: {
    borderRadius: 12,
    padding: spacing.md,
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  emptyCard: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
  },
  examPlaceholder: {
    alignItems: 'center',
  },
  examLoadingCard: {
    alignItems: 'center',
  },
  examCard: {
    borderRadius: 12,
    padding: spacing.md,
    gap: spacing.sm,
    minHeight: 48,
  },
  examName: {
    flexShrink: 1,
  },
  examNetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  examNetValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexShrink: 1,
  },
  examNetValue: {
    flexShrink: 1,
  },
  promptIcon: {
    alignSelf: 'center',
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
  todayList: {
    gap: spacing.xs,
  },
  todayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  todayDot: {
    width: spacing.sm,
    height: spacing.sm,
    borderRadius: spacing.xs,
  },
  todayName: {
    flexShrink: 1,
  },
  section: {
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  listCard: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  topicRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  topicRowSeparated: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  topicRowMain: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs / 2,
  },
  topicName: {
    flexShrink: 1,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs / 2,
    borderRadius: spacing.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs / 2,
    flexShrink: 0,
  },
  statusDot: {
    width: spacing.sm,
    height: spacing.sm,
    borderRadius: spacing.xs,
  },
  statusPillLabel: {
    fontWeight: typography.subtitle.fontWeight,
  },
  pressed: {
    opacity: 0.85,
  },
});
