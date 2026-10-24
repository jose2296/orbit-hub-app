import { useMemo, useState } from "react";
import { ScrollView, View } from "react-native";

import { AppText } from "@/components/ui/text";
import { Pick } from "@/components/workspace/place-picker";
import { useSpacesTree } from "@/hooks/use-spaces-tree";
import { useTranslation } from "@/lib/i18n";
import { useTheme } from "@/theme";

/**
 * Pick a task list the way the app asks "where": the spaces first, a tap on one shows what is
 * inside it, a tap on a folder goes one level deeper, and so on until a list is reached. Same
 * rows and same data as the sheets of the app.
 */
export function ListPicker({
  onPick,
  emptyLabel,
}: {
  onPick: (listId: string) => void;
  emptyLabel: string;
}) {
  const theme = useTheme();
  const t = useTranslation();
  const tree = useSpacesTree();
  const spaces = useMemo(() => tree.spaces(), [tree]);
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [folderId, setFolderId] = useState<string | null>(null);

  const activeSpace = spaceId ?? (spaces.length === 1 ? (spaces[0]?.id ?? null) : null);
  const folders = activeSpace ? tree.foldersOf(activeSpace, folderId) : [];
  const lists = (activeSpace ? tree.listsOf(activeSpace, folderId) : []).filter(
    (list) => list.kind === "tasks",
  );
  const spaceName = spaces.find((space) => space.id === activeSpace)?.name ?? "";
  const trail = folderId ? tree.pathOf(folderId) : [];

  const goUp = () => {
    if (folderId) setFolderId(tree.parentOf(folderId)?.id ?? null);
    else setSpaceId(null);
  };

  return (
    <ScrollView contentContainerStyle={{ gap: theme.spacing.xs, paddingBottom: theme.spacing.lg }}>
      {activeSpace === null ? (
        <>
          <AppText variant="caption" tone="subtle">
            {t("place.chooseSpace")}
          </AppText>
          {spaces.map((space) => (
            <Pick
              key={space.id}
              icon="grid-outline"
              label={space.name}
              selected={false}
              onPress={() => setSpaceId(space.id)}
            />
          ))}
        </>
      ) : (
        <>
          <AppText variant="caption" tone="muted">
            {[spaceName, ...trail.map((folder) => folder.name)].join(" / ")}
          </AppText>
          {spaces.length > 1 || folderId ? (
            <Pick
              icon="arrow-up-outline"
              label={t("place.upOneLevel")}
              selected={false}
              onPress={goUp}
            />
          ) : null}
          {folders.map((folder) => (
            <Pick
              key={folder.id}
              icon="folder-outline"
              label={folder.name}
              selected={false}
              onPress={() => setFolderId(folder.id)}
            />
          ))}
          {lists.map((list) => (
            <Pick
              key={list.id}
              icon="checkbox-outline"
              label={list.title}
              selected={false}
              onPress={() => onPick(list.id)}
            />
          ))}
          {folders.length === 0 && lists.length === 0 ? (
            <View style={{ paddingVertical: theme.spacing.md }}>
              <AppText variant="body" tone="muted">
                {emptyLabel}
              </AppText>
            </View>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}
