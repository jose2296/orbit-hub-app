import { StyleSheet, View } from "react-native";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { TextField } from "@/components/ui/text-field";
import { useTranslation } from "@/lib/i18n";
import { useTheme } from "@/theme";

import { AppText } from "../ui/text";

export interface FiltersSheetProps {
  open: boolean;
  onClose: () => void;
  tags: { tag: string; count: number }[];
  selectedTags: string[];
  onToggleTag: (tag: string) => void;
  /**
   * Which of the three is on, **and absent means "everything"**.
   *
   * Absent and not `"all"` because a list with no completed/not-completed
   * distinction —a board, where "done" is a column— has no third state to keep: it
   * passes `completedDisabled` and nothing else, and a filter of its own is state
   * that can never change.
   */
  completed?: "all" | "pending" | "done";
  onCompleted?: (value: "all" | "pending" | "done") => void;
  /**
   * Whether the three rows are drawn but cannot be changed, **and they are drawn.
   *
   * A board has no completed column: "done" is one of its states, and the spec says
   * why having both is what leads to a completed task sitting in Backlog. So the
   * section is not removed — a control that vanishes leaves a sheet that was there
   * yesterday shorter today with nothing said — it is greyed, with the reason under
   * it.
   */
  completedDisabled?: boolean;
  text: string;
  onText: (value: string) => void;
  onReset: () => void;
}

/**
 * What a list is showing: the labels, what is left to do, and a search.
 *
 * A panel rather than a row of chips above the list, because a shopping list
 * has a dozen labels and the chips would take more room than the items. It
 * opens with everything showing, because a filter that hides things the moment
 * it appears is one nobody trusts.
 */
/**
 * The filter of a list of things, **as the body of a sheet and not a sheet**.
 *
 * It was a sheet of its own with its own margin inside it, so it was opened from
 * a button, and the button next to it opened another sheet for the order, and the
 * one next to that opened a third for the manual arrangement. Three sheets for one
 * list. This is the first section of the one sheet that holds all three, and it
 * brings **no margin of its own**: the sheet's body has one, and a section with a
 * second one sits thirty-six points in from the edge of a panel that is eighteen.
 */
export function FiltersBody({
  tags,
  selectedTags,
  onToggleTag,
  completed,
  onCompleted,
  completedDisabled = false,
  text,
  onText,
  onReset,
}: Omit<FiltersSheetProps, "open" | "onClose" | "activeCount">) {
  const theme = useTheme();
  const t = useTranslation();

  /**
   * Which of the three rows carries the tick, **and "everything" when there is no
   * answer to give.**
   *
   * `completed` is absent on a board, and `undefined === "all"` is `false`, so
   * without this a greyed-out section would come up with **no row ticked at all** —
   * which reads as a filter panel in a state it cannot be in rather than as one
   * that is showing everything and cannot be changed.
   */
  const elegida = completed ?? "all";

  return (
    <View style={{ gap: theme.spacing.lg }}>
        <TextField
          label={t("filters.searchLabel")}
          value={text}
          onChangeText={onText}
          placeholder={t("filters.searchPlaceholder")}
          autoCapitalize="none"
          autoCorrect={false}
        />

        <View style={{ gap: theme.spacing.sm }}>
          <AppText variant="caption" tone="subtle">
            {t("filters.what")}
          </AppText>
          <View style={{ gap: theme.spacing.xs }}>
            {(["all", "pending", "done"] as const).map((value) => (
              <View
                key={value}
                style={[
                  styles.checkRow,
                  {
                    backgroundColor: theme.colors.surfaceMuted,
                    borderRadius: theme.radius.md,
                  },
                ]}
              >
                <Checkbox
                  checked={elegida === value}
                  disabled={completedDisabled}
                  onToggle={() => onCompleted?.(value)}
                  label={t(`filters.show.${value}`)}
                  testID={`filters-completed-${value}`}
                />
              </View>
            ))}
          </View>
          {/*
            **El motivo, debajo de las tres filas y solo cuando estan apagadas.** Un
            boton que no hace nada sin decir por que se lee como una pantalla rota,
            y esta hoja es la misma en un tablero y en una lista de tareas: alguien
            que abre los filtros de un tablero y ve «Solo lo que queda» apagado tiene
            que poder leer que en un tablero lo hecho es una columna.
          */}
          {completedDisabled ? (
            <AppText variant="caption" tone="subtle" testID="filters-completed-off">
              {t("filters.completedOff")}
            </AppText>
          ) : null}
        </View>

        {tags.length > 0 ? (
          <View style={{ gap: theme.spacing.sm }}>
            <AppText variant="caption" tone="subtle">
              {t("filters.labels")}
            </AppText>
            <View style={[styles.labels, { gap: theme.spacing.sm }]}>
              {tags.map(({ tag, count }) => (
                <Button
                  key={tag}
                  label={`${tag} · ${count}`}
                  size="sm"
                  variant={selectedTags.includes(tag) ? "primary" : "secondary"}
                  fullWidth={false}
                  onPress={() => onToggleTag(tag)}
                  testID={`filters-tag-${tag}`}
                />
              ))}
            </View>
          </View>
        ) : null}

      <Button
        label={t("filters.reset")}
        variant="ghost"
        icon="refresh"
        onPress={onReset}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  labels: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  checkRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
});
