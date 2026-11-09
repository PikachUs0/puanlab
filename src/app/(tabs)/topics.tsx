import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
  type ViewStyle,
} from 'react-native';

import { AppText, Screen } from '@/components';
import { useLessons } from '@/data/curriculum';
import { TopicDetailSheet, type TopicSelection } from '@/features/topics';
import { profileSelectors, topicSelectors, useProfileStore, useTopicStore } from '@/store';
import { spacing, typography, useTheme } from '@/theme';
import type {
  CurriculumScoreType,
  ExamType,
  Lesson,
  ScoreType,
  Topic,
  TopicStatus,
} from '@/types';

const EXAM_TYPE_OPTIONS: readonly { value: ExamType; label: string }[] = [
  { value: 'TYT', label: 'TYT' },
  { value: 'AYT', label: 'AYT' },
];

/** Display labels for the five MVP study states. */
const STATUS_LABELS: Record<TopicStatus, string> = {
  not_started: 'Başlamadım',
  learning: 'Öğreniyorum',
  practice: 'Pratik',
  review: 'Tekrar',
  strong: 'Güçlü',
};

const SEARCH_EMPTY_MESSAGE = 'Aradığın ders veya konu bulunamadı.';
const DAY_IN_MS = 24 * 60 * 60 * 1000;

/** Subtle "shadow-sm" surface elevation shared by the header, search field and cards. */
const SURFACE_SHADOW: ViewStyle = {
  shadowColor: '#0F1B34',
  shadowOffset: { width: 0, height: 1 },
  shadowOpacity: 0.05,
  shadowRadius: 8,
  elevation: 1,
};

/**
 * Maps the profile score type onto a curriculum group.
 * TYT is not split by score type ("ALL"); AYT falls back to SAY when the
 * profile has no compatible score type (e.g. DIL or not completed yet).
 */
