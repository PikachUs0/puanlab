import Ionicons from '@expo/vector-icons/Ionicons';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type ViewStyle,
} from 'react-native';

import { AppText, Screen } from '@/components';
import { GRADE_LEVEL_OPTIONS, SCORE_TYPE_OPTIONS } from '@/features/onboarding';
import { useUserProfileRepository } from '@/features/onboarding/userProfileHooks';
import {
  OPTIONAL_TARGET_MAX_LENGTH,
  formatGradeLevelLabel,
  formatOptionalTarget,
  formatScoreTypeLabel,
  isProfileDraftDirty,
  saveProfileUpdate,
  toProfileDraft,
  type ProfileDraft,
} from '@/features/profile';
import { useClearLocalData } from '@/features/settings';
import { profileSelectors, useProfileStore } from '@/store';
import { spacing, typography, useTheme, useThemeControls } from '@/theme';
import type { ThemePreference, UserProfile } from '@/types';

const PROFILE_TITLE = 'Profil';
const PROFILE_SUBTITLE = 'YKS hazırlık rotanı ve hedeflerini buradan güncelleyebilirsin.';
const ACADEMIC_SNAPSHOT_TITLE = 'Akademik Tercihler';

const ACADEMIC_SECTION_TITLE = 'Akademik Bilgiler';
const GRADE_FIELD_LABEL = 'Sınıf durumu';
const SCORE_TYPE_FIELD_LABEL = 'Puan türü';
const TARGETS_TITLE = 'Hedefler';
const OPTIONAL_BADGE = 'İsteğe Bağlı';
const TARGET_DEPARTMENT_LABEL = 'Hedef bölüm';
const TARGET_UNIVERSITY_LABEL = 'Hedef üniversite';
const TARGET_DEPARTMENT_PLACEHOLDER = 'Örn. Bilgisayar Mühendisliği';
const TARGET_UNIVERSITY_PLACEHOLDER = 'Örn. Orta Doğu Teknik Üniversitesi';

const SCORE_TYPE_NOTE =
  'Puan türü değişikliği yeni AYT denemelerini ve gösterilen AYT derslerini etkiler. Önceden kaydettiğin denemeler değişmez.';

const APPEARANCE_SECTION_TITLE = 'Görünüm';
const THEME_SAVE_ERROR_MESSAGE = 'Tema tercihi kaydedilemedi. Lütfen tekrar dene.';

type IoniconName = keyof typeof Ionicons.glyphMap;

/** Saved theme choices. Each option pairs an icon with its label so selection
 * is never communicated by colour alone. */
const THEME_OPTIONS: readonly { value: ThemePreference; label: string; icon: IoniconName }[] = [
  { value: 'system', label: 'Sistem', icon: 'phone-portrait-outline' },
  { value: 'light', label: 'Açık', icon: 'sunny-outline' },
  { value: 'dark', label: 'Koyu', icon: 'moon-outline' },
];

const PRIVACY_SECTION_TITLE = 'Veri ve Gizlilik';
const PRIVACY_LOCAL_MESSAGE = 'Verilerin bu cihazda saklanır ve bir sunucuya gönderilmez.';
const PRIVACY_DELETE_MESSAGE = 'Uygulama silinirse bu cihazdaki veriler de silinir.';

const CLEAR_LOCAL_DATA_LABEL = 'Yerel Verileri Temizle';
const CLEAR_LOCAL_DATA_BUSY_LABEL = 'Veriler siliniyor...';
const CLEAR_LOCAL_DATA_SUPPORTING_TEXT =
  'Konu ilerlemelerin, notların, denemelerin ve profil bilgilerin bu cihazdan silinir.';
const CLEAR_LOCAL_DATA_A11Y_LABEL = 'Tüm yerel kullanıcı verilerini temizle';
const CLEAR_LOCAL_DATA_A11Y_HINT = 'İşlemden önce iki aşamalı onay istenir';

const CLEAR_CONFIRM_TITLE = 'Tüm yerel veriler silinsin mi?';
const CLEAR_CONFIRM_MESSAGE =
  'Konu ilerlemelerin, notların, denemelerin ve profil bilgilerin kalıcı olarak silinecek.';
const CLEAR_CONFIRM_CANCEL = 'İptal';
const CLEAR_CONFIRM_CONTINUE = 'Devam Et';

