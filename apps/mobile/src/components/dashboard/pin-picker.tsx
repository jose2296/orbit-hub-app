import { Ionicons } from "@expo/vector-icons";
import { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import type { Folder, List, Workspace } from "@orbit-hub/contracts";

import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeader } from "@/components/ui/list-row";
import { SheetOptions } from "@/components/ui/sheet";
import type { SheetOption } from "@/components/ui/sheet";
import { AppText } from "@/components/ui/text";
import { pluralKey, useTranslation } from "@/lib/i18n";
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
 * `Sheet` insets its rows by eighteen points because that is where a row's label
 * starts, and a heading has no inset of its own, so without this the headings sit
 * hard against the edge of the sheet and everything below them is indented: the
 * one thing on screen that says "this group of rows belongs together" is the thing
 * not lined up with them.
 */
const SHEET_SECTION = { paddingHorizontal: 18, paddingTop: 10 } as const;

/** Where you are. The last entry is the level being shown. */type Stop =
  | { kind: "root" }
  | { kind: "workspace"; workspaceId: string }
  | { kind: "folder"; workspaceId: string; folderId: string };

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
}

export function PanelPicker({
  workspaces,
  folders,
  lists,
  pinnedLists,
  pinnedFolders,
  onToggleList,
  onToggleFolder,
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

  /** The lists of a space, and the ones of a folder inside it. */
  const listsOfWorkspace = useCallback(
    (workspaceId: string) => lists.filter((list) => list.workspaceId === workspaceId),
    [lists],
  );
  const foldersOfWorkspace = useCallback(
    (workspaceId: string) => folders.filter((folder) => folder.workspaceId === workspaceId),
    [folders],
  );

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
            const mine = listsOfWorkspace(space.id);
            const count = mine.length;
            return {
              key: space.id,
              label: space.name,
              description: `${t(
                pluralKey("folders.count", foldersOfWorkspace(space.id).length),
                { count: foldersOfWorkspace(space.id).length },
              )} · ${t(pluralKey("dashboard.listsCount", count), { count })}`,
              chevron: true,
              onPress: () => descend({ kind: "workspace", workspaceId: space.id }),
            };
          })}
        />
      );
    }

    // ----------------------------------------------------------------- a folder
    if (here.kind === "folder") {
      const inside = lists.filter((list) => list.folderId === here.folderId);
      if (inside.length === 0) {
        return <EmptyState title={t("dashboard.pickerEmpty")} />;
      }
      return (
        <SheetOptions
          options={inside.map((list) => ({
            ...listOption(list),
            key: `${here.folderId}:${list.id}`,
          }))}
        />
      );
    }

    // ------------------------------------------------------------- a whole space
    const spaceFolders = foldersOfWorkspace(here.workspaceId);
    const spaceLists = listsOfWorkspace(here.workspaceId);
    const loose = spaceLists.filter((list) => !list.folderId);

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
                const count = lists.filter((list) => list.folderId === folder.id).length;
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
    folders,
    foldersOfWorkspace,
    here,
    listOption,
    lists,
    listsOfWorkspace,
    onToggleFolder,
    pinnedFolders,
    t,
    theme.spacing.xs,
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
    </View>
  );
}

const styles = StyleSheet.create({
  path: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 18,
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
