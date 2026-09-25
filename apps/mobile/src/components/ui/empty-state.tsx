import { StyleSheet, View } from 'react-native';
import type { ViewStyle } from 'react-native';

import { useTheme } from '@/theme';

import type { IconName } from './button';
import { AppText } from './text';

export interface EmptyStateProps {
  icon?: IconName;
  title: string;
  description?: string;
  action?: React.ReactNode;
  style?: ViewStyle;
  compact?: boolean;
}

/**
 * Empty is a designed state, not a blank screen: it explains what will appear
 * here and offers the next action.
 */
export function EmptyState({ icon, title, description, action, style, compact = false }: EmptyStateProps) {
  const theme = useTheme();

  return (
    <View
      style={[
        styles.container,
        {
          gap: theme.spacing.sm,
          paddingVertical: compact ? theme.spacing.lg : theme.spacing.xxl,
          paddingHorizontal: theme.spacing.lg,
        },
        style,
      ]}
    >
      {icon ? (
        <View
          style={[
            styles.icon,
            {
              backgroundColor: theme.colors.accentSoft,
              borderRadius: theme.radius.pill,
              marginBottom: theme.spacing.xs,
            },
          ]}
        >
          <AppText variant="title" style={{ color: theme.colors.accentSoftText }}>
            {icon === 'sparkles' ? '✦' : '◦'}
          </AppText>
        </View>
      ) : null}
      <AppText variant="heading" align="center">
        {title}
      </AppText>
      {description ? (
        <AppText variant="callout" tone="muted" align="center">
          {description}
        </AppText>
      ) : null}
      {action ? <View style={{ marginTop: theme.spacing.sm }}>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
