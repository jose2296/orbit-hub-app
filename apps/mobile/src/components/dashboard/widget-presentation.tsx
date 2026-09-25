import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet } from 'react-native';

import type { DashboardWidget } from '@orbit-hub/contracts';

import { AppText } from '@/components/ui/text';
import { useTheme } from '@/theme';
import type { Translate } from '@/lib/i18n';

/** Icon per widget kind, shared by the dashboard screen and the home preview. */
export const WIDGET_ICON: Record<DashboardWidget['kind'], keyof typeof Ionicons.glyphMap> = {
  quick_actions: 'flash-outline',
  tasks: 'checkbox-outline',
  recent_lists: 'list-outline',
  recent_notes: 'document-text-outline',
  calendar: 'calendar-outline',
  stats: 'stats-chart-outline',
};

/**
 * One line of context per widget. Widgets whose data arrives in a later phase
 * say so instead of showing an empty box.
 */
export function widgetBody(
  t: Translate,
  kind: DashboardWidget['kind'],
  workspaceCount: number,
): string {
  switch (kind) {
    case 'quick_actions':
      return t('dashboard.body.quickActions');
    case 'tasks':
      return t('dashboard.body.tasks');
    case 'recent_lists':
      return t('dashboard.body.recentLists');
    case 'recent_notes':
      return t('dashboard.body.recentNotes');
    case 'calendar':
      return t('dashboard.body.calendar');
    case 'stats':
      return t('dashboard.body.stats', { count: workspaceCount });
    default:
      return '';
  }
}

export function IconAction({
  icon,
  label,
  onPress,
  destructive = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  destructive?: boolean;
}) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        {
          backgroundColor: destructive ? theme.colors.dangerSoft : theme.colors.surfaceMuted,
          borderRadius: theme.radius.sm,
          paddingHorizontal: theme.spacing.md,
          paddingVertical: theme.spacing.sm,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <Ionicons
        name={icon}
        size={16}
        color={destructive ? theme.colors.danger : theme.colors.textMuted}
      />
      <AppText variant="caption" tone={destructive ? 'danger' : 'muted'}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
});
