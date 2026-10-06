import { Ionicons } from "@expo/vector-icons";
import { Fragment, useEffect, useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, View } from "react-native";

import type { ListItem, Priority, TagColors } from "@orbit-hub/contracts";
import { derivedTagColor } from "@orbit-hub/contracts";

import { Badge, tonesFor } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useA11yHint } from "@/components/ui/a11y-hint";
import { Sheet } from "@/components/ui/sheet";
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
import { useTheme } from "@/theme";

import { ItemIcon, IconPickerPanel } from "./icon-picker";
import { TagChip } from "./tag-chip";
import { TagColorPicker } from "./tag-color-picker";
import { completedMatch } from "@/lib/lists/done-match";
import {
  ICON_COLOR_KEYS,
  ICON_COLOR_LABEL,
  iconLabel,
} from "@/lib/lists/item-icons";
import type { IconColorKey } from "@/lib/lists/item-icons";

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
  /** The page to open on, so a tap on the icon goes straight to the icons. */
  startOn?: Page;
  /** This list's chosen label colours, and the only ones there are. */
  tagColors: TagColors;
  /**
   * Called with the colour chosen for a label, or `null` for the one that sends
   * it back to the colour deduced from its name.
   *
   * It lands on the list and not on the task, which is why the signature has no
   * task in it: one write recolours every row that carries the label.
   *
   * **It may hand back the write, and this panel waits for it** — hence
   * `void | Promise<void>`, so a caller with nothing to wait for can ignore it.
   * The chosen colour arrives at `tagColors` only after the store has been
   * written and read back, so a picker that closed on the tap had nothing on
   * screen to show for it: the tap read as one that did nothing, and the button's
   * own words ("now Red") were a round trip out of date. The picker therefore
   * waits for the write and closes with it, in the same render that repaints the
   * pill.
   *
   * **Two doors in this panel call it and one guard covers both**: a colour chosen
   * for a label the task carries (`pickColor`) and a colour chosen for a label that
   * is about to exist (`addTag`). See `guardando` for why that matters.
   */
  onTagColor: (tag: string, color: string | null) => void | Promise<void>;
  onClose: () => void;
  /** Called after the row is gone, so the screen can put itself right. */
  onDeleted?: () => void;
}

/** What a row being written looks like before it exists. */
interface Draft {
  title: string;
  annotation: string | null;
  priority: Priority;
  icon: ListItem["icon"];
  iconStyle: ListItem["iconStyle"];
  iconColor: ListItem["iconColor"];
  tags: string[];
}

