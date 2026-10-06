import { Ionicons } from "@expo/vector-icons";
import { useRef } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { isWide } from "@/components/ui/sheet";
import type { SheetOrigin } from "@/components/ui/sheet";
import { useTranslation } from "@/lib/i18n";
import { useTheme } from "@/theme";

/**
 * The floating button, in the corner the thumb reaches.
 *
 * There is one of these in the app and there is only ever going to be one, in the
 * same corner of every screen, because that is what makes it a place rather than
 * a button. A screen that puts its action somewhere else makes you look for it,
 * and a screen that puts a second one in a different corner makes you check
 * whether they do different things.
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
}: {
  /** Gets the button's own rectangle, so a sheet can grow out of it. */
  onPress: (origin: SheetOrigin | null) => void;
  label?: string;
}) {
  const theme = useTheme();
  const t = useTranslation();
  const wide = isWide();
  const size = wide ? 52 : 58;
  const ref = useRef<View>(null);

  function press() {
    const node = ref.current;
    if (!node) return onPress(null);
    node.measureInWindow((x, y, width, height) =>
      onPress(width > 0 && height > 0 ? { x, y, width, height } : null),
    );
  }

  return (
    <Pressable
      ref={ref}
      accessibilityRole="button"
      accessibilityLabel={label ?? t("create.title")}
      onPress={press}
      style={({ pressed }) => [
        styles.fab,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: theme.colors.accent,
          // The CSS form of a shadow, for the same reason as the panel: the
          // `shadow*` props are gone from React Native Web and warn on every
          // render.
          boxShadow: theme.shadow.floating.boxShadow,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <Ionicons
        name="add"
        size={wide ? 24 : 28}
        color={theme.colors.onAccent}
      />
    </Pressable>
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
    right: 20,
    bottom: 24,
    alignItems: "center",
    justifyContent: "center",
    elevation: 9,
  },
});
