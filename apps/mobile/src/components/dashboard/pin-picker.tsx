import { Ionicons } from "@expo/vector-icons";
import { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import type { Folder, List, Note, Workspace } from "@orbit-hub/contracts";

import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeader } from "@/components/ui/list-row";
import { SheetOptions } from "@/components/ui/sheet";
import type { SheetOption } from "@/components/ui/sheet";
import { AppText } from "@/components/ui/text";
import { pluralKey, useTranslation } from "@/lib/i18n";
import { buildPickerTree } from "@/lib/dashboard/picker-tree";
import { notePreview } from "@/lib/notes/note-record";
import { useTheme } from "@/theme";

/**
 * Choosing what the panel shows, without it becoming a list of everything.
 *
 * The sheet this replaces was one flat list: every list in every space, then
 * every folder, each row carrying the name of its space so you could tell two
 * things called "Cine" apart. It worked with the three lists it was built for and
 * it stops working at about thirty: the answer to "which of my four hundred lists
 * do I want" cannot be a scroll you read, because reading four hundred rows is
 * the thing you were trying to avoid.
 *
 * So the panel picker is arranged the way the app already arranges things —
 * space, then folder, then list — and you go down into it one level at a time. A
 * level shows one space's folders and its loose lists, or one folder's lists, and
 * a level is short enough to read at a glance however much there is underneath
 * it. The path is a row of words at the top that you can also press, so getting
 * out is never a hunt for a back button.
 *
 * A folder is here to be pinned, not only to be walked into: it is a thing the
 * panel draws, so it gets a row of its own that toggles, and the chevron beside
 * it is the way inside rather than the way it is chosen.
 *
 * Choosing is still a tap that takes effect at once, because the panel is behind
 * the sheet and the point of the sheet is to watch it fill up.
 */

/**
 * The section headings line up with the rows under them.
 *
 * Only the top padding. `Sheet` already insets its body by eighteen points —
 * `MARGEN` in `sheet.tsx` — and this added eighteen more, so every heading and the
 * crumb row started at thirty-six while the rows they label started at eighteen.
 * The comment this replaced said the inset made them line up; the code did the
 * opposite, and it was left over from a `Sheet` that did not pad its body.
 */
const SHEET_SECTION = { paddingTop: 10 } as const;

/**
 * Where you are. The last entry is the level being shown.
 *
 * `parentId` on a folder, because a folder is not only knowable by its own id:
 * without the parent, the tree cannot answer "which folders hang from *this* one",
 * which is the whole question when you are standing inside a space. With it, a
 * sub-folder is a child of its parent instead of a sibling of it.
 */
type Stop =
  | { kind: "root" }
  | { kind: "workspace"; workspaceId: string }
  | { kind: "folder"; workspaceId: string; folderId: string; parentId: string | null };

export interface PanelPickerProps {
  workspaces: Workspace[];
  /** Every folder of every space: the panel is not inside a space. */
  folders: Folder[];
  lists: List[];
  /** The lists already on the panel, by list id. */
  pinnedLists: ReadonlySet<string>;
  /** The folders already on the panel, by folder id. */
  pinnedFolders: ReadonlySet<string>;
  /** Adds or takes off a list. A tap, not a draft to be confirmed. */
  onToggleList: (listId: string) => void;
  onToggleFolder: (folderId: string) => void;
  /** The notes that can go on the panel, all of them and unfiled. */
  notes?: Note[];
  pinnedNotes?: ReadonlySet<string>;
  onToggleNote?: (noteId: string) => void;
}

