import { Ionicons } from "@expo/vector-icons";
import { useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, View } from "react-native";

import { ListRow } from "@/components/ui/list-row";
import { AppIcon } from "@/components/ui/app-icon";
import { AppText } from "@/components/ui/text";
import { Sheet } from "@/components/ui/sheet";
import { useTranslation } from "@/lib/i18n";
import { readMentionRecords } from "@/lib/journal/mention-records";
import { iconTextOf } from "@/lib/journal/mention-model";
import type { MentionRecord } from "@/lib/journal/mention-model";
import { levelOf, levelRows } from "@/lib/journal/mention-tree";
import type { LevelRow, PickerLevel } from "@/lib/journal/mention-tree";
import { subscribeToLocalStore } from "@/lib/offline";
import { colorOf } from "@/lib/workspace/color";
import { useTheme } from "@/theme";
import type { MentionType } from "@orbit-hub/contracts";

/** What the person picked: enough to write the chip, and to paint it as it is born. */
export interface MentionPick {
  type: MentionType;
  id: string;
  /** The name now. It becomes the copy the chip is made with. */
  name: string;
  /** The icon the target has now: the emoji it was given, or its type's. */
  icon: string;
  /** The colour of the space it is in, which is what the chip is painted with. */
  colour: string | null;
}

/**
 * The picker a note opens to mention something.
 *
 * It opens on the spaces, all of them closed. Pressing a space or a folder goes into
 * it, with a way back up the path, the way the create sheets of the dashboard do.
 * Only the level on screen is open, so there is never more than one path showing.
 * Picking a thing closes the picker; the caller puts the cursor back in the note.
 */
export function MentionPickerSheet({
  visible,
  onClose,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (pick: MentionPick) => void;
}) {
  const theme = useTheme();
  const t = useTranslation();
  const [records, setRecords] = useState<MentionRecord[]>([]);
  // The path into the picker. Empty is the list of spaces.
  const [path, setPath] = useState<PickerLevel[]>([]);

  useEffect(() => {
    if (!visible) {
      setPath([]);
      return;
    }
    let active = true;
    const load = async () => {
      const next = await readMentionRecords();
      if (active) setRecords(next);
    };
    void load();
    const unsubscribe = subscribeToLocalStore(() => {
      void load();
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [visible]);

  const level: PickerLevel = path.length === 0 ? null : (path[path.length - 1] ?? null);
  const rows = useMemo(() => levelRows(records, level), [records, level]);
  const here = useMemo(
    () => records.find((record) => `${record.type === "workspace" ? "space" : "folder"}:${record.id}` === level),
    [records, level],
  );

  const enter = (row: LevelRow) => {
    const next = levelOf(row);
    if (next !== null) setPath((current) => [...current, next]);
  };
  const up = () => setPath((current) => current.slice(0, -1));

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={t("mention.pickerTitle")}
      scrollable={false}
    >
      <View style={{ gap: theme.spacing.sm, paddingBottom: theme.spacing.md }}>
        {level === null ? null : (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: theme.spacing.xs,
              minHeight: 44,
            }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("mention.back")}
              onPress={up}
              hitSlop={8}
              style={{ width: 36, height: 36, alignItems: "center", justifyContent: "center" }}
            >
              <Ionicons name="chevron-back" size={20} color={theme.colors.textMuted} />
            </Pressable>
            <AppText variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
              {here?.name ?? ""}
            </AppText>
            {here ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("mention.pickThis")}
                onPress={() =>
                  onPick({
                    type: here.type,
                    id: here.id,
                    name: here.name,
                    icon: iconTextOf(here),
                    colour: here.colour,
                  })
                }
                style={{
                  paddingHorizontal: theme.spacing.sm,
                  height: 32,
                  borderRadius: theme.radius.pill,
                  justifyContent: "center",
                  backgroundColor: theme.colors.accentSoft,
                }}
              >
                <AppText variant="caption" style={{ color: theme.colors.accentSoftText }}>
                  {t("mention.pickThis")}
                </AppText>
              </Pressable>
            ) : null}
          </View>
        )}

        <FlatList
          data={rows}
          keyExtractor={(item: LevelRow) => item.key}
          initialNumToRender={20}
          ListEmptyComponent={
            <AppText variant="caption" tone="subtle">
              {t("mention.empty")}
            </AppText>
          }
          renderItem={({ item }: { item: LevelRow }) => (
            <ListRow
              title={item.iconRef ? item.name : `${item.icon} ${item.name}`}
              chevron={item.enters}
              onPress={() =>
                item.enters
                  ? enter(item)
                  : onPick({
                      type: item.type,
                      id: item.id,
                      name: item.name,
                      icon: item.icon,
                      colour: item.colour,
                    })
              }
              leading={
                item.iconRef || item.colour ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing.sm }}>
                    {item.iconRef ? <AppIcon icon={item.iconRef} size={20} /> : null}
                    {item.colour ? (
                      <View
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: 4,
                          backgroundColor: colorOf(item.colour),
                        }}
                      />
                    ) : null}
                  </View>
                ) : undefined
              }
            />
          )}
        />
      </View>
    </Sheet>
  );
}
