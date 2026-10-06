import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet } from "react-native";

import { useA11yHint } from "@/components/ui/a11y-hint";
import { isWide } from "@/components/ui/sheet";
import { useTranslation } from "@/lib/i18n";
import { useTheme } from "@/theme";

import type { IconName } from "./button";

/**
 * The two numbers of the corner, **named because something else has to reserve the
 * space they take.**
 *
 * A screen whose content scrolls under this button has to leave room for it, and
 * the room is `bottom + size`. Both numbers belong to the button: a caller that
 * wrote "20" or "58" in its own file is the second copy of a decision that shows
 * up as a card somebody cannot tap.
 */
const FAB_RIGHT = 20;
const FAB_BOTTOM = 24;

/**
 * The margin under the floating button, exported because **a rounded corner is only
 * a rounded corner if there is something behind it to be round against.**
 *
 * A board's columns run to the bottom edge of the window — `Screen` drops
 * `bottomInset` when `edgeToEdge` is set, which a board needs — so a column panel
 * with no room reserved below it ends on the last pixel row: measured in the
 * browser, the panel's bottom sat at 932 in a window of 932, at 900 in a window of
 * 900 and at 480 in a window of 480, in every one of eight viewports and both
 * themes. Its bottom border was drawn *on* the edge of the window with nothing
 * under it, which is a rectangle and not a rounded box, and the corner under the
 * `+` is under the button besides.
 *
 * **`FLOATING_BUTTON_MARGIN` and not `FLOATING_BUTTON_INSET`, and the reason is
 * the radius.** What has to happen is that the panel's `radius.md` — **12** — is
 * drawn against background, so the gap has to be bigger than 12. The button's whole
 * height would do it and cost 152 points of every column on every board, measured
 * at 430 x 932 as a column going from 756 to 604; this is 24, the number the `+`
 * is already drawn with, and it is the smallest figure in this file that clears the
 * radius. **Not measured on a device**: there is no simulator or phone attached to
 * this machine.
 */
export const FLOATING_BUTTON_MARGIN = FAB_BOTTOM;

/**
 * The two sizes, **and they are tied to the inset below by name and not by
 * memory.**
 *
 * `isWide()` picks between them, and `FLOATING_BUTTON_INSET` is written with
 * `FAB_SIZE` because `board-column.tsx` reserves exactly that much at the bottom of
 * every column of a board, so that the last card of the column under this button can
 * be scrolled clear of it. **A `58` in the ternary and not in the inset is a hole six
 * points deep in every column of every board, and nothing fails**: the cards still
 * scroll, they just finish underneath the button. The two numbers are fifteen lines
 * apart here and one glance apart in a reader's eye, so each is spelled once and used
 * by name.
 */
const FAB_SIZE_WIDE = 52;
const FAB_SIZE = 58;

/**
 * The gap between two floating buttons in the same corner, **and it is a constant
 * and not a prop because the inset below is written from it.**
 *
 * A board has two of these stacked —the filter above the `+`— and the space a column
 * has to leave at its end is the *whole stack*: `FLOATING_BUTTON_INSET` for the `+`,
 * this gap, and another `FAB_SIZE` for the filter. Writing the gap as a number in the
 * board's file would be the second copy of the distance between two buttons that this
 * one owns, and the two would drift apart without anything failing: the buttons would
 * still be there, they would just be closer together than the room the columns
 * reserved. `12` and not `spacing.md` because the inset is a module-level constant
 * that cannot read the theme, and the reason is the same one the numbers above give.
 */
const FAB_STACK_GAP = 12;

/**
 * How far up from the edge of the screen this button reaches, **as the larger of
 * the two sizes.**
 *
 * `isWide()` picks between them and a caller that wanted the exact figure would have
 * to ask it again and keep the two answers in step. The largest is the figure that is
 * never too small, and too much empty space at the end of a scroll is a much cheaper
 * mistake than a card under the button.
 */
export const FLOATING_BUTTON_INSET = FAB_BOTTOM + FAB_SIZE;

