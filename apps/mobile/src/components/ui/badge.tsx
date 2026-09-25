import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';
import type { ViewStyle } from 'react-native';

import { useTheme } from '@/theme';

import type { IconName } from './button';
import { AppText } from './text';

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

export interface BadgeProps {
  label: string;
  tone?: BadgeTone;
  icon?: IconName;
  style?: ViewStyle;
}

export function Badge({ label, tone = 'neutral', icon, style }: BadgeProps) {
  const theme = useTheme();

  const tones: Record<BadgeTone, { background: string; text: string }> = {
    neutral: { background: theme.colors.surfaceMuted, text: theme.colors.textMuted },
    accent: { background: theme.colors.accentSoft, text: theme.colors.accentSoftText },
    success: { background: theme.colors.successSoft, text: theme.colors.success },
    warning: { background: theme.colors.warningSoft, text: theme.colors.warning },
    danger: { background: theme.colors.dangerSoft, text: theme.colors.danger },
    info: { background: theme.colors.infoSoft, text: theme.colors.info },
  };

  const palette = tones[tone];

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: palette.background,
          borderRadius: theme.radius.pill,
          paddingHorizontal: theme.spacing.md,
          paddingVertical: theme.spacing.xs,
          gap: theme.spacing.xs,
        },
        style,
      ]}
    >
      {icon ? <Ionicons name={icon} size={12} color={palette.text} /> : null}
      <AppText variant="caption" style={{ color: palette.text }}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
  },
});
