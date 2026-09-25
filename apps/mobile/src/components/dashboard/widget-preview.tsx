import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import type { DashboardWidget, ListKind } from '@orbit-hub/contracts';

import { useRecentLists, useTaskPreview } from '@/hooks/use-dashboard-preview';
import { pluralKey, useTranslation } from '@/lib/i18n';
import type { TranslationKey } from '@/lib/i18n';
import { useTheme } from '@/theme';

import { AppText } from '../ui/text';
import { Checkbox } from '../ui/checkbox';

export interface WidgetPreviewProps {
  widget: DashboardWidget;
  workspaceCount: number;
}

const KIND_ICON: Record<ListKind, keyof typeof Ionicons.glyphMap> = {
  tasks: 'checkbox-outline',
  movies: 'film-outline',
  books: 'book-outline',
};

/**
 * A widget with its actual content.
 *
 * The dashboard screen exists to arrange widgets, so there a card is a title and
 * a line of text. On the home screen the same widget is the content itself: a
 * panel that says "your pending tasks will appear here" is a promise, and the
 * data to keep it has been in the cache since the first sync.
 *
 * Notes and the calendar have no data yet, so they say so in one line rather
 * than showing an empty box.
 */
export function WidgetPreview({ widget, workspaceCount }: WidgetPreviewProps) {
  switch (widget.kind) {
    case 'quick_actions':
      return <QuickActions />;
    case 'tasks':
      return <PendingTasks />;
    case 'recent_lists':
      return <RecentLists />;
    case 'stats':
      return <Stats workspaceCount={workspaceCount} />;
    default:
      return <Pending body="dashboard.body.notesSoon" />;
  }
}

function Pending({ body }: { body: TranslationKey }) {
  const t = useTranslation();
  return (
    <AppText variant="caption" tone="muted">
      {t(body)}
    </AppText>
  );
}

/** Shortcuts to the lists, which is what the widget is for. */
function QuickActions() {
  const theme = useTheme();
  const router = useRouter();
  const { lists } = useRecentLists(3);

  if (lists.length === 0) {
    return <Pending body="dashboard.body.noLists" />;
  }

  return (
    <View style={[styles.chips, { gap: theme.spacing.sm }]}>
      {lists.map((list) => (
        <Pressable
          key={list.id}
          accessibilityRole="button"
          accessibilityLabel={list.title}
          onPress={() => router.push(`/(app)/list/${list.id}`)}
          style={({ pressed }) => [
            styles.chip,
            {
              backgroundColor: theme.colors.surfaceMuted,
              borderRadius: theme.radius.pill,
              paddingHorizontal: theme.spacing.md,
              paddingVertical: theme.spacing.sm,
              opacity: pressed ? 0.7 : 1,
            },
          ]}
        >
          <Ionicons name={KIND_ICON[list.kind]} size={13} color={theme.colors.textMuted} />
          <AppText variant="caption" numberOfLines={1}>
            {list.title}
          </AppText>
        </Pressable>
      ))}
    </View>
  );
}

/** The tasks that are waiting, with the list they belong to. */
function PendingTasks() {
  const theme = useTheme();
  const t = useTranslation();
  const router = useRouter();
  const { rows, isLoading, toggle } = useTaskPreview();

  if (isLoading) {
    return <Pending body="common.loading" />;
  }

  if (rows.length === 0) {
    return <Pending body="dashboard.body.noTasks" />;
  }

  return (
    <View style={{ gap: theme.spacing.xs }}>
      {rows.map(({ item, listId, listTitle }) => (
        /* The checkbox and the title are two separate targets rather than one
           row that opens the list: on the web a click inside a pressable
           bubbles to it, so a nested checkbox would tick the task and open the
           list at the same time. */
        <View key={item.id} style={styles.task}>
          <Checkbox checked={false} onToggle={() => void toggle(item)} label="" />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={item.title}
            onPress={() => router.push(`/(app)/list/${listId}`)}
            style={({ pressed }) => [styles.flex, { opacity: pressed ? 0.7 : 1 }]}
          >
            <AppText variant="body" numberOfLines={1}>
              {item.title}
            </AppText>
            <AppText variant="caption" tone="subtle" numberOfLines={1}>
              {listTitle}
            </AppText>
          </Pressable>
        </View>
      ))}
      <AppText variant="caption" tone="subtle">
        {t(pluralKey('dashboard.body.pendingIn', rows.length), { count: rows.length })}
      </AppText>
    </View>
  );
}

/** The lists worked on last. */
function RecentLists() {
  const theme = useTheme();
  const t = useTranslation();
  const router = useRouter();
  const { lists } = useRecentLists(4);

  if (lists.length === 0) {
    return <Pending body="dashboard.body.noLists" />;
  }

  return (
    <View style={{ gap: theme.spacing.xs }}>
      {lists.map((list) => (
        <Pressable
          key={list.id}
          accessibilityRole="button"
          accessibilityLabel={list.title}
          onPress={() => router.push(`/(app)/list/${list.id}`)}
          style={({ pressed }) => [styles.task, { opacity: pressed ? 0.7 : 1 }]}
        >
          <Ionicons name={KIND_ICON[list.kind]} size={16} color={theme.colors.textMuted} />
          <View style={styles.flex}>
            <AppText variant="body" numberOfLines={1}>
              {list.title}
            </AppText>
          </View>
          <AppText variant="caption" tone="subtle">
            {t(pluralKey('lists.itemCount', list.itemCount), { count: list.itemCount })}
          </AppText>
        </Pressable>
      ))}
    </View>
  );
}

function Stats({ workspaceCount }: { workspaceCount: number }) {
  const theme = useTheme();
  const t = useTranslation();
  const { lists } = useRecentLists(Number.MAX_SAFE_INTEGER);

  const rows: { label: string; value: string }[] = [
    { label: t('dashboard.body.spaces'), value: String(workspaceCount) },
    { label: t('dashboard.body.lists'), value: String(lists.length) },
  ];

  return (
    <View style={[styles.stats, { gap: theme.spacing.lg }]}>
      {rows.map((row) => (
        <View key={row.label} style={styles.flex}>
          <AppText variant="heading">{row.value}</AppText>
          <AppText variant="caption" tone="muted">
            {row.label}
          </AppText>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: '100%',
  },
  task: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  stats: {
    flexDirection: 'row',
  },
  flex: {
    flex: 1,
  },
});
