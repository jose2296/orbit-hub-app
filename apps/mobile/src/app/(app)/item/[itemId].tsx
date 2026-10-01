import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import type { ReactNode } from "react";

import { useListItems, useLists } from "@/hooks/use-lists";
import { useHeaderAction } from "@/components/ui/header-action";
import { useScreenTitle } from "@/hooks/use-screen-title";
import { Image, Linking, Pressable, StyleSheet, View } from "react-native";

import type { CatalogDetails, CatalogRelated } from "@orbit-hub/contracts";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Enter } from "@/components/ui/enter";
import { mediaCardOf } from "@/lib/lists/media-card";
import {
  sharedCoverStyle,
  sharedCoverTag,
  sharedCoverTitleStyle,
} from "@/lib/media/shared-cover";
import { EmptyState } from "@/components/ui/empty-state";
import { ExpandableText } from "@/components/media/expandable-text";
import { Rating } from "@/components/media/rating";
import { MediaActionsSheet } from "@/components/lists/media-actions-sheet";
import { Sheet, SheetOptions, type SheetOption } from "@/components/ui/sheet";
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
  const { itemId, kind, externalId, title, itemKey, image } = useLocalSearchParams<{
    /** Which list it is in, so the detail can take it out of it. */
    itemId?: string;
    kind?: string;
    externalId?: string;
    title?: string;
    /** Which row of that list it is, so it can be ticked off from here. */
    itemKey?: string;
    /**
     * The poster the row had, handed over by the screen that sent us here.
     *
     * **It is in the link because it is already known, and because it is what the
     * transition is made of.** Every other parameter is a question the detail has to
     * go and ask; this one is the answer to a question nobody needs to ask yet. With
     * it the cover is drawn on the very first frame — before the cache has said
     * anything, on a phone installed five minutes ago — and that first frame is the
     * only one a poster can arrive at.
     */
    image?: string;
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

  /*
    The name the two halves of the transition share, **and it is the row's id from
    the link and not from the row.**

    `itemKey` is in the URL from the first frame; the row itself has to arrive from
    the cache or the API, and on a cold start it arrives after. A shared name read
    from the row is therefore a shared name that is briefly empty, and a transition
    with an empty name in it is a transition that does not happen — which is exactly
    what it was doing on Android.
  */
  const idCompartido = itemKey ?? item?.id ?? "";

  /**
   * The poster, **and where it comes from does not matter to how soon it is here.**
   *
   * Three sources, and the order is the whole point: the link the list handed us is
   * already known on the first frame, the row out of the cache is known a moment
   * later, and the provider's own answer is known last of all. Taking them in that
   * order is what makes the cover exist during all three, instead of appearing once
   * the slowest of them has answered.
   */
  const portadaDeLaRuta = image || (item ? mediaCardOf(item)?.imageUrl : null) || null;

  /*
    Which related title has its menu open, and it is a **title and not a
    boolean**: the menu's options are about a title, and a boolean cannot say
    which one. It is the same reason the "adding" guard above is a title: an id
    cannot be false, so a list of booleans and a list of titles is a list that can
    be wrong in a way nothing catches.
  */
  const [menuDe, setMenuDe] = useState<CatalogRelated | null>(null);
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

  /*
    The "Cargando" screen, **and only when there is nothing of our own to draw.**
    `isLoading` starts as `true` on purpose — it is set back to `false` by the
    effect below once it knows whether there is anything to ask — and that first
    frame is the one the transition is made of. So while the provider is being
    asked, the screen showed a centred hourglass and nothing else: no poster, no
    title, and therefore **nothing for the poster that was pressed to travel to**.
    The transition was being asked for on the one frame where the thing it needs
    does not exist yet.

    With a row in hand there is always something: the poster and the title are in
    the cache and cost nothing. So the hourglass is for the case where there is
    genuinely nothing — no row and no record — and the skeleton below covers
    everything else.
  */
  if (isLoading && !item && !portadaDeLaRuta) {
    return (
      <Screen>
        <EmptyState icon="hourglass-outline" title={t("common.loading")} />
      </Screen>
    );
  }

  // A title written by hand has no record anywhere to fetch. The screen is not
  // an error and not an empty one: it is the row itself, with the actions that
  // apply to a row, and the way to give it a record if it is a real title.
  if (!error && (!details || isLoading) && (item || portadaDeLaRuta || title)) {
    /*
      **The same screen the loaded one is, with the parts that are missing filled
      with placeholders** — and the reason it is not a card with a sentence in it is
      the poster.

      Pressing a poster in the carousel is a promise that the poster is going
      somewhere. This used to answer that promise with a completely different
      screen: a grey card, a title and a line saying there is no record yet, while
      the request went off. So on the frame that matters there was no poster
      anywhere on screen, the browser had nothing to pair with the one that had
      been pressed, and the transition the person pressed for did not happen — it
      was replaced by a card arriving, then by the real screen arriving.

      The row already knows its own poster and its own title, in the cache, without
      asking anybody. So those two are drawn **where the loaded screen draws them**,
      at the same size and in the same place, and the two elements the carousel was
      carrying line up with the two that arrive. Everything that genuinely needs the
      provider — the tagline, the synopsis, the facts, the cast — is a placeholder
      in the space it is going to occupy, so nothing jumps when the answer lands.

      And that is also the honest reading of a screen that is loading: the shape of
      what is coming, with the one thing that was already known already there.
    */
    return (
      <Screen scroll>
        <View style={{ gap: theme.spacing.lg }}>
          <View style={[styles.header, { gap: theme.spacing.lg }]}>
            <View style={[styles.cover, { gap: theme.spacing.md }]}>
              {portadaDeLaRuta ? (
                <Image
                  source={{ uri: portadaDeLaRuta }}
                  resizeMode="cover"
                  style={[
                    styles.poster,
                    {
                      borderRadius: theme.radius.md,
                      backgroundColor: theme.colors.surfaceMuted,
                    },
                    /*
                      **The name the carousel's poster is carrying, written from the
                      same fact.** Without it there is nothing on this screen for the
                      browser to pair with the poster that was pressed, and the
                      transition that was asked for is one that never starts.
                    */
                    sharedCoverStyle(idCompartido),
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
                    name={listKind === "books" ? "book-outline" : "film-outline"}
                    size={28}
                    color={theme.colors.textMuted}
                  />
                </View>
              )}
            </View>

            <View style={[styles.headerText, { gap: theme.spacing.sm }]}>
              <AppText variant="title" style={sharedCoverTitleStyle(idCompartido)}>
                {item?.title ?? title}
              </AppText>
              <Esqueleto alto={22} ancho="70%" />
              <Esqueleto alto={16} />
              <Esqueleto alto={16} ancho="92%" />
              <Esqueleto alto={16} ancho="84%" />
              <Esqueleto alto={16} ancho="60%" />
            </View>
          </View>

          <Card variant="muted" style={{ gap: theme.spacing.sm }}>
            <Esqueleto alto={14} ancho="30%" />
            <Esqueleto alto={16} ancho="80%" />
          </Card>

          {/*
            The row's own words under the placeholders, **and it is the row and not
            the provider**: the tags and the note are in the cache already, so there
            is nothing to wait for and no reason to hide them behind a grey bar.
          */}
          {item?.tags.length ? (
            <AppText variant="caption" tone="accent">
              {item.tags.join(" · ")}
            </AppText>
          ) : null}
          {item?.annotation ? (
            <AppText variant="body" tone="muted">
              {item.annotation}
            </AppText>
          ) : null}
        </View>

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
  /*
    A related title as a card, **with one control on it**.

    It had three stickers: a `+` in one corner, a `▶` in the other, and a tick for
    "you already have it" when it applied. Two corners of a poster taken by round
    buttons is a card you read the furniture of before the film, and the third one
    made it worse rather than better: a card with the sticker and a card without it
    were two different looking cards, and the only thing they said differently was
    something the menu can say in a line.

    So the card keeps the **three dots it already had** and the actions are lines
    in a sheet, like every other action in the app.

    **The row it opens keeps the real list id.** It used to push
    `itemId: related.externalId`, and this screen uses `itemId` as the *list* id,
    so a detail opened from a recommendation could add to a list that does not
    exist: the row went to the outbox and to the server and never showed up
    anywhere. An id that is empty is caught; an id that is *wrong* is not.
  */
  /**
   * The row of this list that is this title, **or `null` if there is none**.
   *
   * It was `items.some(...)` for the menu and nothing for the corner, and the two
   * answers have to be the same: a card that says "Ya está" in its menu and shows
   * no ribbon in its corner is not contradicting itself, it is answering a
   * different question in two places on a hundred and forty point card.
   */
  const filaDe = (externalId: string) =>
    items.find((row) => row.externalId === externalId) ?? null;

  const toCarouselItem = (related: CatalogRelated) => ({
    key: related.externalId,
    title: related.title,
    imageUrl: related.imageUrl,
    released: related.released,
    badge: null,
    /** What the list already has, read here and drawn in the card's own menu. */
    inList: filaDe(related.externalId) !== null,
    /**
     * Whether it has been seen, **which is the second half of the same question**
     * and the reason the ribbon in the corner can be drawn at all.
     *
     * `inList` alone answers "do I have this", and on a related title that is
     * usually the same question with a different verb: a detail's similar titles
     * are mostly things you already added, and a corner that says so and does not
     * say whether you watched them is half an answer. The row is looked up once
     * and both facts come out of it.
     */
    completed: filaDe(related.externalId)?.completed === true,
    seenLabel: `${t("mediaTabs.seen")}: ${related.title}`,
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
    onMenu: () => setMenuDe(related),
    /**
     * El menu necesita **su propio nombre**, y no el del cartel.
     *
     * Sin esto el boton de tres puntitos se queda sin etiqueta y cae al nombre del
     * cartel, con lo que en una tarjeta hay dos controles que se llaman igual: para
     * un lector de pantalla son el mismo control dos veces, y para quien pulse sin
     * mirar no hay forma de saber cual de los dos ha abierto el menu.
     */
    menuLabel: t("mediaActions.menuOf", { name: related.title }),
  });

  /**
   * The options of a related title, in **one menu on the card**.
   *
   * They were two stickers on the poster: a pink `+` in one corner and a black
   * `▶` in the other, over the picture, in shapes nothing else in the app uses.
   * Two corners of a poster taken by two round buttons is a card you read the
   * furniture of before the film, and the third thing in the corner — the tick for
   * "you already have it" — made it three.
   *
   * So the card carries **one** control, the three dots it already had, and the
   * actions are lines in a sheet like every other action in the app. And the
   * "already in the list" answer is a line too, with a tick and no add: a card
   * that is in the list and a card that is not now look **the same**, and they
   * differ in a word inside a menu instead of in a sticker on the poster.
   */
  const opcionesDe = (target: CatalogRelated): SheetOption[] => {
    const yaEsta = items.some((row) => row.externalId === target.externalId);
    return [
      yaEsta
        ? {
            key: "ya-esta",
            label: t("catalog.inList"),
            icon: "checkmark-circle" as const,
            // **Not pressable, and it says so.** A line that looks like the others
            // and does nothing when pressed is a trap; being written as a state and
            // not as an action is what makes the difference visible.
            disabled: true,
          }
        : {
            key: "anadir",
            label: t("mediaActions.addToList"),
            icon: "add-circle-outline" as const,
            onPress: () => {
              if (anadiendo) return;
              setAnadiendo(target.externalId);
              void addItem({
                title: target.title,
                externalId: target.externalId,
                /*
                 * El provider es **el de esta pantalla**, y no un "tmdb" fijo: un
                 * libro que llega por los recomendados se guardaba como titulo de
                 * TMDB, y ese provider equivocado es lo que lee despues
                 * `providerRefOf` para decidir que pedir y como llamar a la cosa.
                 */
                metadata: {
                  provider: isBook ? "google-books" : "tmdb",
                  type: isBook ? "books" : details.kind === "tv" ? "tv" : "movie",
                  imageUrl: target.imageUrl,
                },
              })
                .catch(() => undefined)
                .finally(() => setAnadiendo(null));
            },
          },
      {
        key: "donde-ver",
        label: t("mediaActions.watch"),
        icon: "tv-outline" as const,
        onPress: () =>
          setDondeVer({
            externalId: target.externalId,
            title: target.title,
            kind: isBook ? "books" : isSeries ? "tv" : "movies",
          }),
      },
    ];
  };

  /*
    The row of facts under the synopsis, **as a list and not as five conditionals.**

    Two reasons, and the second is the one that made it a list. The first is that
    the same five facts were written five times in the order the code happened to
    be in, and adding a sixth meant finding the right gap. The second is the
    entrance: a chip that arrives third needs to know it is the third, and the only
    place that number exists is a list with a position.

    Every entry carries a key of its own rather than its index, because the row
    changes shape with the title — a film has a status and a book has pages — and
    a key made of the position would make React move the wrong chip when the list
    in front of it lost one.

    **It is a plain array and not a `useMemo`.** It was a memo for two minutes and
    React immediately complained that the order of hooks had changed, which is the
    correct complaint: this component returns early for the loading and the error
    case, so a hook written down here is a hook that only runs on the happy path.
    Five small elements are not worth a memo, and a value that must be true on
    every path is worth less than one that is cheap to rebuild.
  */
  const datos: { clave: string; contenido: ReactNode }[] = [];
  if (details.released) {
    datos.push({
      clave: "estreno",
      contenido: <AppText variant="callout">{details.released}</AppText>,
    });
  }
  datos.push({
    clave: "tipo",
    contenido: isBook ? (
      <Badge label={t("itemDetails.book")} />
    ) : isSeries ? (
      <Badge label={t("itemDetails.series")} />
    ) : (
      <Badge label={t("itemDetails.movie")} />
    ),
  });
  /* The status comes from the provider in English, and it sits next to a badge in
     the person's language. Half a sentence in each language is how a screen starts
     to look machine made. */
  if (details.status) {
    datos.push({
      clave: "estado",
      contenido: (
        <Badge
          label={
            statusKeyOf(details.status)
              ? t(statusKeyOf(details.status) as never)
              : details.status
          }
        />
      ),
    });
  }
  if (details.runtime) {
    datos.push({
      clave: "duracion",
      contenido: (
        <AppText variant="callout" tone="muted">
          {isBook
            ? `${details.runtime} ${t("itemDetails.pages")}`
            : `${details.runtime} ${t("itemDetails.minutes")}`}
        </AppText>
      ),
    });
  }

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
            {/*
              The cover, **and it is the one thing here that comes further than six
              points.**

              This cover is the same picture the person tapped on in the carousel,
              and the transition into this screen is a cross-fade rather than a
              slide precisely because of that. A fade with nothing moving in it is a
              flat swap, and the cover is the one element that can carry the rest of
              the meaning: twelve points is a twentieth of a poster and reads as the
              picture settling closer rather than as the page scrolling.
            */}
            <Enter indice={0} rise={12}>
              {details.imageUrl ? (
                <Animated.Image
                  source={{ uri: details.imageUrl }}
                  resizeMode="cover"
                  style={[
                    styles.poster,
                    {
                      borderRadius: theme.radius.md,
                      backgroundColor: theme.colors.surfaceMuted,
                    },
                    /*
                      The other end of the same name, **and it is the row's id**, which
                      is the key the carousel was already drawing and the `itemKey` the
                      route arrived with. One fact in three places, so the two halves
                      cannot drift apart — a name that did would leave the poster and the
                      cover as two unrelated pictures and the transition would simply
                      not happen.
                    */
                    sharedCoverStyle(idCompartido),
                  ]}
                  sharedTransitionTag={
                    item ? sharedCoverTag(item.id) : undefined
                  }
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
            </Enter>

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
            {/*
              The facts as chips, **arriving one after another.**

              It used to be five conditionals written one under the other, and the
              order they came out in was the order the code happened to be in. Now
              they are a list and the row maps it, which is what makes the entrance
              possible at all: a chip cannot be given "the third one in" without
              knowing how many came before it, and a list is where that number
              comes from. The order is still the order on screen, because the list
              is written in the order it should read.
            */}
            <View style={[styles.badges, { gap: theme.spacing.xs }]}>
              {datos.map((dato, posicion) => (
                <Enter key={dato.clave} indice={posicion}>
                  {dato.contenido}
                </Enter>
              ))}
            </View>

            {details.genres.length > 0 ? (
              <Enter indice={datos.length}>
                <AppText variant="callout" tone="muted">
                  {details.genres.join(" · ")}
                </AppText>
              </Enter>
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
        {/*
          What does not fit in the line under the synopsis, **arriving after it.**
          It is the first block a person scrolls to, and it used to be on screen at
          the same instant as the synopsis above it — so the eye had no reason to
          go down and the block that was most worth reading was the one that came
          last.
        */}
        <Enter indice={datos.length + 1}>
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
        </Enter>

        {/*
          The franchise and the "more like this" shelf. Both are a carousel of
          covers, the same as a list, so a title reads the same way everywhere in
          the app.
        */}
        {collection && collection.items.length > 0 ? (
          <Enter indice={datos.length + 2}>
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
          </Enter>
        ) : null}

        {related.length > 0 ? (
          <Enter indice={datos.length + 3}>
            <View style={{ gap: theme.spacing.sm }}>
              <AppText variant="heading">{t("itemDetails.related")}</AppText>
              <MediaCarousel items={related.map(toCarouselItem)} />
            </View>
          </Enter>
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
            {/*
              The other end of the title's name. **It is the one place on this
              screen that shows the row's own title**, which is what the carousel was
              showing when the finger went down, and pairing those two is the whole
              of the title travelling. The heading above is the provider's tagline —
              a different sentence about the same film — and morphing one into the
              other would be two words replacing each other, which is a different
              effect and not this one.
            */}
            <AppText
              variant="bodyStrong"
              style={sharedCoverTitleStyle(idCompartido)}
            >
              {title}
            </AppText>
          </Card>
        ) : null}
      </View>

      <Sheet
        visible={menuDe !== null}
        onClose={() => setMenuDe(null)}
        title={menuDe?.title}
      >
        {menuDe ? <SheetOptions options={opcionesDe(menuDe)} /> : null}
      </Sheet>

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

  /*
    Two movements, and they are for two different things.

    **The squeeze is the press.** It was opacity and nothing else, and opacity is
    the movement that says "this is disabled" — a button that fades when you press
    it reads as a button that has stopped working at the moment you are trying to
    work it. Six per cent of scale says the opposite: the button took the press.

    **The pop is the change.** The icon is a different glyph afterwards — an eye for
    "not seen" and a shut eye for "seen" — and two glyphs swapping instantly is the
    one change on this screen that happens under the finger. So the new glyph comes
    in a shade too big and settles, and the eye in the corner of the poster unfolds
    at the same time: one movement, two places, and the person can see that the
    thing they pressed is the thing that changed.

    The key is the icon itself and not a counter. The button is pressed, the state
    turns over, the glyph changes, and the animation runs **because the glyph is a
    different one** — which means it cannot be run twice for one press, and it runs
    whether the change came from this button or from the sheet further down.
  */
  const apretado = useSharedValue(0);
  const [anterior, setAnterior] = useState<string | null>(null);
  const golpe = useSharedValue(1);

  useEffect(() => {
    if (anterior === null) {
      setAnterior(icon);
      return;
    }
    if (anterior === icon) return;
    setAnterior(icon);
    golpe.value = 0;
    golpe.value = withSequence(
      withTiming(1.22, { duration: 110, easing: Easing.out(Easing.quad) }),
      withTiming(1, { duration: 170, easing: Easing.out(Easing.back(1.6)) }),
    );
  }, [anterior, icon, golpe]);

  const estiloBoton = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - apretado.value * 0.06 }],
    opacity: 1 - apretado.value * 0.3,
  }));

  const estiloIcono = useAnimatedStyle(() => ({
    transform: [{ scale: golpe.value }],
  }));

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      onPressIn={() => {
        apretado.value = withTiming(1, { duration: 90, easing: Easing.out(Easing.quad) });
      }}
      onPressOut={() => {
        apretado.value = withTiming(0, { duration: 160, easing: Easing.out(Easing.quad) });
      }}
      style={[
        styles.action,
        {
          backgroundColor: theme.colors.surfaceMuted,
          borderRadius: theme.radius.md,
          paddingVertical: theme.spacing.sm,
          paddingHorizontal: theme.spacing.md,
        },
      ]}
    >
      {/*
        The row is inside the squeeze and not the `Pressable`'s style, because what
        has to shrink is the thing inside the button — six per cent of a row of icon
        and label — and not the button's own box, which is what the padding draws.
      */}
      <Animated.View style={[styles.action, estiloBoton]}>
        <Animated.View style={estiloIcono}>
          <Ionicons name={icon} size={18} color={theme.colors.text} />
        </Animated.View>
        <AppText variant="caption" tone="muted" numberOfLines={1}>
          {label}
        </AppText>
      </Animated.View>
    </Pressable>
  );
}

/**
 * A grey bar where something is coming, **and its height is the height of what
 * will be there.**
 *
 * It is not a spinner and not a shimmer: a spinner says "wait", and a person who
 * has already pressed the poster knows what they are waiting for — they can see
 * the poster. A bar of the right size says "this is the synopsis" without saying
 * anything, and it holds the place so the text does not arrive by shoving
 * everything below it down.
 */
function Esqueleto({ alto, ancho = "100%" }: { alto: number; ancho?: `${number}%` | "auto" }) {
  const theme = useTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        height: alto,
        width: ancho,
        borderRadius: theme.radius.sm,
        backgroundColor: theme.colors.skeleton,
      }}
    />
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
