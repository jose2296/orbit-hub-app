import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";

import { listKindSchema, type ListOrderMode } from "@orbit-hub/contracts";

import { Sheet, SheetOptions, type SheetOption } from "@/components/ui/sheet";
import { TextField } from "@/components/ui/text-field";
import { AppText } from "@/components/ui/text";
import {
  activeFilterCount,
  EMPTY_FILTER,
  isDraggableOrder,
  type ContentFilter,
} from "@/lib/content-order";
import { useTranslation } from "@/lib/i18n";
import { useTheme } from "@/theme";

/** The orders offered here, and the words for them. */
const ORDENES: { mode: ListOrderMode; key: string }[] = [
  { mode: "manual", key: "content.sort.manual" },
  { mode: "alphabetical", key: "content.sort.alphabetical" },
  { mode: "alphabetical_desc", key: "content.sort.alphabeticalDesc" },
  { mode: "created_asc", key: "content.sort.createdAsc" },
  { mode: "created_desc", key: "content.sort.createdDesc" },
];

export interface ContentToolbarProps {
  filter: ContentFilter;
  onFilterChange: (filter: ContentFilter) => void;
  order: ListOrderMode;
  onOrderChange: (order: ListOrderMode) => void;
  /**
   * How many lists of each kind are here, for the number on the chip.
   *
   * A `Map` and not a list of what is here, because **the kinds are not decided
   * by this list**: they are the contract's five, offered the same on every
   * space and in every folder. This map only says how many of each are in front of
   * the person right now, so a chip that would come up empty says "0" instead of
   * not being there.
   */
  listKindCounts: ReadonlyMap<string, number>;
  /** How many rows the filter is leaving out, for the line that says so. */
  hiddenCount: number;
  totalCount: number;
}

/**
 * The three things that stand between a person and the list: what is in it, in
 * what order, and which of it they are looking for.
 *
 * They are one row and not three screens because they are three views of the
 * same list and not three places. Somebody who has narrowed to the notes in a
 * folder and then wants them by date is still looking for the same six notes, and
 * making them go back to do it is what turns a filter into a chore.
 *
 * The chips are **visible and not behind a button** on purpose. A row of things
 * you can narrow by is a row you can see is narrowing by, and a filter hidden in
 * a sheet is a filter whose state you cannot check without opening it. What moves
 * into a sheet here is only the *order*, because there are five of them and
 * nobody wants five chips taking a whole row of a phone.
 */
