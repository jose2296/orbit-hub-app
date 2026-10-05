import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { MAX_BOARD_STATES, stateOf } from "@orbit-hub/contracts";
import type { BoardState, BoardStates, ListItem } from "@orbit-hub/contracts";

import { AppText } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { Sheet, useLastValue } from "@/components/ui/sheet";
import { TextField } from "@/components/ui/text-field";
import { pluralKey, useTranslation } from "@/lib/i18n";
import { iconColor } from "@/lib/lists/item-icons";
import { useTheme } from "@/theme";

export interface StatePickerSheetProps {
  /**
   * The task being moved, or `null` when the sheet is closed.
   *
   * **`null` is how this sheet is closed, not a value it draws**, and the two are
   * kept apart below: the last task there was is what is on screen while `visible`
   * is false. That is `useLastValue` and the reason for it is in `sheet.tsx` — a
   * sheet that unmounts with its argument takes the exit animation with it, and
   * the dismissal was measured at forty-five milliseconds of a quarter of a second.
   */
  item: ListItem | null;
  states: BoardStates;
  /** How many tasks each column has, built by the screen with `countInState`. */
  counts: Map<string, number>;
  readOnly: boolean;
  /** Move the task to a column and write it. */
  onPick: (stateId: string) => void;
  /** Create a column **and** move the task into it. One tap, two writes. */
  onCreate: (title: string) => void;
  /**
   * Opens the panel of **this** task, and it is a separate prop from
   * `onEditStates` because they are two different editors: one is about the task
   * (name, description, urgency, labels, icon) and the other is about the board's
   * columns.
   *
   * **And it is here at all because the card's own press is this sheet.** The spec's
   * sentence is *"Tocar la tarjeta abre la hoja de estado"* ("Mover de estado"), so a
   * tap on a board card opens this panel and not the task panel — and the only other
   * target on a card is the icon, which `TaskRow` draws **only when the task has
   * one** (`item.icon ? … : null`), and `icon` is `null` for every task created in
   * the app. So without this link the description, the urgency and the labels of an
   * icon-less board task have no route at all, and the spec says the description
   * *"vive en la hoja de edición"*: it would live nowhere.
   */
  onEditTask: () => void;
  /** Opens the editor that renames, colours, reorders and deletes columns. */
  onEditStates: () => void;
  onClose: () => void;
}

/**
 * Which column a task is in, and everything a task can be moved to.
 *
 * **It is a `Sheet` mounted for good and not a conditional one**, and the reason is
 * in `useLastValue` and in `list-menu-sheet.tsx`, which says it better than this
 * does: the panel travels a quarter of a second on its way out, and a sheet taken
 * out of the tree in the frame the dismissal is asked for never travels at all.
 * `pedido` is the caller's argument and goes to `null` at once; `tarea` is what is
 * drawn, and it holds.
 *
 * **What it decides is nothing.** It draws the columns the screen gave it, with the
 * numbers the screen counted, and hands every press straight back: which column the
 * task is really in is `stateOf`, whether the move is worth an operation is
 * `stateIdToWrite`, and the two writes of «+ Nuevo estado…» are the screen's. A
 * picker that resolved things for itself would be a second implementation of every
 * rule `lib/lists/board.ts` already owns with tests — and the rules it would
 * reimplement are the ones that fail silently.
 */
