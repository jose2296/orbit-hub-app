import { useTheme } from "@/theme";
import type { TagColors } from "@orbit-hub/contracts";
import { derivedTagColor } from "@orbit-hub/contracts";
import { StyleSheet, View } from "react-native";
import type { ReactNode } from "react";

import { iconColor } from "@/lib/lists/item-icons";
import { AppText } from "../ui/text";

/**
 * One label, in the colour this list gives it.
 *
 * The colour arrives in the `colors` prop and is **not** looked up from anywhere
 * else — not a module-level map, not the item, not a hook. That is the whole
 * reason this is a component with a prop: two lists in the same app can hold
 * "Mercadona" in two colours, and a lookup that did not take the list in hand
 * would paint both of them the same one.
 *
 * A tag with nothing chosen is not grey: it is `derivedTagColor(tag)`, the same
 * colour every other device computes for it. There is no state in which a label
 * has no colour, which is why this component has no "empty" branch.
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

  return (
    <View
      style={[
        styles.chip,
        {
          borderRadius: theme.radius.pill,
          backgroundColor: theme.colors.surfaceMuted,
          paddingHorizontal: compacto ? theme.spacing.xs : theme.spacing.sm,
          paddingVertical: compacto ? 1 : theme.spacing.xxs,
          gap: theme.spacing.xxs,
        },
      ]}
    >
      <AppText
        variant="caption"
        style={{ color: iconColor(colors?.[tag] ?? derivedTagColor(tag)) }}
      >
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
  },
});