import { Ionicons } from '@expo/vector-icons';
import { Image, Pressable, StyleSheet, View } from 'react-native';

import type { CatalogResult } from '@orbit-hub/contracts';

import { AppText } from '@/components/ui/text';
import { useTranslation } from '@/lib/i18n';
import { useTheme } from '@/theme';

export interface CatalogResultRowProps {
  result: CatalogResult;
  onPress: (result: CatalogResult) => void;
  disabled?: boolean;
}

/**
 * One catalog hit. Kept as a component rather than inline in the screen so the
 * layout of a poster plus two lines of metadata is defined once.
 */
export function CatalogResultRow({ result, onPress, disabled }: CatalogResultRowProps) {
  const theme = useTheme();
  const t = useTranslation();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${result.title}${result.subtitle ? `, ${result.subtitle}` : ''}`}
      disabled={disabled}
      onPress={() => onPress(result)}
      style={({ pressed }) => [
        styles.row,
        {
          gap: theme.spacing.md,
          paddingVertical: theme.spacing.sm,
          opacity: disabled ? 0.5 : pressed ? 0.7 : 1,
        },
      ]}
    >
      {result.imageUrl ? (
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
      )}

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

      <Ionicons name="add-circle-outline" size={22} color={theme.colors.accent} />
    </Pressable>
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
});
