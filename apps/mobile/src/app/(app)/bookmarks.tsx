import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { View } from "react-native";

import type { Bookmark, BookmarkExtractionState } from "@orbit-hub/contracts";

import { EntityMenuSheet } from "@/components/menus/entity-menu-sheet";
import { EmptyState } from "@/components/ui/empty-state";
import { ListRow } from "@/components/ui/list-row";
import { ANCHO_RESERVADO, MenuButton } from "@/components/ui/menu-button";
import { Screen } from "@/components/ui/screen";
import { useBookmarks } from "@/hooks/use-bookmarks";
import { useCollections } from "@/hooks/use-collections";
import { useScreenTitle } from "@/hooks/use-screen-title";
import { useTranslation } from "@/lib/i18n";
import type { TranslationKey } from "@/lib/i18n";
import {
  handlersDeBookmark,
  hostDe,
  menuCtxDeBookmark,
  tituloDeBookmark,
} from "@/lib/menus/bookmark";
import { useTheme } from "@/theme";
import type { Theme } from "@/theme";

/**
 * Los enlaces guardados: "leer despues".
 *
 * El molde es `notes.tsx`: la pantalla lee de la cache y de nada mas, asi que
 * sirve igual en un tunel que en una mesa. Lo que la distingue de la de notas
 * es el punto de cada fila: el estado de extraccion de la fase 2, que es lo
 * unico que dice si un enlace ya se puede leer o todavia se esta trayendo.
 *
 * Sin accion de cabecera a proposito: un enlace no se crea aqui dentro (llega
 * por compartir desde otra app), asi que un `+` seria un boton sin destino.
 * Y sin pull-to-refresh, igual que el molde: no inventar patrones.
 */
