import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { SyncStatusCard } from '@/components/sync/sync-status-card';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ListRow, SectionHeader } from '@/components/ui/list-row';
import { Screen } from '@/components/ui/screen';
import { AppText } from '@/components/ui/text';
import { useSession } from '@/hooks/use-session';
import { useWorkspaces } from '@/hooks/use-workspaces';
import { useTranslation } from '@/lib/i18n';
import { useTheme } from '@/theme';

export default function HomeScreen() {
  const theme = useTheme();
  const t = useTranslation();
  const router = useRouter();
  const { user } = useSession();
  const { workspaces, isLoading } = useWorkspaces();

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
        <SectionHeader title={t('home.upNext.title')} />
        <Card variant="muted">
          <AppText variant="callout" tone="muted">
            {t('home.upNext.body')}
          </AppText>
        </Card>
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
});
