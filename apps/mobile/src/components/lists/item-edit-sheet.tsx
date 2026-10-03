import { Ionicons } from "@expo/vector-icons";
import { Fragment, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import type {
  ItemIconColor,
  ListItem,
  Priority,
  TagColors,
} from "@orbit-hub/contracts";
import { derivedTagColor } from "@orbit-hub/contracts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useA11yHint } from "@/components/ui/a11y-hint";
import { Sheet } from "@/components/ui/sheet";
import { AppText } from "@/components/ui/text";
import { TextField } from "@/components/ui/text-field";
import { useListItems } from "@/hooks/use-lists";
import { pluralKey, useTranslation } from "@/lib/i18n";
import { tagsByFrequency } from "@/lib/lists/item-presentation";
import { useTheme } from "@/theme";

import { ItemIcon, IconPickerPanel } from "./icon-picker";
import { TagChip } from "./tag-chip";
import { completedMatch } from "@/lib/lists/done-match";
import {
  ICON_COLOR_KEYS,
  ICON_COLOR_LABEL,
  iconColor,
  iconLabel,
} from "@/lib/lists/item-icons";

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
   * **It may hand back the write, and this panel waits for it** — hence
   * `void | Promise<void>`, so a caller with nothing to wait for can ignore it.
   * The chosen colour arrives at `tagColors` only after the store has been
   * written and read back, so a strip that closed on the tap had nothing on
   * screen to show for it: the tap read as one that did nothing, and the button's
   * own words ("now Red") were a round trip out of date. The strip therefore
   * waits for the write and closes with it, in the same render that repaints the
   * pill.
   */
  onTagColor: (tag: string, color: ItemIconColor | null) => void | Promise<void>;
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
  showCompleted = true,
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
  const [annotation, setAnnotation] = useState(item?.annotation ?? "");
  const [newTag, setNewTag] = useState("");
  /*
   * Which label has its colour strip open, and one at a time: two strips open
   * would be two sets of twelve dots on one panel, and the second one is not
   * where anybody was looking.
   *
   * It is the *label* and not a boolean, so the two rows of labels —the ones
   * this task carries and the ones the list already has— can share it and a
   * label that lives in one of them opens from there. A label cannot be in both,
   * which is what `labels` filters out.
   */
  const [colorDe, setColorDe] = useState<string | null>(null);
  /*
   * Whether a colour is being written right now, and **one write at a time**.
   *
   * It exists because the strip waits for the write it started (see
   * `onTagColor`), and a strip that is waiting is a strip that can be tapped
   * again: two taps inside one write would plan both from the same captured
   * `list` and the second would eat the first. Closing the strip on the tap was
   * what stopped that before; the guard replaces the closing as the thing that
   * stops it.
   */
  const [guardando, setGuardando] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);

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
    // And the strip with it: `colorDe` is state of this component and the panel
    // stays mounted while it is closed (it returns `null` rather than being
    // unmounted), so a panel closed with a strip open came back with that same
    // strip open, pointing at a label the person had not asked about this time.
    setColorDe(null);
  }, [idDelItem, startOn]);

  // Creating always starts empty, every time it is opened.
  useEffect(() => {
    if (isNew) {
      setPage("edit");
      setTitle("");
      setAnnotation("");
      setNewTag("");
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
   * says what the strip is *for*, and what it is for does not change with the
   * label. The label is already in the button's own `accessibilityLabel`, which
   * is where the name belongs.
   */
  const pistaColor = useA11yHint(t("tags.backToDerived"));

  /**
   * The colour a label is painted in right now.
   *
   * The chosen one if there is one and the deduced one if there is not, and
   * **never nothing**: there is no state in which a label has no colour, which is
   * why this has no `?? undefined` branch and why the same expression is in
   * `TagChip`. It is here because the button that opens the strip has to *say*
   * the colour out loud, in the words the dictionary has for it.
   */
  const colorOf = (tag: string): ItemIconColor =>
    tagColors[tag] ?? derivedTagColor(tag);

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

  const addTag = () => {
    const trimmed = newTag.trim();
    if (!trimmed) return;
    if (shown.tags.includes(trimmed)) {
      setNewTag("");
      return;
    }
    save({ tags: [...shown.tags, trimmed] });
    setNewTag("");
  };

  const toggleTag = (tag: string) =>
    save({
      tags: shown.tags.includes(tag)
        ? shown.tags.filter((row) => row !== tag)
        : [...shown.tags, tag],
    });

  /**
   * A tap on one swatch: one write, and the strip closes **after** it.
   *
   * Two things are happening here and both were measured, not chosen:
   *
   * - **The await.** `tagColors` is what the pills are painted from, and it only
   *   moves once the store has been written and read back, so a strip that closed
   *   on the tap left that tap with nothing on screen: the strip disappearing was
   *   the whole of it, and the colour landed some milliseconds later with nothing
   *   to connect the two. Awaiting means the strip unmounts in the **same commit**
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
   * - **The guard.** That open strip is a second tap away, and `setTagColor`
   *   plans from the `list` its caller captured: two taps inside one write would
   *   both plan from the same map and the second would silently eat the first.
   *   `guardando` is what keeps it to one write. The write is a local one, so
   *   this is milliseconds; nothing in this app reports a failed write, and the
   *   `finally` closes the strip either way, so a write that throws cannot leave
   *   the panel stuck open.
   */
  const pickColor = async (tag: string, option: ItemIconColor | null) => {
    if (guardando) return;
    setGuardando(true);
    try {
      await onTagColor(tag, option);
    } finally {
      setGuardando(false);
      // Only closes its own strip: the write takes long enough for somebody to
      // open another label's colours, and closing that one instead would be a
      // strip that opened and vanished on its own.
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
            />

            <TextField
              label={t("itemEdit.description")}
              value={annotation}
              onChangeText={setAnnotation}
              onBlur={saveNotes}
              placeholder={t("itemEdit.descriptionPlaceholder")}
              multiline
            />

            {/* The priority, as four things you can see rather than a dropdown of
                words. And it is here, and not in a menu, because ordering a list
                by urgency needs a way to *say* that a thing is urgent. */}
            <View style={{ gap: theme.spacing.xs }}>
              <AppText variant="caption" tone="subtle">
                {t("itemEdit.priority")}
              </AppText>
              <View style={[styles.row, { gap: theme.spacing.xs }]}>
                {PRIORITIES.map((option) => {
                  const active = option === shown.priority;
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
                          backgroundColor: active
                            ? theme.colors.accent
                            : theme.colors.surfaceMuted,
                          opacity: pressed ? 0.7 : 1,
                        },
                      ]}
                    >
                      <AppText
                        variant="caption"
                        style={{
                          color: active
                            ? theme.colors.onAccent
                            : theme.colors.textMuted,
                        }}
                      >
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
                  <TagChip tag={tag} colors={tagColors}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t("tags.remove", { name: tag })}
                      hitSlop={8}
                      onPress={() => toggleTag(tag)}
                      style={({ pressed }) => [
                        styles.chipAction,
                        {
                          borderRadius: theme.radius.pill,
                          opacity: pressed ? 0.7 : 1,
                        },
                      ]}
                    >
                      <Ionicons
                        name="close"
                        size={11}
                        color={theme.colors.textMuted}
                      />
                    </Pressable>
                    <TagColorButton
                      tag={tag}
                      color={colorOf(tag)}
                      open={colorDe === tag}
                      hintProps={pistaColor.props}
                      onPress={() => setColorDe(colorDe === tag ? null : tag)}
                    />
                  </TagChip>
                  {colorDe === tag ? (
                    <TagColorStrip
                      tag={tag}
                      chosen={tagColors[tag]}
                      onPick={(option) => void pickColor(tag, option)}
                    />
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
                  {labels.map(({ tag, count }) => (
                    <Fragment key={tag}>
                      <TagChip tag={tag} colors={tagColors}>
                        {/* `TagChip` writes the name, so the count is what is
                            left, and it goes first so the two buttons stay at
                            the end of the pill. */}
                        <AppText variant="caption" tone="muted">
                          {`· ${count}`}
                        </AppText>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={t("tags.put", { name: tag })}
                          hitSlop={8}
                          onPress={() => toggleTag(tag)}
                          style={({ pressed }) => [
                            styles.chipAction,
                            {
                              borderRadius: theme.radius.pill,
                              opacity: pressed ? 0.7 : 1,
                            },
                          ]}
                        >
                          <Ionicons
                            name="add"
                            size={12}
                            color={theme.colors.textMuted}
                          />
                        </Pressable>
                        <TagColorButton
                          tag={tag}
                          color={colorOf(tag)}
                          open={colorDe === tag}
                          hintProps={pistaColor.props}
                          onPress={() =>
                            setColorDe(colorDe === tag ? null : tag)
                          }
                        />
                      </TagChip>
                      {colorDe === tag ? (
                        <TagColorStrip
                          tag={tag}
                          chosen={tagColors[tag]}
                          onPick={(option) => void pickColor(tag, option)}
                        />
                      ) : null}
                    </Fragment>
                  ))}
                </View>
              </View>
            ) : null}

            <TextField
              label={t("tags.newLabel")}
              value={newTag}
              onChangeText={setNewTag}
              placeholder={t("tags.newPlaceholder")}
              autoCapitalize="words"
              returnKeyType="done"
              onSubmitEditing={addTag}
            />
            <Button
              label={t("tags.addNew")}
              icon="add"
              variant="secondary"
              disabled={newTag.trim().length === 0}
              onPress={addTag}
            />

            {/* The hidden node every colour button on this page points at. One,
                because the hint is the same for all of them. */}
            {pistaColor.node}
          </View>
        ) : null}

        {page !== "edit" ? (
          <Button
            label={t("common.back")}
            variant="ghost"
            fullWidth
            onPress={() => setPage("edit")}
          />
        ) : null}
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
 * **now**, and whether its strip is open. The first two are the brief's; the
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
  hintProps,
  onPress,
}: {
  tag: string;
  /** The colour the label is painted in now, chosen or deduced. */
  color: ItemIconColor;
  /** Whether this label's strip is the open one. */
  open: boolean;
  /** The spread of `useA11yHint`, from the sheet: one hint node for all of them. */
  hintProps: Record<string, string>;
  onPress: () => void;
}) {
  const theme = useTheme();
  const t = useTranslation();

  return (
    <Pressable
      testID={`tag-color-button-${tag}`}
      accessibilityRole="button"
      accessibilityLabel={t(
        open ? "tags.choosingColor" : "tags.changeColor",
        {
          name: tag,
          color: t(ICON_COLOR_LABEL[color]),
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
           * El borde, y no solo el fondo: dos puntos de acento sobre la propia
           * pastilla no se ven —1.0:1 medido, en los cinco acentos y los dos
           * esquemas— y un estado que no se ve no es un estado. Ocupa su sitio
           * **siempre**, para que el boton no crezca ni se mueva al alternar.
           */
          borderWidth: 2,
          borderColor: open ? theme.colors.accent : "transparent",
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <Ionicons
        name="color-palette-outline"
        size={10}
        color={theme.colors.textMuted}
      />
    </Pressable>
  );
}

/**
 * The colours of one label: the twelve the app draws with, and the way back to
 * the one its name gives it.
 *
 * **The first option is not a colour.** It is what the label goes back to when
 * nobody has chosen for it, and it is drawn in the colour it would return to, so
 * the option shows its own result instead of describing it. Pressing it sends
 * `null`, which is "no colour **chosen**" — an absent key — and not a colour
 * called `neutral`: there is no colour that means "nobody decided", because that
 * is what the deduced one already is.
 *
 * The swatches are the icon picker's, numbers and all, and `styles.swatch` is
 * defined again at the bottom of this file rather than imported: a style object
 * exported out of a sibling component to save six lines is a coupling that two
 * files then have to agree about, and a reviewer of one of them cannot see the
 * other.
 */
function TagColorStrip({
  tag,
  chosen,
  onPick,
}: {
  tag: string;
  /** The colour chosen for this label, or `undefined` if none is. */
  chosen: ItemIconColor | undefined;
  onPick: (color: ItemIconColor | null) => void;
}) {
  const theme = useTheme();
  const t = useTranslation();

  return (
    <View style={{ width: "100%", gap: theme.spacing.xs }}>
      <AppText variant="caption" tone="subtle">
        {t("tags.color")}
      </AppText>
      <View style={[styles.row, { gap: theme.spacing.xs, flexWrap: "wrap" }]}>
        <Pressable
          testID={`tag-color-${tag}-derived`}
          accessibilityRole="button"
          accessibilityState={{ selected: chosen === undefined }}
          accessibilityLabel={t("tags.backToDerivedOf", { name: tag })}
          onPress={() => onPick(null)}
          style={({ pressed }) => [
            styles.swatch,
            {
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: theme.colors.surfaceMuted,
              borderColor: chosen === undefined ? theme.colors.text : "transparent",
              borderWidth: chosen === undefined ? 3 : 0,
              opacity: pressed ? 0.7 : 1,
            },
          ]}
        >
          {/* In the colour the label goes back to, and not in a generic one:
              the whole point of the option is which colour that is. */}
          <Ionicons
            name="color-wand-outline"
            size={18}
            color={iconColor(derivedTagColor(tag))}
          />
        </Pressable>
        {ICON_COLOR_KEYS.map((option) => {
          const selected = chosen === option;
          return (
            <Pressable
              key={option}
              testID={`tag-color-${tag}-${option}`}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={t(ICON_COLOR_LABEL[option])}
              onPress={() => onPick(option)}
              style={({ pressed }) => [
                styles.swatch,
                {
                  backgroundColor: iconColor(option),
                  // El borde ocupa su sitio siempre —tres puntos o ninguno—
                  // para que la fila no dé un salto al elegir y el punto no se mueva
                  // bajo el dedo. Mismo criterio que `icon-picker.tsx`.
                  borderColor: selected ? theme.colors.text : "transparent",
                  borderWidth: selected ? 3 : 0,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            />
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
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
  swatch: {
    width: 30,
    height: 30,
    borderRadius: 15,
  },
});
