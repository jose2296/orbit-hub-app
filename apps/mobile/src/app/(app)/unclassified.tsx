import { useMemo, useState } from "react";
import { useRouter } from "expo-router";

import { AssignSheet, type BookmarkAClasificar } from "@/components/bookmarks/assign-sheet";
import { View } from "react-native";

import type { Bookmark } from "@orbit-hub/contracts";

import { LinkRow } from "@/components/bookmarks/link-row";
import { EntityMenuSheet } from "@/components/menus/entity-menu-sheet";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeader } from "@/components/ui/list-row";
import { Screen } from "@/components/ui/screen";
import { AppText } from "@/components/ui/text";
import { useBookmarks, useUnclassifiedCount } from "@/hooks/use-bookmarks";
import { useSpacesTree } from "@/hooks/use-spaces-tree";
import { pluralKey, useTranslation } from "@/lib/i18n";
import { handlersDeBookmark, menuCtxDeBookmark } from "@/lib/menus/bookmark";
import { useTheme } from "@/theme";

export interface GrupoHuerfanos {
  workspaceId: string;
  bookmarks: Bookmark[];
}

/**
 * Los sin-clasificar agrupados por espacio, en orden de primera aparicion.
 *
 * Pura y exportada para probarse sin React: es la Review Focus #4 en forma de
 * datos (50 huerfanos de dos espacios dan dos grupos que suman 50). El orden
 * dentro de cada grupo lo pone el hook (`updatedAt desc`) y aqui no se toca:
 * reagrupar ya ordena lo suficiente, y un `.sort` aqui seria un segundo
 * criterio compitiendo con el primero.
 */
export function agruparHuerfanos(bookmarks: Bookmark[]): GrupoHuerfanos[] {
  const grupos = new Map<string, Bookmark[]>();
  for (const bookmark of bookmarks) {
    const grupo = grupos.get(bookmark.workspaceId);
    if (grupo) grupo.push(bookmark);
    else grupos.set(bookmark.workspaceId, [bookmark]);
  }
  return [...grupos].map(([workspaceId, items]) => ({
    workspaceId,
    bookmarks: items,
  }));
}

/**
 * El inbox: una vista y no un lugar.
 *
 * `WHERE collection_id IS NULL` cruzando espacios, agrupado por workspace. El
 * contador de arriba sale de `useUnclassifiedCount`, que es la misma fuente
 * del badge del drawer: si difieren, uno de los dos dejo de ser esa fuente.
 *
 * Tocar una fila lleva al lector; clasificar esta en el menu de la fila; la papelera pide
 * confirmacion. Al clasificar o borrar la fila desaparece sola: la suscripcion
 * del hook relee la cache, igual que absorbe los huerfanos que deja borrar
 * una coleccion.
 */
