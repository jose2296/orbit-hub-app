import { Text } from 'react-native';
import type { TextProps, TextStyle } from 'react-native';

import { useTheme } from '@/theme';

export type TextVariant = keyof ReturnType<typeof useTheme>['typography'];
export type TextTone = 'default' | 'muted' | 'subtle' | 'accent' | 'success' | 'warning' | 'danger' | 'inverse';

export interface AppTextProps extends TextProps {
  variant?: TextVariant;
  tone?: TextTone;
  align?: TextStyle['textAlign'];
  uppercase?: boolean;
}

export function AppText({
  variant = 'body',
  tone = 'default',
  align,
  uppercase = false,
  style,
  ...rest
}: AppTextProps) {
  const theme = useTheme();

  const toneColor: Record<TextTone, string> = {
    default: theme.colors.text,
    muted: theme.colors.textMuted,
    subtle: theme.colors.textSubtle,
    accent: theme.colors.accent,
    success: theme.colors.success,
    warning: theme.colors.warning,
    danger: theme.colors.danger,
    inverse: theme.colors.onAccent,
  };

  return (
    <Text
      {...rest}
      style={[
        theme.typography[variant],
        { color: toneColor[tone] },
        align ? { textAlign: align } : null,
        uppercase ? { textTransform: 'uppercase' } : null,
        style,
      ]}
    />
  );
}
