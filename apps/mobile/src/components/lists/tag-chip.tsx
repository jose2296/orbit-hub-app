import { useTheme } from "@/theme";
import type { TagColors } from "@orbit-hub/contracts";
import { derivedTagColor } from "@orbit-hub/contracts";
import { StyleSheet, View } from "react-native";
import type { ViewStyle } from "react-native";
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
}: {
  tag: string;
  colors: TagColors | undefined;
  size?: "regular" | "compact";
  children?: ReactNode;
  /**
   * What the pill takes of the line it is dropped on, the same prop `Badge` has.
   *
   * It is spread **last**, so a caller can override anything above it, and it is
   * how a row that wraps gets `flexShrink` onto a pill: the shrink belongs to the
   * pill and not to a box around it, because a box that shrinks while the pill
   * inside it does not is an overflow waiting to happen. Nothing here sets it, so
   * a caller that passes nothing gets exactly the pill this file describes.
   */
  style?: ViewStyle;
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

  return (
    <View
      style={[
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
      ]}
    >
      <AppText variant="caption" style={{ color: text }}>
        {tag}
      </AppText>
      {children}
    </View>
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