/**
 * The same figure for a **stack** of two floating buttons, which is what a board has:
 * the `+` in the corner and the filter above it.
 *
 * **It is `FLOATING_BUTTON_INSET` again and not a new sum**, because a stack is the
 * first button's room plus a gap plus a second button's size, and the first term is
 * the number eleven lines up. A screen with one floating button —folders, spaces, a
 * list, the panel— reserves `FLOATING_BUTTON_INSET` and a board reserves this one.
 * Which is why a column of a board asks for the *stack* and not the button: the
 * filter is the one that covers the cards higher up, and a column that reserved room
 * for the `+` alone would finish its scroll with its last card under the filter.
 *
 * **Measured on the browser after this was written**, with 16 tarjetas in a columna
 * and a window of 430 x 932: the last card's clear bottom edge sits at 850 with the
 * filter at 152 from the bottom, and `FLOATING_BUTTON_STACK_INSET` is 152. A column
 * that reserved `FLOATING_BUTTON_INSET` (82) would have left its last card 70 points
 * below the top of the filter. **Not measured on a device**: no simulator or phone is
 * attached to this machine, and the two sizes it picks between are the same ones the
 * single-button figure is written from.
 */
export const FLOATING_BUTTON_STACK_INSET =
  FLOATING_BUTTON_INSET + FAB_STACK_GAP + FAB_SIZE;

/**
 * How far up the corner the **top** button of a stack sits, which is the sum above
 * without the `+`'s own bottom margin.
 *
 * **The two are different on purpose.** `FLOATING_BUTTON_STACK_INSET` is room a
 * scroller has to leave at its end and it includes the margin under the lowest
 * button; this one is the `bottom` of the button drawn *above* another one, which
 * starts where the `+` ends and so does not pay the margin twice. A board uses both
 * —this for where the filter is drawn and the other for what a column reserves— and
 * a copy of either in a screen is the second copy of a decision made here.
 */
export const FLOATING_BUTTON_STACK_BOTTOM =
  FAB_BOTTOM + FAB_SIZE + FAB_STACK_GAP;

/**
 * The floating button, in the corner the thumb reaches.
 *
 * **There is one of these per action, always in the same corner, and there are
 * rarely more than one.** A screen that puts its action somewhere else makes you
 * look for it, and a screen that puts a second one in a different corner makes you
 * check whether they do different things. Two in the *same* corner is the exception
 * this component grew a prop for and not a contradiction of that: a board has the
 * `+` in the corner and the filter above it, because both are always available and
 * both are about the whole screen rather than about one card.
 *
 * It lives in `ui` and not next to the thing that happens to use it most: on the
 * folders screen it creates a list, on the panel it adds a card, and importing it
 * from `folders` would be the panel depending on folders to say "plus".
 *
 * **Fixed to the corner, not to the page.** It was `absolute`, which means it
 * travelled with the content: scroll a long list and the plus went up and off the
 * screen, so the thing that creates something disappeared exactly when you had
 * scrolled to look for something to create it from. On a long note, on a long
 * space, on a long day. It is in the same corner on every screen in the app, which
 * is the point of it being one component, and it is in the same corner when the
 * page is scrolled to the middle.
 *
 * The one thing that can undo a `fixed` on the web is an ancestor with a
 * `transform`, because a transformed element becomes the containing block for its
 * fixed descendants. The drawer is the one animated ancestor this button ever sits
 * under, and it is verified on both targets with the list scrolled.
 */
