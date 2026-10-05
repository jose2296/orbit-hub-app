import { useMemo } from "react";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import type { ListItem, ListKind } from "@orbit-hub/contracts";

import { Chip } from "@/components/ui/chip";
import { SheetOptions } from "@/components/ui/sheet";
import { AppText } from "@/components/ui/text";
import {
  EMPTY_MEDIA_FILTER,
  yearOf,
  DECADE,
  type MediaFilter,
} from "@/lib/lists/media-filter";
import { mediaFilterCount } from "@/lib/lists/media-filter";
import { useTranslation } from "@/lib/i18n";
import { useTheme } from "@/theme";

/**
 * The filter of a list of films, **as the body of a sheet and not a sheet**.
 *
 * It was a sheet of its own, opened from a button, and the button next to it
 * opened a sheet for the order, and the one next to that opened a third for the
 * manual arrangement: three sheets for one list. This is the first section of the
 * sheet that holds all three, and it brings **no margin of its own** — the sheet's
 * body has one, and a section with a second sits thirty-six points in from a panel
 * that is eighteen.
 *
 * The axes are **the ones the row can answer**. The list is stored on the device,
 * so a filter that needs the network is a filter that shows a spinner: a genre or
 * a runtime is not on the item, and fetching two hundred details to sort out which
 * of them are comedies is not something a list of things you meant to watch should
 * do. So the axes are what kind of thing it is, when it came out, whether it has a
 * picture, when it was added, the labels somebody put on it and its own text.
 *
 * **An axis with nothing to select is not drawn.** Not every list has labels, and
 * a list typed in by hand has no release dates: a section of chips all saying zero
 * is worse than no section, because it says the list can be filtered that way and
 * it cannot.
 *
 * **A decade and not a year.** A year filter on a list with things from 1974 to
 * now is thirty-eight chips to wrap over four lines to say "the nineties", which
 * is the question anybody actually asks of a list of films.
 */
/*
 * Sin buscador, por lo mismo que en la lista de tareas: el buscador global trae
 * el resultado con casilla para marcarlo, y este solo podía estrechar la lista que
 * ya tenías delante. En una lista de películas, donde hay cientos, era además la
 * única forma rápida de llegar a una.
 */
