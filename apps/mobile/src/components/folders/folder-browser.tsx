import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useMemo } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import type { Folder, List, WorkspaceWash } from "@orbit-hub/contracts";

import { pluralKey, useTranslation } from "@/lib/i18n";
import { LIST_KIND_ICON } from "@/lib/lists/kind";
import { spacePaint, spaceTint } from "@/lib/workspace/color";
import { useTheme } from "@/theme";

import { AppText } from "../ui/text";
import { EmptyState } from "../ui/empty-state";

export interface FolderBrowserProps {
  workspaceId: string;
  /** `null` is the space itself, which is the root folder. */
  folderId: string | null;
  /**
   * Every folder of the space, flat.
   *
   * The whole record and not the four fields this screen draws: the menu that
   * opens from here needs the version to delete with, and a caller that has to
   * narrow a record down to get a callback to work is how a field gets lost.
   */
  folders: Folder[];
  /** Only the lists of this folder. */
  lists: List[];
  isLoading: boolean;
  /**
   * The colour of the space this folder is in.
   *
   * It is a prop and not something the browser works out, because a folder record
   * does not know which space it is in: the screen above has both and the folder
   * is only ever shown inside one of them. Every row below is drawn in it, so a
   * folder and the lists inside it are the same colour as the space they are in
   * and not a row of identical grey cards with the space named in a header.
   */
  colorKey?: string | null;
  /**
   * Which of the five ways the space is painted.
   *
   * A prop beside the colour and not something this file derives: the browser
   * draws the space's wash on every row, and a default here would repaint every
   * space that chose a style in the diagonal the rows underneath the band no
   * longer match.
   */
  wash?: WorkspaceWash | null;
  /**
   * The colour the space ends in, which is the person's own second choice.
   *
   * Beside the wash and not derived here, for the reason the wash is a prop: a
   * browser that only knows the first colour paints the derived pair, and the
   * rows underneath the band then disagree with the picker that set it.
   */
  colorTo?: string | null;
  /** Opens the menu of a folder. */
  onFolderMenu: (folder: FolderBrowserProps["folders"][number]) => void;
  /** Opens the menu of a list. */
  onListMenu: (list: List) => void;
}

const KIND_ICON = LIST_KIND_ICON;

/**
 * One level of a space, seen as a tree of folders.
 *
 * A space is a folder, so a list is never floating at the top of nowhere: it is
 * in the space or in a folder of it, and going into a folder is a new screen
 * rather than a section that expands. That is what makes the back button mean
 * something: one press leaves the level you are in, all the way up to the
 * space, and never further.
 */
