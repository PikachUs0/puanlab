import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components';
import { topicSelectors, useTopicStore } from '@/store';
import { spacing, typography, useTheme } from '@/theme';
import type { ExamType, TopicStatus } from '@/types';

import { useTopicProgressActions } from './topicProgressHooks';

/** The five permitted MVP study states, in design order. */
const STATUS_OPTIONS: readonly { value: TopicStatus; label: string }[] = [
  { value: 'not_started', label: 'Başlamadım' },
  { value: 'learning', label: 'Öğreniyorum' },
  { value: 'practice', label: 'Pratik' },
  { value: 'review', label: 'Tekrar' },
  { value: 'strong', label: 'Güçlü' },
];

const TR_MONTHS: readonly string[] = [
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
];

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const FEEDBACK_DURATION_MS = 2500;
const STUDIED_FEEDBACK = 'Çalışma tarihi güncellendi.';

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Formats a stored ISO `lastStudiedAt` for display, e.g. "3 gün önce · 14 Ekim". */
function formatLastStudied(lastStudiedAt: string | null): string {
  if (lastStudiedAt === null) {
    return 'Henüz çalışılmadı';
  }

  const studiedAt = new Date(lastStudiedAt);
  const elapsedDays = Math.round((startOfDay(new Date()) - startOfDay(studiedAt)) / DAY_IN_MS);
  const dateLabel = `${studiedAt.getDate()} ${TR_MONTHS[studiedAt.getMonth()]}`;

  if (elapsedDays <= 0) {
    return 'Bugün';
  }

  if (elapsedDays === 1) {
    return `Dün · ${dateLabel}`;
  }

  return `${elapsedDays} gün önce · ${dateLabel}`;
}

export type TopicSelection = {
  lessonName: string;
  topicId: string;
  topicName: string;
};

export type TopicDetailSheetProps = {
  visible: boolean;
  examType: ExamType;
  /** Retained while the sheet animates out so the content does not flicker. */
  selection: TopicSelection | null;
  onClose: () => void;
};

/**
 * Topic detail sheet. Status, note and study-date changes are written through
 * the topic progress actions, which keep an in-memory store and the SQLite
 * repository in sync.
 */
export function TopicDetailSheet({ visible, examType, selection, onClose }: TopicDetailSheetProps) {
  const { colors, scheme } = useTheme();
  const insets = useSafeAreaInsets();

  /**
   * The scrim has to stay dark in both colour schemes, so it is derived from the
   * darkest token of the active scheme instead of a hardcoded colour.
   */
  const scrimColor = scheme === 'dark' ? `${colors.background}80` : `${colors.text}80`;

  return (
    <Modal
      visible={visible && selection !== null}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={[styles.overlay, { backgroundColor: scrimColor }]}>
        <Pressable
          style={styles.backdrop}
          accessibilityRole="button"
          accessibilityLabel="Kapat"
          onPress={onClose}
        />
        {selection ? (
          <TopicDetailContent
            examType={examType}
            selection={selection}
            bottomInset={insets.bottom}
            onClose={onClose}
          />
        ) : null}
      </View>
    </Modal>
  );
}

type TopicDetailContentProps = {
  examType: ExamType;
  selection: TopicSelection;
  bottomInset: number;
  onClose: () => void;
};