export function StatePickerSheet({
  item: pedido,
  states,
  counts,
  readOnly,
  onPick,
  onCreate,
  onEditTask,
  onEditStates,
  onClose,
}: StatePickerSheetProps) {
  const theme = useTheme();
  const t = useTranslation();
  const tarea = useLastValue(pedido);

  /**
   * The column the task is drawn in, **and it is `stateOf` and not
   * `item.stateId`.** A task created on a board carries `null`, and one whose column
   * another device deleted carries an id this board does not have; both are drawn in
   * the first column, so comparing the raw value marks the wrong row and leaves the
   * row that is really in the first column unmarked. Same rule, same reason, and it
   * is the reason `board.ts` never compares `stateId` against a column id.
   */
  const actual = stateOf(states, tarea?.stateId ?? null)?.id ?? null;

  /** Whether the board is at the cap, which is `MAX_BOARD_STATES` and not a number of our own. */
  const alTope = states.length >= MAX_BOARD_STATES;

  /**
   * Whether the sheet is open, **asked of the caller's argument and not of
   * `tarea`.** This is the edge everything about mounting hangs off, and the two
   * are not the same value: `tarea` is frozen while the sheet is closed, on
   * purpose, so that it keeps drawing the task it was showing while it travels
   * down the screen.
   */
  const abierto = pedido !== null;

  /** Whether the field for a new column is open, and what has been typed in it. */
  const [escribiendo, setEscribiendo] = useState(false);
  const [nombre, setNombre] = useState("");

  /**
   * Reopening always starts closed and empty, and the key is **the sheet being
   * open** and not the task.
   *
   * The same trap `list-menu-sheet.tsx` writes about at length: `tarea` freezes
   * while `pedido` is `null` — freezing is its whole purpose — so keying on it does
   * not fire when the same task is opened twice, and the second time the sheet comes
   * up with the last column's name still in the field. A half-typed name waiting for
   * whoever comes next is a sheet that looks like it lost its place.
   */
  useEffect(() => {
    if (!abierto) return;
    setEscribiendo(false);
    setNombre("");
  }, [abierto]);

  /**
   * One press, two writes: the column is created and the task goes into it.
   *
   * The title arrives **trimmed and checked here**, before `onCreate` is called at
   * all, and the reason is not tidiness: the states travel as a single field of the
   * list, so one unnamed column makes the contract refuse the **whole array** and
   * every later save of that board with it. A board whose columns cannot be saved
   * is worse than one that did not get a fifth column.
   *
   * The cap is not re-checked here either — `alTope` has already greyed the row
   * out — but `newState` answers `null` for it on the other side and the screen
   * writes nothing when it does. Two checks of one rule, on the two sides of a
   * boundary, and the visible one is this one.
   */
  function crear() {
    const titulo = nombre.trim();
    if (titulo.length === 0 || alTope) return;
    onCreate(titulo);
    onClose();
  }

  /**
   * Choosing a column asks the screen and closes.
   *
   * **`onPick` first and `onClose` after**, which is what the brief asks for and
   * what makes the two halves of one press safe: the screen's handler reads the
   * task out of this same render's closure, and a close that came first would not
   * change that — React batches, so `pedido` is still this task until the next
   * render. It is written this way because it reads as one gesture instead of two,
   * and the order is not load-bearing the other way round.
   *
   * Picking the column the task is already in is not special-cased here: it closes
   * like any other press and the screen writes nothing, because "is it already
   * there?" is `stateIdToWrite`'s question and not this sheet's.
   */
  function elegir(stateId: string) {
    onPick(stateId);
    onClose();
  }

  /*
    `readOnly` **does not draw this sheet**, and that is the whole of the answer.
    Not "draws it empty": a viewer of a board is not somebody who has to be shown
    a control that will not work, and an empty panel with four columns in it and
    nothing they can press is the worst version — it is the shape of a bug. The
    screen also does not mount the component at all (that is the half of it that
    this file cannot do), so this branch is the second of the two doors rather than
    the only one.

    **It is after the hooks and not before them**, because a branch above them
    changes the order the hooks run in, and React answers that with a crash on the
    very first render where the answer is different.
  */
  if (readOnly) return null;
  if (!tarea) return null;

  return (
    <Sheet
      visible={abierto}
      onClose={onClose}
      title={tarea.title}
      subtitle={t("board.move")}
      scrollable
    >
      <View style={{ gap: theme.spacing.sm }}>
        {states.map((state) => (
          <FilaEstado
            key={state.id}
            state={state}
            count={counts.get(state.id) ?? 0}
            actual={state.id === actual}
            onPress={() => elegir(state.id)}
          />
        ))}
      </View>

      {/*
        The new column, **and it is not a field that is always there.** A board with
        four columns opens with four rows and one line under them; the field appears
        on the press. That is the difference between "there is one more thing you
        can do here" and "this panel is a form", and the second one is what a picker
        with a text box in it looks like.
      */}
      <View style={{ gap: theme.spacing.sm, marginTop: theme.spacing.sm }}>
        <Pressable
          testID="state-picker-new"
          accessibilityRole="button"
          accessibilityLabel={t("board.newState")}
          disabled={alTope}
          onPress={() => setEscribiendo(true)}
          style={({ pressed }) => [
            styles.nueva,
            {
              gap: theme.spacing.md,
              paddingVertical: theme.spacing.md,
              paddingHorizontal: theme.spacing.md,
              borderRadius: theme.radius.md,
              opacity: alTope ? 0.4 : pressed ? 0.7 : 1,
            },
          ]}
        >
          {/*
            Eighteen points, **and it is `sheet.tsx`'s number and not one chosen
            here.** The row that draws it is the same kind of row as the options of
            `SheetOptionRow` — a pressable in a panel with a glyph at its left — and
            that component draws its glyph at eighteen and its tick at eighteen too.
            A twenty here was the draft's own number; it is not a second scale, it
            is a second *value* for a scale that already has one, and the row below
            with the tick is the reason to change it.
          */}
          <Ionicons
            name="add-circle-outline"
            size={18}
            color={theme.colors.accent}
          />
          <AppText variant="body" style={{ color: theme.colors.accent }}>
            {t("board.newState")}
          </AppText>
        </Pressable>

        {/*
          **Why the button is off, in words, and not only greyed.**

          The cap is a limit the app can only find out by failing — the contract
          refuses the twenty-fifth state — and a limit discovered that way is a
          column that appears and then comes back gone on the next pull. So the edge
          is named where the button is, and `MAX_BOARD_STATES` is the number it says
          rather than a twenty-four written next to it, because a second copy of a
          limit is a second thing to forget when the limit moves.
        */}
        {alTope ? (
          <AppText variant="caption" tone="subtle">
            {t("board.stateLimit", { max: MAX_BOARD_STATES })}
          </AppText>
        ) : null}

        {escribiendo ? (
          <View style={{ gap: theme.spacing.sm }}>
            <TextField
              testID="state-picker-name"
              label={t("board.newStateName")}
              value={nombre}
              onChangeText={setNombre}
              autoFocus
              selectTextOnFocus
              returnKeyType="done"
              onSubmitEditing={crear}
            />
            <Button
              testID="state-picker-create"
              label={t("items.add")}
              icon="checkmark"
              disabled={alTope || nombre.trim().length === 0}
              fullWidth
              onPress={crear}
            />
          </View>
        ) : null}
      </View>

      {/*
        **Two doors, and both of them underneath and not instead**: this panel
        answers "which column", the task's own panel answers "what this task is" and
        the states editor answers "what columns are there". A board at the cap has no
        way to add one from here, so the door to rearranging them has to be on the
        sheet somebody opens when they want to move a card — and the door to the
        description has to be there too, because **this sheet is what a tap on a card
        opens** and a card has no other target unless it has an icon.

        **Neither is a second sheet**: two panels on one screen are two backdrops,
        and a press that reaches the wrong one closes what is under it instead of
        doing what was asked. That is the argument in `list-menu-sheet.tsx` for making
        share, rename and delete pages of one panel.

        **Both close this one on the way out**, in the order `exportar` there uses:
        the panel leaves and the next thing arrives behind it. **What that leaves on
        screen was measured, not assumed** — 233 ms with two `sheet-dim` and two
        `sheet-panel` in the document, y el comentario de `onEditTask` de abajo tiene
        los numeros, el mecanismo y lo que NO se ha medido.

        The task panel is **above** the states editor and not below it: it is about
        the thing the sheet is open for, and the other one is about the board. That
        is the only ordering decision here and it is a preference, not a
        measurement.
      */}
      <View style={{ gap: theme.spacing.sm, marginTop: theme.spacing.md }}>
        {/*
          The task's own panel, **and this is the door that did not exist.** A tap on
          a board card opens this sheet — that is the spec's sentence — so the card's
          only other target, the icon, is the only road to the description, the
          urgency and the labels, and `TaskRow` draws that icon **only when the task
          has one** (`item.icon ? … : null`, and `icon` is `null` on every task
          created in the app). For an icon-less task the road ended here.

          **It is a row of this sheet and not a second target on the card** for the
          same reason `onEditStates` is not: two panels on one screen are two
          backdrops, and the second sheet is the list screen's own `ItemEditSheet`,
          which knows about tags, icon colours and the description field. A card
          with one more glyph on it would be a control that says "edit" on something
          whose name and picture live three centimetres away from it.

          **`onEditTask` before `onClose`, and the order is not what decides — the two
          land in the same commit either way.** What decides is what is on screen during
          the exit, and **that is measured, not argued**: the outgoing sheet stays
          mounted for `SALIDA + 90` = 330 ms (`sheet.tsx:230`), so for **233 ms, in 15
          of the 43 frames sampled, there are two `sheet-dim` and two `sheet-panel` in
          the document** (`scripts/verify-state-picker.mjs`, block `1c`, which samples
          from inside the gesture with a `requestAnimationFrame` installed before the
          press).

          Inside that window the arriving panel is the **last child of `body`** —
          `ModalPortal` appends one div per modal — so it paints above the outgoing dim
          and does not read darker for sitting over it. And the topmost element under a
          backdrop point is the arriving sheet's on every frame **but the first**, where
          it is the outgoing one: one frame, ~16 ms, and the reason is in the library
          (`ModalAnimation.js:67` paints its wrapper as `{ opacity: 0 }`, with no
          `position` and no `z-index`, until its `useEffect` sets `isRendering`, while
          the outgoing modal keeps `visible={montada}` and stays in the `z-index: 9999`
          layer). Its cost is nothing measurable: the outgoing sheet has already been
          asked to close, so asking twice changes nothing, and the arriving panel is
          still 91% of its height below where it will be.

          **Not measured: native, and a phone-width sheet.** All of it is the web at
          1440 x 900, where `Sheet` draws a centred dialog.

          The order stays because no alternative is better on the numbers and all three
          cost more — cutting the outgoing sheet leaves the background at zero for a
          frame or two before the arriving dim ramps, deferring it does the same later,
          and dropping its dim takes the composite to 0.62 → 0.30 → 0.62. What is left
          is the background going from 0.62 to 0.66 for about 100 ms.

          The screen reads the task out of its own state —not out of the `item` this
          sheet was handed— and it does it in the same commit, so it still has it.
        */}
        <Button
          testID="state-picker-edit-task"
          label={t("board.editTask")}
          variant="ghost"
          icon="create-outline"
          fullWidth
          onPress={() => {
            onEditTask();
            onClose();
          }}
        />
        <Button
          testID="state-picker-edit"
          label={t("board.editStates")}
          variant="ghost"
          icon="options-outline"
          fullWidth
          onPress={() => {
            onEditStates();
            onClose();
          }}
        />
      </View>
    </Sheet>
  );
}

