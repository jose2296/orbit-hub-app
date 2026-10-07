import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { ShareSaveSheet } from '@/components/bookmarks/share-save-sheet';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Screen } from '@/components/ui/screen';
import { AppText } from '@/components/ui/text';
import { useSession } from '@/hooks/use-session';
import type { SharedPayload } from '@/lib/bookmarks/share-intent';
import {
  borrarShareWeb,
  guardarShareWeb,
  hayQueryShare,
  leerShareWeb,
  parsearQueryShare,
} from '@/lib/bookmarks/web-share';
import { useTranslation } from '@/lib/i18n';
import { useTheme } from '@/theme';

/**
 * Donde aterriza un enlace compartido en la web (PWA).
 *
 * Es `share/save.tsx` con otra entrada: la forma (cargando, anonimo con
 * `next` para no perder el enlace y, con sesion, la hoja de guardado), el
 * `Sheet`, el `PlacePicker` y el guardado son los mismos. Lo unico nuevo es
 * de donde sale el payload: de la query que dejo el service worker
 * (title/text/url, fijados por la Task 2) o pegada a mano en dev, donde el
 * bootstrap de `+html.tsx` no registra SW.
 *
 * El orden es lo que hace que recargar no duplique ni pierda: la query se
 * consume una sola vez al guardarla en `localStorage`
 * (`orbithub:pending-share-web`) y la URL queda limpia con un `replace` sin
 * query; despues manda el almacen. Y el login reusa el patron probado
 * (`?next=/share-target`) en vez de inventar otro.
 *
 * Leer y limpiar son dos momentos distintos, como en nativo: se lee aqui y
 * se borra despues de guardar (`onSaved` -> `borrarShareWeb`). Volver atras
 * sin guardar (`onClose`) no borra, asi el enlace sigue ahi al volver.
 */
export default function ShareTargetScreen() {
  const theme = useTheme();
  const t = useTranslation();
  const router = useRouter();
  const { status } = useSession();
  const params = useLocalSearchParams<{ title?: string; text?: string; url?: string; error?: string }>();

  const [payload, setPayload] = useState<SharedPayload | null>(null);

  // Una sola vez al montar, y por eso sin dependencias: la query se consume
  // aqui o no se consume nunca. Si hay query se parsea, se guarda y se
  // limpia la URL; si no la hay, se lee lo que quedo guardado.
  useEffect(() => {
    if (hayQueryShare(params)) {
      const parsed = parsearQueryShare(params);
      if (parsed) guardarShareWeb(parsed);
      else borrarShareWeb();
      setPayload(parsed);
      router.replace('/share-target');
    } else {
      setPayload(leerShareWeb());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const volver = useCallback(() => {
    router.replace('/(app)');
  }, [router]);

  // Guardado: primero se borra la clave para que reabrir la ruta no re-guarde
  // lo mismo, y despues se va al lector del enlace recien creado.
  const alGuardar = useCallback(
    (id: string) => {
      borrarShareWeb();
      router.replace({ pathname: '/bookmark/[bookmarkId]', params: { bookmarkId: id } });
    },
    [router],
  );

  if (status === 'loading') {
    return (
      <Screen>
        <View style={{ paddingVertical: theme.spacing.xxl, alignItems: 'center' }}>
          <ActivityIndicator color={theme.colors.accent} />
        </View>
      </Screen>
    );
  }

  if (status === 'anonymous') {
    return (
      <Screen>
        <Card variant="outlined" style={{ gap: theme.spacing.md }}>
          <AppText variant="body">{t('invite.signInFirst')}</AppText>
          <Button
            label={t('invite.signIn')}
            fullWidth
            onPress={() =>
              router.replace({
                pathname: '/(auth)/sign-in',
                params: { next: '/share-target' },
              })
            }
          />
        </Card>
      </Screen>
    );
  }

  // Con sesion y sin nada que guardar: alguien abrio la ruta a mano.
  if (!payload) {
    return (
      <Screen>
        <Card variant="outlined" style={{ gap: theme.spacing.md }}>
          <AppText variant="heading">{t('share.save.emptyTitle')}</AppText>
          <AppText variant="body" tone="muted">
            {t('share.save.emptyBody')}
          </AppText>
          <Button
            label={t('common.back')}
            variant="secondary"
            fullWidth
            onPress={volver}
          />
        </Card>
      </Screen>
    );
  }

  return (
    <ShareSaveSheet
      payload={payload}
      visible
      onClose={volver}
      onSaved={alGuardar}
    />
  );
}
