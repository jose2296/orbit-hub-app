import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet } from "react-native";

import { useTranslation } from "@/lib/i18n";
import { useTheme } from "@/theme";
import { SPACING } from "@/theme/tokens";

/**
 * Los tres numeros que deciden donde termina la fila y donde empieza el boton.
 *
 * ------------------------------------------------------------------
 * POR QUE SON CONSTANTES Y NO PROSA
 * ------------------------------------------------------------------
 *
 * Porque los tres forman la misma cuenta: la caja que el boton ocupa, el hueco que
 * deja a la derecha y el `hitSlop`, que **agranda el area de toque mas alla de la
 * caja**. Los tres se suman y de esa suma depende la fila que lo monta
 * (`ANCHO_RESERVADO`, abajo). Con numeros sueltos en el JSX, quien monta tiene que
 * adivinar la suma, y el que cambia uno despues no se entera de que rompio las
 * filas que ya lo montaban.
 *
 * ------------------------------------------------------------------
 * POR QUE `HIT_SLOP` ESTA TAMBIEN COMO LITERAL EN EL JSX
 * ------------------------------------------------------------------
 *
 * Porque `icon-page.test.ts` lee la linea `hitSlop={8}` del fuente: es el guard
 * que dice que el area tactil no se perdio cuando el boton salio de
 * `content-list.tsx`. Dejar de escribir el literal seria escribir un componente
 * cuyo requisito nadie comprueba, asi que el numero vive en los dos lugares y
 * `bookmark-menu.test.ts` afirma que los dos digan lo mismo.
 */

/** El ancho minimo de la caja del boton, y por que no es mas chico. */
const MIN_ANCHO = 40;

/** De que token de espaciado sale el margen que el boton se pone a la derecha. */
const MARGEN_DERECHA = "sm";

/** Cuanto se agranda el area de toque mas alla de la caja, en cada lado. */
const HIT_SLOP = 8;

/**
 * Lo que la fila tiene que reservar a la derecha para montar este boton.
 *
 * ------------------------------------------------------------------
 * POR QUE TAMBIEN CUENTA EL `hitSlop`
 * ------------------------------------------------------------------
 *
 * Porque el `hitSlop` **no** se queda dentro de la caja: lo agranda hacia los
 * cuatro lados. El area de toque del boton llega `HIT_SLOP` pixeles mas alla de
 * su borde izquierdo, y si la fila no reserva esos pixeles, el area del boton se
 * mete dentro de la del `Pressable` de la fila. En nativo el toque va al hermano
 * dibujado despues —el boton—, asi que los ultimos ocho pixeles de la fila
 * abrian el menu en vez del enlace, y no habia forma de verlo: las dos cosas se
 * dibujan bien y se pisan solo en el toque.
 *
 * Por eso el orden es `minWidth + margen + hitSlop` y no `minWidth + margen`: el
 * margen es donde esta el boton, y el `hitSlop` es lo que se sale de ahi.
 *
 * Y vive **aca** y no en la fila que lo monta, por la misma razon que el resto del
 * componente: es una exigencia del boton, asi que la cumple —y la anuncia— el
 * boton. La fila de los enlaces y la del inbox la toman de esta constante;
 * `content-list.tsx` todavia reserva un `44` escrito a mano, y por eso ese archivo
 * es una excepcion que queda anotada en el reporte de T4.
 */
export const ANCHO_RESERVADO = MIN_ANCHO + SPACING[MARGEN_DERECHA] + HIT_SLOP;

/**
 * Los tres puntitos de una fila, y la unica forma de dibujarlos.
 *
 * ------------------------------------------------------------------
 * POR QUE VIVE ACA Y NO EN LA PANTALLA QUE LO USA
 * ------------------------------------------------------------------
 *
 * Porque estaba escrito a mano dentro de `content-list.tsx`, sin exportar, y
 * tres puntitos es justo la clase de boton que cada pantalla nueva reescribe: el
 * area importa, la etiqueta de accesibilidad importa, y las dos cosas se
 * pierden en silencio porque un boton que se ve igual de bien no delata que se
 * perdio ninguna. El menu de fila de los enlaces lo necesita desde T4, y la
 * fila de una lista, de una carpeta y de una nota lo necesitan desde antes.
 *
 * El motivo de por que el `top` es `0` y el `bottom` tambien esta en el cuerpo
 * del componente, abajo, con la medicion que lo justifica. No se sube al
 * encabezado porque un resumen de una razon medida no es la razon.
 *
 * ------------------------------------------------------------------
 * LO QUE LE PIDE LA FILA QUE LO MONTA
 * ------------------------------------------------------------------
 *
 * `position: absolute` sin un padre relativo lo manda al contenedor equivocado:
 * el boton tiene que quedar dentro de la caja de la fila —que es la que es
 * `position: relative`— y no al viewport. Es una exigencia del boton y la
 * cumple quien lo monta.
 */
export function MenuButton({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useTheme();
  const t = useTranslation();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("rowActions.menuOf", { name: label })}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [
        styles.menu,
        {
          /*
            Centrado en vertical, y no pegado arriba con un `top` fijo.

            El alto de una fila no es un numero —cambia con el titulo en dos
            lineas, con el numero de elementos y con la escala de letra— y un
            `top` de ocho puntos acertaba en unas filas y dejaba el icono por
            encima del centro en las demas. Con `top: 0` y `bottom: 0` el centro lo
            pone la propia fila y no hay ningun alto que adivinar.
          */
          top: 0,
          bottom: 0,
          // El asa de arrastrar de la fila es `right: 8` y de unos 32 de ancho,
          // asi que moverse por su ancho mas su propio margen deja el menu
          // despejado de ella y no a unos pixeles del costado.
          right: theme.spacing[MARGEN_DERECHA],
          /*
            40 de blanco y el icono dentro: media 26, por debajo de lo que un
            dedo alcanza con fiabilidad.

            Y el margen de la derecha mas este ancho mas el `hitSlop` es lo que
            la fila reserva: el detalle esta en `ANCHO_RESERVADO`, y el
            `hitSlop` entra en la cuenta porque el area de toque se sale de esta
            caja.
          */
          minWidth: MIN_ANCHO,
          minHeight: 40,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: theme.radius.sm,
          backgroundColor: pressed ? theme.colors.surfaceMuted : "transparent",
        },
      ]}
    >
      <Ionicons name="ellipsis-horizontal" size={18} color={theme.colors.textSubtle} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  menu: {
    position: "absolute",
  },
});
