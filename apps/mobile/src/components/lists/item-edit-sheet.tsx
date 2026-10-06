import { Ionicons } from "@expo/vector-icons";
import { Fragment, useEffect, useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, View } from "react-native";

import type {
  BoardStates,
  IconRef,
  ListItem,
  Priority,
  TagColors,
} from "@orbit-hub/contracts";
import { derivedTagColor, labelOf } from "@orbit-hub/contracts";
import { stateOf } from "@orbit-hub/contracts";

import { AppIcon } from "@/components/ui/app-icon";
import { Badge, tonesFor } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useA11yHint } from "@/components/ui/a11y-hint";
import { IconPickerPanel } from "@/components/ui/icon-picker-sheet";
import { Sheet } from "@/components/ui/sheet";
import { useSheetSucio } from "@/components/ui/sheet-sucio";
import { AppText } from "@/components/ui/text";
import { TextField } from "@/components/ui/text-field";
import { useFieldChain } from "@/lib/forms/field-chain";
import { useListItems } from "@/hooks/use-lists";
import { pluralKey, useTranslation } from "@/lib/i18n";
import { FIELD_LIMITS } from "@/lib/lists/field-limit";
import {
  PRIORITY_TONE,
  tagsByFrequency,
} from "@/lib/lists/item-presentation";
import { stateIdToWrite, stateColorHex } from "@/lib/lists/board";
import { useTheme } from "@/theme";

import { completedMatch } from "@/lib/lists/done-match";
import { mismoIcono } from "@/lib/icons/icon-change";
import { ITEM_ICON_COLORS } from "@orbit-hub/contracts";
import { ICON_COLOR_LABEL } from "@/theme/tokens";
import type { IconColor } from "@orbit-hub/contracts";
import { TagChip } from "./tag-chip";
import { TagColorPicker } from "./tag-color-picker";

type Page = "edit" | "icon" | "tags";

const PRIORITIES: Priority[] = ["none", "low", "medium", "high"];

export interface ItemEditSheetProps {
  /** The row being edited, or `null` when the sheet is closed or creating. */
  item: ListItem | null;
  listId: string;
  /**
   * `create` opens the same panel with nothing in it and writes the row when you
   * press save. It is the same panel and not a second one because the fields are
   * the same fields, and two panels for one row is how they stop agreeing about
   * what a row can have.
   */
  mode?: "edit" | "create";
  /**
   * El titulo con el que arranca la hoja cuando esta creando.
   *
   * Viene de "crea esto con lo que estaba buscando". Escribir el nombre dos
   * veces —una en el buscador y otra en el formulario— es la accion que hace que
   * alguien que no encuentra algo no llegue a crear el.
   *
   * Solo cuando `mode` es `create`: en editar manda el item.
   */
  initialTitle?: string;
  /** The page to open on, so a tap on the icon goes straight to the icons. */
  startOn?: Page;
  /**
   * Whether this list has a "done" at all, and **the board is the one that does
   * not.**
   *
   * A task on a board is in a state and not completed — that is the whole reason a
   * board is a `kind` of its own — so the tick is not drawn here either. It is a
   * prop and not a branch on the kind because this panel does not read the list's
   * kind anywhere else, and adding one would make it depend on a field it has no
   * other reason to want.
   *
   * What it costs to leave it on is not that the tick fails: `completed` is a real
   * field and the write succeeds. It is that **nothing on a board reads it**, so
   * pressing it looks like it worked and the board is identical afterwards — the
   * same reason `TaskRow` does not draw a checkbox for a board row.
   */
  showCompleted?: boolean;
  /** This list's chosen label colours, and the only ones there are. */
  tagColors: TagColors;
  /**
   * Called with the colour chosen for a label, or `null` for the one that sends
   * it back to the colour deduced from its name.
   *
   * It lands on the list and not on the task, which is why the signature has no
   * task in it: one write recolours every row that carries the label.
   *
   * **It may hand back the write, and nobody waits for it** — hence
   * `void | Promise<void>`, so a caller with nothing to wait for can ignore it.
   * It is only called once, on Guardar, once per label that changed: the panel
   * paints from its draft in the meantime (see `coloresVistos`), so the tap reads
   * as answered in the frame that answered it, and choosing never writes.
   *
   * **One call per changed label, in series, and that is the whole ordering.**
   * `volcarColores` awaits each one before starting the next, so two colours
   * never plan from the same map and the second never eats the first.
   */
  onTagColor: (tag: string, color: string | null) => void | Promise<void>;
  onClose: () => void;
  /** Called after the row is gone, so the screen can put itself right. */
  onDeleted?: () => void;
  /**
   * The columns of a board, **and `[]` on every other kind of list.**
   *
   * This panel does not read the list's kind anywhere else — see `showCompleted`,
   * which is a prop for the same reason and says so at length — and a column is
   * the second thing that is only true of a board. So the row is drawn when this
   * is not empty and not drawn when it is, and a list that is not a board cannot
   * get one by accident.
   */
  states?: BoardStates;
  /**
   * Asked for when the column row is pressed, **so this panel opens no sheet of
   * its own.**
   *
   * The sheet that lists the columns is mounted by the screen, next to this one,
   * and always mounted — it is the same `Sheet` the board mounts for the tap that
   * used to open it, and `useLastValue` is why that one is never unmounted. Two
   * reasons it stays there and does not come in here: a `Modal` inside a `Modal`
   * is a nesting that only has to work on both targets to be worth it, and this
   * panel is used by every list in the app, so the board's sheet would become a
   * dependency of all of them.
   */
  onOpenStates?: () => void;
  /**
   * Called with the column chosen in that sheet.
   *
   * **It is not written straight to the row from here.** It goes through `save`,
   * which is the one door this panel already has to a write: on a row that exists
   * that is an immediate update, and on one being written it goes into the draft
   * and leaves with the rest when the row is created. A second path to
   * `updateItem` would be two paths that can disagree about when a column changes.
   */
  onPickState?: (stateId: string) => void;
  /**
   * The column chosen for the row being written, **`null` for "none was chosen".**
   *
   * It lives in the screen and not in this panel because the sheet that chooses
   * it is mounted by the screen as well: the choice travels sheet → screen →
   * panel, and a copy kept here would be two answers to "which column was
   * chosen" that can disagree. On a row that exists this is ignored — its column
   * is the row's own, read live — so it is only read in create mode.
   */
  draftStateId?: string | null;
}

/**
 * Whether two sets of labels are the same, **and not whether they are in the same
 * order**.
 *
 * The order tags were added in is not part of what somebody meant to say. Somebody
 * who adds "urgente" after "casa" and somebody who adds "casa" after "urgente"
 * wrote the same task, and a panel that said "you have unsaved changes" for that
 * is teaching people to ignore the warning.
 */
function sameLabels(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const m = new Set(b);
  return a.every((tag) => m.has(tag));
}

/**
 * Whether two colour maps say the same, **key by key**.
 *
 * `null` and absent are both "derived", so both count as the same as each other:
 * somebody who picks a colour and then goes back to derived has not changed
 * anything, and the question must not pretend otherwise.
 */
function sameColors(
  a: Record<string, string | null>,
  b: TagColors,
): boolean {
  const claves = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const clave of claves) {
    if ((a[clave] ?? null) !== ((b as Record<string, string>)[clave] ?? null)) {
      return false;
    }
  }
  return true;
}

/** What a row being written looks like before it exists. */
interface Draft {
  title: string;
  annotation: string | null;
  priority: Priority;
  icon: IconRef | null;
  tags: string[];
  /** Whether it is done, which also lives here and **not** on the row. */
  completed: boolean;
}

const EMPTY_DRAFT: Draft = {
  title: "",
  annotation: null,
  priority: "none",
  icon: null,
  tags: [],
  completed: false,
};

/**
 * Everything you can do with one row, in one panel.
 *
 * It exists because the row used to be tapped and *deleted*: the title was a
 * button wired to the delete, with no confirmation and no way back. A tap that
 * loses work is the worst thing a list can do, and it is worse than a missing
 * feature because you find out after you wanted it.
 *
 * So a tap opens this, and the delete is a red button at the bottom, with the
 * name of the thing in it, after everything else. The icon and the labels are
 * pages of this same panel and not panels of their own, for the reason the rest
 * of the app has: a panel on top of a panel is two backdrops over one screen,
 * and a tap that reaches the wrong one closes what is underneath instead of
 * doing what was asked.
 *
 * It is also the only place a priority can be set, which is what makes ordering
 * a list by priority mean anything: an order you cannot choose a value for is an
 * order that is always the same order.
 */
