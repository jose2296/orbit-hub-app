import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as WebBrowser from 'expo-web-browser';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { SessionProvider, useSession } from '@/hooks/use-session';
import { I18nProvider, useTranslation } from '@/lib/i18n';
import { ThemeProvider, useTheme } from '@/theme';

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  // useTheme() only works below ThemeProvider, so nothing that reads the theme
  // may live in this component.
  return (
    // El gestor de gestos necesita su raiz. En nativo hace falta para que los
    // gestos seRegistren; en web es lo que pone `touch-action: none` a las
    // filas arrastrables, y sin eso el navegador se queda con el dedo para
    // desplazar la lista y el arrastre no llega a empezar nunca.
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <I18nProvider>
            <SessionProvider>
              <Navigation />
            </SessionProvider>
          </I18nProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function Navigation() {
  const theme = useTheme();
  const t = useTranslation();
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
        {/*
          No screen for `/` of its own any more.

          There was an `app/index.tsx` whose whole job was to look at the session
          and send you to the panel or to the welcome, and the panel is now
          `app/(app)/index.tsx` — so that file and this one both wanted the root
          path, and two routes for `/` is one of them silently losing.

          The decision did not go away with the file: the layout above already
          refuses to draw anything for somebody who is not signed in and sends
          them to the welcome, and it holds still while the session is being
          restored, so the flash of the wrong stack the old entry route existed to
          prevent is already prevented — by the guard, which has to run anyway.
        */}
        <Stack.Screen name="(onboarding)" options={{ headerShown: false }} />
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(app)" options={{ headerShown: false }} />
        {/* Outside the auth guard on purpose: the person who opens an
            invitation is the person who is not signed in yet. */}
        <Stack.Screen name="invite/[token]" options={{ title: t('invite.title') }} />
      </Stack>
    </>
  );
}
