import { Redirect } from 'expo-router';

import { useSession } from '@/hooks/use-session';

/**
 * Entry point. The session is restored from secure storage, so this screen
 * shows nothing while it resolves and never flashes the wrong stack.
 */
export default function IndexRoute() {
  const { status } = useSession();

  if (status === 'loading') {
    return null;
  }

  if (status === 'authenticated') {
    return <Redirect href="/(app)/(tabs)" />;
  }

  return <Redirect href="/(onboarding)/welcome" />;
}
