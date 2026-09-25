import { useState } from 'react';
import { View } from 'react-native';

import { api, toApiError } from '@/lib/api';
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

  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      await api.post('/auth/password/forgot', { email: email.trim() }, { anonymous: true });
      setSent(true);
    } catch (caught) {
      const apiError = toApiError(caught);
      // The API always answers the same way to avoid account enumeration.
      if (apiError.kind === 'validation_failed') {
        setError(apiError.message);
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
          <AppText variant="callout" tone="success">
            {t('auth.forgot.sent')}
          </AppText>
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
