import { Ionicons } from "@expo/vector-icons";
import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import type { ListItem, Priority } from "@orbit-hub/contracts";

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
import { completedMatch } from "@/lib/lists/done-match";
import { iconLabel } from "@/lib/lists/item-icons";

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
  onClose: () => void;
  /** Called after the row is gone, so the screen can put itself right. */
  onDeleted?: () => void;
}

/** What a row being written looks like before it exists. */
interface Draft {
  title: string;
  notes: string | null;
  priority: Priority;
  icon: ListItem["icon"];
  iconStyle: ListItem["iconStyle"];
  iconColor: ListItem["iconColor"];
  tags: string[];
}

const EMPTY_DRAFT: Draft = {
  title: "",
  notes: null,
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
  const [notes, setNotes] = useState(item?.notes ?? "");
  const [newTag, setNewTag] = useState("");
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);

  // Reopening always starts where the tap asked to start, on a fresh copy of
  // what the row has now and not on what it had when the panel was created.
  useEffect(() => {
    if (item) {
      setPage(startOn);
      setTitle(item.title);
      setNotes(item.notes ?? "");
      setNewTag("");
    }
  }, [item, startOn]);

  // Creating always starts empty, every time it is opened.
  useEffect(() => {
    if (isNew) {
      setPage("edit");
      setTitle("");
      setNotes("");
      setNewTag("");
      setDraft(EMPTY_DRAFT);
    }
  }, [isNew]);

  /** What the panel is showing, whether the row exists yet or not. */
  const shown: Draft = isNew
    ? { ...draft, title, notes: notes || null }
    : {
        title: item?.title ?? "",
        notes: item?.notes ?? null,
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
    const trimmed = notes.trim();
    if (isNew) {
      setDraft((current) => ({ ...current, notes: trimmed || null }));
      return;
    }
    if (trimmed !== (item!.notes ?? "")) save({ notes: trimmed || null });
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

  /** Writes the row for the first time, with everything the panel was given. */
  const create = async () => {
    const trimmed = title.trim();
    // A row with no name is a blank line you cannot find again, so the button
    // says so instead of writing it.
    if (!trimmed) return;
    await addItem({
      title: trimmed,
      notes: notes.trim() || null,
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
              value={notes}
              onChangeText={setNotes}
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
            <View
              style={[styles.row, { gap: theme.spacing.xs, flexWrap: "wrap" }]}
            >
              {shown.tags.map((tag) => (
                <Pressable
                  key={tag}
                  accessibilityRole="button"
                  accessibilityLabel={t("tags.remove", { name: tag })}
                  onPress={() => toggleTag(tag)}
                  style={({ pressed }) => [
                    styles.chip,
                    {
                      borderRadius: theme.radius.pill,
                      backgroundColor: theme.colors.accent,
                      opacity: pressed ? 0.7 : 1,
                    },
                  ]}
                >
                  <AppText
                    variant="caption"
                    style={{ color: theme.colors.onAccent }}
                  >
                    {tag}
                  </AppText>
                  <Ionicons
                    name="close"
                    size={11}
                    color={theme.colors.onAccent}
                  />
                </Pressable>
              ))}
            </View>

            {/* The labels already used in this list, with how many rows use them.
                A label is per list and not per row: writing "Mercadona" on six
                rows is one word you type, not six. */}
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
                    <Pressable
                      key={tag}
                      accessibilityRole="button"
                      accessibilityLabel={t("tags.put", { name: tag })}
                      onPress={() => toggleTag(tag)}
                      style={({ pressed }) => [
                        styles.chip,
                        {
                          borderRadius: theme.radius.pill,
                          borderWidth: 1,
                          borderColor: theme.colors.border,
                          opacity: pressed ? 0.7 : 1,
                        },
                      ]}
                    >
                      <AppText variant="caption" tone="muted">
                        {tag} · {count}
                      </AppText>
                    </Pressable>
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
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    height: 30,
    justifyContent: "center",
  },
});
