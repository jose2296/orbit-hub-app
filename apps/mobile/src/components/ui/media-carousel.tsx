import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Image, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import type { LayoutChangeEvent } from 'react-native';
import Animated, {
  Easing,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import { useEffect } from 'react';

import { useTranslation } from '@/lib/i18n';
import { useTheme } from '@/theme';

import { FullTitle } from '@/components/media/full-title';
import { SeenRibbon } from '@/components/media/seen-ribbon';

import { useA11yHint } from './a11y-hint';
import { AppText } from './text';

export interface MediaCarouselItem {
  key: string;
  title: string;
  imageUrl: string | null;
  /** Year or publication year, shown as a badge under the card. */
  released: string | null;
  /** 'movie', 'tv' or 'books', shown as the second badge. */
  badge: string | null;
  onPress?: () => void;
  onLongPress?: () => void;
  /** Marks a watched or read title without leaving the list. */
  completed?: boolean;
  /** What the ribbon says out loud, so it is not the same sentence twice on a screen. */
  seenLabel?: string;
  /**
   * Whether the list this is being shown for **already has it**.
   *
   * For the collection and the recommendations in a detail: both are full of
   * titles that are also rows in the list you are reading. It was drawn as a mark
   * on the poster, and a mark is the wrong place: a coloured circle in one corner
   * is a fourth thing to look at on a card that already has a menu, a tick for
   * "watched" and two shortcuts.
   *
   * So it is **data and not a picture**. The card's own menu reads it and writes
   * the line that says so, where every other action already is — which is also
   * why the cards that have it and the ones that do not now look **the same**:
   * they differ in a word inside a menu instead of in a sticker on the poster.
   */
  inList?: boolean;
  onToggleCompleted?: () => void;
  /** Opens the menu of what can be done with this title. */
  onMenu?: () => void;
  /** The menu's own name, so it is not the same control twice on a screen. */
  menuLabel?: string;
}

export interface MediaCarouselProps {
  items: MediaCarouselItem[];
  title?: string;
}

/**
 * Horizontal carousel of covers, the way the legacy app showed films and books.
 *
 * A grid shows more titles at once but a poster is unreadable when it is 120px
 * wide, and this is the part of the app that is looked at rather than scanned.
 * The row snaps per card so one card is always fully visible.
 */
export function MediaCarousel({ items, title }: MediaCarouselProps) {
  const theme = useTheme();
  const t = useTranslation();

  /*
    How far the row has been dragged, and how wide it is.

    Both are shared values and not React state: a drag sends a scroll event per
    frame, and a state change per frame is a render of every card per frame. Two
    numbers that only the card styles read cost a style recalculation and not a
    render.

    **The scroll is read on the UI thread** through `useAnimatedScrollHandler`,
    which is the whole reason the parallax can be per frame at all — the value is
    read inside the animated style, on the thread, and no number crosses into
    JavaScript.
  */
  const desplazamiento = useSharedValue(0);
  const anchoVista = useSharedValue(0);

  const alDesplazar = useAnimatedScrollHandler({
    onScroll: (evento) => {
      desplazamiento.value = evento.contentOffset.x;
    },
  });

  /*
    The scroll handler, **and on the web it cannot be the scroll handler.**

    Reanimated's `useAnimatedScrollHandler` is meant to be handed to `onScroll`
    directly: on a phone that is what puts the offset on the UI thread without a
    single crossing into JavaScript. On the web it is not that. React Native Web's
    `ScrollView` calls `this.props.onScroll(event)` as an ordinary function, and
    what `useAnimatedScrollHandler` returns is not one — so the row threw
    `this.props.onScroll is not a function` on the first pixel dragged and the
    cards never moved.

    So on the web the offset is written from a plain function into the same shared
    value. **That is not a loss on this platform**: Reanimated on the web has no
    second thread to be on, it applies its styles from the browser's own frame
    loop, so a value written from JavaScript is applied on the very next frame and
    there was nothing to save. The phone keeps the handler it can use.
  */
  const escribirDesplazamiento =
    Platform.OS === 'web'
      ? (evento: { nativeEvent: { contentOffset: { x: number } } }) => {
          desplazamiento.value = evento.nativeEvent.contentOffset.x;
        }
      : alDesplazar;

  if (items.length === 0) return null;

  return (
    <View style={{ gap: theme.spacing.sm }}>
      {title ? (
        <AppText variant="bodyStrong">{title}</AppText>
      ) : null}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: theme.spacing.md, paddingHorizontal: theme.spacing.lg }}
        // One card at a time, so a cover is never cut in half.
        snapToInterval={CARD_WIDTH + theme.spacing.md}
        decelerationRate="fast"
        onLayout={(evento: LayoutChangeEvent) => {
          anchoVista.value = evento.nativeEvent.layout.width;
        }}
        onScroll={escribirDesplazamiento}
        scrollEventThrottle={16}
      >
        {items.map((item) => (
          <MediaCard
            key={item.key}
            item={item}
            seenLabel={item.seenLabel ?? t("mediaTabs.seen")}
            menuHint={t('mediaActions.menuHint')}
            desplazamiento={desplazamiento}
            anchoVista={anchoVista}
          />
        ))}
      </ScrollView>
    </View>
  );
}

