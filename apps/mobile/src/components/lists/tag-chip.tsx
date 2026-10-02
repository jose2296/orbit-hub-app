import { useTheme } from "@/theme";
import type { TagColors } from "@orbit-hub/contracts";
import { derivedTagColor } from "@orbit-hub/contracts";
import { StyleSheet, View } from "react-native";
import type { ReactNode } from "react";

import { labelTextColor } from "@/lib/lists/tag-colors";
import { AppText } from "../ui/text";

/**
 * One label, in the colour this list gives it — where that colour can be read.
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
 * purpose — and `iconColor` also answers `neutral` for a key a newer build wrote.
 * Grey is a colour somebody can end up with; what does not exist is a label with
 * no colour at all, which is why this component has no "empty" branch.
 *
 * **The colour is not always the text colour, and that is a measured decision.**
 * `labelTextColor` keeps the label's own colour only when it clears 4.5:1 against
 * this pill's fill, and hands back `theme.colors.text` when it does not. The
 * arithmetic is not close and it does not agree with itself between themes: three
 * of the twelve clear the bar on the light fill and three *different* ones clear it
 * on the dark one, so most pills are in the theme's text and none is coloured in
 * both. The rule and the measurement live in `@/lib/lists/tag-colors`.
 */
export function TagChip({
  tag,
  colors,
  size = "regular",
  children,
}: {
  tag: string;
  colors: TagColors | undefined;
  size?: "regular" | "compact";
  children?: ReactNode;
}) {
  const theme = useTheme();
  const compacto = size === "compact";
  const fill = theme.colors.surfaceMuted;
  const text = labelTextColor(
    colors?.[tag] ?? derivedTagColor(tag),
    fill,
    theme.colors.text,
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
     * So the pill is as tall as its own contents wherever it is dropped. With no
     * `alignItems` on the parent row it would otherwise stretch to the full cross
     * size and be a rounded rectangle instead of a pill. Both call sites centre
     * their row already, so this changes nothing today — it is here so the next
     * wrapping row without an `alignItems` gets a pill and not a block.
     */
    alignSelf: "flex-start",
  },
});
