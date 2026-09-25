import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';
import type { ViewStyle } from 'react-native';

import { useTheme } from '@/theme';

import type { IconName } from './button';
import { AppText } from './text';

export interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
  style?: ViewStyle;
}

export function SectionHeader({ title, subtitle, actionLabel, onAction, style }: SectionHeaderProps) {
  const theme = useTheme();

  return (
    <View style={[styles.row, { gap: theme.spacing.md }, style]}>
      <View style={styles.flex}>
        <AppText variant="heading">{title}</AppText>
        {subtitle ? (
          <AppText variant="caption" tone="muted">
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {actionLabel && onAction ? (
        <Pressable
          accessibilityRole="button"
          onPress={onAction}
          hitSlop={8}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          <AppText variant="callout" tone="accent">
            {actionLabel}
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

export interface ListRowProps {
  title: string;
  subtitle?: string;
  icon?: IconName;
  onPress?: () => void;
  rightLabel?: string;
  chevron?: boolean;
  destructive?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
}

/** Settings/list row used across the app so touch targets stay consistent. */
export function ListRow({
  title,
  subtitle,
  icon,
  onPress,
  rightLabel,
  chevron = false,
  destructive = false,
  disabled = false,
  style,
}: ListRowProps) {
  const theme = useTheme();

  const content = (
    <>
      {icon ? (
        <View
          style={[
            styles.icon,
            {
              backgroundColor: destructive ? theme.colors.dangerSoft : theme.colors.accentSoft,
              borderRadius: theme.radius.sm,
            },
          ]}
        >
          <Ionicons
            name={icon}
            size={18}
            color={destructive ? theme.colors.danger : theme.colors.accentSoftText}
          />
        </View>
      ) : null}
      <View style={styles.flex}>
        <AppText variant="bodyStrong" tone={destructive ? 'danger' : 'default'}>
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="caption" tone="muted">
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {rightLabel ? (
        <AppText variant="callout" tone="muted">
          {rightLabel}
        </AppText>
      ) : null}
      {chevron ? <Ionicons name="chevron-forward" size={18} color={theme.colors.textSubtle} /> : null}
    </>
  );

  if (!onPress) {
    return (
      <View style={[styles.row, { gap: theme.spacing.md, paddingVertical: theme.spacing.md }, style]}>
        {content}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          gap: theme.spacing.md,
          paddingVertical: theme.spacing.md,
          opacity: disabled ? 0.5 : pressed ? 0.6 : 1,
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
  flex: {
    flex: 1,
  },
  icon: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
