import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import type { ViewStyle } from 'react-native';

import { useTheme } from '@/theme';

import { useA11yHint } from './a11y-hint';
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
  /**
   * Draw only the icon and keep the label for the accessibility tree.
   *
   * For a header that has more than one action: measured on a 430-point phone,
   * two labelled buttons in the header of a list took 307 of the 398 points the
   * content column has, and the title was left 63 — which is a word and a half,
   * and the icon of the first button was drawn on top of it. The icon alone is
   * 36; the difference is the whole column.
   *
   * Only for an icon that names itself (a bookmark, three dots). If you have to
   * ask what the drawing means, it is not a candidate: an icon with no text and
   * no name is a button nobody can use.
   */
  iconOnly?: boolean;
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
  iconOnly = false,
  testID,
}: ButtonProps) {
  const theme = useTheme();
  const isDisabled = disabled || loading;

  // A fragment and not a wrapper `View`: the `Pressable` below is the root of
  // this component and it sets `alignSelf: 'stretch'`/`'flex-start'` and
  // `fullWidth`. Wrapping it in another element would take the width away.
  const pista = useA11yHint(accessibilityHint);

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
      ) : iconOnly ? (
        /*
         * The label is gone from the screen and **not** from the control:
         * `accessibilityLabel` below still says the whole thing, so a screen
         * reader announces "Quitar de favorita, botón" and a person with a
         * magnifying glass reads a bookmark. The drawing is 16 points and
         * nothing else, which is the whole point.
         */
        <Ionicons
          name={(icon ?? "ellipsis-horizontal") as never}
          size={iconSize + 4}
          color={colors.text}
        />
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
    <>
      <Pressable
        accessibilityRole="button"
        // Set even when the label is off screen, and it is the whole contract of
        // `iconOnly`: a button that shows a drawing and says nothing is a button
        // with two different names depending on how you ask.
        accessibilityLabel={label}
        accessibilityState={{ disabled: isDisabled, busy: loading }}
        {...pista.props}
        testID={testID}
        disabled={isDisabled}
        onPress={onPress}
        style={({ pressed }) => [
          {
            height: sizeConfig.height,
            // A square, not a pill with a word missing from it.
            minWidth: iconOnly ? sizeConfig.height : undefined,
            paddingHorizontal: iconOnly ? 0 : sizeConfig.paddingHorizontal,
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
      {pista.node}
    </>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
