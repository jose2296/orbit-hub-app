import { LinearGradient } from "expo-linear-gradient";
import type { ReactNode } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { SpaceWash } from "@/components/ui/wash";
import { READING_WIDTH } from "@/lib/layout/measure";
import { VELO, type WashVariant } from "@/lib/workspace/wash";
import { useTheme } from "@/theme";

export interface ScreenProps {
  children: React.ReactNode;
  scroll?: boolean;
  /** Extra bottom padding, e.g. to clear a sticky footer. */
  bottomInset?: number;
  /**
   * How wide the content is allowed to get.
   *
   * `reading` is a column for sentences and rows. `grid` is wider, for the
   * panel of cards, which loses a card column for every point taken away from
   * it. `full` is the whole page, for the few things that are a picture of
   * something rather than a list of it.
   */
  width?: "reading" | "grid" | "full";
  /**
   * Whether the content keeps the usual gap at the bottom of the page.
   *
   * The gap is for a column of things that ends before the bottom of the window —
   * a list, a form — so the last line is not glued to the home indicator. A screen
   * whose content is a board that fills the space has no such ending, and the gap
   * becomes a strip of nothing underneath it: on the panel that is both a row of
   * the screen the cards are not using and a reason for the page to scroll when it
   * has been promised not to.
   */
  edgeToEdge?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  /**
   * Something that has to stay put while the page scrolls.
   *
   * The floating button, and the reason it is a prop and not just a child.
   *
   * `position: fixed` means "fixed to the window", but that stops being true the
   * moment an ancestor has a `transform`, because a transformed element becomes
   * the containing block for its fixed descendants. On Android and iOS nothing in
   * the tree does that and the button sits in the corner. On the web, React Native
   * puts an identity `transform` on every `ScrollView`, so a button handed to a
   * scrolling screen as a child is inside the scroller and the browser quietly
   * makes it behave like `absolute` — the button scrolls away, and the measurement
   * says it moved up by exactly the scroll.
   *
   * So the children go in the scroller and this goes beside it, in the same
   * keyboard-avoiding view, where nothing transforms it.
   */
  overlay?: ReactNode;
  /**
   * The space's wash, behind the content, at the top of the screen.
   *
   * **The panel, and only the panel.** The header is 56 points on every screen and
   * does not move; this is the other half of the same colour, the part that is big
   * enough to be a background rather than a bar. Between the two, a space's colour
   * is where it was before the bands came and went: a thin line of it on top and a
   * wash that thins out under the first rows.
   *
   * `null` — the default, and what the other screens pass — is no wash at all, and
   * they did not have to be taught anything about it.
   */
  wash?: {
    color?: string | null;
    colorTo?: string | null;
    wash?: WashVariant | null;
  } | null;
}

/** How much of the screen the wash reaches down before it is gone. */
const ALTO_LAVADO = 320;

/**
 * Base screen: safe areas, background colour, an optional scroll container and
 * a maximum width.
 *
 * Every route uses it, which is the only reason the column is the same width on
 * all of them. A phone is 430 points and a laptop is 1400, and a screen that
 * stretches its text edge to edge on the laptop is one nobody reads all the way
 * down: the eye comes back to the left and has to find the line it was on. So
 * the content is a column in the middle and the page around it stays the page's
 * colour.
 *
 * The cap is inside the scroll view and not on the screen, so a page that is
 * taller than the window still scrolls edge to edge and the padding is the
 * same on both sides the whole way down.
 */
export function Screen({
  children,
  scroll = true,
  bottomInset = 0,
  width = "reading",
  edgeToEdge = false,
  style,
  testID,
  overlay,
  wash,
}: ScreenProps) {
  const theme = useTheme();

  const padding = {
    padding: theme.spacing.lg,
    // Zero and not a smaller gap: the panel's promise is that the six rows of the
    // grid are exactly the height it was given, and any padding left underneath is
    // a strip of screen the cards are not using — which on the one screen that
    // does not scroll is the difference between filling the page and nearly
    // filling it. The left, right and top padding stay, so the grid still does not
    // touch the edges of the phone.
    paddingBottom: edgeToEdge ? 0 : theme.spacing.xxl + bottomInset,
    gap: theme.spacing.lg,
  };

  const column: ViewStyle =
    width === "full"
      ? styles.full
      : {
          width: "100%",
          maxWidth: width === "grid" ? 1000 : READING_WIDTH,
          alignSelf: "center",
        };

  /*
    El lavado, detras del contenido y sin tocarlo.

    Va **antes** del scroller y no como hijo suyo por lo mismo que el boton
    flotante: un hijo de un `ScrollView` en la web esta dentro de el y se va con
    el. Y es un hermano, no un fondo del `SafeAreaView`, porque un fondo pinta detras
    de los hijos y no se puede desvanecer a algo que esta delante.

    La altura es un numero y no un porcentaje a proposito: 320 puntos son casi la
    mitad de un movil de 844 y menos de un tercio de una pantalla alta, asi que el
    lavado llega mas alla de la primera fila —que es lo que lo hace un fondo y no
    una barra— sin teñir una lista entera. Y como se desvanece a lo largo de esos
    320, un alto equivocado se nota menos que un borde: se apaga antes o despues.
  */
  const fondo = wash ? (
    <View pointerEvents="none" style={styles.lavado}>
      <SpaceWash
        colorKey={wash.color}
        colorToKey={wash.colorTo}
        wash={wash.wash ?? undefined}
        style={styles.lavadoCaja}
      />
      {/*
        El velo, y es el **mismo** que el de la cabecera y el del panel. No por
        gusto: los dos se tocan, y dos sitio que cada uno atenua a su manera
        dejan un escalon de saturacion justo donde el ojo ya espera un cambio de
        pantalla, y un escalon se lee como un error aunque nadie sepa nombrarlo.
      */}
      <View
        style={[
          styles.lavadoVelo,
          { backgroundColor: theme.colors.background, opacity: VELO },
        ]}
      />
      <LinearGradient
        colors={["transparent", theme.colors.background]}
        style={styles.lavadoDesvanecido}
      />
    </View>
  ) : null;

  const content = scroll ? (
    <ScrollView
      contentContainerStyle={[styles.content, padding, column]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.content, styles.flex, padding, column]}>
      {children}
    </View>
  );

  return (
    <SafeAreaView
      edges={["top", "left", "right"]}
      style={[styles.flex, { backgroundColor: theme.colors.background }, style]}
      testID={testID}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        {fondo}
        {content}
        {/*
          A sibling of the scroller and not a child of it, and the comment on
          `overlay` is the reason: a child of a `ScrollView` cannot be fixed to
          the window on the web.
        */}
        {overlay}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
  },
  full: {
    width: "100%",
    alignSelf: "center",
  },
  lavado: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: ALTO_LAVADO,
    overflow: "hidden",
  },
  lavadoCaja: {
    flex: 1,
  },
  lavadoVelo: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  lavadoDesvanecido: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    // Se apaga en la mitad de abajo: el color tiene que estar cuando empieza el
    // contenido —si no, esto no es un fondo— y no cuando se acaba.
    height: "58%",
  },
});

export type { ReactNode };
