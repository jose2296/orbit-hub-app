import { Ionicons } from "@expo/vector-icons";
import { Animated, Pressable, StyleSheet, View } from "react-native";
/*
  React Native's `Animated` is above, for the values; **this one is the other
  `Animated`**, the one that has an `Image`. A `sharedTransitionTag` is read by
  Reanimated's animated components and by nothing else: handed to React Native's
  own `Animated.Image` it would be an unknown prop, dropped in silence, and the
  transition would never happen with no error anywhere to look.
*/
import AnimatedUI from "react-native-reanimated";
import { useCallback, useEffect, useRef, useState } from "react";
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FullTitle } from "@/components/media/full-title";
import { SeenRibbon } from "@/components/media/seen-ribbon";
import { usePosterFlight } from "@/components/media/poster-flight";
import { AppText } from "@/components/ui/text";
import { useTranslation } from "@/lib/i18n";
import { useTheme } from "@/theme";
import {
  sharedCoverStyle,
  sharedCoverTag,
  sharedCoverTitleStyle,
} from "@/lib/media/shared-cover";

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
  onMenu?: () => void;
  menuLabel: string;
}

export interface VerticalMediaCarouselProps {
  items: VerticalMediaItem[];
  /** Shown when there is nothing to flick through. */
  emptyTitle: string;
  emptyBody: string;
}

/**
 * The breathing room between two posters, **inside the item and not between
 * them**.
 *
 * This is the whole trick of the component, and it is why the scroll can never
 * rest in between. A gap *between* items means the distance between one item's
 * top and the next one's is not the item's height, so any snapping has to be told
 * that number; and being told a number, it gets it wrong somewhere — the
 * arithmetic is right in the types and wrong in the browser. A gap *inside* the
 * item means the item is exactly a screen, and "snap one screen" needs no number
 * at all.
 */
const AIRE = 24;

/**
 * The list of films, series or books, **one at a time**, snapped the way a short
 * video feed is.
 *
 * **`pagingEnabled`, and not `snapToInterval`.** Two reasons, and the second one
 * is the interesting. The first is that it is what "one screen per item" means:
 * `pagingEnabled` snaps to the size of the scroller, and an item *is* the size of
 * the scroller, so there is no interval to compute and therefore no interval to
 * get wrong. The second is that `snapToInterval` **does not exist on the web**:
 * react-native-web 0.21 implements `pagingEnabled` as CSS scroll-snap
 * (`scroll-snap-type: y mandatory`) and ignores `snapToInterval` and
 * `disableIntervalMomentum` completely. A carousel built on `snapToInterval`
 * snaps perfectly on a phone and scrolls like an ordinary list in a browser,
 * which is exactly the kind of thing that only shows up in the one place it was
 * measured.
 *
 * **You cannot stop between items, and that is structural.** The page *is* the
 * item, so there is no half position to come to rest in: whatever the gesture,
 * the scroll finishes on a boundary.
 *
 * **The item is the height it is given, measured.** The same component serves a
 * phone, a short window and a tablet with no height written down anywhere.
 *
 * **Each poster lifts a little as it goes past.** The scale and the opacity come
 * from the scroll offset rather than from a state, so the one in the middle is
 * the big one and the one leaving is smaller and fainter. It is the only thing
 * that says "there is more of this and it slides".
 *
 * **Marking it seen is done from here.** The "seen" mark used to be a picture:
 * `onToggleCompleted` was declared on the carousel's item type and nobody passed
 * it, so the only way to move a title into the seen list was to open its sheet
 * first. A state you can only change from one particular screen is a setting.
 */
