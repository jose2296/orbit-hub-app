import { Redirect, Stack } from 'expo-router';

import { useSession } from '@/hooks/use-session';
import { useTranslation } from '@/lib/i18n';
import { useTheme } from '@/theme';

export default function AuthLayout() {
  const theme = useTheme();
  const t = useTranslation();
  const { status } = useSession();

  // The guard lives here rather than in each screen: password sign-in, Google
  // sign-in and a restored session all end up in the same place, and an
  // authenticated user must never be left on a sign-in form. Google in
  // particular sets the session without navigating anywhere, so without this it
  // looked like the login had done nothing.
  if (status === 'loading') return null;
  if (status === 'authenticated') return <Redirect href="/(app)/(tabs)" />;

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: theme.colors.background },
        headerTintColor: theme.colors.accent,
        headerTitleStyle: { color: theme.colors.text, fontWeight: '600' },
        headerShadowVisible: false,
        headerBackButtonDisplayMode: 'minimal',
        contentStyle: { backgroundColor: theme.colors.background },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="sign-in" options={{ title: t('auth.signIn.title') }} />
      <Stack.Screen name="sign-up" options={{ title: t('auth.signUp.title') }} />
      <Stack.Screen name="forgot-password" options={{ title: t('auth.forgot.title') }} />
      <Stack.Screen name="reset-password" options={{ title: t('auth.reset.title') }} />
      <Stack.Screen name="verify-email" options={{ title: t('auth.verify.title') }} />
    </Stack>
  );
}
