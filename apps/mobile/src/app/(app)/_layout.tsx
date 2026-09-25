import { Redirect, Stack } from 'expo-router';

import { useTranslation } from '@/lib/i18n';
import { useSession } from '@/hooks/use-session';
import { useTheme } from '@/theme';

/**
 * Auth guard. The session is restored before this layout renders, so the
 * redirect is stable and a signed out user never sees protected screens.
 */
export default function AppLayout() {
  const theme = useTheme();
  const t = useTranslation();
  const { status } = useSession();

  if (status === 'loading') {
    return null;
  }

  if (status === 'anonymous') {
    return <Redirect href="/(onboarding)/welcome" />;
  }

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: theme.colors.background },
        headerTintColor: theme.colors.text,
        headerTitleStyle: { fontWeight: '600' },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: theme.colors.background },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="workspaces" options={{ title: t('workspaces.title') }} />
      <Stack.Screen name="workspace/[workspaceId]" options={{ title: '' }} />
      <Stack.Screen name="sync" options={{ title: t('sync.title') }} />
      <Stack.Screen name="devices" options={{ title: t('settings.devices') }} />
    </Stack>
  );
}
