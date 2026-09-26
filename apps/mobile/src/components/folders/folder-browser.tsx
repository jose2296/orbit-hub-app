import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useMemo } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import type { List } from "@orbit-hub/contracts";

import { pluralKey, useTranslation } from "@/lib/i18n";
import { LIST_KIND_ICON } from "@/lib/lists/kind";
import { useTheme } from "@/theme";

import { AppText } from "../ui/text";
import { EmptyState } from "../ui/empty-state";

export interface FolderBrowserProps {
  workspaceId: string;
  /** `null` is the space itself, which is the root folder. */
  folderId: string | null;
  /** Every folder of the space, flat. */
  folders: {
    id: string;
    name: string;
    emoji: string | null;
    parentId: string | null;
    position: number;
  }[];
  /** Only the lists of this folder. */
  lists: List[];
  isLoading: boolean;
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
  onFolderMenu,
  onListMenu,
}: FolderBrowserProps) {
  const theme = useTheme();
  const t = useTranslation();
  const router = useRouter();

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
              <Pressable
                key={folder.id}
                accessibilityRole="button"
                accessibilityLabel={folder.name}
                onPress={() => openFolder(folder.id)}
                onLongPress={() => onFolderMenu(folder)}
                style={({ pressed }) => [
                  styles.row,
                  {
                    backgroundColor: pressed
                      ? theme.colors.surfaceMuted
                      : theme.colors.surface,
                    borderColor: theme.colors.border,
                    borderRadius: theme.radius.lg,
                    gap: theme.spacing.md,
                    padding: theme.spacing.md,
                  },
                ]}
              >
                <AppText variant="body">{folder.emoji ?? ""}</AppText>
                <AppText
                  variant="bodyStrong"
                  style={styles.flex}
                  numberOfLines={1}
                >
                  {folder.name}
                </AppText>
                <Ionicons
                  name="chevron-forward"
                  size={16}
                  color={theme.colors.textSubtle}
                />
              </Pressable>
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
              <Pressable
                key={list.id}
                accessibilityRole="button"
                accessibilityLabel={list.title}
                onPress={() => router.push(`/(app)/list/${list.id}`)}
                onLongPress={() => onListMenu(list)}
                style={({ pressed }) => [
                  styles.row,
                  {
                    backgroundColor: pressed
                      ? theme.colors.surfaceMuted
                      : theme.colors.surface,
                    borderColor: theme.colors.border,
                    borderRadius: theme.radius.lg,
                    gap: theme.spacing.md,
                    padding: theme.spacing.md,
                  },
                ]}
              >
                <View
                  style={[
                    styles.icon,
                    {
                      backgroundColor: theme.colors.accentSoft,
                      borderRadius: theme.radius.md,
                    },
                  ]}
                >
                  <Ionicons
                    name={KIND_ICON[list.kind] ?? "list-outline"}
                    size={16}
                    color={theme.colors.accentSoftText}
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
                {list.favorite ? (
                  <Ionicons
                    name="bookmark"
                    size={14}
                    color={theme.colors.accent}
                  />
                ) : null}
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
    </View>
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
