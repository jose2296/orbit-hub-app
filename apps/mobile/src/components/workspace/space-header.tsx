import { useRouter } from "expo-router";
import { type ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { Breadcrumbs, type Crumb } from "@/components/ui/breadcrumbs";
import { AppText } from "@/components/ui/text";
import { SpaceWash } from "@/components/ui/wash";
import { spaceTint } from "@/lib/workspace/color";
import type { WashVariant } from "@/lib/workspace/wash";
import { useTheme } from "@/theme";

export type SpaceHeaderVariant = "dot" | "crumbs" | "tint";

export interface SpaceHeaderSpace {
  name: string;
  color?: string | null;
  colorTo?: string | null;
  wash?: WashVariant | null;
  emoji?: string | null;
}

export interface SpaceHeaderProps {
  space: SpaceHeaderSpace | null | undefined;
  variant: SpaceHeaderVariant;
  /** Where the space is, so the trail and its name both go somewhere. */
  spaceHref: string;
  /** The trail, for the `crumbs` variant. */
  crumbs?: Crumb[];
  /** A screen's own action, on the right of the title. */
  right?: ReactNode;
  /** Extra lines under the title, which every variant keeps. */
  children?: ReactNode;
}

/**
 * The header of a folder or a list, and three ways of saying which space it is in.
 *
 * It used to be a band painted with the space's whole wash: a rectangle of colour
 * at the top of every screen, with the name of the thing in it and the name of
 * the space underneath. And the band was the reason the colour was hard to place
 * anywhere else — a screen that is mostly its own content and then a stripe of
 * colour on top reads the stripe as decoration, so the dot in the menu and the
 * tile in the list of spaces had to work harder than they should to say the same
 * thing.
 *
 * So the background goes and the colour has to survive somewhere, and there are
 * three honest places for it. They are not variations on a theme; they answer
 * different questions, which is why all three are here:
 *
 * - **`dot`** — *which space is this?* A mark the size of a full stop, painted
 *   with the wash so it is the same two colours as everywhere else, beside the
 *   name of the space. It says it in the position the eye already goes to, and
 *   it takes no room.
 * - **`crumbs`** — *where am I?* The trail from the space down to here, which is
 *   three folders deep of information that a single name cannot carry. The screen
 *   already had a trail below the band; this is the variant where the trail is
 *   the header instead of a line under it.
 * - **`tint`** — *is this screen inside its space?* A wash so light it is only a
 *   suspicion of colour behind the content. It keeps the shape of the old band
 *   for whoever found the space by its colour, without the screen being a colour.
 *
 * The caller picks. The one thing none of them does is paint the content.
 */
export function SpaceHeader({
  space,
  variant,
  spaceHref,
  crumbs,
  right,
  children,
}: SpaceHeaderProps) {
  const theme = useTheme();
  const router = useRouter();
  const spaceName = space?.name ?? "";

  /**
   * The mark, painted with the **whole wash** and not with the flat colour.
   *
   * A space's wash is a pair somebody chose, and a dot drawn in the first of
   * the two is a dot that cannot be the same on a screen where the band was a
   * gradient: you would be comparing the dot against a colour the dot no longer
   * has. Ten pixels is all the room there is, and the gradient is what makes ten
   * pixels legible — a flat dot that small is a speck.
   */
  const punto = (
    <SpaceWash
      colorKey={space?.color}
      colorToKey={space?.colorTo}
      wash={space?.wash ?? undefined}
      radius={99}
      style={styles.punto}
    />
  );

  /**
   * The name of the space, and the way back to it.
   *
   * A link and not a label: before the band, the name under the title was the
   * only place on the screen that said which space you were in, and it was
   * text. Now that it is the thing carrying the identification, it has to be
   * pressable — somebody who reads it and wants out of the folder should not
   * have to go and find the menu to do it.
   */
  const nombreEspacio = (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={spaceName}
      onPress={() => router.push(spaceHref as never)}
      hitSlop={8}
      style={({ pressed }) => [
        styles.fila,
        { gap: theme.spacing.xs, opacity: pressed ? 0.7 : 1 },
      ]}
    >
      {punto}
      <AppText variant="caption" tone="subtle" numberOfLines={1}>
        {spaceName}
      </AppText>
    </Pressable>
  );

  /*
    The title is **not** drawn here.

    The header above says what this screen is — the same name, in the same place
    on every other screen — and saying it again one centimetre lower is the
    screen talking over itself. What is left for the content is the one thing the
    header cannot say, which is which space this belongs to. That is the whole
    job of this component, and the three variants are three answers to it.
  */

  if (variant === "tint") {
    /*
      The old band with the gradient taken out of it, and with a border so that it
      exists in a dark theme.

      At one part in ten the tint was invisible on the dark background, which
      makes it the worst of the three: it costs a rectangle and says nothing. The
      border is what actually carries it there, and the fill only has to be
      enough to warm the surface. The text keeps the theme's own colours, because
      contrast that depends on the space is contrast somebody has to check
      against every colour a person can pick.
    */
    return (
      <View
        style={[
          styles.banda,
          {
            padding: theme.spacing.md,
            gap: theme.spacing.sm,
            backgroundColor: spaceTint(space?.color, 0.16),
            borderColor: spaceTint(space?.color, 0.45),
            borderWidth: StyleSheet.hairlineWidth * 2,
            borderRadius: theme.radius.lg,
          },
        ]}
      >
        {right}
        {nombreEspacio}
        {children}
      </View>
    );
  }

  return (
    <View
      style={[styles.fila, { gap: theme.spacing.sm, paddingTop: theme.spacing.xs }]}
    >
      {right}
      {variant === "crumbs" && crumbs && crumbs.length > 1 ? (
        <Breadcrumbs crumbs={crumbs} />
      ) : (
        nombreEspacio
      )}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  banda: {
    overflow: "hidden",
  },
  fila: {
    flexDirection: "row",
    alignItems: "center",
  },
  punto: {
    width: 10,
    height: 10,
  },
});
