import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef } from "react";
import { Image, Linking, Pressable, View } from "react-native";

import type { Bookmark } from "@orbit-hub/contracts";

import { DocumentView } from "@/components/bookmarks/document-view";
import { Button } from "@/components/ui/button";
import { useHeaderAction } from "@/components/ui/header-action";
import { Screen } from "@/components/ui/screen";
import { AppText } from "@/components/ui/text";
import { useBookmark } from "@/hooks/use-bookmarks";
import { triggerExtract } from "@/lib/api/bookmarks";
import { useTranslation } from "@/lib/i18n";
import { useTheme } from "@/theme";

export type RamaLector = "esqueleto" | "pendiente" | "lista" | "metadata" | "fallida";

/**
 * Que rama pinta el lector, solo con la fila y el cargando.
 *
 * Pura y exportada para probarse sin React: las cuatro ramas del contrato mas
 * el esqueleto, que cubre cargando y fila ausente (borrada o aun sin llegar).
 * Un quinto estado no compila aqui, que es mejor que pintarse sin rama.
 */
export function ramaLector(bookmark: Bookmark | null, isLoading: boolean): RamaLector {
  if (isLoading || !bookmark) return "esqueleto";
  switch (bookmark.extractionState) {
    case "pending":
      return "pendiente";
    case "ready":
      return "lista";
    case "metadata_only":
      return "metadata";
    case "failed":
      return "fallida";
  }
}

/**
 * Pide la extraccion si el bookmark sigue pendiente y aun no se pidio.
 *
 * Exportada y con el conjunto fuera para probarse sin montar: la primera vez
 * dispara, la segunda con el mismo conjunto ya no. El conjunto vive en un ref
 * de la pantalla, asi que cada montaje dispara una vez por id como mucho.
 */
export function disparoSiPendiente(bookmark: Bookmark | null, disparados: Set<string>): void {
  if (!bookmark || bookmark.extractionState !== "pending") return;
  if (disparados.has(bookmark.id)) return;
  disparados.add(bookmark.id);
  triggerExtract(bookmark.id);
}

/**
 * El lector de un enlace guardado, con sus cuatro estados.
 *
 * Lee de la cache y de nada mas, como la lista: la app sirve igual sin red.
 * El texto sale de la fila completa (`document`), y la fila cacheada puede no
 * traerlo porque el listado REST recorta `document` y `plainText` (pesan hasta
 * 512 KB y la lista no los usa). No se pide `GET /:id` aqui a proposito:
 *
 * - Un fetch romperia la regla local-first: sin red el lector quedaria vacio
 *   en vez de leer lo que ya tiene, que es justo lo que esta pantalla promete.
 * - El texto llega solo por el pull (fase 2), asi que hay una sola fuente de
 *   verdad y no dos compitiendo (cache recortada contra detalle fresco).
 * - Mientras el pull no llega, un `ready` sin documento ensena metadata y un
 *   aviso, no un hueco: la fila recortada no es un dato roto.
 *
 * `metadata_only` no es un fallo (un video no es un articulo) y por eso se
 * muestra sin disculpa y sin boton de reintentar: reintentar no lo arregla.
 */
