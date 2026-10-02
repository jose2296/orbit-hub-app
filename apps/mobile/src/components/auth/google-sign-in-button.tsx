import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useGoogleAuthRequest } from '@/lib/auth/google-auth';
import { useTranslation } from '@/lib/i18n';
import { useTheme } from '@/theme';

import { AppText } from '@/components/ui/text';

/**
 * Google sign-in is wired but disabled until the OAuth client exists, so the UI
 * never fails at tap time. See docs/architecture/auth.md.
 */
export function GoogleSignInButton() {
  const theme = useTheme();
  const t = useTranslation();
  const { isConfigured, promptAsync, isLoading } = useGoogleAuthRequest();
  const [fallo, setFallo] = useState<string | null>(null);

  return (
    <View style={{ gap: theme.spacing.xs }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !isConfigured, busy: isLoading }}
        disabled={!isConfigured || isLoading}
        onPress={() => {
          /*
           * Antes esto era `void promptAsync()` y nada más: si el canje fallaba,
           * la promesa se rechazaba sola y **no se veía ningún error**. Un login
           * roto era indistinguible de un login que no se había intentado, y
           * durante horas eso fue justo lo que pasó: dos bugs distintos
           * —un crash y un canje descartado—looked igual desde fuera.
           *
           * Ahora el fallo se dice, y se dice **qué** fue: sin eso hay que
           * adivinar, y adivinar mal cuesta una build entera.
           */
          setFallo(null);
          void promptAsync().catch((error: unknown) => {
            const motivo =
              error instanceof Error ? error.message : String(error);
            setFallo(
              motivo === 'GOOGLE_LOGIN_CANCELLED'
                ? t('auth.google.cancelled')
                : `${t('auth.google.failed')}\n\n${motivo}`,
            );
          });
        }}
        style={({ pressed }) => [
          styles.container,
          {
            gap: theme.spacing.sm,
            borderColor: theme.colors.borderStrong,
            borderRadius: theme.radius.md,
            backgroundColor: theme.colors.surface,
            minHeight: 48,
            opacity: !isConfigured ? 0.5 : pressed ? 0.85 : 1,
          },
        ]}
      >
        <Ionicons name="logo-google" size={18} color={theme.colors.text} />
        <AppText variant="bodyStrong">{t('auth.google')}</AppText>
      </Pressable>
      {!isConfigured ? (
        <AppText variant="caption" tone="subtle" align="center">
          {t('auth.google.unavailable')}
        </AppText>
      ) : null}
      {fallo ? (
        <AppText variant="caption" tone="danger" align="center">
          {fallo}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
});
