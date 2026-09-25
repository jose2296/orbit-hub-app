import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { WIDGET_ICON } from '@/components/dashboard/widget-presentation';
import { WidgetPreview } from '@/components/dashboard/widget-preview';
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
import { pluralKey, useTranslation } from '@/lib/i18n';
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
                subtitle={t(pluralKey('workspaces.members', workspace.memberCount), { count: workspace.memberCount })}
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
          <Card key={widget.id} style={{ gap: theme.spacing.md }}>
            <View style={[styles.row, { gap: theme.spacing.md }]}>
              <View
                style={[
                  styles.icon,
                  { backgroundColor: theme.colors.accentSoft, borderRadius: theme.radius.md },
                ]}
              >
                <Ionicons name={WIDGET_ICON[widget.kind]} size={16} color={theme.colors.accentSoftText} />
              </View>
              <AppText variant="bodyStrong" style={styles.flex}>
                {t(WIDGET_CATALOG[widget.kind].labelKey as TranslationKey)}
              </AppText>
            </View>
            {/* The content, not a promise of content: the data has been in the
                cache since the first sync. */}
            <WidgetPreview widget={widget} workspaceCount={workspaces.length} />
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
  icon: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
