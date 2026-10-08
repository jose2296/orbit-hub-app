import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { FlatList, Pressable, View } from "react-native";

import { AppText } from "@/components/ui/text";
import { Sheet } from "@/components/ui/sheet";
import { TextField } from "@/components/ui/text-field";
import { useLocalSearch } from "@/hooks/use-lists";
import type { BookmarkSearchResult } from "@/hooks/use-lists";
import { useTranslation } from "@/lib/i18n";
import { useTheme } from "@/theme";
import type { MentionType, SearchResult } from "@orbit-hub/contracts";

/** What the person picked: enough to write the chip, nothing that can go stale. */
export interface MentionPick {
  type: MentionType;
  id: string;
  /** The name now. It becomes the copy the chip is made with. */
  name: string;
}

type Hit = SearchResult | BookmarkSearchResult;

/**
 * Which search hits can be mentioned, and as what.
 *
 * `list_item` is left out on purpose: a task is inside a list and a chip to it
 * would open the list, which is not what the word on the chip says. A board is a
 * list, so it comes in as `list` and opens as a board.
 */
export function mentionTypeOf(hit: Hit): MentionType | null {
  switch (hit.scope) {
    case "workspace":
      return "workspace";
    case "folder":
      return "folder";
    case "list":
      return "list";
    case "note":
      return "note";
    case "bookmark":
      return "bookmark";
    default:
      return null;
  }
}

const SCOPE_ICON: Record<MentionType, keyof typeof Ionicons.glyphMap> = {
  workspace: "albums-outline",
  folder: "folder-outline",
  list: "list-outline",
  note: "document-text-outline",
  bookmark: "bookmark-outline",
};

/**
 * The picker a note opens to mention something.
 *
 * It is the global search, narrowed to what can be linked, so it is as fast as
 * the search and works without a connection for the same reason it does.
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
  const { results, search } = useLocalSearch();
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!visible) setQuery("");
  }, [visible]);

  useEffect(() => {
    void search(query);
  }, [query, search]);

  const linkable = results.flatMap((hit) => {
    const type = mentionTypeOf(hit);
    return type === null ? [] : [{ type, id: hit.id, name: hit.title }];
  });

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={t("mention.pickerTitle")}
      scrollable={false}
    >
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
          data={linkable}
          keyExtractor={(item) => `${item.type}:${item.id}`}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            query.trim().length >= 2 ? (
              <AppText variant="caption" tone="subtle">
                {t("mention.empty")}
              </AppText>
            ) : null
          }
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={item.name}
              onPress={() => onPick(item)}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: theme.spacing.sm,
                minHeight: 48,
                paddingHorizontal: theme.spacing.md,
                borderRadius: theme.radius.sm,
                backgroundColor: pressed ? theme.colors.surfaceSunken : "transparent",
              })}
            >
              <Ionicons name={SCOPE_ICON[item.type]} size={18} color={theme.colors.textMuted} />
              <AppText numberOfLines={1} style={{ flex: 1 }}>
                {item.name}
              </AppText>
            </Pressable>
          )}
        />
      </View>
    </Sheet>
  );
}
