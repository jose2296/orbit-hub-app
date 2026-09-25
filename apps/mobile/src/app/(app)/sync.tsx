import { StyleSheet, View } from 'react-native';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Screen } from '@/components/ui/screen';
import { SectionHeader } from '@/components/ui/list-row';
import { AppText } from '@/components/ui/text';
import { useSyncStatus } from '@/hooks/use-sync-status';
import { pluralKey, useTranslation } from '@/lib/i18n';
import { useTheme } from '@/theme';
import type { TranslationKey } from '@/lib/i18n';

/**
 * Sync centre: what is queued on this device, what needs a decision, and a
 * manual retry. Everything is read from the local store, so it is accurate
 * offline.
 */
export default function SyncScreen() {
  const theme = useTheme();
  const t = useTranslation();
  const { status, pending, conflicts, isSyncing, syncNow } = useSyncStatus();

  const operationLabels: Record<'create' | 'update' | 'delete', TranslationKey> = {
    create: 'sync.operation.create',
    update: 'sync.operation.update',
    delete: 'sync.operation.delete',
  };

  return (
    <Screen>
      <Card variant="muted" style={{ gap: theme.spacing.sm }}>
        <AppText variant="heading">{t('sync.subtitle')}</AppText>
        <AppText variant="caption" tone="muted">
          {status.lastSyncedAt
            ? t('sync.lastSynced', {
                value: new Date(status.lastSyncedAt).toLocaleString(),
              })
            : t('sync.never')}
        </AppText>
        <Button
          label={isSyncing ? t('sync.syncing') : t('sync.syncNow')}
          onPress={() => void syncNow()}
          loading={isSyncing}
        />
      </Card>

      <View style={{ gap: theme.spacing.md }}>
        <SectionHeader
          title={t('sync.pending.title')}
          subtitle={
            status.pendingOperations > 0
              ? t(pluralKey('home.sync.pending', status.pendingOperations), { count: status.pendingOperations })
              : undefined
          }
        />
        <Card padded={false}>
          {pending.length === 0 ? (
            <EmptyState compact title={t('sync.pending.empty')} />
          ) : (
            pending.map((operation) => (
              <View
                key={operation.operationId}
                style={[
                  styles.row,
                  {
                    gap: theme.spacing.md,
                    padding: theme.spacing.lg,
                    borderTopWidth: StyleSheet.hairlineWidth,
                    borderTopColor: theme.colors.border,
                  },
                ]}
              >
                <View style={styles.flex}>
                  <AppText variant="bodyStrong">
                    {operationLabels[operation.kind]} · {operation.entity}
                  </AppText>
                  <AppText variant="caption" tone="muted">
                    {new Date(operation.createdAt).toLocaleString()}
                    {operation.attempts > 0 ? ` · ${operation.attempts}` : ''}
                  </AppText>
                  {operation.lastError ? (
                    <AppText variant="caption" tone="danger">
                      {operation.lastError}
                    </AppText>
                  ) : null}
                </View>
                <Badge label={t('sync.operation.pending')} tone="warning" />
              </View>
            ))
          )}
        </Card>
      </View>

      <View style={{ gap: theme.spacing.md }}>
        <SectionHeader title={t('sync.conflicts.title')} />
        <Card padded={false}>
          {conflicts.length === 0 ? (
            <EmptyState compact title={t('sync.conflicts.empty')} />
          ) : (
            conflicts.map((conflict) => (
              <View
                key={conflict.id}
                style={[
                  styles.row,
                  {
                    gap: theme.spacing.md,
                    padding: theme.spacing.lg,
                    borderTopWidth: StyleSheet.hairlineWidth,
                    borderTopColor: theme.colors.border,
                  },
                ]}
              >
                <View style={styles.flex}>
                  <AppText variant="bodyStrong">
                    {conflict.entity} · {conflict.entityId.slice(0, 8)}
                  </AppText>
                  <AppText variant="caption" tone="muted">
                    {conflict.conflictingFields.join(', ')}
                  </AppText>
                </View>
                <Badge label={t('sync.state.blocked')} tone="danger" />
              </View>
            ))
          )}
        </Card>
      </View>
    </Screen>
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
});
