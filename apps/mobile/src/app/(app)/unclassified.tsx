import { Ionicons } from "@expo/vector-icons";
import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";

import type { Bookmark, BookmarkExtractionState } from "@orbit-hub/contracts";

import {
  AssignSheet,
  type BookmarkAClasificar,
} from "@/components/bookmarks/assign-sheet";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ListRow, SectionHeader } from "@/components/ui/list-row";
import { Screen } from "@/components/ui/screen";
import { Sheet, useLastValue } from "@/components/ui/sheet";
import { AppText } from "@/components/ui/text";
import { useBookmarks, useUnclassifiedCount } from "@/hooks/use-bookmarks";
import { useSpacesTree } from "@/hooks/use-spaces-tree";
import { deleteBookmarkAction } from "@/lib/bookmarks/actions";
import { pluralKey, useTranslation } from "@/lib/i18n";
import type { TranslationKey } from "@/lib/i18n";
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
  const [aBorrar, setABorrar] = useState<Bookmark | null>(null);
  // El ultimo y no el del estado: el estado va a null para cerrar y la hoja
  // necesita seguir pintando mientras baja. Patron de `note-menu-sheet`: un
  // condicional aqui seria un corte de 45 ms en vez de una salida.
  const ultimoBorrado = useLastValue(aBorrar);
  const [borrando, setBorrando] = useState(false);
  const [errorBorrado, setErrorBorrado] = useState<string | null>(null);

  const nombres = useMemo(() => {
    const mapa = new Map<string, string>();
    for (const espacio of arbol.spaces()) mapa.set(espacio.id, espacio.name);
    return mapa;
  }, [arbol]);

  const grupos = useMemo(() => agruparHuerfanos(bookmarks), [bookmarks]);

  const filas = useMemo(() => {
    const porId = new Map<string, { titulo: string; subtitulo: string }>();
    for (const bookmark of bookmarks) {
      const host = hostDe(bookmark.url);
      porId.set(bookmark.id, {
        titulo:
          bookmark.title.length > 0 ? bookmark.title : host || bookmark.url,
        subtitulo: [host, t(CLAVE_ESTADO[bookmark.extractionState])]
          .filter((parte) => parte.length > 0)
          .join(" · "),
      });
    }
    return porId;
  }, [bookmarks, t]);

  if (isLoading) return <View style={{ flex: 1 }} />;

  const borrar = async () => {
    if (!aBorrar || borrando) return;
    setBorrando(true);
    setErrorBorrado(null);
    try {
      // Existe desde la Task 3 (`actions.ts`): tombstone en local y operacion
      // encolada, igual que en las notas. Verificado antes de usarlo, no
      // asumido del reporte.
      await deleteBookmarkAction(aBorrar.id);
      setABorrar(null);
    } catch (problem) {
      setErrorBorrado(
        problem instanceof Error ? problem.message : t("errors.unknown"),
      );
    } finally {
      setBorrando(false);
    }
  };

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
                return (
                  <View
                    key={bookmark.id}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: theme.spacing.sm,
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
                    */}
                    <Pressable
                      testID={`inbox-delete-${bookmark.id}`}
                      accessibilityRole="button"
                      accessibilityLabel={t("bookmarks.delete.title")}
                      hitSlop={8}
                      onPress={() => {
                        setErrorBorrado(null);
                        setABorrar(bookmark);
                      }}
                      style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}
                    >
                      <Ionicons
                        name="trash-outline"
                        size={20}
                        color={theme.colors.textMuted}
                      />
                    </Pressable>
                  </View>
                );
              })}
            </View>
          ))}
        </View>
      )}
      <AssignSheet bookmark={aClasificar} onClose={() => setAClasificar(null)} />
      {/*
        Confirmar antes de borrar, con doble boton: el patron de
        `place-share-sheet.tsx:263-276`. Sin el, un toque a la papelera en el
        bolsillo es un enlace menos y un tombstone sincronizado. Siempre
        montada (sale de `ultimoBorrado`) para que la salida se vea.
      */}
      {ultimoBorrado ? (
        <Sheet
          visible={aBorrar !== null}
          onClose={() => setABorrar(null)}
          title={t("bookmarks.deleteConfirm")}
          subtitle={
            ultimoBorrado.title.length > 0
              ? ultimoBorrado.title
              : ultimoBorrado.url
          }
          scrollable={false}
        >
          <View style={{ gap: theme.spacing.md }}>
            <AppText variant="body" tone="muted">
              {t("bookmarks.deleteBody")}
            </AppText>
            {errorBorrado ? (
              <AppText variant="caption" style={{ color: theme.colors.danger }}>
                {errorBorrado}
              </AppText>
            ) : null}
            <View style={{ gap: theme.spacing.sm }}>
              <Button
                label={borrando ? t("common.saving") : t("common.delete")}
                variant="danger"
                disabled={borrando}
                fullWidth
                onPress={() => void borrar()}
              />
              <Button
                label={t("common.cancel")}
                variant="ghost"
                fullWidth
                onPress={() => setABorrar(null)}
              />
            </View>
          </View>
        </Sheet>
      ) : null}
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

/** El host de una URL, o vacio si no hay nada que ensenar. */
function hostDe(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}
