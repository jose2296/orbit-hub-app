import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Screen } from '@/components/ui/screen';
import { AppText } from '@/components/ui/text';
import { useTranslation } from '@/lib/i18n';
import { authClient, toAuthError } from '@/lib/auth';
import { useTheme } from '@/theme';

type VerifyState =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'done'; email: string }
  | { kind: 'failed'; reason: 'no_token' | 'invalid' | 'network' };

/**
 * Verification screen.
 *
 * It serves two different moments: arriving from the sign-up form, where there
 * is no token and the only thing to do is wait for the email, and arriving from
 * the link in that email, where `?token=` has to be redeemed straight away.
 * Ignoring the token left the email link useless, so it is consumed on mount.
 */
export default function VerifyEmailScreen() {
  const theme = useTheme();
  const t = useTranslation();
  const router = useRouter();
  const { email, token } = useLocalSearchParams<{ email?: string; token?: string }>();

  const [state, setState] = useState<VerifyState>(() =>
    token ? { kind: 'working' } : { kind: 'idle' },
  );
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attempted = useRef(false);

  useEffect(() => {
    // Strict Mode runs effects twice in development; redeeming a single use
    // token twice would report a false failure.
    if (!token || attempted.current) return;
    attempted.current = true;

    let active = true;
    void authClient
      .verifyEmail(token)
      .then((verifiedEmail) => {
        if (active) setState({ kind: 'done', email: verifiedEmail });
      })
      .catch((caught) => {
        if (!active) return;
        const apiError = toAuthError(caught);
        const kind =
          apiError.kind === 'network' || apiError.kind === 'timeout' ? 'network' : 'invalid';
        setState({ kind: 'failed', reason: kind });
      });

    return () => {
      active = false;
    };
  }, [token]);

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

  if (state.kind === 'working') {
    return (
      <Screen>
        <EmptyState icon="mail-outline" title={t('auth.verify.working')} />
      </Screen>
    );
  }

  if (state.kind === 'done') {
    return (
      <Screen>
        <EmptyState
          icon="checkmark-circle-outline"
          title={t('auth.verify.successTitle')}
          description={t('auth.verify.successBody', { email: state.email })}
        />
        <Card variant="muted" style={{ gap: theme.spacing.md }}>
          <Button
            label={t('auth.submit.signIn')}
            onPress={() => router.replace('/(auth)/sign-in')}
          />
        </Card>
      </Screen>
    );
  }

  if (state.kind === 'failed') {
    return (
      <Screen>
        <EmptyState
          icon="alert-circle-outline"
          title={t('common.error')}
          description={
            state.reason === 'network' ? t('auth.error.network') : t('auth.verify.invalidToken')
          }
        />
        <Card variant="muted" style={{ gap: theme.spacing.md }}>
          <Button
            label={t('onboarding.signIn')}
            variant="secondary"
            onPress={() => router.replace('/(auth)/sign-in')}
          />
        </Card>
      </Screen>
    );
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
