import { LinearGradient } from "expo-linear-gradient";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SpaceWash } from "@/components/ui/wash";
import {
  altoCabeceraDe,
  altoLavadoDe,
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

  /*
    **La misma altura de barra que la cabecera, y por eso no puede ser una constante.**

    El lavado es **un** degradado partido en dos: la barra pinta su mitad de arriba
    y esta caja la de abajo, y el corte es el borde de abajo de la barra. Las dos
    mitades tienen que medirse contra el mismo numero o se encuentran en puntos
    distintos de la misma rampa.

    Y el numero ya no es 56: la cabecera crecio para no dibujar sus botones debajo
    del reloj, y con ella crecio el corte. Medido en Android con el hueco de 24
    puntos, la barra seguia pintando el degradado hasta el 80 mientras esta caja
    arrancaba su mitad en el 56 — un escalon de **36 de 255** justo en la linea
    donde la barra se acaba, en cada pantalla de cada espacio. Un escalon ahi es
    exactamente lo que este diseño dice que no existe.

    Asi que las dos mitades se miden contra `altoCabeceraDe(insets.top)`. Con un
    hueco de cero —la web, y un movil sin muesca— es el 56 de siempre; ver
    `altoCabeceraDe`.
  */
  const insets = useSafeAreaInsets();
  const altoBarra = altoCabeceraDe(insets.top);

  return (
    <View pointerEvents="none" style={styles.banda}>
      <SpaceWash
        /*
          **La mitad de abajo del mismo degradado**, y por eso el alto y el
          desplazamiento negativo: la caja de este lavado mide lo que mide el
          lavado entero y se sube lo que mide la barra, asi que aqui solo se ve su
          tramo final. La barra pinta la mitad de arriba con la misma caja y el
          mismo angulo.

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
        // los dos numeros de aqui son `altoBarra`, que es lo que mide la barra de
        // verdad: con el hueco de la barra de estado, el alto del lavado grows con
        // ella y el desplazamiento tambien. Ver el comentario de arriba.
        style={[styles.lavado, { height: altoLavadoDe(insets.top), marginTop: -altoBarra }]}
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
      **En `top: 0`, y esta caja empieza donde acaba la barra.**

      El padre es el area del contenido, y el navegador pone esa area **justo debajo
      de la barra**: asi que `top: 0` ya es "donde acaba la barra", y por eso es lo
      que hay. No hace falta subirla, y subirla es lo que hacia.

      Medido en la web a 390 de ancho, en claro: con `top: -56` esta caja ocupaba
      **y = 0..100** en vez de 56..156, y su desvanecido —que va pegado al fondo de
      la caja, `bottom: 0` y 82% de alto— empezaba en **y = 18** en vez de y = 74.
      Es decir, el desvanecido estaba **38 puntos por encima** del corte, y a la
      altura del borde de la barra ya iba por el 46%: la barra pinta el color entero
      y lo corta en seco, y debajo ya estaba medio apagado. De ahi el escalon de
      **32 de 255** justo en la linea de union, medido en claro y en oscuro, en cada
      pantalla de cada espacio.

      El comentario de este sitio decia antes que `top: 0` era lo que provocaba una
      "linea blanca y gorda" debajo de la barra, y por eso se subio. Lo que esa
      linea era es **esto**: la banda dibujada 56 puntos mas arriba de donde le
      toca, con su propio desvanecido empezando por encima del corte. Con la caja en
      su sitio los dos velos se tocan en el borde y no se solapan, porque el de la
      barra llega hasta `y = 56` y el de la banda empieza en `y = 56`.
    */
    top: 0,
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
    // El lavado entero y su desplazamiento los pone el JSX, porque los dos son
    // "lo que mide la barra" y eso depende del hueco de la barra de estado. Lo que
    // se ve de el es exactamente su tramo final, y es el mismo degradado que pinta
    // la cabecera: mismo alto, mismo ancho, mismo angulo, mismos colores.
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
