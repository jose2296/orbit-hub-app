import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { AppText } from '@/components/ui/text';
import { GoogleSignInButton } from '@/components/auth/google-sign-in-button';
import { useSession } from '@/hooks/use-session';
import { toApiError } from '@/lib/api';
import { useTranslation } from '@/lib/i18n';
import { useTheme } from '@/theme';

export default function SignInScreen() {
  const theme = useTheme();
  const t = useTranslation();
  const router = useRouter();
  const { signIn } = useSession();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit() {
    setError(null);

    if (!email.includes('@')) {
      setError(t('auth.invalidEmail'));
      return;
    }

    setSubmitting(true);
    try {
      const result = await signIn(email.trim(), password);

      if (result === 'email_verification_required') {
        router.push({ pathname: '/(auth)/verify-email', params: { email: email.trim() } });
        return;
      }

      router.replace('/(app)/(tabs)');
    } catch (caught) {
      const apiError = toApiError(caught);
      setError(
        apiError.kind === 'network' || apiError.kind === 'timeout'
          ? t('auth.error.network')
          : apiError.kind === 'unauthorized'
            ? t('auth.error.invalidCredentials')
            : apiError.kind === 'rate_limited'
              ? t('auth.error.tooManyAttempts')
              : apiError.message || t('auth.error.generic'),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen>
      <View style={{ gap: theme.spacing.xs }}>
        <AppText variant="title">{t('auth.signIn.title')}</AppText>
        <AppText variant="callout" tone="muted">
          {t('auth.signIn.subtitle')}
        </AppText>
      </View>

      <GoogleSignInButton />

      <View style={[styles.divider, { gap: theme.spacing.md }]}>
        <View style={[styles.line, { backgroundColor: theme.colors.border }]} />
        <AppText variant="caption" tone="subtle">
          {t('auth.googleDivider')}
        </AppText>
        <View style={[styles.line, { backgroundColor: theme.colors.border }]} />
      </View>

      <Card variant="muted" style={{ gap: theme.spacing.md }}>
        <TextField
          label={t('auth.email')}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          inputMode="email"
          textContentType="emailAddress"
          placeholder="nombre@ejemplo.com"
          returnKeyType="next"
        />
        <TextField
          label={t('auth.password')}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={() => {
            void onSubmit();
          }}
        />

        {error ? (
          <AppText variant="caption" tone="danger">
            {error}
          </AppText>
        ) : null}

        <Button label={t('auth.submit.signIn')} onPress={() => void onSubmit()} loading={submitting} />

        <Link href="/(auth)/forgot-password" asChild>
          <Button label={t('auth.forgotPassword')} variant="ghost" />
        </Link>
      </Card>

      <View style={{ gap: theme.spacing.sm }}>
        <AppText variant="callout" tone="muted" align="center">
          {t('auth.noAccount')}
        </AppText>
        <Link href="/(auth)/sign-up" asChild>
          <Button label={t('onboarding.createAccount')} variant="secondary" />
        </Link>
      </View>
    </Screen>
  );
}

const styles = {
  divider: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
  },
  line: {
    flex: 1,
    height: 1,
  },
};