export function ContentToolbar({
  filter,
  onFilterChange,
  order,
  onOrderChange,
  listKindCounts,
  hiddenCount,
  totalCount,
}: ContentToolbarProps) {
  const theme = useTheme();
  const t = useTranslation();
  const [ordenAbierto, setOrdenAbierto] = useState(false);

  const activos = activeFilterCount(filter);

  const chip = (clave: string, etiqueta: string, activo: boolean, alPulsar: () => void) => (
    /*
     * `checkbox` and not `button`, and that is not a detail of the name: with
     * `button`, react-native-web drops `accessibilityState.selected` and the
     * chip reaches a screen reader as a plain button that says nothing about
     * whether it is on. A filter chip that is lit has to *say* it is lit, which
     * is the whole point of drawing it lit. `checkbox` is also the honest role:
     * what the chip does is narrow the list, and a checkbox is a control whose
     * state is worth knowing before you press it.
     */
    <Pressable
      key={clave}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: activo }}
      /* Y tambien el atributo tal cual: en react-native-web el `accessibilityState`
         no llega al DOM en esta version, y una pastilla que se ve encendida sin
         decir que lo esta es un adorno para el ojo y nada para un lector de
         pantalla. Puesto de una vez aqui, el atributo y el estado no pueden
         desincronizarse. */
      aria-checked={activo}
      accessibilityLabel={etiqueta}
      onPress={alPulsar}
      style={({ pressed }) => [
        styles.chip,
        {
          gap: theme.spacing.xs,
          paddingVertical: theme.spacing.xs,
          paddingHorizontal: theme.spacing.sm,
          // 40 puntos de alto, medidos y no puestos por costumbre: la pastilla
          // media 25. Y `hitSlop` no lo arregla, porque `hitSlop` agranda donde se
          // puede pulsar **sin** agrandar el elemento, y el elemento es lo que un
          // lector de pantalla anuncia y lo que alcanza un dedo. La fila se
          // desplaza a lo ancho, asi que una pastilla mas alta no cuesta sitio.
          minHeight: 40,
          minWidth: 40,
          justifyContent: "center",
          borderRadius: theme.radius.md,
          backgroundColor: activo ? theme.colors.accent : theme.colors.surfaceMuted,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <AppText
        variant="caption"
        style={{ color: activo ? theme.colors.onAccent : theme.colors.textMuted }}
      >
        {etiqueta}
      </AppText>
    </Pressable>
  );

  const tipos: { kind: ContentFilter["kind"]; key: string }[] = [
    { kind: "all", key: "content.filter.all" },
    { kind: "folder", key: "content.filter.folders" },
    { kind: "list", key: "content.filter.lists" },
    { kind: "note", key: "content.filter.notes" },
  ];

  const opcionesOrden: SheetOption[] = ORDENES.map((o) => ({
    key: o.mode,
    label: t(o.key as never),
    description: t((o.mode === "manual" ? "content.sort.manualHint" : "content.sort.plainHint") as never),
    icon: o.mode === order ? ("checkmark" as const) : ("ellipse-outline" as const),
    onPress: () => {
      onOrderChange(o.mode);
      setOrdenAbierto(false);
    },
  }));

  return (
    <View style={{ gap: theme.spacing.sm }}>
      <View style={[styles.fila, { gap: theme.spacing.sm }]}>
        <View style={styles.crece}>
          <TextField
            value={filter.query}
            onChangeText={(query) => onFilterChange({ ...filter, query })}
            placeholder={t("content.search")}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel={t("content.search")}
          />
        </View>
        {/*
          The order, and **why** it is a button: there are five orders and this is
          a phone. The label under the icon says which one is on, so the state is
          readable without opening anything — the mistake a row of five chips makes
          is spending the row on a choice nobody changes often to show a choice
          that is already on.
        */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("content.sort.title")}
          onPress={() => setOrdenAbierto(true)}
          style={({ pressed }) => [
            styles.botonOrden,
            {
              gap: theme.spacing.xxs,
              paddingHorizontal: theme.spacing.sm,
              paddingVertical: theme.spacing.xs,
              // El mismo 40 que las pastillas, y por el mismo motivo: media 25.
              minHeight: 40,
              justifyContent: "center",
              borderRadius: theme.radius.md,
              backgroundColor: theme.colors.surfaceMuted,
              borderColor: theme.colors.border,
              opacity: pressed ? 0.7 : 1,
            },
          ]}
        >
          <AppText variant="caption" tone="subtle" numberOfLines={1}>
            {t(ORDENES.find((o) => o.mode === order)?.key as never)}
          </AppText>
        </Pressable>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: theme.spacing.xs, paddingRight: theme.spacing.sm }}
      >
        {tipos.map((tipo) =>
          chip(
            tipo.kind,
            t(tipo.key as never),
            filter.kind === tipo.kind,
            // Cambiar de tipo suelta el tipo de lista: pedir "notas" y "de tipo
            // peliculas" a la vez no tiene sentido, y un filtro invisible que
            // sigue puesto despues de cambiar de tipo es un filtro invisible.
            () =>
              onFilterChange({
                ...filter,
                kind: tipo.kind,
                listKind: undefined,
              }),
          ),
        )}
        {activos > 0
          ? chip(
              "limpiar",
              t("content.clear"),
              false,
              () => onFilterChange(EMPTY_FILTER),
            )
          : null}
      </ScrollView>

      {/*
        Which kind of list, and it is a second row and not more chips in the first
        one because the first row already has a "Listas" chip in it: two rows of
        choices that mean different things read as one list of chips.

        **The five are always the five.** They used to be the kinds that happened
        to be in this folder, so the same row meant something different in every
        space — and a filter that has to be learned again in each space is a
        filter that takes a filter's job without doing it. The number on the chip
        is what tells somebody there is nothing of that kind here, which is
        something a chip that is simply missing cannot say.
      */}
      {filter.kind === "list" ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: theme.spacing.xs, paddingRight: theme.spacing.sm }}
        >
          {listKindSchema.options.map((kind) =>
            chip(
              `lk:${kind}`,
              `${t(`lists.kind.${kind === "movies_and_series" ? "moviesAndSeries" : kind}` as never)} · ${listKindCounts.get(kind) ?? 0}`,
              filter.listKind === kind,
              () =>
                onFilterChange({
                  ...filter,
                  listKind: filter.listKind === kind ? undefined : kind,
                }),
            ),
          )}
        </ScrollView>
      ) : null}

      {/*
        What the filter is costing, said in words and not left to be deduced from
        a count. "9 de 23" is a number somebody has to subtract; this says there
        are fourteen hidden and why they might be.
      */}
      {hiddenCount > 0 ? (
        <AppText variant="caption" tone="subtle">
          {t("content.hidden", {
            hidden: hiddenCount,
            total: totalCount,
          })}
        </AppText>
      ) : null}

      <Sheet
        visible={ordenAbierto}
        onClose={() => setOrdenAbierto(false)}
        title={t("content.sort.title")}
      >
        <SheetOptions options={opcionesOrden} />
        {isDraggableOrder(order) ? (
          <AppText variant="caption" tone="subtle" style={{ marginTop: theme.spacing.sm }}>
            {t("content.sort.dragHint")}
          </AppText>
        ) : null}
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  fila: {
    flexDirection: "row",
    alignItems: "center",
  },
  crece: {
    flex: 1,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
  },
  botonOrden: {
    alignItems: "center",
    justifyContent: "center",
    minWidth: 92,
  },
});
