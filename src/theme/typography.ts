import type { TextStyle } from 'react-native';

export const typography = {
  title: { fontSize: 24, fontWeight: '700', lineHeight: 32 },
  subtitle: { fontSize: 18, fontWeight: '600', lineHeight: 26 },
  body: { fontSize: 16, fontWeight: '400', lineHeight: 24 },
  caption: { fontSize: 13, fontWeight: '400', lineHeight: 18 },
} satisfies Record<string, TextStyle>;

export type Typography = typeof typography;
export type TypographyVariant = keyof Typography;
