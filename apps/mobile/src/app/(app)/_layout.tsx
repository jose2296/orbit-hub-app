import { Redirect, Stack } from 'expo-router';

import { BackButton } from '@/components/ui/breadcrumbs';
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
        // The browser bar is not a navigation control: on the web there is no
        // swipe back, and the header is the only place a person looks for one.
        headerLeft: () => <BackButton />,
      }}
    >
      {/* Every screen below the tabs keeps the header. It is the back button
          and the name of the thing you are looking at, and a screen without it
          is a dead end: the only way out is the browser bar or a gesture. The
          titles that come from data are set by the screen itself. */}
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="dashboard" options={{ title: t('dashboard.title') }} />
      <Stack.Screen name="workspaces" options={{ title: t('workspaces.title') }} />
      <Stack.Screen name="workspace/[workspaceId]" options={{ title: '' }} />
      {/* One screen per folder level, so the back button leaves one level at a
          time instead of jumping out of the whole space. */}
      <Stack.Screen
        name="workspace/[workspaceId]/folder/[folderId]"
        options={{ title: '' }}
      />
      <Stack.Screen name="lists" options={{ title: t('lists.title') }} />
      <Stack.Screen name="list/[listId]" options={{ title: '' }} />
      <Stack.Screen name="sync" options={{ title: t('sync.title') }} />
      <Stack.Screen name="devices" options={{ title: t('settings.devices') }} />
      <Stack.Screen name="catalog" options={{ title: t('catalog.title') }} />
      <Stack.Screen name="item/[itemId]" options={{ title: '' }} />
    </Stack>
  );
}
