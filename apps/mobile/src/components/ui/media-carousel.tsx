import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { useTranslation } from '@/lib/i18n';
import { useTheme } from '@/theme';

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
  const [failed, setFailed] = useState(false);

  const showImage = item.imageUrl && !failed;

  return (
    <View style={{ width: CARD_WIDTH }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={item.title}
        accessibilityHint={labelAdd}
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
            <View
              style={[
                styles.seen,
                { backgroundColor: theme.colors.accent, borderRadius: theme.radius.sm },
              ]}
            >
              <Ionicons name="checkmark" size={14} color={theme.colors.onAccent} />
            </View>
          ) : null}
        </View>
      </Pressable>

      {/* The menu is a sibling of the poster and not a child of it: a button
          inside a button is not valid HTML, a screen reader reads the two as
          one, and the tap lands on the outer one. It sits over the corner of
          the poster, which is where a menu is expected. */}
      {item.onMenu ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={item.title}
          accessibilityHint={menuHint}
          hitSlop={8}
          onPress={item.onMenu}
          style={({ pressed }) => [
            styles.menu,
            {
              backgroundColor: theme.colors.surfaceMuted,
              borderRadius: theme.radius.sm,
              opacity: pressed ? 0.7 : 1,
            },
          ]}
        >
          <Ionicons name="ellipsis-horizontal" size={14} color={theme.colors.text} />
        </Pressable>
      ) : null}

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
  menu: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  seen: {
    position: 'absolute',
    top: 8,
    right: 8,
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
