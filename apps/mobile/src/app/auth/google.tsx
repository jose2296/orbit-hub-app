import { APP_SCHEME } from '@orbit-hub/config';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { Platform, View } from 'react-native';

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
    /*
     * **El salto intermedio del login en nativo.**
     *
     * Google no acepta `orbithub://auth/google` como `redirect_uri` en una app
     * instalada, y su consola lo dice del client de Android. Así que el nativo
     * sale a un https y vuelve por el scheme, y esta página es quien hace de
     * puente: recibe el `code` en la query y rebota el navegador al scheme.
     *
     * Google nunca ve el scheme —solo recibió el https—, que es justo lo que
     * hace que esto funcione en vez de devolver el mismo `Access blocked`.
     *
     * Y solo en nativo: con `window.opener` hay un popup detrás al que hay que
     * devolverle la URL, y el reboto se lo comería. El caso "alguien abrió esta
     * URL a mano" no tiene a nadie esperando, y por eso enseña el aviso.
     */
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const isPopup = typeof window !== 'undefined' && window.opener !== null;

    if (code && !isPopup && Platform.OS === 'web') {
      const scheme = `${APP_SCHEME}://auth/google?${window.location.search.replace(/^\?/, '')}`;
      window.location.replace(scheme);
      return;
    }

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