export function PanelPicker({
  workspaces,
  folders,
  lists,
  pinnedLists,
  pinnedFolders,
  onToggleList,
  onToggleFolder,
  notes = [],
  pinnedNotes,
  onToggleNote,
}: PanelPickerProps) {
  const theme = useTheme();
  const t = useTranslation();

  /**
   * The path, oldest first, and the last entry is where you are.
   *
   * A path and not a single level, because a level that can only be left with a
   * back button makes the back button the only way out: a person who has gone
   * two levels deep and wants the first one has to press back, then back again,
   * and a picker that is hard to leave is a picker people stop using. The words
   * across the top are every stop at once, so any of them is one press.
   */
  const [trail, setTrail] = useState<Stop[]>([{ kind: "root" }]);
  // The last stop is where you are, and there is always at least one: the trail
  // is only ever grown or shortened, never emptied. The fallback is for the
  // compiler, and it is the root, which is where an empty trail would have left
  // you anyway.
  const here: Stop = trail[trail.length - 1] ?? { kind: "root" };

  const descend = useCallback((stop: Stop) => setTrail((path) => [...path, stop]), []);
  /** Back to any stop already on the path, not only the one before this one. */
  const unwindTo = useCallback(
    (index: number) => setTrail((path) => path.slice(0, index + 1)),
    [],
  );
  const goBack = useCallback(
    () => setTrail((path) => (path.length > 1 ? path.slice(0, -1) : path)),
    [],
  );

  const byId = useMemo(
    () => new Map(workspaces.map((space) => [space.id, space])),
    [workspaces],
  );

  // The name of every stop on the path, for the row of words at the top. Built
  // from the ids rather than stored, so a space that is renamed under the sheet
  // says its new name in the breadcrumb instead of the one it had when it was
  // opened.
  const crumbs = useMemo(
    () =>
      trail.map((stop) => {
        if (stop.kind === "root") return t("workspaces.title");
        if (stop.kind === "workspace")
          return byId.get(stop.workspaceId)?.name ?? t("workspaces.title");
        return (
          folders.find((folder) => folder.id === stop.folderId)?.name ??
          t("folders.title")
        );
      }),
    [byId, folders, t, trail],
  );

  /**
   * The tree, indexed once.
   *
   * This used to filter `folders` by `workspaceId` and stop there, which listed a
   * sub-folder beside its own parent and told a folder that only held sub-folders
   * that it was empty. `buildPickerTree` answers by parent, so a folder shows what
   * is actually inside it.
   */
  const tree = useMemo(() => buildPickerTree(folders, lists), [folders, lists]);

  /** A list row: the name, how much is in it, and whether it is on the panel. */
  const listOption = useCallback(
    (list: List): SheetOption => {
      const on = pinnedLists.has(list.id);
      return {
        key: list.id,
        label: list.title,
        description: t(pluralKey("lists.itemCount", list.itemCount), {
          count: list.itemCount,
        }),
        selected: on,
        onPress: () => onToggleList(list.id),
      };
    },
    [onToggleList, pinnedLists, t],
  );

  const body = useMemo(() => {
    // ---------------------------------------------------------------- the spaces
    if (here.kind === "root") {
      if (workspaces.length === 0) {
        return <EmptyState title={t("dashboard.pickerEmpty")} />;
      }
      return (
        <SheetOptions
          options={workspaces.map((space) => {
            const count = tree.listsOf(space.id, null).length;
            const carpetas = tree.childCountOf(space.id, null);
            return {
              key: space.id,
              label: space.name,
              description: `${t(pluralKey("folders.count", carpetas), {
                count: carpetas,
              })} · ${t(pluralKey("dashboard.listsCount", count), { count })}`,
              chevron: true,
              onPress: () => descend({ kind: "workspace", workspaceId: space.id }),
            };
          })}
        />
      );
    }

    // ----------------------------------------------------------------- a folder
    if (here.kind === "folder") {
      const dentro = tree.foldersOf(here.workspaceId, here.folderId);
      const listas = tree.listsOf(here.workspaceId, here.folderId);

      // Only empty when there is nothing to go into: a folder whose contents are
      // all one level down has somewhere to go, and saying "nothing here" is what
      // hid a whole branch of a space.
      if (dentro.length === 0 && listas.length === 0) {
        return <EmptyState title={t("dashboard.pickerEmpty")} />;
      }

      return (
        <>
          {dentro.length > 0 ? (
            <>
              <View style={SHEET_SECTION}>
                <SectionHeader title={t("folders.title")} />
              </View>
              <SheetOptions
                options={dentro.map((folder) => ({
                  key: folder.id,
                  label: folder.name,
                  description: t(pluralKey("folders.count", tree.childCountOf(here.workspaceId, folder.id)), {
                    count: tree.childCountOf(here.workspaceId, folder.id),
                  }),
                  chevron: true,
                  onPress: () =>
                    descend({
                      kind: "folder",
                      workspaceId: here.workspaceId,
                      folderId: folder.id,
                      parentId: here.folderId,
                    }),
                }))}
              />
            </>
          ) : null}

          {listas.length > 0 ? (
            <>
              {dentro.length > 0 ? (
                <View style={SHEET_SECTION}>
                  <SectionHeader title={t("dashboard.noFolder")} />
                </View>
              ) : null}
              <SheetOptions
                options={listas.map((list) => ({
                  ...listOption(list),
                  key: `${here.folderId}:${list.id}`,
                }))}
              />
            </>
          ) : null}
        </>
      );
    }

    // ------------------------------------------------------------- a whole space
    // The folders of this level, and the lists that are not in any folder. A list
    // inside a folder is reached through that folder, not from here.
    const spaceFolders = tree.foldersOf(here.workspaceId, null);
    const loose = tree.listsOf(here.workspaceId, null);

    if (spaceFolders.length === 0 && loose.length === 0) {
      return <EmptyState title={t("dashboard.pickerEmpty")} />;
    }

    return (
      <View style={{ gap: theme.spacing.xs }}>
        {spaceFolders.length > 0 ? (
          <>
            <SectionHeader
              title={t("folders.title")}
              style={SHEET_SECTION}
            />
            <SheetOptions
              options={spaceFolders.map((folder) => {
                const count = tree.listsOf(here.workspaceId, folder.id).length;
                const on = pinnedFolders.has(folder.id);
                return {
                  key: `folder:${folder.id}`,
                  label: folder.name,
                  description: t(pluralKey("dashboard.listsInside", count), {
                    count,
                  }),
                  // Two controls, because a folder is two things: the row is the
                  // door into it and the circle is putting it on the panel. See
                  // `SheetOption.trailingAction` — folding them into the one
                  // pressable made the row mean something different depending on
                  // whether the folder was already pinned.
                  chevron: true,
                  trailingAction: {
                    accessibilityLabel: `${folder.name}: ${
                      on ? t("dashboard.takeOffPanel") : t("dashboard.putOnPanel")
                    }`,
                    selected: on,
                    onPress: () => onToggleFolder(folder.id),
                  },
                  onPress: () =>
                    descend({
                      kind: "folder",
                      workspaceId: here.workspaceId,
                      folderId: folder.id,
                      // `null`, because these hang from the space itself. Without it
                      // the tree cannot answer what is inside this folder.
                      parentId: null,
                    }),
                };
              })}
            />
          </>
        ) : null}

        {loose.length > 0 ? (
          <>
            <SectionHeader
              title={t("dashboard.noFolder")}
              style={SHEET_SECTION}
            />
            <SheetOptions options={loose.map((list) => listOption(list))} />
          </>
        ) : null}

      </View>
    );
  }, [
    descend,
    here,
    listOption,
    onToggleFolder,
    pinnedFolders,
    t,
    theme.spacing.xs,
    tree,
    workspaces,
  ]);

  return (
    <View style={{ gap: theme.spacing.sm }}>
      {trail.length > 1 ? (
        <View style={styles.path}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("common.back")}
            hitSlop={10}
            onPress={goBack}
            style={({ pressed }) => [
              styles.back,
              {
                backgroundColor: theme.colors.surfaceMuted,
                borderRadius: theme.radius.pill,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <Ionicons name="chevron-back" size={18} color={theme.colors.text} />
          </Pressable>

          <View style={styles.crumbs}>
            {crumbs.map((label, index) => {
              const last = index === crumbs.length - 1;
              return (
                <Pressable
                  key={`${label}-${index}`}
                  accessibilityRole="button"
                  accessibilityLabel={label}
                  disabled={last}
                  hitSlop={6}
                  onPress={() => unwindTo(index)}
                >
                  <AppText variant="caption" tone={last ? "subtle" : "accent"}>
                    {label}
                  </AppText>
                  {last ? null : (
                    <Ionicons
                      name="chevron-forward"
                      size={11}
                      color={theme.colors.textSubtle}
                    />
                  )}
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}

      {body}

      {/*
        The notes, in their own section at the end and not among the lists.

        A note is not a folder's list and putting it among them meant going into
        a folder to find one that had no business being filed — which is every
        note somebody ever wrote. They are here, in one place, whatever folder
        they are in, and that is the whole of the rule: a list belongs somewhere
        and a note does not.

        **Outside the memo above**, which is the whole of why it is here and not
        there: every branch of that memo ends in a `return`, so anything written
        after them is code that never runs. A picker that counted nine notes and
        offered none of them is what that looks like from the outside.
      */}
      {notes.length > 0 && onToggleNote ? (
        <>
          <SectionHeader title={t("dashboard.notes")} style={SHEET_SECTION} />
          <SheetOptions
            options={notes.map((note) => ({
              key: note.id,
              label: note.title.length > 0 ? note.title : t("note.untitled"),
              description: notePreview(note).slice(0, 70),
              icon: "document-text-outline" as const,
              selected: pinnedNotes?.has(note.id) ?? false,
              onPress: () => onToggleNote(note.id),
            }))}
          />
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  path: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    // No horizontal inset: the sheet's body already has it. See `SHEET_SECTION`.
    paddingBottom: 2,
  },
  back: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
  },
  crumbs: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
    flex: 1,
  },
});
