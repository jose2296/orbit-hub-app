import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import type { BoardState, BoardStates } from "@orbit-hub/contracts";

import { AppText } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { pluralKey, useTranslation } from "@/lib/i18n";
import { iconColor } from "@/lib/lists/item-icons";
import { useTheme } from "@/theme";

export interface StateDeleteSheetProps {
  /**
   * The column being deleted, **and `null` when this page is not the one on
   * screen.**
   *
   * **It is a page and not a panel of its own, and that is a measured decision and
   * not a preference** — the plan asks for a second `Modal` and building it that way
   * was tried and measured first. The numbers are in the note on the component and
   * the screenshot is `13-hoja-de-borrado-claro.png` de la corrida que las dio.
   */
  state: BoardState | null;
  /** How many tasks this column has, **the ones with a null `stateId` included.** */
  count: number;
  /** The columns that are left to send them to, **and not one of them is computed.** */
  others: BoardStates;
  /** How many tasks each of those has, from the same map the editor rows draw. */
  counts: Map<string, number>;
  /**
   * The destination, and the person chose it.
   *
   * **The page never picks one and never has a default marked.** "Where do these
   * seven tasks go" is a decision about somebody's work, and a default accepted by a
   * tap is a decision nobody made: the tasks end up in a column that was drawn with
   * a tick on it and never read. So the confirm button is off until a row has been
   * pressed, which is the same rule `state-picker-sheet` follows for its own create
   * button.
   */
  onChoose: (destinationId: string) => void;
  /**
   * Back to the list of columns, **and it does not close the panel.**
   *
   * The panel's own `X` and its pull-down are the panel's, and they go through the
   * editor's `onClose`, which writes the draft once. A page that closed the panel
   * would need to be honest about not writing, and there is nowhere else to put a
   * draft that was not written — the same reason `state-editor-back` is a page.
   */
  onClose: () => void;
}

/**
 * Where the tasks of a column that is about to be deleted go, and the one question
 * this page asks.
 *
 * **It is a page of `state-editor-sheet` and not a second `Modal`, and it was a
 * second `Modal` first.** The plan fixes this component's signature at
 * `state: BoardState | null`, which is the signature of an always-mounted `Sheet` —
 * `state-picker-sheet.tsx` carries `item: ListItem | null` and the same
 * `useLastValue` — so it was built as its own panel, mounted last on the board
 * screen, and **medido con el mismo instrumento de `scripts/verify-state-editor.mjs`**
 * con el muestreo instalado antes de la pulsación.
 *
 * Lo que salió, en esa corrida:
 *
 * - **Dos `sheet-dim` y dos `sheet-panel` durante los 617 ms de los 905 medidos, en 38
 *   fotogramas de 56** — y no durante una ventana como en los relevos de las Tareas 10
 *   y 11, que son dos paneles con **uno que se va**. Aquí no se va ninguno.
 * - **El editor salió en el portal #6 y la hoja de borrado en el #5**, o sea que el
 *   editor pinta encima, y `elementFromPoint` devolvió `editor#6` en los **38 de 38**
 *   fotogramas de la ventana, **tanto en el punto de fondo como en el centro del
 *   panel que entraba**.
 * - En la captura `13-hoja-de-borrado-claro.png` se ve el resultado: el panel del
 *   editor dibujado encima de la hoja de borrado, cuyo título se lee *a través* del
 *   blanco del otro. Y la pulsación siguiente —una fila de destino— **no hizo nada**:
 *   el botón de confirmar siguió apagado y no se encoló ninguna operación.
 *
 * **El mecanismo está leído en el código y medido en su consecuencia.**
 * `ModalPortal` de react-native-web **añade su `div` a `body` en el primer render del
 * `Modal`, no la primera vez que se vuelve visible** (`ModalPortal.js`: el
 * `appendChild` está en el cuerpo del componente, fuera de cualquier `if`). Los
 * otros tres paneles de esta pantalla **sí** se montan más tarde que él, porque cada
 * uno se niega a dibujarse mientras no tiene nada (`if (!tablero) return null`, y lo
 * mismo en los otros dos), así que su portal se crea la primera vez que se abren, y
 * el orden de `body` lo fija ese primer render y no se vuelve a ordenar. El panel que
 * nunca se niega a dibujarse **gana el puesto de más abajo sin haber estado abierto
 * nunca**.
 *
 * **Lo que no se ha medido:** nativo, y una pantalla de ancho de móvil. Y **lo que no
 * se arregla aquí**: que el índice lo ponga `ModalPortal` y el orden de pintado lo
 * ponga el orden de los hijos de `body`, y ninguno de los dos ficheros es de esta
 * tarea. Podríaarse con una línea —`if (!borrada) return null`— y esa línea se ha
 * mirado antes de descartarla: **se lleva por delante la animación de salida**, que
 * es el fallo de cuarenta y cinco sobre doscientos cuarenta milisegundos que
 * `useLastValue` existe para que no pase, y en este camino la salida es justo el
 * momento en que la persona quiere ver el tablero otra vez.
 *
 * **Lo que cuesta la página, dicho sin adornos:** las columnas no están en pantalla
 * mientras se pregunta, y con veinticuatro columnas la pregunta es un panel que se
 * desplaza. A cambio hay **un velo, un panel y ninguna ventana**: el bloque 10 del
 * recorrido lo comprueba, y comprueba que no hay ventana porque si la hubiera la
 * comprobación caería.
 *
 * **Lo que decide es nada.** Cuáles filas van es `tasksInState` dentro de
 * `deleteStatePlan`, con el destino escrito para cada una —el orden y las nulas están
 * en `lib/lists/board.ts` y en sus tests—. Esta página dibuja las columnas que le
 * dio la pantalla, con los números que contó la pantalla, y devuelve un id.
 */
