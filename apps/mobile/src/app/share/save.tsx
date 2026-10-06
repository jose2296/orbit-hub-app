import { useRouter } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Screen } from '@/components/ui/screen';
import { AppText } from '@/components/ui/text';
import { useSession } from '@/hooks/use-session';
import { useTranslation } from '@/lib/i18n';
import { useTheme } from '@/theme';

/**
 * Cascaron de la hoja de guardado.
 *
 * Fuera de `(app)` a proposito, como `invite/[token]`: quien comparte sin
 * sesion tiene que poder aterrizar aqui, entrar y volver al mismo sitio. Tres
 * estados, calcados de la invitacion: cargando, anonimo (manda a sign-in con
 * `next` para no perder el enlace) y vacio (la ruta abierta a mano, sin
 * payload). La hoja real llega en la Task 3 y la lectura en la Task 4.
 */
export default function ShareSaveScreen() {
  const theme = useTheme();
  const t = useTranslation();
  const router = useRouter();
  const { status } = useSession();

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

  // Con sesion y sin nada que guardar: alguien abrio la ruta a mano. El texto
  // va escrito aqui y no en el diccionario porque es un cascaron temporal: la
  // Task 3 trae la copia final.
  return (
    <Screen>
      <Card variant="outlined" style={{ gap: theme.spacing.md }}>
        <AppText variant="heading">No hay nada que guardar</AppText>
        <AppText variant="body" tone="muted">
          Comparte un enlace desde otra app y aparece aqui.
        </AppText>
        <Button
          label={t('common.back')}
          variant="secondary"
          fullWidth
          onPress={() => router.replace('/(app)')}
        />
      </Card>
    </Screen>
  );
}
