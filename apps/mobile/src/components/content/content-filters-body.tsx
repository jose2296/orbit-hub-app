import { useMemo } from "react";
import { StyleSheet, View } from "react-native";

import { listKindSchema } from "@orbit-hub/contracts";

import { Chip } from "@/components/ui/chip";
import { SheetOptions } from "@/components/ui/sheet";
import { TextField } from "@/components/ui/text-field";
import { AppText } from "@/components/ui/text";
import {
  EMPTY_FILTER,
  matchesFilter,
  type ContentFilter,
  type ContentRow,
} from "@/lib/content-order";
import { useTranslation } from "@/lib/i18n";
import { useTheme } from "@/theme";

/**
 * The filter of a folder, **as the body of a sheet and not a sheet**.
 *
 * It was a whole sheet of its own and it is now the first section of the sheet
 * that holds the filter, the order and the manual arrangement, because those are
 * three questions about the same list and opening three sheets to ask them is the
 * thing this screen was doing before.
 *
 * **It is not a component with its own open state on purpose**: the section has to
 * be able to be on screen inside somebody else's sheet, and a sheet inside a sheet
 * is a modal inside a modal.
 *
 * **The kinds are the contract's five and always the same ones.** They are not
 * decided by what this space happens to contain: a space with no book list still
 * says "Libros · 0" instead of not having the chip, because a filter you have to
 * learn per space is a filter you have to learn again.
 */
export function ContentFiltersBody({
  rows,
  filter,
  onFilterChange,
}: {
  /** Every row at this level, to count what each value would leave. */
  rows: ContentRow[];
  filter: ContentFilter;
  onFilterChange: (filter: ContentFilter) => void;
}) {
  const theme = useTheme();
  const t = useTranslation();

  /**
   * How many rows each value would leave, **with the same predicate that filters
   * the list**: one copy of the rule, so the number on the chip and the number of
   * rows cannot be two different numbers.
   */
  const cuenta = useMemo(() => {
    const cuentaDe = (filtro: ContentFilter) =>
      rows.reduce((n, row) => (matchesFilter(row, filtro) ? n + 1 : n), 0);
    return {
      folder: cuentaDe({ ...filter, kind: "folder", listKind: undefined }),
      list: cuentaDe({ ...filter, kind: "list", listKind: undefined }),
      note: cuentaDe({ ...filter, kind: "note", listKind: undefined }),
      collection: cuentaDe({ ...filter, kind: "collection", listKind: undefined }),
      listKind: new Map(
        listKindSchema.options.map((kind) => [
          kind as string,
          cuentaDe({ ...filter, kind: "list", listKind: kind as never }),
        ]),
      ),
    };
  }, [rows, filter]);

  const tiposDeLista = listKindSchema.options.map((kind) => kind as string);

  /** Only lists have a kind, so the kinds are only offered for lists. */
  const esLista = filter.kind === "list";

  return (
    <View>
      <TextField
        value={filter.query}
        onChangeText={(query) => onFilterChange({ ...filter, query })}
        placeholder={t("content.search")}
        accessibilityLabel={t("content.search")}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        clearButtonMode="while-editing"
        testID="content-filter-text"
      />

      <View style={{ marginTop: theme.spacing.md, gap: theme.spacing.xs }}>
        <AppText variant="caption" tone="subtle">
          {t("filters.what")}
        </AppText>
        <View style={styles.chips}>
          <Chip
            label={t("content.filter.folders")}
            selected={filter.kind === "folder"}
            count={cuenta.folder}
            onPress={() =>
              onFilterChange({
                ...filter,
                kind: filter.kind === "folder" ? "all" : "folder",
                listKind: undefined,
              })
            }
            testID="content-filter-folder"
          />
          <Chip
            label={t("content.filter.lists")}
            selected={filter.kind === "list"}
            count={cuenta.list}
            onPress={() =>
              onFilterChange({
                ...filter,
                kind: filter.kind === "list" ? "all" : "list",
                listKind: undefined,
              })
            }
            testID="content-filter-list"
          />
          <Chip
            label={t("content.filter.notes")}
            selected={filter.kind === "note"}
            count={cuenta.note}
            onPress={() =>
              onFilterChange({
                ...filter,
                kind: filter.kind === "note" ? "all" : "note",
                listKind: undefined,
              })
            }
            testID="content-filter-note"
          />
          <Chip
            label={t("content.filter.collections")}
            selected={filter.kind === "collection"}
            count={cuenta.collection}
            onPress={() =>
              onFilterChange({
                ...filter,
                kind: filter.kind === "collection" ? "all" : "collection",
                listKind: undefined,
              })
            }
            testID="content-filter-collection"
          />
        </View>
      </View>

      {/*
        The kinds of list, **only while lists are what is being narrowed**.

        Choosing "Listas" and then a kind is one question asked in two steps, and
        the two steps sit on top of each other: with a list of lists in front of
        you the kind is the next thing anybody wants, and the chip that is lit is
        the one that says which step you are on. When the kind is not a list the
        row is not there — five chips about lists, above a list of notes, is a
        filter for something that is not on screen.
      */}
      {esLista ? (
        <View style={{ marginTop: theme.spacing.md, gap: theme.spacing.xs }}>
          <AppText variant="caption" tone="subtle">
            {t("content.filter.listKind")}
          </AppText>
          <View style={styles.chips}>
            {tiposDeLista.map((kind) => (
              <Chip
                key={kind}
                label={t(`lists.kind.${kind === "movies_and_series" ? "moviesAndSeries" : kind}` as never)}
                selected={filter.listKind === kind}
                count={cuenta.listKind.get(kind) ?? 0}
                onPress={() =>
                  onFilterChange({
                    ...filter,
                    listKind: filter.listKind === kind ? undefined : (kind as never),
                  })
                }
                testID={`content-filter-listkind-${kind}`}
              />
            ))}
          </View>
        </View>
      ) : null}

      {/*
        Clear, **and it is only drawn when there is something to clear**: a button
        that says "clear" with nothing to clear is a button that lies, and it is
        also one more thing in a sheet that was already short of space.
      */}
      <View style={[styles.pie, { marginTop: theme.spacing.md }]}>
        {filter.kind !== "all" || filter.query.length > 0 || filter.listKind ? (
          <View style={{ flex: 1 }}>
            <SheetOptionsReset onPress={() => onFilterChange(EMPTY_FILTER)} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

/** The clear, as one option row, so it looks like the rest of the sheet. */
function SheetOptionsReset({ onPress }: { onPress: () => void }) {
  const t = useTranslation();
  return <SheetOptions options={[{ key: "limpiar", label: t("filters.reset"), onPress }]} />;
}

const styles = StyleSheet.create({
  /** The chips wrap, and do not scroll sideways: see `Chip`. */
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  pie: {
    flexDirection: "row",
    alignItems: "center",
  },
});