import { useTheme } from "@/theme";
import type { TagColors } from "@orbit-hub/contracts";
import { derivedTagColor } from "@orbit-hub/contracts";
import { Pressable, StyleSheet, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import type { ReactNode } from "react";

import { labelPillColors, tagColorHex } from "@/lib/lists/tag-colors";
import { AppText } from "../ui/text";

/**
 * One label, in the colour this list gives it — the tint of that colour as the
 * fill, and a text read off that fill.
 *
 * The colour arrives in the `colors` prop and is **not** looked up from anywhere
 * else — not a module-level map, not the item, not a hook. That is the whole
 * reason this is a component with a prop: two lists in the same app can hold
 * "Mercadona" in two colours, and a lookup that did not take the list in hand
 * would paint both of them the same one.
 *
 * A tag with nothing chosen is not left blank and not given a grey of its own: it
 * is `derivedTagColor(tag)`, the same colour every other device computes for it.
 * That one *can* come out grey — `neutral` is one of the twelve, so the hash lands
 * on it for roughly one name in twelve, which `@orbit-hub/contracts` admits on
 * purpose — and a colour a newer build wrote that this one does not know comes out
 * `neutral` too. Grey is a colour somebody can end up with; what does not exist is
 * a label with no colour at all, which is why this component has no "empty" branch.
 *
 * **Both colours come out of one call, and the fill is the label's own colour
 * rather than the theme's.** `labelPillColors` mixes the colour with the surface
 * and darkens it or lightens it until it can be read on that mix. The two are a
 * pair — the text means nothing measured against any other fill — which is why
 * they arrive together and not one at a time.
 *
 * The pair replaces a split decision: a `surfaceMuted` fill with the label's colour
 * as the text, falling back to `theme.colors.text` whenever that colour did not
 * read on that fill. A colour is a decision somebody took about one label, and the
 * theme's text is nobody's; the fill was the theme's while the text was the
 * label's, so the two halves were about different labels. The rule and the
 * arithmetic live in `@/lib/lists/tag-colors`.
 */
export function TagChip({
  tag,
  colors,
  size = "regular",
  children,
  style,
  testID,
  onPress,
  hintProps,
}: {
  tag: string;
  colors: TagColors | undefined;
  size?: "regular" | "compact";
  /**
   * Where this pill can be pointed at, and **why it is not the tag's name.**
   *
   * Two pills of the same label exist at once —the row's and the sheet's— and they
   * are the same pill in two places, so a selector by label finds both and a
   * selector that means "the pill near that swatch" has to be told about the
   * swatches. What is pointed at here is the pill, which is the only thing that
   * carries the label's tint.
   */
  testID?: string;
  /**
   * What the pill carries inside it, and **the colour to draw it in.**
   *
   * A function receives the pill's own text colour; an element is left as it is.
   * The fill used to be the theme's `surfaceMuted`, and on that a child could be
   * drawn in any theme token. It is now the label's own tint, and **no theme text
   * token has been measured against it** — on a tint, `textMuted` is a colour
   * nobody chose and usually a colour nobody can read. The pill has just derived
   * the one colour that clears 4.5:1 on that fill, so that is what a child gets:
   * not a second derivation, and not a token that belongs to a background this
   * pill no longer has.
   */
  children?: ReactNode | ((ink: string) => ReactNode);
  /**
   * What the pill takes of the line it is dropped on, the same prop `Badge` has.
   *
   * It is spread **last**, so a caller can override anything above it, and it is
   * how a row that wraps gets `flexShrink` onto a pill: the shrink belongs to the
   * pill and not to a box around it, because a box that shrinks while the pill
   * inside it does not is an overflow waiting to happen. Nothing here sets it, so
   * a caller that passes nothing gets exactly the pill this file describes.
   */
  /*
   * `StyleProp` y no `ViewStyle`, para que quien la usa pueda sumar su estilo al
   * del componente sin aplastarlo: la fila de la lista añade su
   * `paddingHorizontal` encima del de la pastilla, y con un `ViewStyle` a secas
   * tendría que reescribir el `flexShrink` de `styles.metaTag` en el mismo objeto.
   */
  style?: StyleProp<ViewStyle>;
  /**
   * A press on the pill, **and nothing at all without it.**
   *
   * A `Pressable` here and not a box with a `Pressable` in it, for the reason the
   * `style` above describes: the row measures this element, and a box outside it
   * would take the `flexShrink` and leave the pill hanging off the line.
   *
   * **It and `children` are not the same thing, and `onPress` is not for the two
   * rows of pills in the sheet.** Those carry inside them the buttons that take a
   * label off and give it a colour, so a pill that is also a button is a button
   * around two buttons: on a phone the innermost one keeps the gesture and the
   * outer never fires, and on the web the `click` bubbles and both do — see
   * `useLongPressText` for that same asymmetry, measured the other way round.
   *
   * **The `accessibilityRole` in the pressable is what makes this a button, and on
   * web it also decides the element:** `propsToAccessibilityComponent.js` returns
   * the tag for a role that has one, so this branch is a `<button>` and the other a
   * `<div>`. Measured, and the reason the browser checks look for `div,button`.
   */
  onPress?: () => void;
  /**
   * What activating the pill does, **spread, not a string.** The same prop
   * `TagColorButton` takes: the node stays with the caller, so a row whose pills
   * share one sentence with the name renders it once and points every one of their
   * `aria-describedby` at it. And a plain `accessibilityHint` string would work on a
   * phone and vanish in a browser, because `react-native-web@0.21.2` deletes it at
   * the `View` boundary; see `hintProps` in `badge.tsx` for the whole of it.
   */
  hintProps?: Record<string, string>;
}) {
  const theme = useTheme();
  const compacto = size === "compact";
  /*
   * **Las dos formas del color se juntan aqui**, y por eso pasan por
   * `tagColorHex` antes de entrar: el mapa guarda el hex que contesta el servidor y
   * `derivedTagColor` devuelve un nombre de los doce, y los dos dicen lo mismo en
   * sitios distintos. Es tambien lo que deja pintar el color que eligio alguien en
   * un build que guardaba nombres —`iconColor` no lo reconoceria y lo devolveria
   * en el neutro, que es gris.
   */
  const { fill, text } = labelPillColors(
    tagColorHex(colors?.[tag] ?? derivedTagColor(tag)),
    theme.colors.surfaceMuted,
    theme.scheme === "dark" ? "dark" : "light",
  );

  // Un solo array de estilo para las dos ramas, para que la caja sea la misma caja
  // y no haya un segundo sitio donde un padding o un radio se separen.
  const estilo = [
    styles.chip,
    {
      borderRadius: theme.radius.pill,
      backgroundColor: fill,
      paddingHorizontal: compacto ? theme.spacing.xs : theme.spacing.sm,
      /*
       * The one number in this file that is not a token, and it is meant:
       * `SPACING` has no 1, so the compact pill is 1 and the regular one is
       * `xxs`. `badge.tsx` uses tokens on both sides of its own compact switch,
       * which makes this look like an oversight — it is not, and "tidying" it to
       * `xxs` silently doubles the compact pill.
       */
      paddingVertical: compacto ? 1 : theme.spacing.xxs,
      gap: theme.spacing.xxs,
    },
    style,
  ];

  /*
   * **`fontWeight: "600"` y no un token, y el motivo es que `caption` es de 12 px.**
   * Una pastilla se lee como el texto de color de una insignia de prioridad, y esas
   * escriben en el mismo `caption` con un peso mas fuerte que el de la escala —que en
   * 12 px es 500—. Con el 600 el texto de una pastilla tiene la misma presencia que
   * el de una insignia, que es lo que se quiso al parecérselas; y como el color
   * elegido esta a 3:1 sobre su propio relleno —el liston de las insignias—, el peso
   * es lo que sostiene la lectura de esos 12 px.
   *
   * **El bold no cambia el liston.** WCAG llama "texto grande" a 18 px, o a 14 px en
   * negrita, y a 12 px le toca 4.5:1 aunque sea negrita: el peso cambia como se ve,
   * no cual es el minimo. Por eso `MIN_LABEL_CONTRAST` esta en 3 por decision propia y
   * no por este peso —ver el comentario de la constante en `tag-colors.ts`—, que es
   * un punto en el que los dos cambios se apoyan el uno en el otro y conviene no
   * confundirlos.
   */
  const estiloDelTexto = { color: text, fontWeight: "600" as const };

  const dentro = (
    <>
      <AppText variant="caption" style={estiloDelTexto}>
        {tag}
      </AppText>
      {typeof children === "function" ? children(text) : children}
    </>
  );

  if (!onPress) {
    return <View testID={testID} style={estilo}>{dentro}</View>;
  }

  // Sin `accessibilityLabel`: el nombre accesible de la pastilla es el de la
  // etiqueta, que es lo que está escrito dentro. Y `accessibilityRole` decide en web
  // que esto es un `<button>` y no un `<div>`; está en la prop de arriba.
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      {...hintProps}
      onPress={onPress}
      style={estilo}
    >
      {dentro}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    /*
     * So the pill is as tall as its own contents wherever it is dropped, and it
     * says so **itself**: a child with an `alignSelf` beats its row's
     * `alignItems`, which is the rule `workspace-color-picker.tsx` verified in a
     * browser on its `columnaPreview`. So this holds on a row that centres, on a
     * row that stretches and on a row with no `alignItems` at all. Without it the
     * pill would take the full cross size and be a rounded rectangle instead of a
     * pill — and the fix is never to change the row, only to keep it here. The
     * first version of this comment credited the parent's `alignItems` for the
     * job, and the credit was in the wrong place.
     *
     * The three rows of pills today — two in the task sheet, one in the list row —
     * all centre their own row as well, so none of them needs this. It is for the
     * next one, and for whoever puts a pill on a row that does not centre.
     */
    alignSelf: "flex-start",
  },
});