export function VerticalMediaCarousel({
  items,
  emptyTitle,
  emptyBody,
}: VerticalMediaCarouselProps) {
  const theme = useTheme();
  const t = useTranslation();
  const insets = useSafeAreaInsets();

  const [alto, setAlto] = useState(0);
  const desplazamiento = useRef(new Animated.Value(0)).current;
  const ref = useRef<View>(null);
  const refTitulo = useRef<View>(null);
  /** The two rectangles of the card the last time somebody pressed it. */
  const medirRef = useRef<{
    desde: { x: number; y: number; width: number; height: number };
    tituloDesde: { x: number; y: number; width: number; height: number };
  } | null>(null);
  const vuelo = usePosterFlight();

  /*
    Where the row is scrolled to, **put back to the beginning whenever the set of
    posters changes.**

    The fade below is a function of how far each card is from the middle of the
    screen, and the card in the middle is the one at full opacity — which means the
    *first* card is only at full opacity while the row is scrolled to the
    beginning. Changing the tab changes the posters without changing the scroll
    position, so the card a person is looking at inherited whatever offset the
    other tab had been left at, and arrived dimmed.

    That is the whole of the asymmetry that made this look like two different
    things: the tab with one title has nothing to scroll and is always centred, and
    the tab with five keeps the offset of wherever the last tab was left and shows
    its first poster at two thirds.

    **And the offset is a number, not a scroll command**, so this does not fight a
    finger that is on the row at the moment the data arrives: the value is what the
    scroll actually is, and it is written again by `onScroll` the moment it is not.
  */
  useEffect(() => {
    desplazamiento.setValue(0);
  }, [desplazamiento, items]);

  /**
   * Which poster failed to load, and it is a **Set and not a flag**.
   *
   * One flag for the whole carousel is a bug with a delay: the first poster that
   * 404s puts every other poster on the screen to the fallback, including the ones
   * that load fine, and there is no way to tell which one did it. Measured with a
   * 404 in the seed: a card with a URL and no picture in it, which is the worst of
   * both — it has the layout of a poster and none of the content.
   *
   * A row written by hand has no URL and gets the icon straight away; a row whose
   * URL is dead gets it when the image says so.
   */
  const [fallidos, setFallidos] = useState<ReadonlySet<string>>(new Set());
  /**
   * This card's own box on the screen, **asked for at the moment of the press and
   * not on layout.**
   *
   * A layout event says where the card was last time somebody drew it; a press is
   * the last word on where it is now, after any scrolling, after any change of tab
   * and after any rotation. The flight is built out of this rectangle and out of
   * the one the detail measures for itself, so both numbers are asked of the thing
   * that is being measured rather than written down here.
   *
   * **It is measured in window coordinates** — from the top left of the screen and
   * not of the list — because the copy that flies is drawn above every screen and
   * has to agree with a card that is inside one.
   */
  const medir = useCallback(
    (item: VerticalMediaItem) => {
      ref.current?.measureInWindow((x, y, width, height) => {
        refTitulo.current?.measureInWindow((tx, ty, tw, th) => {
          medirRef.current = {
            desde: { x, y, width, height },
            tituloDesde: { x: tx, y: ty, width: Math.max(1, tw), height: Math.max(1, th) },
          };
          vuelo.iniciar({
            id: item.key,
            uri: item.imageUrl,
            titulo: item.title,
            desde: { x, y, width, height },
            tituloDesde: { x: tx, y: ty, width: Math.max(1, tw), height: Math.max(1, th) },
          });
        });
      });
    },
    [vuelo],
  );

  const fallo = useCallback(
    (key: string) =>
      setFallidos((previos) => {
        if (previos.has(key)) return previos;
        const siguiente = new Set(previos);
        siguiente.add(key);
        return siguiente;
      }),
    [],
  );

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    setAlto(Math.round(e.nativeEvent.layout.height));
  }, []);

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      desplazamiento.setValue(e.nativeEvent.contentOffset.y);
    },
    [desplazamiento],
  );

  const renderItem = useCallback(
    ({ item, index }: { item: VerticalMediaItem; index: number }) => {
      /* How far this item is from the page in the middle: 0 there, 1 next door. */
      const distancia = Animated.subtract(desplazamiento, index * alto);
      const closeness = Animated.divide(distancia, alto || 1);
      const escala = closeness.interpolate({
        inputRange: [-1, 0, 1],
        outputRange: [0.88, 1, 0.88],
        extrapolate: "clamp",
      });
      const opacidad = closeness.interpolate({
        inputRange: [-1.5, -0.4, 0, 1],
        outputRange: [0.2, 0.65, 1, 0.65],
        extrapolate: "clamp",
      });

      return (
        <View
          style={[
            styles.item,
            {
              height: alto || undefined,
              // `AIRE / 2` por arriba y por abajo, y no un separador entre items:
              // un hueco entre items hace que la distancia entre la cabecera de
              // uno y la del siguiente no sea su alto, y el `pagingEnabled` nece-
              // sita que sea justo su alto para no poder parar a mitad.
              paddingTop: AIRE / 2,
              // El margen de abajo del sistema va **dentro** del item por lo mismo:
              // puesto en la lista haria que la ultima pagina no llegara arriba.
              paddingBottom: (insets.bottom ?? 0) + AIRE / 2,
            },
          ]}
        >
          {/*
            The card takes **what is left** and does not ask for a height.
           *
            It asked for `alto - aire`, which is everything the item has, and then
            the title and the "mark as watched" button underneath had nowhere to go
            and were pushed out of the page: measured, an item 620 tall with a
            poster 596 tall and no footer at all. The snap does not need the card
            to be a number — it needs the **item** to be one screen, and the item
            is the thing with the height on it.
          */}
          <Animated.View
            style={[
              styles.carta,
              {
                borderRadius: theme.radius.lg,
                transform: [{ scale: escala }],
                opacity: opacidad,
              },
            ]}
          >
            <Pressable
              ref={ref}
              onPress={() => {
                medir(item);
                item.onPress?.();
              }}
              accessibilityRole="button"
              accessibilityLabel={item.title}
              style={styles.poster}
            >
              {item.imageUrl && !fallidos.has(item.key) ? (
                <AnimatedUI.Image
                  source={{ uri: item.imageUrl }}
                  style={[styles.imagen, sharedCoverStyle(item.key)]}
                  resizeMode="cover"
                  onError={() => fallo(item.key)}
                  /*
                    The name this poster shares with the cover on the detail, and
                    **the whole of what makes one picture out of two screens.**

                    It is `key`, which is the row's own id and the same id the route
                    to the detail carries, so the two names cannot drift apart. See
                    `lib/media/shared-cover.ts` for why the name is prefixed and why
                    it has to be taken off again when the screen goes.
                  */
                  sharedTransitionTag={sharedCoverTag(item.key)}
                />
              ) : (
                <View
                  style={[styles.sinImagen, { backgroundColor: theme.colors.surfaceMuted }]}
                >
                  <Ionicons
                    name={item.badge === "Libro" ? "book-outline" : "film-outline"}
                    size={56}
                    color={theme.colors.textSubtle}
                  />
                </View>
              )}
            </Pressable>

            {/*
              Whether it has been seen, **in the top left corner**.

              The menu is in the other one, so the two do not fight for the same
              space and the card has one thing in each corner instead of three
              things in two.

              **A closed eye for seen and an open one for not.** A closed eye is a
              thing you have finished with, which is what "watched" is; an open one
              is a thing you have not, and the icon carries the state before the
              colour does. The colours are two different ones and not one with
              less opacity, because "less" of a colour is a shade and two shades of
              the same colour are not a difference anybody can name.

              It is a **mark and not a button**. Marking a title as seen happens in
              the sheet, where the rest of what you can do with it is: a control on
              the card that changes one thing and opens nothing is a card with a
              trap in the corner, and the corner is the first place a finger goes.
            */}
            {/*
              Whether it has been seen, **in the corner and not on the picture**.

              It was a forty-point circle with an eye in it, and forty points of a
              poster in the corner is a hole: the film is hidden under a control that
              is not a control. The drawing lives in `SeenRibbon` now, because the
              same corner has to say the same thing on a related title, on a
              collection and on a search result, and four copies of a triangle is
              four chances to have one of them the wrong size.
            */}
            <SeenRibbon
              completed={item.completed}
              label={t("mediaTabs.seen")}
              testID={`visto-${item.key}`}
            />

            {/* The menu, a sibling of the poster and not a child: a button inside a
                button is not valid HTML, and on the web that is not a style
                problem, it is a click that goes to the wrong thing. */}
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
            {/*
              The name under the poster, **and the whole of it on a long press**.

              Two lines in the middle of a three hundred and twenty point screen is
              about twenty characters of a title, and half the films in a list like
              this one have longer names than that. The press opens the sheet and
              the tap still opens the film: two gestures, two different things, and
              neither of them is a guess.
            */}
            {/*
              The title travels with the picture, **and it is the title's own name**
              so the browser pairs it with the title and not with the poster.
              Without it the poster moves alone, and a picture travelling by itself
              is read as the gallery sliding rather than as the title being opened.
              `sharedCoverTitleStyle` writes nothing on a phone — see
              `lib/media/shared-cover.ts`.
            */}
            <View ref={refTitulo} collapsable={false}>
              <FullTitle
                text={item.title}
                numberOfLines={2}
                style={[styles.titulo, sharedCoverTitleStyle(item.key)]}
                testID={`titulo-${item.key}`}
              />
            </View>
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

          </View>
        </View>
      );
    },
    [alto, desplazamiento, insets.bottom, theme, fallidos, fallo],
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
          The snap. One page is one item, and there is nothing between two pages.
        */
        pagingEnabled
        /*
          The layout is known — a page is exactly `alto` — so the list can be told
          where every item is without measuring anything, which is what makes a
          long list of posters work on a phone.
        */
        getItemLayout={(_, index) => ({ length: alto, offset: alto * index, index })}
        onScroll={onScroll}
        scrollEventThrottle={32}
        initialNumToRender={2}
        windowSize={3}
        /*
          No padding and no separator on the container: either would move the first
          item off the page boundary and the first flick would not land on it.
        */
        contentContainerStyle={styles.contenido}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  raiz: {
    flex: 1,
  },
  contenido: {},
  item: {
    alignItems: "center",
    paddingHorizontal: 20,
  },
  carta: {
    /*
      `flex: 1` y no un alto.
     *
      Se le quito el alto porque pedia `alto - aire`, que es todo lo que tiene el
      item, y entonces el titulo y el boton de "marcar como visto" se quedaron sin
      sitio y salieron de la pagina. Pero quitar el alto **sin** darle flex la deja
      midiendo lo que mida su contenido, y su contenido es un `View` con `flex: 1`
      dentro de una caja sin alto: cero. Medido, un item de 620 con la pelicula
      invisible y las tres lineas de texto pegadas arriba.
     *
      El alto que importa para el snap es el del **item**, y ese lo tiene escrito en
      la lista; la tarjeta solo ocupa lo que sobra.
    */
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
    paddingTop: 12,
    gap: 6,
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
  titulo: {
    textAlign: 'center',
  },
  vacio: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 24,
  },
});
