import { APP_SCHEME } from '@orbit-hub/config';
import { useRouter } from 'expo-router';
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
  const router = useRouter();
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
    /*
     * **En nativo esta ruta no tiene nada que hacer, y antes de esto mataba la app.**
     *
     * El nativo vuelve por el **scheme**, no por esta pagina: `Google →
     * https://<web>/auth/google` es un salto dentro del navegador, y quien trae
     * el control a la app es `openAuthSessionAsync` esperando `orbithub://…`.
     * Ese deep link lleva su propia ruta, `/auth/google`, y por eso este
     * componente se monta tambien en nativo — donde no hay nada que hacer, porque
     * el canje ya lo esta haciendo la sesion que abrio la pestana.
     *
     * Y lo que hacia era morir. Medido en un AAB de release, con un solo deep
     * link y sin llegar a tocar Google:
     *
     *     FATAL EXCEPTION: mqt_v_native
     *     JavascriptException: TypeError: Cannot read property 'search' of undefined
     *
     * En nativo React Native da `window` pero `window.location` es `undefined`,
     * asi que `window.location.search` lee `.search` de nada. La linea de al lado
     * si comprobaba `window` — y la comprobacion llega tarde, porque la anterior
     * ya lo habia tocado.
     *
     * Asi que la salida es aqui arriba y no mas abajo: en nativo no se lee la URL,
     * no se toca `window` y no se rebota nada.
     */
    if (Platform.OS !== 'web') return;

    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const isPopup = typeof window !== 'undefined' && window.opener !== null;

    if (code && !isPopup) {
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

  /*
   * **Y en nativo no se dibuja nada: se sale de aqui.**
   *
   * Antes esta ruta se quedaba esperando en una pantalla vacia, y habia que
   * darle a atras a mano. Medido en un movil real: el login entraba bien y el
   * usuario se quedaba mirando una pantalla en blanco con la ruta en la
   * cabecera, teniendo que pulsar atras para ver su dashboard.
   *
   * El motivo es que el deep link le dice a expo-router que venga aqui, y el
   * canje —que va por su cuenta, en `promptNativo`— no le dice a nadie que
   * vuelva a salir. Nada mas va a mover el router, asi que esta ruta tiene que
   * moverse sola.
   *
   * A donde va es a `/`, que es la entrada de la app. **Sin comprobar si hay
   * sesion a proposito**: si el login se completo, `/` lleva al dashboard y el
   * layout decide; si el usuario cancelo, `/` lleva a la pantalla de entrada.
   * Comprobarlo aqui haria falta esperar a la sesion, y dejaria el mismo callejon
   * sin salida cuando el canje no llega — que es el caso en el que mas hace falta
   * un sitio al que volver.
   */
  useEffect(() => {
    if (Platform.OS !== 'web') router.replace('/');
  }, [router]);

  if (Platform.OS !== 'web') return null;

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