export function FloatingButton({
  onPress,
  /**
   * What the button does, for anything that cannot see it.
   *
   * Defaults to the one the app has always used. Every screen that shows a plus
   * is creating something, and a screen reader that hears "add" on three screens
   * in a row has been told nothing about which one.
   */
  label,
  /**
   * What happens when it is pressed, in one sentence.
   *
   * Optional because a screen whose panel already says what it is does not need to
   * repeat it. It goes through `useA11yHint`, so on the web it is the
   * `aria-describedby` of a hidden node and on native it is the real hint — the
   * `accessibilityHint` prop that a screen used to spread onto its own copy of this
   * button and that React Native Web deletes at the boundary.
   */
  hint,
  /**
   * So a script that drives the browser can find this button.
   *
   * A prop and not a rule: the button is the same on every screen and its label is
   * the same word on all of them, so a script has nothing to tell two of them apart
   * by. The screens that create a task pass the id the task screen has always used,
   * which is what lets one click drive both of them.
   */
  testID,
  /**
   * The glyph, **`"add"` unless a caller says otherwise.**
   *
   * It is a prop because the second button of a board is a filter and not a plus,
   * and the alternative — a sibling component with its own copy of this style — is
   * two components that have to be kept the same size, the same radius, the same
   * shadow and the same offset by hand, on a screen where the second one sits
   * *on top of* the first: the moment the two disagree, one is visibly not in the
   * corner. One component and one number per measurement is what keeps them equal.
   */
  icon = "add",
  /**
   * Whether another floating button is drawn below this one, **which is what puts
   * this one up in the stack.**
   *
   * It is a boolean and not a `bottom` because the distance is this file's number:
   * a caller that wrote `94` in a screen would be the second copy of a gap decided
   * next to the size it is a fraction of, and the two would drift without anything
   * failing. `false` is the default, so every screen that shows one button —which
   * is all of them but the board — is drawn exactly as it was before this prop
   * existed.
   */
  stacked = false,
  /**
   * Whether this button is the one that has something *on*, which is what makes a
   * filter button say so without a word.
   *
   * **It changes the fill and the glyph, never the size.** A board's filter is the
   * one control on that screen whose state lives inside a sheet: with a label it
   * said "Filtrar 1", and as a bare circle the only honest signal left is the
   * drawing — `accent` on `onAccent` when a filter is on, `surface` with a hairline
   * when it is not. Anything that changed the size would move the corner, and the
   * corner is the thing this component is for.
   */
  on = false,
}: {
  onPress: () => void;
  label?: string;
  hint?: string;
  testID?: string;
  icon?: IconName;
  stacked?: boolean;
  on?: boolean;
}) {
  const theme = useTheme();
  const t = useTranslation();
  const wide = isWide();
  const size = wide ? FAB_SIZE_WIDE : FAB_SIZE;
  const pista = useA11yHint(hint);

  return (
    <>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={label ?? t("create.title")}
        {...pista.props}
        onPress={onPress}
        style={({ pressed }) => [
          styles.fab,
          stacked ? styles.fabApilado : null,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: on
              ? theme.colors.accent
              : theme.colors.surface,
            borderColor: theme.colors.border,
            // The CSS form of a shadow, for the same reason as the panel: the
            // `shadow*` props are gone from React Native Web and warn on every
            // render.
            boxShadow: theme.shadow.floating.boxShadow,
            opacity: pressed ? 0.85 : 1,
          },
        ]}
      >
        <Ionicons
          name={icon}
          size={wide ? 24 : 28}
          color={on ? theme.colors.onAccent : theme.colors.onSurface}
        />
      </Pressable>
      {/* The node beside the button and not inside it: a hint that is a child of
          the control is announced as part of its name. */}
      {pista.node}
    </>
  );
}

const styles = StyleSheet.create({
  fab: {
    /*
      **No `fixed`, y en Android sale a la izquierda si lo pones.**
      `fixed` es CSS y existe en la web, donde hace exactamente lo que dice el
      comentario de arriba. En React Native los valores válidos de `position` son
      `absolute`, `relative` y `static`: `fixed` no está, así que el motor de
      Android lo trata como `relative`, y un `relative` con `right: 20` no se ancla
      a la esquina — empuja el botón desde donde esté y lo deja pegado al otro
      lado. Medido: el plus aparecía abajo a la izquierda en cada pantalla con
      espacio, y en un build de Android.

      La esquina se consigue con `position: "absolute"` **dentro de un contenedor
      que ocupe la pantalla**, y ese contenedor lo pone `Screen` (`styles.anclaje`)
      en el hueco `overlay`. Aquí solo van el desplazamiento respecto a ese
      contenedor.
    */
    position: "absolute",
    right: FAB_RIGHT,
    bottom: FAB_BOTTOM,
    alignItems: "center",
    justifyContent: "center",
    elevation: 9,
    /*
      **El borde de pelo, y solo el de los botones que no estan "encendidos".**
      `on` se dibuja en `accent` —el color del `+`, que es una forma rellena— y un
      circulo relleno con el borde del tema encima queda con el mismo grosor a los dos
      lados del circulo; el filtro apagado necesita el borde para que se le distinga
      del `+` de debajo, que en un tablero es justo lo que hay debajo.
    */
    borderWidth: StyleSheet.hairlineWidth,
  },
  /**
   * El boton de encima de otro, **y el `bottom` sale de la constante que el inset
   * de la pila esta escrito con.**
   *
   * Va en un estilo y no en el `style` del boton porque `bottom` es un numero que
   * sale de un modulo —`FAB_BOTTOM + FAB_SIZE + FAB_STACK_GAP`— y un numero escrito
   * a mano aqui seria la segunda copia de una decision que este fichero ya tiene
   * escrita dos lineas mas arriba, en `FLOATING_BUTTON_STACK_BOTTOM`.
   */
  fabApilado: {
    bottom: FLOATING_BUTTON_STACK_BOTTOM,
  },
});
