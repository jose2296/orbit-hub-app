import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { authClient, toAuthError } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { AppText } from '@/components/ui/text';
import { useTranslation } from '@/lib/i18n';
import { useTheme } from '@/theme';

const MIN_PASSWORD_LENGTH = 10;

/**
 * Password reset screen.
 *
 * The API has sent reset links to `/reset-password?token=…` since Phase 1, but
 * this route did not exist, so every reset email landed on a dead page. The
 * token is single use and short lived, so it is posted as soon as the user
 * submits, and a rejection sends them back to the start of the flow.
 */
export default function ResetPasswordScreen() {
  const theme = useTheme();
  const t = useTranslation();
  const router = useRouter();
  const { token } = useLocalSearchParams<{ token?: string }>();

  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit() {
    if (!token) {
      setError(t('auth.verify.noToken'));
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(t('auth.reset.weak'));
      return;
    }
    if (password !== passwordConfirm) {
      setError(t('auth.passwordMismatch'));
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      await authClient.resetPassword(token, password);
      setDone(true);
    } catch (caught) {
      const apiError = toAuthError(caught);
      setError(
        apiError.kind === 'network' || apiError.kind === 'timeout'
          ? t('auth.error.network')
          : t('auth.verify.invalidToken'),
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <Screen>
        <EmptyState
          icon="checkmark-circle-outline"
          title={t('auth.reset.successTitle')}
          description={t('auth.reset.successBody')}
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

  return (
    <Screen>
      <View style={{ gap: theme.spacing.xs }}>
        <AppText variant="title">{t('auth.reset.title')}</AppText>
        <AppText variant="callout" tone="muted">
          {t('auth.reset.subtitle')}
        </AppText>
      </View>

      <Card variant="muted" style={{ gap: theme.spacing.md }}>
        <TextField
          label={t('auth.reset.newPassword')}
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
          textContentType="newPassword"
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

        <Button
          label={t('auth.reset.submit')}
          onPress={() => void onSubmit()}
          loading={submitting}
        />
      </Card>
    </Screen>
  );
}