export function MediaFiltersBody({
  items,
  filter,
  onFilterChange,
  listKind,
}: {
  /** Every item of the list, to count the decades and the labels that are here. */
  items: ListItem[];
  filter: MediaFilter;
  onFilterChange: (filter: MediaFilter) => void;
  listKind: ListKind | null | undefined;
}) {
  const theme = useTheme();
  const t = useTranslation();

  /** Only the decades that are actually here, and no more than one per decade. */
  const decadas = useMemo(() => {
    const set = new Set<number>();
    for (const item of items) {
      const year = yearOf(item);
      if (year !== null) set.add(Math.floor(year / DECADE) * DECADE);
    }
    return [...set].sort((a, b) => b - a);
  }, [items]);

  const etiquetas = useMemo(() => {
    const cuenta = new Map<string, number>();
    for (const item of items) {
      for (const tag of item.tags) cuenta.set(tag, (cuenta.get(tag) ?? 0) + 1);
    }
    return [...cuenta.entries()].sort((a, b) => b[1] - a[1]).map(([tag]) => tag);
  }, [items]);

  /** Whether some rows are missing a picture, which is the whole condition for it. */
  const haySinCaratula = useMemo(() => items.some((item) => !caratulaDe(item)), [items]);

  const permiteTipo = listKind === "movies_and_series";

  const alternar = <K extends "artwork" | "added" | "decade" | "type">(
    clave: K,
    valor: MediaFilter[K],
  ) => onFilterChange({ ...filter, [clave]: filter[clave] === valor ? null : valor });

  /** One section: a title and the chips under it. */
  const grupo = (titulo: string, children: ReactNode) => (
    <View style={{ marginTop: theme.spacing.md, gap: theme.spacing.xs }}>
      <AppText variant="caption" tone="subtle">
        {titulo}
      </AppText>
      <View style={styles.chips}>{children}</View>
    </View>
  );

  return (
    <View>
      {permiteTipo
        ? grupo(
            t("filters.what"),
            <>
              <Chip
                label={t("lists.kind.movies")}
                selected={filter.type === "movie"}
                count={items.filter((i) => tipoDe(i) === "movie").length}
                onPress={() => alternar("type", "movie")}
                testID="media-filter-type-movie"
              />
              <Chip
                label={t("lists.kind.series")}
                selected={filter.type === "tv"}
                count={items.filter((i) => tipoDe(i) === "tv").length}
                onPress={() => alternar("type", "tv")}
                testID="media-filter-type-tv"
              />
            </>,
          )
        : null}

      {haySinCaratula
        ? grupo(
            t("filters.artwork"),
            <>
              <Chip
                label={t("filters.withArtwork")}
                selected={filter.artwork === true}
                count={items.length - items.filter((i) => !caratulaDe(i)).length}
                onPress={() => alternar("artwork", true)}
                testID="media-filter-artwork-yes"
              />
              <Chip
                label={t("filters.withoutArtwork")}
                selected={filter.artwork === false}
                count={items.length - items.filter((i) => caratulaDe(i)).length}
                onPress={() => alternar("artwork", false)}
                testID="media-filter-artwork-no"
              />
            </>,
          )
        : null}

      {decadas.length > 1
        ? grupo(
            t("filters.decade"),
            decadas.map((decada) => (
              <Chip
                key={decada}
                label={`${decada}s`}
                selected={filter.decade === decada}
                count={
                  items.filter((i) => {
                    const y = yearOf(i);
                    return y !== null && Math.floor(y / DECADE) * DECADE === decada;
                  }).length
                }
                onPress={() => alternar("decade", decada)}
                testID={`media-filter-decade-${decada}`}
              />
            )),
          )
        : null}

      {grupo(
        t("filters.added"),
        (["month", "year", "older"] as const).map((bucket) => (
          <Chip
            key={bucket}
            label={t(`filters.added.${bucket}` as never)}
            selected={filter.added === bucket}
            count={items.filter((item) => cuboDe(item) === bucket).length}
            onPress={() => alternar("added", bucket)}
            testID={`media-filter-added-${bucket}`}
          />
        )),
      )}

      {etiquetas.length > 0
        ? grupo(
            t("filters.tags"),
            etiquetas.map((tag) => (
              <Chip
                key={tag}
                label={tag}
                selected={filter.tags.includes(tag)}
                count={items.filter((i) => i.tags.includes(tag)).length}
                onPress={() =>
                  onFilterChange({
                    ...filter,
                    tags: filter.tags.includes(tag)
                      ? filter.tags.filter((x) => x !== tag)
                      : [...filter.tags, tag],
                  })
                }
                testID={`media-filter-tag-${tag}`}
              />
            )),
          )
        : null}

      {/*
        Clear, **only when there is something to clear**, for the same reason an
        axis with nothing in it is not drawn.
      */}
      {mediaFilterCount(filter) > 0 ? (
        <View style={{ marginTop: theme.spacing.md }}>
          <SheetOptions
            options={[
              {
                key: "limpiar",
                label: t("filters.reset"),
                onPress: () => onFilterChange(EMPTY_MEDIA_FILTER),
              },
            ]}
          />
        </View>
      ) : null}
    </View>
  );
}

/** Whether the row has a picture, read off the same field the poster comes from. */
function caratulaDe(item: ListItem): boolean {
  const metadata = (item.metadata ?? {}) as Record<string, unknown>;
  const url =
    typeof metadata.imageUrl === "string"
      ? metadata.imageUrl
      : typeof metadata.poster === "string"
        ? metadata.poster
        : null;
  return typeof url === "string" && url.trim().length > 0;
}

/** The provider's own kind, and `null` for a row somebody typed in. */
function tipoDe(item: ListItem): "movie" | "tv" | null {
  const metadata = (item.metadata ?? {}) as Record<string, unknown>;
  const type = typeof metadata.type === "string" ? metadata.type : null;
  if (type === "movie") return "movie";
  if (type === "tv") return "tv";
  return null;
}

/** Which of the three "added" buckets a row falls in. */
function cuboDe(item: ListItem): "month" | "year" | "older" | null {
  const cuando = Date.parse(item.createdAt);
  if (Number.isNaN(cuando)) return null;
  const dias = (Date.now() - cuando) / 86_400_000;
  if (dias <= 31) return "month";
  if (dias <= 366) return "year";
  return "older";
}

const styles = StyleSheet.create({
  /** The chips wrap, and do not scroll sideways: see `Chip`. */
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
});