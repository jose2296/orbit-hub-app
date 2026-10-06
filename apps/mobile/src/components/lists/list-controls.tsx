import { useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { Button } from "@/components/ui/button";
import { Sheet, SheetOptions, type SheetOption } from "@/components/ui/sheet";
import { AppText } from "@/components/ui/text";
import { useTranslation } from "@/lib/i18n";
import { useTheme } from "@/theme";

export interface ListControlsProps {
  /**
   * How many filters are on, **and it is the number in the label**.
   *
   * Not decoration: with the values inside a sheet, a number is the only way to
   * know that anything is filtered at all without opening it.
   */
  filterCount: number;
  /** The order's own short name, from the same list the films use. */
  orderLabel: string;

  /** The filter section: the field and the chips. It is the caller's, whole. */
  children?: ReactNode;

  /** The orders offered, and the one that is on carries the tick. */
  orders?: SheetOption[];
  /**
   * Whether the manual order can be arranged here, **and it is not the same as
   * whether the manual order is on**: it is only meaningful while it is.
   */
  canReorder?: boolean;
  /** Opens whatever arranges the rows, which is a sheet with a handle per row. */
  onReorder?: () => void;

  /**
   * Where the button sits, and **not what it does**.
   *
   * `"inline"` is the default and is a button inside the flow of the screen — in a
   * `FlatList` header, which means it scrolls away with the content. `"floating"`
   * pins it to the corner above the `+`, which is where the list screen wants it and
   * where it stays when the list is long.
   *
   * Same control, same sheet, same label: a screen choosing where to put it does not
   * make a second thing to know, which is the reason this is one component.
   */
  placement?: "inline" | "floating";
  /** From the bottom of the screen, for `"floating"`. See `bottomCluster`. */
  floatingBottom?: number;
  /** From the right edge, for `"floating"`. */
  floatingRight?: number;

  testID?: string;
}

/**
 * One button and one sheet, **for what a list of anything can be filtered and
 * ordered by**.
 *
 * It was three buttons in a row above the list — the order, the filter and, when
 * the order was manual, the reorder — and there are three reasons that is worse
 * than one control, in increasing order of how much they matter:
 *
 * - **three things to learn where one would do**, on every screen that has a list,
 *   and the app has four of those;
 * - **three sheets to open** for one question ("how is this showing me this?"),
 *   and each one hides the other two;
 * - **the state was in the label of one of them and nowhere else**, so the order
 *   was readable and the filters were a number.
 *
 * So: one button whose label is the state, and one sheet with the sections in it,
 * in the order they are asked for — what is here, how it is read, and how it is
 * arranged. Arranging by hand is a section and not a third sheet, because it needs
 * its own sheet with a handle per row; pressing it swaps which sheet is in front.
 *
 * **It is the same control on every screen.** Folders, lists of tasks, films and
 * the catalogue all open this, and a control that is the same in four places is one
 * thing to know rather than four.
 *
 * It keeps its own open state, because nothing outside it needs to know: a caller
 * that wants to open it from somewhere else presses the button.
 */
/**
 * The button itself, with no idea where it is going.
 *
 * Extracted because the two placements must draw **the same control**: if the
 * floating one had its own label or its own icon, a person would be looking at two
 * different things on two different screens, which is the cost this component
 * exists to avoid.
 */
function ListControlsButton({
  filtrando,
  filterCount,
  orderLabel,
  onPress,
  iconOnly = false,
  testID,
}: {
  filtrando: boolean;
  filterCount: number;
  orderLabel: string;
  onPress: () => void;
  /**
   * Solo el dibujo, y el texto se queda para el lector de pantalla.
   *
   * Flotando, el botón decía "Filtros · Como yo lo pongo" sobre una pantalla de
   * trescientos y noventa puntos: ciento sesenta de ancho para el estado de un
   * control, encima del `+`. Con el icono solo, y `variant` como estaba, sigue
   * diciendo si hay filtros puesta.
   */
  iconOnly?: boolean;
  testID?: string;
}) {
  const t = useTranslation();

  return (
    <Button
      label={
        filtrando
          ? `${t("filters.title")} ${filterCount} · ${orderLabel}`
          : `${t("filters.title")} · ${orderLabel}`
      }
      icon={filtrando ? "funnel" : "funnel-outline"}
      size="sm"
      variant={filtrando ? "primary" : "secondary"}
      fullWidth={false}
      iconOnly={iconOnly}
      onPress={onPress}
      testID={testID}
    />
  );
}

export function ListControls({
  filterCount,
  orderLabel,
  children,
  orders = [],
  canReorder = false,
  onReorder,
  placement = "inline",
  floatingBottom,
  floatingRight,
  testID,
}: ListControlsProps) {
  const theme = useTheme();
  const t = useTranslation();
  const [abierto, setAbierto] = useState(false);

  const filtrando = filterCount > 0;
  return (
    <>
      {/*
        The floating placement is a wrapper and not a style on the button, because a
        `Pressable` positioned with `position: absolute` needs a parent that is the
        anchor — and on web `react-native-web` puts an identity `transform` on every
        `ScrollView`, which silently degrades `fixed` to `absolute`. Anchoring it in
        a plain `View` is the part that cannot go wrong.
      */}
      {placement === "floating" ? (
        <View
          pointerEvents="box-none"
          style={[
            styles.flotante,
            {
              bottom: floatingBottom ?? 0,
              right: floatingRight ?? 0,
            },
          ]}
        >
          <ListControlsButton
            filtrando={filtrando}
            filterCount={filterCount}
            orderLabel={orderLabel}
            onPress={() => setAbierto(true)}
            iconOnly
            testID={testID}
          />
        </View>
      ) : (
        <ListControlsButton
          filtrando={filtrando}
          filterCount={filterCount}
          orderLabel={orderLabel}
          onPress={() => setAbierto(true)}
          testID={testID}
        />
      )}

      <Sheet visible={abierto} onClose={() => setAbierto(false)} title={t("content.sort.title")}>
        {/*
          The filter first, **because it is the one people use** and because the
          text field at the top of a sheet is the fastest thing on it.
        */}
        {children}

        {orders.length > 0 ? (
          <View style={{ marginTop: theme.spacing.md, gap: theme.spacing.xs }}>
            <AppText variant="caption" tone="subtle">
              {t("content.sort.title")}
            </AppText>
            <SheetOptions options={orders} />
          </View>
        ) : null}

        {canReorder && onReorder ? (
          <View style={{ marginTop: theme.spacing.md, gap: theme.spacing.xs }}>
            <AppText variant="caption" tone="subtle">
              {t("order.manual")}
            </AppText>
            <SheetOptions
              options={[
                {
                  key: "reordenar",
                  label: t("order.reorder"),
                  description: t("order.reorderHint"),
                  icon: "reorder-two-outline" as const,
                  onPress: () => {
                    setAbierto(false);
                    onReorder();
                  },
                },
              ]}
            />
          </View>
        ) : null}
      </Sheet>
    </>
  );
}


const styles = StyleSheet.create({
  /**
   * The anchor for the floating placement.
   *
   * A plain `View`, and not a `position: fixed` button: `react-native-web` puts an
   * identity `transform` on every `ScrollView`, and a `transform` on an ancestor
   * turns `fixed` into `absolute` without saying so. Absolute inside a `View` that
   * is itself out of the flow does the same thing and cannot be degraded that way.
   *
   * `box-none` so the area around the button belongs to the list underneath and
   * only the button takes the tap — a full-width wrapper here would swallow the
   * rows behind it.
   */
  flotante: {
    position: "absolute",
  },
});