export function StateDeleteSheet({
  state,
  count,
  others,
  counts,
  onChoose,
  onClose,
}: StateDeleteSheetProps) {
  const theme = useTheme();
  const t = useTranslation();

  /**
   * The destination, **and `null` until somebody presses a row.**
   *
   * **No hay un efecto que lo vuelva a poner a `null` al abrirse, y no hace falta:**
   * el panel dibuja esta pagina con una ternaria (`pagina === "borrado" ? … : …`),
   * asi que **cada vez que se abre es un montaje nuevo** y el `useState` nace a `null`.
   * Un efecto aqui no solo no haria nada: se leeria como si protectsera de un fallo
   * que la estructura ya no puede tener, y el fallo que de verdad ocurrio en este
   * camino fue el contrario —una pregunta que se quedaba puesta de la vez anterior
   * cuando la pagina era un `Modal` con `useLastValue`, y eso es un problema de
   * montarla para siempre, no de este `useState`.
   */
  const [destino, setDestino] = useState<string | null>(null);

  /*
    `state === null` **no sale nada y no es un panel vacio**, and the editor only
    draws this page when it is not null, so the branch is the belt to that door
    rather than the only one — the same shape `state-editor-sheet` uses for
    `readOnly`.
  */
  if (!state) return null;

  return (
    <View style={{ gap: theme.spacing.md }}>
      {/*
        Which column, **said before anything else.** The panel's title is "Editar
        los estados del tablero", which is true here and says nothing about which
        column the question is about — so the column's name is the first line of the
        page, and it is also the row's own `aria-label` in the sheet's own title on
        the way in.
      */}
      <AppText variant="heading" numberOfLines={1}>
        {t("board.deleteState", { name: state.title })}
      </AppText>

      {/*
        How many, **in words and not only as a number.** A page that said "7" and a
        column of twenty-three destinations gives somebody no way to know what they
        are agreeing to move.
      */}
      <AppText variant="body" tone="muted">
        {t(pluralKey("board.deleteStateTasks", count), { count })}
      </AppText>

      {/*
        The destinations. **One press is the whole decision**, so a destination is a
        row of its own with its dot, its name and its count — the same three things a
        row of this editor draws and in the same order, so the eye compares the two
        instead of reading a new panel. The chosen one is a fill, the way
        `state-picker-sheet` marks the column a task is in.
      */}
      <View style={{ gap: theme.spacing.xs }}>
        {others.map((otra) => (
          <FilaDestino
            key={otra.id}
            state={otra}
            count={counts.get(otra.id) ?? 0}
            elegida={otra.id === destino}
            onPress={() => setDestino(otra.id)}
          />
        ))}
      </View>

      <Button
        testID="state-delete-confirm"
        label={t("board.deleteStateConfirm", { name: state.title, count })}
        variant="danger"
        icon="trash-outline"
        disabled={destino === null}
        fullWidth
        onPress={() => {
          if (destino === null) return;
          onChoose(destino);
        }}
      />

      {/*
        **What happens, said before it happens.** Deleting a column is the only edit
        in this panel that cannot be taken back with the next press, and this
        sentence is the one thing that tells somebody the tasks are moved rather than
        deleted — which is the difference between "Eliminar" and "a dónde van estas
        siete tareas".
      */}
      <AppText
        variant="caption"
        tone="subtle"
        style={{ marginTop: theme.spacing.sm }}
      >
        {t("board.deleteStateWarning", { count })}
      </AppText>

      {/*
        **The way back, and it goes to the column list and not out of the panel** —
        the same reason, and the same button, as `state-editor-back`.
      */}
      <Button
        testID="state-delete-back"
        label={t("common.back")}
        variant="ghost"
        fullWidth
        onPress={onClose}
      />
    </View>
  );
}

