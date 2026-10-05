import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { MAX_BOARD_STATES } from "@orbit-hub/contracts";
import type {
  BoardState,
  BoardStates,
  ItemIconColor,
  List,
} from "@orbit-hub/contracts";

import { Button } from "@/components/ui/button";
import { Sheet, useLastValue } from "@/components/ui/sheet";
import { TextField } from "@/components/ui/text-field";
import { AppText } from "@/components/ui/text";
import { pluralKey, useTranslation } from "@/lib/i18n";
import { editState, newState } from "@/lib/lists/board";
import {
  ICON_COLOR_KEYS,
  ICON_COLOR_LABEL,
  iconColor,
} from "@/lib/lists/item-icons";
import { useTheme } from "@/theme";

export interface StateEditorSheetProps {
  /**
   * The board being edited, or `null` when the panel is closed — **and that is all
   * this prop is for**: it is the flag, exactly like `item` in `state-picker-sheet`
   * and in `item-edit-sheet`, and it is read here and nowhere else.
   *
   * The rows come from `states` and not from `list.states`, so what this panel
   * draws is **the draft the screen is holding**, which is not necessarily what the
   * list row says while the panel is open. That is the whole of the "one write on
   * close" rule, and it is why the prop that opens the panel is not the prop that
   * fills it.
   */
  list: List | null;
  /** The columns as they are to be drawn — the screen's draft, not the list row. */
  states: BoardStates;
  /** How many tasks each column has, built by the screen with `countInState`. */
  counts: Map<string, number>;
  readOnly: boolean;
  /**
   * A change to the columns, and **it goes to the screen and not to the server.**
   *
   * Every call is the whole array, because the states travel as one field of the
   * list: renaming, colouring, adding and reordering are all one write, and four
   * calls are four writes of the same array with three of them thrown away by the
   * one that lands last.
   *
   * **The panel calls this only when the array really moved.** `editState`,
   * `newState`, `moveState` and `removeState` all answer with *the array they were
   * given* when there is nothing to change, so the identity of what comes back is
   * the question "did anything change" — and the screen compares it with the array
   * the panel was opened on before it writes anything.
   */
  onChange: (states: BoardStates) => void;
  onClose: () => void;
}

/**
 * The board's columns: one row each with its dot, its name and its count, an
 * "add" at the bottom, and a page per column for renaming it and colouring it.
 *
 * **Two pages of one panel and not two panels**, and the reason is the one
 * `item-edit-sheet.tsx` and `state-picker-sheet.tsx` both give: two `Modal`s on one
 * screen are two backdrops, and a press that reaches the wrong one closes what is
 * under it instead of doing what was asked. So renaming a column swaps the body of
 * **this** `Sheet` — same as `item-edit-sheet` does with its icons and labels
 * pages — and the way back is a row at the bottom, `common.back`, which is the one
 * that sheet already uses.
 *
 * **Nothing here writes.** It draws the draft it is given, hands every press
 * straight back as a new array through `onChange`, and the screen is what decides
 * when that leaves the device. That is the difference between this panel and
 * `item-edit-sheet`, which writes as you go — and it is not a style: the columns
 * are one field, so a rename that wrote immediately would put the array on the wire
 * before the colour that was picked next, and the two would be two operations of
 * the same field for one edit that a person made in one sitting.
 *
 * **What it decides is nothing.** Whether the board is at the cap is
 * `MAX_BOARD_STATES`, whether a name is usable is `newState`, and whether the
 * column being renamed keeps its id is `editState`; the three of them are pure
 * functions in `lib/lists/board.ts` with tests, and a panel that answered them a
 * fourth time would be a second implementation of the rules that fail silently.
 *
 * **Measured:** the row height, the twelve swatches and the panel's own layout, at
 * 1440 x 900 in light and dark, in `scripts/verify-state-editor.mjs`. **Not
 * measured:** native, and a phone-width panel — there the twelve swatches wrap onto
 * a second line, which is why `tira` wraps and no run here has looked at it. The
 * widths and target sizes are the ones `state-picker-sheet.tsx` already uses for the
 * rows next to them, and the swatch's reserved border is read out of
 * `icon-picker.tsx`'s, not measured — see the note on `muestra`.
 */
