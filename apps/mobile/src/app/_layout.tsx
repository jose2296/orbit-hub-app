import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { SessionProvider } from '@/hooks/use-session';
import { I18nProvider } from '@/lib/i18n';
import { ThemeProvider, useTheme } from '@/theme';

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const theme = useTheme();

  useEffect(() => {
    void SplashScreen.hideAsync();
  }, []);

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <I18nProvider>
          <SessionProvider>
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
          </SessionProvider>
        </I18nProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
