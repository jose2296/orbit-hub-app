import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { ShareSaveSheet } from '@/components/bookmarks/share-save-sheet';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Screen } from '@/components/ui/screen';
import { AppText } from '@/components/ui/text';
import { useSession } from '@/hooks/use-session';
import type { SharedPayload } from '@/lib/bookmarks/share-intent';
import { clearShare, takePendingShare } from '@/lib/bookmarks/share-intent';
import { useTranslation } from '@/lib/i18n';
import { useTheme } from '@/theme';

/**
 * Donde aterriza un enlace compartido desde otra app.
 *
 * Fuera de `(app)` a proposito, como `invite/[token]`: quien comparte sin
 * sesion tiene que poder aterrizar aqui, entrar y volver al mismo sitio. Tres
 * estados, calcados de la invitacion: cargando, anonimo (manda a sign-in con
 * `next` para no perder el enlace) y, con sesion, la hoja de guardado.
 *
 * Un solo lector para los dos arranques: en frio `+native-intent` abre esta
 * ruta y se lee al montar; en caliente la ruta ya montada vuelve a leer al
 * enfocarse. Los dos caminos terminan en `takePendingShare()`.
 *
 * Leer y limpiar son dos momentos distintos: se lee aqui y se limpia despues
 * de guardar (`onSaved` -> `clearShare`). Volver atras sin guardar (`onClose`)
 * no limpia, asi el enlace sigue ahi al volver.
 */
export default function ShareSaveScreen() {
  const theme = useTheme();
  const t = useTranslation();
  const router = useRouter();
  const { status } = useSession();

  // Nulo hasta que haya sesion: leer el payload no lo consume, pero la hoja
  // solo se pinta con alguien dentro.
  const [payload, setPayload] = useState<SharedPayload | null>(null);

  const leer = useCallback(() => {
    setPayload(takePendingShare());
  }, []);

  // Al montar y al volver a enfocarse: el caso caliente.
  useFocusEffect(leer);

  const volver = useCallback(() => {
    router.replace('/(app)');
  }, [router]);

  // Guardado: primero se limpia el payload nativo para que reabrir la ruta no
  // re-guarde lo mismo, y despues se va al lector del enlace recien creado.
  // Una sola navegacion a proposito: el share aterriza en el detalle, que ya
  // sabe mostrar cada estado (pendiente incluido), y la lista no necesita un
  // param extra que habria que coordinar con otra tarea.
  const alGuardar = useCallback(
    (id: string) => {
      clearShare();
      router.replace({ pathname: "/bookmark/[bookmarkId]", params: { bookmarkId: id } });
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
                params: { next: '/share/save' },
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
