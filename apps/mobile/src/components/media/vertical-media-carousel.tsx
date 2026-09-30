import { Ionicons } from "@expo/vector-icons";
import { useCallback, useRef, useState } from "react";
import {
  Animated,
  Image,
  Pressable,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText } from "@/components/ui/text";
import { useTheme } from "@/theme";

/** One poster, one screen, one flick. */
export interface VerticalMediaItem {
  key: string;
  title: string;
  imageUrl: string | null;
  /** Year or publication year, as the provider spelled it. */
  released: string | null;
  /** 'Película', 'Serie' or 'Libro'. */
  badge: string | null;
  completed: boolean;
  onPress?: () => void;
  onToggleCompleted?: () => void;
  onMenu?: () => void;
  menuLabel: string;
}

export interface VerticalMediaCarouselProps {
  items: VerticalMediaItem[];
  /** Shown when there is nothing to flick through. */
  emptyTitle: string;
  emptyBody: string;
}

/** The gap between two posters, and it is also what the snap counts. */
const HUECO = 16;

/**
 * The list of films, series or books, **one at a time**.
 *
 * **Vertical, and snapped.** It is a `FlatList` con `snapToInterval` y
 * `decelerationRate="fast"`, de modo que un dedo llega a un item y se para: no
 * pasa de largo ni deja medio item en pantalla. El carrusel que habia antes era
 * horizontal y vivia en la cabecera de un `FlatList` vertical, asi que en una
 * lista de doscientos titulos se veian tres y el resto habia que buscarlos
 * desplazando hacia abajo. Aqui el carrusel **es** la pantalla.
 *
 * **El alto lo decide lo que hay, y no un numero.** El item mide lo que mide la
 * ventana, y el `snapToInterval` se calcula con ese alto, asi que el mismo
 * componente sirve en un movil, en una ventana estrecha y en una tablet sin
 * ningun alto escrito a mano. Un `snapToInterval` equivocado no se nota como
 * salto: se nota como que el dedo se pasa de largo, y es el fallo mas dificil de
 * leer de los que tienen.
 *
 * **El item se levanta poco al pasar.** La escala y la opacidad de cada cartel
 * salen del desplazamiento, no de un estado: el que esta en el centro es el
 * grande y el de al lado esta mas pequeno y mas transparente. Es lo unico que
 * hace que se entienda que hay mas y que esto se desliza, y sin ellipsis la
 * postal siguiente asoma por debajo.
 *
 * **Marcar como visto se puede hacer desde aqui**, pulsando el sello. Antes el
 * circulo de "visto" era decorativo: el `onToggleCompleted` existia en el tipo
 * del carrusel y no lo usaba nadie, de modo que un titulo visto seguia siendo
 * invisible en la lista y solo se podia cambiar entrando en su hoja. Un estado
 * que solo se cambia en un sitio al que hay que entrar de proposito no es un
 * estado que se pueda usar.
 */
