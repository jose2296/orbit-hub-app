import type { ReactNode } from "react";
import {
  KeyboardAvoidingView,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { READING_WIDTH } from "@/lib/layout/measure";
import { useHeaderOwnsTopInset } from "@/components/ui/header-inset";
import { SpaceBand, type SpaceBandProps } from "@/components/workspace/space-band";
import { usePullToRefresh } from "@/hooks/use-pull-to-refresh";
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
   * The space's wash, behind the content, continuing down from the header.
   *
   * **The other half of the same colour.** The header paints the first 56 points
   * and this picks it up from exactly there and carries it 100 more before it is
   * gone. One wash, two mitades, and they meet: which is why the header does not
   * fade inside its own bar — if it faded there, the two halves would each end at
   * their own edge and there would be a step of saturation right where the eye is
   * already looking for a change of screen.
   *
   * **The header's height does not change.** The band is painted *behind* the
   * content and not added to the bar, so the first row of every screen starts at
   * 56 points whatever the space's colour is. Measured on three screens: 56, 56, 56.
   *
   * `null` — the default, and what the screens outside a space pass — is no wash at
   * all, and they did not have to be taught anything about it.
   */
  wash?: SpaceBandProps | null;
}

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

  /*
   * Tirar hacia abajo recarga, y es una **accion explicita** de la persona.
   *
   * El motor ya sincroniza solo, con su rebote y cuando vuelve la red, asi que
   * esto no es lo que hace que los datos esten al dia: es la salida para cuando
   * sabes que algo cambio y no quieres esperar. Es tambien lo unico que funcionaba
   * en la web, donde no hay gesto de tirar hacia abajo del sistema.
   *
   * Se tira de `syncNow()` y no de un `pull` suelto porque el motor ya sabe lo que
   * tiene y lo que no, y una segunda ruta para bajar cambios es una segunda ruta
   * para equivocarse.
   *
   * El `recargando` no se apaga solo al terminar la promesa: se apaga en el
   * `finally`, porque una sincronizacion que falla —sin red, con el servidor caido—
   * tambien tiene que dejar de girar el indicador.
   */
  const { refreshControl } = usePullToRefresh();

  /**
   * Whether the bar above already spent the status bar's height.
   *
   * It has, on every screen of the `(app)` stack, because `AppHeader` takes
   * `insets.top` so its buttons are not under the clock. Adding it here as well
   * is the gap twice: measured on Android as a 24-point bar above a page that
   * starts another 24 points down. Outside that stack there is no bar, so the
   * inset is this screen's to take — which is what `false` gives it. See
   * `header-inset.tsx`.
   */
  const cabeceraArriba = useHeaderOwnsTopInset();

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

    Empieza en `top: 0` de la pantalla, que es **justo** donde acaba la cabecera: el
    navegador reserva la barra y pone la pantalla debajo, sin hueco. Asi que esta
    banda y el lavado de la cabecera son el mismo lavado continuedo, no dos piezas
    que se tocan.

    Y son 100 puntos, no 320, porque el alto de la banda es una decision que se
    nota: bastante para que el degradado se vea —que es lo que se pidio— y no tanto
    que detrás de el haya una lista entera teñida.
  */
  const fondo = wash ? <SpaceBand {...wash} /> : null;

  const content = scroll ? (
    <ScrollView
      contentContainerStyle={[styles.content, padding, column]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      refreshControl={refreshControl}
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
      edges={cabeceraArriba ? ["left", "right"] : ["top", "left", "right"]}
      style={[styles.flex, { backgroundColor: theme.colors.background }, style]}
      testID={testID}
    >
      {/*
        `padding` on **both**, y la razon de que antes no lo estuviera es el
        objeto entero de este cambio.

        Decia `Platform.OS === "ios" ? "padding" : undefined`, y `undefined` no es
        un valor por defecto — es **no hacer nada**. Asi que en Android cada
        pantalla de esta app tenia un `KeyboardAvoidingView` que no esquivaba nada,
        y parecian deliberadas: el componente esta ahi, en el arbol, envolviendo el
        scroller, haciendo su trabajo.

        Medido en API 35 con el teclado abierto, en la pantalla de registro: el
        campo con el foco quedaba libre del teclado y **el campo siguiente estaba
        cortado por el borde del teclado** —dibujado, medio debajo, ni fuera de
        pantalla ni ausente del arbol.

        Por que la ventana no lo resuelve: la app no declara
        `android.windowSoftInputMode`, y lo que Android hace aqui por defecto es
        `adjustPan` — **mueve** la ventana para que el campo con el foco se vea y
        no toca el alto. Eso basta para enseyar el campo en el que escribes y no
        basta para ensenar el siguiente, que es el unico que se nota que falta.
      */}
      <KeyboardAvoidingView behavior="padding" style={styles.flex}>
        {fondo}
        {content}
        {/*
          A sibling of the scroller and not a child of it, and the comment on
          `overlay` is the reason: a child of a `ScrollView` cannot be fixed to
          the window on the web.
        */}
        {overlay ? (
          <View pointerEvents="box-none" style={styles.anclaje}>
            {overlay}
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  /**
   * The box the overlay is anchored to.
   *
   * `position: "absolute"` on a floating button needs an ancestor it can be
   * absolute **inside**, and this is it: it fills the area the keyboard-avoiding
   * view has, which is the window minus the safe area. Without it the button has
   * nothing to be absolute against and lands wherever the flow puts it, which on
   * Android was the left edge.
   *
   * `box-none` so it never eats a touch meant for the content behind it.
   */
  anclaje: {
    ...StyleSheet.absoluteFill,
  },
  content: {
    flexGrow: 1,
  },
  full: {
    width: "100%",
    alignSelf: "center",
  },
});

export type { ReactNode };
