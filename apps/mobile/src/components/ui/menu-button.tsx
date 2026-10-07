import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet } from "react-native";

import { useTranslation } from "@/lib/i18n";
import { useTheme } from "@/theme";

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
          right: theme.spacing.sm,
          // 40 de blanco y el icono dentro: media 26, por debajo de lo que un
          // dedo alcanza con fiabilidad. Con `hitSlop` el blanco crecia hacia el
          // asa de arrastrar, que esta al lado.
          minWidth: 40,
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