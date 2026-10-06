import { useState, type ReactNode } from "react";
import { View } from "react-native";

import { Button } from "@/components/ui/button";
import { Sheet, SheetOptions, type SheetOption } from "@/components/ui/sheet";
import { AppText } from "@/components/ui/text";
import { useTranslation } from "@/lib/i18n";
import { useTheme } from "@/theme";

/**
 * What the caller wants drawn in place of the default button, **and the one thing
 * it is told about it is what to call.**
 *
 * It is a function of the open action and not the open state, because this component
 * keeps that state: a caller that wanted to drive it would be asking for a second
 * source of truth about whether the sheet is up, and the sheet would answer to
 * whichever of the two was asked last. **Measured on the browser** — no device,
 * there is no simulator attached — the second door is what a board uses: its filter
 * is a floating icon button above the `+`, in the corner where a thumb already is,
 * and the button it replaced was a pill in the middle of the board saying "Filtrar ·
 * A mano".
 *
 * **The default is untouched, so the four screens that pass nothing keep their
 * button, their size, their label and their `testID`.**
 */
export interface ListControlsTriggerProps {
  /** Opens the same sheet the default button opens. */
  open: () => void;
  /**
   * The sentence the default button shows written on it, **handed over because a
   * caller drawing an icon has nowhere to print it.**
   *
   * `"Filtrar"` with nothing on, and `"Filtrar 1"` with one filter — the same two
   * strings the button below builds, from the same `filterCount`, so an icon button
   * and a labelled one cannot disagree about whether anything is filtered. It
   * belongs on `accessibilityLabel` of whatever the caller draws: on a bare glyph
   * this is the *only* thing that says what the button is.
   */
  label: string;
}

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
   * Drawn instead of the default button, **for the one screen whose filter is a
   * floating button and not a pill in the middle of the content.**
   *
   * It exists so this control stays *one* control: the alternative was a board that
   * drew its own sheet, and a board with its own sheet is a second copy of the
   * filter's title, of which section comes first, and of the count in the label —
   * four copies of one decision that this file already owns.
   */
  trigger?: (props: ListControlsTriggerProps) => ReactNode;

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
  trigger,
  testID,
}: ListControlsProps) {
  const theme = useTheme();
  const t = useTranslation();
  const [abierto, setAbierto] = useState(false);

  const filtrando = filterCount > 0;

  /**
   * The two sentences, **written once because both the button below and the
   * `trigger` above say them.**
   *
   * The trigger gets only the first half — `"Filtrar 1"` and not `"Filtrar 1 · A
   * mano"` — because an `accessibilityLabel` is read out loud and the order is not
   * what the button does; it is what the list happens to be doing. The button keeps
   * both, because on a button with the words in front of you they are two facts and
   * the order is one of them. **Not a shortening of the string**: it is the same
   * `filterCount` and the same `filters.title`, so the two cannot drift.
   */
  const etiqueta = filtrando
    ? `${t("filters.title")} ${filterCount} · ${orderLabel}`
    : `${t("filters.title")} · ${orderLabel}`;
  const etiquetaDelBoton = filtrando
    ? `${t("filters.title")} ${filterCount}`
    : t("filters.title");
  const abrir = () => setAbierto(true);

  return (
    <>
      {trigger ? (
        trigger({ open: abrir, label: etiquetaDelBoton })
      ) : (
        <Button
          label={etiqueta}
          icon={filtrando ? "funnel" : "funnel-outline"}
          size="sm"
          variant={filtrando ? "primary" : "secondary"}
          fullWidth={false}
          onPress={abrir}
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