/**
 * One column of the picker, in its own component because the hint hook cannot be
 * called once per row inside a loop.
 */
function FilaEstado({
  state,
  count,
  actual,
  onPress,
}: {
  state: BoardState;
  count: number;
  /** Whether this is the column the task is drawn in. */
  actual: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const t = useTranslation();

  /**
   * The count, **exactly as the screen counted it.**
   *
   * **The current column's number includes the task being moved, and it is not
   * corrected.** Choosing that column changes nothing — `stateIdToWrite` writes no
   * operation for it — so a number that said "3" there and "4" everywhere else
   * would be describing a board that does not exist yet. The number people want is
   * "how many are in this column", and the answer to that is four, this task
   * included. A picker that quietly subtracted one would have to be right about
   * which task is which and would still be answering a different question.
   */
  const dicho = t(pluralKey("lists.itemCount", count), { count });

  return (
    <Pressable
      testID={`state-picker-row-${state.id}`}
      accessibilityRole="button"
      /*
        The chosen column in words and not only as a tick. The same argument
        `sheet.tsx` makes for its own trailing control, and the same measurement:
        `react-native-web@0.21.2` writes no `aria-selected` from
        `accessibilityState` for a button — a button is not an option — so a tick is
        all a screen reader would ever be told, and a tick is invisible to it.
      */
      accessibilityLabel={
        actual ? `${state.title}, ${dicho}, ${t("board.stateHere")}` : `${state.title}, ${dicho}`
      }
      onPress={onPress}
      style={({ pressed }) => [
        styles.fila,
        {
          gap: theme.spacing.md,
          paddingVertical: theme.spacing.md,
          paddingHorizontal: theme.spacing.md,
          borderRadius: theme.radius.md,
          // The current column is **the same row with a fill under it**, and not a
          // different row: same height, same place, same dot, so the eye compares
          // the two lists instead of finding a differently-shaped thing to read.
          backgroundColor:
            actual || pressed ? theme.colors.surfaceMuted : "transparent",
        },
      ]}
    >
      {/* The colour of the column, as the dot the tab strip and the column header
          also draw: three shapes of one size, so the eye matches a row here to a
          column there and to a pill above. */}
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
        The number has its own `testID`, and **that is not decoration for a
        check**: a fila is "Titulo · 2 · " mas el glifo del check en la fila marcada,
        asi que un recorrido que lo lea del `innerText` tiene que trocear una cadena
        con un glifo dentro — y el numero sale `NaN` en la fila marcada y no en las
        demas, que es el peor sitio posible para que se rompa. El id lo pone el
        mismo `testID` de la fila, con el sufijo `-count`.
      */}
      <AppText
        variant="caption"
        tone="subtle"
        testID={`state-picker-count-${state.id}`}
      >
        {count}
      </AppText>
      {actual ? (
        <Ionicons name="checkmark" size={18} color={theme.colors.accent} />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  /**
   * The row of a column, **and its height is a target and not a type size.**
   *
   * Forty-eight is `Button` at its middle size — `button.tsx`'s `dimensions.md` —
   * and the `minHeight` of `TextField`. It is the smallest height a control in
   * this app is given as a number, which is why a row that is pressed with a
   * thumb while the other hand holds the board is worth setting explicitly.
   *
   * **`SheetOptionRow` does not set one** and that is not a counter-example: its
   * height comes out of `paddingVertical` and the text inside it, which lands
   * under forty-eight on a short row. This one is set because the row it is has
   * two trailing pieces — a count and a tick — and a row whose height is whatever
   * its contents happen to be is a row whose target moves when the number in it
   * grows from one digit to two.
   */
  fila: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 48,
  },
  nueva: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 48,
  },
  /**
   * The name gives up its width before the number does.
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
   * the same ten as `board-tabs.tsx` and `board-column.tsx`, and **being the same
   * ten is the whole reason it is written by hand** — a dot that matched nothing
   * else on the screen would be one more thing to look at.
   */
  punto: {
    width: 10,
    height: 10,
  },
});
