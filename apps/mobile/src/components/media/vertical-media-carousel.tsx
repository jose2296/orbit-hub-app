import { Ionicons } from "@expo/vector-icons";
import { Animated, Image, Pressable, StyleSheet, View } from "react-native";
import { useCallback, useRef, useState } from "react";
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from "react-native";
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
  const insets = useSafeAreaInsets();

  const [alto, setAlto] = useState(0);
  const desplazamiento = useRef(new Animated.Value(0)).current;

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
              paddingTop: AIRE / 2,
              // The bottom inset goes **inside** the item, for the same reason the
              // air between items does: adding it to the list instead would make
              // the last page not reach the top and the last poster would be the
              // one that cannot be scrolled into place.
              paddingBottom: (insets.bottom ?? 0) + AIRE / 2,
            },
          ]}
        >
          <Animated.View
            style={[
              styles.carta,
              {
                height: alto ? alto - AIRE - (insets.bottom ?? 0) : undefined,
                borderRadius: theme.radius.lg,
                transform: [{ scale: escala }],
                opacity: opacidad,
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
              The seen mark, as a **button** and not a badge, and it says what it
              does. "Visto" next to a title that is not seen is a claim, and a
              label that does not change is a control whose effect is a guess.
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
    [alto, desplazamiento, insets.bottom, theme],
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
  vacio: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 24,
  },
});
