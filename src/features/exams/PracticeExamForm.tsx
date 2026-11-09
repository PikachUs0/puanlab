import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Crypto from 'expo-crypto';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState, type ComponentProps } from 'react';
import {
  Alert,
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { AppText, Screen } from '@/components';
import { profileSelectors, useProfileStore } from '@/store';
import { spacing, typography, useTheme } from '@/theme';
import type { ExamType, PracticeExam, ScoreType } from '@/types';

import {
  DIL_AYT_UNAVAILABLE_MESSAGE,
  EXAM_FORM_ISSUE_MESSAGES,
  EXAM_NAME_MAX_LENGTH,
  availableExamTypes,
  buildExamUpdate,
  buildPracticeExam,
  bumpLessonCount,
  changeDate,
  changeExamType,
  changeLessonCount,
  changeName,
  createEditBaseline,
  createEditFormState,
  createFormBaseline,
  createInitialFormState,
  formatExamDateForDisplay,
  formatNetForDisplay,
  hasEditMeaningfulChanges,
  hasMeaningfulChanges,
  parseExamDate,
  toLocalDateIso,
  validateExamForm,
  type ExamFormCountField,
  type ExamFormState,
  type ExamLessonValidation,
} from './examForm';
import { getExamTotalQuestionCount } from './examDefinitions';
import { useExamPersistenceActions } from './examHooks';

/** The two steps of the form, sharing a single route in both modes. */
type FormStep = 1 | 2;

const EXAM_TYPE_OPTIONS: readonly {
  value: ExamType;
  label: string;
  detail: string;
}[] = [
  { value: 'TYT', label: 'TYT', detail: 'Temel Yeterlilik' },
  { value: 'AYT', label: 'AYT', detail: 'Alan Yeterlilik' },
];

const SAVE_ERROR_MESSAGE = 'Deneme kaydedilemedi. Bilgilerin korundu, lütfen tekrar dene.';

/** Subtle "shadow-sm" surface elevation shared by the header, cards and buttons. */
const SURFACE_SHADOW: ViewStyle = {
  shadowColor: '#0F1B34',
  shadowOffset: { width: 0, height: 1 },
  shadowOpacity: 0.05,
  shadowRadius: 8,
  elevation: 1,
};

/**
 * The shared practice-exam form, used by both `/exam/add` (create) and
 * `/exam/{id}/edit` (edit). The two-step flow, section inputs, validation,
 * calculations, date rules, accessibility behaviour and unsaved-change guard
 * are identical in both modes; only the source and destination of the record
 * differ.
 */
export type PracticeExamFormProps =
  | { mode: 'create' }
  | { mode: 'edit'; exam: PracticeExam };

export function PracticeExamForm(props: PracticeExamFormProps) {
  const editingExam = props.mode === 'edit' ? props.exam : null;
  const { colors } = useTheme();
  const router = useRouter();

  const profileScoreType = useProfileStore(profileSelectors.scoreType);
  const { createExam, updateExam } = useExamPersistenceActions();

  // Edit mode always resolves the official lesson structure from the record's
  // frozen snapshot, never from the profile's current score type.
  const scoreType: ScoreType | null = editingExam
    ? editingExam.scoreTypeSnapshot
    : profileScoreType;

  // A single reference day for defaults and the "no future dates" rule.
  const now = useMemo(() => new Date(), []);

  const createBaseline = useMemo(
    () => (editingExam ? null : createFormBaseline(profileScoreType, now)),
    [editingExam, profileScoreType, now],
  );
  const editBaseline = useMemo(
    () => (editingExam ? createEditBaseline(editingExam) : null),
    [editingExam],
  );

  const [step, setStep] = useState<FormStep>(1);
  const [form, setForm] = useState<ExamFormState>(() =>
    editingExam ? createEditFormState(editingExam) : createInitialFormState(profileScoreType, now),
  );
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  /** TEMPORARY dev-only diagnostic: the full error text behind a save failure. */
  const [technicalError, setTechnicalError] = useState<string | null>(null);

  const validation = useMemo(() => validateExamForm(form, scoreType, now), [form, scoreType, now]);

  const examTypes = useMemo(() => availableExamTypes(scoreType), [scoreType]);
  const totalQuestionCount = scoreType ? getExamTotalQuestionCount(form.examType, scoreType) : 0;

  const nameError = validation.issues.includes('name_empty')
    ? EXAM_FORM_ISSUE_MESSAGES.name_empty
    : validation.issues.includes('name_too_long')
      ? EXAM_FORM_ISSUE_MESSAGES.name_too_long
      : null;

  const dateError = validation.issues.includes('date_invalid')
    ? EXAM_FORM_ISSUE_MESSAGES.date_invalid
    : validation.issues.includes('date_future')
      ? EXAM_FORM_ISSUE_MESSAGES.date_future
      : null;

  const scoreTypeError = validation.issues.includes('no_score_type')
    ? EXAM_FORM_ISSUE_MESSAGES.no_score_type
    : validation.issues.includes('exam_type_unavailable')
      ? EXAM_FORM_ISSUE_MESSAGES.exam_type_unavailable
      : null;

  /**
   * Whether leaving now would discard unsaved work. Create mode compares against
   * a fresh form; edit mode compares against the loaded record, so simply opening
   * an exam and leaving never prompts.
   */
  const isDirty = useMemo(() => {
    if (editBaseline) {
      return hasEditMeaningfulChanges(form, editBaseline);
    }

    if (createBaseline) {
      return hasMeaningfulChanges(form, createBaseline);
    }

    return false;
  }, [form, editBaseline, createBaseline]);

  /** Leaves the route; used by the header back button and the discard action. */
  const closeRoute = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }

    // Deep-linked straight here: fall back to the Exams tab.
    router.replace('/exams');
  }, [router]);

  /**
   * Single exit path for both the header back button and Android hardware back:
   * step 2 returns to step 1, an untouched form closes the route, and a form
   * holding changes asks before discarding them.
   */
  const requestClose = useCallback(() => {
    if (isSaving) {
      return;
    }

    if (step === 2) {
      setStep(1);
      return;
    }

    if (!isDirty) {
      closeRoute();
      return;
    }

    Alert.alert('Denemeden çıkılsın mı?', 'Girdiğin bilgiler kaydedilmeyecek.', [
      { text: 'Devam Et', style: 'cancel' },
      { text: 'Çık', style: 'destructive', onPress: closeRoute },
    ]);
  }, [isSaving, step, isDirty, closeRoute]);

  // Android hardware back must follow the same rule instead of popping the route.
  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        requestClose();

        return true;
      });

      return () => subscription.remove();
    }, [requestClose]),
  );

  const handleExamTypeChange = useCallback(
    (examType: ExamType) => {
      setForm((current) => changeExamType(current, examType, scoreType));
    },
    [scoreType],
  );

  const handleNameChange = useCallback((name: string) => {
    setForm((current) => changeName(current, name));
  }, []);

  const handleDateChange = useCallback((event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === 'android') {
      setIsDatePickerOpen(false);
    }

    if (event.type !== 'set' || !selected) {
      return;
    }

    setForm((current) => changeDate(current, toLocalDateIso(selected)));
  }, []);

  const handleCountChange = useCallback(
    (lessonId: string, field: ExamFormCountField, text: string) => {
      setForm((current) => changeLessonCount(current, lessonId, field, text));
    },
    [],
  );

  const handleCountBump = useCallback(
    (lessonId: string, field: ExamFormCountField, delta: 1 | -1, questionCount: number) => {
      setForm((current) => bumpLessonCount(current, lessonId, field, delta, questionCount));
    },
    [],
  );

  const handleSave = useCallback(async () => {
    if (isSaving || scoreType === null || !validation.canSave) {
      return;
    }

    const exam = editingExam
      ? buildExamUpdate({ form, exam: editingExam, now: new Date() })
      : buildPracticeExam({ form, scoreType, id: Crypto.randomUUID(), now: new Date() });

    if (exam === null) {
      return;
    }

    const logPrefix = editingExam ? '[EditExam]' : '[AddExam]';

    if (__DEV__) {
      console.log(`${logPrefix} exam built`);
    }

    setIsSaving(true);
    setSaveError(null);
    setTechnicalError(null);

    // Persistence and navigation are handled in separate steps: once the exam
    // is written, a navigation problem must never be reported as a save
    // failure. Only a real write failure shows the save error message.
    try {
      if (__DEV__) {
        console.log(`${logPrefix} repository write started`);
      }

      if (editingExam) {
        await updateExam(exam);
      } else {
        await createExam(exam);
      }

      if (__DEV__) {
        console.log(`${logPrefix} repository write completed`);
        console.log(`${logPrefix} store updated`);
      }
    } catch (error) {
      if (__DEV__) {
        console.error(`${logPrefix} Save failed`, error);
      }

      setSaveError(SAVE_ERROR_MESSAGE);

      if (__DEV__) {
        // TEMPORARY diagnostic: surface the complete technical error so it can
        // be read on-device. Never shown in production.
        const technicalMessage =
          error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        setTechnicalError(technicalMessage);
      }

      setIsSaving(false);
      return;
    }

    if (__DEV__) {
      console.log(`${logPrefix} navigation started`);
    }

    try {
      if (editingExam) {
        // Return to the existing detail route for the same id.
        if (router.canGoBack()) {
          router.back();
        } else {
          router.replace({ pathname: '/exam/[id]', params: { id: editingExam.id } });
        }
      } else {
        // The store already holds the new exam, so the Denemeler tab shows it.
        router.navigate('/exams');
      }
    } catch (error) {
      // The exam is already saved; a navigation error must not undo that.
      if (__DEV__) {
        console.error(`${logPrefix} Navigation failed after a successful save`, error);
      }
    }
  }, [isSaving, scoreType, validation.canSave, form, editingExam, createExam, updateExam, router]);

  const pickerValue = parseExamDate(form.date) ?? now;

  return (
    <Screen>
      <View style={[styles.header, SURFACE_SHADOW, { backgroundColor: colors.surface }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Geri"
          accessibilityHint={
            editingExam ? 'Deneme düzenleme formundan çıkar' : 'Deneme ekleme formundan çıkar'
          }
          onPress={requestClose}
          style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}
        >
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </Pressable>

        <AppText variant="subtitle" style={styles.headerTitle} numberOfLines={1}>
          {editingExam ? 'Deneme Düzenle' : 'Deneme Ekle'}
        </AppText>
      </View>

      <StepIndicator step={step} />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          {step === 1 ? (
            <>
              {editingExam ? (
                <View style={styles.intro}>
                  <View accessible accessibilityLabel={`Deneme düzenleniyor: ${editingExam.name}`}>
                    <AppText variant="caption" color="secondary">
                      Deneme düzenleniyor
                    </AppText>
                    <AppText variant="title" style={styles.introTitle} numberOfLines={2}>
                      {editingExam.name}
                    </AppText>
                  </View>
                  <AppText variant="body" color="secondary">
                    Kaydettiğinde aynı deneme güncellenir. Ders bazlı doğru ve yanlış sayılarını
                    düzenleyebilirsin.
                  </AppText>
                </View>
              ) : (
                <View style={styles.intro}>
                  <AppText variant="caption" color="secondary">
                    Yeni Kayıt
                  </AppText>
                  <AppText variant="title" style={styles.introTitle}>
                    Sınav Verilerini Girin
                  </AppText>
                  <AppText variant="body" color="secondary">
                    Deneme sonucunu ders bazlı doğru ve yanlış sayılarıyla arşivle.
                  </AppText>
                </View>
              )}

              <View style={[styles.card, SURFACE_SHADOW, { backgroundColor: colors.surface }]}>
                <View style={styles.field}>
                  <AppText variant="caption" color="secondary" style={styles.fieldLabel}>
                    Sınav Türü
                  </AppText>

                  {editingExam ? (
                    <View
                      style={[
                        styles.fixedTypeField,
                        SURFACE_ELEVATION,
                        { backgroundColor: colors.background, borderColor: colors.border },
                      ]}
                      accessible
                      accessibilityLabel={`Sınav türü: ${form.examType}. Düzenlemede değiştirilemez.`}
                    >
                      <Ionicons name="lock-closed-outline" size={18} color={colors.secondary} />
                      <View style={styles.fixedTypeText}>
                        <AppText variant="body" style={styles.strongCaption}>
                          {form.examType}
                        </AppText>
                        <AppText variant="caption" color="secondary" numberOfLines={2}>
                          {EXAM_TYPE_OPTIONS.find((option) => option.value === form.examType)
                            ?.detail ?? ''}
                        </AppText>
                      </View>
                    </View>
                  ) : examTypes.length === 0 ? (
                    <View style={styles.emptyOptions}>
                      <AppText variant="body" color="secondary">
                        Deneme türü seçilemiyor.
                      </AppText>
                    </View>
                  ) : (
                    <View style={[styles.segmentedTrack, { backgroundColor: colors.background }]}>
                      {EXAM_TYPE_OPTIONS.filter((option) => examTypes.includes(option.value)).map(
                        (option) => {
                          const isActive = form.examType === option.value;

                          return (
                            <Pressable
                              key={option.value}
                              accessibilityRole="button"
                              accessibilityState={{ selected: isActive }}
                              accessibilityLabel={`${option.label} (${option.detail})`}
                              accessibilityHint="Deneme türünü seçer"
                              onPress={() => handleExamTypeChange(option.value)}
                              style={({ pressed }) => [
                                styles.segment,
                                isActive && [SURFACE_SHADOW, { backgroundColor: colors.surface }],
                                pressed && styles.pressed,
                              ]}
                            >
                              <AppText
                                variant="body"
                                color={isActive ? 'primary' : 'secondary'}
                                style={styles.segmentLabel}
                              >
                                {option.label}
                              </AppText>
                              <AppText
                                variant="caption"
                                color={isActive ? 'primary' : 'secondary'}
                                numberOfLines={2}
                                style={styles.segmentDetail}
                              >
                                {option.detail}
                              </AppText>
                            </Pressable>
                          );
                        },
                      )}
                    </View>
                  )}

                  {!editingExam && scoreType === 'DIL' ? (
                    <InlineMessage icon="information-circle" message={DIL_AYT_UNAVAILABLE_MESSAGE} />
                  ) : null}

                  {scoreTypeError ? (
                    <InlineMessage icon="alert-circle" message={scoreTypeError} />
                  ) : null}
                </View>

                <View style={styles.field}>
                  <AppText variant="caption" color="secondary" style={styles.fieldLabel}>
                    Deneme Adı / Yayın
                  </AppText>

                  <TextInput
                    value={form.name}
                    onChangeText={handleNameChange}
                    placeholder="Örn: Özdebir TYT 2"
                    placeholderTextColor={colors.secondary}
                    maxLength={EXAM_NAME_MAX_LENGTH}
                    accessibilityLabel="Deneme adı"
                    accessibilityHint="Denemeye vermek istediğin adı yaz"
                    style={[
                      styles.textInput,
                      SURFACE_ELEVATION,
                      {
                        backgroundColor: colors.background,
                        borderColor: colors.border,
                        color: colors.text,
                      },
                    ]}
                  />

                  {nameError ? <InlineMessage icon="alert-circle" message={nameError} /> : null}
                </View>

                <View style={styles.field}>
                  <AppText variant="caption" color="secondary" style={styles.fieldLabel}>
                    Uygulama Tarihi
                  </AppText>

                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Uygulama tarihi"
                    accessibilityValue={{ text: formatExamDateForDisplay(form.date) }}
                    accessibilityHint="Tarih seçiciyi açar"
                    onPress={() => setIsDatePickerOpen(true)}
                    style={({ pressed }) => [
                      styles.dateField,
                      SURFACE_ELEVATION,
                      {
                        backgroundColor: colors.background,
                        borderColor: colors.border,
                      },
                      pressed && styles.pressed,
                    ]}
                  >
                    <Ionicons name="calendar-outline" size={20} color={colors.secondary} />
                    <AppText variant="body" style={styles.dateValue} numberOfLines={1}>
                      {formatExamDateForDisplay(form.date)}
                    </AppText>
                    <Ionicons name="chevron-down" size={18} color={colors.secondary} />
                  </Pressable>

                  {dateError ? <InlineMessage icon="alert-circle" message={dateError} /> : null}
                </View>
              </View>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Sonraki adım"
                accessibilityHint="Ders sonuçlarını girmek için ilerler"
                accessibilityState={{ disabled: !validation.canProceed }}
                disabled={!validation.canProceed}
                onPress={() => setStep(2)}
                style={({ pressed }) => [
                  styles.primaryButton,
                  SURFACE_SHADOW,
                  { backgroundColor: colors.primary },
                  !validation.canProceed && styles.disabled,
                  pressed && styles.pressed,
                ]}
              >
                <AppText variant="body" style={[styles.primaryButtonLabel, { color: colors.surface }]}>
                  Sonraki Adım
                </AppText>
                <Ionicons name="arrow-forward" size={20} color={colors.surface} />
              </Pressable>
            </>
          ) : (
            <>
              <View style={[styles.summaryCard, SURFACE_SHADOW, { backgroundColor: colors.background }]}>
                <View style={styles.summaryTopRow}>
                  <AppText variant="caption" color="secondary">
                    Genel Performans Özeti
                  </AppText>
                  <AppText variant="caption" color="primary" style={styles.strongCaption}>
                    {totalQuestionCount} Soru
                  </AppText>
                </View>

                <View style={styles.summaryBody}>
                  <View style={styles.summaryNet}>
                    <AppText variant="caption" color="secondary">
                      Hesaplanan Toplam Net
                    </AppText>
                    <AppText variant="title" style={styles.summaryNetValue}>
                      {formatNetForDisplay(validation.totals.totalNet)}
                    </AppText>
                  </View>

                  <View style={styles.summaryColumns}>
                    <SummaryColumn label="Doğru" value={validation.totals.totalCorrect} />
                    <SummaryColumn label="Yanlış" value={validation.totals.totalIncorrect} />
                    <SummaryColumn label="Boş" value={validation.totals.totalBlank} />
                  </View>
                </View>

                {validation.issues.includes('lesson_invalid') ? (
                  <InlineMessage icon="alert-circle" message={EXAM_FORM_ISSUE_MESSAGES.lesson_invalid} />
                ) : null}
              </View>

              <View style={styles.lessonSection}>
                <View style={styles.lessonSectionHeader}>
                  <AppText variant="body" style={styles.strongCaption}>
                    Ders Dağılımı
                  </AppText>
                  <AppText variant="caption" color="secondary">
                    {validation.lessons.length} Ders
                  </AppText>
                </View>

                {validation.lessons.map((lesson) => (
                  <LessonResultCard
                    key={lesson.lessonId}
                    lesson={lesson}
                    onCountChange={handleCountChange}
                    onCountBump={handleCountBump}
                  />
                ))}
              </View>

              <View style={styles.actions}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Önceki adım"
                  accessibilityHint="Temel bilgiler adımına döner"
                  onPress={() => setStep(1)}
                  style={({ pressed }) => [
                    styles.secondaryButton,
                    { borderColor: colors.border },
                    pressed && styles.pressed,
                  ]}
                >
                  <Ionicons name="arrow-back" size={20} color={colors.secondary} />
                  <AppText variant="body" color="secondary" style={styles.primaryButtonLabel}>
                    Geri
                  </AppText>
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={editingExam ? 'Değişiklikleri Kaydet' : 'Denemeyi Kaydet'}
                  accessibilityHint={
                    editingExam
                      ? 'Denemeyi günceller ve deneme detayına döner'
                      : 'Denemeyi kaydeder ve Denemeler sekmesine döner'
                  }
                  accessibilityState={{ disabled: !validation.canSave || isSaving }}
                  disabled={!validation.canSave || isSaving}
                  onPress={handleSave}
                  style={({ pressed }) => [
                    styles.primaryButton,
                    SURFACE_SHADOW,
                    { backgroundColor: colors.primary },
                    (!validation.canSave || isSaving) && styles.disabled,
                    pressed && styles.pressed,
                  ]}
                >
                  <Ionicons
                    name={isSaving ? 'hourglass-outline' : 'save-outline'}
                    size={20}
                    color={colors.surface}
                  />
                  <AppText variant="body" style={[styles.primaryButtonLabel, { color: colors.surface }]}>
                    {isSaving ? 'Kaydediliyor...' : editingExam ? 'Değişiklikleri Kaydet' : 'Denemeyi Kaydet'}
                  </AppText>
                </Pressable>

                {saveError ? <InlineMessage icon="alert-circle" message={saveError} /> : null}

                {__DEV__ && technicalError ? (
                  <InlineMessage icon="bug-outline" message={`Teknik hata: ${technicalError}`} />
                ) : null}

                <AppText variant="caption" color="secondary" style={styles.note}>
                  Net hesabı: Doğru - (Yanlış / 4) kuralına göre otomatik uygulanır.
                </AppText>
              </View>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {isDatePickerOpen ? (
        <DateTimePicker
          value={pickerValue}
          mode="date"
          display="default"
          maximumDate={now}
          onChange={handleDateChange}
        />
      ) : null}
    </Screen>
  );
}

type StepIndicatorProps = {
  step: FormStep;
};

/** Shows which of the two steps is active. Step numbers carry the meaning. */
function StepIndicator({ step }: StepIndicatorProps) {
  const { colors } = useTheme();

  const steps: readonly { value: FormStep; label: string }[] = [
    { value: 1, label: 'Temel Bilgiler' },
    { value: 2, label: 'Ders Sonuçları' },
  ];

  return (
    <View
      style={[styles.stepBar, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}
      accessible
      accessibilityLabel={`Adım ${step} / 2: ${steps[step - 1].label}`}
    >
      {steps.map((entry) => {
        const isActive = entry.value === step;

        return (
          <View
            key={entry.value}
            style={[
              styles.stepPill,
              { borderColor: isActive ? colors.primary : colors.border },
              isActive && { backgroundColor: `${colors.primary}14` },
            ]}
          >
            <AppText
              variant="caption"
              color={isActive ? 'primary' : 'secondary'}
              style={styles.strongCaption}
            >
              {entry.value}
            </AppText>
            <AppText
              variant="caption"
              color={isActive ? 'primary' : 'secondary'}
              numberOfLines={1}
              style={styles.stepLabel}
            >
              {entry.label}
            </AppText>
          </View>
        );
      })}
    </View>
  );
}

type SummaryColumnProps = {
  label: string;
  value: number;
};

function SummaryColumn({ label, value }: SummaryColumnProps) {
  return (
    <View style={styles.summaryColumn}>
      <AppText variant="caption" color="secondary">
        {label}
      </AppText>
      <AppText variant="body" style={styles.strongCaption}>
        {value}
      </AppText>
    </View>
  );
}

type InlineMessageProps = {
  icon: ComponentProps<typeof Ionicons>['name'];
  message: string;
};

/**
 * Validation and information text. The icon carries the meaning, so the message
 * never depends on colour alone; both use theme tokens for light/dark contrast.
 */
function InlineMessage({ icon, message }: InlineMessageProps) {
  const { colors } = useTheme();

  return (
    <View style={styles.messageRow} accessible accessibilityLabel={message}>
      <Ionicons name={icon} size={16} color={colors.text} style={styles.messageIcon} />
      <AppText variant="caption" style={styles.messageText}>
        {message}
      </AppText>
    </View>
  );
}

type LessonResultCardProps = {
  lesson: ExamLessonValidation;
  onCountChange: (lessonId: string, field: ExamFormCountField, text: string) => void;
  onCountBump: (
    lessonId: string,
    field: ExamFormCountField,
    delta: 1 | -1,
    questionCount: number,
  ) => void;
};

/**
 * One exam section: the official name and question count come from the central
 * definition, blank and net are derived read-only values, and correct/incorrect
 * support both direct numeric entry and clamped ± controls.
 */
function LessonResultCard({ lesson, onCountChange, onCountBump }: LessonResultCardProps) {
  const { colors } = useTheme();
  const isValid = lesson.validation.valid;
  const correctText = lesson.draft.correctText;
  const incorrectText = lesson.draft.incorrectText;

  return (
    <View style={[styles.lessonCard, SURFACE_SHADOW, { backgroundColor: colors.surface }]}>
      <View style={styles.lessonHeader}>
        <View style={styles.lessonIdentity}>
          <View style={[styles.lessonIcon, { backgroundColor: `${colors.primary}14` }]}>
            <Ionicons name="book-outline" size={18} color={colors.primary} />
          </View>
          <View style={styles.lessonNames}>
            <AppText variant="body" style={styles.strongCaption}>
              {lesson.name}
            </AppText>
            <AppText variant="caption" color="secondary">
              {lesson.questionCount} Soru
            </AppText>
          </View>
        </View>

        <View style={[styles.netBlock, { backgroundColor: colors.background }]}>
          <AppText variant="caption" color="secondary">
            Ders Neti
          </AppText>
          <AppText variant="body" color="primary" style={styles.strongCaption}>
            {isValid ? formatNetForDisplay(lesson.validation.net) : '-'}
          </AppText>
        </View>
      </View>

      <CountStepper
        lessonName={lesson.name}
        field="correct"
        label="Doğru"
        value={correctText}
        onChange={onCountChange}
        onBump={onCountBump}
        questionCount={lesson.questionCount}
        lessonId={lesson.lessonId}
      />

      <CountStepper
        lessonName={lesson.name}
        field="incorrect"
        label="Yanlış"
        value={incorrectText}
        onChange={onCountChange}
        onBump={onCountBump}
        questionCount={lesson.questionCount}
        lessonId={lesson.lessonId}
      />

      <ReadOnlyCount
        label="Boş"
        value={isValid ? String(lesson.validation.blank) : '-'}
        accessibilityLabel={`${lesson.name} boş soru sayısı`}
      />

      {!isValid ? <InlineMessage icon="alert-circle" message={lesson.validation.message} /> : null}
    </View>
  );
}

type CountStepperProps = {
  lessonId: string;
  lessonName: string;
  field: ExamFormCountField;
  label: string;
  value: string;
  questionCount: number;
  onChange: (lessonId: string, field: ExamFormCountField, text: string) => void;
  onBump: (
    lessonId: string,
    field: ExamFormCountField,
    delta: 1 | -1,
    questionCount: number,
  ) => void;
};

/** Direct numeric entry plus 48dp minus/plus controls for one count field. */
function CountStepper({
  lessonId,
  lessonName,
  field,
  label,
  value,
  questionCount,
  onChange,
  onBump,
}: CountStepperProps) {
  const { colors } = useTheme();
  const [isFocused, setIsFocused] = useState(false);

  const bump = (delta: 1 | -1) => onBump(lessonId, field, delta, questionCount);

  return (
    <View style={styles.countRow}>
      <AppText variant="caption" color="secondary" style={styles.countLabel} numberOfLines={2}>
        {label}
      </AppText>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${lessonName} ${label.toLowerCase()} sayısını azalt`}
        onPress={() => bump(-1)}
        style={({ pressed }) => [
          styles.stepperButton,
          { borderColor: colors.border, backgroundColor: colors.background },
          pressed && styles.pressed,
        ]}
      >
        <Ionicons name="remove" size={20} color={colors.text} />
      </Pressable>

      <TextInput
        value={value}
        onChangeText={(text) => onChange(lessonId, field, text)}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        keyboardType="number-pad"
        inputMode="numeric"
        maxLength={3}
        selectTextOnFocus
        accessibilityLabel={`${lessonName} ${label.toLowerCase()} sayısı`}
        accessibilityHint="Doğrudan sayı gir veya eksi artı ile değiştir"
        style={[
          styles.countInput,
          {
            backgroundColor: colors.background,
            borderColor: isFocused ? colors.primary : colors.border,
            color: colors.text,
          },
        ]}
      />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${lessonName} ${label.toLowerCase()} sayısını artır`}
        onPress={() => bump(1)}
        style={({ pressed }) => [
          styles.stepperButton,
          { borderColor: colors.border, backgroundColor: colors.background },
          pressed && styles.pressed,
        ]}
      >
        <Ionicons name="add" size={20} color={colors.text} />
      </Pressable>
    </View>
  );
}

type ReadOnlyCountProps = {
  label: string;
  value: string;
  accessibilityLabel: string;
};

/** Derived, read-only value (blank or net); it is never editable. */
function ReadOnlyCount({ label, value, accessibilityLabel }: ReadOnlyCountProps) {
  const { colors } = useTheme();

  return (
    <View style={styles.countRow}>
      <AppText variant="caption" color="secondary" style={styles.countLabel} numberOfLines={2}>
        {label}
      </AppText>

      <View
        style={[styles.readOnlyValue, { backgroundColor: colors.background, borderColor: colors.border }]}
        accessible
        accessibilityLabel={`${accessibilityLabel}: ${value}`}
      >
        <AppText variant="body" color="secondary" style={styles.strongCaption}>
          {value}
        </AppText>
      </View>
    </View>
  );
}

const SURFACE_ELEVATION: ViewStyle = {
  shadowColor: '#0F1B34',
  shadowOffset: { width: 0, height: 1 },
  shadowOpacity: 0.03,
  shadowRadius: 4,
  elevation: 1,
};

const INPUT_TEXT: TextStyle = {
  fontSize: 16,
  fontWeight: '400',
  paddingHorizontal: spacing.md,
};

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
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
  stepBar: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  stepPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    minHeight: 40,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
  },
  stepLabel: {
    flexShrink: 1,
  },
  content: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
    gap: spacing.lg,
  },
  intro: {
    gap: spacing.xs,
  },
  introTitle: {
    fontWeight: typography.title.fontWeight,
    letterSpacing: -0.5,
  },
  card: {
    borderRadius: 12,
    padding: spacing.md,
    gap: spacing.md,
  },
  field: {
    gap: spacing.sm,
  },
  fieldLabel: {
    fontWeight: typography.subtitle.fontWeight,
  },
  segmentedTrack: {
    flexDirection: 'row',
    gap: spacing.xs,
    padding: spacing.xs,
    borderRadius: 12,
  },
  segment: {
    flex: 1,
    minHeight: spacing.xxl,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    borderRadius: 8,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  segmentLabel: {
    fontWeight: typography.subtitle.fontWeight,
  },
  segmentDetail: {
    textAlign: 'center',
  },
  emptyOptions: {
    minHeight: spacing.xxl,
    justifyContent: 'center',
  },
  fixedTypeField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: spacing.xxl,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  fixedTypeText: {
    flex: 1,
    minWidth: 0,
  },
  textInput: {
    ...INPUT_TEXT,
    minHeight: spacing.xxl,
    borderRadius: 12,
    borderWidth: 1,
  },
  dateField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: spacing.xxl,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
  },
  dateValue: {
    flex: 1,
    minWidth: 0,
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
  },
  messageIcon: {
    marginTop: 1,
  },
  messageText: {
    flex: 1,
    minWidth: 0,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: spacing.xxl,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  primaryButtonLabel: {
    flexShrink: 1,
    fontWeight: typography.subtitle.fontWeight,
  },
  secondaryButton: {
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
  summaryCard: {
    borderRadius: 12,
    padding: spacing.md,
    gap: spacing.sm,
  },
  summaryTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  summaryBody: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  summaryNet: {
    flexShrink: 1,
    gap: 2,
  },
  summaryNetValue: {
    fontWeight: typography.title.fontWeight,
    letterSpacing: -0.5,
  },
  summaryColumns: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  summaryColumn: {
    alignItems: 'flex-end',
  },
  strongCaption: {
    fontWeight: typography.subtitle.fontWeight,
  },
  lessonSection: {
    gap: spacing.md,
  },
  lessonSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  lessonCard: {
    borderRadius: 12,
    padding: spacing.md,
    gap: spacing.sm,
  },
  lessonHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  lessonIdentity: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  lessonIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lessonNames: {
    flex: 1,
    minWidth: 0,
  },
  netBlock: {
    alignItems: 'flex-end',
    borderRadius: 8,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    flexShrink: 0,
  },
  countRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: spacing.xxl,
  },
  countLabel: {
    width: 56,
  },
  stepperButton: {
    width: spacing.xxl,
    height: spacing.xxl,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countInput: {
    flex: 1,
    minWidth: 0,
    minHeight: spacing.xxl,
    borderRadius: 8,
    borderWidth: 1,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '600',
    paddingHorizontal: spacing.xs,
  },
  readOnlyValue: {
    flex: 1,
    minHeight: spacing.xxl,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  actions: {
    gap: spacing.sm,
  },
  note: {
    textAlign: 'center',
  },
  disabled: {
    opacity: 0.5,
  },
  pressed: {
    opacity: 0.85,
  },
});
