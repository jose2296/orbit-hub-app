import { Link } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/text';
import { useTranslation } from '@/lib/i18n';
import { splitNotice } from '@/lib/legal/notice';

/**
 * "Al continuar aceptas los términos y la política de privacidad", with the two
 * legal documents as links inside the sentence.
 *
 * It replaced a caption that said the same thing in plain text, and that is the
 * whole point: a person being asked to agree has to be able to read what they are
 * agreeing to without leaving the screen they are agreeing on.
 *
 * **The links are not in the checkbox.** That was the other option, and it is
 * worse for a reason that has nothing to do with looks: `Checkbox` is a
 * `Pressable`, so a `Link` inside its label is a `Pressable` inside a
 * `Pressable`. On the web one tap toggles the box *and* navigates, and for a
 * screen reader it is an interactive control nested inside another one. The box
 * keeps its label and the links live in this sentence underneath it.
 *
 * **La frase se compone de hermanos y no anidada, y hay una razon medida.** Antes
 * era un `AppText` con las partes dentro. En nativo eso funde las partes en un solo
 * `TextView` con `ClickableSpan`: un `Text` dentro de otro `Text` no tiene vista
 * propia, y su `testID` no llega a ningun sitio. Medido en un emulador con la
 * pantalla de bienvenida: `screen-welcome` aparece como `resource-id` y
 * `probe-subtitulo` tambien, pero los `testID` de los enlaces y el de una parte de
 * texto anidada no aparecen en el arbol de accesibilidad. Los enlaces salen como
 * `android.widget.Button` con el texto traducido en `content-desc`, que es
 * justo el selector que este reposito prohibe usar. Con los hermanos cada
 * `AppText` es una vista y su `testID` si llega, que es lo que necesitan los
 * flujos de `e2e/maestro`.
 *
 * La fila con `flexWrap` conserva el aspecto de frase: son las mismas palabras en
 * el mismo orden y el mismo centrado, y lo que cambia es que ahora pueden cortarse
 * entre partes y no solo dentro de una.
 */
export function LegalNotice() {
  const t = useTranslation();

  return (
    <View style={styles.notice}>
      {splitNotice(t('legal.notice')).map((parte, indice) =>
        parte.kind === 'text' ? (
          // The variant is repeated on purpose and must not be "simplified" away.
          // Each part is now a `Text` of its own instead of a span inside one, and
          // the default is `body`, 16 px — so a bare `<AppText>{parte.value}</AppText>`
          // here would render 16 px text inside a 12 px sentence.
          <AppText key={`texto-${indice}`} variant="caption" tone="subtle">
            {parte.value}
          </AppText>
        ) : (
          <Link key={`enlace-${indice}`} href={parte.href} asChild>
            <AppText
              variant="caption"
              tone="accent"
              // El texto de los dos enlaces sale del diccionario -`legal.links.*`-, y
              // eso no puede ser un selector: en ingles son otras palabras y el flujo
              // se rompe el dia que se reescriba la frase. El `testID` se decide por
              // `href` y no por posicion, porque el orden de las dos partes lo fija la
              // traduccion: en un idioma que ponga la privacidad primero el enlace
              // _terms_ seria el primero de los dos.
              testID={parte.href === '/terms' ? 'welcome-terms' : 'welcome-privacy'}
            >
              {t(parte.href === '/terms' ? 'legal.links.terms' : 'legal.links.privacy')}
            </AppText>
          </Link>
        ),
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    // `baseline` y no el `stretch` de serie: un enlace y el texto que lo rodea
    // tienen que quedar en la misma linea, y con alturas distintas y sin esto cada
    // parte se estira a la altura de la mas alta de su linea.
    alignItems: 'baseline',
  },
});