/**
 * One destination, in the same shape as a row of the editor and a row of the
 * picker: its dot, its name and how much is in it.
 *
 * **In its own component because the hint hook cannot be called once per row inside
 * a loop**, the same reason `state-picker-sheet`'s row is — and there is no hint
 * here because the whole row is the button and the count is in its label.
 */
function FilaDestino({
  state,
  count,
  elegida,
  onPress,
}: {
  state: BoardState;
  count: number;
  /** Whether this is the destination the person pressed. */
  elegida: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const t = useTranslation();

  /** The count said and not printed, because a screen reader has to hear it too. */
  const dicho = t(pluralKey("lists.itemCount", count), { count });

  return (
    <Pressable
      testID={`state-delete-destino-${state.id}`}
      accessibilityRole="button"
      /*
       * The chosen destination in words, and not only as a tick: the argument
       * `state-picker-sheet` makes for its own current column, and the same
       * measurement behind it — react-native-web writes no `aria-selected` from
       * `accessibilityState` for a button, and a tick is invisible to a screen
       * reader.
       */
      accessibilityLabel={
        elegida
          ? `${state.title}, ${dicho}, ${t("board.stateHere")}`
          : `${state.title}, ${dicho}`
      }
      onPress={onPress}
      style={({ pressed }) => [
        styles.fila,
        {
          gap: theme.spacing.md,
          paddingVertical: theme.spacing.md,
          paddingHorizontal: theme.spacing.md,
          borderRadius: theme.radius.md,
          backgroundColor:
            elegida || pressed ? theme.colors.surfaceMuted : "transparent",
        },
      ]}
    >
      {/* The colour of the column, as the dot the editor rows and the picker rows
          both draw: three shapes of one size, so the eye matches a row here to a
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
        The number has **its own `testID`**, for the reason the editor's row gives:
        a row read as `innerText` is "Titulo · 2", and a walkthrough that cuts that
        string in two is easier to break on a two-digit count than on a single one.
      */}
      <AppText
        variant="caption"
        tone="subtle"
        testID={`state-delete-destino-count-${state.id}`}
      >
        {count}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  /**
   * The row of a destination, **and its height is a target and not a type size.**
   *
   * Forty-eight is the number `state-picker-sheet` and `state-editor-sheet` both set
   * their rows to, and it is `Button` at its middle size. This page is the third of
   * the three and a row whose height is whatever its contents happen to be is a row
   * whose target moves when its number grows from one digit to two.
   */
  fila: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 48,
  },
  /**
   * The name gives up its width before the count does.
   *
   * The trap `board-column.tsx` writes about for its own header: on the web
   * `react-native-web@0.21.2` writes `flexShrink: 0` on every `View`, so a column
   * called "Waiting for review" pushed its count off the right edge. `minWidth: 0`
   * lets the name narrow to one line instead of the row widening.
   */
  nombre: {
    flex: 1,
    minWidth: 0,
  },
  /**
   * Ten points, and it is the only size written by hand in this file: it is the
   * shape of a dot and the theme has no token that means "how big is a dot". **It
   * is the same ten as `board-tabs.tsx`, `board-column.tsx`,
   * `state-picker-sheet.tsx` and `state-editor-sheet.tsx`, and being the same ten
   * is the whole reason it is written by hand** — a dot that matched nothing else on
   * the screen would be one more thing to look at.
   */
  punto: {
    width: 10,
    height: 10,
  },
});