function TopicDetailContent({
  examType,
  selection,
  bottomInset,
  onClose,
}: TopicDetailContentProps) {
  const { colors, status } = useTheme();

  const progress = useTopicStore(topicSelectors.progressFor(selection.topicId));
  const { setStatus, setNote, markStudiedToday } = useTopicProgressActions(selection.topicId);

  const [feedback, setFeedback] = useState<string | null>(null);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (feedbackTimer.current !== null) {
        clearTimeout(feedbackTimer.current);
      }
    },
    [],
  );

  const currentStatus: TopicStatus = progress?.status ?? 'not_started';
  const currentNote = progress?.note ?? null;
  const lastStudiedAt = progress?.lastStudiedAt ?? null;

  const handleNoteChange = (value: string) => {
    setNote(value.length === 0 ? null : value);
  };

  const handleStudiedToday = () => {
    markStudiedToday();
    setFeedback(STUDIED_FEEDBACK);

    if (feedbackTimer.current !== null) {
      clearTimeout(feedbackTimer.current);
    }

    feedbackTimer.current = setTimeout(() => {
      setFeedback(null);
      feedbackTimer.current = null;
    }, FEEDBACK_DURATION_MS);
  };

  const currentStatusLabel =
    STATUS_OPTIONS.find((option) => option.value === currentStatus)?.label ?? 'Başlamadım';

  return (
    <View style={[styles.sheet, { backgroundColor: colors.surface, shadowColor: colors.text }]}>
      <View style={styles.handleArea} accessible={false} importantForAccessibility="no">
        <View style={[styles.handle, { backgroundColor: `${colors.border}B3` }]} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: spacing.lg + bottomInset }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerRow}>
          <View style={styles.headerText}>
            <AppText variant="caption" color="secondary" style={styles.eyebrow}>
              {selection.lessonName} · {examType}
            </AppText>
            <AppText variant="subtitle" numberOfLines={1}>
              {selection.topicName}
            </AppText>
            <View style={[styles.statusPill, { backgroundColor: `${colors.primary}14` }]}>
              <View style={[styles.statusDot, { backgroundColor: status[currentStatus] }]} />
              <AppText variant="caption" color="secondary">
                Mevcut Durum:
              </AppText>
              <AppText variant="caption" style={[styles.statusValue, { color: colors.text }]}>
                {currentStatusLabel}
              </AppText>
            </View>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Kapat"
            onPress={onClose}
            style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
          >
            <Ionicons name="close" size={20} color={colors.secondary} />
          </Pressable>
        </View>

        <View style={styles.field}>
          <AppText variant="caption" color="secondary" style={styles.fieldLabel}>
            Çalışma Durumu
          </AppText>
          <View style={styles.statusGrid}>
            {STATUS_OPTIONS.map((option) => {
              const selected = option.value === currentStatus;

              return (
                <Pressable
                  key={option.value}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  onPress={() => setStatus(option.value)}
                  style={[
                    styles.statusOption,
                    { backgroundColor: selected ? colors.primary : `${colors.primary}0D` },
                  ]}
                >
                  <AppText
                    variant="caption"
                    style={[
                      styles.statusOptionLabel,
                      { color: selected ? colors.surface : colors.secondary },
                    ]}
                  >
                    {option.label}
                  </AppText>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.field}>
          <AppText variant="caption" color="secondary" style={styles.fieldLabel}>
            Kişisel Not
          </AppText>
          <TextInput
            accessibilityLabel="Kişisel Not"
            value={currentNote ?? ''}
            onChangeText={handleNoteChange}
            placeholder="Bu konu hakkında özel notun..."
            placeholderTextColor={colors.secondary}
            multiline
            textAlignVertical="top"
            style={[styles.note, { backgroundColor: `${colors.primary}0D`, color: colors.text }]}
          />
        </View>

        <View style={styles.actions}>
          <View style={[styles.lastStudied, { backgroundColor: `${colors.primary}0D` }]}>
            <View style={styles.lastStudiedLabel}>
              <Ionicons name="time-outline" size={18} color={colors.secondary} />
              <AppText variant="caption" color="secondary" style={styles.fieldLabel}>
                Son Çalışma
              </AppText>
            </View>
            <AppText variant="caption" style={[styles.lastStudiedValue, { color: colors.text }]}>
              {formatLastStudied(lastStudiedAt)}
            </AppText>
          </View>

          <Pressable
            accessibilityRole="button"
            onPress={handleStudiedToday}
            style={({ pressed }) => [
              styles.primaryButton,
              { backgroundColor: colors.primary },
              pressed && styles.pressed,
            ]}
          >
            <Ionicons name="checkmark-circle" size={20} color={colors.surface} />
            <AppText variant="body" style={[styles.primaryButtonLabel, { color: colors.surface }]}>
              Bugün Çalıştım
            </AppText>
          </Pressable>

          {feedback ? (
            <AppText
              variant="caption"
              accessibilityLiveRegion="polite"
              style={[styles.feedback, { color: colors.primary }]}
            >
              {feedback}
            </AppText>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    flex: 1,
  },
  sheet: {
    maxHeight: '90%',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: spacing.sm,
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 12,
  },
  handleArea: {
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
  },
  body: {
    gap: spacing.lg,
    paddingTop: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
  eyebrow: {
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs,
    marginTop: spacing.xs,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  statusDot: {
    width: spacing.sm,
    height: spacing.sm,
    borderRadius: spacing.xs,
  },
  statusValue: {
    fontWeight: typography.subtitle.fontWeight,
  },
  closeButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
  },
  field: {
    gap: spacing.xs,
  },
  fieldLabel: {
    fontWeight: typography.subtitle.fontWeight,
    letterSpacing: 0.2,
  },
  statusGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  statusOption: {
    width: '31%',
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    paddingHorizontal: spacing.xs,
  },
  statusOptionLabel: {
    textAlign: 'center',
    fontWeight: typography.subtitle.fontWeight,
  },
  note: {
    ...typography.body,
    minHeight: 96,
    borderRadius: 12,
    padding: spacing.md,
  },
  actions: {
    gap: spacing.md,
    paddingTop: spacing.xs,
  },
  lastStudied: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  lastStudiedLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  lastStudiedValue: {
    fontWeight: typography.subtitle.fontWeight,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: 48,
    borderRadius: 12,
  },
  primaryButtonLabel: {
    fontWeight: typography.subtitle.fontWeight,
  },
  feedback: {
    textAlign: 'center',
    fontWeight: typography.subtitle.fontWeight,
  },
  pressed: {
    opacity: 0.9,
  },
});
