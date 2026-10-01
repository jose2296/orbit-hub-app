import { useState, type ReactNode } from "react";
import { View } from "react-native";

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
export function ListControls({
  filterCount,
  orderLabel,
  children,
  orders = [],
  canReorder = false,
  onReorder,
  testID,
}: ListControlsProps) {
  const theme = useTheme();
  const t = useTranslation();
  const [abierto, setAbierto] = useState(false);

  const filtrando = filterCount > 0;

  return (
    <>
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
        onPress={() => setAbierto(true)}
        testID={testID}
      />

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