const CLEAR_FINAL_TITLE = 'Bu işlem geri alınamaz';
const CLEAR_FINAL_MESSAGE = 'PuanLab verilerini bu cihazdan silmek istediğinden emin misin?';
const CLEAR_FINAL_CANCEL = 'Vazgeç';
const CLEAR_FINAL_CONFIRM = 'Verileri Sil';

const ABOUT_SECTION_TITLE = 'Uygulama Hakkında';
const ABOUT_APP_NAME = 'PuanLab';
const ABOUT_APP_NAME_LABEL = 'Uygulama adı';
const ABOUT_VERSION_LABEL = 'Sürüm';
const ABOUT_CURRICULUM_LABEL = 'Müfredat sürümü';
const ABOUT_CURRICULUM_VERSION = '2026';
const PRIVACY_POLICY_LABEL = 'Gizlilik Politikası';
const FEEDBACK_LABEL = 'Geri Bildirim Gönder';
const COMING_SOON_LABEL = 'Yakında';

const SAVE_ACTION = 'Değişiklikleri Kaydet';
const SAVING_ACTION = 'Kaydediliyor...';
const SAVE_SUCCESS_MESSAGE = 'Profil bilgilerin güncellendi.';
const SAVE_ERROR_MESSAGE = 'Profil bilgileri kaydedilemedi. Lütfen tekrar dene.';
const LOADING_MESSAGE = 'Profil yükleniyor...';

const UNSAVED_TITLE = 'Değişiklikler kaydedilmedi';
const UNSAVED_MESSAGE = 'Kaydetmeden çıkarsan yaptığın değişiklikler kaybolacak.';
const UNSAVED_STAY_ACTION = 'Devam Et';
const UNSAVED_LEAVE_ACTION = 'Çık';

/** Read from the existing Expo app configuration so it is never hardcoded. */
const APP_VERSION = Constants.expoConfig?.version ?? '—';

const SURFACE_SHADOW: ViewStyle = {
  shadowColor: '#0F1B34',
  shadowOffset: { width: 0, height: 1 },
  shadowOpacity: 0.05,
  shadowRadius: 8,
  elevation: 1,
};

type SaveFeedback = {
  kind: 'success' | 'error';
  message: string;
};

/** Stage of the two-stage "clear local data" confirmation dialog. */
type ClearConfirmStage = 'idle' | 'first' | 'second';

/**
 * Profile and settings screen.
 *
 * The persisted profile is read once through the user profile repository (the
 * store itself carries no `createdAt`), mirrored into an editable draft and
 * written back with `updateProfile` so the singleton row keeps its `created_at`.
 * The store is only updated after SQLite accepted the write. Leaving the screen
 * with unsaved changes is guarded by a confirmation dialog, for both the header
 * button and the Android hardware back button.
 */
