import { Stack } from 'expo-router';

import { useTranslation } from '@/lib/i18n';
import { useTheme } from '@/theme';

export default function AuthLayout() {
  const theme = useTheme();
  const t = useTranslation();

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
      <Stack.Screen name="verify-email" options={{ title: t('auth.verify.title') }} />
    </Stack>
  );
}