export function ItemEditSheet({
  item,
  listId,
  mode = "edit",
  initialTitle = "",
  startOn = "edit",
  showCompleted = true,
  tagColors,
  onTagColor,
  onClose,
  onDeleted,
  states = [],
  onOpenStates,
  draftStateId = null,
}: ItemEditSheetProps) {
  const theme = useTheme();
  const t = useTranslation();
  const { items, updateItem, removeItem, addItem, toggleCompleted } =
    useListItems(listId);
  const isNew = mode === "create";
  const [page, setPage] = useState<Page>(startOn);
  const [title, setTitle] = useState(item?.title ?? "");

  /*
   * Solo dos, y no tres: el tercer `TextField` de la hoja es el de anadir una
   * etiqueta, y vive en otra pagina con su propio boton y su propio `done`. Encadenar
   * un campo que no esta a la vista con otro que si esta es un salto que atraviesa
   * una pagina.
   *
   * Y el segundo es `multiline`: su ENTER es un salto de linea y no se encadena
   * con nadie, que es lo correcto para un cuerpo de nota.
   */
  const cadena = useFieldChain(2);
  const [annotation, setAnnotation] = useState(item?.annotation ?? "");
  const [newTag, setNewTag] = useState("");
  /*
   * Which label has its picker open, and one at a time: two open would be two
   * squares, two hue strips and two hex fields on one panel, and the second one is
   * not where anybody was looking.
   *
   * It is the *label* and not a boolean, so the two rows of labels —the ones
   * this task carries and the ones the list already has— can share it and a
   * label that lives in one of them opens from there. A label cannot be in both,
   * which is what `labels` filters out.
   */
  const [colorDe, setColorDe] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);

  /*
    Los colores de las etiquetas, y **tambien en borrador**.

    `tagColors` viene por props —es de la lista, no de la tarea— y hasta ahora
    `pickColor` lo escribia al instante por `onTagColor`. Eso era la ultima puerta
    por la que el panel guardaba solo: cambiabas el color de una etiqueta, salias
    sin pulsar Guardar, y el color se quedaba puesto.

    Asi que el borrador es un mapa con **solo lo cambiado**: `null` significa
    "vuelto al deducido" y ausente significa "igual que estaba". Al confirmar se
    vuelca la diferencia por `onTagColor`, en serie y no en paralelo — que es lo
    que hacia `guardando` antes, y sin el dos escrituras planificaban desde la misma
    lista y la segunda se comia a la primera.
  */
  const [colores, setColores] = useState<Record<string, string | null>>({});

  /*
   * The colour chosen for a label that **does not exist yet**, and the whole of why
   * it is here instead of in `tagColors`: there is no label to write it on. It is
   * not written until the name is pressed add, because until then there is nothing
   * in the map it could be a value of — `tagColors` is keyed by label name, and a
   * key for a name nobody has typed is a colour that no row can ever show.
   */
  const [pendiente, setPendiente] = useState<string | null>(null);

  /*
   * The pending colour goes when the name goes, and **this is the only place that
   * says so**: without a name there is no label for a colour to belong to, and a
   * colour left hanging off a name that no longer exists cannot be read back by
   * anybody — not by the picker, whose `tag` is now `undefined`, and not by the
   * map, because the map never had the key.
   *
   * **On the trimmed name and not on the raw field**: a trailing space is still
   * "Alcampo", the label `addTag` will create is `newTag.trim()`, and a colour that
   * survives a space it is going to keep is the useful behaviour.
   */
  const nombreNuevo = newTag.trim();
  useEffect(() => {
    if (nombreNuevo === "") setPendiente(null);
  }, [nombreNuevo]);

  // Reopening always starts where the tap asked to start, on a fresh copy of
  // what the row has now and not on what it had when the panel was created.
  //
  // **The dependency is the row's `id` and not the row**, and that is the whole
  // difference between "the panel opens where the tap asked" and "the panel
  // throws you out of the page you are on every time anything is written".
  //
  // `items` is re-read from the cache on every local write, and it returns new
  // objects every time, so with `item` in the dependency list this effect ran
  // again on every write — and `setPage(startOn)` is a *reset to where the tap
  // asked*, which for someone who got here by pressing the name of the row is
  // `"edit"`, not the labels page they had just opened. Choosing a label's colour
  // writes the list, so every colour chosen dumped the panel back on the first
  // page and coloured labels cost three taps each.
  //
  // Nothing of this changes when a row is edited while the panel is open: the
  // panel has its own draft (`title`, `annotation`) and reads the rest live, and
  // `item` changing identity is not a reason to reset which page a person is on.
  const idDelItem = item?.id ?? null;
  useEffect(() => {
    if (!item) return;
    setPage(startOn);
    setTitle(item.title);
    setAnnotation(item.annotation ?? "");
    setNewTag("");
    // Y los colores del borrador, por el mismo motivo que el resto: el panel se
    // queda montado al cerrarse, y sin esto la siguiente tarea abre con los
    // colores que se tocaron en la anterior.
    setColores({});
    // And the picker with it: `colorDe` is state of this component and the panel
    // stays mounted while it is closed (it returns `null` rather than being
    // unmounted), so a panel closed with a picker open came back with that same
    // picker open, pointing at a label the person had not asked about this time.
    setColorDe(null);
    // And the pending colour, which belongs to the name that was just cleared.
    setPendiente(null);
  }, [idDelItem, startOn]);

  // Creating always starts empty, every time it is opened.
  useEffect(() => {
    if (isNew) {
      setPage("edit");
      setTitle("");
      setAnnotation("");
      setNewTag("");
      setTitle(initialTitle);
      // `setNewTag("")` on a field that is already empty changes nothing, so React
      // drops it and the effect on `nombreNuevo` never fires. That is why the
      // pending colour is cleared here as well and not only there.
      setPendiente(null);
      setDraft(EMPTY_DRAFT);
      setColores({});
    }
  }, [isNew, initialTitle]);

  /** What the panel is showing, whether the row exists yet or not. */
  const shown: Draft = isNew
    ? { ...draft, title, annotation: annotation || null }
    : {
        title: item?.title ?? "",
        annotation: item?.annotation ?? null,
        priority: item?.priority ?? "none",
        completed: item?.completed ?? false,
        icon: item?.icon ?? null,
        tags: item?.tags ?? [],
      };

  /** The labels already used in this list, so a new row reuses the old ones. */
  const labels = useMemo(
    () => tagsByFrequency(items).filter(({ tag }) => !shown.tags.includes(tag)),
    // The list of labels the row has, as one string: `shown` is rebuilt on every
    // render, so depending on the array itself would re-filter on every tick of
    // anything, and the filter is not free with a hundred rows in the list.
    [items, shown.tags.join("|")],
  );

  /**
   * The done row this new one is about, if any.
   *
   * Only in create mode: offering to un-done a row you are already editing is a
   * button about a different row.
   */
  const yaHecho = isNew ? completedMatch(title, items) : null;

  /**
   * Whether this row belongs to a board, **and it is the columns that say so.**
   *
   * A row that has been given no columns is a row of a list, and the answer is
   * `false` without asking anything else: `states` is `[]` everywhere but a board,
   * and a board always has at least one column (`boardStatesSchema` refuses an
   * empty one).
   */
  const esTablero = (states?.length ?? 0) > 0;

  /**
   * The column this row is in, **and the resolved one.**
   *
   * A row whose `stateId` is `null` is drawn in the first column, and one that
   * names a column another device deleted is drawn there too — that is what
   * `stateOf` answers and what the board's own columns already do. So the row
   * says the first column rather than "nowhere": saying nowhere would draw a
   * panel that disagrees with the board behind it, and the first column is where
   * the row is.
   *
   * On a row being written there is no row to read, so the screen's choice is
   * read instead (`draftStateId`, `null` for "none was chosen") — and it resolves
   * through the same function, so "none was chosen" reads as the first column,
   * which is where the row will land if it is created untouched. **Which is
   * honest**: the row is not claiming a choice was made.
   */
  const columna = esTablero
    ? (stateOf(states ?? [], isNew ? (draftStateId ?? null) : (item?.stateId ?? null)) ?? null)
    : null;

  const pistaIcon = useA11yHint(t("itemEdit.iconHint"));
  const pistaTags = useA11yHint(t("itemEdit.tagsHint"));
  const pistaEstado = useA11yHint(t("itemEdit.stateHint"));
  const pistaMarkDone = useA11yHint(t("itemEdit.markDoneHint"));
  /*
   * One hint for every colour button on this panel, and not one per label: it
   * says what the button opens, and what it opens does not change with the label.
   * The label is already in the button's own `accessibilityLabel`, which is where
   * the name belongs.
   */
  const pistaColor = useA11yHint(t("tags.backToDerived"));

  /**
   * The colour a label is painted in right now.
   *
   * The chosen one if there is one and the deduced one if there is not, and
   * **never nothing**: there is no state in which a label has no colour, which is
   * why this has no `?? undefined` branch and why the same expression is in
   * `TagChip`. It is here because the button that opens the picker has to *say*
   * the colour out loud, in the words the dictionary has for it.
   */
  /*
    El color que el panel enseña para una etiqueta, y **sale del borrador primero**.

    Sin esto, elegir un color y ver el viejo hasta pulsar Guardar es un panel que
    miente sobre lo que va a guardar. El `null` del borrador —"vuelto al deducido"—
    se salta a proposito: si llegara al `TagChip` pintaria "sin color", y lo que hay
    que pintar es el deducido.
  */
  const coloresVistos: TagColors = useMemo(() => {
    const vistos: Record<string, string> = { ...tagColors };
    for (const [etiqueta, color] of Object.entries(colores)) {
      if (color === null) delete vistos[etiqueta];
      else vistos[etiqueta] = color;
    }
    return vistos as TagColors;
  }, [tagColors, colores]);

  /*
   * **The colour under the finger, not yet even in the draft, and why the pill
   * follows the drag.**
   *
   * A swatch press lands in the draft at once, but dragging the square or the
   * hue strip only moves the picker's local state until "use this colour" is
   * pressed — so without this the pill keeps its old colour while a new one is
   * already on screen. The picker reports its square through `onPreviewChange`
   * and it lands here, synchronously, in the same commit as the drag.
   *
   * One `{tag, hex}` and not a map, because only one picker is ever open
   * (`colorDe`): a second one cannot start previewing without closing the first.
   * It applies only while its picker is the open one — after closing, the tag no
   * longer matches and the pill falls back to the draft, which is also what
   * "closing without choosing keeps nothing" means. And it paints the pills
   * only, never the picker's `value`: feeding the draft back in would make the
   * picker's own sync effect snap the square back mid-drag.
   */
  const [vistaPrevia, setVistaPrevia] = useState<{ tag: string; hex: string } | null>(null);
  const coloresPintados: TagColors = { ...coloresVistos };
  if (vistaPrevia && vistaPrevia.tag === colorDe) coloresPintados[vistaPrevia.tag] = vistaPrevia.hex;

  const colorOf = (tag: string): string =>
    coloresPintados[tag] ?? derivedTagColor(tag);

  const { setSucio } = useSheetSucio();

  /*
    "Sucio" es **todo el panel**, cada campo con su valor de partida.

    Se comparaba solo con el nombre y la nota, y la justificacion era que elegir
    prioridad o tocar un icono son **pulsaciones** y por tanto se guardan solas.
    Esa distincion la invente yo y no la habia pedido nadie: lo pedido era que
    **nada** se guardara hasta pulsar Guardar.

    Y el argumento, ademas, era falso en la practica: un panel que se guarda a
    medias es un panel del que no se fia uno. Marcas "urgente", cambias el icono,
    escribes dos lineas de nota y pulsas atras, y resulta que la nota no estaba,
    porque "eso era solo texto". Que parte se guarda depende de que campo tocaste,
    y eso no se aprende: se endurece en la cabeza y se acaboicky pulsando Guardar
    siempre, que es el mismo trabajo con dos pasos.

    Asi que ahora todo va al borrador y sale por un unico `updateItem` al Guardar.
    Las etiquetas se comparan **como conjunto y no como lista**, porque el orden en
    que se anotaron no es parte de lo que alguien quiso decir.
  */
  const sucio = useMemo(() => {
    const base = isNew ? EMPTY_DRAFT : item;
    if (!base) return false;
    return (
      title.trim() !== (isNew ? "" : base.title.trim()) ||
      annotation.trim() !== (isNew ? "" : (base.annotation ?? "").trim()) ||
      draft.priority !== (isNew ? "none" : base.priority) ||
      // By value and not by reference: the draft holds what was picked and the
      // row holds what it has, and two objects saying the same icon are the same
      // choice. A reference check would light Guardar up on every opening.
      !mismoIcono(draft.icon, isNew ? null : base.icon) ||
      draft.completed !== (isNew ? false : base.completed) ||
      !sameLabels(draft.tags, isNew ? [] : base.tags) ||
      !sameColors(colores, isNew ? {} : tagColors)
    );
  }, [isNew, item, title, annotation, draft, colores, tagColors]);

  /*
    Los hooks van **antes** del `return null` de mas abajo, y no por estetica.

    Un hook que depende de donde estas en el cuerpo del componente es un hook
    condicional: el dia que la fila tarda un poco mas en llegar, se cambia el
    numero de hooks que se ejecutan y React dice "se cambio el orden de los hooks".
    No es un fallo raro, es el primero que aparece al abrir la hoja por segunda
    vez, que es justo el camino que acabamos de arreglar para que la segunda vez
    funcione.
  */
  useEffect(() => {
    setSucio(sucio);
  }, [sucio, setSucio]);

  if (!isNew && !item) return null;


  /**
   * Un nombre vacio no es un nombre.
   *
   * La fila seria una linea en blanco en la lista, sin nada dentro con que
   * encontrarla otra vez. El motivo se **escribe en el boton** en vez de dejarlo
   * gris y sin texto: un boton apagado sin explicacion se pulsa dos veces para
   * averiguar que no hace nada.
   */
  const sinNombre = title.trim().length === 0;

  /**
   * El unico commit de toda la app para esta fila, y **es una sola escritura**.
   *
   * Todo lo que se haya tocado —el nombre, la nota, la prioridad, el icono, las
   * etiquetas, lo hecho— sale por aqui en un `updateItem` con el borrador entero.
   * Antes eran siete escrituras repartidas por el panel, y por eso perder la nota
   * al cambiar el icono no era un descuido: era la forma normal de funcionar.
   */
  /**
   * Vuelca los colores del borrador a la lista, **en serie**.
   *
   * En serie y no en paralelo, y no por lentitud: `onTagColor` planifica desde la
   * lista que su llamador capturo, asi que dos escrituras a la vez parten del mismo
   * mapa y la segunda se come a la primera sin que ninguna se entere. Era lo que
   * impedia el flag `guardando`, que ya no existe porque ya no hay escrituras
   * concurrentes que impedir — esta es la unica, y va de una en una.
   */
  const volcarColores = async () => {
    for (const [etiqueta, color] of Object.entries(colores)) {
      if ((tagColors[etiqueta] ?? null) === color) continue;
      await onTagColor(etiqueta, color);
    }
  };

  const confirmar = () => {
    if (isNew) {
      void create();
      return;
    }
    /*
      En orden y con el cierre al final, pase lo que pase.

      La tarea va primero y los colores despues, porque la etiqueta tiene que estar
      **en la tarea** antes de que el mapa tenga clave para ella. Y si algo falla,
      igual se intenta cerrar: el "sucio" sigue puesto, asi que cerrar pregunta "lo
      pierdes" en vez de perderlo en silencio.
    */
    void (async () => {
      try {
        await updateItem(item!, {
          // Los dos textos se leen **vivos**, no del borrador: el `setState` de un
          // campo no ha llegado al borrador en este mismo frame, asi que leer el
          // borrador aqui guardaria el nombre de hace un instante.
          title: title.trim(),
          annotation: annotation.trim() || null,
          priority: draft.priority,
          // The whole icon in the one write: colour and drawing travel inside it,
          // and there is no second or third write that could half-land.
          icon: draft.icon,
          tags: draft.tags,
          completed: draft.completed,
        });
        await volcarColores();
      } finally {
        onClose();
      }
    })();
  };

  /**
   * Cambia el borrador. **Y no escribe nada.**
   *
   * Antes esta funcion escribia en la fila cuando la tarea ya existia, y por eso
   * el panel tenia dos velocidades: elegias prioridad y se guardaba al instante,
   * escribias el nombre y se guardaba al salir del campo. Esa distincion la
   * invente yo, y no la habia pedido nadie: lo pedido era que **nada** se guardara
   * hasta pulsar Guardar.
   *
   * Asi que ahora **todas** las puertas del panel pasan por aqui y todas se quedan
   * en el borrador. Prioridad, icono, etiquetas y lo hechoincluded: tocarlos cambia
   * el panel, no la tarea.
   */
  const save = (changes: Partial<Draft>) => {
    setDraft((current) => ({ ...current, ...changes }));
  };

  /**
   * A new label, and its colour if one was chosen for it.
   *
   * **Both land in the draft, and neither is a write.** `save` puts the label on
   * the task's draft tags and the colour goes to the `colores` draft; both leave
   * the panel on Guardar, the task first and the colours right after (see
   * `confirmar`) — the label has to be **on the task** before the map has a key
   * for it, or a sync payload can carry a colour for a label that no row carries
   * and the server would have to decide whether to keep it.
   *
   * **And the checks come before the clears, which is what keeps this from losing
   * colour.** The duplicate check and the read of `pendiente` sit above the two
   * clears, so a tap for a name already on the task leaves the name and the
   * colour where they were instead of clearing both. They sat *after* the clears
   * once, and a tap for a name already there put the label on with no colour and
   * dropped the pending colour with the name, with nothing left to restore it
   * from: `pendiente` had never been in `tagColors`. **The data loss was a
   * consequence of the order**, and what is left is a no-op tap instead of a
   * label without its colour and no trace of the colour anywhere.
   *
   * **The duplicate check sits here for the same reason, and it is not new.** A name
   * already on this task is not a new label, so nothing is written; what used to happen
   * is that the field was cleared first and the colour chosen for it went with the
   * field. The always-visible picker is what makes that sequence likely —type a name,
   * pick a colour, press add, and only then see that the name was already there— and
   * **the label they meant is the pill directly above with its own picker open-able**.
   * So the tap is still a no-op, but it leaves the name and the colour where they were
   * instead of throwing both away.
   */
  const addTag = () => {
    const trimmed = newTag.trim();
    if (!trimmed) return;
    if (shown.tags.includes(trimmed)) return;

    /*
      El color pendiente va **al borrador**, y no a la lista.

      Antes se escribia aqui por `onTagColor`, y era la otra puerta por la que el
      panel guardaba solo. Ahora se queda en `colores` y sale con todo lo demas al
      confirmar — en serie con el resto, que es lo unico que impide que dos
      escrituras partan del mismo mapa.
    */
    const color = pendiente;
    setNewTag("");
    setPendiente(null);

    save({ tags: [...shown.tags, trimmed] });

    // Optional on purpose: with no colour chosen the label comes out **derived**,
    // which is a colour like any other and not a missing one, and nothing is written
    // to `tagColors` for it.
    if (!color) return;
    setColores((previos) => ({ ...previos, [trimmed]: color }));
  };

  /*
   * **Dos acciones y un boton cada una, y por que no son las mismas.**
   *
   * Anadir y quitar son cosas distintas y por eso tienen botones distintos: el `+` de
   * una etiqueta que la tarea **no** tiene, y la papelera de una que **si**. Antes un
   * solo `toggleTag` hacia las dos cosas y el `+` estaba siempre ahi, tambien en las
   * etiquetas que ya tenias —donde pulsarlo te quitaba la etiqueta sin avisar—. Eso es
   * la confusion que se vino a quitar: **un `+` que en unos sitios anade y en otros
   * quita.**
   *
   * La papelera **solo aparece en las etiquetas que la tarea lleva**, y la pastilla
   * **deja de ser pulsable** en esta fila: pulsa el nombre y no pasa nada. Asi no hay
   * dos caminos para quitar la misma etiqueta, y el que queda es el que se ve.
   *
   * Y quitar **esta tarea y solo esta**: las demas tareas de la lista se quedan con
   * la etiqueta, y su color sigue siendo el mismo para ellas. Borrar la etiqueta de
   * toda la lista es otra operacion y no existe —no hay ningun `deleteTag` en el
   * repo, y anadirlo exigiria quitar el nombre de todas las tareas, que el write de
   * item todavia no sabe hacer porque omite `tags` cuando el array queda vacio—.
   */
  const anadirTag = (tag: string) =>
    save({ tags: shown.tags.includes(tag) ? shown.tags : [...shown.tags, tag] });

  const quitarTag = (tag: string) =>
    save({ tags: shown.tags.filter((row) => row !== tag) });

  /**
   * Quitar una etiqueta lo pregunta, y la pregunta **lleva el nombre en el titulo y en
   * el boton**: `tags.removeConfirm` tiene `{name}` en los dos sitios, y por eso los dos
   * se llaman con el. El cuerpo va sin nombre a proposito —`tags.removeConfirmBody`—:
   * es la misma frase para cualquier etiqueta, y repetir el nombre ahi seria la tercera
   * vez en dos lineas.
   */
  const confirmarQuitar = (tag: string) =>
    Alert.alert(
      t("tags.removeConfirm", { name: tag }),
      t("tags.removeConfirmBody"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("tags.removeConfirm", { name: tag }),
          style: "destructive",
          onPress: () => quitarTag(tag),
        },
      ],
    );

  /**
   * A tap on one swatch of a label the task already carries: to the draft, and
   * the picker stays open.
   *
   * `option` is **a hex and not a name from the twelve any more**, because
   * `TagColorPicker` hands back whatever was chosen and a free colour is not one
   * of the twelve. Nothing is written here: the colour lands in the `colores`
   * draft and leaves the panel on Guardar with everything else, in series (see
   * `volcarColores`).
   *
   * Two things are happening here and both were measured, not chosen:
   *
   * - **The paint is synchronous.** The pill is painted from the draft
   *   (`coloresVistos`), so setting it repaints in the same commit as the tap:
   *   the tap has its consequence in the frame that answered it, with nothing
   *   to wait for and no round trip.
   *
   * - **No closing.** The picker used to close on the tap, and closing revealed
   *   the new-label form underneath —tapping a colour read as being thrown out
   *   of editing and into creating a new label. Now choosing a colour is trying
   *   it: the pill follows every tap (and every drag, through the preview), and
   *   the picker closes only on an explicit press, the pencil or "close".
   */
  const pickColor = (tag: string, option: string | null) => {
    // To the draft, synchronously: the pill repaints from it in the same commit.
    // And the picker stays open — closing it here is what used to throw editing
    // out and show the new-label form instead. Only an explicit press (the pencil
    // or "close") takes it down.
    setColores((previos) => ({ ...previos, [tag]: option }));
  };

  /** Writes the row for the first time, with everything the panel was given. */
  const create = async () => {
    const trimmed = title.trim();
    // A row with no name is a blank line you cannot find again, so the button
    // says so instead of writing it.
    if (!trimmed) return;
    await addItem({
      title: trimmed,
      annotation: annotation.trim() || null,
      priority: draft.priority,
      icon: draft.icon,
      tags: draft.tags,
      /*
        **Only sent when a column was chosen**, and even then through
        `stateIdToWrite`: a column another device deleted while this panel was
        open resolves to `null` instead of travelling, because the server refuses
        an item whose `stateId` is not one of its list's `states` — and a refused
        create inside a push that answers 200 is a row that never existed, which
        is worse than a row in the first column. `addItem` leaves anything that is
        not a string off the wire, so a task created without touching the row
        travels exactly as it did before this row existed.
      */
      stateId:
        isNew && esTablero && draftStateId != null
          ? (stateIdToWrite(states ?? [], null, draftStateId) ?? undefined)
          : undefined,
    });
    // Y los colores de las etiquetas que se crearon aqui: sin esto, crear una
    // tarea con una etiqueta de color dejaba la etiqueta sin su color.
    await volcarColores();
    onClose();
  };

  const subtitle =
    page === "icon"
      ? t("itemEdit.iconSubtitle")
      : page === "tags"
        ? t(pluralKey("itemEdit.tagsSubtitle", shown.tags.length), {
            count: shown.tags.length,
          })
        : shown.tags.length > 0
          ? shown.tags.join(" · ")
          : t("itemEdit.subtitle");

  return (
    <Sheet
      visible
      onClose={onClose}
      title={isNew ? t("itemCreate.title") : item!.title}
      subtitle={subtitle}
      // Scrolling on every page, and not only on the icons: with the name, the
      // description, the urgency, the icon, the labels, whether it is done, save
      // and delete, this panel is taller than a phone, and a panel that does not
      // scroll hides its own save button under the bottom of the screen.
      scrollable
      onBack={page === "edit" ? undefined : () => setPage("edit")}
      /*
        El Guardar es **el del pie**, y no el boton que estaba aqui abajo. Dos
        botones de confirmar en la misma pantalla son el mismo boton en el sitio
        donde se busca y en el que no se mira, y el de dentro se va con el
        contenido en una hoja larga.
      */
      onSave={confirmar}
      saveLabel={isNew ? t("itemCreate.create") : t("rename.save")}
      saveDisabledReason={sinNombre ? t("itemEdit.nameNeeded") : undefined}
    >
      <View
        style={{
          gap: theme.spacing.md,
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: theme.spacing.sm,
        }}
      >
        {page === "edit" ? (
          <>
            <TextField
              // Con nombre, para que una prueba pueda escribir en *este* campo y
              // no en el primero que encuentre: la hoja va encima de una
              // pantalla que tambien tiene un campo.
              testID="item-name"
              label={t("itemEdit.name")}
              value={title}
              onChangeText={setTitle}
              /*
                Foco solo al crear, y no al editar.

                Al crear, lo primero que se hace es escribir el nombre: pedir un
                toque antes es un paso por nada. Al editar, lo primero que se hace
                es mirar —marcar hecho, cambiar prioridad— y un teclado que sale
                solo tapa la mitad del panel para nada.
              */
              autoFocus={isNew}
              /*
                **Ya no guarda al salir del campo.**
                Era `onBlur={saveTitle}`, y es la razon de que "se guarda con
                Guardar" no era cierto: los dos campos de texto escribian solos en
                cuanto perdian el foco, sin que nadie hubiera pulsado nada. Con dos
                campos, ademas, se guardaba a mitad de la frase — ibas a escribir
                "llamar al/installador", pulsabas el de abajo, y el servidor ya
                tenia media frase.
              */
              returnKeyType="next"
              selectTextOnFocus={false}
              ref={cadena.register(0)}
              onSubmitEditing={() => cadena.advance(0, () => {
                // Saltar al campo de la nota, que es a donde se sigue. Aqui ya no
                // se guarda nada: el nombre se queda escrito hasta que alguien
                // pulse Guardar, que es lo unico que decide que se guarda.
              })}
              // The width the contracts will store it at, so the counter and the
              // server agree. The title of a task is 300 on purpose, and a list of
              // 300 of them is not a thing anyone writes.
              limit={FIELD_LIMITS['list_item.title']}
              // La clave existed, en los dos idiomas, sin que nadie la usara: un
              // ejemplo de titulo escrito y nunca conectado. Es el campo que mas
              // se abre de la app, asi que es el primero que se nota vacio.
              placeholder={t("items.titlePlaceholder")}
            />

            <TextField
              label={t("itemEdit.description")}
              value={annotation}
              onChangeText={setAnnotation}
              limit={FIELD_LIMITS['list_item.annotation']}
              placeholder={t("itemEdit.descriptionPlaceholder")}
              multiline
              ref={cadena.register(1)}
            />

            {/* The priority, as four things you can see rather than a dropdown of
                words. And it is here, and not in a menu, because ordering a list
                by urgency needs a way to *say* that a thing is urgent.

                **Cada boton con el color de su tono, que es lo que faltaba.** Los
                cuatro se dibujaban con `accent` cuando estaban activos y con
                `surfaceMuted` cuando no, asi que los cuatro salian iguales: se elegia
                a ciegas y lo unico que decia cual estaba elegido era estar pulsado. Y
                el color de una prioridad es justo lo que estas mirando cuando la
                eliges, porque en la lista sale con ese tono —`low` en `info`,
                `medium` en `warning`, `high` en `danger`—: si aqui no se ve, la
                eleccion se hace sin informacion.

                **El tono sale de `PRIORITY_TONE`, el mismo mapa que pinta la insignia
                de la fila, y no de aqui.** Estaba duplicado dentro de `[listId].tsx` y
                este fichero lo hacia de otra manera; ahora los dos leen el mismo, y
                cambiar el color de una prioridad es cambiarlo en un sitio. */}
            <View style={{ gap: theme.spacing.xs }}>
              <AppText variant="caption" tone="subtle">
                {t("itemEdit.priority")}
              </AppText>
              <View style={[styles.row, { gap: theme.spacing.xs }]}>
                {PRIORITIES.map((option) => {
                  const active = option === shown.priority;
                  const tone = PRIORITY_TONE[option];
                  /*
                    **Activo y lleno, inactivo y lavado.** El boton activo se pinta con
                    el relleno del tono y el texto en su color, que es la insignia
                    entera; el inactivo, con el mismo relleno a la repuesta y el mismo
                    texto, para que **la fila se vea como la lista antes y despues de
                    elegir**. El que marca cual esta elegido es el borde, no el color:
                    con el color puesto en los dos, un boton no se distingue del otro
                    por el tono sino por si esta dentro.
                  */
                  const { background: relleno, text: tinta } = tonesFor(
                    theme.colors,
                    tone,
                  );
                  // El borde del boton activo lleva el color del tono, y `tonesFor`
                  // ya lo devolvió como `text`: para `neutral` ese color es
                  // `textMuted` y no existe una entrada `theme.colors.neutral`, asi
                  // que el borde sale de ahi y no de indexar el tema por el tono.
                  const borde = tinta;
                  return (
                    <Pressable
                      key={option}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={t(
                        `items.priority.${option}` as never,
                      )}
                      onPress={() => save({ priority: option })}
                      style={({ pressed }) => [
                        styles.priority,
                        {
                          borderRadius: theme.radius.pill,
                          backgroundColor: relleno,
                          borderWidth: active ? 2 : 0,
                          borderColor: borde,
                          opacity: pressed ? 0.7 : 1,
                        },
                      ]}
                    >
                      <AppText variant="caption" style={{ color: tinta }}>
                        {t(`items.priority.${option}` as never)}
                      </AppText>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {/* Two rows that open a page of this same panel. They are rows and
                not icons alone, because "the picture of the thing" is a label
                and a label is a label. */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("itemEdit.icon")}
              {...pistaIcon.props}
              onPress={() => setPage("icon")}
              style={({ pressed }) => [
                styles.link,
                {
                  borderColor: theme.colors.border,
                  borderRadius: theme.radius.md,
                  backgroundColor: pressed
                    ? theme.colors.surfaceMuted
                    : "transparent",
                },
              ]}
            >
              {/* The row's own icon, in its own colour and its own drawing: what
                  you chose has to be on this row before you go back, or picking
                  a colour is picking a colour blind. */}
              <AppIcon icon={shown.icon} size={20} />
              <AppText variant="body" style={styles.flex}>
                {shown.icon && shown.icon.type === "vector"
                  ? labelOf(shown.icon.value)
                  : t("itemEdit.icon")}
              </AppText>
              <Ionicons
                name="chevron-forward"
                size={16}
                color={theme.colors.textSubtle}
              />
            </Pressable>
            {pistaIcon.node}

            {/*
              The column, **and only on a board.**

              It is a row like the icon and the labels because it is a row: it says
              which column, it opens the sheet that lists them, and it comes back
              with the answer. What is different is that it opens **another panel**
              and not a page of this one — and that is not a shortcut, it is the
              only place the sheet with the columns is mounted from, because the
              screen next to this one owns it (see `onOpenStates`).

              **It is drawn above the labels and not below the delete** because the
              column is the one row on a board that decides where the task is, and
              the row that has to be reachable while deciding the rest of the task.
              A board task's column is as editable as its name.
            */}
            {esTablero && onOpenStates ? (
              <>
                <Pressable
                  testID="item-state-row"
                  accessibilityRole="button"
                  accessibilityLabel={t("itemEdit.state")}
                  {...pistaEstado.props}
                  onPress={onOpenStates}
                  style={({ pressed }) => [
                    styles.link,
                    {
                      borderColor: theme.colors.border,
                      borderRadius: theme.radius.md,
                      backgroundColor: pressed
                        ? theme.colors.surfaceMuted
                        : "transparent",
                    },
                  ]}
                >
                  {/*
                    **The column's own colour, as the dot the board draws beside
                    its name.** `iconColor` is what the column panel, the tabs and
                    this row all call with the column's key, so the dot here is
                    the same colour by construction rather than by a table kept in
                    step by hand — and it is the whole reason this row can be read
                    without opening anything.
                  */}
                  <View
                    style={[
                      styles.stateDot,
                      {
                        backgroundColor: stateColorHex(columna?.color, theme.colors.icon),
                        borderRadius: theme.radius.pill,
                      },
                    ]}
                  />
                  <AppText variant="body" style={styles.flex}>
                    {columna?.title ?? t("itemEdit.stateNone")}
                  </AppText>
                  <Ionicons
                    name="chevron-forward"
                    size={16}
                    color={theme.colors.textSubtle}
                  />
                </Pressable>
                {pistaEstado.node}
              </>
            ) : null}

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("itemEdit.tags")}
              {...pistaTags.props}
              onPress={() => setPage("tags")}
              style={({ pressed }) => [
                styles.link,
                {
                  borderColor: theme.colors.border,
                  borderRadius: theme.radius.md,
                  backgroundColor: pressed
                    ? theme.colors.surfaceMuted
                    : "transparent",
                },
              ]}
            >
              <Ionicons
                name="pricetags-outline"
                size={18}
                color={theme.colors.textMuted}
              />
              <AppText variant="body" style={styles.flex}>
                {t("itemEdit.tags")}
              </AppText>
              {shown.tags.length > 0 ? (
                <AppText variant="caption" tone="accent">
                  {shown.tags.join(" · ")}
                </AppText>
              ) : null}
              <Ionicons
                name="chevron-forward"
                size={16}
                color={theme.colors.textSubtle}
              />
            </Pressable>
            {pistaTags.node}

            {/* Whether it is done, as a thing you can change and not as a badge
                you can only read. A shopping list lives on this: "I already
                bought the milk" puts the row back in the pending section, and
                the only place to say that is the row itself.

                **And not on a board**, where "done" is a state and this write is
                read by nothing — see `showCompleted`. */}
            {!isNew && showCompleted ? (
              <>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("itemEdit.markDone")}
                  {...pistaMarkDone.props}
                  onPress={() => {
                    onClose();
                    save({ completed: !shown.completed });
                  }}
                  style={({ pressed }) => [
                    styles.link,
                    {
                      borderColor: theme.colors.border,
                      borderRadius: theme.radius.md,
                      backgroundColor: pressed
                        ? theme.colors.surfaceMuted
                        : "transparent",
                    },
                  ]}
                >
                  <Checkbox
                    checked={item!.completed}
                    onToggle={() => {
                      onClose();
                      save({ completed: !shown.completed });
                    }}
                    label=""
                  />
                  <AppText variant="body" style={styles.flex}>
                    {item!.completed
                      ? t("itemEdit.putBack")
                      : t("itemEdit.markDone")}
                  </AppText>
                  {item!.completed ? (
                    <Badge label={t("itemEdit.done")} tone="success" />
                  ) : null}
                </Pressable>
                {pistaMarkDone.node}
              </>
            ) : null}

            {/* Un botón de guardar, y no solo "se guarda al salir del campo".
                Un campo que se guarda al salir es un campo que pierde lo que
                escribiste si cierras el panel sin tocar en ninguna parte: el
                evento de salir no llega, y lo escrito se va con el panel. */}
            {yaHecho ? (
              <View
                style={{ gap: theme.spacing.xs }}
                testID="done-match"
              >
                <AppText variant="caption" tone="muted">
                  {t("itemCreate.alreadyDone", { name: yaHecho.title })}
                </AppText>
                <Button
                  testID="done-match-action"
                  label={t("itemCreate.putBack", { name: yaHecho.title })}
                  icon="arrow-undo-outline"
                  variant="secondary"
                  fullWidth
                  onPress={() => {
                    onClose();
                    void toggleCompleted(yaHecho);
                  }}
                />
              </View>
            ) : null}

            {/*
              Y aqui **ya no hay ningun boton de guardar**.

              Estaba este y ahora esta el del pie del panel, que es el mismo en las
              veinticuatro hojas. Dos botones de confirmar en la misma pantalla son
              el mismo boton en el sitio donde se busca y en el que no se mira.

              Y el `testID="item-create"` no se ha perdido: se ha movido al boton
              del pie, que ahora es el que crea. Un `testID` que desaparece hace
              fallar la prueba **por lo que arregla**, que es la forma mas
              confusa de romper algo.
            */}

            {/* Last, red, and it says what it is going to take with it. A row
                being created has nothing to delete yet. */}
            {!isNew ? (
              <View
                style={{ gap: theme.spacing.xs, marginTop: theme.spacing.sm }}
              >
                <Button
                  label={t("itemEdit.delete")}
                  icon="trash-outline"
                  variant="danger"
                  fullWidth
                  onPress={() => {
                    onClose();
                    void removeItem(item!);
                    onDeleted?.();
                  }}
                />
                <AppText variant="caption" tone="subtle">
                  {t("confirm.irreversible")}
                </AppText>
              </View>
            ) : null}
          </>
        ) : null}

        {page === "icon" ? (
          <IconPickerPanel
            current={shown.icon}
            onSelect={(next) => {
              // One write with the whole icon, and not three that could
              // half-land: the colour and the drawing travel inside it.
              save({ icon: next });
            }}
          />
        ) : null}

        {page === "tags" ? (
          <View style={{ gap: theme.spacing.md }}>
            {/* The labels this task carries. Each one is a `TagChip` —the same
                pill the row draws, in the same colour, because the colour is the
                list's and not this panel's— with the two things you can do to it
                inside it: take it off, or give it a colour.
                `alignItems: "center"` stays on this row, and it is **not** what
                keeps a pill from stretching when the row wraps: every pill carries
                its own `alignSelf: "flex-start"`, and a child's `align-self` wins
                over the row's `alignItems`. It stays as the default for whatever
                else is dropped on this row without an `alignSelf` of its own, and
                because the list row builds its line of pills the same way. */}
            <View
              style={[styles.row, { gap: theme.spacing.xs, flexWrap: "wrap" }]}
            >
              {shown.tags.map((tag) => (
                <Fragment key={tag}>
                  <TagChip tag={tag} colors={coloresPintados} testID={`tag-pill-hoja-${tag}`}>
                    {(ink) => (
                      <>
                        {/*
                          **La papelera de esta fila quita sin preguntar, y el motivo
                          es que aqui no hay ambiguedad.** Esta fila solo lista etiquetas
                          que la tarea lleva —es su propio contenido—, asi que la `x` es
                          la unica accion que la pastilla puede tener y no hay nada que
                          pueda leerse como "anadir". La de la fila de abajo, que esta
                          entre el `+` y el pencil, si lo pregunta: ahi el boton cambia
                          de signo segun si la tarea lleva la etiqueta, y un signo que
                          cambia merece un aviso. Preguntar en las dos seria hacer al
                          usuario confirmar algo que acaba de ver en pantalla.
                        */}
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={t("tags.remove", { name: tag })}
                          hitSlop={8}
                          onPress={() => quitarTag(tag)}
                          style={({ pressed }) => [
                            styles.chipAction,
                            {
                              borderRadius: theme.radius.pill,
                              opacity: pressed ? 0.7 : 1,
                            },
                          ]}
                        >
                          <Ionicons name="close" size={11} color={ink} />
                        </Pressable>
                        <TagColorButton
                          tag={tag}
                          color={colorOf(tag)}
                          open={colorDe === tag}
                          ink={ink}
                          hintProps={pistaColor.props}
                          onPress={() => setColorDe(colorDe === tag ? null : tag)}
                        />
                      </>
                    )}
                  </TagChip>
                  {colorDe === tag ? (
                    <View style={styles.anchoCompleto}>
                      <TagColorPicker
                        tag={tag}
                        value={coloresVistos[tag] ?? null}
                        onChange={(hex) => void pickColor(tag, hex)}
                        onPreviewChange={(hex) =>
                          setVistaPrevia((previa) =>
                            previa?.tag === tag && previa?.hex === hex ? previa : { tag, hex },
                          )
                        }
                        onClose={() => setColorDe(null)}
                      />
                    </View>
                  ) : null}
                </Fragment>
              ))}
            </View>

            {/* The labels already used in this list, with how many rows use them.
                A label is per list and not per row: writing "Mercadona" on six
                rows is one word you type, not six. And it is here, next to the
                count, where a label can be given a colour *before* any task
                carries it: a task you are editing cannot offer a label it does
                not have, so without this row the first colour of a new label
                would have to wait for a task to use it. */}
            {labels.length > 0 ? (
              <View style={{ gap: theme.spacing.xs }}>
                <AppText variant="caption" tone="subtle">
                  {t(pluralKey("itemEdit.usedInList", labels.length), {
                    count: labels.length,
                  })}
                </AppText>
                <View
                  style={[
                    styles.row,
                    { gap: theme.spacing.xs, flexWrap: "wrap" },
                  ]}
                >
                  {labels.map(({ tag, count }) => {
                    const laTiene = shown.tags.includes(tag);
                    return (
                      <Fragment key={tag}>
                        <TagChip tag={tag} colors={coloresPintados} testID={`tag-pill-hoja-${tag}`}>
                          {(ink) => (
                            <>
                              {/* `TagChip` writes the name, so the count is what is
                                  left, and it goes first so the buttons stay at
                                  the end of the pill. And it goes in the pill's own
                                  colour instead of in a `tone`: a `tone` would pick a
                                  token del tema, y sobre el tinte de la etiqueta
                                  ese token no es de este fondo. */}
                              <AppText variant="caption" style={{ color: ink }}>
                                {`· ${count}`}
                              </AppText>
                              {/*
                                **Un boton o el otro, nunca los dos y nunca el mismo.**
                                El `+` es para las etiquetas que esta tarea **no** lleva,
                                y la papelera para las que **si** —y `laTiene` lo decide
                                con `shown.tags`, que es la verdad del estado y no una
                                cuenta aparte. Por eso el `+` que antes estaba siempre,
                                y que en una etiqueta que ya tenias te quitaba la
                                etiqueta sin preguntar, ahora solo aparece donde anade.
                              */}
                              {laTiene ? (
                                <Pressable
                                  accessibilityRole="button"
                                  accessibilityLabel={t("tags.remove", { name: tag })}
                                  hitSlop={8}
                                  onPress={() => confirmarQuitar(tag)}
                                  style={({ pressed }) => [
                                    styles.chipAction,
                                    {
                                      borderRadius: theme.radius.pill,
                                      opacity: pressed ? 0.7 : 1,
                                    },
                                  ]}
                                >
                                  <Ionicons name="remove" size={12} color={ink} />
                                </Pressable>
                              ) : (
                                <Pressable
                                  accessibilityRole="button"
                                  accessibilityLabel={t("tags.put", { name: tag })}
                                  hitSlop={8}
                                  onPress={() => anadirTag(tag)}
                                  style={({ pressed }) => [
                                    styles.chipAction,
                                    {
                                      borderRadius: theme.radius.pill,
                                      opacity: pressed ? 0.7 : 1,
                                    },
                                  ]}
                                >
                                  <Ionicons name="add" size={12} color={ink} />
                                </Pressable>
                              )}
                              <TagColorButton
                                tag={tag}
                                color={colorOf(tag)}
                                open={colorDe === tag}
                                ink={ink}
                                hintProps={pistaColor.props}
                                onPress={() =>
                                  setColorDe(colorDe === tag ? null : tag)
                                }
                              />
                            </>
                          )}
                        </TagChip>
                      {colorDe === tag ? (
                        <View style={styles.anchoCompleto}>
                          <TagColorPicker
                            tag={tag}
                            value={coloresVistos[tag] ?? null}
                            onChange={(hex) => void pickColor(tag, hex)}
                            onPreviewChange={(hex) =>
                              setVistaPrevia((previa) =>
                                previa?.tag === tag && previa?.hex === hex ? previa : { tag, hex },
                              )
                            }
                            onClose={() => setColorDe(null)}
                          />
                        </View>
                      ) : null}
                        </Fragment>
                      );
                    })}
                </View>
              </View>
            ) : null}

            {/*
              **El bloque entero de "nueva etiqueta" desaparece mientras se esta
              editando el color de una que ya existe, y no solo su selector.**

              Estaba siempre montado —`TextField`, selector y boton, sin ninguna
              condicion alrededor— porque la idea era que el color de una etiqueta
              que aun no existe se elige **sin** tener que escribir antes el nombre.
              Esa idea sigue siendo buena y no se toca. Lo que estaba mal es que
              conviviera con el otro selector: al pulsar "editar" en "Mercadona" se
              veian **los dos formularios enteros a la vez** —dos tiras de tono, dos
              cuadrados, dos campos de hex y dos botones de guardar— y no hay forma
              de saber cual de los dos estas tocando. Son dos controles que se
              parecen en todo y se distinguen solo por un nombre que hay que leer.

              Asi que **uno de los dos, nunca los dos**, y el que se aparta es el de
              la nueva: estas eligiendo el color de algo que ya existe, y el campo
              en blanco con su selector abajo no es informacion, es ruido. Cuando
              cierras el selector de edicion el bloque vuelve con lo que habias
              escrito y el color que habias pendiente —`pendiente` no se toca, asi
              que no se pierde nada—.

              Y esto quita de en medio una segunda cosa: los dos selectores comparten
              el nombre accesible base, `tags.colorOf` con `{name}`, asi que con los
              dos montados dos lectores de pantalla anuncian el mismo control dos
              veces. Con uno, no.
            */}
            {colorDe === null ? (
              <>
                <TextField
                  label={t("tags.newLabel")}
                  value={newTag}
                  onChangeText={setNewTag}
                  placeholder={t("tags.newPlaceholder")}
                  autoCapitalize="words"
                  returnKeyType="done"
                  onSubmitEditing={() => void addTag()}
                />

                {/*
                  **El mismo selector, siempre abierto, para una etiqueta que aun no
                  existe.** No detras de un boton, y esa es toda la diferencia con
                  las otras dos monturas: una etiqueta que ya esta en la tarea tiene
                  un boton que pulsar y algo donde enseñar el color, y esta no tiene
                  ni lo uno ni lo otro —no hay nada que pintar y ninguna pastilla de
                  la que abrir un selector—, asi que un color suyo seria inalcanzable
                  si esperase a un boton que solo existe cuando la etiqueta ya esta.

                  Asi que este **no escribe nada**: `value` es `pendiente`, estado
                  local de este panel, y el color solo llega al mapa por `addTag`, en
                  la misma pulsacion que crea el nombre. Editar el color de
                  "Mercadona" y elegir el de "Alcampo" se hacen pues ante el mismo
                  control, y lo que cambia entre los dos es solo *cuando* escribe.

                  **`tag` es el nombre escrito, recortado, y puede ser `undefined`.**
                  Es de donde los doce botones y la opcion de "volver al deducido"
                  derivan sus colores, y sin nombre escrito no hay nada de donde
                  derivar: el selector cae al neutro de su propia funcion, que es
                  donde se dibuja "aun nadie ha decidido". Escribe un nombre y el
                  panel lo sigue, para que el color que se elige se juzgue contra
                  el color que tendria esa etiqueta.
                */}
                <TagColorPicker
                  tag={nombreNuevo || undefined}
                  value={pendiente}
                  onChange={setPendiente}
                />

                <Button
                  label={t("tags.addNew")}
                  icon="add"
                  variant="secondary"
                  disabled={newTag.trim().length === 0}
                  onPress={() => void addTag()}
                />
              </>
            ) : null}

            {/* The hidden node every colour button on this page points at. One,
                because the hint is the same for all of them. */}
            {pistaColor.node}
          </View>
        ) : null}

        {/*
          The "Volver" that was down here is gone, and not moved up to the header
          by accident: it goes to the **same** place the arrow goes, on the **same**
          pages, and it said the same thing the arrow says. Two controls for one job,
          one at the bottom of a scrollable panel — where you have to scroll to find
          it, which on the icons page is the reason the page has a scrollbar at all.
        */}
      </View>
    </Sheet>
  );
}

/**
 * The little palette button inside a pill, which opens the colours of that label.
 *
 * It is here and not written out twice because it is the same control on both
 * rows of labels —the ones this task carries and the ones the list already has—
 * and a copy of it that drifts from the original would give the two rows
 * different `testID`s, which is the sort of thing a browser check then cannot
 * find.
 *
 * The label says three things: which label it is, what colour that label has
 * **now**, and whether its picker is open. The first two are the brief's; the
 * third is here because the state was invisible twice over. `accentSoft` on
 * `surfaceMuted` measures **1.003:1 to 1.073:1** — a tint no eye will see, across
 * every accent and both schemes — and `accessibilityState.selected` does not reach
 * the web: in `react-native-web@0.21.2` only `isDisabled` is read out of
 * `accessibilityState` (`modules/AccessibilityUtil/isDisabled.js`), so no
 * `aria-selected` is ever written. So the border carries it and the words carry
 * it, which is what `sheet.tsx` does with its own trailing control.
 */
function TagColorButton({
  tag,
  color,
  open,
  ink,
  hintProps,
  onPress,
}: {
  tag: string;
  /** The colour the label is painted in now, chosen or deduced. */
  color: string;
  /** Whether this label's colour picker is the open one. */
  open: boolean;
  /**
   * The pill's own text colour, from `TagChip`, for when this button is closed.
   *
   * **Open, the ground is not the pill.** With the picker showing, this button's
   * background is `accentSoft`, and the colour that reads on *that* is
   * `accentSoftText` — the token pair that exists for it. Closed, the ground is
   * the label's own tint and the colour is the one the pill just derived for it.
   * One colour could not serve both: they are different backgrounds, not one
   * background with two moods.
   */
  ink: string;
  /** The spread of `useA11yHint`, from the sheet: one hint node for all of them. */
  hintProps: Record<string, string>;
  onPress: () => void;
}) {
  const theme = useTheme();
  const t = useTranslation();
  // The dictionary has a name for each of the twelve and nothing for a hex that
  // somebody chose, so the hex itself is what gets read out. Nothing today can
  // write one here — the picker offers the twelve as shortcuts and a hand-written hex
  // arrives as itself — and saying so is cheaper
  // than a colour that announces itself as `undefined`.
  const clave = color as IconColor;
  const nombre = (ITEM_ICON_COLORS as readonly string[]).includes(clave)
    ? ICON_COLOR_LABEL[clave]
    : undefined;

  return (
    <Pressable
      testID={`tag-color-button-${tag}`}
      accessibilityRole="button"
      accessibilityLabel={t(
        open ? "tags.choosingColor" : "tags.changeColor",
        {
          name: tag,
          color: nombre ? t(nombre) : color,
        },
      )}
      {...hintProps}
      accessibilityState={{ selected: open }}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chipAction,
        {
          borderRadius: theme.radius.pill,
          backgroundColor: open ? theme.colors.accentSoft : "transparent",
          /*
           * El borde, y no solo el fondo: un boton que cambia de estado sin que se
           * note no es un boton con estado, y el fondo `accentSoft` es demasiado
           * parecido a la pastilla para distinguirlo. Ocupa su sitio **siempre**,
           * para que el boton no crezca ni se mueva al alternar.
           *
           * Y es **el color de la pastilla, no el del acento**: el borde se mide
           * contra el relleno de la pastilla, y ese relleno es el tinte de la
           * etiqueta —el acento se midio contra el fondo del tema, que esta
           * pastilla ya no tiene—. Con `ink` el borde llega por construccion, y
           * con cualquier acento daria el mismo numero porque el tinte no depende
           * del acento.
           */
          borderWidth: 2,
          borderColor: open ? ink : "transparent",
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <Ionicons
        name="color-palette-outline"
        size={10}
        color={open ? theme.colors.accentSoftText : ink}
      />
    </Pressable>
  );
}

/*
 * Lo que se fue con `TagColorStrip`, y por qué no queda ni una línea de él.
 *
 * Ofrecía trece opciones y ninguna manera de **nombrar** un color; `TagColorPicker`
 * ofrece esas trece más un tono, un cuadrado y un campo. Lo que la tira hacía no
 * cambió —y por eso el botón que la abre tampoco—, así que editar el color de una
 * etiqueta que ya existe se hace delante de lo mismo que elegir el de una que no.
 *
 * **Lo que no sobrevive son los trece `testID`** —
 * `tag-color-<etiqueta>-derived` y `tag-color-<etiqueta>-<clave>`—, porque estaban
 * en los puntos de la tira y `TagColorPicker` trae los suyos sin nombre de etiqueta
 * dentro. `scripts/verify-tag-colors.mjs` localiza varias de sus comprobaciones con
 * esos nombres y es de la Tarea 7; está escrito en el informe de la Tarea 5.
 *
 * Y dos cosas que la tira hacía y el selector no, a propósito: su primera opción
 * era un `button` con una varita y ahora es un `radio` del mismo grupo que los
 * doce —son trece respuestas a una pregunta, no un botón que casualmente está al
 * lado—, y `styles.swatch` era una copia local que ya no tiene a nadie que copiar.
 */

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
  },
  /*
   * The picker takes a whole line of the row of pills it is mounted in.
   *
   * Both rows of labels are `styles.row` —a `flexDirection: "row"` that wraps— and
   * a picker mounted as their child would be a flex item in a row: it would be
   * measured against the space left beside the pills instead of the width of the
   * panel, and its hue strip and its square would be squeezed into whatever was
   * left. `width: "100%"` is what forces it onto a line of its own, and it is the
   * same thing the strip it replaces did with its own root, for the same reason.
   */
  anchoCompleto: {
    width: "100%",
  },
  flex: {
    flex: 1,
  },
  /*
    The dot of the column this row is in, **and it is ten and not a token for the
    same reason it is ten in the two places that already draw it**: the theme has
    no token that means "how big is a dot", and `board-tabs.tsx` and
    `board-column.tsx` both draw it at ten — the roundness comes from
    `theme.radius.pill` at the use site, next to the colour, like they do. Three
    tens that match by reading each other are one size; a token that means
    something else would be a second size wearing its name.
  */
  stateDot: {
    width: 10,
    height: 10,
  },
  priority: {
    paddingHorizontal: 12,
    height: 32,
    justifyContent: "center",
  },
  link: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderWidth: 1,
  },
  chipAction: {
    /*
     * The two little buttons inside a pill: the one that takes the label off and
     * the one that opens its colours.
     *
     * A literal 24, and the same kind of literal as the 30 of the pills
     * themselves in `icon-picker.tsx` and `tag-chip.tsx`: it is the size of a
     * thing that is drawn, not spacing between things, and `SPACING` has no
     * "size of a small tap target" in it. Bigger than the eleven- and
     * twelve-point glyphs it holds, so the glyph is not the button.
     *
     * **Twenty y cuatro es lo que dice WCAG 2.5.8 AA, y es menos de lo que piden
     * las dos plataformas.** Medido en el navegador por
     * `scripts/verify-tag-colors.mjs` a 390×844: los dos botones son 24×24
     * exactos (576 pt² cada uno) con **dos puntos de hueco** entre ellos, así que
     * el botón de quitar la etiqueta y a dos píxeles de él hay… la pastilla. Y el
     * `hitSlop={8}` de los dos Pressable **no llega al DOM en web**: en
     * `react-native-web@0.21.2` `hitSlop` sólo aparece en `exports/Touchable`, y
     * `Pressable` no lo pasa a `createDOMProps`, así que no hay ni atributo ni
     * pseudo-elemento. En nativo sí hace su trabajo; en el navegador no hace nada.
     *
     * Formalmente pasa (SC 2.5.8 pide 24×24, y la excepción de espaciado se
     * cumple porque los círculos de 24 de los dos botones no se tocan: sus
     * centros están a 26). Por debajo de las guías de las dos plataformas, que
     * piden 44 en iOS y 48 en Material. **No se ha cambiado por eso**, y la razón
     * está escrita en el informe de la tarea 8: un objetivo de pulsación más
     * grande se nota en la pastilla, y el ancho de una pastilla en un dedo es de
     * las cosas que el navegador no puede medir. Es un número para decidir con un
     * dispositivo delante, no con un `<div>`.
     */
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
  },
});
