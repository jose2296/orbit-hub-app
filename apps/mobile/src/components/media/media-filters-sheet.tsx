import { useMemo } from "react";
import { ScrollView, StyleSheet, View } from "react-native";

import type { ListItem, ListKind } from "@orbit-hub/contracts";

import { Sheet, SheetOptions } from "@/components/ui/sheet";
import { AppText } from "@/components/ui/text";
import { useTranslation } from "@/lib/i18n";
import { useTheme } from "@/theme";

/** What the media list is showing. */
export interface MediaFilter {
  /** `'movie' | 'tv'`, and `null` is both. Only offered when the list allows. */
  type: "movie" | "tv" | null;
  /** The decade a thing came out in, or `null` for every decade. */
  decade: number | null;
  /** Free labels, the same ones the other lists filter by. */
  tags: string[];
  /** Text over the title. */
  text: string;
}

export const EMPTY_MEDIA_FILTER: MediaFilter = {
  type: null,
  decade: null,
  tags: [],
  text: "",
};

/** Only these can be filtered, because only these are on the item. */
export function mediaFilterCount(filter: MediaFilter): number {
  return (
    (filter.type ? 1 : 0) +
    (filter.decade !== null ? 1 : 0) +
    filter.tags.length +
    (filter.text.length > 0 ? 1 : 0)
  );
}

/**
 * The media kind of an item, as the two the app knows.
 *
 * Read off the same `metadata` the poster comes from, which stores the provider's
 * own `type`: `movie`, `tv` or `books`. A hand written item has no metadata and
 * therefore no type, and it is left out of both groups rather than guessed into
 * one — an item that was typed in is not a film or a series, and saying it is
 * would be a lie the filter is built on.
 */
export function mediaTypeOf(item: ListItem): "movie" | "tv" | null {
  const metadata = (item.metadata ?? {}) as Record<string, unknown>;
  const type = typeof metadata.type === "string" ? metadata.type : null;
  if (type === "movie") return "movie";
  if (type === "tv") return "tv";
  return null;
}

const DECADE = 10;

function yearOf(item: ListItem): number | null {
  const metadata = (item.metadata ?? {}) as Record<string, unknown>;
  const crudo =
    typeof metadata.releaseDate === "string"
      ? metadata.releaseDate
      : typeof metadata.publishedDate === "string"
        ? metadata.publishedDate
        : typeof metadata.year === "string"
          ? metadata.year
          : null;
  if (!crudo) return null;
  const n = Number.parseInt(crudo.slice(0, 4), 10);
  return Number.isNaN(n) ? null : n;
}

/**
 * The filter, and **the five things an item really has**.
 *
 * The list is stored on the device, so a filter that needs the network to answer
 * is a filter that shows a spinner: a genre or a runtime is not on the item, and
 * fetching two hundred details to sort out which of them are comedies is not
 * something a list of things you meant to watch should do. So the axes are the
 * ones that can be answered from the row: what kind of thing it is, when it came
 * out, the labels somebody put on it and its own text.
 *
 * **A decade and not a year.** A year filter on a list with things from 1974 to
 * now is thirty-eight chips to scroll through to say "the nineties", which is the
 * question anybody actually asks of a list of films.
 */
export function MediaFiltersSheet({
  open,
  items,
  filter,
  onFilterChange,
  onApply,
  onClose,
  listKind,
}: {
  open: boolean;
  /** Every item of the list, to count the decades and the labels that are here. */
  items: ListItem[];
  filter: MediaFilter;
  onFilterChange: (filter: MediaFilter) => void;
  onApply: () => void;
  onClose: () => void;
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

  const permiteTipo = listKind === "movies_and_series";

  const opciones = useMemo(() => {
    const out: Parameters<typeof SheetOptions>[0]["options"] = [];
    if (permiteTipo) {
      for (const tipo of ["movie", "tv"] as const) {
        out.push({
          key: `tipo:${tipo}`,
          label: t(`lists.kind.${tipo === "movie" ? "movies" : "series"}` as never),
          icon: tipo === "movie" ? "film-outline" : "tv-outline",
          selected: filter.type === tipo,
          onPress: () =>
            onFilterChange({ ...filter, type: filter.type === tipo ? null : tipo }),
        });
      }
    }
    return out;
  }, [permiteTipo, filter, onFilterChange, t]);

  return (
    <Sheet visible={open} onClose={onClose} title={t("filters.title")}>
      {opciones.length > 0 ? <SheetOptions options={opciones} /> : null}

      {decadas.length > 0 ? (
        <View style={{ marginTop: theme.spacing.md }}>
          <AppText variant="caption" tone="subtle" style={{ marginBottom: theme.spacing.xs }}>
            {t("filters.decade")}
          </AppText>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: theme.spacing.xs, paddingRight: theme.spacing.sm }}
          >
            {decadas.map((decada) => (
              <SheetOptions
                key={decada}
                options={[
                  {
                    key: `decada:${decada}`,
                    label: `${decada}s`,
                    selected: filter.decade === decada,
                    onPress: () =>
                      onFilterChange({
                        ...filter,
                        decade: filter.decade === decada ? null : decada,
                      }),
                  },
                ]}
              />
            ))}
          </ScrollView>
        </View>
      ) : null}

      {etiquetas.length > 0 ? (
        <View style={{ marginTop: theme.spacing.md }}>
          <AppText variant="caption" tone="subtle" style={{ marginBottom: theme.spacing.xs }}>
            {t("filters.tags")}
          </AppText>
          <View style={styles.envoltorio}>
            {etiquetas.map((tag) => (
              <SheetOptions
                key={tag}
                options={[
                  {
                    key: `tag:${tag}`,
                    label: tag,
                    selected: filter.tags.includes(tag),
                    onPress: () =>
                      onFilterChange({
                        ...filter,
                        tags: filter.tags.includes(tag)
                          ? filter.tags.filter((x) => x !== tag)
                          : [...filter.tags, tag],
                      }),
                  },
                ]}
              />
            ))}
          </View>
        </View>
      ) : null}

      <View style={[styles.pie, { marginTop: theme.spacing.lg, gap: theme.spacing.sm }]}>
        <SheetOptions
          options={[
            {
              key: "limpiar",
              label: t("content.clear"),
              onPress: () => onFilterChange(EMPTY_MEDIA_FILTER),
            },
          ]}
        />
        <SheetOptions
          options={[
            {
              key: "aplicar",
              label: t("common.continue"),
              tone: "accent",
              onPress: onApply,
            },
          ]}
        />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  envoltorio: {
    gap: 4,
  },
  pie: {
    flexDirection: "row",
    alignItems: "center",
  },
});
