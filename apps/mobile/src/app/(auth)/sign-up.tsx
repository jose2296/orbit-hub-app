import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { GoogleSignInButton } from '@/components/auth/google-sign-in-button';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { AppText } from '@/components/ui/text';
import { useSession } from '@/hooks/use-session';
import { toApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/theme';

export default function SignUpScreen() {
  const theme = useTheme();
  const { locale, t } = useI18n();
  const router = useRouter();
  const { register } = useSession();

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function validate(): string | null {
    if (!email.includes('@')) return t('auth.invalidEmail');
    if (password.length < 10) return t('auth.passwordTooShort');
    if (password !== passwordConfirm) return t('auth.passwordMismatch');
    if (!acceptedTerms) return t('auth.termsAccept');
    return null;
  }

  async function onSubmit() {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      const status = await register({
        email: email.trim(),
        password,
        displayName: displayName.trim(),
        locale,
      });

      if (status === 'authenticated') {
        router.replace('/(app)/(tabs)');
        return;
      }

      router.push({ pathname: '/(auth)/verify-email', params: { email: email.trim() } });
    } catch (caught) {
      const apiError = toApiError(caught);
      setError(
        apiError.kind === 'conflict'
          ? t('auth.error.emailTaken')
          : apiError.kind === 'network' || apiError.kind === 'timeout'
            ? t('auth.error.network')
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
        <AppText variant="title">{t('auth.signUp.title')}</AppText>
        <AppText variant="callout" tone="muted">
          {t('auth.signUp.subtitle')}
        </AppText>
      </View>

      <GoogleSignInButton />

      <Card variant="muted" style={{ gap: theme.spacing.md }}>
        <TextField
          label={t('auth.displayName')}
          value={displayName}
          onChangeText={setDisplayName}
          autoComplete="name"
          textContentType="name"
          autoCapitalize="words"
          returnKeyType="next"
        />
        <TextField
          label={t('auth.email')}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          inputMode="email"
          textContentType="emailAddress"
          returnKeyType="next"
        />
        <TextField
          label={t('auth.password')}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="next"
        />
        <TextField
          label={t('auth.passwordConfirm')}
          value={passwordConfirm}
          onChangeText={setPasswordConfirm}
          secureTextEntry
          autoComplete="new-password"
          returnKeyType="go"
          onSubmitEditing={() => {
            void onSubmit();
          }}
        />

        <Checkbox
          checked={acceptedTerms}
          onToggle={() => setAcceptedTerms((value) => !value)}
          label={t('auth.termsAccept')}
        />

        {error ? (
          <AppText variant="caption" tone="danger">
            {error}
          </AppText>
        ) : null}

        <Button label={t('auth.submit.signUp')} onPress={() => void onSubmit()} loading={submitting} />
      </Card>

      <View style={{ gap: theme.spacing.sm }}>
        <AppText variant="callout" tone="muted" align="center">
          {t('auth.hasAccount')}
        </AppText>
        <Link href="/(auth)/sign-in" asChild>
          <Button label={t('onboarding.signIn')} variant="secondary" />
        </Link>
      </View>
    </Screen>
  );
}