export default function UnclassifiedScreen() {
  const router = useRouter();

  const [aClasificar, setAClasificar] = useState<BookmarkAClasificar | null>(null);
  const theme = useTheme();
  const t = useTranslation();
  const arbol = useSpacesTree();

  const { bookmarks, isLoading } = useBookmarks({ collectionId: "unclassified" });
  // Sin `workspaceId`: el total cruzando espacios, que es lo que el badge del
  // drawer cuenta con la misma llamada y sin argumento.
  const total = useUnclassifiedCount();

  // El enlace cuyo menu esta abierto. Mismo reloj que la lista y que las
  // colecciones: lo que se guarda es la entidad y lo que se pasa es `null` al
  // cerrar, porque la hoja congela lo que recibe para seguir pintando mientras
  // baja.
  const [menuAbierto, setMenuAbierto] = useState<Bookmark | null>(null);

  const nombres = useMemo(() => {
    const mapa = new Map<string, string>();
    for (const espacio of arbol.spaces()) mapa.set(espacio.id, espacio.name);
    return mapa;
  }, [arbol]);

  const grupos = useMemo(() => agruparHuerfanos(bookmarks), [bookmarks]);

  /*
    `filas` **se fue**: el nombre que cae al host, el subtitulo que junta host y
    estado y el punto del estado los decide `LinkRow`, que es la misma fila que
    pintan la lista y la coleccion. Este mapa era la fila otra vez, con dos de sus
    tres partes —le faltaba el punto y el ancho— y por eso podia divergir de la
    lista sin que nada lo notara: el inbox ya decia el host donde la lista decia
    otra cosa cuando el titulo venia vacio.
  */

  if (isLoading) return <View style={{ flex: 1 }} />;

  return (
    <Screen width="reading">
      {bookmarks.length === 0 ? (
        <EmptyState
          icon="file-tray-outline"
          title={t("bookmarks.inbox.empty.title")}
          description={t("bookmarks.inbox.empty.body")}
        />
      ) : (
        <View style={{ gap: theme.spacing.lg }}>
          <SectionHeader
            title={t("place.unclassified")}
            subtitle={t(pluralKey("bookmarks.unclassifiedCount", total), {
              count: total,
            })}
          />
          {grupos.map((grupo) => (
            <View key={grupo.workspaceId} style={{ gap: theme.spacing.xs }}>
              <AppText variant="caption" tone="subtle">
                {/* El espacio existe si el bookmark existe: los dos salen de la
                    misma cache. El id es red y no titulo, por si la cache de
                    espacios aun no llego en este arranque. */}
                {nombres.get(grupo.workspaceId) ?? grupo.workspaceId}
              </AppText>
              {grupo.bookmarks.map((bookmark) => (
                <LinkRow
                  key={bookmark.id}
                  bookmark={bookmark}
                  testID={`inbox-menu-${bookmark.id}`}
                  /*
                    Al lector, y no al sheet de clasificar.

                    El pedido era literal: "que pueda entrar a dentro a verlos
                    porque si no se que es no puedo clasificarlos". Antes la fila
                    abria `AssignSheet` de una, y clasificar era a ciegas —no se
                    veia el titulo, ni el sitio, ni el texto—. Ahora se entra a ver
                    el enlace como en la lista, y clasificar esta en la cabecera
                    del lector, que es donde se puede hacer con algo de informacion.

                    Y **clasificar se mueve al menu de la fila**, que es donde
                    estaba la informacion suficiente: la fila dice el titulo y el
                    sitio. Clasificar desde el lector exigia montar ahi la hoja del
                    triage, y esa cadena rompe los dos tests que renderizan el lector
                    sin stubs de hoja — que es la senal de que no era su sitio.
                  */
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
          ))}
        </View>
      )}
      {/*
        La misma hoja que la lista, y sin confirmacion propia: la de borrar es
        una pagina de `EntityMenuSheet`, que es donde vivio `BookmarkDeleteSheet`.
        Las dos pantallas pasan por `lib/menus/bookmark`, asi que el menu del
        inbox y el de la lista no pueden empezar a diferir.
      */}
      <EntityMenuSheet
        ctx={menuCtxDeBookmark(menuAbierto)}
        handlers={handlersDeBookmark(
          menuAbierto,
          menuAbierto
            ? () =>
                setAClasificar({
                  id: menuAbierto.id,
                  version: menuAbierto.version,
                  workspaceId: menuAbierto.workspaceId,
                  title: menuAbierto.title,
                  url: menuAbierto.url,
                })
            : undefined,
        )}
        onClose={() => setMenuAbierto(null)}
      />
      <AssignSheet bookmark={aClasificar} onClose={() => setAClasificar(null)} />
    </Screen>
  );
}

/*
  `CLAVE_ESTADO` y `COLOR_ESTADO` **se fueron** a `components/bookmarks/link-row.tsx`.
  El comentario que vivia aqui decia "calcado de `bookmarks.tsx`, y vive aqui y no
  importado de alla porque alla es una ruta": era la regla correcta —una pantalla
  no importa de otra pantalla— aplicada al archivo equivocado. Los tres sitios que
  dibujaban la fila no son tres pantallas que se unknown entre si: son **la misma
  fila**, y por eso lo que la contiene no es una ruta sino un componente.
*/
