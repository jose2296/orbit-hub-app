import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";

import type { Bookmark, BookmarkExtractionState } from "@orbit-hub/contracts";

import { BookmarkDeleteSheet } from "@/components/bookmarks/delete-sheet";
import { EmptyState } from "@/components/ui/empty-state";
import { ListRow } from "@/components/ui/list-row";
import { Screen } from "@/components/ui/screen";
import { useBookmarks } from "@/hooks/use-bookmarks";
import { useCollections } from "@/hooks/use-collections";
import { useScreenTitle } from "@/hooks/use-screen-title";
import { useTranslation } from "@/lib/i18n";
import type { TranslationKey } from "@/lib/i18n";
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

  // La papelera de cada fila, con la misma confirmacion que el inbox: el
  // patron vive en `BookmarkDeleteSheet` para que no derive en dos copias.
  const [aBorrar, setABorrar] = useState<Bookmark | null>(null);

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
        const host = hostDe(bookmark.url);
        const subtitulo = [host, t(CLAVE_ESTADO[bookmark.extractionState])]
          .filter((parte) => parte.length > 0)
          .join(" · ");
        return {
          id: bookmark.id,
          // Sin titulo todavia (pendiente de extraer): el host dice mas que
          // una fila vacia, y la URL cruda dice mas que nada.
          titulo:
            bookmark.title.length > 0 ? bookmark.title : host || bookmark.url,
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
          {items.map((item) => (
            <View
              key={item.id}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: theme.spacing.sm,
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
                lo desarma (aviso de `place-share-sheet`). Misma forma que el
                inbox, misma papelera, misma confirmacion.
              */}
              <Pressable
                testID={`list-delete-${item.id}`}
                accessibilityRole="button"
                accessibilityLabel={t("bookmarks.delete.title")}
                hitSlop={8}
                onPress={() =>
                  setABorrar(bookmarks.find((b) => b.id === item.id) ?? null)
                }
                style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}
              >
                <Ionicons
                  name="trash-outline"
                  size={20}
                  color={theme.colors.textMuted}
                />
              </Pressable>
            </View>
          ))}
        </View>
      )}
      <BookmarkDeleteSheet bookmark={aBorrar} onClose={() => setABorrar(null)} />
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

/** El host de una URL, o vacio si no hay nada que ensenar. */
function hostDe(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}
