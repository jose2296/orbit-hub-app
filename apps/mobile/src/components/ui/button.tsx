import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import type { ViewStyle } from 'react-native';

import { useTheme } from '@/theme';

import { AppText } from './text';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';
export type IconName = ComponentProps<typeof Ionicons>['name'];

export interface ButtonProps {
  label: string;
  /** Optional when the button is rendered through `<Link asChild>`. */
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  iconPosition?: 'leading' | 'trailing';
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  style?: ViewStyle;
  accessibilityHint?: string;
  testID?: string;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  iconPosition = 'leading',
  loading = false,
  disabled = false,
  fullWidth = true,
  style,
  accessibilityHint,
  testID,
}: ButtonProps) {
  const theme = useTheme();
  const isDisabled = disabled || loading;

  const palette: Record<ButtonVariant, { background: string; border: string; text: string }> = {
    primary: {
      background: theme.colors.accent,
      border: theme.colors.accent,
      text: theme.colors.onAccent,
    },
    secondary: {
      background: theme.colors.surface,
      border: theme.colors.borderStrong,
      text: theme.colors.text,
    },
    ghost: {
      background: 'transparent',
      border: 'transparent',
      text: theme.colors.accent,
    },
    danger: {
      background: theme.colors.dangerSoft,
      border: theme.colors.danger,
      text: theme.colors.danger,
    },
  };

  const colors = palette[variant];
  const dimensions: Record<ButtonSize, { height: number; paddingHorizontal: number; gap: number }> = {
    sm: { height: 36, paddingHorizontal: theme.spacing.md, gap: theme.spacing.xs },
    md: { height: 48, paddingHorizontal: theme.spacing.lg, gap: theme.spacing.sm },
    lg: { height: 56, paddingHorizontal: theme.spacing.xl, gap: theme.spacing.sm },
  };
  const sizeConfig = dimensions[size];

  const iconSize = size === 'sm' ? 16 : 20;
  const textVariant = size === 'sm' ? 'callout' : 'bodyStrong';

  const content = (
    <>
      {loading ? (
        <ActivityIndicator size="small" color={colors.text} />
      ) : (
        <View style={[styles.row, { gap: sizeConfig.gap }]}>
          {icon && iconPosition === 'leading' ? (
            <Ionicons name={icon} size={iconSize} color={colors.text} />
          ) : null}
          <AppText variant={textVariant} style={{ color: colors.text }}>
            {label}
          </AppText>
          {icon && iconPosition === 'trailing' ? (
            <Ionicons name={icon} size={iconSize} color={colors.text} />
          ) : null}
        </View>
      )}
    </>
  );

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      accessibilityHint={accessibilityHint}
      testID={testID}
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        {
          height: sizeConfig.height,
          paddingHorizontal: sizeConfig.paddingHorizontal,
          borderRadius: theme.radius.md,
          backgroundColor: colors.background,
          borderWidth: StyleSheet.hairlineWidth * 2,
          borderColor: colors.border,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: isDisabled ? 0.5 : pressed ? 0.85 : 1,
          alignSelf: fullWidth ? 'stretch' : 'flex-start',
        },
        style,
      ]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
