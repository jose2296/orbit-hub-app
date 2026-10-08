import { Ionicons } from "@expo/vector-icons";
import { useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, View } from "react-native";

import { AppText } from "@/components/ui/text";
import { Sheet } from "@/components/ui/sheet";
import { TextField } from "@/components/ui/text-field";
import { useTranslation } from "@/lib/i18n";
import { buildMentionTree } from "@/lib/journal/mention-tree";
import type { TreeRow } from "@/lib/journal/mention-tree";
import { readMentionRecords } from "@/lib/journal/mention-records";
import type { MentionRecord } from "@/lib/journal/mention-model";
import { subscribeToLocalStore } from "@/lib/offline";
import { colorOf } from "@/lib/workspace/color";
import { useTheme } from "@/theme";
import type { MentionType } from "@orbit-hub/contracts";

/** What the person picked: enough to write the chip, nothing that can go stale. */
export interface MentionPick {
  type: MentionType;
  id: string;
  /** The name now. It becomes the copy the chip is made with. */
  name: string;
}

/** Indentation for each level of the tree, so a folder reads as inside its space. */
const INDENT = 18;

/**
 * The picker a note opens to mention something.
 *
 * It shows the app the way the person keeps it: a space, the folders in it, and
 * what is filed there, with the path kept for every hit. It reads the cache when
 * it opens and again when the cache changes, so it works without a connection.
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
  const [query, setQuery] = useState("");
  const [records, setRecords] = useState<MentionRecord[]>([]);

  useEffect(() => {
    if (!visible) {
      setQuery("");
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

  const rows = useMemo(() => buildMentionTree(records, query), [records, query]);

  return (
    <Sheet visible={visible} onClose={onClose} title={t("mention.pickerTitle")} scrollable={false}>
      <View style={{ gap: theme.spacing.sm, paddingBottom: theme.spacing.md }}>
        <TextField
          value={query}
          onChangeText={setQuery}
          placeholder={t("mention.searchPlaceholder")}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
        />
        <FlatList
          data={rows}
          keyExtractor={(item: TreeRow) => item.key}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={20}
          ListEmptyComponent={
            query.trim().length > 0 ? (
              <AppText variant="caption" tone="subtle">
                {t("mention.empty")}
              </AppText>
            ) : null
          }
          renderItem={({ item }: { item: TreeRow }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={item.name}
              onPress={() => onPick({ type: item.type, id: item.id, name: item.name })}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: theme.spacing.sm,
                minHeight: 46,
                paddingLeft: theme.spacing.md + item.depth * INDENT,
                paddingRight: theme.spacing.md,
                borderRadius: theme.radius.sm,
                backgroundColor: pressed ? theme.colors.surfaceSunken : "transparent",
              })}
            >
              {item.colour ? (
                <View
                  style={{
                    width: 4,
                    alignSelf: "stretch",
                    borderRadius: 2,
                    backgroundColor: colorOf(item.colour),
                  }}
                />
              ) : null}
              <AppText variant={item.type === "workspace" ? "bodyStrong" : "body"}>{item.icon}</AppText>
              <AppText numberOfLines={1} style={{ flex: 1 }} variant={item.type === "workspace" ? "bodyStrong" : "body"}>
                {item.name}
              </AppText>
              {item.type === "folder" ? (
                <Ionicons name="chevron-forward" size={14} color={theme.colors.textSubtle} />
              ) : null}
            </Pressable>
          )}
        />
      </View>
    </Sheet>
  );
}
