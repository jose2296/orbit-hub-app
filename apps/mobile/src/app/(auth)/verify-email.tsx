import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';

import { authClient, toAuthError } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Screen } from '@/components/ui/screen';
import { AppText } from '@/components/ui/text';
import { useTranslation } from '@/lib/i18n';
import { useTheme } from '@/theme';

export default function VerifyEmailScreen() {
  const theme = useTheme();
  const t = useTranslation();
  const router = useRouter();
  const { email } = useLocalSearchParams<{ email?: string }>();

  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onResend() {
    if (!email) {
      setError(t('auth.verify.missingEmail'));
      return;
    }

    setError(null);
    setResending(true);
    try {
      await authClient.resendVerification(email);
      setResent(true);
    } catch (caught) {
      setError(toAuthError(caught).message || t('auth.error.generic'));
    } finally {
      setResending(false);
    }
  }

  return (
    <Screen>
      <EmptyState
        icon="mail-outline"
        title={t('auth.verify.title')}
        description={email ? `${t('auth.verify.body')}\n\n${email}` : t('auth.verify.body')}
      />

      <Card variant="muted" style={{ gap: theme.spacing.md }}>
        {resent ? (
          <AppText variant="callout" tone="success" align="center">
            {t('auth.forgot.sent')}
          </AppText>
        ) : null}
        {error ? (
          <AppText variant="caption" tone="danger" align="center">
            {error}
          </AppText>
        ) : null}
        <Button
          label={t('auth.verify.resend')}
          variant="secondary"
          onPress={() => void onResend()}
          loading={resending}
        />
        <Button
          label={t('auth.verify.backToSignIn')}
          variant="ghost"
          onPress={() => router.replace('/(auth)/sign-in')}
        />
      </Card>
    </Screen>
  );
}
