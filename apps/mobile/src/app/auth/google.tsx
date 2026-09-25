import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { Screen } from '@/components/ui/screen';
import { AppText } from '@/components/ui/text';
import { useTranslation } from '@/lib/i18n';
import { useTheme } from '@/theme';

/**
 * OAuth callback for the web target.
 *
 * On web, `prompt` opens a popup and waits for it to post the URL back. Google
 * returns to the redirect URI, which has to be a real route: without this one
 * the popup landed on the not found screen and the sign-in promise never
 * resolved, so the button looked broken with no error anywhere.
 *
 * The screen has no controls on purpose. It exists to complete the handshake
 * and close itself.
 */
export default function GoogleCallbackScreen() {
  const theme = useTheme();
  const t = useTranslation();
  const [standalone, setStandalone] = useState(false);

  useEffect(() => {
    // A page opened directly (not as the popup the app created) has no opener,
    // so there is nobody to hand the URL back to and this window is not ours to
    // close. Chrome warns about that, and rightly.
    const isPopup = typeof window !== 'undefined' && window.opener !== null;
    if (!isPopup) {
      setStandalone(true);
      return;
    }

    WebBrowser.maybeCompleteAuthSession();

    // The opener receives the URL and resumes the flow; this window is done.
    const timer = setTimeout(() => {
      window.close();
    }, 800);
    return () => clearTimeout(timer);
  }, []);

  return (
    <Screen>
      <View style={{ gap: theme.spacing.xs, alignItems: 'center' }}>
        <AppText variant="title">{t('auth.google.completing')}</AppText>
        {standalone ? (
          <AppText variant="callout" tone="muted" align="center">
            {t('auth.google.callbackFailed')}
          </AppText>
        ) : null}
      </View>
    </Screen>
  );
}
