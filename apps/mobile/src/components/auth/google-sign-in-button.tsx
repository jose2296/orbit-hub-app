import { Ionicons } from '@expo/vector-icons';
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

  return (
    <View style={{ gap: theme.spacing.xs }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !isConfigured, busy: isLoading }}
        disabled={!isConfigured || isLoading}
        onPress={() => {
          void promptAsync();
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
