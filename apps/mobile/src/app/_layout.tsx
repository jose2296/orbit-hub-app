import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as WebBrowser from 'expo-web-browser';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { SessionProvider, useSession } from '@/hooks/use-session';
import { I18nProvider } from '@/lib/i18n';
import { ThemeProvider, useTheme } from '@/theme';

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  // useTheme() only works below ThemeProvider, so nothing that reads the theme
  // may live in this component.
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <I18nProvider>
          <SessionProvider>
            <Navigation />
          </SessionProvider>
        </I18nProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function Navigation() {
  const theme = useTheme();
  const { status } = useSession();

  useEffect(() => {
    // Expo requires this at the root of the app: a sign-in started in one tab
    // and finished in another only resumes if the page that receives the redirect
    // asks for it. It is a no-op when no auth session is in flight, and it can
    // throw if the opening window is gone, which must never take the app down.
    try {
      WebBrowser.maybeCompleteAuthSession();
    } catch {
      // The sign-in screen will offer to try again.
    }
  }, []);

  useEffect(() => {
    // Hiding the splash on mount shows a blank frame while the session is
    // restored and the entry route decides where to send the user.
    if (status !== 'loading') {
      void SplashScreen.hideAsync();
    }
  }, [status]);

  return (
    <>
      <StatusBar style={theme.scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: theme.colors.background },
          headerTintColor: theme.colors.text,
          headerTitleStyle: { fontWeight: '600' },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: theme.colors.background },
          animation: 'fade',
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="(onboarding)" options={{ headerShown: false }} />
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(app)" options={{ headerShown: false }} />
      </Stack>
    </>
  );
}
