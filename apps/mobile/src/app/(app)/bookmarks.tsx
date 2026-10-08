import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import type { Bookmark } from "@orbit-hub/contracts";

import { LinkRow } from "@/components/bookmarks/link-row";
import { EntityMenuSheet } from "@/components/menus/entity-menu-sheet";
import { EmptyState } from "@/components/ui/empty-state";
import { Screen } from "@/components/ui/screen";
import { useBookmarks } from "@/hooks/use-bookmarks";
import { useCollections } from "@/hooks/use-collections";
import { useScreenTitle } from "@/hooks/use-screen-title";
import { useTranslation } from "@/lib/i18n";
import { handlersDeBookmark, menuCtxDeBookmark } from "@/lib/menus/bookmark";
import { useTheme } from "@/theme";

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

  /*
    El orden lo pone el hook (`updatedAt desc`: lo ultimo guardado arriba, que es
    "leer despues"). Esta pantalla no reordena: un `.sort` aqui seria un segundo
    criterio compitiendo con el primero.

    Y no arma una lista de "items": lo que cada fila sabe de si misma —el nombre
    que cae al host, el subtitulo que junta host y estado, el punto del estado, el
    sitio— lo decide `LinkRow`, que es **la misma fila** que pintan el inbox y la
    coleccion. La pantalla queda con lo que de verdad es suyo: a donde lleva el
    toque y que enlace tiene el menu abierto.
  */

  if (isLoading) return <View style={{ flex: 1 }} />;

  return (
    <Screen width="reading">
      {bookmarks.length === 0 ? (
        <EmptyState
          icon="bookmark-outline"
          title={t("bookmarks.empty.title")}
          description={t("bookmarks.empty.body")}
        />
      ) : (
        <View style={{ gap: theme.spacing.xs }}>
          {bookmarks.map((bookmark) => (
            <LinkRow
              key={bookmark.id}
              bookmark={bookmark}
              testID={`list-menu-${bookmark.id}`}
              onPress={() =>
                router.push({
                  pathname: "/bookmark/[bookmarkId]",
                  params: { bookmarkId: bookmark.id },
                })
              }
              onMenu={() => setMenuAbierto(bookmark)}
            />
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

/*
  `CLAVE_ESTADO` y `COLOR_ESTADO` **se fueron** a `components/bookmarks/link-row.tsx`,
  que es donde se dibuja la fila. Cada estado que se pinte tiene su palabra y su
  color en un solo sitio, y una pantalla no puede tener una lista de estados que no
  es la que se pinta.
*/