const CARD_WIDTH = 140;

/** How long a card takes to arrive, and from how far down. */
const ENTRADA = { duration: 220, easing: Easing.out(Easing.cubic) } as const;

/** What a card is scaled down by on arrival, and how far below its place it starts. */
const ESCALA_LLEGADA = 0.06;
const BAJADA_LLEGADA = 8;

/**
 * The card in the middle, and **how near the middle it is**: zero at the centre,
 * one at either edge of the row.
 *
 * It is one number and both movements come out of it, so a card cannot be scaled
 * for one thing and shifted for another — there is a depth and it has one value.
 */
const PROFUNDIDAD_MAXIMA = 0.12;
const RECOGIDA_MAXIMA = 0.1;

function MediaCard({
  item,
  menuHint,
  seenLabel,
  desplazamiento,
  anchoVista,
}: {
  item: MediaCarouselItem;
  menuHint: string;
  /** Resolved by the row above, so the card does not need the dictionary itself. */
  seenLabel: string;
  /** How far the row has been dragged, from the row above. */
  desplazamiento: SharedValue<number>;
  /** How wide the row is, from the row above. */
  anchoVista: SharedValue<number>;
}) {
  const theme = useTheme();
  const [failed, setFailed] = useState(false);

  /*
    Where this card sits in the content, **measured and not counted.**

    It is its own `onLayout` and not `index * (CARD_WIDTH + gap)`: the row has a
    padding at both ends, the gap is a token, and a card is one of several places
    this carousel is used with different widths. The number the styles need is "how
    far is this card from the middle of what can be seen", and measuring it is the
    only way that number is right on every screen it is used on.
  */
  const xEnElContenido = useSharedValue(0);
  const entrada = useSharedValue(0);

  useEffect(() => {
    entrada.value = withTiming(1, ENTRADA);
  }, [entrada]);

  // Two controls, two hints: the poster opens the title, the corner button
  // opens its menu. The menu's hint only exists while there is a menu button,
  // so there is nothing to point at when `onMenu` is absent.
  const pistaPoster = useA11yHint(item.onMenu ? menuHint : null);
  const pistaMenu = useA11yHint(item.onMenu ? menuHint : null);
  // Same rule for the two shortcuts: no button, no hint.

  const showImage = item.imageUrl && !failed;

  const estilo = useAnimatedStyle(() => {
    /*
      How far this card is from the middle of the window, as a fraction of half the
      window. Signed, so a card to the left and a card to the right are the same
      distance and not opposites.

      **And it is cut at one, because a row of related titles is longer than the
      window and most of it is not on screen.** A card eight widths to the right is
      a distance of eight, and eight times the gathering is a hundred and twelve
      points of movement applied to something nobody is looking at — which is not a
      wasted animation, it is a wrong one: the card is off screen, so the movement
      does nothing visible where it is and shifts where the row's own edges are.
      Past the edge of the window a card is simply far away and the movement stops
      growing.
    */
    const medio = anchoVista.value / 2;
    const centro = xEnElContenido.value + CARD_WIDTH / 2;
    const distancia = Math.max(
      -1,
      Math.min(1, (centro - desplazamiento.value - medio) / (medio || 1)),
    );
    const profundidad = Math.abs(distancia);

    const escalaEntrada = 1 - ESCALA_LLEGADA * (1 - entrada.value);
    const escalaProfundidad = 1 - PROFUNDIDAD_MAXIMA * profundidad;

    return {
      opacity: entrada.value,
      transform: [
        { translateY: (1 - entrada.value) * BAJADA_LLEGADA },
        /*
          The gathering, **and it is ten per cent of the distance, not a number of
          points.**

          Ten per cent reads as depth without being readable as movement: a card at
          the edge of the window leans in by a seventh of its own width, which is
          enough to feel like the row has a middle and not enough to look like the
          cards are being rearranged. A fixed number of points would be a nudge on
          a phone and a lurch on a tablet, and it would push the card off its snap
          position by an amount that grows with the window rather than with the
          distance from the middle.
        */
        { translateX: distancia * CARD_WIDTH * RECOGIDA_MAXIMA },
        { scale: escalaEntrada * escalaProfundidad },
      ],
    };
  });

  return (
    <Animated.View
      style={[styles.tarjeta, estilo]}
      onLayout={(evento: LayoutChangeEvent) => {
        xEnElContenido.value = evento.nativeEvent.layout.x;
      }}
    >
      {/*
        La portada y **sus** botones en un contenedor con posicion, y no sueltos
        en la tarjeta. Posicionados contra la tarjeta, `bottom: 4` cae sobre la
        fila de chapas que va **debajo** del cartel: el `+` salia encima de la
        chapa y los dos se comian la mitad el uno del otro. El menu ya estaba en
        la esquina de la portada porque su esquina coincidia con la de la tarjeta;
        estos dos estan abajo y esa coincidencia no existe.
      */}
      <View style={styles.area}>
        <Pressable
        accessibilityRole="button"
        accessibilityLabel={item.title}
        {...pistaPoster.props}
        onPress={item.onPress}
        onLongPress={item.onLongPress}
        style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
      >
        <View
          style={[
            styles.poster,
            {
              borderRadius: theme.radius.lg,
              backgroundColor: theme.colors.surfaceMuted,
              ...theme.shadow.card,
            },
          ]}
        >
          {showImage ? (
            <Image
              source={{ uri: item.imageUrl as string }}
              // `resizeMode` moved from style to props in React Native Web.
              resizeMode="cover"
              style={StyleSheet.absoluteFill}
              onError={() => setFailed(true)}
            />
          ) : (
            // A provider with no image, or one that fails to load, still needs
            // to show something that is not a grey hole.
            <View style={styles.fallback}>
              <Ionicons
                name={item.badge === 'books' ? 'book-outline' : 'film-outline'}
                size={28}
                color={theme.colors.textMuted}
              />
            </View>
          )}

          {/*
            Seen, **in the same corner and with the same ribbon as the carousel**.

            It was a twenty-four point circle with a tick in it, on a hundred and
            forty point card, in the corner the menu button is not. A title you have
            already watched has to look the same everywhere it appears: on the
            carousel, on a related title, on a collection and on a search result, or
            the eye has to be re-learned in four places. The size is half the
            carousel's because the card is a third smaller, and it is **scaled from
            the same numbers** rather than drawn again.
          */}
          <SeenRibbon
            /*
              **Only for a title that is in the list.** A related title the reader
              does not have has no row, so there is no state to draw: "not seen" is
              only a true thing about something they meant to watch, and a corner
              saying so on forty titles they have never heard of turns the corner
              into wallpaper.
            */
            completed={item.completed === true}
            inList={item.inList !== false}
            label={seenLabel}
            size={52}
            testID={`visto-${item.key}`}
          />
        </View>
      </Pressable>

      {item.onMenu ? (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={item.title}
            {...pistaMenu.props}
            hitSlop={8}
            onPress={item.onMenu}
            style={({ pressed }) => [styles.menu, { opacity: pressed ? 0.7 : 1 }]}
          >
            <View
              style={[
                styles.menuGlifo,
                {
                  backgroundColor: theme.colors.surfaceMuted,
                  borderRadius: theme.radius.sm,
                },
              ]}
            >
              <Ionicons name="ellipsis-horizontal" size={14} color={theme.colors.text} />
            </View>
          </Pressable>
          {pistaMenu.node}
        </>
      ) : null}

      
      </View>

      {/*
        The name, **and the whole of it on a long press**.

        It was two lines and nothing else, so "Everything Everywhere All at Once"
        arrived as "Everything Everywhere" — which is not a shorter title, it is a
        different one. The card is a hundred and forty points wide and that is not
        going to change; being able to *read* the name is.
      */}
      <FullTitle
        text={item.title}
        numberOfLines={2}
        style={[styles.title, { marginTop: theme.spacing.xs }]}
        testID={`titulo-${item.key}`}
      />

      {item.released || item.badge ? (
        <View style={styles.badges}>
          {item.released ? (
            <View
              style={[
                styles.badge,
                { borderRadius: theme.radius.sm, borderColor: theme.colors.borderStrong },
              ]}
            >
              <AppText variant="caption" tone="muted">
                {item.released}
              </AppText>
            </View>
          ) : null}
          {item.badge ? (
            <View
              style={[
                styles.badge,
                { borderRadius: theme.radius.sm, backgroundColor: theme.colors.accentSoft },
              ]}
            >
              <AppText variant="caption" tone="accent">
                {item.badge}
              </AppText>
            </View>
          ) : null}
        </View>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  /*
    The card's own box, and **it is animated so the layout is not**.

    The width is a layout property and it stays a layout property: it is what the
    `snapToInterval` above is calculated from, and a card that got its width from a
    transform would not be where the row thinks it is. Only the arrival and the
    depth are animated, and both of those are transform and opacity.
  */
  tarjeta: {
    width: CARD_WIDTH,
  },
  poster: {
    width: CARD_WIDTH,
    height: CARD_WIDTH * 1.5,
    overflow: 'hidden',
  },
  fallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /*
    El menu de la tarjeta, con el mismo tratamiento: circulo de 24, blanco de 40.

    Antes era un `Pressable` de 24 con el glifo dentro, y media 24. Con `hitSlop` el
    blanco crecia hacia los dos botones de abajo, que estan a cuatro pixeles, y un
    dedo que apuntaba al menu se activaba a veces el de al lado.
  */
  menu: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuGlifo: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  area: {
    position: 'relative',
  },
  /*
    Cuarenta de alto y de ancho, y no 26.
    
    El circulo sigue siendo de 26 porque asi cabe en la esquina de una portada de
    120, pero **el blanco que se puede pulsar es de 40**: los dos botones van
    superpuestos sobre el cartel, asi que un blanco de 26 se solapaba con el otro y
    con el menu, y pulsando al lado de uno se pulsaba el de al lado. Medido en web:
    28 objetivos de 26 en la ficha, 14 de ellos los dos botones de las tarjetas.
  */
  // El blanco mide 40 y el circulo 26: el desplazamiento deja el circulo a 4 del
  // borde de la portada, que es donde se espera un boton de esquina.
  /*
    El circulo de 24 se queda; el blanco pasa a 40.

    Es el mismo tratamiento que los dos botones de la esquina: lo que se ve no
    cambia de sitio y lo que se puede pulsar se agranda. Y sale de una medicion, no
    de una regla: la marca de "vista" de cada tarjeta media 24x24.
  */
  title: {
    minHeight: 32,
  },
  badges: {
    flexDirection: 'row',
    gap: 4,
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