const EMPTY_DRAFT: Draft = {
  title: "",
  annotation: null,
  priority: "none",
  icon: null,
  iconStyle: "outline",
  iconColor: "neutral",
  tags: [],
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
  startOn = "edit",
  tagColors,
  onTagColor,
  onClose,
  onDeleted,
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
  /*
   * **The colour just chosen, before the store has said it back, and why the
   * pill repaints on the tap and not on the round trip.**
   *
   * `pickColor` writes through `onTagColor`, which plans from the parent's
   * captured `list` and only lands in `tagColors` once `load()` has read the
   * cache back. Without this, the pill keeps the old colour for the whole write
   * —and the picker, which derives its own square from the same `value`, shows
   * the old colour too— so choosing a colour feels like nothing happened until
   * the panel repaints a moment later. Setting the override here is synchronous,
   * so the same commit that starts the write already paints the new colour.
   *
   * It is keyed by label and never cleared: once the store answers, `tagColors`
   * carries the same value and the override agrees with it, so there is nothing
   * to reconcile. A `null` choice ("back to derived") is stored as `null`, not
   * by removing the key: `tagColors` still holds the old colour until the store
   * answers, so removing the key would fall back to that old colour instead of
   * to the derived one.
   */
  const [coloresVistos, setColoresVistos] = useState<Record<string, string | null>>({});
  /*
   * **What the pills are painted with: the map with the overrides applied.**
   *
   * Both `TagChip` mounts below read this and not `tagColors` directly —that
   * was the actual bug behind "the colour does not show in real time": the
   * override reached the pencil button (`colorOf`) and the picker's `value`,
   * but the pill's fill comes from `TagChip`, which kept reading the stale map.
   * A `null` override deletes the key, which is the shape "no colour chosen",
   * so the pill falls back to the derived colour at once.
   */
  const colores: TagColors = { ...tagColors };
  for (const [etiqueta, visto] of Object.entries(coloresVistos)) {
    if (visto === null) delete colores[etiqueta];
    else colores[etiqueta] = visto;
  }
  /*
   * **The colour under the finger, not yet chosen, and why the pill follows the
   * drag.**
   *
   * A swatch press commits at once, but dragging the square or the hue strip
   * only moves the picker's local state until "use this colour" is pressed — so
   * without this the pill keeps its old colour while a new one is already on
   * screen. The picker reports its square through `onPreviewChange` and it lands
   * here, synchronously, in the same commit as the drag.
   *
   * One `{tag, hex}` and not a map, because only one picker is ever open
   * (`colorDe`): a second one cannot start previewing without closing the first.
   * It applies only while its picker is the open one — after closing, the tag no
   * longer matches and the pill falls back to what was committed, which is also
   * what "closing without choosing keeps nothing" means. And it paints the pills
   * only, never the picker's `value`: feeding the draft back in would make the
   * picker's own sync effect snap the square back mid-drag.
   */
  const [vistaPrevia, setVistaPrevia] = useState<{ tag: string; hex: string } | null>(null);
  const coloresPintados: TagColors = { ...colores };
  if (vistaPrevia && vistaPrevia.tag === colorDe) coloresPintados[vistaPrevia.tag] = vistaPrevia.hex;
  /*
   * Whether a colour is being written right now, and **one write at a time**.
   *
   * It exists because the picker waits for the write it started (see
   * `onTagColor`), and a picker that is waiting is a picker that can be tapped
   * again: two taps inside one write would plan both from the same captured
   * `list` and the second would eat the first. Closing the picker on the tap was
   * what stopped that before; the guard replaces the closing as the thing that
   * stops it.
   *
   * **And it is checked by the other door too, as its first statement.** Adding a
   * label *with* a colour is also two colour-bearing writes in a row, so `addTag` asks
   * the same question before it has touched anything; see there for why those two
   * writes are of different entities and only the colours need guarding, and for why
   * the check has to come first rather than after the two clears.
   */
  const [guardando, setGuardando] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);

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
      // `setNewTag("")` on a field that is already empty changes nothing, so React
      // drops it and the effect on `nombreNuevo` never fires. That is why the
      // pending colour is cleared here as well and not only there.
      setPendiente(null);
      setDraft(EMPTY_DRAFT);
    }
  }, [isNew]);

  /** What the panel is showing, whether the row exists yet or not. */
  const shown: Draft = isNew
    ? { ...draft, title, annotation: annotation || null }
    : {
        title: item?.title ?? "",
        annotation: item?.annotation ?? null,
        priority: item?.priority ?? "none",
        icon: item?.icon ?? null,
        iconStyle: item?.iconStyle ?? "outline",
        iconColor: item?.iconColor ?? "neutral",
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

  const pistaIcon = useA11yHint(t("itemEdit.iconHint"));
  const pistaTags = useA11yHint(t("itemEdit.tagsHint"));
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
  const colorOf = (tag: string): string => coloresPintados[tag] ?? derivedTagColor(tag);

  if (!isNew && !item) return null;

  const save = (changes: Parameters<typeof updateItem>[1]) => {
    if (isNew) {
      setDraft((current) => ({ ...current, ...changes }));
      return;
    }
    void updateItem(item!, changes);
  };

  const saveTitle = () => {
    const trimmed = title.trim();
    // An empty name is not a name: the row would be a blank line in the list
    // with nothing in it to find again.
    if (isNew) {
      if (trimmed) setDraft((current) => ({ ...current, title: trimmed }));
      return;
    }
    if (trimmed && trimmed !== item!.title) save({ title: trimmed });
  };

  const saveNotes = () => {
    const trimmed = annotation.trim();
    if (isNew) {
      setDraft((current) => ({ ...current, annotation: trimmed || null }));
      return;
    }
    if (trimmed !== (item!.annotation ?? "")) save({ annotation: trimmed || null });
  };

  /**
   * A new label, and its colour if one was chosen for it.
   *
   * **Two writes, and they are of two different things.** `save` writes the **task**
   * and `onTagColor` writes the **list**, and there is no overlap between them: one
   * is a column of `items`, the other a column of `lists`, and neither reads what
   * the other is writing. That is why they do not need to be ordered against each
   * other beyond putting the task first — the label has to be **on the task** before
   * the map has a key for it, or a sync payload can carry a colour for a label that
   * no row carries and the server would have to decide whether to keep it.
   *
   * **`onTagColor` and not `setTagColor`,** and not because it is tidier: this sheet
   * receives `listId` and `tagColors`, not the list, and the list is the thing the
   * colour is planned from. The parent holds it and hands the write down, and the
   * `pickColor` below already writes through the same prop for the same reason.
   *
   * **The guard is checked here too, and this is the reason the guard exists.**
   * `setTagColor` plans from the `list` its caller captured, so two colour writes
   * inside one would both plan from the same map and the second would eat the first
   * without either of them finding out. A label with a colour is exactly that: two
   * writes in a row. So `guardando` is one flag for both doors.
   *
   * **And it is the first thing checked, which is what makes it the same door as
   * `pickColor`.** There it was `if (guardando) return;` as the very first statement
   * —a total no-op that costs the tap and nothing else— and here it sat *after* the two
   * clears and after the `save`, so a tap that arrived while `pickColor` was writing
   * put the label on the task with no colour, dropped the pending colour with the name,
   * and had nothing left to restore it from: `pendiente` had never been in
   * `tagColors`. **The data loss was a consequence of the order, not of the guard**,
   * and moving the check above the clears makes the two doors the same shape. What is
   * left is an ignored tap —the name stays, the colour stays, and the person can press
   * again a moment later— instead of a label written without its colour and no trace of
   * the colour anywhere.
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
  const addTag = async () => {
    const trimmed = newTag.trim();
    if (!trimmed) return;
    if (guardando) return;
    if (shown.tags.includes(trimmed)) return;

    // Read into a local before the name is cleared, because clearing the name is what
    // invalidates it — the effect above drops `pendiente` on the next render — and the
    // `await` below would otherwise be reading state that has already stopped meaning
    // "the colour of the label I am about to create".
    const color = pendiente;
    setNewTag("");
    setPendiente(null);

    save({ tags: [...shown.tags, trimmed] });

    // Optional on purpose: with no colour chosen the label comes out **derived**,
    // which is a colour like any other and not a missing one, and nothing is written
    // to `tagColors` for it.
    if (!color) return;
    setGuardando(true);
    try {
      await onTagColor(trimmed, color);
    } finally {
      setGuardando(false);
    }
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
   * A tap on one swatch of a label the task already carries: one write, and the
   * picker closes **after** it.
   *
   * `option` is **a hex and not a name from the twelve any more**, because
   * `TagColorPicker` hands back whatever was chosen and a free colour is not in
   * `ICON_COLOR_KEYS`. `onTagColor` takes a string and the server is what decides
   * what a colour is, so nothing here has to know which of the two it is.
   *
   * Two things are happening here and both were measured, not chosen:
   *
   * - **The await.** `tagColors` is what the pills are painted from, and it only
   *   moves once the store has been written and read back, so a picker that closed
   *   on the tap left that tap with nothing on screen: the picker disappearing was
   *   the whole of it, and the colour landed some milliseconds later with nothing
   *   to connect the two. Awaiting means the picker unmounts in the **same commit**
   *   that repaints the pill —the hook's `setLists` and the two state changes
   *   below are queued in one batch and React 18 flushes them in one pass— so the
   *   tap has its consequence in the frame that answered it, and the button's
   *   "now Red" is true when it is last read.
   *
   *   What that does **not** give is the chosen swatch sitting there ringed for an
   *   extra frame: React never renders between the write and the close, and making
   *   it render would mean awaiting a frame after the write, which buys nothing an
   *   eye can see. A ring on the tap itself would mean optimising the colour into
   *   local state first, which is what `icon-picker.tsx` does with its own swatches
   *   and is deliberately not done here: this ring is read back from the store, and
   *   a ring that is not what the store says is a lie while it is on screen.
   * - **The guard.** That open picker is a second tap away, and `setTagColor`
   *   plans from the `list` its caller captured: two taps inside one write would
   *   both plan from the same map and the second would silently eat the first.
   *   `guardando` is what keeps it to one write. The write is a local one, so
   *   this is milliseconds; nothing in this app reports a failed write, and the
   *   `finally` closes the picker either way, so a write that throws cannot leave
   *   the panel stuck open.
   */
  const pickColor = async (tag: string, option: string | null) => {
    if (guardando) return;
    // Paint it now: the store answers later, and the pill should not wait.
    // `option` is already normalised by the picker's single door (`escribir`),
    // so what goes in the override is exactly what the write carries —including
    // `null`, which is stored and not removed, because `tagColors` still holds
    // the old colour until the store answers (see `coloresVistos` above).
    setColoresVistos((previos) => (previos[tag] === option ? previos : { ...previos, [tag]: option }));
    setGuardando(true);
    try {
      await onTagColor(tag, option);
    } finally {
      setGuardando(false);
      // Only closes its own picker: the write takes long enough for somebody to
      // open another label's colours, and closing that one instead would be a
      // picker that opened and vanished on its own.
      setColorDe((current) => (current === tag ? null : current));
    }
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
      iconStyle: draft.iconStyle,
      iconColor: draft.iconColor,
      tags: draft.tags,
    });
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
              onBlur={saveTitle}
              returnKeyType="next"
              selectTextOnFocus={false}
              ref={cadena.register(0)}
              onSubmitEditing={() => cadena.advance(0, () => {
                // El nombre ya esta guardado en `onBlur`; saltar es lo que se
                // pidio, y al campo de la nota, que es a donde se sigue.
              })}
              // The width the contracts will store it at, so the counter and the
              // server agree. The title of a task is 300 on purpose, and a list of
              // 300 of them is not a thing anyone writes.
              limit={FIELD_LIMITS['list_item.title']}
            />

            <TextField
              label={t("itemEdit.description")}
              value={annotation}
              onChangeText={setAnnotation}
              onBlur={saveNotes}
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
              <ItemIcon
                icon={shown.icon}
                style={shown.iconStyle}
                color={shown.iconColor}
                size={20}
              />
              <AppText variant="body" style={styles.flex}>
                {shown.icon ? iconLabel(shown.icon) : t("itemEdit.icon")}
              </AppText>
              <Ionicons
                name="chevron-forward"
                size={16}
                color={theme.colors.textSubtle}
              />
            </Pressable>
            {pistaIcon.node}

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
                the only place to say that is the row itself. */}
            {!isNew ? (
              <>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("itemEdit.markDone")}
                  {...pistaMarkDone.props}
                  onPress={() => {
                    onClose();
                    void toggleCompleted(item!);
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
                      void toggleCompleted(item!);
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

            {isNew ? (
              <Button
                testID="item-create"
                label={t("itemCreate.save")}
                icon="checkmark"
                fullWidth
                disabled={title.trim().length === 0}
                onPress={() => void create()}
              />
            ) : (
              <Button
                label={t("rename.save")}
                icon="checkmark"
                fullWidth
                onPress={() => {
                  saveTitle();
                  saveNotes();
                }}
              />
            )}

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
            value={shown.icon}
            style={shown.iconStyle}
            color={shown.iconColor}
            onPick={(choice) => {
              // The colour and the drawing travel with the icon, so a tap on a
              // red outline is one write and not three that could half-land.
              save(choice);
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
                        value={colores[tag] ?? null}
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
                            value={colores[tag] ?? null}
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
  const clave = color as IconColorKey;
  const nombre = ICON_COLOR_KEYS.includes(clave)
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
