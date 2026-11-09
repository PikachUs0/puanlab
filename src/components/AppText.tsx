import { Text, type TextProps } from 'react-native';

import { useTheme, type TypographyVariant } from '@/theme';

export type AppTextColor = 'text' | 'secondary' | 'primary';

export type AppTextProps = Omit<TextProps, 'color'> & {
  variant?: TypographyVariant;
  color?: AppTextColor;
};

export function AppText({
  variant = 'body',
  color = 'text',
  style,
  children,
  ...rest
}: AppTextProps) {
  const theme = useTheme();

  return (
    <Text style={[theme.typography[variant], { color: theme.colors[color] }, style]} {...rest}>
      {children}
    </Text>
  );
}
