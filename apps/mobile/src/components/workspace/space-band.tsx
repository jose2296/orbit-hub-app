import { LinearGradient } from "expo-linear-gradient";
import { StyleSheet, View } from "react-native";

import { SpaceWash } from "@/components/ui/wash";
import {
  ALTO_CABECERA,
  ALTO_LAVADO,
  SOBRO_BANDA,
  VELO,
  type WashVariant,
} from "@/lib/workspace/wash";
import { useTheme } from "@/theme";

/** What the band needs to know about the space. */
export interface SpaceBandProps {
  color?: string | null;
  colorTo?: string | null;
  wash?: WashVariant | null;
}

/**
 * The lower half of a space's wash: the part below the header.
 *
 * **The other half is the header's.** A screen in a space has its colour in two
 * places and nowhere else: the bar, which is 56 points on every screen, and this,
 * which starts where the bar ends and reaches 100 points further before it is
 * gone. One wash in two pieces, and the only place they meet is a straight line
 * with the same colour on both sides of it.
 *
 * **The header does not fade; this does, and only this.** When the bar faded
 * inside itself and this started again at full strength, the two left a step of
 * saturation right where the eye is already looking for a change of screen — and a
 * step reads as a mistake even when nobody can name it. So the bar paints the
 * colour whole and cuts it at its edge, and there is exactly one fade in the app.
 *
 * **It adds nothing to the height of anything.** The band is painted *behind* the
 * content, absolutely positioned at the top of the screen with a height of its
 * own, and the screen's first row starts where it started before the band existed.
 * That is why the bar can be 56 on the panel, on a list and outside a space
 * alike: measured, 56 in all three.
 */
export function SpaceBand({ color, colorTo, wash }: SpaceBandProps) {
  const theme = useTheme();

  return (
    <View pointerEvents="none" style={styles.banda}>
      <SpaceWash
        /*
          **La mitad de abajo del mismo degradado**, y por eso el `altoLavado` y el
          desplazamiento negativo: la caja de este lavado mide lo que mide el
          lavado entero y se sube lo que mide la barra, asi que de un total de 156
          aqui solo se ven los ultimos 100. La barra pinta los 56 de arriba con la
          misma caja y el mismo angulo.

          Dibujando el rango entero en cada caja, las dos se cortarian solas: cada
          una recorre de un color al otro en su propio alto, con lo que la barra
          llega al color final en su borde y esta vuelve al inicial. Medido: una
          linea recta en mitad del degradado, justo en la union.
        */
        colorKey={color}
        // The second colour too, for the reason it always travels: a wash painted
        // with only the first is a different pair from the one the picker showed,
        // and the cards on the panel would not match this.
        colorToKey={colorTo}
        wash={wash ?? undefined}
        style={styles.lavado}
      />

      {/*
        The veil, and it is the **same** one the header uses. Not for taste: the
        two halves touch, and two places that each mute their own amount put a step
        exactly on the line between them.
      */}
      <View
        style={[styles.velo, { backgroundColor: theme.colors.background, opacity: VELO }]}
      />

      <LinearGradient
        colors={["transparent", theme.colors.background]}
        locations={[0.18, 1]}
        style={styles.desvanecido}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  banda: {
    position: "absolute",
    /*
      **Arriba del todo, y no en `top: 0` de donde se pinta.**
      Esta caja se posiciona respecto al padre, y el padre es el area del contenido
      —que en Android **ya va 56 puntos por debajo de la cabecera** porque el
      header va fuera del flujo—. Con `top: 0` la banda arrancaba a la altura del
      contenido, es decir encajada con la barra: los dos velos se solapaban en esa
      franja y la suma de los dos, sobre el degradado, era la **linea blanca y
      gorda** que aparecia justo debajo del header en cada pantalla de un espacio.

      Medido en Android, antes y despues: la banda tiene que empezar donde acaba la
      barra, y por eso sube los 56 en vez de arrancar en cero.
    */
    top: -ALTO_CABECERA,
    left: 0,
    right: 0,
    // A height of its own and no `bottom`: this box does **not** grow with the
    // content, which is what lets the bar above it stay the height it is.
    /*
      El alto es el de la parte de abajo del lavado, y el `marginTop` negativo
      hace que lo que se ve sea justo su tramo final: los 100 de `SOBRO_BANDA`
      pelados, no 156 con la mitad tapada.
    */
    height: SOBRO_BANDA,
    overflow: "hidden",
  },
  lavado: {
    // El lavado entero, corrido hacia arriba lo que mide la barra. Lo que se ve
    // de el es exactamente su tramo final, y es el mismo degradado que pinta la
    // cabecera: mismo alto, mismo ancho, mismo angulo, mismos colores.
    height: ALTO_LAVADO,
    marginTop: -ALTO_CABECERA,
  },
  velo: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  desvanecido: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    // It fades across nearly the whole band: the colour has to still be there
    // where the content starts — otherwise this is a frame, not a gradient — and
    // it has to be gone by the bottom, or the bottom is a cut.
    height: "82%",
  },
});
