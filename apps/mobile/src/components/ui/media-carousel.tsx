import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { useTranslation } from '@/lib/i18n';
import { useTheme } from '@/theme';

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
  onToggleCompleted?: () => void;
  /** Opens the menu of what can be done with this title. */
  onMenu?: () => void;
  /** The menu's own name, so it is not the same control twice on a screen. */
  menuLabel?: string;
  /**
   * Puts this title in the list, from the card.
   *
   * On a list's own carousel this is already a row in the list, so it is not
   * offered there. It is offered in the **related** and **collection** carousels,
   * where a poster is a suggestion: without it, the only way to keep a title the
   * screen itself put in front of you is to open it, find the button and come
   * back to where you were.
   */
  onAdd?: () => void;
  /**
   * Opens the trailer and the providers of this title, in one sheet.
   *
   * One button and not two, and the reason is the card: at 120 points wide there
   * is room for the poster, a menu and one more control. And the two questions —
   * "show me" and "who has it" — have the same answer, which is ninety seconds
   * and then a list of names.
   */
  onWatch?: () => void;
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
      >
        {items.map((item) => (
          <MediaCard
            key={item.key}
            item={item}
            labelAdd={t('lists.addToList')}
            menuHint={t('mediaActions.menuHint')}
          />
        ))}
      </ScrollView>
    </View>
  );
}

const CARD_WIDTH = 140;

function MediaCard({
  item,
  labelAdd,
  menuHint,
}: {
  item: MediaCarouselItem;
  labelAdd: string;
  menuHint: string;
}) {
  const theme = useTheme();
  const t = useTranslation();
  const [failed, setFailed] = useState(false);

  // Two controls, two hints: the poster opens the title, the corner button
  // opens its menu. The menu's hint only exists while there is a menu button,
  // so there is nothing to point at when `onMenu` is absent.
  const pistaPoster = useA11yHint(labelAdd);
  const pistaMenu = useA11yHint(item.onMenu ? menuHint : null);
  // Same rule for the two shortcuts: no button, no hint.
  const pistaAdd = useA11yHint(item.onAdd ? t('catalog.addHint') : null);
  const pistaWatch = useA11yHint(item.onWatch ? t('mediaActions.watchHint') : null);

  const showImage = item.imageUrl && !failed;

  return (
    <View style={{ width: CARD_WIDTH }}>
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

          {item.completed ? (
            <View style={styles.seen}>
              <View
                style={[
                  styles.seenGlifo,
                  { backgroundColor: theme.colors.accent, borderRadius: theme.radius.sm },
                ]}
              >
                <Ionicons name="checkmark" size={14} color={theme.colors.onAccent} />
              </View>
            </View>
          ) : null}
        </View>
      </Pressable>

      {/*
        The two shortcuts. They are siblings of the poster and not children of it
        for the same reason the menu is: a button inside a button is not valid
        HTML, a screen reader reads the two as one, and the tap lands on the
        outer one.
      */}
      {item.onAdd ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("catalog.add", { title: item.title })}
          {...pistaAdd.props}
          hitSlop={8}
          onPress={item.onAdd}
          style={({ pressed }) => [
            styles.corta,
            styles.abajoIzquierda,
            { opacity: pressed ? 0.75 : 1 },
          ]}
        >
          <View
            style={[
              styles.cortaGlifo,
              { backgroundColor: theme.colors.accent, borderRadius: theme.radius.sm },
            ]}
          >
            <Ionicons name="add" size={16} color={theme.colors.onAccent} />
          </View>
        </Pressable>
      ) : null}
      {pistaAdd.node}

      {item.onWatch ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("mediaActions.watchOf", { name: item.title })}
          {...pistaWatch.props}
          hitSlop={8}
          onPress={item.onWatch}
          style={({ pressed }) => [
            styles.corta,
            styles.abajoDerecha,
            { opacity: pressed ? 0.75 : 1 },
          ]}
        >
          <View
            style={[styles.cortaGlifo, { backgroundColor: 'rgba(0, 0, 0, 0.72)' }]}
          >
            <Ionicons name="play" size={14} color="#ffffff" />
          </View>
        </Pressable>
      ) : null}
      {pistaWatch.node}
      {pistaPoster.node}

      {/* The menu is a sibling of the poster and not a child of it: a button
          inside a button is not valid HTML, a screen reader reads the two as
          one, and the tap lands on the outer one. It sits over the corner of
          the poster, which is where a menu is expected. */}
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

      <AppText variant="caption" numberOfLines={2} style={[styles.title, { marginTop: theme.spacing.xs }]}>
        {item.title}
      </AppText>

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
    </View>
  );
}

const styles = StyleSheet.create({
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
  corta: {
    position: 'absolute',
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cortaGlifo: {
    width: 26,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // El blanco mide 40 y el circulo 26: el desplazamiento deja el circulo a 4 del
  // borde de la portada, que es donde se espera un boton de esquina.
  abajoIzquierda: {
    left: -7,
    bottom: -7,
  },
  abajoDerecha: {
    right: -7,
    bottom: -7,
  },
  /*
    El circulo de 24 se queda; el blanco pasa a 40.

    Es el mismo tratamiento que los dos botones de la esquina: lo que se ve no
    cambia de sitio y lo que se puede pulsar se agranda. Y sale de una medicion, no
    de una regla: la marca de "vista" de cada tarjeta media 24x24.
  */
  seen: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  seenGlifo: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
