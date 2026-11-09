import type { Spacing } from './spacing';
import type { Typography } from './typography';

/** Saved theme choice; re-exported here so theme code imports it from one place. */
export type { ThemePreference } from '@/types';

export type ColorScheme = 'light' | 'dark';

export type ThemeColors = {
  background: string;
  surface: string;
  text: string;
  secondary: string;
  border: string;
  primary: string;
  /** Destructive actions and negative metrics. */
  danger: string;
};

export type StatusKey = 'not_started' | 'learning' | 'practice' | 'review' | 'strong';

export type StatusColors = Record<StatusKey, string>;

export type Theme = {
  scheme: ColorScheme;
  colors: ThemeColors;
  status: StatusColors;
  spacing: Spacing;
  typography: Typography;
};