export default function ProfileScreen() {
  const { colors } = useTheme();
  const { preference, setThemePreference } = useThemeControls();
  const router = useRouter();
  const repository = useUserProfileRepository();
  const hydrateProfile = useProfileStore((state) => state.hydrateProfile);
  const { isClearing, error: clearError, clearLocalData } = useClearLocalData();

  // The displayed (read-only) profile values are read from the store through
  // stable selectors; every selector returns a primitive or `string | null`.
  const storeGradeLevel = useProfileStore(profileSelectors.gradeLevel);
  const storeScoreType = useProfileStore(profileSelectors.scoreType);
  const storeTargetDepartment = useProfileStore(profileSelectors.targetDepartment);
  const storeTargetUniversity = useProfileStore(profileSelectors.targetUniversity);

  const [savedProfile, setSavedProfile] = useState<UserProfile | null>(null);
  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<SaveFeedback | null>(null);
  const [themeFeedback, setThemeFeedback] = useState<string | null>(null);

  const isMountedRef = useRef(true);
  const savingRef = useRef(false);

  // Which stage of the two-stage confirmation is currently open. Tracking the
  // stage (instead of a plain boolean) makes both the stray dismiss that
  // Android fires after a button press and a genuine tap-outside dismiss
  // resolve correctly, and keeps the flow from opening twice.
  const confirmStageRef = useRef<ClearConfirmStage>('idle');

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // The editable draft needs the full persisted record (including `createdAt`),
  // which the profile store does not hold, so it is read once from SQLite.
  useEffect(() => {
    if (repository === null) {
      return;
    }

    let isActive = true;

    repository
      .getProfile()
      .then((profile) => {
        if (!isActive || !isMountedRef.current || profile === null) {
          return;
        }

        setSavedProfile(profile);
        setDraft(toProfileDraft(profile));
      })
      .catch((cause: unknown) => {
        if (__DEV__) {
          console.warn('[Profile] Profile could not be loaded', cause);
        }
      });

    return () => {
      isActive = false;
    };
  }, [repository]);

  const isReady = savedProfile !== null && draft !== null;

  const isDirty = useMemo(
    () => (savedProfile !== null && draft !== null ? isProfileDraftDirty(savedProfile, draft) : false),
    [savedProfile, draft],
  );

  const showScoreTypeNote =
    savedProfile !== null && draft !== null && draft.scoreType !== savedProfile.scoreType;

  // Read-only snapshot shown above the editor. Turkish labels only — technical
  // values (`grade_12`, `SOZ`, `DIL`) are never rendered. Empty optional
  // targets fall back to "Belirtilmedi".
  const summary = useMemo(() => {
    const gradeLevel = storeGradeLevel ?? savedProfile?.gradeLevel ?? null;
    const scoreType = storeScoreType ?? savedProfile?.scoreType ?? null;

    if (gradeLevel === null || scoreType === null) {
      return null;
    }

    return {
      gradeLevel: formatGradeLevelLabel(gradeLevel),
      scoreType: formatScoreTypeLabel(scoreType),
      targetDepartment: formatOptionalTarget(
        storeTargetDepartment ?? savedProfile?.targetDepartment,
      ),
      targetUniversity: formatOptionalTarget(
        storeTargetUniversity ?? savedProfile?.targetUniversity,
      ),
    };
  }, [
    storeGradeLevel,
    storeScoreType,
    storeTargetDepartment,
    storeTargetUniversity,
    savedProfile,
  ]);

  const goBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }

    // Deep-link fallback: no history to pop back to.
    router.replace('/');
  }, [router]);

  const confirmDiscard = useCallback(() => {
    Alert.alert(UNSAVED_TITLE, UNSAVED_MESSAGE, [
      { text: UNSAVED_STAY_ACTION, style: 'cancel' },
      { text: UNSAVED_LEAVE_ACTION, style: 'destructive', onPress: goBack },
    ]);
  }, [goBack]);

  const handleBack = useCallback(() => {
    // Leaving the screen mid-reset would let a screen read half-cleared values.
    if (isClearing) {
      return;
    }

    if (isDirty) {
      confirmDiscard();
      return;
    }

    goBack();
  }, [isClearing, isDirty, confirmDiscard, goBack]);

  // Android hardware back must follow the same rule as the header button, and
  // must not escape the screen while the reset transaction is running.
  useEffect(() => {
    if (!isDirty && !isClearing) {
      return;
    }

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (isClearing) {
        return true;
      }

      confirmDiscard();
      return true;
    });

    return () => subscription.remove();
  }, [isDirty, isClearing, confirmDiscard]);

  const handleChangeDraft = useCallback((patch: Partial<ProfileDraft>) => {
    setDraft((current) => (current === null ? current : { ...current, ...patch }));
    setFeedback(null);
  }, []);

  const handleSave = useCallback(async () => {
    // Single-flight guard: a fast double tap can never start two writes. A
    // reset in flight also blocks a profile write, which would recreate a row
    // the reset just deleted.
    if (savingRef.current || isClearing || savedProfile === null || draft === null) {
      return;
    }

    savingRef.current = true;
    setIsSaving(true);
    setFeedback(null);

    try {
      const updated = await saveProfileUpdate({
        repository,
        savedProfile,
        draft,
        now: new Date(),
        // The store is updated only after the repository write succeeded.
        onSaved: hydrateProfile,
      });

      if (!isMountedRef.current) {
        return;
      }

      setSavedProfile(updated);
      setDraft(toProfileDraft(updated));
      setFeedback({ kind: 'success', message: SAVE_SUCCESS_MESSAGE });
    } catch (error) {
      if (__DEV__) {
        console.warn('[Profile] Save failed', error);
      }

      if (!isMountedRef.current) {
        return;
      }

      // The entered values are preserved; only the feedback message changes.
      setFeedback({ kind: 'error', message: SAVE_ERROR_MESSAGE });
    } finally {
      savingRef.current = false;

      if (isMountedRef.current) {
        setIsSaving(false);
      }
    }
  }, [repository, savedProfile, draft, hydrateProfile, isClearing]);

  // Applies the theme immediately and persists it. Writes are serialised inside
  // the theme state machine, so rapid taps cannot produce inconsistent writes;
  // a failure restores the previously confirmed preference and is surfaced here.
  const handleSelectTheme = useCallback(
    async (value: ThemePreference) => {
      // A theme write during the reset would recreate the settings row the
      // reset just deleted.
      if (isClearing || value === preference) {
        return;
      }

      setThemeFeedback(null);

      try {
        await setThemePreference(value);
      } catch {
        // The raw error is logged by `ThemeProvider`; production only sees this.
        if (isMountedRef.current) {
          setThemeFeedback(THEME_SAVE_ERROR_MESSAGE);
        }
      }
    },
    [isClearing, preference, setThemePreference],
  );

  const closeConfirmFlow = useCallback(() => {
    confirmStageRef.current = 'idle';
  }, []);

  /**
   * Starts the two-stage confirmation. The first dialog only reveals the
   * second one; deletion happens solely from "Verileri Sil" in the second
   * dialog. Closing either dialog leaves every value unchanged.
   */
  const handleClearLocalData = useCallback(() => {
    if (isClearing || confirmStageRef.current !== 'idle') {
      return;
    }

    confirmStageRef.current = 'first';

    Alert.alert(
      CLEAR_CONFIRM_TITLE,
      CLEAR_CONFIRM_MESSAGE,
      [
        { text: CLEAR_CONFIRM_CANCEL, style: 'cancel', onPress: closeConfirmFlow },
        {
          text: CLEAR_CONFIRM_CONTINUE,
          onPress: () => {
            // First stage confirmed: nothing has been deleted yet.
            confirmStageRef.current = 'second';

            Alert.alert(
              CLEAR_FINAL_TITLE,
              CLEAR_FINAL_MESSAGE,
              [
                { text: CLEAR_FINAL_CANCEL, style: 'cancel', onPress: closeConfirmFlow },
                {
                  text: CLEAR_FINAL_CONFIRM,
                  style: 'destructive',
                  onPress: () => {
                    closeConfirmFlow();
                    void clearLocalData();
                  },
                },
              ],
              {
                cancelable: true,
                onDismiss: () => {
                  if (confirmStageRef.current === 'second') {
                    closeConfirmFlow();
                  }
                },
              },
            );
          },
        },
      ],
      {
        cancelable: true,
        onDismiss: () => {
          if (confirmStageRef.current === 'first') {
            closeConfirmFlow();
          }
        },
      },
    );
  }, [isClearing, clearLocalData, closeConfirmFlow]);

  // Empty optional targets are shown as "Belirtilmedi".
  const optionalTargetPlaceholder = formatOptionalTarget('');

  // A profile write and the reset must never run at the same time, so each
  // action disables the other while it is in flight.
  const isSaveDisabled = isSaving || isClearing;
  const isClearDisabled = isClearing || isSaving;

  return (
    <Screen>
      <View style={[styles.header, SURFACE_SHADOW, { backgroundColor: colors.surface }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Geri"
          accessibilityHint="Önceki ekrana döner"
          onPress={handleBack}
          style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}
        >
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </Pressable>

        <AppText variant="subtitle" style={styles.headerTitle} numberOfLines={1}>
          {PROFILE_TITLE}
        </AppText>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <View style={[styles.card, SURFACE_SHADOW, { backgroundColor: colors.surface }]}>
            <View style={styles.identityRow}>
              <View style={[styles.avatar, { backgroundColor: `${colors.primary}14` }]}>
                <Ionicons name="person" size={26} color={colors.primary} />
              </View>
              <View style={styles.identityText}>
                <AppText variant="subtitle">{ACADEMIC_SNAPSHOT_TITLE}</AppText>
                <AppText variant="caption" color="secondary">
                  {PROFILE_SUBTITLE}
                </AppText>
              </View>
            </View>

            {summary !== null ? (
              <View style={styles.summaryList}>
                <SummaryRow label={GRADE_FIELD_LABEL} value={summary.gradeLevel} />
                <SummaryRow label={SCORE_TYPE_FIELD_LABEL} value={summary.scoreType} />
                <SummaryRow label={TARGET_DEPARTMENT_LABEL} value={summary.targetDepartment} />
                <SummaryRow label={TARGET_UNIVERSITY_LABEL} value={summary.targetUniversity} />
              </View>
            ) : null}
          </View>

          <View style={[styles.card, SURFACE_SHADOW, { backgroundColor: colors.surface }]}>
            <AppText variant="subtitle">{ACADEMIC_SECTION_TITLE}</AppText>

            {isReady ? (
              <>
                <View style={styles.fieldGroup}>
                  <AppText variant="caption" color="secondary">
                    {GRADE_FIELD_LABEL}
                  </AppText>
                  <View style={styles.optionRow}>
                    {GRADE_LEVEL_OPTIONS.map((option) => (
                      <OptionChip
                        key={option.value}
                        label={option.label}
                        selected={draft.gradeLevel === option.value}
                        onPress={() => handleChangeDraft({ gradeLevel: option.value })}
                      />
                    ))}
                  </View>
                </View>

                <View style={styles.fieldGroup}>
                  <AppText variant="caption" color="secondary">
                    {SCORE_TYPE_FIELD_LABEL}
                  </AppText>
                  <View style={styles.optionRow}>
                    {SCORE_TYPE_OPTIONS.map((option) => (
                      <OptionChip
                        key={option.value}
                        label={option.label}
                        selected={draft.scoreType === option.value}
                        onPress={() => handleChangeDraft({ scoreType: option.value })}
                      />
                    ))}
                  </View>
                </View>

                {showScoreTypeNote ? (
                  <View style={[styles.notice, { backgroundColor: `${colors.primary}14` }]}>
                    <Ionicons
                      name="information-circle-outline"
                      size={18}
                      color={colors.primary}
                    />
                    <AppText variant="caption" color="secondary" style={styles.noticeText}>
                      {SCORE_TYPE_NOTE}
                    </AppText>
                  </View>
                ) : null}

                <View style={styles.targetsHeader}>
                  <AppText variant="body">{TARGETS_TITLE}</AppText>
                  <View style={[styles.badge, { backgroundColor: `${colors.primary}14` }]}>
                    <AppText variant="caption" color="primary" style={styles.badgeLabel}>
                      {OPTIONAL_BADGE}
                    </AppText>
                  </View>
                </View>

                <View style={styles.fieldGroup}>
                  <AppText variant="caption" color="secondary">
                    {TARGET_DEPARTMENT_LABEL}
                  </AppText>
                  <TextInput
                    value={draft.targetDepartment}
                    onChangeText={(value) => handleChangeDraft({ targetDepartment: value })}
                    placeholder={optionalTargetPlaceholder}
                    placeholderTextColor={colors.secondary}
                    maxLength={OPTIONAL_TARGET_MAX_LENGTH}
                    accessibilityLabel={TARGET_DEPARTMENT_LABEL}
                    style={[
                      styles.input,
                      { backgroundColor: colors.background, borderColor: colors.border, color: colors.text },
                    ]}
                  />
                  <AppText variant="caption" color="secondary">
                    {TARGET_DEPARTMENT_PLACEHOLDER}
                  </AppText>
                </View>

                <View style={styles.fieldGroup}>
                  <AppText variant="caption" color="secondary">
                    {TARGET_UNIVERSITY_LABEL}
                  </AppText>
                  <TextInput
                    value={draft.targetUniversity}
                    onChangeText={(value) => handleChangeDraft({ targetUniversity: value })}
                    placeholder={optionalTargetPlaceholder}
                    placeholderTextColor={colors.secondary}
                    maxLength={OPTIONAL_TARGET_MAX_LENGTH}
                    accessibilityLabel={TARGET_UNIVERSITY_LABEL}
                    style={[
                      styles.input,
                      { backgroundColor: colors.background, borderColor: colors.border, color: colors.text },
                    ]}
                  />
                  <AppText variant="caption" color="secondary">
                    {TARGET_UNIVERSITY_PLACEHOLDER}
                  </AppText>
                </View>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={SAVE_ACTION}
                  accessibilityState={{ disabled: isSaveDisabled, busy: isSaving }}
                  disabled={isSaveDisabled}
                  onPress={handleSave}
                  style={({ pressed }) => [
                    styles.saveButton,
                    { backgroundColor: colors.primary, opacity: isSaveDisabled ? 0.6 : 1 },
                    pressed && !isSaveDisabled && styles.pressed,
                  ]}
                >
                  <AppText variant="body" style={[styles.saveLabel, { color: colors.surface }]}>
                    {isSaving ? SAVING_ACTION : SAVE_ACTION}
                  </AppText>
                </Pressable>

                {feedback ? (
                  <AppText
                    variant="caption"
                    accessibilityLiveRegion="polite"
                    style={[
                      styles.feedback,
                      { color: feedback.kind === 'error' ? colors.danger : colors.primary },
                    ]}
                  >
                    {feedback.message}
                  </AppText>
                ) : null}
              </>
            ) : (
              <View style={styles.loadingRow}>
                <ActivityIndicator color={colors.primary} />
                <AppText variant="caption" color="secondary">
                  {LOADING_MESSAGE}
                </AppText>
              </View>
            )}
          </View>

          <View style={[styles.card, SURFACE_SHADOW, { backgroundColor: colors.surface }]}>
            <AppText variant="subtitle">{APPEARANCE_SECTION_TITLE}</AppText>

            <View style={styles.themeList}>
              {THEME_OPTIONS.map((option) => (
                <ThemeOptionRow
                  key={option.value}
                  label={option.label}
                  icon={option.icon}
                  selected={preference === option.value}
                  disabled={isClearing}
                  onPress={() => handleSelectTheme(option.value)}
                />
              ))}
            </View>

            {themeFeedback ? (
              <AppText
                variant="caption"
                accessibilityLiveRegion="polite"
                style={[styles.feedback, { color: colors.danger }]}
              >
                {themeFeedback}
              </AppText>
            ) : null}
          </View>

          <View style={[styles.card, SURFACE_SHADOW, { backgroundColor: colors.surface }]}>
            <AppText variant="subtitle">{PRIVACY_SECTION_TITLE}</AppText>

            <AppText variant="body" color="secondary">
              {PRIVACY_LOCAL_MESSAGE}
            </AppText>
            <AppText variant="body" color="secondary">
              {PRIVACY_DELETE_MESSAGE}
            </AppText>

            <AppText variant="body" color="secondary">
              {CLEAR_LOCAL_DATA_SUPPORTING_TEXT}
            </AppText>

            {/* Destructive action: the trash icon and the visible label carry
                the meaning together, never colour alone. */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={CLEAR_LOCAL_DATA_A11Y_LABEL}
              accessibilityHint={CLEAR_LOCAL_DATA_A11Y_HINT}
              accessibilityState={{ disabled: isClearDisabled, busy: isClearing }}
              disabled={isClearDisabled}
              onPress={handleClearLocalData}
              style={({ pressed }) => [
                styles.dangerButton,
                { borderColor: colors.danger, opacity: isClearDisabled ? 0.6 : 1 },
                pressed && !isClearDisabled && styles.pressed,
              ]}
            >
              <Ionicons name="trash-outline" size={20} color={colors.danger} />
              <AppText variant="body" style={[styles.dangerLabel, { color: colors.danger }]}>
                {isClearing ? CLEAR_LOCAL_DATA_BUSY_LABEL : CLEAR_LOCAL_DATA_LABEL}
              </AppText>
            </Pressable>

            {clearError ? (
              <AppText
                variant="caption"
                accessibilityLiveRegion="polite"
                style={[styles.feedback, { color: colors.danger }]}
              >
                {clearError}
              </AppText>
            ) : null}
          </View>

          <View style={[styles.card, SURFACE_SHADOW, { backgroundColor: colors.surface }]}>
            <AppText variant="subtitle">{ABOUT_SECTION_TITLE}</AppText>

            <View style={styles.valueRow}>
              <AppText variant="body" color="secondary">
                {ABOUT_APP_NAME_LABEL}
              </AppText>
              <AppText variant="body">{ABOUT_APP_NAME}</AppText>
            </View>

            <View style={styles.valueRow}>
              <AppText variant="body" color="secondary">
                {ABOUT_VERSION_LABEL}
              </AppText>
              <AppText variant="body">{APP_VERSION}</AppText>
            </View>

            <View style={styles.valueRow}>
              <AppText variant="body" color="secondary">
                {ABOUT_CURRICULUM_LABEL}
              </AppText>
              <AppText variant="body">{ABOUT_CURRICULUM_VERSION}</AppText>
            </View>

            {/* No valid URL or contact address exists yet, so both stay non-pressable. */}
            <View style={styles.valueRow}>
              <AppText variant="body" color="secondary">
                {PRIVACY_POLICY_LABEL}
              </AppText>
              <AppText variant="caption" color="secondary">
                {COMING_SOON_LABEL}
              </AppText>
            </View>

            <View style={styles.valueRow}>
              <AppText variant="body" color="secondary">
                {FEEDBACK_LABEL}
              </AppText>
              <AppText variant="caption" color="secondary">
                {COMING_SOON_LABEL}
              </AppText>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

type OptionChipProps = {
  label: string;
  selected: boolean;
  onPress: () => void;
};

/**
 * A selectable option. Selection is conveyed by a check icon, the border and
 * the text colour together — never by colour alone — and `accessibilityState`
 * announces it to TalkBack.
 */
function OptionChip({ label, selected, onPress }: OptionChipProps) {
  const { colors } = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.option,
        {
          backgroundColor: selected ? `${colors.primary}14` : colors.background,
          borderColor: selected ? colors.primary : colors.border,
        },
        pressed && styles.pressed,
      ]}
    >
      <AppText variant="body" color={selected ? 'primary' : 'text'} style={styles.optionLabel}>
        {label}
      </AppText>
      {selected ? <Ionicons name="checkmark" size={18} color={colors.primary} /> : null}
    </Pressable>
  );
}

