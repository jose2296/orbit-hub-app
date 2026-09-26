import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';

import { useListItems } from '@/hooks/use-lists';
import { useScreenTitle } from '@/hooks/use-screen-title';
import { Image, Linking, Pressable, StyleSheet, View } from 'react-native';

import type { CatalogDetails, CatalogRelated } from '@orbit-hub/contracts';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { MediaActionsSheet } from '@/components/lists/media-actions-sheet';
import { MediaCarousel } from '@/components/ui/media-carousel';
import { Screen } from '@/components/ui/screen';
import { AppText } from '@/components/ui/text';
import { api, toApiError } from '@/lib/api';
import { useTranslation } from '@/lib/i18n';
import { stripHtml } from '@/lib/text/html';
import { useTheme } from '@/theme';

/**
 * Detail of a film, a series or a book.
 *
 * Fetched from the provider when the screen opens rather than read from the
 * list item: a detail is large and it changes at the provider, so storing it
 * with every item would bloat the sync payload for data that is one tap away.
 * The item itself only needs enough to be recognisable offline.
 */
export default function ItemDetailsScreen() {
  const theme = useTheme();
  const t = useTranslation();
  const router = useRouter();
  const { itemId, kind, externalId, title, itemKey } = useLocalSearchParams<{
    /** Which list it is in, so the detail can take it out of it. */
    itemId?: string;
    kind?: string;
    externalId?: string;
    title?: string;
    /** Which row of that list it is, so it can be ticked off from here. */
    itemKey?: string;
  }>();

  const [details, setDetails] = useState<CatalogDetails | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);

  /**
   * The row in the list this title came from.
   *
   * The detail is fetched from the provider, so it knows nothing about what
   * this person did with it: whether it is in a list, whether they have watched
   * it, whether they want to take it out. Those live in the item, and the
   * screen is a dead end without them.
   */
  const { items, toggleCompleted } = useListItems(itemId);
  const item = useMemo(
    () => items.find((row) => (itemKey ? row.id === itemKey : row.externalId === externalId)) ?? null,
    [items, itemKey, externalId],
  );
  const [menuOpen, setMenuOpen] = useState(false);

  // Before any early return: a hook behind one is called a different number of
  // times while loading and once it has failed, and React stops believing the
  // order of the calls from then on.
  useScreenTitle(name ?? title ?? t('itemDetails.loading'));

  useEffect(() => {
    if (!kind || !externalId) {
      setError(t('itemDetails.missingId'));
      setIsLoading(false);
      return;
    }

    let active = true;
    setIsLoading(true);
    void api
      .get<CatalogDetails>(
        `/catalog/details?kind=${encodeURIComponent(kind)}&externalId=${encodeURIComponent(externalId)}`,
      )
      .then((payload) => {
        if (active) {
          setDetails(payload);
          setError(null);
          // The name of the thing, once it is known: the header is what says
          // where you are.
          setName(payload.title);
        }
      })
      .catch((caught) => {
        if (!active) return;
        const apiError = toApiError(caught);
        setError(
          apiError.kind === 'network' || apiError.kind === 'timeout'
            ? t('itemDetails.offline')
            : apiError.message || t('itemDetails.generic'),
        );
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [externalId, kind, t]);

  if (isLoading) {
    return (
      <Screen>
        <EmptyState icon="hourglass-outline" title={t('common.loading')} />
      </Screen>
    );
  }

  if (error || !details) {
    return (
      <Screen>
        <EmptyState
          icon="alert-circle-outline"
          title={t('common.error')}
          description={error ?? t('itemDetails.generic')}
        />
        <Button label={t('common.back')} variant="secondary" onPress={() => router.back()} />
      </Screen>
    );
  }

  const isBook = details.kind === 'books';
  const isSeries = details.kind === 'tv';
  const collection = details.collection ?? null;
  const related = details.related ?? [];


  /** A poster reference rendered as a carousel card, which opens on tap. */
  const toCarouselItem = (item: CatalogRelated) => ({
    key: item.externalId,
    title: item.title,
    imageUrl: item.imageUrl,
    released: item.released,
    badge: null,
    onPress: () =>
      router.push({
        pathname: '/(app)/item/[itemId]',
        params: {
          itemId: item.externalId,
          kind: details.kind,
          externalId: item.externalId,
          title: item.title,
        },
      }),
  });

  return (
    <Screen scroll>
      {details.backdropUrl ? (
        <Image
          source={{ uri: details.backdropUrl }}
          resizeMode="cover"
          style={[styles.backdrop, { backgroundColor: theme.colors.surfaceMuted }]}
        />
      ) : null}

      <View style={{ gap: theme.spacing.lg }}>
        <View style={[styles.header, { gap: theme.spacing.lg }]}>
          {details.imageUrl ? (
            <Image
              source={{ uri: details.imageUrl }}
              resizeMode="cover"
              style={[
                styles.poster,
                { borderRadius: theme.radius.md, backgroundColor: theme.colors.surfaceMuted },
              ]}
            />
          ) : (
            <View
              style={[
                styles.poster,
                styles.posterFallback,
                { borderRadius: theme.radius.md, backgroundColor: theme.colors.surfaceMuted },
              ]}
            >
              <Ionicons
                name={isBook ? 'book-outline' : 'film-outline'}
                size={28}
                color={theme.colors.textMuted}
              />
            </View>
          )}

          <View style={[styles.headerText, { gap: theme.spacing.xs }]}>
            {details.tagline ? (
              <AppText variant="callout" tone="muted">
                {details.tagline}
              </AppText>
            ) : null}

            <View style={[styles.badges, { gap: theme.spacing.xs }]}>
              {details.released ? <Badge label={details.released} /> : null}
              {details.kind === 'movies' ? <Badge label={t('itemDetails.movie')} /> : null}
              {isSeries ? <Badge label={t('itemDetails.series')} /> : null}
              {isBook ? <Badge label={t('itemDetails.book')} /> : null}
              {details.score !== null ? (
                <Badge label={`${details.score.toFixed(1)}/10`} tone="accent" />
              ) : null}
            </View>
          </View>
        </View>

        {/* The actions on the title, not only on its card in the list: the
            detail is where a person goes to decide what to do with it. */}
        {item ? (
          <View style={{ gap: theme.spacing.sm }}>
            <View style={[styles.actions, { gap: theme.spacing.sm }]}>
              <ActionButton
                icon={item.completed ? 'eye-off-outline' : 'eye-outline'}
                label={
                  isBook
                    ? item.completed
                      ? t('mediaActions.markAsUnread')
                      : t('mediaActions.markAsRead')
                    : item.completed
                      ? t('mediaActions.markAsUnseen')
                      : t('mediaActions.markAsSeen')
                }
                onPress={() => void toggleCompleted(item)}
              />
              <ActionButton
                icon="ellipsis-horizontal"
                label={t('mediaActions.moreActions')}
                onPress={() => setMenuOpen(true)}
              />
            </View>
            {item.completed ? (
              <AppText variant="caption" tone="success">
                {isBook ? t('mediaActions.readItIs') : t('mediaActions.seenItIs')}
              </AppText>
            ) : null}
          </View>
        ) : null}

        {details.overview ? (
          <View style={{ gap: theme.spacing.xs }}>
            <AppText variant="bodyStrong">{t('itemDetails.overview')}</AppText>
            {/* Google Books returns HTML in the description, and rendering it as
                text would show the tags themselves. */}
            <AppText variant="body" tone="muted">
              {stripHtml(details.overview)}
            </AppText>
          </View>
        ) : null}

        <Card variant="muted" style={{ gap: theme.spacing.sm }}>
          {details.authors.length > 0 ? (
            <Fact label={t('itemDetails.authors')} value={details.authors.join(', ')} />
          ) : null}
          {details.cast && details.cast.length > 0 ? (
            <Fact label={t('itemDetails.cast')} value={details.cast.slice(0, 6).join(', ')} />
          ) : null}
          {details.publisher ? <Fact label={t('itemDetails.publisher')} value={details.publisher} /> : null}
          {details.runtime ? (
            <Fact
              label={isBook ? t('itemDetails.pages') : t('itemDetails.runtime')}
              value={
                isBook
                  ? String(details.runtime)
                  : `${details.runtime} ${t('itemDetails.minutes')}`
              }
            />
          ) : null}
          {details.seasons ? (
            <Fact
              label={t('itemDetails.seasons')}
              value={`${details.seasons}${
                details.episodes ? ` · ${details.episodes} ${t('itemDetails.episodes')}` : ''
              }`}
            />
          ) : null}
          {details.status ? <Fact label={t('itemDetails.status')} value={details.status} /> : null}
          {details.genres.length > 0 ? (
            <Fact label={t('itemDetails.genres')} value={details.genres.join(', ')} />
          ) : null}
        </Card>

        {/*
          The franchise and the "more like this" shelf. Both are a carousel of
          covers, the same as a list, so a title reads the same way everywhere in
          the app.
        */}
        {collection && collection.items.length > 0 ? (
          <View style={{ gap: theme.spacing.sm }}>
            {collection.backdropUrl ? (
              <Image
                source={{ uri: collection.backdropUrl }}
                resizeMode="cover"
                style={[styles.collectionBanner, { borderRadius: theme.radius.lg }]}
              />
            ) : null}
            <AppText variant="heading">{collection.name}</AppText>
            {collection.overview ? (
              <AppText variant="callout" tone="muted">
                {stripHtml(collection.overview)}
              </AppText>
            ) : null}
            <MediaCarousel items={collection.items.map(toCarouselItem)} />
          </View>
        ) : null}

        {related.length > 0 ? (
          <View style={{ gap: theme.spacing.sm }}>
            <AppText variant="heading">{t('itemDetails.related')}</AppText>
            <MediaCarousel items={related.map(toCarouselItem)} />
          </View>
        ) : null}

        {details.identifiers && details.identifiers.length > 0 ? (
          <View style={{ gap: theme.spacing.xs }}>
            <AppText variant="bodyStrong">{t('itemDetails.identifiers')}</AppText>
            {details.identifiers.slice(0, 3).map((identifier, index) => (
              <AppText key={`${identifier.type}-${index}`} variant="caption" tone="muted">
                {identifier.type}: {identifier.identifier}
              </AppText>
            ))}
          </View>
        ) : null}

        {details.homepage ? (
          <Button
            label={t('itemDetails.openProvider')}
            variant="secondary"
            icon="open-outline"
            onPress={() => {
              void Linking.openURL(details.homepage as string);
            }}
          />
        ) : null}

        {/* The item's own state lives with the item, not with the provider. */}
        {title ? (
          <Card variant="outlined" style={{ gap: theme.spacing.xs }}>
            <AppText variant="caption" tone="subtle">
              {t('itemDetails.addedAs')}
            </AppText>
            <AppText variant="bodyStrong">{title}</AppText>
          </Card>
        ) : null}
      </View>

      <MediaActionsSheet
        item={menuOpen ? item : null}
        listId={itemId ?? ''}
        listKind={isBook ? 'books' : isSeries ? 'series' : 'movies'}
        onClose={() => setMenuOpen(false)}
      />
    </Screen>
  );
}

/**
 * One action on the title, as a button with its name under it.
 *
 * The name is not decoration: an eye with no label is a guess, and the two
 * things a person does most with a title are ticked off and taken out, which
 * are not the same and not reversible in the same way.
 */
function ActionButton({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        {
          backgroundColor: theme.colors.surfaceMuted,
          borderRadius: theme.radius.md,
          paddingVertical: theme.spacing.sm,
          paddingHorizontal: theme.spacing.md,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <Ionicons name={icon} size={18} color={theme.colors.text} />
      <AppText variant="caption" tone="muted" numberOfLines={1}>
        {label}
      </AppText>
    </Pressable>
  );
}

function Badge({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'accent' }) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.badge,
        {
          borderRadius: theme.radius.sm,
          backgroundColor: tone === 'accent' ? theme.colors.accentSoft : theme.colors.surfaceMuted,
        },
      ]}
    >
      <AppText variant="caption" tone={tone === 'accent' ? 'accent' : 'muted'}>
        {label}
      </AppText>
    </View>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.fact, { gap: theme.spacing.sm }]}>
      <AppText variant="caption" tone="subtle" style={styles.factLabel}>
        {label}
      </AppText>
      <AppText variant="body" style={styles.factValue}>
        {value}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    width: '100%',
    height: 180,
    borderRadius: 16,
  },
  collectionBanner: {
    width: '100%',
    height: 120,
  },
  header: {
    flexDirection: 'row',
  },
  poster: {
    width: 110,
    height: 165,
  },
  posterFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: {
    flex: 1,
  },
  badges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  fact: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  factLabel: {
    width: 96,
  },
  factValue: {
    flex: 1,
  },
});