export function VerticalMediaCarousel({
  items,
  emptyTitle,
  emptyBody,
}: VerticalMediaCarouselProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  /** The height one item gets, measured. The snap is built out of it. */
  const [alto, setAlto] = useState(0);
  const desplazamiento = useRef(new Animated.Value(0)).current;

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    setAlto(Math.round(e.nativeEvent.layout.height));
  }, []);

  /**
   * The gap, **derived from the item height and not written down**.
   *
   * A literal `16` next to a literal `height` is a second place to be wrong: the
   * two numbers have to agree or the list stops snapping, and nothing in the
   * types says they have to. Deriving it means the one number that exists is the
   * one the layout uses.
   */
  const altoItem = Math.max(alto - HUECO, 0);

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      desplazamiento.setValue(e.nativeEvent.contentOffset.y);
    },
    [desplazamiento],
  );

  const renderItem = useCallback(
    ({ item, index }: { item: VerticalMediaItem; index: number }) => {
      /* How far this item is from the middle, 0 at the centre and 1 next door. */
      const distancia = Animated.subtract(
        desplazamiento,
        index * (altoItem + HUECO),
      );
      const closeness = Animated.divide(distancia, altoItem || 1);
      const escala = closeness.interpolate({
        inputRange: [-1, 0, 1],
        outputRange: [0.86, 1, 0.86],
        extrapolate: "clamp",
      });
      const opacidad = Animated.multiply(
        closeness.interpolate({
          inputRange: [-1.6, -0.4, 0, 1],
          outputRange: [0.25, 0.7, 1, 0.7],
          extrapolate: "clamp",
        }),
        1,
      );

      return (
        <View style={[styles.item, { height: altoItem || undefined }]}>
          <Animated.View
            style={[
              styles.carta,
              {
                transform: [{ scale: escala }],
                opacity: opacidad,
                borderRadius: theme.radius.lg,
              },
            ]}
          >
            <Pressable
              onPress={item.onPress}
              accessibilityRole="button"
              accessibilityLabel={item.title}
              style={styles.poster}
            >
              {item.imageUrl ? (
                <Image
                  source={{ uri: item.imageUrl }}
                  style={styles.imagen}
                  resizeMode="cover"
                />
              ) : (
                <View style={[styles.sinImagen, { backgroundColor: theme.colors.surfaceMuted }]}>
                  <Ionicons
                    name={item.badge === "Libro" ? "book-outline" : "film-outline"}
                    size={56}
                    color={theme.colors.textSubtle}
                  />
                </View>
              )}
            </Pressable>

            {/* The menu, a sibling of the poster and not a child: a button
                inside a button is not valid HTML, and on the web that is not a
                style problem, it is a click that goes to the wrong thing. */}
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
              <Ionicons name="ellipsis-horizontal" size={22} color={theme.colors.text} />
            </Pressable>
          </Animated.View>

          <View style={styles.pie}>
            <AppText variant="heading" numberOfLines={2} align="center">
              {item.title}
            </AppText>
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

            {/*
              The seen mark, as a **button** and not as a badge.

              It is the state the two lists are split by, and being able to only
              read it meant that flipping a title meant opening its sheet. It also
              says what it does: the label changes with the state, because "visto"
              next to a title that is not seen is a claim and not a button.
            */}
            {item.onToggleCompleted ? (
              <Pressable
                onPress={item.onToggleCompleted}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: item.completed }}
                accessibilityLabel={item.title}
                style={({ pressed }) => [
                  styles.visto,
                  {
                    gap: theme.spacing.xs,
                    paddingHorizontal: theme.spacing.md,
                    paddingVertical: theme.spacing.xs,
                    minHeight: 40,
                    borderRadius: theme.radius.md,
                    backgroundColor: item.completed
                      ? theme.colors.accent
                      : theme.colors.surfaceMuted,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                <Ionicons
                  name={item.completed ? "checkmark-circle" : "ellipse-outline"}
                  size={18}
                  color={item.completed ? theme.colors.onAccent : theme.colors.textMuted}
                />
                <AppText
                  variant="caption"
                  style={{ color: item.completed ? theme.colors.onAccent : theme.colors.textMuted }}
                >
                  {item.completed ? "Visto" : "Marcar como visto"}
                </AppText>
              </Pressable>
            ) : null}
          </View>
        </View>
      );
    },
    [altoItem, desplazamiento, theme],
  );

  if (items.length === 0) {
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
    <View style={styles.raiz} onLayout={onLayout} testID="vertical-media-carousel">
      <Animated.FlatList
        data={items}
        keyExtractor={(item) => item.key}
        renderItem={renderItem}
        showsVerticalScrollIndicator={false}
        /*
          The snap, and the three things that go with it.

          `snapToInterval` alone would let a fast flick run over several items, so
          `disableIntervalMomentum` says that passing an interval is not allowed
          and `decelerationRate="fast"` stops early: one flick, one item. Without
          them this is a fast scroll and not a carousel.
        */
        snapToInterval={altoItem + HUECO}
        disableIntervalMomentum
        decelerationRate="fast"
        onScroll={onScroll}
        scrollEventThrottle={32}
        getItemLayout={(_, index) => ({
          length: altoItem + HUECO,
          offset: (altoItem + HUECO) * index,
          index,
        })}
        /*
          The last item has to reach the top. Without the tail padding it stops
          short by a full item, and the last poster of the list is the one that
          cannot be scrolled into place.
        */
        contentContainerStyle={{
          paddingTop: HUECO / 2,
          paddingBottom: (insets.bottom ?? 0) + 96 + HUECO / 2,
        }}
        ItemSeparatorComponent={() => <View style={{ height: HUECO }} />}
        initialNumToRender={2}
        windowSize={3}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  raiz: {
    flex: 1,
  },
  item: {
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 20,
  },
  carta: {
    flex: 1,
    width: "100%",
    maxWidth: 420,
    overflow: "hidden",
  },
  poster: {
    flex: 1,
    width: "100%",
  },
  imagen: {
    width: "100%",
    height: "100%",
  },
  sinImagen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  menu: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  pie: {
    paddingTop: 14,
    gap: 8,
    alignItems: "center",
    width: "100%",
    maxWidth: 420,
  },
  meta: {
    flexDirection: "row",
    alignItems: "center",
  },
  visto: {
    flexDirection: "row",
    alignItems: "center",
  },
  vacio: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 24,
  },
});
