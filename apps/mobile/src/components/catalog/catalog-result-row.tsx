import { Ionicons } from '@expo/vector-icons';
import { Image, Pressable, StyleSheet, View } from 'react-native';

import type { CatalogResult } from '@orbit-hub/contracts';

import { AppText } from '@/components/ui/text';
import { useTranslation } from '@/lib/i18n';
import { useTheme } from '@/theme';

export interface CatalogResultRowProps {
  result: CatalogResult;
  /** Opens the detail, and it is the whole row that does it. */
  onPress: (result: CatalogResult) => void;
  disabled?: boolean;
  /**
   * The add button, and it is a separate one.
   *
   * It used to be an `+` drawn inside the row's own `Pressable`, which is a
   * picture of a button: pressing it opened the detail, which is the one thing
   * a `+` must never do. Somebody who taps `+` on a poster wants the poster in
   * their list, and instead they land in a screen and have to find the way back
   * out to do the thing they already asked for.
   */
  onAdd?: (result: CatalogResult) => void;
  /**
   * Whether this title is **already a row in the list being added to**.
   *
   * It replaces the `+` with a tick and a word, and that is the whole reason it is
   * not just "do not let the `+` work": a button that does nothing and still looks
   * like a button is a button somebody taps twice and then asks why. Saying "Ya
   * está" costs one line and answers the question the tap was asking.
   */
  inList?: boolean;
}

/**
 * One catalog hit. Kept as a component rather than inline in the screen so the
 * layout of a poster plus two lines of metadata is defined once.
 */
export function CatalogResultRow({
  result,
  onPress,
  onAdd,
  disabled,
  inList,
}: CatalogResultRowProps) {
  const theme = useTheme();
  const t = useTranslation();

  const poster = result.imageUrl ? (
    <Image
      source={{ uri: result.imageUrl }}
      // `resizeMode` moved from style to props in React Native Web.
      resizeMode="cover"
      style={[
        styles.poster,
        { borderRadius: theme.radius.sm, backgroundColor: theme.colors.surfaceMuted },
      ]}
    />
  ) : (
    <View
      style={[
        styles.poster,
        styles.posterFallback,
        {
          borderRadius: theme.radius.sm,
          backgroundColor: theme.colors.surfaceMuted,
        },
      ]}
    >
      <Ionicons name="film-outline" size={18} color={theme.colors.textMuted} />
    </View>
  );

  return (
    <View style={[styles.row, { gap: theme.spacing.md, paddingVertical: theme.spacing.sm }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${result.title}${result.subtitle ? `, ${result.subtitle}` : ''}`}
        disabled={disabled}
        onPress={() => onPress(result)}
        style={({ pressed }) => [
          styles.row,
          styles.grow,
          { gap: theme.spacing.md, opacity: disabled ? 0.5 : pressed ? 0.7 : 1 },
        ]}
      >
        {poster}
        <View style={[styles.text, { gap: 2 }]}>
          <AppText variant="bodyStrong" numberOfLines={2}>
            {result.title}
          </AppText>
          {result.subtitle ? (
            <AppText variant="caption" tone="muted" numberOfLines={1}>
              {result.subtitle}
            </AppText>
          ) : null}
          <AppText variant="caption" tone="subtle">
            {result.provider === 'tmdb' ? t('catalog.sourceTmdb') : t('catalog.sourceBooks')}
          </AppText>
        </View>
      </Pressable>

      {/*
        Forty points square, and not twenty-two: the row above it is a button the
        whole length of the screen, and a target that much smaller than its
        neighbours is a target that gets missed and then blamed.
      */}
      {inList ? (
        /*
          The tick, and it is **not a button**.
         *
          Same 40 points, so the column of controls does not move when a result
          turns into a "you have it" — a row that reflows as the search comes back
          is a row that moves under the finger that is reading it. What it is not
          is pressable: there is nothing to press, and a control that does nothing
          when pressed is worse than no control.
        */
        <View
          style={[styles.add, styles.yaEsta]}
          accessibilityRole="text"
          accessibilityLabel={t('catalog.inList')}
          testID={`catalog-in-list-${result.externalId}`}
        >
          <Ionicons name="checkmark-circle" size={22} color={theme.colors.success} />
          <AppText variant="caption" style={{ color: theme.colors.success }}>
            {t('catalog.inList')}
          </AppText>
        </View>
      ) : onAdd ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('catalog.add', { title: result.title })}
          accessibilityHint={t('catalog.addHint')}
          disabled={disabled}
          hitSlop={8}
          onPress={() => onAdd(result)}
          testID={`catalog-add-${result.externalId}`}
          style={({ pressed }) => [
            styles.add,
            { opacity: disabled ? 0.4 : pressed ? 0.6 : 1 },
          ]}
        >
          <Ionicons name="add-circle-outline" size={24} color={theme.colors.accent} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  yaEsta: {
    flexDirection: "row",
    alignItems: "center",
    opacity: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  poster: {
    width: 44,
    height: 62,
  },
  posterFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    flex: 1,
  },
  grow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  add: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 40,
    minHeight: 40,
  },
});
