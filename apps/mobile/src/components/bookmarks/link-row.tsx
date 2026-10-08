import { View } from "react-native";

import type { Bookmark, BookmarkExtractionState } from "@orbit-hub/contracts";

import { ListRow } from "@/components/ui/list-row";
import { ANCHO_RESERVADO, MenuButton } from "@/components/ui/menu-button";
import { useTranslation } from "@/lib/i18n";
import type { TranslationKey } from "@/lib/i18n";
import { hostDe, tituloDeBookmark } from "@/lib/menus/bookmark";
import { useTheme } from "@/theme";
import type { Theme } from "@/theme";

export interface LinkRowProps {
  bookmark: Bookmark;
  /** Abre el enlace. Lo decide la pantalla, porque cada una lleva a lo suyo. */
  onPress: () => void;
  /** Abre el menu de la fila, y la fila no sabe de que hoja se trata. */
  onMenu: () => void;
  /**
   * El id de esta fila, con su prefijo de pantalla.
   *
   * Lo pone quien la monta y no este componente porque el prefijo dice **donde** se
   * esta la fila —`list-`, `inbox-`, `collection-`— y es lo que permite contar
   * filas de una pantalla sin contar las de otra.
   */
  testID: string;
}

/**
 * Una fila de enlace guardado, y **la unica fila de enlace guardado de la app**.
 *
 * ------------------------------------------------------------------
 * POR QUE ESTE ARCHIVO EXISTE
 * ------------------------------------------------------------------
 *
 * Porque la fila estaba escrita en tres pantallas —la lista, el inbox y la
 * coleccion— con el mismo cuerpo: el punto del estado de extraccion, el titulo que
 * cae al host, el subtitulo que junta host y estado, la caja relativa que exige
 * `MenuButton`, la reserva del ancho, el `flex: 1` que hace que la reserva sirva,
 * y los tres puntitos. Y los dos mapas de estado y color, otros dos.
 *
 * Con tres copias, un arreglo del ancho o del `flex` se aplica a una y se olvida
 * de las otras dos, y el sintoma es una fila que se come el nombre en una pantalla
 * y no en las demas: un fallo de pixeles que no aparece en un typecheck, ni en un
 * test de texto, ni en el navegador con un ancho fijo.
 *
 * Lo que **queda afuera** es lo que las tres hacian distinto y por que: la
 * pantalla decide a donde lleva el toque (el lector, el triage) y que hoja
 * behind el menu, y por eso lo unico que la fila recibe es el `Bookmark` entero y
 * dos `onPress`. Una fila que decidiera eso seria una fila que obliga a las tres
 * pantallas a coincidir en un detalle que no les corresponde.
 *
 * ------------------------------------------------------------------
 * LO QUE NO VIVE ACA
 * ------------------------------------------------------------------
 *
 * La hoja. Tres puntitos que abren `EntityMenuSheet` es un boton; la hoja la abre
 * la pantalla, una sola vez, y es la misma para todas las filas. Si la fila
 * montara la hoja, habria un `Modal` por fila —y `Sheet` es un `Modal`— que es
 * justo lo que `entity-menu-sheet.test.ts` cuenta para detectar dos fondos.
 */
export function LinkRow({ bookmark, onPress, onMenu, testID }: LinkRowProps) {
  const theme = useTheme();
  const t = useTranslation();

  const titulo = tituloDeBookmark(bookmark);
  const subtitulo = [hostDe(bookmark.url), t(CLAVE_ESTADO[bookmark.extractionState])]
    .filter((parte) => parte.length > 0)
    .join(" · ");

  return (
    <View
      testID={testID}
      style={{
        /*
          La caja relativa, porque `MenuButton` es `position: absolute` y sin un
          padre relativo se ancla al contenedor equivocado. El requisito lo pide la
          cabecera del boton y lo cumple quien lo monta.
        */
        position: "relative",
        flexDirection: "row",
        alignItems: "center",
        gap: theme.spacing.sm,
        /*
          El ancho que el boton ocupa, mas su margen y el `hitSlop` que le agranda
          el area de toque mas alla de la caja: los tres los trae el boton, en
          `ANCHO_RESERVADO`. Sin el `hitSlop` en la cuenta, el area del boton
          entra en la de la fila y los ultimos pixeles abren el menu en vez del
          enlace.
        */
        paddingRight: ANCHO_RESERVADO,
      }}
    >
      <ListRow
        title={titulo}
        // Y `undefined` en vez de la cadena vacia: `ListRow` dibuja el subtitulo
        // si es truthy, asi que las dos formas coinciden, y una sola regla para las
        // tres pantallas.
        subtitle={subtitulo.length > 0 ? subtitulo : undefined}
        icon="bookmark-outline"
        leading={
          <View
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: COLOR_ESTADO[bookmark.extractionState](theme),
            }}
          />
        }
        rightLabel={bookmark.siteName ?? undefined}
        chevron
        /*
          Y este `flex: 1` es lo que hace que la reserva sirva: sin el, el
          `paddingRight` de la caja no encoge la fila —en RN el `flexShrink` por
          defecto es `0`— y un titulo largo se sale de la caja con el boton
          encima. No hay typecheck que lo note.
        */
        style={{ flex: 1 }}
        onPress={onPress}
      />
      {/*
        Al lado de la fila y no dentro: un `Pressable` dentro del de la fila es
        `<button>` dentro de `<button>` en web, y el navegador lo desarma.

        Y los tres puntitos en vez de una papelera suelta: borrar paso a ser una
        fila del menu, y esa fila **pregunta** antes de hacerlo —`DeletePage`—, que
        es lo unico que distingue un trabajo que no se puede deshacer de uno que
        sale con un toque.
      */}
      <MenuButton label={titulo} onPress={onMenu} />
    </View>
  );
}

/**
 * Que palabra lleva cada estado en la fila, y de que color es su punto.
 *
 * Los dos mapas viven juntos porque son la misma decision dicha dos veces: si un
 * estado cambia de nombre, su color se revisa en el mismo sitio. `Record` y no un
 * `switch` con defecto, para que un quinto estado del contrato rompa el typecheck
 * aca en vez de pintarse sin palabra.
 *
 * Y estan **sin exportar** a proposito: no hay un segundo consumidor. Exportarlos
 * seria invitar a que la proxima pantalla los importe, y con eso a que la fila y
 * quien la dibuja se vuelvan a separar sin que nada lo note.
 */
const CLAVE_ESTADO: Record<BookmarkExtractionState, TranslationKey> = {
  pending: "bookmarks.state.pending",
  ready: "bookmarks.state.ready",
  metadata_only: "bookmarks.state.metadata_only",
  failed: "bookmarks.state.failed",
};

/**
 * Funciones y no valores, porque los colores salen del tema y el tema sale de un
 * hook: un mapa evaluado arriba del archivo no tendria de donde leer.
 */
const COLOR_ESTADO: Record<BookmarkExtractionState, (theme: Theme) => string> = {
  pending: (theme) => theme.colors.warning,
  ready: (theme) => theme.colors.success,
  metadata_only: (theme) => theme.colors.info,
  failed: (theme) => theme.colors.danger,
};
