import { Ionicons } from "@expo/vector-icons";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import type { SharedValue } from "react-native-reanimated";

import { MAX_BOARD_STATES } from "@orbit-hub/contracts";
import type {
  BoardState,
  BoardStates,
  ItemIconColor,
  List,
} from "@orbit-hub/contracts";

import { StateDeleteSheet } from "@/components/lists/state-delete-sheet";
import { StateColorStrip } from "@/components/lists/state-color-strip";
import { useA11yHint } from "@/components/ui/a11y-hint";
import { Button } from "@/components/ui/button";
import { DRAG_HANDLE_WIDTH } from "@/components/ui/draggable-row";
import { Sheet, useLastValue } from "@/components/ui/sheet";
import { TextField } from "@/components/ui/text-field";
import { AppText } from "@/components/ui/text";
import { pluralKey, useTranslation } from "@/lib/i18n";
import {
  canDeleteState,
  editState,
  moveState,
  newState,
  removeState,
} from "@/lib/lists/board";
import { dropIndex, rowShift } from "@/lib/lists/drag-shift";
import {
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
  /**
   * A column with things in it has been given a destination, **and the screen is
   * what moves the tasks and takes the column out.**
   *
   * **A column with nothing in it never comes here**, and that is not a
   * simplification: `removeState` is called in place for those, because only a name
   * and a colour are lost and asking where nothing goes is asking a question with
   * no answer. **The split is on `counts`, which is the screen's number and was
   * built with `countInState`**, so the tasks with a null `stateId` — every task
   * created on a board — are counted in the first column, and a first column with
   * three of them asks. A panel that counted the rows itself would answer a
   * different question, and one that compared `item.stateId` would say zero and
   * would delete without asking anybody.
   *
   * **It may be a promise and it may not, and this panel does not wait either
   * way.** What it does do is **stay on the question while the screen works**, and
   * that is what makes a second press harmless: by then the column is out of the
   * draft, so the second `deleteStatePlan` is `null` and nothing is written twice.
   * A flag of "is it already working?" would be one more thing that can be wrong,
   * and this way the question is asked and the answer is already true.
   */
  onDelete: (stateId: string, destinationId: string) => void | Promise<void>;
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
 * a second line, which is why the strip wraps and no run here has looked at it. The
 * widths and target sizes are the ones `state-picker-sheet.tsx` already uses for the
 * rows next to them, and the swatch's reserved border is read out of
 * `icon-picker.tsx`'s, not measured — see `state-color-strip.tsx`, where the strip
 * lives now.
 */
export function StateEditorSheet({
  list: pedido,
  states,
  counts,
  readOnly,
  onChange,
  onDelete,
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

  /**
   * Which column is being deleted, and `null` for the other two pages.
   *
   * **An id and not a copy of the row**, for the reason `editando` gives, and it is
   * the flag `state-delete-sheet` is handed: `null` is how that page says "I am not
   * the one on screen", which is the same shape its plan signature has and the same
   * shape this panel's own props have.
   */
  const [borrando, setBorrando] = useState<string | null>(null);

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
    setBorrando(null);
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
   * Which page, **as a name and not as the test for it.** Task 12 added the third
   * case, and **it is a case here and not a fourth `Sheet`** — which is what this
   * line said it would be before it was written, and it is worth saying why it is not
   * taken on faith: `state-delete-sheet.tsx` was built first as its own always-mounted
   * panel, exactly as the plan's signature asks, and **medido as no lo servía**
   * (`scripts/verify-state-editor.mjs`, bloque 10). Dos `sheet-panel` durante 617 ms
   * de los 905 medidos, en 38 fotogramas de 56, y **el editor salia en el portal #6
   * contra el #5 de la hoja de borrado**: `elementFromPoint` devolvio el editor en los
   * 38 de 38, en el fondo y en el centro del panel que entraba, y la pulsacion
   * siguiente sobre una fila de destino no hizo nada. El mecanismo esta en
   * `ModalPortal.js` de react-native-web: **anade su `div` a `body` en el primer
   * render del `Modal`, no la primera vez que se hace visible**, y los otros tres
   * paneles de esta pantalla se niegan a dibujarse mientras no tienen nada, asi que
   * su portal se crea la primera vez que se abren — y el puesto lo gana el que se
   * monta antes, haya estado abierto o no. El detalle largo esta en
   * `state-delete-sheet.tsx`.
   *
   * Así que el orden es `borrando` primero y `editando` despues: **preguntar donde
   * van las tareas de una columna se lleva la pantalla entera**, y una columna que se
   * esta renombrando no puede ser la misma que se esta borrando.
   */
  const pagina =
    borrando !== null ? "borrado" : editando === null ? "lista" : "estado";

  /** The column the question is about, read out of the draft and never a snapshot. */
  const columnaBorrada = useMemo(
    () => states.find((state) => state.id === borrando) ?? null,
    [states, borrando],
  );

  /** The columns left to send them to, **and none of them is chosen here.** */
  const otrasColumnas = useMemo(
    () => (columnaBorrada ? states.filter((s) => s.id !== columnaBorrada.id) : []),
    [states, columnaBorrada],
  );

  /**
   * Deleting a column, **and the two cases are not the same size of decision.**
   *
   * A column with nothing in it goes straight through `removeState`: only a name
   * and a colour are lost, the whole of it is one array, and the brief says no
   * confirmation — a panel asking where nothing goes is asking a question with no
   * answer. A column with tasks in it opens the question on this same panel, and
   * **what happens to those tasks is not this panel's business**: they are rows of
   * another table, and `deleteStatePlan` is what writes them, with the destination
   * spelled out for every one of them.
   *
   * **The number is `counts`, which came from `countInState`, and that is the
   * load-bearing half of the split.** A task with a null `stateId` is drawn in the
   * first column, so a first column with three of them says 3 and asks where they
   * go; a panel that counted `item.stateId === state.id` would say zero, delete
   * without asking, and those three would land in whichever column is first
   * afterwards. Nothing fails; the tasks are simply in a column nobody chose.
   */
  function borrar(stateId: string) {
    if ((counts.get(stateId) ?? 0) > 0) {
      setBorrando(stateId);
      return;
    }
    const siguiente = removeState(states, stateId);
    if (siguiente !== states) onChange(siguiente);
  }

  /**
   * The destination is given and the screen is told, **and the page stays up until
   * the screen says it is done.**
   *
   * **That is the whole of the guard against a double press**, and it is a guard by
   * consequence rather than by a flag: `onDelete` moves the tasks and then takes the
   * column out of the draft, so the array this panel draws no longer has that column
   * and `columnaBorrada` is `null` — which leaves the page anyway, because a page
   * asking about a column that is gone has nothing to ask about. A second press in
   * between asks `deleteStatePlan` about a column that is not in the array, gets
   * `null`, and **nothing is written twice**. A "is it working?" flag would be a
   * second thing to keep true; this way the question is asked and the answer is
   * already the truth.
   *
   * **`Promise.resolve` and not an `await`**, because `onDelete` may or may not be
   * async and the page must work with either: without it a synchronous handler
   * would leave the page waiting for a promise that is not there.
   */
  function elegirDestino(destinoId: string) {
    const id = borrando;
    if (id === null) return;
    void Promise.resolve(onDelete(id, destinoId)).then(() => {
      setBorrando(null);
    });
  }

  /**
   * Whether the last column is on screen, **which is `canDeleteState` and not a
   * length compared here.** It asks with an index because that is the question the
   * rule is asked with, and this panel is the only caller that has to know it: the
   * bin is drawn on every row, so with one column the answer is `false` for the one
   * that exists.
   */
  const soloUna = states.length === 1;

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

            **Inside `OrdenEstados` and not bare**, which is what puts the handle on
            them: the provider holds the three numbers a drag needs — which row is
            being dragged, where it was and where it would land — and the pitch of
            the list, which is this `gap` plus a row's height. It is `DraggableSort`
            from `draggable-row.tsx` in everything but its row: that one draws a
            **card** with its own fill and its shadow and a handle on the *right*,
            and the spec's row here is `asa, punto, nombre, contador, papelera` — the
            handle on the left and no card around it — so the provider's shape is
            reused and its row is not. `dropIndex` and `rowShift` are the same
            functions that row uses, imported, so the arithmetic of a drop is not
            written twice.
          */}
          <OrdenEstados
            states={states}
            onChange={onChange}
            hueco={theme.spacing.sm}
          >
            <View style={{ gap: theme.spacing.sm }}>
              {states.map((state, index) => (
                <FilaOrdenable
                  key={state.id}
                  id={state.id}
                  index={index}
                  testID={`state-editor-fila-${state.id}`}
                >
                  <FilaEstado
                    state={state}
                    count={counts.get(state.id) ?? 0}
                    asa={
                      <AsaEstado
                        id={state.id}
                        index={index}
                        total={states.length}
                      />
                    }
                    accion={
                      <Papelera
                        state={state}
                        disabled={!canDeleteState(states, index)}
                        onPress={() => borrar(state.id)}
                      />
                    }
                    onPress={() => setEditando(state.id)}
                  />
                </FilaOrdenable>
              ))}
            </View>
          </OrdenEstados>

          {/*
            **Why the last bin is off, in words, and not only greyed.**

            A board with no columns is a board with nowhere to draw a task:
            `stateOf` answers null for every row of it and every one of those rows
            is a card in no column, with nothing in a log and nothing on the screen
            to say why. So the bin is drawn and greyed rather than hidden — a control
            that is not there is a control the person cannot explain, and one that
            is there and says why is a rule. The sentence is under the rows and not
            inside the row so that a row keeps its height whatever the state of the
            board is, which is the same reason `board.stateLimit` sits under the
            "add" row and not in it.
          */}
          {soloUna ? (
            <AppText
              variant="caption"
              tone="subtle"
              style={{ marginTop: theme.spacing.sm }}
            >
              {t("board.cannotDeleteLastState")}
            </AppText>
          ) : null}

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
      ) : pagina === "borrado" ? (
        /*
          **La tercera pagina, y es `StateDeleteSheet` dibujada aqui y no un panel
          propio.** `state` es el flag de "esta pregunta es la que hay" —`null`
          cuando no lo es— y `others` y `counts` son los de la pantalla, de modo que
          los numeros que se leen son los que ya se estaban dibujando en las filas y
          en las pestanas. `onChoose` es `elegirDestino`, que se queda en la pagina
          hasta que la pantalla haya movido las tareas.
        */
        <StateDeleteSheet
          state={columnaBorrada}
          count={columnaBorrada ? (counts.get(columnaBorrada.id) ?? 0) : 0}
          others={otrasColumnas}
          counts={counts}
          onChoose={elegirDestino}
          onClose={() => setBorrando(null)}
        />
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
            <StateColorStrip color={color} onChange={setColor} />
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
 * One column of the board, in the editor: its handle, its dot, its name, how much
 * is in it and its bin.
 *
 * **Three slots and not one pressable**, and the shape was chosen for Task 12
 * before Task 12 existed: the spec's row is *"asa de arrastrar, punto de color,
 * nombre, contador, papelera"*, and `asa` and `accion` are the first and the last
 * of those. Putting them in was passing a node to each — with no change to this
 * component's body, to `styles.fila` or to the pressable's target, which is the
 * reason the two slots were separated in the first place.
 *
 * **The action is a sibling and not a child of the pressable**, which is why the
 * two are separated here and not nested: a pressable inside a pressable needs
 * `stopPropagation()` to not also open the row — `SheetOptionRow` does that and says
 * why — and a column's bin is a control whose whole meaning is that it is *not* the
 * row. As siblings it cannot be. The same is true of the handle, and for the reason
 * `DraggableRow` gives: the drag is on the handle so the row is free to be a
 * button.
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
  /** The drag handle, or `null` while there is none. */
  asa?: ReactNode;
  /** The bin, or `null` while there is none. */
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

/**
 * The column's bin, **and it is drawn on every row whether it works or not.**
 *
 * A control that is not there is a control the person cannot explain: somebody who
 * cannot find a bin on a board of one column has no way of finding out that a
 * column cannot be the last one, and the rule they would guess — "this board
 * cannot be edited" — is the wrong one. So with `states.length === 1` the bin is
 * there, greyed, and the sentence saying why is under the rows.
 *
 * **`disabled` and not `onPress: undefined`**, for the reason `SheetOptionRow`
 * writes at length: a `Pressable` of react-native-web is not always a `<button>`,
 * so "there is no handler" is not the same thing as "it is off", and a bin drawn
 * full strength that does nothing is the version of this that has to be avoided.
 * The opacity is the same 0.4 that component uses, and the reason it is greyed at
 * all is that a control the person can see and cannot press has to look like it.
 */
function Papelera({
  state,
  disabled,
  onPress,
}: {
  state: BoardState;
  /** `canDeleteState`'s answer, asked with the row's index. */
  disabled: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const t = useTranslation();

  return (
    <Pressable
      testID={`state-editor-bin-${state.id}`}
      accessibilityRole="button"
      /**
       * **The column's name is in the label and not only its drawing**, for the
       * reason `Button`'s `iconOnly` documents: an icon with no name is a control
       * nobody can use, and on a board of four columns a drawing is not a name. It
       * is the same phrase the delete sheet puts in its title, so what is announced
       * on the way in and what is announced on arrival say the same thing.
       */
      accessibilityLabel={t("board.deleteState", { name: state.title })}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.bin,
        { opacity: disabled ? 0.4 : pressed ? 0.7 : 1 },
      ]}
    >
      <Ionicons name="trash-outline" size={18} color={theme.colors.danger} />
    </Pressable>
  );
}

/**
 * What the rows share while one of them is being dragged, **and who commits the
 * move.**
 *
 * **It is `DraggableSort` from `draggable-row.tsx` in everything but its row**, and
 * saying why is the whole of this block. That component's provider holds the same
 * three shared values and the same `gap`; its row draws a **card** —its own fill,
 * its own shadow, a handle absolutely positioned on the **right**— and the spec's
 * row here is *"asa de arrastrar, punto de color, nombre, contador, papelera"*, so
 * the handle is a flex sibling on the left and there is no card around the row.
 * Its provider cannot be borrowed either: `SortContext` is private to that module
 * and the row cannot be used as it is, so the shape is written here.
 *
 * **What is not rewritten is the arithmetic.** `dropIndex` and `rowShift` are
 * imported from `lib/lists/drag-shift.ts`, they are pure, they have tests, and they
 * are already what the three reorder lists of this app decide a drop with — the
 * one that got wrong once (`rowHeight` against `rowHeight + gap`) is the reason
 * they are imported rather than copied.
 *
 * **The commit lives here and not on the handle**, for the reason `borradorRef` on
 * the board screen writes about: `onEnd` runs from a gesture, a gesture outlives
 * the render that made it for as long as the UI thread holds it, and reading the
 * draft out of a closure that may be one edit old is how a panel that renames two
 * columns writes one of them. So the provider is given this render's `states` and
 * `onChange` and the worklet is only told "you were dropped on `hasta`".
 *
 * **On the UI thread and not through React state**, for the reason `DraggableSort`
 * gives: a drag fires an update per frame and a state change per frame is a render
 * of every row per frame. Reading a shared value in an animated style costs a style
 * recalculation and not a render.
 */
interface EstadoOrden {
  /** The column being dragged, or null. */
  arrastrada: SharedValue<string | null>;
  /** Where it was when the finger went down. */
  desde: SharedValue<number>;
  /** Where it would land if the finger lifted now. */
  hasta: SharedValue<number>;
  /**
   * How far the finger has gone, in points, **and the row being dragged follows it
   * exactly.**
   *
   * Snapping the dragged row to a grid instead would mean the finger and the row
   * disagreeing by half a row for the whole drag and the gap opening somewhere
   * other than where the row is — which is the note on `DraggableRow`'s
   * `translateY` and the reason it is a raw translation and not a destination.
   */
  desplazamiento: SharedValue<number>;
  /**
   * The distance from one row to the next.
   *
   * **A distance and not a height**, and the note on `DraggableSort`'s `rowHeight`
   * is the reason: `dropIndex` divides how far the finger has gone by this to know
   * how many rows it has passed, so a number that is only the height leaves every
   * row further down short, and on a board of a dozen columns the drop lands more
   * than a row away from the gap that opened for it.
   */
  paso: SharedValue<number>;
  /** The space the caller leaves between rows, written down once. */
  hueco: number;
  /** Commit: the column at `desde` goes to `hasta`. */
  mover: (desde: number, hasta: number) => void;
}

const ContextoOrden = createContext<EstadoOrden | null>(null);

/**
 * The provider above the rows. It is the only thing that knows `hueco`, and it is
 * the only thing that knows how to write.
 */
function OrdenEstados({
  states,
  onChange,
  hueco,
  children,
}: {
  states: BoardStates;
  onChange: (states: BoardStates) => void;
  /** The space the layout below leaves between rows, which is `spacing.sm`. */
  hueco: number;
  children: ReactNode;
}) {
  const arrastrada = useSharedValue<string | null>(null);
  const desde = useSharedValue(0);
  const hasta = useSharedValue(0);
  const desplazamiento = useSharedValue(0);
  const paso = useSharedValue(PASO_POR_DEFECTO);

  /**
   * `onChange` in a ref and not closed over, and the reason is on
   * `EstadoOrden`: `onEnd` is reached from a gesture that outlives the render which
   * made it, so a closure would be reading the draft of one edit ago. The screen
   * holds the truth and this is the way to it.
   */
  const alCambiar = useRef(onChange);
  alCambiar.current = onChange;
  const arrayActual = useRef(states);
  arrayActual.current = states;

  const mover = useCallback((origen: number, destino: number) => {
    const actual = arrayActual.current;
    /**
     * **The clip, and it is the load-bearing half of this whole file.**
     *
     * `dropIndex` already clamps to `total - 1`, and this is the second of the two
     * guards: the accessibility actions below hand over `index ± 1`, and `index + 1`
     * on the last row is `states.length`, where `nextOrderFromDrop` answers with the
     * very array it was given — **a column that moves without moving**, a gesture
     * with no effect and no error. `dropTargetIndex` in `drag.ts` clips the same
     * way for the lists of items; this is the third reader of the same rule and it
     * is written where the call happens so that a fourth way of computing a
     * destination cannot come in without it.
     */
    const to = Math.max(0, Math.min(destino, actual.length - 1));
    const siguiente = moveState(actual, origen, to);
    /** By identity, like the other three: a drag that went nowhere writes nothing. */
    if (siguiente !== actual) alCambiar.current(siguiente);
  }, []);

  const value = useMemo(
    () => ({ arrastrada, desde, hasta, desplazamiento, paso, hueco, mover }),
    [arrastrada, desde, hasta, desplazamiento, paso, hueco, mover],
  );

  return <ContextoOrden.Provider value={value}>{children}</ContextoOrden.Provider>;
}

/**
 * One row that can be dragged, and the rows around it move out of the way while
 * the finger is still down.
 *
 * **A wrapper and not a change to `FilaEstado`**, which is what lets the row stay
 * the way Task 11 left it: this owns the two animated styles and the `onLayout`,
 * and everything anybody can see of the row is the child it draws untouched.
 * `testID` is on the wrapper so a walkthrough can find a row without knowing that
 * there are two boxes in it, and `state-editor-row-<id>` stays on the pressable
 * inside where it has always been.
 */
function FilaOrdenable({
  id,
  index,
  testID,
  children,
}: {
  id: string;
  index: number;
  testID: string;
  children: ReactNode;
}) {
  const theme = useTheme();
  const orden = useContext(ContextoOrden);

  /** Whether **this** row is the one being dragged, read on the UI thread. */
  const soyLaArrastrada = useDerivedValue(
    () => (orden?.arrastrada.value ?? null) === id,
    [orden, id],
  );

  /**
   * The row being dragged follows the finger and is the one that is lifted.
   *
   * **It is above the others only while it is being dragged**, and the fill is the
   * theme's own `surfaceMuted` — the same one a pressed row uses, so "resaltada
   * mientras se mueve" does not introduce a third state of a row that already had
   * two.
   */
  const estiloArrastre = useAnimatedStyle(() => {
    const yo = soyLaArrastrada.value;
    return {
      transform: [{ translateY: yo ? (orden?.desplazamiento.value ?? 0) : 0 }],
      zIndex: yo ? 1 : 0,
      backgroundColor: yo ? theme.colors.surfaceMuted : "transparent",
    };
  });

  /**
   * Every other row between where it was and where it would land moves one place,
   * **and this is `rowShift`, imported and not reimplemented.**
   */
  const estiloHueco = useAnimatedStyle(() => ({
    transform: [
      {
        translateY: orden
          ? rowShift({
              draggingId: orden.arrastrada.value,
              id,
              index,
              from: orden.desde.value,
              to: orden.hasta.value,
              rowHeight: orden.paso.value,
            })
          : 0,
      },
    ],
  }));

  return (
    <Animated.View
      testID={testID}
      onLayout={(event) => {
        const alto = event.nativeEvent.layout.height;
        // Measured as the distance to the next row and not as the height: see
        // `EstadoOrden`'s `paso`.
        if (orden && alto > 0) orden.paso.value = alto + orden.hueco;
      }}
      style={[
        { borderRadius: theme.radius.md, userSelect: "none" },
        estiloHueco,
        estiloArrastre,
      ]}
    >
      {children}
    </Animated.View>
  );
}

/**
 * The handle of one row, **and the drag is on it and not on the row.**
 *
 * `DraggableRow` says at length why: a pan on the whole row takes the long press
 * that the rest of this app uses to read a name that does not fit, and it makes
 * every row a drag target by accident while a finger slides down the list. On the
 * handle the drag is where the drawing says it is and it starts with the first
 * movement, with no delay to wait out and nothing to disarm.
 *
 * **Its width is `DRAG_HANDLE_WIDTH`, imported and not written**, and that is the
 * point of importing it: it is the one number in this app that means "how wide a
 * drag handle is", and a handle here a different width from the one on the reorder
 * sheet would be two things to look at instead of one. **Its height is the row's
 * own**, and no `minHeight` is written here: the row is already `48`
 * (`styles.cuerpo`) and this stretches to it.
 *
 * **The whole gesture is here and not on `FilaOrdenable`**, and they are one
 * gesture rather than two: this writes every shared value the row's animated styles
 * read — `arrastrada`, `desde`, `hasta`, `desplazamiento` — and commits on `onEnd`.
 * The row does the moving. Two `Gesture.Pan`s claiming the same finger would be a
 * race for it, and the one on the row would win, because the row is the bigger
 * target.
 */
function AsaEstado({
  id,
  index,
  total,
}: {
  id: string;
  index: number;
  total: number;
}) {
  const theme = useTheme();
  const t = useTranslation();
  const orden = useContext(ContextoOrden);
  const pista = useA11yHint(t("items.dragHint"));

  /**
   * Where the row goes when the finger lifts, **asked of `dropIndex` and not
   * counted here.** That function clips to `total - 1`, which is the first of the
   * two guards against the silent no-op; the second is in `OrdenEstados`'s `mover`.
   */
  const gesto = Gesture.Pan()
    // A couple of points of slop, so a tap on the handle is a tap and a drag is a
    // drag, and nothing in between. `DraggableRow`'s number and its reason.
    .minDistance(2)
    .onStart(() => {
      if (!orden) return;
      orden.arrastrada.value = id;
      orden.desde.value = index;
      orden.hasta.value = index;
      orden.desplazamiento.value = 0;
    })
    .onUpdate((event) => {
      if (!orden) return;
      orden.desplazamiento.value = event.translationY;
      orden.hasta.value = dropIndex({
        index,
        total,
        translationY: event.translationY,
        rowHeight: orden.paso.value,
      });
    })
    .onEnd(() => {
      if (!orden) return;
      runOnJS(orden.mover)(orden.desde.value, orden.hasta.value);
      orden.arrastrada.value = null;
      orden.desplazamiento.value = withTiming(0, SOLTAR);
    })
    .onFinalize(() => {
      if (!orden) return;
      orden.arrastrada.value = null;
      orden.desplazamiento.value = withTiming(0, SOLTAR);
    });

  return (
    <GestureDetector gesture={gesto}>
      {/*
        **El asa es un hijo del detector y el detector tiene un solo hijo**, que es
        el aviso de `cdp.mjs`: un `GestureDetector` con dos hijos compila, pasa
        todas las pruebas y revienta en cuanto se dibuja el panel. Por eso la caja
        lleva `pista.node` **dentro** en vez de al lado.
      */}
      <View style={styles.asa}>
        <Pressable
          testID={`state-editor-asa-${id}`}
          accessibilityRole="button"
          accessibilityLabel={t("items.dragToReorder")}
          {...pista.props}
          /*
            **Moving a column without dragging it**, because a drag is the one
            gesture nobody can do with a screen reader or with a switch. Increment
            and decrement are the two names the platform already has for "this goes
            up" and "this goes down", and they land on the same commit the finger
            does, through the same `mover`, which clips — so `index + 1` on the last
            row is not a move that does nothing.
          */
          accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
          onAccessibilityAction={(event) => {
            if (!orden) return;
            if (event.nativeEvent.actionName === "increment") {
              orden.mover(index, index - 1);
            }
            if (event.nativeEvent.actionName === "decrement") {
              orden.mover(index, index + 1);
            }
          }}
          style={({ pressed }) => [styles.asaDentro, { opacity: pressed ? 0.7 : 1 }]}
        >
          <Ionicons name="reorder-two" size={18} color={theme.colors.textMuted} />
        </Pressable>
        {pista.node}
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  /**
   * The row, **and it is a box and not the pressable itself**, because there are
   * three things in it and two of them must not be the row: the handle and the bin.
   * Its `gap` is the theme's `md`, the same twelve the inner row uses
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
  /**
   * The handle, **and its width is `DRAG_HANDLE_WIDTH` and not a number.**
   *
   * It is the one constant in this app that means "how wide a drag handle is", and
   * importing it is what keeps this handle and the one on the reorder sheet the same
   * size. The height is not here: the row is already `48` (`styles.cuerpo`) and
   * `alignSelf: 'stretch'` gives the handle all of it, so there is no second
   * measurement to keep in step with the row's.
   */
  asa: {
    width: DRAG_HANDLE_WIDTH,
    /*
     * `alignSelf: "stretch"` y no una altura, **y la primera version de este asa no
     * lo tenia**: media en la caja de arriba y medida en **20 puntos de alto** en el
     * recorrido, que es el alto del glifo. La fila mide 48 —`styles.cuerpo`— y el
     * asa tiene la de la fila entera, sin un numero mas que mantener al dia.
     */
    alignSelf: "stretch",
  },
  /** El pulsable dentro, y ocupa todo el asa: 40 de ancho por el alto de la fila. */
  asaDentro: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  /**
   * The bin, **and it is a square that follows the row's height** for the same
   * reason the handle's height is not written: a target of 48 is the smallest
   * height a control in this app is given as a number, and the row already has it.
   */
  bin: {
    width: DRAG_HANDLE_WIDTH,
    alignSelf: "stretch",
    alignItems: "center",
    justifyContent: "center",
  },
});

/**
 * How long a dragged row takes to go back to its place, **and it is a timing and
 * not a spring.**
 *
 * `DraggableRow` says why at length: a spring overshoots by arithmetic, and the one
 * it had — `withSpring(0, { damping: 18, stiffness: 220 })` — was bouncing every
 * row on every drop. `withTiming` cannot pass its target. The number is that
 * component's, and it is imported nowhere because a timing is not something two
 * modules can share without becoming a second thing to forget.
 */
const SOLTAR = { duration: 170, easing: Easing.out(Easing.cubic) } as const;

/**
 * What the pitch of the list is before a row has been measured.
 *
 * **Sixty-four is `DraggableRow`'s number and not one chosen here**, and its reason
 * is the same: a drag that divides by a row height nobody has measured yet lands
 * where nothing was. A board's rows are 48 tall with an 8-point gap, so the first
 * `onLayout` replaces this in the frame the panel is drawn.
 */
const PASO_POR_DEFECTO = 64;
