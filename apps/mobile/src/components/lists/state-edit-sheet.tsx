import { useEffect, useState } from "react";
import { View } from "react-native";

import type { BoardState, StateColor } from "@orbit-hub/contracts";

import { MAX_STATE_TITLE } from "@/lib/lists/board";

import { StateColorStrip } from "@/components/lists/state-color-strip";
import { Button } from "@/components/ui/button";
import { Sheet, useLastValue } from "@/components/ui/sheet";
import { AppText } from "@/components/ui/text";
import { TextField } from "@/components/ui/text-field";
import { useTranslation } from "@/lib/i18n";
import { stateColorHex } from "@/lib/lists/board";
import { useTheme } from "@/theme";

export interface StateEditSheetProps {
  /**
   * The column being edited, or `null` when the sheet is closed.
   *
   * **`null` is how this sheet is closed, not a value it draws**: the last column
   * there was is what is on screen while it travels down, which is `useLastValue`
   * and the reason every sheet in this folder does it.
   */
  state: BoardState | null;
  /**
   * Called with the name and the colour when the save is pressed.
   *
   * The screen writes — the columns travel as one field of the list, so this
   * panel hands over the two values and the screen builds the array with
   * `editState`, which trims, caps and refuses blanks and no-ops by identity.
   */
  onSave: (title: string, color: StateColor) => void;
  onClose: () => void;
}

/**
 * One column's name and colour.
 *
 * **It is not a mode of the states editor**, and the difference is what it edits:
 * that one edits the whole array — add, rename, recolour, reorder, delete — and
 * this one edits one column's two fields and nothing else. A mode of that panel
 * would carry its draft, its pages and its delete flow into a panel that needs a
 * field, twelve dots and a button, and a panel that needs three things and shows
 * five is how a row that only renames ends up able to delete.
 *
 * The strip is the shared one (`state-color-strip.tsx`): the same twelve in the
 * same order, with a `testID` front of its own so a walkthrough pressing colours
 * here does not press the editor's behind it.
 */
export function StateEditSheet({ state: pedido, onSave, onClose }: StateEditSheetProps) {
  const theme = useTheme();
  const t = useTranslation();
  const columna = useLastValue(pedido);
  const abierto = pedido !== null;

  const [nombre, setNombre] = useState(columna?.title ?? "");
  const [color, setColor] = useState<StateColor>(columna?.color ?? "neutral");

  /*
    Reopening starts where the column is, **keyed on the column's id and not on
    the column**: the sheet stays mounted while closed, so state left over from
    the last column would greet the next one. The id is what tells one opening
    from the next; the object itself is rebuilt on every write of the list.
  */
  const idColumna = columna?.id ?? null;
  useEffect(() => {
    if (!abierto) return;
    setNombre(columna?.title ?? "");
    setColor(columna?.color ?? "neutral");
  }, [abierto, idColumna]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!columna) return null;

  const titulo = nombre.trim();
  const cambia = titulo.length > 0 && (titulo !== columna.title || color !== columna.color);

  return (
    <Sheet
      visible={abierto}
      onClose={onClose}
      title={t("board.editState")}
      subtitle={columna.title}
    >
      <View style={{ gap: theme.spacing.md }}>
        <TextField
          testID="state-edit-name"
          label={t("board.newStateName")}
          value={nombre}
          onChangeText={setNombre}
          autoFocus
          selectTextOnFocus
          returnKeyType="done"
          maxLength={MAX_STATE_TITLE}
        />
        <View style={{ gap: theme.spacing.xs }}>
          <AppText variant="caption" tone="subtle">
            {t("board.stateColor")}
          </AppText>
          <StateColorStrip
            color={color}
            onChange={setColor}
            testIDPrefix="state-edit-color"
          />
        </View>
        {/*
          **The dot is the column as the board draws it, next to the button that
          writes it.** `iconColor` is what the column panel, the tabs and the task
          panel's row all call with the key, so what is previewed here is what the
          board will show — and a preview that disagreed with the board would be a
          colour chosen blind.
        */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing.sm }}>
          <View
            style={{
              width: 10,
              height: 10,
              borderRadius: theme.radius.pill,
              backgroundColor: stateColorHex(color, theme.colors.icon),
            }}
          />
          <AppText variant="body" style={{ flex: 1 }} numberOfLines={1}>
            {titulo.length > 0 ? titulo : columna.title}
          </AppText>
        </View>
        <Button
          testID="state-edit-save"
          label={t("common.save")}
          icon="checkmark"
          fullWidth
          disabled={!cambia}
          onPress={() => {
            if (!cambia) return;
            onSave(titulo, color);
            onClose();
          }}
        />
      </View>
    </Sheet>
  );
}
