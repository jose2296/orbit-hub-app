import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";

import { useListItems, useLists } from "@/hooks/use-lists";
import { useHeaderAction } from "@/components/ui/header-action";
import { useScreenTitle } from "@/hooks/use-screen-title";
import { Image, Linking, Pressable, StyleSheet, View } from "react-native";

import type { CatalogDetails, CatalogRelated } from "@orbit-hub/contracts";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { ExpandableText } from "@/components/media/expandable-text";
import { Rating } from "@/components/media/rating";
import { MediaActionsSheet } from "@/components/lists/media-actions-sheet";
import { ProvidersSheet } from "@/components/lists/providers-sheet";
import { MediaCarousel } from "@/components/ui/media-carousel";
import { Screen } from "@/components/ui/screen";
import { AppText } from "@/components/ui/text";
import { api, toApiError } from "@/lib/api";
import { useTranslation } from "@/lib/i18n";
import { useIsWide } from "@/lib/layout/width";
import { statusKeyOf } from "@/lib/media/status";
import { stripHtml } from "@/lib/text/html";
import { useTheme } from "@/theme";

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
  const { items, toggleCompleted, addItem } = useListItems(itemId);
  const item = useMemo(
    () =>
      items.find((row) =>
        itemKey ? row.id === itemKey : row.externalId === externalId,
      ) ?? null,
    [items, itemKey, externalId],
  );
  /**
   * Which related title is being added from a card, and not a boolean.
   *
   * It is a title and not a flag for the same reason `dondeVer` is: two cards of
   * the same carousel are two different titles, and a flag that only says
   * "somebody is adding" would leave the `+` of the other one live while its own
   * add is in flight — which is how a list ends up with a duplicate.
   */
  const [anadiendo, setAnadiendo] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  /**
   * Whose sheet is open: a title, and not a boolean.
   *
   * It used to be a flag, because there was only one thing it could mean — the
   * title of this screen. Now the carousels open the same sheet about **another**
   * title, and a flag cannot say which: opening the sheet from a poster would
   * have shown the current film's providers, which is worse than not having the
   * button.
   */
  const [dondeVer, setDondeVer] = useState<{
    externalId: string;
    title: string;
    kind: "books" | "tv" | "movies";
  } | null>(null);

  /**
   * The kind of list the row came from.
   *
   * Only used to word a screen and to choose which catalog to look the title up
   * in. Which provider answered for the record comes from the item itself,
   * never from here: that is the whole point of `providerRefOf`.
   */
  const listKind =
    useLists({}).lists.find((row) => row.id === itemId)?.kind ?? kind;
  const isBookItem = listKind === "books";

  // Before any early return: a hook behind one is called a different number of
  // times while loading and once it has failed, and React stops believing the
  // order of the calls from then on.
  useScreenTitle(name ?? item?.title ?? title ?? t("itemDetails.loading"));

  /*
    The three dots, **in the app's header** and not beside the poster.
   *
    This screen's actions used to be a column next to the poster with a "more
    actions" button at the bottom of it, which meant the same menu was in two
    places on the same screen: the header already carries the actions of every
    screen in this app, and a menu that is beside the title *and* in the header is
    two doors to one room. Here the header is the one, and what stays next to the
    poster is the decision — seen or not seen — which is a button with a word on
    it and not a menu.
   */
  useHeaderAction(
    () =>
      item ? (
        <Button
          testID="item-menu-button"
          label={t("mediaActions.menuOf", { name: item.title })}
          variant="ghost"
          size="sm"
          icon="ellipsis-horizontal"
          iconOnly
          accessibilityHint={t("mediaActions.moreActions")}
          fullWidth={false}
          onPress={() => setMenuOpen(true)}
        />
      ) : null,
    [item, t],
  );

  // Also before them, and for the same reason. The backdrop only exists on a
  // wide screen, and asking "is this wide" is a hook and not a constant.
  const wide = useIsWide();

  useEffect(() => {
    // A row with no provider record is not a failed request: there is nothing
    // to ask and the screen below shows what the row itself knows. Only a
    // missing pair of parameters is a mistake, and it is a mistake in the link.
    if (!kind || !externalId) {
      setDetails(null);
      setError(null);
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
          apiError.kind === "network" || apiError.kind === "timeout"
            ? t("itemDetails.offline")
            : apiError.message || t("itemDetails.generic"),
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
        <EmptyState icon="hourglass-outline" title={t("common.loading")} />
      </Screen>
    );
  }

  // A title written by hand has no record anywhere to fetch. The screen is not
  // an error and not an empty one: it is the row itself, with the actions that
  // apply to a row, and the way to give it a record if it is a real title.
  if (!details && !error && item) {
    return (
      <Screen>
        <Card variant="muted" style={{ gap: theme.spacing.md }}>
          <AppText variant="title">{item.title}</AppText>
          <AppText variant="body" tone="muted">
            {t("itemDetails.noRecord")}
          </AppText>
          {item.tags.length > 0 ? (
            <AppText variant="caption" tone="accent">
              {item.tags.join(" · ")}
            </AppText>
          ) : null}
          {item.annotation ? (
            <AppText variant="body" tone="muted">
              {item.annotation}
            </AppText>
          ) : null}
        </Card>

        {/* Aqui no hay botones: "buscar este titulo" y "marcar como vista"
            estan en el menu de al lado de la portada, que es donde esta el resto
            de lo que se puede hacer con una peli. Dos botones de pantalla
            completa al final del detalle eran los mismos dos, otra vez, en otro
            sitio — y los dos sitios se走向 opuestos en cuanto uno cambia. */}
      </Screen>
    );
  }

  if (error || !details) {
    return (
      <Screen>
        <EmptyState
          icon="alert-circle-outline"
          title={t("common.error")}
          description={error ?? t("itemDetails.generic")}
        />
        <Button
          label={t("common.back")}
          variant="secondary"
          onPress={() => router.back()}
        />
      </Screen>
    );
  }

  const isBook = details.kind === "books";
  const isSeries = details.kind === "tv";
  const collection = details.collection ?? null;
  const related = details.related ?? [];

  /**
   * A poster reference rendered as a carousel card.
   *
   * Three ways in, and the two new ones are the whole point of the row: the card
   * opens the title, the `+` keeps it in the list this screen came from, and the
   * play opens the trailer and the providers of **that** title without leaving
   * the row somebody was scrolling. Before, the only way to do either of the
   * last two was to open the card and come back, and the card is a suggestion
   * the screen put there on purpose.
   *
   * The `+` adds to **this** list, and not to one out of a picker: somebody who
   * is inside a list of films and taps `+` on a poster of another film is asking
   * for that film to be in the list they are looking at.
   */
  /**
   * A related title as a card, **with or without a way to add it**.
   *
   * **No `+` when the list already has it.** The collection and the recommendations
   * are full of things that are also in the list you are reading the detail from —
   * a film in its own collection, a recommendation somebody already saved — and a
   * `+` there is a `+` that writes a second row. So membership is asked for each
   * one and the button is simply not offered: the card says what it can do, and
   * what it cannot do is not drawn.
   *
   * The membership is read from the list hook's `items`, which is what is on
   * screen in this list, and it is why a watched title can be re-added from here:
   * the fix for that is the same one the catalog uses, and it is in the write
   * rather than here.
   *
   * **The row it opens keeps the real list id.** It used to push
   * `itemId: related.externalId`, and this screen uses `itemId` as the *list* id,
   * so a detail opened from a recommendation could add to a list that does not
   * exist: the row went to the outbox and to the server and never showed up
   * anywhere. An id that is empty is caught; an id that is *wrong* is not.
   */
  const toCarouselItem = (related: CatalogRelated) => {
    const yaEsta = items.some((row) => row.externalId === related.externalId);
    return {
      key: related.externalId,
      title: related.title,
      imageUrl: related.imageUrl,
      released: related.released,
      badge: null,
      inList: yaEsta,
      onPress: () =>
        router.push({
          pathname: "/(app)/item/[itemId]",
          params: {
            itemId,
            kind: details.kind,
            externalId: related.externalId,
            title: related.title,
          },
        }),
      onAdd:
        itemId && !yaEsta
          ? () => {
              if (anadiendo) return;
              setAnadiendo(related.externalId);
              void addItem({
                title: related.title,
                externalId: related.externalId,
                /*
                 * The provider is **this screen's**, not a literal "tmdb".
                 *
                 * A book reached through the recommendations was being written
                 * down as a TMDB title, and that wrong provider is what
                 * `providerRefOf` reads later to decide what to ask for and what
                 * to call the thing. It is the kind of mistake that is invisible
                 * on the row and shows up two screens away.
                 */
                metadata: {
                  provider: isBook ? "google-books" : "tmdb",
                  type: isBook ? "books" : details.kind === "tv" ? "tv" : "movie",
                  imageUrl: related.imageUrl,
                },
              })
                .catch(() => undefined)
                .finally(() => setAnadiendo(null));
            }
          : undefined,
      onWatch: () =>
        setDondeVer({
          externalId: related.externalId,
          title: related.title,
          kind: isBook ? "books" : isSeries ? "tv" : "movies",
        }),
    };
  };

  return (
    <Screen scroll>
      {/* The backdrop is atmosphere and it costs 180 points of a phone before
          the first word, saying what the cover right below says again. The old
          app did not paint it either. So it is for the wide screen, where there
          is room for it and it is not in the way. */}
      {wide && details.backdropUrl ? (
        <Image
          source={{ uri: details.backdropUrl }}
          resizeMode="cover"
          style={[
            styles.backdrop,
            { backgroundColor: theme.colors.surfaceMuted },
          ]}
        />
      ) : null}

      <View style={{ gap: theme.spacing.lg }}>
        {/*
          Móvil primero, y el móvil es una columna de 430 puntos.

          En un teléfono la portada y los botones comparten la primera fila, y
          el texto va DEBAJO a todo el ancho: el lema, la sinopsis y los datos
          en una columna de 280 puntos al lado de una portada de 110 son cuatro
          palabras por línea y una sinopsis partida en veinte. La pantalla de la
          app antigua hacía justo esto — `flex-col sm:flex-row` — y por eso se
          leía.

          En una pantalla ancha la columna de texto se coloca al lado, que es lo
          que ya se hacía y lo que aprovecha un portátil.
        */}
        <View style={[styles.header, { gap: theme.spacing.lg }]}>
          {/* The cover, and beside it the score and the two things a person comes
              here to do. Always in a row, on every width: a cover with the
              actions stacked under it wastes the width of a whole phone. */}
          <View style={[styles.cover, { gap: theme.spacing.md }]}>
            {details.imageUrl ? (
              <Image
                source={{ uri: details.imageUrl }}
                resizeMode="cover"
                style={[
                  styles.poster,
                  {
                    borderRadius: theme.radius.md,
                    backgroundColor: theme.colors.surfaceMuted,
                  },
                ]}
              />
            ) : (
              <View
                style={[
                  styles.poster,
                  styles.posterFallback,
                  {
                    borderRadius: theme.radius.md,
                    backgroundColor: theme.colors.surfaceMuted,
                  },
                ]}
              >
                <Ionicons
                  name={isBook ? "book-outline" : "film-outline"}
                  size={28}
                  color={theme.colors.textMuted}
                />
              </View>
            )}

            <View style={[styles.coverSide, { gap: theme.spacing.md }]}>
              {details.score !== null ? (
                <Rating score={details.score} outOf={details.scoreOutOf} />
              ) : null}

              {/* The actions on the title and not only on its card in the list:
                  the detail is where a person comes to decide what to do with
                  it. In a column, the way the old app had them: two buttons side
                  by side in a 280px column read as a menu, not as two
                  decisions. */}
              {item ? (
                <View style={[styles.actions, { gap: theme.spacing.sm }]}>
                  <ActionButton
                    icon={item.completed ? "eye-off-outline" : "eye-outline"}
                    label={
                      isBook
                        ? item.completed
                          ? t("mediaActions.markAsUnread")
                          : t("mediaActions.markAsRead")
                        : item.completed
                          ? t("mediaActions.markAsUnseen")
                          : t("mediaActions.markAsSeen")
                    }
                    onPress={() => void toggleCompleted(item)}
                  />
                </View>
              ) : null}
            </View>
          </View>

          <View style={[styles.headerText, { gap: theme.spacing.sm }]}>
            {details.tagline ? (
              <AppText variant="title" style={styles.tagline}>
                {details.tagline}
              </AppText>
            ) : null}

            {details.overview ? (
              <ExpandableText
                text={stripHtml(details.overview)}
                lines={6}
                variant="bodyLarge"
              />
            ) : null}

            {/* The facts as a sentence and not as a table: the year, what it is,
                where it stands, how long it takes. A two column table of labels
                and values turns five short pieces of information into five rows
                to scroll past. */}
            <View style={[styles.badges, { gap: theme.spacing.xs }]}>
              {details.released ? (
                <AppText variant="callout">{details.released}</AppText>
              ) : null}
              {isBook ? <Badge label={t("itemDetails.book")} /> : null}
              {isSeries ? <Badge label={t("itemDetails.series")} /> : null}
              {!isBook && !isSeries ? (
                <Badge label={t("itemDetails.movie")} />
              ) : null}
              {/* The status comes from the provider in English, and it sits next
                  to a badge in the person's language. Half a sentence in each
                  language is how a screen starts to look machine made. */}
              {details.status ? (
                <Badge
                  label={
                    statusKeyOf(details.status)
                      ? t(statusKeyOf(details.status) as never)
                      : details.status
                  }
                />
              ) : null}
              {details.runtime ? (
                <AppText variant="callout" tone="muted">
                  {isBook
                    ? `${details.runtime} ${t("itemDetails.pages")}`
                    : `${details.runtime} ${t("itemDetails.minutes")}`}
                </AppText>
              ) : null}
            </View>

            {details.genres.length > 0 ? (
              <AppText variant="callout" tone="muted">
                {details.genres.join(" · ")}
              </AppText>
            ) : null}
          </View>
        </View>
        {item?.completed ? (
          <AppText variant="caption" tone="success">
            {isBook ? t("mediaActions.readItIs") : t("mediaActions.seenItIs")}
          </AppText>
        ) : null}

        {/* What does not fit in the line under the synopsis: who made it and who
            is in it. The year, what it is, where it stands, how long it takes
            and the genres are already in that line, and saying them twice on one
            screen is a screen where you cannot tell which is the one that counts. */}
        <Card variant="muted" style={{ gap: theme.spacing.sm }}>
          {details.authors.length > 0 ? (
            <Fact
              label={t("itemDetails.authors")}
              value={details.authors.join(", ")}
            />
          ) : null}
          {details.cast && details.cast.length > 0 ? (
            <Fact
              label={t("itemDetails.cast")}
              value={details.cast.slice(0, 6).join(", ")}
            />
          ) : null}
          {details.publisher ? (
            <Fact
              label={t("itemDetails.publisher")}
              value={details.publisher}
            />
          ) : null}
          {details.seasons ? (
            <Fact
              label={t("itemDetails.seasons")}
              value={`${details.seasons}${
                details.episodes
                  ? ` · ${details.episodes} ${t("itemDetails.episodes")}`
                  : ""
              }`}
            />
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
                style={[
                  styles.collectionBanner,
                  { borderRadius: theme.radius.lg },
                ]}
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
            <AppText variant="heading">{t("itemDetails.related")}</AppText>
            <MediaCarousel items={related.map(toCarouselItem)} />
          </View>
        ) : null}

        {details.identifiers && details.identifiers.length > 0 ? (
          <View style={{ gap: theme.spacing.xs }}>
            <AppText variant="bodyStrong">
              {t("itemDetails.identifiers")}
            </AppText>
            {details.identifiers.slice(0, 3).map((identifier, index) => (
              <AppText
                key={`${identifier.type}-${index}`}
                variant="caption"
                tone="muted"
              >
                {identifier.type}: {identifier.identifier}
              </AppText>
            ))}
          </View>
        ) : null}

        {/*
          The trailer, next to the provider's own site and not inside a menu with
          it. These are two different questions — "show me the film" and "who has
          it" — and the answer to the first is a thing you watch in ninety
          seconds while you are deciding about something else. A trailer behind
          two taps in a sheet is a trailer nobody sees.
        */}
        {details.trailer ? (
          <Button
            testID="item-trailer"
            label={t("itemDetails.trailer")}
            variant="secondary"
            icon="play-circle-outline"
            onPress={() => {
              /*
               * A watch URL and not the embed one. The embed is a player inside
               * somebody else's page, and it wants a rectangle, a permission and a
               * cookie banner: on a phone that is a web view with a video in it,
               * which is a worse trailer than the one the person already has an
               * app for.
               */
              void Linking.openURL(`https://www.youtube.com/watch?v=${details.trailer}`);
            }}
          />
        ) : null}

        {details.homepage ? (
          <Button
            label={t("itemDetails.openProvider")}
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
              {t("itemDetails.addedAs")}
            </AppText>
            <AppText variant="bodyStrong">{title}</AppText>
          </Card>
        ) : null}
      </View>

      <MediaActionsSheet
        item={menuOpen ? item : null}
        listId={itemId ?? ""}
        listKind={isBook ? "books" : isSeries ? "series" : "movies"}
        onFindTitle={
          item
            ? () =>
                router.push({
                  pathname: "/(app)/catalog",
                  params: {
                    listId: itemId,
                    kind: isBookItem ? "books" : "movies",
                  },
                })
            : undefined
        }
        onWhereToWatch={
          item && item.externalId
            ? () =>
                setDondeVer({
                  externalId: item.externalId as string,
                  title: item.title,
                  kind: isBook ? "books" : isSeries ? "tv" : "movies",
                })
            : undefined
        }
        onClose={() => setMenuOpen(false)}
      />

      <ProvidersSheet item={dondeVer} onClose={() => setDondeVer(null)} />
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
    width: "100%",
    height: 180,
    borderRadius: 16,
  },
  collectionBanner: {
    width: "100%",
    height: 120,
  },
  header: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  cover: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  coverSide: {
    // Next to the cover, not centred in whatever width is left over: a ring
    // floating in the middle of an empty column reads as something that did not
    // fit where it should.
    alignItems: "flex-start",
    justifyContent: "center",
  },
  tagline: {
    fontStyle: "italic",
  },
  poster: {
    width: 110,
    height: 165,
  },
  posterFallback: {
    alignItems: "center",
    justifyContent: "center",
  },
  headerText: {
    // On a phone this is the full width under the cover, so it needs no flex at
    // all. On a wide screen it sits beside it and takes what is left.
    flexGrow: 1,
    flexBasis: 260,
  },
  badges: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  actions: {
    flexDirection: "column",
    alignItems: "stretch",
  },
  action: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  fact: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  factLabel: {
    width: 96,
  },
  factValue: {
    flex: 1,
  },
});
