import { Redirect, Stack } from 'expo-router';

import { useSession } from '@/hooks/use-session';
import { useTheme } from '@/theme';

export default function OnboardingLayout() {
  const theme = useTheme();
  const { status } = useSession();

  // Onboarding is for people without an account. A signed in user who opens it
  // directly, or whose session is restored while it is on screen, belongs in the
  // app.
  if (status === 'loading') return null;
  if (status === 'authenticated') return <Redirect href="/(app)/(tabs)" />;

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: theme.colors.background },
        animation: 'slide_from_right',
      }}
    />
  );
}
