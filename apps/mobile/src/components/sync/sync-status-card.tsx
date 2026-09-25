import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { useSyncStatus } from '@/hooks/use-sync-status';
import { pluralKey, useTranslation } from '@/lib/i18n';
import { useTheme } from '@/theme';

import { Badge } from '@/components/ui/badge';
import type { BadgeTone } from '@/components/ui/badge';
import { AppText } from '@/components/ui/text';

/**
 * Compact sync indicator for the home screen. It reports the local queue, so
 * it stays truthful with no connectivity.
 */
export function SyncStatusCard({ onPress }: { onPress: () => void }) {
  const theme = useTheme();
  const t = useTranslation();
  const { status } = useSyncStatus();

  const tone: BadgeTone =
    status.state === 'offline'
      ? 'warning'
      : status.state === 'blocked'
        ? 'danger'
        : status.state === 'error'
          ? 'danger'
          : 'success';

  const badgeLabel =
    status.state === 'offline'
      ? t('common.offline')
      : status.state === 'syncing'
        ? t('sync.state.syncing')
        : status.state === 'blocked'
          ? t('sync.state.blocked')
          : status.state === 'error'
            ? t('sync.state.error')
            : t('sync.state.idle');

  const icon: keyof typeof Ionicons.glyphMap =
    status.state === 'offline'
      ? 'cloud-offline-outline'
      : status.state === 'blocked'
        ? 'alert-circle-outline'
        : status.state === 'error'
          ? 'warning-outline'
          : status.state === 'syncing'
            ? 'sync'
            : 'cloud-done-outline';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('home.sync.open')}
      onPress={onPress}
      style={({ pressed }) => [
        styles.container,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          borderRadius: theme.radius.lg,
          padding: theme.spacing.lg,
          gap: theme.spacing.md,
          opacity: pressed ? 0.9 : 1,
        },
      ]}
    >
      <View style={[styles.row, { gap: theme.spacing.md }]}>
        <View
          style={[
            styles.icon,
            { backgroundColor: theme.colors.surfaceMuted, borderRadius: theme.radius.md },
          ]}
        >
          <Ionicons name={icon} size={20} color={theme.colors.text} />
        </View>
        <View style={styles.flex}>
          <AppText variant="bodyStrong">{t('home.sync.title')}</AppText>
          <AppText variant="caption" tone="muted">
            {status.pendingOperations > 0
              ? t(pluralKey('home.sync.pending', status.pendingOperations), { count: status.pendingOperations })
              : status.state === 'offline'
                ? t('home.sync.offline')
                : t('home.sync.online')}
          </AppText>
        </View>
        <Badge label={badgeLabel} tone={tone} />
      </View>

      {status.pendingConflicts > 0 ? (
        <AppText variant="caption" tone="danger">
          {t('home.sync.conflicts', { count: status.pendingConflicts })}
        </AppText>
      ) : null}

      <View style={[styles.row, { gap: theme.spacing.xs }]}>
        <AppText variant="caption" tone="accent">
          {t('home.sync.open')}
        </AppText>
        <Ionicons name="chevron-forward" size={14} color={theme.colors.accent} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: StyleSheet.hairlineWidth,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  flex: {
    flex: 1,
  },
  icon: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
