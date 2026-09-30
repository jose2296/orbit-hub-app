import { Ionicons } from "@expo/vector-icons";
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

  /*
    Las tres pastillas, y **no hay una cuarta que diga "todo"**.

    Con cuatro, la de "todo" estaba encendida la mitad de las veces y decia lo que
    ya se veia: que no hay nada encendido. Sin ella, no hay nada encendido es la
    misma informacion y se ve sin leer. Ademas "todo" como pastilla compite por el
    sitio con las otras tres, y la que mas se usa es la que no hace falta.

    Asi que el estado por defecto —`kind: "all"`— no se dibuja, y el boton de quitar
    es lo unico que se enciende cuando hay algo que quitar.
  */
  const tipos: { kind: ContentFilter["kind"]; key: string }[] = [
    { kind: "folder", key: "content.filter.folders" },
    { kind: "list", key: "content.filter.lists" },
    { kind: "note", key: "content.filter.notes" },
  ];

  /*
    Los tipos de lista, y **sustituyen a la fila entera**.

    Cuando "Listas" esta encendida, en la fila no queda mas que los cinco tipos y el
    icono de quitar. Las otras dos pastillas —"Carpetas" y "Notas"— desaparecen,
    porque son otra manera de responder a la misma pregunta y la pregunta ya esta
    contestada: se quiere una lista. Dejarlas invita a cambiar de genero sin volver
    a empezar, que es justo lo que hace una fila de filtros que no se estrecha.

    Antes eran una segunda fila debajo. Dos filas de pastillas que significan cosas
    distintas se leen como una sola lista larga, y ademas la de abajo cambiaba de
    alto segun lo que hubiera, con lo que el contenido saltaba al abrirla.

    Y es **la misma regla para las tres**: al pulsar "Carpetas" o "Notas" tambien
    se queda sola la pastilla encendida y el icono de quitar. Si solo se estrechara
    "Listas", la fila se comportaria de dos maneras segun que pastilla se pulsara, y
    una fila que se comporta de dos maneras es una fila que hay que aprender. Con la
    regla sola la fila es siempre lo mismo: lo que elegiste, y como deshacerlo.
  */
  const tiposDeLista = listKindSchema.options.map((kind) => kind as string);

  /** The kind that is open, or `null` when none is: the row is whole. */
  const abierto = filter.kind === "all" ? null : filter.kind;

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
        {/*
          Quitar, y **un icono y no una palabra**, y **lo primero de la fila**.

          "Quitar filtros" era la palabra mas larga de la fila y la unica que no era
          el nombre de un tipo de cosa, asi que se leia como un boton de otra clase.
          El icono de prohibido es el que ya se usa para "quitarlo de aqui" en el
          menu de una lista, y en una fila donde todo lo demas son nombres, un icono
          se distingue sin leerlo.

          Y va **primero** y no el ultimo: la fila se desplaza a lo ancho y con los
          cinco tipos encima el final queda fuera de la pantalla, con lo que la
          salida —que es lo unico que deshace lo que se ha hecho— era justo lo que
          no se veia. Al principio esta siempre, que es donde se busca la vuelta
          atras.
        */}
        {activos > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("content.clear")}
            onPress={() => onFilterChange(EMPTY_FILTER)}
            style={({ pressed }) => [
              styles.chip,
              styles.limpiar,
              {
                paddingHorizontal: theme.spacing.sm,
                justifyContent: "center",
                minHeight: 40,
                minWidth: 40,
                borderRadius: theme.radius.md,
                backgroundColor: theme.colors.surfaceMuted,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <Ionicons name="close-circle" size={20} color={theme.colors.textMuted} />
          </Pressable>
        ) : null}

        {/* Sin genero abierto, la fila entera. Con uno, solo el suyo. */}
        {abierto === null
          ? tipos.map((tipo) => chip(tipo.kind, t(tipo.key as never), false, () =>
              onFilterChange({ ...filter, kind: tipo.kind, listKind: undefined }),
            ))
          : null}
        {abierto === "list"
          ? tiposDeLista.map((kind) =>
              chip(
                `lk:${kind}`,
                `${t(`lists.kind.${kind === "movies_and_series" ? "moviesAndSeries" : kind}` as never)} · ${listKindCounts.get(kind) ?? 0}`,
                filter.listKind === kind,
                () =>
                  onFilterChange({
                    ...filter,
                    // Pulsar el tipo que ya estaba puesto vuelve a "todas las
                    // listas", no a "todo": el genero sigue siendo "Listas".
                    listKind: filter.listKind === kind ? undefined : kind,
                  }),
              ),
            )
          : null}
        {abierto === "folder" || abierto === "note"
          ? (() => {
              const tipo = tipos.find((x) => x.kind === abierto);
              /*
                Se queda solo la pastilla que esta encendida, y pulsarla la apaga.
                Sin ella no habria forma de volver a "todo" sin el icono, y con ella
                sola la fila dice exactamente lo que hay puesto.
              */
              return tipo
                ? chip(tipo.kind, t(tipo.key as never), true, () => onFilterChange(EMPTY_FILTER))
                : null;
            })()
          : null}
      </ScrollView>

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
  limpiar: {
    flexDirection: "row",
    alignItems: "center",
  },
  botonOrden: {
    alignItems: "center",
    justifyContent: "center",
    minWidth: 92,
  },
});