export default function BookmarkReaderScreen() {
  const { bookmarkId } = useLocalSearchParams<{ bookmarkId: string }>();
  const id = bookmarkId ?? null;
  const { bookmark, isLoading } = useBookmark(id);
  const theme = useTheme();
  const t = useTranslation();

  // Al montar y si sigue pendiente: fire-and-forget, sin await y sin toast.
  // Sin red no pasa nada y el estado sigue `pending`, que ya dice que pasa.
  const disparados = useRef(new Set<string>());
  useEffect(() => {
    disparoSiPendiente(bookmark, disparados.current);
  }, [bookmark]);

  const abrirOriginal = useCallback(() => {
    if (!bookmark) return;
    // El fallo no se anuncia: si el sistema no puede abrir el enlace no hay
    // nada que la pantalla pueda arreglar, y un toast lo diria dos veces.
    void Linking.openURL(bookmark.url).catch(() => {});
  }, [bookmark]);

  const reintentar = useCallback(() => {
    if (!bookmark) return;
    triggerExtract(bookmark.id);
  }, [bookmark]);

  const accionCabecera = useCallback(
    () =>
      bookmark ? (
        <Pressable
          testID="bookmark-open-original"
          accessibilityRole="button"
          accessibilityLabel={t("bookmarks.reader.openOriginal")}
          hitSlop={8}
          onPress={abrirOriginal}
          style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}
        >
          <Ionicons name="open-outline" size={24} color={theme.colors.text} />
        </Pressable>
      ) : null,
    [abrirOriginal, bookmark, t, theme.colors.text],
  );
  useHeaderAction(accionCabecera, [accionCabecera]);

  const rama = ramaLector(bookmark, isLoading);

  if (rama === "esqueleto") {
    return (
      <Screen width="reading">
        <View
          testID="bookmark-skeleton"
          style={{ gap: theme.spacing.md }}
        >
          <Esqueleto alto={20} ancho="70%" />
          <Esqueleto alto={14} ancho="40%" />
          <Esqueleto alto={120} />
          <Esqueleto alto={14} />
          <Esqueleto alto={14} ancho="85%" />
        </View>
      </Screen>
    );
  }

  // Desde aqui `bookmark` existe: la guarda es `ramaLector`, no un `!` suelto.
  const fila = bookmark as Bookmark;
  const host = hostDe(fila.url);
  const titulo = fila.title.length > 0 ? fila.title : host || fila.url;
  const fecha = fechaDe(fila.updatedAt);
  const lineaMeta = [host, fecha].filter((parte) => parte.length > 0).join(" · ");

  if (rama === "pendiente") {
    return (
      <Screen width="reading">
        <View style={{ gap: theme.spacing.md }}>
          <AppText variant="heading">{titulo}</AppText>
          {lineaMeta.length > 0 ? (
            <AppText variant="caption" tone="muted">
              {lineaMeta}
            </AppText>
          ) : null}
          <View
            testID="bookmark-pending-skeleton"
            style={{ gap: theme.spacing.sm }}
          >
            <Esqueleto alto={120} />
            <Esqueleto alto={14} />
            <Esqueleto alto={14} ancho="85%" />
          </View>
          <AppText variant="caption" tone="muted">
            {t("bookmarks.reader.pendingBody")}
          </AppText>
        </View>
      </Screen>
    );
  }

  if (rama === "lista") {
    return (
      <Screen width="reading">
        <View style={{ gap: theme.spacing.md }}>
          {fila.imageUrl ? (
            <Image
              testID="bookmark-cover"
              source={{ uri: fila.imageUrl }}
              accessibilityIgnoresInvertColors
              style={{
                width: "100%",
                height: 180,
                borderRadius: theme.radius.md,
              }}
            />
          ) : null}
          <AppText variant="heading">{titulo}</AppText>
          {lineaMeta.length > 0 ? (
            <AppText variant="caption" tone="muted">
              {lineaMeta}
            </AppText>
          ) : null}
          {fila.document.length > 0 ? (
            <DocumentView document={fila.document} />
          ) : (
            <AppText variant="caption" tone="muted">
              {t("bookmarks.reader.waitingText")}
            </AppText>
          )}
        </View>
      </Screen>
    );
  }

  if (rama === "metadata") {
    return (
      <Screen width="reading">
        <View style={{ gap: theme.spacing.md }}>
          {fila.imageUrl ? (
            <Image
              testID="bookmark-cover"
              source={{ uri: fila.imageUrl }}
              accessibilityIgnoresInvertColors
              style={{
                width: "100%",
                height: 180,
                borderRadius: theme.radius.md,
              }}
            />
          ) : null}
          <AppText variant="heading">{titulo}</AppText>
          {lineaMeta.length > 0 ? (
            <AppText variant="caption" tone="muted">
              {lineaMeta}
            </AppText>
          ) : null}
          {fila.description ? (
            <AppText variant="body" tone="muted">
              {fila.description}
            </AppText>
          ) : null}
          <AppText variant="caption" tone="muted">
            {t("bookmarks.reader.metadataBody")}
          </AppText>
          <Button
            testID="bookmark-open-original-body"
            label={t("bookmarks.reader.openOriginal")}
            icon="open-outline"
            onPress={abrirOriginal}
          />
        </View>
      </Screen>
    );
  }

  if (rama === "fallida") {
    return (
      <Screen width="reading">
        <View style={{ gap: theme.spacing.md }}>
          <AppText variant="heading">{titulo}</AppText>
          <AppText variant="caption" tone="muted">
            {fila.url}
          </AppText>
          <AppText variant="body" tone="muted">
            {fila.extractionError ?? t("bookmarks.reader.failedBody")}
          </AppText>
          <Button
            testID="bookmark-retry"
            label={t("common.retry")}
            icon="refresh-outline"
            onPress={reintentar}
          />
        </View>
      </Screen>
    );
  }

  // `ramaLector` ya cubre el esqueleto (cargando o sin fila) y las cuatro
  // ramas de arriba devuelven: aqui solo queda lo imposible, que el
  // typecheck conoce como `never` y por eso no pide otro return.
  const imposible: never = rama;
  return imposible;
}

/**
 * Una barra gris donde algo viene, del alto de lo que vendra.
 *
 * Copia local del `Esqueleto` de `item/[itemId].tsx`: no hay esqueleto
 * generico en el repo y esta pantalla no es motivo para crear uno global.
 */
function Esqueleto({ alto, ancho = "100%" }: { alto: number; ancho?: `${number}%` | "auto" }) {
  const theme = useTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        height: alto,
        width: ancho,
        borderRadius: theme.radius.sm,
        backgroundColor: theme.colors.skeleton,
      }}
    />
  );
}

/** El host de una URL, o vacio si no hay nada que ensenar. */
function hostDe(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

/** La fecha en corto, o vacio si el ISO no parsea. */
function fechaDe(iso: string): string {
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return "";
  return fecha.toLocaleDateString();
}
