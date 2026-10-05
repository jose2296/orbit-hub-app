import { Ionicons } from "@expo/vector-icons";
import { useCallback, useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, View } from "react-native";
import AnimatedUI from "react-native-reanimated";

import { FullTitle } from "@/components/media/full-title";
import { SeenRibbon } from "@/components/media/seen-ribbon";
import type { VerticalMediaItem } from "@/components/media/vertical-media-carousel";
import { AppText } from "@/components/ui/text";
import { useTranslation } from "@/lib/i18n";
import {
  sharedCoverStyle,
  sharedCoverTag,
  sharedCoverTitleStyle,
} from "@/lib/media/shared-cover";
import { useTheme } from "@/theme";

/**
 * Cuántas columnas, y **por qué tres**.
 *
 * Un póster de una lista de películas es un **2:3 vertical**. En una columna de 460
 * caben cinco en horizontal y sobran mil puntos; en dos, sobran quinientos; en
 * cuatro, cada póster es de 220 y el título ya no cabe en dos líneas. Tres es el punto
 * en el que la imagen manda —que es lo que se está mirando— y el título sigue siendo
 * legible debajo.
 *
 * Y el ancho no lo decide este componente: lo decide `lib/layout/measure.ts`, que es
 * donde vive `DRAWER_BREAKPOINT` y el motivo de que valga 900 y no 768. Este archivo no
 * tiene ni un número de ancho.
 */
export const MEDIA_GRID_COLUMNS = 3;

/**
 * Las películas de una lista, **todas de golpe**, en un escritorio.
 *
 * El carrusel es una pantalla por póster con salto por pantalla: un dedo, un vídeo
 * corto. Es lo correcto en un móvil, donde hay un pulgar y una pantalla, y es lo
 * contrario de lo correcto en un monitor, donde son mil cuatrocientos puntos de ancho
 * para un póster de trescientos y veinte arrastres para llegar a la vigésima.
 *
 * **Lo que este grid no trae: el vuelo del póster.** El carrusel mide el póster antes
 * de abrir el detalle para que la imagen viaje de una pantalla a otra. Aquí el póster
 * no viaja y se abre el detalle directamente. Es una decisión y su motivo es que el
 * vuelo está pensado para el pulgar —un dedo, una imagen que se扩大 y el detalle que
 * aparece debajo— y en un escritorio lo que se quiere es ver veinte carátulas, no
 * verlas una por una aunque se vean más rápido.
 *
 * **Lo que sí trae, porque si no el grid sería otra app:** el póster comparte nombre con
 * la portada del detalle (`sharedCoverStyle`), la cinta de "visto" es `SeenRibbon` —el
 * mismo dibujo que en las otras pantallas—, el nombre usa `FullTitle` con la pulsación
 * larga, y el menú es el mismo botón. Un cuarto de copia de cualquiera de esas cuatro
 * cosas es un cuarto de sitio donde puede estar la equivocada.
 */
