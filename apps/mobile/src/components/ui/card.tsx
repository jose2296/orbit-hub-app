import { StyleSheet, View } from 'react-native';
import type { ViewProps, ViewStyle } from 'react-native';

import { useTheme } from '@/theme';

export type CardVariant = 'default' | 'elevated' | 'outlined' | 'muted';

export interface CardProps extends ViewProps {
  variant?: CardVariant;
  padded?: boolean;
  style?: ViewStyle;
  children?: React.ReactNode;
}

export function Card({ variant = 'default', padded = true, style, children, ...rest }: CardProps) {
  const theme = useTheme();

  const variants: Record<CardVariant, ViewStyle> = {
    default: {
      backgroundColor: theme.colors.surface,
      borderColor: theme.colors.border,
    },
    elevated: {
      backgroundColor: theme.colors.surface,
      borderColor: 'transparent',
      ...theme.shadow.card,
    },
    outlined: {
      backgroundColor: 'transparent',
      borderColor: theme.colors.borderStrong,
    },
    muted: {
      backgroundColor: theme.colors.surfaceMuted,
      borderColor: 'transparent',
    },
  };

  return (
    <View
      {...rest}
      style={[
        styles.base,
        variants[variant],
        {
          borderRadius: theme.radius.lg,
          padding: padded ? theme.spacing.lg : 0,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
});