export function StateEditorSheet({
  list: pedido,
  states,
  counts,
  readOnly,
  onChange,
  onClose,
}: StateEditorSheetProps) {
  const theme = useTheme();
  const t = useTranslation();
  /**
   * The board being drawn, **and it is the last one and not the current one.**
   * `pedido` is the caller's flag and goes to `null` at once; this is what stays on
   * screen while `visible` is false, which is `useLastValue` and the reason for it
   * is in `sheet.tsx`: a panel taken out of the tree in the frame the dismissal is
   * asked for never travels at all, and the dismissal was measured at forty-five
   * milliseconds of a quarter of a second.
   */
  const tablero = useLastValue(pedido);

  /**
   * Whether the panel is open, **asked of the caller's argument and not of
   * `tablero`.** This is the edge everything about mounting hangs off, and the two
   * are not the same value: `tablero` is frozen while the panel is closed, on
   * purpose, so that it keeps drawing the board it was showing while it travels
   * down the screen.
   */
  const abierto = pedido !== null;

  /**
   * Which column is being renamed, and `null` for the list of columns.
   *
   * **An id and not a copy of the row**, for the reason `cambiandoEstado` on the
   * screen gives: the row is re-read out of `states` on every render, so what is
   * stored here is only ever the *name* of a column and never a snapshot of one
   * that a write could make stale. It is also what makes the panel take an added
   * column into account without being told: the array it draws is the screen's
   * draft, and a column added on another device is in it.
   */
  const [editando, setEditando] = useState<string | null>(null);

  /** What the page for one column is changing, and nothing is written from it. */
  const [nombre, setNombre] = useState("");
  const [color, setColor] = useState<ItemIconColor>("neutral");

  /** The name of the column about to be added, and it is not there until it is. */
  const [nombreNuevo, setNombreNuevo] = useState("");

  /**
   * Reopening always starts on the list with nothing half-typed, and **the key is
   * the panel being open** and not the board.
   *
   * The same trap `state-picker-sheet.tsx` writes about at length: `tablero` freezes
   * while `pedido` is `null` — freezing is its whole purpose — so keying on it does
   * not fire when the same board is opened twice, and the second time the panel
   * comes up with the last column's name still in the field and on its own page.
   */
  useEffect(() => {
    if (!abierto) return;
    setEditando(null);
    setNombre("");
    setColor("neutral");
    setNombreNuevo("");
  }, [abierto]);

  /**
   * Opening a column loads **its values now**, and the key is the id.
   *
   * **Two dependencies and not one, and the second is here on purpose.** `states` is
   * the screen's draft and it changes identity on every edit this panel makes, so
   * leaving it out would leave a linter complaining and leaving it in has to be
   * safe: the only edits that change the array are *add* and *save*, and *save*
   * leaves this page for the list — so the effect can never run over a title that
   * somebody is in the middle of typing.
   *
   * The id and not the row: `item-edit-sheet` says why, at the effect of its own,
   * and the summary is that a row that changes identity on every write resets the
   * page somebody is on every time anything is saved.
   */
  const idEditando = editando;
  useEffect(() => {
    const fila = states.find((state) => state.id === idEditando) ?? null;
    setNombre(fila?.title ?? "");
    setColor(fila?.color ?? "neutral");
  }, [idEditando, states]);

  /**
   * Whether the board is at the cap, **which is `MAX_BOARD_STATES` and not a number
   * of this file's.** It is what greys the "add" out, and the number the caption
   * says is the same constant — see `board.stateLimit`.
   */
  const alTope = states.length >= MAX_BOARD_STATES;

  /**
   * One column at the end, and **`newState`'s `null` ends the function.**
   *
   * It comes back for the two things that would be a write the contract throws
   * away: the board is at `MAX_BOARD_STATES`, or the name is blank once trimmed.
   * **Checked before `onChange` and not inside it**, because the states travel as
   * one field of the list: a `null` inside that array does not fail this add, it
   * makes the contract refuse the **whole array** and with it every later save of
   * that board. A board whose columns cannot be saved is worse than one that did
   * not get its fifth column, so this is the check that costs a board its columns
   * when it is forgotten.
   *
   * `newState` also trims, so the title in the array is the trimmed one and not
   * what was in the field.
   */
  function anadir() {
    const columna = newState(states, nombreNuevo);
    if (!columna) return;
    onChange([...states, columna]);
    setNombreNuevo("");
  }

  /**
   * Saving the column being renamed, **and the id is not in this function.**
   *
   * `editState` keeps it, and that is the invariant the whole feature stands on:
   * tasks point at an id and not at a name, so a rename that minted a new one would
   * leave every task in that column an orphan that the next pull draws in the first
   * column with nothing saying why. The comment on `editState` is the one that says
   * it at length.
   *
   * **Name and colour go in the same call and not one after the other**, for the
   * same reason the two are one field: two calls are two writes of one array.
   *
   * **A blank name saves the colour and nothing else**, because `editState` answers
   * with the array it was given when the title comes back empty — a column nobody
   * can name is a column nobody can move a task to, and the contract refuses one.
   * So an empty field is not an error here, it is a rename that did not happen, and
   * the panel says so by leaving the row as it was.
   *
   * **`siguiente !== states` is the "did anything change" question**, asked by
   * identity because that is how the four functions of `board.ts` answer it: they
   * all return the very array they were given when there is nothing to change.
   * Passing that array up as if it were an edit is what would put an operation in
   * the outbox for opening a panel and closing it again.
   */
  function guardar() {
    const id = idEditando;
    if (id === null) return;
    const siguiente = editState(states, id, { title: nombre, color });
    if (siguiente !== states) onChange(siguiente);
    setEditando(null);
  }

  /**
   * Which page, **as a name and not as the test for it.** Task 12 adds a third one —
   * where a column with tasks in it asks where they go — and this line is where it
   * becomes a case instead of a new `Sheet`. The panel's props do not change with
   * it: `states`, `counts` and `onChange` are what the delete flow needs too.
   */
  const pagina = editando === null ? "lista" : "estado";

  /*
    `readOnly` **does not draw this panel**, and that is the whole of the answer —
    the same one `state-picker-sheet.tsx` gives and for the same reason: a viewer is
    not somebody to hand a panel of controls that cannot be pressed, and a panel of
    four columns with nothing to do in it is the shape of a bug. The screen also
    does not mount this component for a viewer, so this branch is the second of the
    two doors rather than the only one.

    **It is after the hooks and not before them**, because a branch above them
    changes the order the hooks run in, and React answers that with a crash on the
    first render where the answer is different.
  */
  if (readOnly) return null;
  if (!tablero) return null;

  return (
    <Sheet
      visible={abierto}
      onClose={onClose}
      title={t("board.editStates")}
      /*
        Which board, in words, under the title that says what this panel is for.
        There are two doors into it —this one and the row in the state picker— and
        on a wide window two boards can be open one behind the other, so a panel
        that says "Edit the board's states" and not which board leaves the two
        indistinguishable. It is the list's own title and not a label of ours.
      */
      subtitle={tablero.title}
      scrollable
    >
      {pagina === "lista" ? (
        <>
          {/*
            The rows, **and the order they are in is the order of the columns.** The
            array is the board: there is no `position` per column anywhere, which is
            why reordering is one write of one field and not one write per column.
            Task 12 puts the drag handle on these same rows.
          */}
          <View style={{ gap: theme.spacing.sm }}>
            {states.map((state) => (
              <FilaEstado
                key={state.id}
                state={state}
                count={counts.get(state.id) ?? 0}
                onPress={() => setEditando(state.id)}
              />
            ))}
          </View>

          {/*
            The new column, **and it is a field that is always there and not one
            that appears on a press.** The state picker hides its field until the
            row is pressed, and the note there says why: *"that is the difference
            between 'there is one more thing you can do here' and 'this panel is a
            form'"*. This panel **is** the form — it is where the columns of a board
            are created, renamed, coloured and, in Task 12, dragged and deleted — so
            a field that appears when you press something makes a panel of four
            rows look like it was hiding an option.
          */}
          <View style={{ gap: theme.spacing.sm, marginTop: theme.spacing.md }}>
            <TextField
              testID="state-editor-new-name"
              label={t("board.addState")}
              value={nombreNuevo}
              onChangeText={setNombreNuevo}
              autoCapitalize="words"
              returnKeyType="done"
              onSubmitEditing={anadir}
            />
            <Button
              testID="state-editor-add"
              label={t("items.add")}
              icon="add"
              disabled={alTope || nombreNuevo.trim().length === 0}
              fullWidth
              onPress={anadir}
            />

            {/*
              **Why the button is off, in words, and not only greyed.**

              The cap is a limit this app can only find out by failing — the contract
              refuses the twenty-fifth column — and a limit discovered that way is a
              column that appears and then comes back gone on the next pull. So the
              edge is named where the button is, and `MAX_BOARD_STATES` is the number
              it says rather than a twenty-four written next to it: a second copy of
              a limit is a second thing to forget when the limit moves. It is the
              same sentence and the same constant as the state picker's, which is
              where the first version of this edge was drawn.
            */}
            {alTope ? (
              <AppText variant="caption" tone="subtle">
                {t("board.stateLimit", { max: MAX_BOARD_STATES })}
              </AppText>
            ) : null}
          </View>
        </>
      ) : (
        <View style={{ gap: theme.spacing.md }}>
          <TextField
            testID="state-editor-name"
            label={t("board.newStateName")}
            value={nombre}
            onChangeText={setNombre}
            autoFocus
            selectTextOnFocus
            returnKeyType="done"
            onSubmitEditing={guardar}
          />

          <View style={{ gap: theme.spacing.xs }}>
            <AppText variant="caption" tone="subtle">
              {t("board.stateColor")}
            </AppText>
            <TiraDeColores color={color} onChange={setColor} />
          </View>

          <Button
            testID="state-editor-save"
            label={t("common.save")}
            icon="checkmark"
            fullWidth
            onPress={guardar}
          />

          {/*
            The way back, **and it goes to the list of columns and not out of the
            panel.** The panel is closed with its own `X` or by pulling it down, and
            both of those write the draft; a back that meant "leave without saving"
            would have to be honest about not writing, and there is nowhere else to
            put a draft that was not written. So this is a page, exactly as
            `item-edit-sheet`'s `common.back` is a page.
          */}
          <Button
            testID="state-editor-back"
            label={t("common.back")}
            variant="ghost"
            fullWidth
            onPress={() => setEditando(null)}
          />
        </View>
      )}
    </Sheet>
  );
}