export function MediaPosterGrid({
  items,
  emptyTitle,
  emptyBody,
}: {
  items: VerticalMediaItem[];
  emptyTitle: string;
  emptyBody: string;
}) {
  const theme = useTheme();
  const t = useTranslation();
  const [fallidos, setFallidos] = useState<Set<string>>(() => new Set());

  const fallo = useCallback((key: string) => {
    setFallidos((previos) => new Set(previos).add(key));
  }, []);

  const vacio = useMemo(() => items.length === 0, [items.length]);

  if (vacio) {
    return (
      <View style={styles.vacio}>
        <AppText variant="heading" align="center">
          {emptyTitle}
        </AppText>
        <AppText variant="body" tone="muted" align="center">
          {emptyBody}
        </AppText>
      </View>
    );
  }

  return (
    <FlatList
      data={items}
      keyExtractor={(item) => item.key}
      numColumns={MEDIA_GRID_COLUMNS}
      columnWrapperStyle={styles.columna}
      testID="media-poster-grid"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.lg }}
      renderItem={({ item }) => (
        <View style={[styles.celda, { gap: theme.spacing.sm }]}>
          {/*
            El póster y el menú son **hermanos**, y esta es la segunda vez que este
            fichero lo dice mal.

            La primera vez lo copié del carrusel, que lo tiene bien, y monté el `Pressable`
            del menú dentro del del póster. En la web eso no es un detalle: sale el aviso
            rojo de React —`<button> cannot contain a nested button`— y el clic del menú
            lo recibe el póster de debajo, o sea que abrir el menú abre la película. Se
            vio en la captura de 1440, no en un test.
          */}
          <Pressable
            onPress={() => item.onPress?.()}
            accessibilityRole="button"
            accessibilityLabel={item.title}
            style={[
              styles.poster,
              {
                borderRadius: theme.radius.lg,
                backgroundColor: theme.colors.surfaceMuted,
              },
            ]}
          >
            {item.imageUrl && !fallidos.has(item.key) ? (
              <AnimatedUI.Image
                source={{ uri: item.imageUrl }}
                style={[styles.imagen, sharedCoverStyle(item.key)]}
                resizeMode="cover"
                onError={() => fallo(item.key)}
                sharedTransitionTag={sharedCoverTag(item.key)}
              />
            ) : (
              <View style={styles.sinImagen}>
                <Ionicons
                  name={item.badge === "Libro" ? "book-outline" : "film-outline"}
                  size={44}
                  color={theme.colors.textSubtle}
                />
              </View>
            )}

            <SeenRibbon
              completed={item.completed}
              label={t("mediaTabs.seen")}
              testID={`visto-${item.key}`}
            />
          </Pressable>

          {/* Hermano del póster, por lo de arriba. */}
          <Pressable
            onPress={item.onMenu}
            accessibilityRole="button"
            accessibilityLabel={item.menuLabel}
            hitSlop={8}
            style={({ pressed }) => [
              styles.menu,
              {
                backgroundColor: theme.colors.surfaceMuted,
                borderRadius: theme.radius.md,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <Ionicons name="ellipsis-horizontal" size={20} color={theme.colors.text} />
          </Pressable>

          <FullTitle
            text={item.title}
            numberOfLines={2}
            style={[styles.titulo, sharedCoverTitleStyle(item.key)]}
            testID={`titulo-${item.key}`}
          />

          {(item.released || item.badge) && (
            <View style={[styles.meta, { gap: theme.spacing.xs }]}>
              {item.released ? (
                <AppText variant="caption" tone="subtle">
                  {item.released}
                </AppText>
              ) : null}
              {item.badge ? (
                <AppText variant="caption" tone="subtle">
                  {item.badge}
                </AppText>
              ) : null}
            </View>
          )}
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  celda: {
    flex: 1,
    // Un póster es un 2:3 vertical, y esta es la relación **de las tres** en la que el
    // título cabe en dos líneas debajo. Cambiar esto y el título se va al suelo.
    maxWidth: `${100 / MEDIA_GRID_COLUMNS}%`,
    // Porque el botón del menú se ancla a la celda, y no al póster, para poder ser
    // hermano suyo sin estar dentro.
    position: "relative",
  },
  columna: {
    gap: 12,
  },
  poster: {
    width: "100%",
    aspectRatio: 2 / 3,
    overflow: "hidden",
  },
  imagen: {
    width: "100%",
    height: "100%",
  },
  sinImagen: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  /*
    El menú, **encima de la esquina del póster y no dentro de él**, y por eso es un
    hermano y lleva `position: absolute` contra la celda, que es lo que hace de marco.
    Puesto dentro del póster —que es lo que tenía la primera vez— React avisa en la web
    y el clic se va al póster.
  */
  menu: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
  },
  titulo: {
    fontWeight: "600",
  },
  meta: {
    flexDirection: "row",
  },
  vacio: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 32,
  },
});