export function FolderBrowser({
  workspaceId,
  folderId,
  folders,
  lists,
  isLoading,
  colorKey,
  wash,
  colorTo,
  onFolderMenu,
  onListMenu,
}: FolderBrowserProps) {
  const theme = useTheme();
  const t = useTranslation();
  const router = useRouter();

  /**
   * The wash of the space, for the rows below.
   *
   * A wash and not a solid colour on every row: forty rows of full-strength space
   * colour is a wall, and a space you can no longer read anything on is a space
   * that has stopped being a way of telling things apart. The mark is at full
   * strength and the row itself is barely tinted.
   */
  // `undefined` and not `null` because the paint layer takes "no choice made" as
  // absent and falls back to the default; a prop that is optional has to be able
  // to say the same thing the screen it came from says.
  const paint = spacePaint(colorKey, wash ?? undefined, colorTo);

  /*
   * The flat steps of that same colour, for the rows and for the icon tiles.
   *
   * Two, and not one, because a tile behind a sixteen-point glyph is read against
   * the glyph and a row is read against a line of text: the tile can carry more of
   * the colour before it stops being a backdrop and starts competing with what is
   * on it. The wash was doing neither job, which is why it went.
   */
  const tint = spaceTint(colorKey, 0.13);
  const iconTint = spaceTint(colorKey, 0.24);

  const children = useMemo(
    () =>
      folders
        .filter((folder) => folder.parentId === folderId)
        .sort(
          (a, b) => a.position - b.position || a.name.localeCompare(b.name),
        ),
    [folders, folderId],
  );

  const here = useMemo(
    () =>
      lists
        .filter((list) => (list.folderId ?? null) === folderId)
        .sort((a, b) => a.title.localeCompare(b.title)),
    [lists, folderId],
  );

  const openFolder = (id: string) => {
    router.push({
      pathname: "/(app)/workspace/[workspaceId]/folder/[folderId]",
      params: { workspaceId, folderId: id },
    });
  };

  if (isLoading) {
    return (
      <View style={{ paddingVertical: theme.spacing.xl }}>
        <AppText variant="callout" tone="muted" align="center">
          {t("common.loading")}
        </AppText>
      </View>
    );
  }

  if (children.length === 0 && here.length === 0) {
    return (
      <EmptyState
        title={t("folders.empty.title")}
        description={t("folders.empty.body")}
      />
    );
  }

  return (
    <View style={{ gap: theme.spacing.lg }}>
      {children.length > 0 ? (
        <View style={{ gap: theme.spacing.sm }}>
          <SectionTitle
            label={t(pluralKey("folders.count", children.length), {
              count: children.length,
            })}
          />
          <View style={{ gap: theme.spacing.xs }}>
            {children.map((folder) => (
              <View key={folder.id} style={styles.holder}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={folder.name}
                  onPress={() => openFolder(folder.id)}
                  style={({ pressed }) => [
                    styles.row,
                    {
                      backgroundColor: pressed
                        ? theme.colors.surfaceMuted
                        : tint,
                      borderColor: theme.colors.border,
                      borderRadius: theme.radius.lg,
                      gap: theme.spacing.md,
                      padding: theme.spacing.md,
                      paddingRight: 52,
                    },
                  ]}
                >
                  {/*
                    The kind of thing this is, on the colour of the space it is
                    in, and drawn like the list rows below it.

                    It was a 📁 emoji in this circle and an `Ionicons` glyph in
                    the list rows, which made the folder the only row on the
                    screen with a picture in it: multicoloured, filled, a
                    different optical weight from the line icons around it, and
                    the one row whose colour had nothing to do with the space. A
                    folder is a place and not a kind of thing, so it gets the
                    plain outline — the same one the drawer and the "where does
                    this go" sheet already use for a folder, which is the point:
                    one symbol, three screens.
                  */}
                  <View
                    style={[
                      styles.icon,
                      { borderRadius: theme.radius.md, backgroundColor: iconTint },
                    ]}
                  >
                    <Ionicons
                      name="folder-outline"
                      size={16}
                      color={paint.foreground}
                    />
                  </View>
                  {/*
                    The person's own emoji, beside the name and not instead of
                    it — which is where a list puts it too, so the two kinds of
                    row read as the same kind of row. A folder that only ever
                    looked like a folder would quietly throw away the name
                    somebody gave it to look like something else.
                  */}
                  <AppText
                    variant="bodyStrong"
                    style={styles.flex}
                    numberOfLines={1}
                  >
                    {folder.emoji ? `${folder.emoji} ` : ""}
                    {folder.name}
                  </AppText>
                </Pressable>
                <MenuButton
                  label={t("rowActions.menuOf", { name: folder.name })}
                  onPress={() => onFolderMenu(folder)}
                />
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {here.length > 0 ? (
        <View style={{ gap: theme.spacing.sm }}>
          <SectionTitle
            label={t(pluralKey("lists.itemCount", here.length), {
              count: here.length,
            })}
          />
          <View style={{ gap: theme.spacing.xs }}>
            {here.map((list) => (
              <View key={list.id} style={styles.holder}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={list.title}
                  onPress={() => router.push(`/(app)/list/${list.id}`)}
                  style={({ pressed }) => [
                    styles.row,
                    {
                      backgroundColor: pressed
                        ? theme.colors.surfaceMuted
                        : tint,
                      borderColor: theme.colors.border,
                      borderRadius: theme.radius.lg,
                      gap: theme.spacing.md,
                      padding: theme.spacing.md,
                      paddingRight: 52,
                    },
                  ]}
                >
                  {/* The kind of the list, on the colour of the space it is in.
                      It was the accent, and the accent is the colour of *this
                      app's* actions: two lists of the same kind in two spaces
                      looked identical, and a list is a thing you find by the
                      space it is in. */}
                  <View
                      style={[styles.icon, { borderRadius: theme.radius.md, backgroundColor: iconTint }]}
                    >
                      <Ionicons
                      name={KIND_ICON[list.kind] ?? "list-outline"}
                      size={16}
                      color={paint.foreground}
                    />
                    </View>
                  <View style={[styles.flex, { gap: 2 }]}>
                    <AppText variant="bodyStrong" numberOfLines={1}>
                      {list.emoji ? `${list.emoji} ` : ""}
                      {list.title}
                    </AppText>
                    <AppText variant="caption" tone="subtle">
                      {t(pluralKey("lists.itemCount", list.itemCount), {
                        count: list.itemCount,
                      })}
                    </AppText>
                  </View>
                  
                </Pressable>
                <MenuButton
                  label={t("rowActions.menuOf", { name: list.title })}
                  onPress={() => onListMenu(list)}
                />
              </View>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

/**
 * The menu of a row.
 *
 * A visible button and not only a long press on the row: a long press is a
 * gesture nobody discovers, a mouse has no way to do one at all, and what it
 * opens is a menu and not a gesture. It sits over the row and is its own
 * control, because a button inside a button is one control to a screen reader
 * and the tap lands on the outer one.
 */
function MenuButton({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [
        styles.menu,
        {
          backgroundColor: theme.colors.surfaceMuted,
          borderRadius: theme.radius.sm,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <Ionicons
        name="ellipsis-horizontal"
        size={16}
        color={theme.colors.text}
      />
    </Pressable>
  );
}

function SectionTitle({ label }: { label: string }) {
  return (
    <AppText variant="caption" tone="subtle" style={{ letterSpacing: 0.6 }}>
      {label.toUpperCase()}
    </AppText>
  );
}

const styles = StyleSheet.create({
  holder: {
    position: "relative",
  },
  menu: {
    position: "absolute",
    top: 10,
    right: 10,
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
  },
  icon: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  flex: {
    flex: 1,
  },
});
