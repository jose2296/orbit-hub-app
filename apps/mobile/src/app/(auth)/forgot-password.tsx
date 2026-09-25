import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { authClient, toAuthError } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { AppText } from '@/components/ui/text';
import { useTranslation } from '@/lib/i18n';
import { useTheme } from '@/theme';

export default function ForgotPasswordScreen() {
  const theme = useTheme();
  const t = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string }>();

  const [email, setEmail] = useState(params.email ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit() {
    if (!email.includes('@')) {
      setError(t('auth.invalidEmail'));
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      await authClient.requestPasswordReset(email.trim());
      setSent(true);
    } catch (caught) {
      const apiError = toAuthError(caught);
      // The API answers the same way for unknown accounts; only transport
      // failures are worth showing.
      if (apiError.kind === 'validation_failed') {
        setError(apiError.message);
      } else if (apiError.kind === 'network' || apiError.kind === 'timeout') {
        setError(t('auth.error.network'));
      } else {
        setSent(true);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen>
      <View style={{ gap: theme.spacing.xs }}>
        <AppText variant="title">{t('auth.forgot.title')}</AppText>
        <AppText variant="callout" tone="muted">
          {t('auth.forgot.body')}
        </AppText>
      </View>

      <Card variant="muted" style={{ gap: theme.spacing.md }}>
        {sent ? (
          <>
            <AppText variant="callout" tone="success">
              {t('auth.forgot.sent')}
            </AppText>
            <Button
              label={t('common.back')}
              variant="secondary"
              onPress={() => router.replace('/(auth)/sign-in')}
            />
          </>
        ) : (
          <>
            <TextField
              label={t('auth.email')}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              inputMode="email"
              textContentType="emailAddress"
              returnKeyType="send"
              onSubmitEditing={() => {
                void onSubmit();
              }}
            />
            {error ? (
              <AppText variant="caption" tone="danger">
                {error}
              </AppText>
            ) : null}
            <Button label={t('common.continue')} onPress={() => void onSubmit()} loading={submitting} />
          </>
        )}
      </Card>
    </Screen>
  );
}