/**
 * The twelve colours a column can be, **and it is the icon palette and not a second
 * list.**
 *
 * `ICON_COLOR_KEYS` *is* `ITEM_ICON_COLORS` (`item-icons.ts`, line 110), so a column and
 * an icon of the same key are the same colour on the same screen, and there is one
 * place to add a colour to. The labels come from `ICON_COLOR_LABEL` for the same
 * reason and with the same effect: a colour the app cannot name is a colour
 * somebody using a screen reader cannot choose.
 *
 * **The swatch is the one of `icon-picker.tsx` and not a new one**: thirty points
 * round, the chosen one ringed with the theme's own text colour. The one difference
 * is that the ring is **always drawn** and is transparent when the colour is not
 * chosen, which `icon-picker` does not do — and the reason is in `IconCell` of that
 * file, about its grid jumping when a drawing is picked: here the twelve sit on one
 * row, so a border that appears would push the other eleven along by six points on
 * every tap. **This is read out of that component and not measured**, and the
 * consequence of being wrong is a strip that shifts by six points when a colour is
 * chosen.
 */
function TiraDeColores({
  color,
  onChange,
}: {
  color: ItemIconColor;
  onChange: (color: ItemIconColor) => void;
}) {
  const theme = useTheme();
  const t = useTranslation();

  return (
    <View style={[styles.tira, { gap: theme.spacing.xs }]}>
      {ICON_COLOR_KEYS.map((opcion) => {
        const activa = color === opcion;
        return (
          <Pressable
            key={opcion}
            testID={`state-editor-color-${opcion}`}
            accessibilityRole="button"
            accessibilityState={{ selected: activa }}
            accessibilityLabel={t(ICON_COLOR_LABEL[opcion])}
            onPress={() => onChange(opcion)}
            style={({ pressed }) => [
              styles.muestra,
              {
                backgroundColor: iconColor(opcion),
                borderColor: activa ? theme.colors.text : "transparent",
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          />
        );
      })}
    </View>
  );
}

/**
 * One column of the board, in the editor: its dot, its name and how much is in it.
 *
 * **Three slots and not one pressable**, and the shape is chosen for Task 12 rather
 * than for today. The spec's row is *"asa de arrastrar, punto de color, nombre,
 * contador, papelera"*, and Task 12 adds the first and the last of those. So `asa`
 * and `accion` are two empty slots either side of the part that is pressable today,
 * they are `null` in this task, and adding them is passing a node to each — with no
 * change to this component's body, to `styles.fila` or to the pressable's target.
 *
 * **The action is a sibling and not a child of the pressable**, which is why the
 * two are separated here and not nested: a pressable inside a pressable needs
 * `stopPropagation()` to not also open the row — `SheetOptionRow` does that and says
 * why — and a column's bin is a control whose whole meaning is that it is *not* the
 * row. As siblings it cannot be.
 *
 * **The count comes from `counts` and is not counted here**, for the reason the
 * picker gives: the numbers are the ones the tabs and the column headers are already
 * drawing, and a second count of the same rows is a second answer to a question the
 * screen has answered.
 */
function FilaEstado({
  state,
  count,
  asa,
  accion,
  onPress,
}: {
  state: BoardState;
  count: number;
  /** The drag handle of Task 12, or `null` while there is none. */
  asa?: ReactNode;
  /** The bin of Task 12, or `null` while there is none. */
  accion?: ReactNode;
  onPress: () => void;
}) {
  const theme = useTheme();
  const t = useTranslation();

  /** The count said and not printed, because a screen reader has to hear it too. */
  const dicho = t(pluralKey("lists.itemCount", count), { count });

  return (
    <View style={[styles.fila, { gap: theme.spacing.md }]}>
      {asa}
      <Pressable
        testID={`state-editor-row-${state.id}`}
        accessibilityRole="button"
        accessibilityLabel={`${state.title}, ${dicho}`}
        onPress={onPress}
        style={({ pressed }) => [
          styles.cuerpo,
          {
            gap: theme.spacing.md,
            paddingVertical: theme.spacing.md,
            paddingHorizontal: theme.spacing.md,
            borderRadius: theme.radius.md,
            backgroundColor: pressed ? theme.colors.surfaceMuted : "transparent",
          },
        ]}
      >
        {/* The colour of the column, as the dot the tab strip, the column header
            and the state picker all draw: four shapes of one size, so the eye
            matches a row here to a column there and to a pill above. */}
        <View
          style={[
            styles.punto,
            {
              backgroundColor: iconColor(state.color),
              borderRadius: theme.radius.pill,
            },
          ]}
        />
        <AppText variant="body" style={styles.nombre} numberOfLines={1}>
          {state.title}
        </AppText>
        {/*
          The number has **its own `testID`, and that is not decoration for a
          check**: a row is "Titulo · 2" with the name and the number in it, so a
          walkthrough that reads the row's `innerText` has to cut a string in two,
          and it is easier to break on a row with a two-digit count than on one with
          a single digit. The id is the row's own `testID` with `-count` on the end,
          which is what `state-picker-sheet` does.
        */}
        <AppText
          variant="caption"
          tone="subtle"
          testID={`state-editor-count-${state.id}`}
        >
          {count}
        </AppText>
      </Pressable>
      {accion}
    </View>
  );
}

const styles = StyleSheet.create({
  /**
   * The row, **and it is a box and not the pressable itself**, because there are
   * three things in it and two of them must not be the row: the handle and the bin
   * of Task 12. Its `gap` is the theme's `md`, the same twelve the inner row uses
   * and the same twelve the picker's row uses, so the columns of the two panels
   * line up with each other on a screen that has both of them open.
   */
  fila: {
    flexDirection: "row",
    alignItems: "center",
  },
  /**
   * The part of the row that opens the editor of that column, **and its height is a
   * target and not a type size.**
   *
   * Forty-eight is `Button` at its middle size — `button.tsx`'s `dimensions.md` —
   * and the `minHeight` of `TextField`. It is the smallest height a control in this
   * app is given as a number, which is why a row pressed with a thumb while the
   * other hand is elsewhere is worth setting explicitly. It is the number
   * `state-picker-sheet.tsx` sets its row to, and the reason it gives there is that
   * a row whose height is whatever its contents happen to be moves its target when
   * the number in it goes from one digit to two.
   */
  cuerpo: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    minHeight: 48,
  },
  /**
   * The name gives up its width before the count does.
   *
   * The trap `board-column.tsx` writes about for its own header: on the web
   * `react-native-web@0.21.2` writes `flexShrink: 0` on every `View`, so a column
   * called "Waiting for review" pushed its count off the right edge and the number
   * that says how much is in it went with it. `minWidth: 0` lets the name narrow to
   * one line instead of the row widening.
   */
  nombre: {
    flex: 1,
    minWidth: 0,
  },
  /**
   * Ten points, and it is the only size written by hand in this file: it is the
   * shape of a dot and the theme has no token that means "how big is a dot". It is
   * the same ten as `board-tabs.tsx`, `board-column.tsx` and
   * `state-picker-sheet.tsx`, and **being the same ten is the whole reason it is
   * written by hand** — a dot that matched nothing else on the screen would be one
   * more thing to look at.
   */
  punto: {
    width: 10,
    height: 10,
  },
  /** The colours wrap, because a phone-width panel has room for six of the twelve. */
  tira: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  /**
   * Thirty points round, from `icon-picker.tsx`'s `swatch`, **and with the ring
   * always drawn** — `borderWidth: 3` here, not the `activa ? 3 : 0` of that file.
   * The ring sits on top of the colour rather than outside it, which is what keeps
   * twelve swatches from being 360 points of colour plus 36 of border that only one
   * of them has.
   */
  muestra: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 3,
  },
});