type ThemeOptionRowProps = {
  label: string;
  icon: IoniconName;
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
};

/**
 * A full-width theme option. Selection is conveyed by the icon, the check mark,
 * the border and `accessibilityState` together — never by colour alone — so
 * TalkBack announces both the option name and whether it is selected. The row
 * is at least 48dp tall for a comfortable touch target.
 */
function ThemeOptionRow({ label, icon, selected, disabled = false, onPress }: ThemeOptionRowProps) {
  const { colors } = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.themeOption,
        {
          backgroundColor: selected ? `${colors.primary}14` : colors.background,
          borderColor: selected ? colors.primary : colors.border,
          opacity: disabled ? 0.6 : 1,
        },
        pressed && !disabled && styles.pressed,
      ]}
    >
      <Ionicons name={icon} size={20} color={selected ? colors.primary : colors.secondary} />
      <AppText variant="body" color={selected ? 'primary' : 'text'} style={styles.themeOptionLabel}>
        {label}
      </AppText>
      {selected ? <Ionicons name="checkmark-circle" size={20} color={colors.primary} /> : null}
    </Pressable>
  );
}

type SummaryRowProps = {
  label: string;
  value: string;
};

/** A read-only label/value row of the profile snapshot. */
function SummaryRow({ label, value }: SummaryRowProps) {
  return (
    <View style={styles.valueRow}>
      <AppText variant="body" color="secondary">
        {label}
      </AppText>
      <AppText variant="body" style={styles.summaryValue}>
        {value}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 64,
    paddingHorizontal: spacing.md,
  },
  headerButton: {
    width: spacing.xxl,
    height: spacing.xxl,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: spacing.xxl / 2,
  },
  headerTitle: {
    flexShrink: 1,
    fontWeight: typography.subtitle.fontWeight,
  },
  content: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  card: {
    borderRadius: 12,
    padding: spacing.md,
    gap: spacing.md,
  },
  fieldGroup: {
    gap: spacing.sm,
  },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  identityText: {
    flex: 1,
    gap: spacing.xs / 2,
  },
  summaryList: {
    gap: spacing.sm,
  },
  summaryValue: {
    flexShrink: 1,
    textAlign: 'right',
  },
  optionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    minHeight: spacing.xxl,
    minWidth: 88,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 12,
    borderWidth: 1,
  },
  optionLabel: {
    flexShrink: 1,
  },
  themeList: {
    gap: spacing.sm,
  },
  themeOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: spacing.xxl,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 12,
    borderWidth: 1,
  },
  themeOptionLabel: {
    flex: 1,
    flexShrink: 1,
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    borderRadius: 12,
    padding: spacing.md,
  },
  noticeText: {
    flexShrink: 1,
  },
  targetsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  badge: {
    borderRadius: spacing.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs / 2,
  },
  badgeLabel: {
    fontWeight: typography.subtitle.fontWeight,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    minHeight: spacing.xxl,
    paddingVertical: spacing.sm,
    fontSize: typography.body.fontSize,
  },
  saveButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: spacing.xxl,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  saveLabel: {
    fontWeight: typography.subtitle.fontWeight,
  },
  dangerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: spacing.xxl,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  dangerLabel: {
    fontWeight: typography.subtitle.fontWeight,
  },
  feedback: {
    flexShrink: 1,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  pressed: {
    opacity: 0.85,
  },
});
