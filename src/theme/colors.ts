import type { StatusColors, ThemeColors } from './types';

export const lightColors: ThemeColors = {
  background: '#F7F8FC',
  surface: '#FFFFFF',
  text: '#17233C',
  secondary: '#475569',
  border: '#DDE3EC',
  primary: '#2F5BEA',
  danger: '#BA1A1A',
};

export const darkColors: ThemeColors = {
  background: '#0F1726',
  surface: '#182437',
  text: '#F3F6FC',
  secondary: '#C0CAD9',
  border: '#304059',
  primary: '#7899FF',
  danger: '#FFB4AB',
};

export const statusColors: StatusColors = {
  not_started: '#94A3B8',
  learning: '#2F5BEA',
  practice: '#F59E0B',
  review: '#8B5CF6',
  strong: '#16A34A',
};
