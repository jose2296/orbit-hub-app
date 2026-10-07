import { useMemo, useState } from "react";
import { View } from "react-native";

import type { Bookmark, BookmarkExtractionState } from "@orbit-hub/contracts";

import {
  AssignSheet,
  type BookmarkAClasificar,
} from "@/components/bookmarks/assign-sheet";
import { EntityMenuSheet } from "@/components/menus/entity-menu-sheet";
import { EmptyState } from "@/components/ui/empty-state";
import { ListRow, SectionHeader } from "@/components/ui/list-row";
import { MenuButton } from "@/components/ui/menu-button";
import { Screen } from "@/components/ui/screen";
import { AppText } from "@/components/ui/text";
import { useBookmarks, useUnclassifiedCount } from "@/hooks/use-bookmarks";
import { useSpacesTree } from "@/hooks/use-spaces-tree";
import { pluralKey, useTranslation } from "@/lib/i18n";
import type { TranslationKey } from "@/lib/i18n";
import {
  handlersDeBookmark,
  hostDe,
  menuCtxDeBookmark,
  tituloDeBookmark,
} from "@/lib/menus/bookmark";
import { useTheme } from "@/theme";
import type { Theme } from "@/theme";

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
 * Tocar una fila abre el triage (`AssignSheet`) sin salir; la papelera pide
 * confirmacion. Al clasificar o borrar la fila desaparece sola: la suscripcion
 * del hook relee la cache, igual que absorbe los huerfanos que deja borrar
 * una coleccion.
 */
export default function UnclassifiedScreen() {
  const theme = useTheme();
  const t = useTranslation();
  const arbol = useSpacesTree();

  const { bookmarks, isLoading } = useBookmarks({ collectionId: "unclassified" });
  // Sin `workspaceId`: el total cruzando espacios, que es lo que el badge del
  // drawer cuenta con la misma llamada y sin argumento.
  const total = useUnclassifiedCount();

  const [aClasificar, setAClasificar] = useState<BookmarkAClasificar | null>(null);
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

  const filas = useMemo(() => {
    const porId = new Map<string, { titulo: string; subtitulo: string }>();
    for (const bookmark of bookmarks) {
      // El nombre sale de `lib/menus/bookmark`, igual que en la lista: la regla
      // del host vive una vez y las dos pantallas no pueden diferir en que
      // nombran al mismo enlace —sobre todo porque ahora las dos abren la misma
      // hoja y el nombre de la cabecera sale de ahi.
      porId.set(bookmark.id, {
        titulo: tituloDeBookmark(bookmark),
        subtitulo: [hostDe(bookmark.url), t(CLAVE_ESTADO[bookmark.extractionState])]
          .filter((parte) => parte.length > 0)
          .join(" · "),
      });
    }
    return porId;
  }, [bookmarks, t]);

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
              {grupo.bookmarks.map((bookmark) => {
                const fila = filas.get(bookmark.id);
                if (!fila) return null;
                /*
                  La caja de la fila y no un boton suelto al lado: `MenuButton` es
                  `position: absolute` y sin un padre relativo se ancla al
                  contenedor equivocado. El requisito lo pide la cabecera del
                  boton y lo cumple quien lo monta.
                */
                return (
                  <View
                    key={bookmark.id}
                    testID={`inbox-menu-${bookmark.id}`}
                    style={{
                      position: "relative",
                      flexDirection: "row",
                      alignItems: "center",
                      gap: theme.spacing.sm,
                      // El ancho que el boton ocupa: su `minWidth` mas su margen
                      // derecho. Sin este hueco se monta encima del chevron.
                      // El guard de `bookmark-menu.test.ts` lee el ancho del
                      // boton en vez de repetirlo aca.
                      paddingRight: theme.spacing.xxxl,
                    }}
                  >
                    <ListRow
                      title={fila.titulo}
                      subtitle={fila.subtitulo}
                      icon="bookmark-outline"
                      leading={
                        <View
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: 4,
                            backgroundColor: COLOR_ESTADO[
                              bookmark.extractionState
                            ](theme),
                          }}
                        />
                      }
                      chevron
                      style={{ flex: 1 }}
                      onPress={() =>
                        setAClasificar({
                          id: bookmark.id,
                          version: bookmark.version,
                          workspaceId: bookmark.workspaceId,
                          title: bookmark.title,
                          url: bookmark.url,
                        })
                      }
                    />
                    {/*
                      Al lado de la fila y no dentro: un `Pressable` dentro del
                      de la fila es `<button>` dentro de `<button>` en web, y el
                      navegador lo desarma (aviso de `place-share-sheet`).

                      Los tres puntitos en vez de la papelera: borrar paso a ser
                      una fila del menu, y esa fila **pregunta** antes de
                      hacerlo. Es la misma hoja que la lista abre, sin una
                      confirmacion propia en el medio.
                    */}
                    <MenuButton label={fila.titulo} onPress={() => setMenuAbierto(bookmark)} />
                  </View>
                );
              })}
            </View>
          ))}
        </View>
      )}
      <AssignSheet bookmark={aClasificar} onClose={() => setAClasificar(null)} />
      {/*
        La misma hoja que la lista, y sin confirmacion propia: la de borrar es
        una pagina de `EntityMenuSheet`, que es donde vivio `BookmarkDeleteSheet`.
        Las dos pantallas pasan por `lib/menus/bookmark`, asi que el menu del
        inbox y el de la lista no pueden empezar a diferir.
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
 * Calcado de `bookmarks.tsx`: misma lista, mismas palabras, mismos colores.
 * Vive aqui y no importado de alla porque alla es una ruta y esto es otra, y
 * una pantalla no importa de otra pantalla: si cambian los estados, cambiarlos
 * en dos sitios es el precio de no acoplarlas.
 */
const CLAVE_ESTADO: Record<BookmarkExtractionState, TranslationKey> = {
  pending: "bookmarks.state.pending",
  ready: "bookmarks.state.ready",
  metadata_only: "bookmarks.state.metadata_only",
  failed: "bookmarks.state.failed",
};

const COLOR_ESTADO: Record<BookmarkExtractionState, (theme: Theme) => string> = {
  pending: (theme) => theme.colors.warning,
  ready: (theme) => theme.colors.success,
  metadata_only: (theme) => theme.colors.info,
  failed: (theme) => theme.colors.danger,
};
