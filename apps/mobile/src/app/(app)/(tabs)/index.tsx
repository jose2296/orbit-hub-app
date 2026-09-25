import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { WIDGET_ICON, widgetBody } from '@/components/dashboard/widget-presentation';
import { SyncStatusCard } from '@/components/sync/sync-status-card';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ListRow, SectionHeader } from '@/components/ui/list-row';
import { Screen } from '@/components/ui/screen';
import { AppText } from '@/components/ui/text';
import { useDashboard } from '@/hooks/use-dashboard';
import { useSession } from '@/hooks/use-session';
import { useWorkspaces } from '@/hooks/use-workspaces';
import { WIDGET_CATALOG } from '@/lib/dashboard/layout';
import { useTranslation } from '@/lib/i18n';
import { useTheme } from '@/theme';
import type { TranslationKey } from '@/lib/i18n';

export default function HomeScreen() {
  const theme = useTheme();
  const t = useTranslation();
  const router = useRouter();
  const { user } = useSession();
  const { workspaces, isLoading } = useWorkspaces();
  const { layout } = useDashboard();

  const recent = workspaces.slice(0, 3);

  return (
    <Screen>
      <View style={styles.header}>
        <View style={{ gap: theme.spacing.xxs }}>
          <AppText variant="title">{t('home.greeting', { name: user?.displayName ?? '' })}</AppText>
          <AppText variant="callout" tone="muted">
            {user?.email}
          </AppText>
        </View>
      </View>

      <SyncStatusCard onPress={() => router.push('/(app)/sync')} />

      <View style={{ gap: theme.spacing.md }}>
        <SectionHeader
          title={t('home.workspaces.title')}
          actionLabel={t('home.workspaces.all')}
          onAction={() => router.push('/(app)/workspaces')}
        />

        {isLoading ? (
          <Card variant="muted">
            <AppText variant="callout" tone="muted" align="center">
              {t('common.loading')}
            </AppText>
          </Card>
        ) : recent.length === 0 ? (
          <Card padded={false}>
            <EmptyState
              compact
              title={t('home.workspaces.empty.title')}
              description={t('home.workspaces.empty.body')}
            />
          </Card>
        ) : (
          <Card padded={false}>
            {recent.map((workspace) => (
              <ListRow
                key={workspace.id}
                title={workspace.name}
                subtitle={t('workspaces.members', { count: workspace.memberCount })}
                chevron
                onPress={() => router.push(`/(app)/workspace/${workspace.id}`)}
              />
            ))}
          </Card>
        )}
      </View>

      <View style={{ gap: theme.spacing.md }}>
        <SectionHeader
          title={t('dashboard.title')}
          actionLabel={t('home.dashboard.customise')}
          onAction={() => router.push('/(app)/dashboard')}
        />
        {layout.slice(0, 3).map((widget) => (
          <Card key={widget.id} style={{ gap: theme.spacing.sm }}>
            <View style={[styles.row, { gap: theme.spacing.md }]}>
              <Ionicons name={WIDGET_ICON[widget.kind]} size={18} color={theme.colors.accentSoftText} />
              <View style={styles.flex}>
                <AppText variant="bodyStrong">
                  {t(WIDGET_CATALOG[widget.kind].labelKey as TranslationKey)}
                </AppText>
                <AppText variant="caption" tone="subtle">
                  {widgetBody(t, widget.kind, workspaces.length)}
                </AppText>
              </View>
            </View>
          </Card>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  flex: {
    flex: 1,
  },
});
