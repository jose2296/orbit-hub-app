import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { SyncStatusCard } from '@/components/sync/sync-status-card';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Screen } from '@/components/ui/screen';
import { SectionHeader } from '@/components/ui/list-row';
import { AppText } from '@/components/ui/text';
import { useSession } from '@/hooks/use-session';
import { useTranslation } from '@/lib/i18n';
import { useTheme } from '@/theme';

const NEXT_UP = [
  { icon: 'checkmark-circle-outline' as const, key: 'home.workspaces.title' as const },
  { icon: 'list-outline' as const, key: 'home.upNext.title' as const },
  { icon: 'document-text-outline' as const, key: 'onboarding.point.notes' as const },
  { icon: 'people-outline' as const, key: 'onboarding.point.collab' as const },
];

export default function HomeScreen() {
  const theme = useTheme();
  const t = useTranslation();
  const router = useRouter();
  const { user } = useSession();

  return (
    <Screen>
      <View style={styles.header}>
        <View style={{ gap: theme.spacing.xxs }}>
          <AppText variant="title">
            {t('home.greeting', { name: user?.displayName ?? '' })}
          </AppText>
          <AppText variant="callout" tone="muted">
            {user?.email}
          </AppText>
        </View>
      </View>

      <SyncStatusCard onPress={() => router.push('/(app)/sync')} />

      <View style={{ gap: theme.spacing.md }}>
        <SectionHeader title={t('home.workspaces.title')} />
        <Card padded={false}>
          <EmptyState
            icon="albums-outline"
            compact
            title={t('home.workspaces.empty.title')}
            description={t('home.workspaces.empty.body')}
          />
        </Card>
      </View>

      <View style={{ gap: theme.spacing.md }}>
        <SectionHeader title={t('home.upNext.title')} />
        <Card variant="muted" style={{ gap: theme.spacing.md }}>
          {NEXT_UP.map((item) => (
            <View key={item.key} style={[styles.row, { gap: theme.spacing.md }]}>
              <Ionicons name={item.icon} size={18} color={theme.colors.textMuted} />
              <AppText variant="callout" tone="muted" style={styles.flex}>
                {t(item.key)}
              </AppText>
            </View>
          ))}
          <AppText variant="caption" tone="subtle">
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  flex: {
    flex: 1,
  },
});
