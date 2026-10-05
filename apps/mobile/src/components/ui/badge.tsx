import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, View } from "react-native";
import type { ViewStyle } from "react-native";

import { useTheme } from "@/theme";

import type { IconName } from "./button";
import { AppText } from "./text";

export type BadgeTone =
  "neutral" | "accent" | "success" | "warning" | "danger" | "info";

export interface BadgeProps {
  label: string;
  tone?: BadgeTone;
  icon?: IconName;
  /**
   * `compact` is the same badge with less of it around the words.
   *
   * It exists for the places where the badge is **not the headline** of the row:
   * a list of tasks carries its urgency on its own line under the title, where a
   * badge at the size of a badge in a header is a badge shouting over the thing
   * it is describing. Same colours, same pill, same words — less padding and a
   * smaller glyph.
   *
   * `regular` is the default on purpose: the fifteen other call sites are the ones
   * a badge is the headline of, and a default they all have to opt out of is a
   * default that gets opted out of wrongly.
   */
  size?: "regular" | "compact";
  /**
   * A press on the badge, **and nothing at all without it.**
   *
   * It becomes a `Pressable` and not a `View` with a `Pressable` put around it,
   * because the box the row measures is **this** one. `flexShrink: 0` below is on
   * the badge, so a wrapper around it would be the flex child instead, and a flex
   * child with no `flexShrink` of its own **refuses to shrink** — Yoga defaults it
   * to 0 and `react-native-web` writes it on every `View` in
   * `exports/View/index.js` (`view$raw`). The wrapper would sit there at the badge's
   * full width, the badge would keep that width inside it, and the pair would be
   * wider than the line: the badge is what gets pushed off the end.
   *
   * Optional and not required, because the other call sites pass nothing and get
   * exactly the tree this file has always drawn — the same `View`, carrying the same
   * `accessibilityLabel` and the same `testID`.
   *
   * **The `accessibilityRole` below is what makes this a button and not a caption,
   * and on web it also decides the element.** `propsToAccessibilityComponent.js`
   * returns the *tag* for a role that has one, so this branch is a `<button>` and
   * the other is a `<div>` — measured, and the browser checks that look for pills
   * among a row's elements ask for `div,button` because of it.
   */
  onPress?: () => void;
  /**
   * What activating the badge does, **spread, not a string.**
   *
   * The spread of `useA11yHint` from whoever calls, the same prop `TagColorButton`
   * takes and for the same reason: **the node stays with the caller**, so a row whose
   * pressables share one sentence renders it once in the document and has every one
   * of their `aria-describedby` pointing at it — which is legal, and is what the
   * name above the badge already does with its own hint.
   *
   * Not a plain `accessibilityHint` string, because that prop is deleted at the
   * `View` boundary on web — `react-native-web@0.21.2` has the string nowhere in
   * its package and filters props through an allowlist — so passing it here would
   * work on a phone and vanish in a browser without a word. `Button` takes the
   * string and calls the hook itself; a badge cannot, because it renders a second
   * node per call site and fifteen call sites do not each need their own copy.
   */
  hintProps?: Record<string, string>;
  style?: ViewStyle;
  /**
   * What a screen reader says instead of the bare label.
   *
   * Not optional in spirit: a badge that holds a count reads as "2", and "2" is not a
   * sentence. A badge on a notifications row has to carry what it counts, so a caller
   * that has one passes it — and `testID` comes with it because a count nobody can
   * find is a count nobody can verify.
   */
  accessibilityLabel?: string;
  testID?: string;
}

export function Badge({
  label,
  tone = "neutral",
  icon,
  size = "regular",
  onPress,
  hintProps,
  style,
  accessibilityLabel,
  testID,
}: BadgeProps) {
  const theme = useTheme();

  const tones: Record<BadgeTone, { background: string; text: string }> = {
    neutral: {
      background: theme.colors.surfaceMuted,
      text: theme.colors.textMuted,
    },
    accent: {
      background: theme.colors.accentSoft,
      text: theme.colors.accentSoftText,
    },
    success: {
      background: theme.colors.successSoft,
      text: theme.colors.success,
    },
    warning: {
      background: theme.colors.warningSoft,
      text: theme.colors.warning,
    },
    danger: { background: theme.colors.dangerSoft, text: theme.colors.danger },
    info: { background: theme.colors.infoSoft, text: theme.colors.info },
  };

  const palette = tones[tone];
  const compacto = size === "compact";

  // One style array for both branches, so the box is the same box either way and
  // there is no second place where a padding or a radius can drift apart.
  const estilo = [
    styles.container,
    {
      backgroundColor: palette.background,
      borderRadius: theme.radius.pill,
      paddingHorizontal: compacto ? theme.spacing.sm : theme.spacing.md,
      paddingVertical: compacto ? theme.spacing.xxs : theme.spacing.xs,
      gap: theme.spacing.xs,
    },
    style,
  ];

  const dentro = (
    <>
      {icon ? (
        <Ionicons
          name={icon}
          size={compacto ? 10 : 12}
          color={palette.text}
        />
      ) : null}
      <AppText variant="caption" style={{ color: palette.text }}>
        {label}
      </AppText>
    </>
  );

  if (!onPress) {
    // Los mismos dos props que siempre, y no por costumbre: quince sitios de la app
    // viven de que el nombre accesible de una insignia llegue entero, y este es el
    // unico sitio por el que puede pasar.
    return (
      <View
        accessibilityLabel={accessibilityLabel}
        testID={testID}
        style={estilo}
      >
        {dentro}
      </View>
    );
  }

  // El `accessibilityLabel` solo si quien lo llama dio uno: si no, lo que un lector
  // de pantalla dice es la palabra escrita dentro, que es la que se lee encima.
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      {...hintProps}
      testID={testID}
      onPress={onPress}
      style={estilo}
    >
      {dentro}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    /**
     * And it does not shrink, **because a pill that gets narrow is not a pill.**
     *
     * Measured on an Android release build, in the urgency badge of a task row: the
     * badge got 53 points wide and 145 tall, because "High" was ten points wide and
     * wrapped to one letter per line, and the row was four times as tall as its
     * content. The text was readable and the shape was not, which is the worst of
     * both: it looked like a mistake and it still took the room.
     *
     * `flexShrink: 0` and not a `minWidth`: the label is the shortest thing on the
     * line and it is what the whole badge is for, so the thing that yields is the
     * one next to it — which is what `styles.metaTags` in the row already does.
     */
    flexShrink: 0,
  },
});