function resolveCurriculumScoreType(
  examType: ExamType,
  scoreType: ScoreType | null,
): CurriculumScoreType {
  if (examType === 'TYT') {
    return 'ALL';
  }

  if (scoreType === 'EA') {
    return 'EA';
  }

  if (scoreType === 'SOZ') {
    return 'SOZ';
  }

  return 'SAY';
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/**
 * Relative study label shown under a topic name.
 * Returns `null` when the topic has never been studied so no date text renders.
 */
function formatLastStudiedLabel(lastStudiedAt: string | null): string | null {
  if (lastStudiedAt === null) {
    return null;
  }

  const studiedAt = new Date(lastStudiedAt);
  const elapsedDays = Math.round((startOfDay(new Date()) - startOfDay(studiedAt)) / DAY_IN_MS);

  if (elapsedDays <= 0) {
    return 'Bugün çalışıldı';
  }

  if (elapsedDays === 1) {
    return 'Dün çalışıldı';
  }

  return `${elapsedDays} gün önce çalışıldı`;
}

/**
 * Turkish-aware case folding. `İ` and `I` are mapped to their Turkish lowercase
 * forms before the generic lowercasing so "IŞIK", "Işık" and "ışık" all match.
 */
function normalizeForSearch(value: string): string {
  return value.replace(/İ/g, 'i').replace(/I/g, 'ı').toLowerCase();
}

type SearchResult = {
  lessonName: string;
  topic: Topic;
};

export default function TopicsScreen() {
  const { colors } = useTheme();
  const profileScoreType = useProfileStore(profileSelectors.scoreType);

  const [examType, setExamType] = useState<ExamType>('TYT');
  const [expandedLessonId, setExpandedLessonId] = useState<string | null>(null);
  const [selection, setSelection] = useState<TopicSelection | null>(null);
  const [isSheetVisible, setSheetVisible] = useState(false);
  const [query, setQuery] = useState('');

  const lessons = useLessons(examType, resolveCurriculumScoreType(examType, profileScoreType));

  const trimmedQuery = query.trim();
  const isSearching = trimmedQuery.length > 0;

  const searchResults = useMemo(() => {
    if (!isSearching) {
      return [];
    }

    const needle = normalizeForSearch(trimmedQuery);
    const results: SearchResult[] = [];

    for (const lesson of lessons) {
      const lessonMatches = normalizeForSearch(lesson.name).includes(needle);

      for (const topic of lesson.topics) {
        if (lessonMatches || normalizeForSearch(topic.name).includes(needle)) {
          results.push({ lessonName: lesson.name, topic });
        }
      }
    }

    return results;
  }, [isSearching, lessons, trimmedQuery]);

  const handleSelectExamType = (next: ExamType) => {
    setExamType(next);
    setExpandedLessonId(null);
  };

  const handleToggleLesson = (lessonId: string) => {
    setExpandedLessonId((current) => (current === lessonId ? null : lessonId));
  };

  const handleSelectTopic = (lessonName: string, topic: Topic) => {
    setSelection({ lessonName, topicId: topic.id, topicName: topic.name });
    setSheetVisible(true);
  };

  const handleCloseSheet = () => {
    setSheetVisible(false);
  };

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

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.heading}>
          <AppText variant="title" style={styles.pageTitle}>
            Müfredat Takibi
          </AppText>
          <AppText variant="body" color="secondary">
            Konularını takip et, son çalışma tarihlerini ve tekrar durumlarını tek yerde gör.
          </AppText>
        </View>

        <View style={[styles.segment, { backgroundColor: `${colors.primary}0D` }]}>
          {EXAM_TYPE_OPTIONS.map((option) => {
            const selected = option.value === examType;

            return (
              <TouchableOpacity
                key={option.value}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                activeOpacity={0.8}
                onPress={() => handleSelectExamType(option.value)}
                style={[
                  styles.segmentItem,
                  selected && [SURFACE_SHADOW, { backgroundColor: colors.primary }],
                ]}
              >
                <AppText
                  variant="body"
                  style={[
                    styles.segmentLabel,
                    { color: selected ? colors.surface : colors.secondary },
                  ]}
                >
                  {option.label}
                </AppText>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={[styles.searchField, SURFACE_SHADOW, { backgroundColor: colors.surface }]}>
          <View style={styles.searchIcon} accessible={false} importantForAccessibility="no">
            <View style={[styles.searchLens, { borderColor: colors.secondary }]} />
            <View style={[styles.searchHandle, { backgroundColor: colors.secondary }]} />
          </View>
          <TextInput
            accessibilityLabel="Konularda ara"
            placeholder="Konularda ara..."
            placeholderTextColor={colors.secondary}
            value={query}
            onChangeText={setQuery}
            style={[styles.search, { color: colors.text }]}
          />
          {query.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Aramayı temizle"
              hitSlop={spacing.sm}
              onPress={() => setQuery('')}
              style={({ pressed }) => [styles.clearButton, pressed && styles.pressed]}
            >
              <Ionicons name="close-circle" size={20} color={colors.secondary} />
            </Pressable>
          ) : null}
        </View>

        {isSearching ? (
          searchResults.length > 0 ? (
            <View style={[styles.card, SURFACE_SHADOW, { backgroundColor: colors.surface }]}>
              {searchResults.map((result, index) => (
                <TopicRow
                  key={result.topic.id}
                  topic={result.topic}
                  lessonName={result.lessonName}
                  showLessonName
                  separated={index > 0}
                  onPress={() => handleSelectTopic(result.lessonName, result.topic)}
                />
              ))}
            </View>
          ) : (
            <View style={[styles.emptyState, SURFACE_SHADOW, { backgroundColor: colors.surface }]}>
              <AppText variant="body" color="secondary" style={styles.emptyStateText}>
                {SEARCH_EMPTY_MESSAGE}
              </AppText>
            </View>
          )
        ) : (
          <View style={styles.lessons}>
            {lessons.map((lesson) => (
              <LessonCard
                key={lesson.id}
                lesson={lesson}
                expanded={expandedLessonId === lesson.id}
                onToggle={() => handleToggleLesson(lesson.id)}
                onSelectTopic={(topic) => handleSelectTopic(lesson.name, topic)}
              />
            ))}
          </View>
        )}

        <View style={[styles.note, { backgroundColor: `${colors.primary}0D` }]}>
          <AppText variant="caption" color="secondary" style={styles.noteText}>
            Konu yeterlilik durumunuzu güncel tutarak denemelerdeki konu dağılımlarını daha berrak
            değerlendirebilirsiniz.
          </AppText>
        </View>
      </ScrollView>

      <TopicDetailSheet
        visible={isSheetVisible}
        examType={examType}
        selection={selection}
        onClose={handleCloseSheet}
      />
    </Screen>
  );
}

type LessonCardProps = {
  lesson: Lesson;
  expanded: boolean;
  onToggle: () => void;
  onSelectTopic: (topic: Topic) => void;
};

function LessonCard({ lesson, expanded, onToggle, onSelectTopic }: LessonCardProps) {
  const { colors } = useTheme();
  const progressByTopicId = useTopicStore(topicSelectors.progressByTopicId);

  const totalTopics = lesson.topics.length;
  const studiedTopics = lesson.topics.reduce((count, topic) => {
    const progress = progressByTopicId[topic.id];

    // A missing row or an explicit `not_started` state is not "studied".
    return progress && progress.status !== 'not_started' ? count + 1 : count;
  }, 0);

  return (
    <View style={[styles.card, SURFACE_SHADOW, { backgroundColor: colors.surface }]}>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        activeOpacity={0.8}
        onPress={onToggle}
        style={styles.cardHeader}
      >
        <View
          style={[styles.lessonDot, { backgroundColor: colors.primary }]}
          accessible={false}
          importantForAccessibility="no"
        />
        <View style={styles.cardTitle}>
          <AppText variant="subtitle" style={styles.lessonName}>
            {lesson.name}
          </AppText>
          <View style={[styles.countBadge, { backgroundColor: `${colors.primary}14` }]}>
            <AppText variant="caption" color="secondary">
              {studiedTopics} / {totalTopics} çalışıldı
            </AppText>
          </View>
        </View>
        <View style={styles.chevronContainer} accessible={false} importantForAccessibility="no">
          <View
            style={[
              styles.chevron,
              { borderColor: colors.secondary },
              expanded && styles.chevronExpanded,
            ]}
          />
        </View>
      </TouchableOpacity>

      {expanded ? (
        <View style={styles.topics}>
          {lesson.topics.map((topic, index) => (
            <TopicRow
              key={topic.id}
              topic={topic}
              lessonName={lesson.name}
              separated={index > 0}
              onPress={() => onSelectTopic(topic)}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

type TopicRowProps = {
  topic: Topic;
  lessonName: string;
  /** Shows the parent lesson name above the topic name (used by search results). */
  showLessonName?: boolean;
  /** Draws a top separator so consecutive rows read as distinct items. */
  separated?: boolean;
  onPress: () => void;
};

/**
 * A pressable topic row. It surfaces the topic status and last-study state so
 * an expanded lesson does not look like plain text, and always keeps a trailing
 * chevron on the right.
 */
function TopicRow({
  topic,
  lessonName,
  showLessonName = false,
  separated = false,
  onPress,
}: TopicRowProps) {
  const { colors, status } = useTheme();
  const progress = useTopicStore(topicSelectors.progressFor(topic.id));

  const topicStatus: TopicStatus = progress?.status ?? 'not_started';
  const statusLabel = STATUS_LABELS[topicStatus];
  const lastStudiedLabel = formatLastStudiedLabel(progress?.lastStudiedAt ?? null);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${topic.name}, durum: ${statusLabel}${
        lastStudiedLabel ? `, ${lastStudiedLabel}` : ''
      }`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.topicRow,
        separated && [styles.topicRowSeparated, { borderTopColor: colors.border }],
        pressed && { backgroundColor: `${colors.primary}0D` },
      ]}
    >
      <View style={styles.topicRowMain}>
        {showLessonName ? (
          <AppText variant="caption" color="secondary" numberOfLines={1}>
            {lessonName}
          </AppText>
        ) : null}
        <AppText variant="body" numberOfLines={2} style={styles.topicName}>
          {topic.name}
        </AppText>
        {lastStudiedLabel ? (
          <AppText variant="caption" color="secondary" numberOfLines={1}>
            {lastStudiedLabel}
          </AppText>
        ) : null}
      </View>

      <View style={[styles.statusPill, { backgroundColor: `${status[topicStatus]}1A` }]}>
        <View style={[styles.statusDot, { backgroundColor: status[topicStatus] }]} />
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
  segment: {
    flexDirection: 'row',
    gap: spacing.xs,
    padding: spacing.xs,
    borderRadius: spacing.xl,
    marginBottom: spacing.md,
  },
  segmentItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: spacing.xl,
  },
  segmentLabel: {
    fontWeight: typography.subtitle.fontWeight,
  },
  searchField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: spacing.xxl,
    borderRadius: spacing.xl,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  searchIcon: {
    width: spacing.lg,
    height: spacing.lg,
  },
  searchLens: {
    position: 'absolute',
    top: 3,
    left: 2,
    width: 14,
    height: 14,
    borderWidth: 2,
    borderRadius: 7,
  },
  searchHandle: {
    position: 'absolute',
    top: 16,
    left: 13,
    width: 8,
    height: 2,
    borderRadius: 1,
    transform: [{ rotate: '45deg' }],
  },
  search: {
    ...typography.body,
    flex: 1,
    minWidth: 0,
    paddingVertical: spacing.xs,
    paddingHorizontal: 0,
  },
  clearButton: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  lessons: {
    gap: spacing.md,
  },
  card: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  lessonDot: {
    width: spacing.sm,
    height: spacing.sm,
    borderRadius: spacing.xs,
  },
  cardTitle: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
  },
  lessonName: {
    flexShrink: 1,
  },
  countBadge: {
    borderRadius: spacing.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs / 2,
  },
  chevronContainer: {
    width: spacing.lg,
    height: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chevron: {
    width: spacing.sm,
    height: spacing.sm,
    borderBottomWidth: 2,
    borderRightWidth: 2,
    transform: [{ rotate: '45deg' }],
  },
  chevronExpanded: {
    transform: [{ rotate: '225deg' }],
  },
  topics: {
    paddingBottom: spacing.xs,
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
  },
  statusDot: {
    width: spacing.sm,
    height: spacing.sm,
    borderRadius: spacing.xs,
  },
  statusPillLabel: {
    fontWeight: typography.subtitle.fontWeight,
  },
  emptyState: {
    borderRadius: 12,
    padding: spacing.lg,
  },
  emptyStateText: {
    textAlign: 'center',
  },
  note: {
    marginTop: spacing.md,
    borderRadius: 12,
    padding: spacing.md,
  },
  noteText: {
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
});
