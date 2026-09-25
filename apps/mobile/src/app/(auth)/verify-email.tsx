import { useState } from 'react';

import { api, toApiError } from '@/lib/api';
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
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);

  async function onResend() {
    setResending(true);
    try {
      await api.post('/auth/verify-email/resend', {}, { anonymous: true });
      setResent(true);
    } catch (caught) {
      // Silently ignore: the screen already tells the user to check the inbox.
      void toApiError(caught);
    } finally {
      setResending(false);
    }
  }

  return (
    <Screen>
      <EmptyState
        icon="mail-outline"
        title={t('auth.verify.title')}
        description={t('auth.verify.body')}
      />

      <Card variant="muted" style={{ gap: theme.spacing.md }}>
        {resent ? (
          <AppText variant="callout" tone="success" align="center">
            {t('auth.forgot.sent')}
          </AppText>
        ) : null}
        <Button
          label={t('auth.verify.resend')}
          variant="secondary"
          onPress={() => void onResend()}
          loading={resending}
        />
      </Card>
    </Screen>
  );
}