export default function BookmarksListScreen() {
  const { workspaceId, folderId, collectionId } = useLocalSearchParams<{
    workspaceId?: string;
    folderId?: string;
    collectionId?: string;
  }>();
  const router = useRouter();
  const theme = useTheme();
  const t = useTranslation();

  /*
    El enlace cuyo menu esta abierto, y no el menu en si: la hoja congela lo
    que recibe con `useLastValue` para seguir pintando mientras baja, y lo que
    espera del llamador al cerrarse es `null`. Es el mismo reloj que usan las
    colecciones, y el que hace que un toque que llega tarde no caiga en un
    handler que ya no esta.

    Guardo el `Bookmark` entero y no su id porque el menu necesita el titulo, el
    rol y la version para montar el ctx y los handlers, y volver a buscarlo en
    `bookmarks` seria una segunda fuente de verdad para el mismo enlace.
  */
  const [menuAbierto, setMenuAbierto] = useState<Bookmark | null>(null);

  // Dentro de una coleccion, la cabecera lleva su nombre: sin esto dice
  // "Bookmarks" en todas y no se sabe en cual se esta.
  const { collections } = useCollections(workspaceId);
  const coleccion =
    collectionId && collectionId !== "unclassified"
      ? (collections.find((item) => item.id === collectionId) ?? null)
      : null;
  useScreenTitle(coleccion?.name ?? t("bookmarks.title"));

  const { bookmarks, isLoading } = useBookmarks({
    workspaceId,
    // Igual que en notas: `undefined` es "sin opinion sobre la carpeta" y
    // `null` es "en ninguna". Juntarlos esconderia los sueltos, que al
    // principio son casi todos.
    ...(folderId === undefined ? {} : { folderId: folderId || null }),
    // `unclassified` pide los que no estan en ninguna coleccion, que es
    // distinto de no filtrar. Es lo que permite reusar esta lista dentro de
    // una coleccion y lo que el drawer usa para el inbox.
    ...(collectionId === undefined
      ? {}
      : {
          collectionId:
            collectionId === "unclassified" ? "unclassified" : collectionId || null,
        }),
  });

  // El orden lo pone el hook (`updatedAt desc`: lo ultimo guardado arriba, que
  // es "leer despues"). Esta pantalla no reordena: un `.sort` aqui seria un
  // segundo criterio compitiendo con el primero.
  const items = useMemo(
    () =>
      bookmarks.map((bookmark) => {
        const subtitulo = [hostDe(bookmark.url), t(CLAVE_ESTADO[bookmark.extractionState])]
          .filter((parte) => parte.length > 0)
          .join(" · ");
        return {
          id: bookmark.id,
          // El enlace entero viaja en la fila porque el menu lo necesita entero
          // —titulo, rol y version— y buscarlo otra vez por id seria una
          // segunda fuente para lo mismo.
          bookmark,
          // El nombre sale de `lib/menus/bookmark` y no de una regla escrita
          // aca: la misma regla que titula la cabecera de la hoja, y por eso las
          // dos tienen que decir lo mismo para el mismo enlace.
          titulo: tituloDeBookmark(bookmark),
          subtitulo,
          punto: COLOR_ESTADO[bookmark.extractionState](theme),
          sitio: bookmark.siteName ?? undefined,
        };
      }),
    [bookmarks, t, theme],
  );

  if (isLoading) return <View style={{ flex: 1 }} />;

  return (
    <Screen width="reading">
      {items.length === 0 ? (
        <EmptyState
          icon="bookmark-outline"
          title={t("bookmarks.empty.title")}
          description={t("bookmarks.empty.body")}
        />
      ) : (
        <View style={{ gap: theme.spacing.xs }}>
          {/*
            Cada fila es su caja relativa, porque `MenuButton` es `position:
            absolute` y sin un padre relativo se ancla al contenedor equivocado.
            El requisito lo dice la cabecera del boton y lo cumple quien lo
            monta; `icon-page.test.ts` lo deriva de todos los que lo montan.
          */}
          {items.map((item) => (
            <View
              key={item.id}
              testID={`list-menu-${item.id}`}
              style={{
                position: "relative",
                flexDirection: "row",
                alignItems: "center",
                gap: theme.spacing.sm,
                // El ancho que el boton ocupa, mas el margen que el boton se
                // pone a la derecha y el `hitSlop` que agranda su area de toque
                // mas alla de la caja. Los tres los trae el boton —`ANCHO_RESERVADO`—
                // porque son sus numeros y porque sin el `hitSlop` el area de toque
                // del boton se mete en la de la fila y los ultimos pixeles abren el
                // menu en vez del enlace.
                paddingRight: ANCHO_RESERVADO,
              }}
            >
              <ListRow
                title={item.titulo}
                subtitle={item.subtitulo.length > 0 ? item.subtitulo : undefined}
                icon="bookmark-outline"
                leading={
                  <View
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 4,
                      backgroundColor: item.punto,
                    }}
                  />
                }
                /*
                  Y este `flex: 1` es lo que hace que la reserva sirva: sin el,
                  el `paddingRight` de la caja no encoge la fila —en RN el
                  `flexShrink` por defecto es `0`— y un titulo largo se sale de la
                  caja con el boton encima. Un guard de
                  `bookmark-menu.test.ts` lo afirma, porque es la clase de cosa
                  que se rompe en un movil y no en un typecheck.
                */
                rightLabel={item.sitio}
                chevron
                style={{ flex: 1 }}
                onPress={() =>
                  router.push({ pathname: "/bookmark/[bookmarkId]", params: { bookmarkId: item.id } })
                }
              />
              {/*
                Al lado de la fila y no dentro: un `Pressable` dentro del de la
                fila es `<button>` dentro de `<button>` en web, y el navegador
                lo desarma (aviso de `place-share-sheet`).

                Y los tres puntitos en vez de una papelera suelta: borrar paso a
                ser una fila del menu, y esa fila **pregunta** antes de hacerlo
                —`DeletePage`—, que es lo unico que distingue un trabajo que no
                se puede deshacer de uno que sale con un toque.
              */}
              <MenuButton label={item.titulo} onPress={() => setMenuAbierto(item.bookmark)} />
            </View>
          ))}
        </View>
      )}
      {/*
        Una sola hoja para las dos pantallas y para las cinco entidades: el
        `ctx` sale de `lib/menus/bookmark` y las dos llamadas derivan, asi que
        no hay una lista de opciones escrita aca —esa vive en el registro— ni
        una confirmacion propia: `DeletePage` absorbio a `BookmarkDeleteSheet`.
      */}
      <EntityMenuSheet
        ctx={menuCtxDeBookmark(menuAbierto)}
        handlers={handlersDeBookmark(menuAbierto)}
        onClose={() => setMenuAbierto(null)}
      />
    </Screen>
  );
}

/**
 * Que palabra lleva cada estado en la fila, y de que color es su punto.
 *
 * Los dos viven juntos porque son la misma decision dicha dos veces: si un
 * estado cambia de nombre, su color se revisa en el mismo sitio. `Record` y
 * no un `switch` con defecto, para que un quinto estado del contrato rompa
 * el typecheck aqui en vez de pintarse sin palabra.
 */
const CLAVE_ESTADO: Record<BookmarkExtractionState, TranslationKey> = {
  pending: "bookmarks.state.pending",
  ready: "bookmarks.state.ready",
  metadata_only: "bookmarks.state.metadata_only",
  failed: "bookmarks.state.failed",
};

/**
 * Funciones y no valores, porque los colores salen del tema y el tema sale
 * de un hook: un mapa evaluado arriba del archivo no tendria de donde leer.
 */
const COLOR_ESTADO: Record<BookmarkExtractionState, (theme: Theme) => string> = {
  pending: (theme) => theme.colors.warning,
  ready: (theme) => theme.colors.success,
  metadata_only: (theme) => theme.colors.info,
  failed: (theme) => theme.colors.danger,
};
