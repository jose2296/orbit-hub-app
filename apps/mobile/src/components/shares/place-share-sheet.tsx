import { Ionicons } from "@expo/vector-icons";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

import type { Share } from "@orbit-hub/contracts";

import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { AppText } from "@/components/ui/text";
import { useShares } from "@/hooks/use-shares";
import { useTranslation } from "@/lib/i18n";
import { useTheme } from "@/theme";

import { useSpacesTree } from "../layout/drawer";

const NODE_ICON: Record<Share["nodeType"], string> = {
  workspace: "grid-outline",
  folder: "folder-outline",
  list: "list-outline",
  list_item: "checkmark-circle-outline",
};

export interface PlaceShareSheetProps {
  /** The thing to file, or `null` when the panel is closed. */
  share: Share | null;
  onClose: () => void;
  onPlaced?: () => void;
}

/**
 * Where a received thing goes.
 *
 * The person who received it chooses, not the person who shared it, and that is
 * the whole reason this panel exists: somebody who is sent your shopping list
 * does not get to decide which of your spaces it lands in. The list appears in
 * your menu afterwards, next to your own, because that is what "in my space"
 * means once somebody has seen it.
 *
 * It is a link and not a copy, and this is the panel that says so out loud, once,
 * in the sentence right under the name. Somebody who does not know the
 * difference is the person who will be surprised in three months when the other
 * side deletes it and it goes from their phone too.
 */
export function PlaceShareSheet({ share, onClose, onPlaced }: PlaceShareSheetProps) {
  const theme = useTheme();
  const t = useTranslation();
  const { place } = useShares();
  const tree = useSpacesTree();

  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const spaces = useMemo(() => tree.spaces(), [tree]);

  if (!share) return null;

  const folders = workspaceId ? tree.foldersOf(workspaceId, folderId) : [];

  const confirmar = async () => {
    if (!workspaceId) return;
    setSaving(true);
    setError(null);
    try {
      await place({ shareId: share.id, workspaceId, folderId });
      onClose();
      onPlaced?.();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : t("errors.unknown"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      visible
      onClose={onClose}
      title={t("place.title")}
      subtitle={share.title}
      scrollable={false}
    >
      <View
        style={{
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: theme.spacing.md,
          gap: theme.spacing.md,
        }}
      >
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Ionicons
            name="people-outline"
            size={16}
            color={theme.colors.textMuted}
            style={{ marginTop: 2 }}
          />
          <AppText variant="caption" tone="muted" style={{ flex: 1 }}>
            {t("place.isALink")}
          </AppText>
        </View>

        <View style={{ gap: theme.spacing.xs }}>
          <AppText variant="caption" tone="subtle">
            {t("place.chooseSpace")}
          </AppText>
          <ScrollView style={{ maxHeight: 190 }} nestedScrollEnabled>
            <View style={{ gap: 2 }}>
              {spaces.map((space) => (
                <Pick
                  key={space.id}
                  icon="grid-outline"
                  label={space.name}
                  selected={workspaceId === space.id}
                  onPress={() => {
                    setWorkspaceId(space.id);
                    setFolderId(null);
                  }}
                />
              ))}
            </View>
          </ScrollView>
        </View>

        {workspaceId ? (
          <View style={{ gap: theme.spacing.xs }}>
            <AppText variant="caption" tone="subtle">
              {t("place.chooseFolder")}
            </AppText>
            <ScrollView style={{ maxHeight: 150 }} nestedScrollEnabled>
              <View style={{ gap: 2 }}>
                {/* The root of the space is a place, not "nowhere": a thing at the
                    top of a space is filed, and the only reason to have this
                    button is to undo a folder that was picked by mistake. */}
                <Pick
                  icon="ellipsis-horizontal-circle-outline"
                  label={t("place.rootOfSpace")}
                  selected={folderId === null}
                  onPress={() => setFolderId(null)}
                />
                {folders.map((folder) => (
                  <Pick
                    key={folder.id}
                    icon="folder-outline"
                    label={folder.name}
                    selected={false}
                    onPress={() => setFolderId(folder.id)}
                  />
                ))}
              </View>
            </ScrollView>
          </View>
        ) : null}

        {error ? (
          <AppText variant="caption" style={{ color: theme.colors.danger }}>
            {error}
          </AppText>
        ) : null}

        <View style={{ gap: theme.spacing.sm }}>
          <Button
            label={saving ? t("place.saving") : t("place.confirm")}
            disabled={!workspaceId || saving}
            fullWidth
            onPress={() => void confirmar()}
          />
          <Button
            label={t("common.cancel")}
            variant="ghost"
            fullWidth
            onPress={onClose}
          />
        </View>
      </View>
    </Sheet>
  );
}

function Pick({
  icon,
  label,
  selected,
  onPress,
}: {
  icon: string;
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        minHeight: 38,
        paddingHorizontal: theme.spacing.sm,
        borderRadius: theme.radius.md,
        backgroundColor: selected
          ? theme.colors.accentSoft
          : pressed
            ? theme.colors.surfaceMuted
            : "transparent",
      })}
    >
      <Ionicons
        name={icon as never}
        size={16}
        color={selected ? theme.colors.accent : theme.colors.textMuted}
      />
      <AppText
        variant="body"
        numberOfLines={1}
        style={{ flex: 1, color: selected ? theme.colors.accent : undefined }}
      >
        {label}
      </AppText>
    </Pressable>
  );
}

export { NODE_ICON };
