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
      {onAdd ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('catalog.add', { title: result.title })}
          accessibilityHint={t('catalog.addHint')}
          disabled={disabled}
          hitSlop={8}
          onPress={() => onAdd(result)}
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
