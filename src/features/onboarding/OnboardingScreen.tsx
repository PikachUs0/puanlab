import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { AppText, Screen } from '@/components';
import { spacing, useTheme } from '@/theme';

import { useOnboarding } from './OnboardingProvider';
import {
  GRADE_LEVEL_OPTIONS,
  SCORE_TYPE_OPTIONS,
  type OnboardingDraft,
} from './types';
import {
  buildOnboardingData,
  hasOnboardingErrors,
  validateOnboarding,
  type OnboardingErrors,
} from './validation';

const INITIAL_DRAFT: OnboardingDraft = {
  gradeLevel: null,
  scoreType: null,
  targetDepartment: '',
  targetUniversity: '',
};

export function OnboardingScreen() {
  const { colors } = useTheme();
  const { complete } = useOnboarding();

  const [draft, setDraft] = useState<OnboardingDraft>(INITIAL_DRAFT);
  const [errors, setErrors] = useState<OnboardingErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleSubmit = async () => {
    const nextErrors = validateOnboarding(draft);
    setErrors(nextErrors);
    setSubmitError(null);

    if (hasOnboardingErrors(nextErrors)) {
      return;
    }

    const data = buildOnboardingData(draft);

    if (!data) {
      return;
    }

    // Guard against a double tap creating two writes for the same profile.
    if (isSubmitting) {
      return;
    }

    setIsSubmitting(true);

    try {
      await complete(data);
    } catch {
      setSubmitError('Profilin kaydedilemedi. Lütfen tekrar dene.');
      setIsSubmitting(false);
    }
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <AppText variant="title">PuanLab&apos;a Hoş Geldin</AppText>
          <AppText variant="body" color="secondary">
            Sana uygun bir çalışma planı hazırlayabilmemiz için birkaç bilgiye ihtiyacımız var.
          </AppText>
        </View>

        <View style={styles.section}>
          <AppText variant="subtitle">Sınıf Düzeyi</AppText>
          <View style={styles.options}>
            {GRADE_LEVEL_OPTIONS.map((option) => (
              <OptionButton
                key={option.value}
                label={option.label}
                selected={draft.gradeLevel === option.value}
                onPress={() => setDraft((current) => ({ ...current, gradeLevel: option.value }))}
              />
            ))}
          </View>
          {errors.gradeLevel ? (
            <AppText variant="caption" color="primary">
              {errors.gradeLevel}
            </AppText>
          ) : null}
        </View>

        <View style={styles.section}>
          <AppText variant="subtitle">Puan Türü</AppText>
          <View style={styles.options}>
            {SCORE_TYPE_OPTIONS.map((option) => (
              <OptionButton
                key={option.value}
                label={option.label}
                selected={draft.scoreType === option.value}
                onPress={() => setDraft((current) => ({ ...current, scoreType: option.value }))}
              />
            ))}
          </View>
          {errors.scoreType ? (
            <AppText variant="caption" color="primary">
              {errors.scoreType}
            </AppText>
          ) : null}
        </View>

        <View style={styles.section}>
          <AppText variant="subtitle">Hedef Bölüm</AppText>
          <AppText variant="caption" color="secondary">
            İsteğe bağlı
          </AppText>
          <TextInput
            value={draft.targetDepartment}
            onChangeText={(value) =>
              setDraft((current) => ({ ...current, targetDepartment: value }))
            }
            placeholder="Örn. Bilgisayar Mühendisliği"
            placeholderTextColor={colors.secondary}
            style={[
              styles.input,
              { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text },
            ]}
          />
        </View>

        <View style={styles.section}>
          <AppText variant="subtitle">Hedef Üniversite</AppText>
          <AppText variant="caption" color="secondary">
            İsteğe bağlı
          </AppText>
          <TextInput
            value={draft.targetUniversity}
            onChangeText={(value) =>
              setDraft((current) => ({ ...current, targetUniversity: value }))
            }
            placeholder="Örn. Boğaziçi Üniversitesi"
            placeholderTextColor={colors.secondary}
            style={[
              styles.input,
              { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text },
            ]}
          />
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: isSubmitting, busy: isSubmitting }}
          disabled={isSubmitting}
          onPress={() => {
            void handleSubmit();
          }}
          style={[styles.submit, { backgroundColor: colors.primary, opacity: isSubmitting ? 0.6 : 1 }]}
        >
          <AppText variant="body" style={{ color: colors.surface }}>
            {isSubmitting ? 'Kaydediliyor...' : 'Devam Et'}
          </AppText>
        </Pressable>

        {submitError ? (
          <AppText variant="caption" color="primary" accessibilityLiveRegion="polite">
            {submitError}
          </AppText>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

type OptionButtonProps = {
  label: string;
  selected: boolean;
  onPress: () => void;
};

function OptionButton({ label, selected, onPress }: OptionButtonProps) {
  const { colors } = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[
        styles.option,
        { backgroundColor: colors.surface, borderColor: selected ? colors.primary : colors.border },
      ]}
    >
      <AppText variant="body" color={selected ? 'primary' : 'text'}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.lg,
    padding: spacing.lg,
  },
  header: {
    gap: spacing.sm,
  },
  section: {
    gap: spacing.sm,
  },
  options: {
    gap: spacing.sm,
  },
  option: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  submit: {
    alignItems: 'center',
    borderRadius: 12,
    paddingVertical: spacing.md,
  },
});
