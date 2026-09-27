import { StyleSheet, View } from "react-native";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Sheet } from "@/components/ui/sheet";
import { TextField } from "@/components/ui/text-field";
import { useTranslation } from "@/lib/i18n";
import { useTheme } from "@/theme";

import { AppText } from "../ui/text";

export interface FiltersSheetProps {
  open: boolean;
  onClose: () => void;
  tags: { tag: string; count: number }[];
  selectedTags: string[];
  onToggleTag: (tag: string) => void;
  completed: "all" | "pending" | "done";
  onCompleted: (value: "all" | "pending" | "done") => void;
  text: string;
  onText: (value: string) => void;
  activeCount: number;
  onReset: () => void;
}

/**
 * What a list is showing: the labels, what is left to do, and a search.
 *
 * A panel rather than a row of chips above the list, because a shopping list
 * has a dozen labels and the chips would take more room than the items. It
 * opens with everything showing, because a filter that hides things the moment
 * it appears is one nobody trusts.
 */
export function FiltersSheet({
  open,
  onClose,
  tags,
  selectedTags,
  onToggleTag,
  completed,
  onCompleted,
  text,
  onText,
  activeCount,
  onReset,
}: FiltersSheetProps) {
  const theme = useTheme();
  const t = useTranslation();

  return (
    <Sheet
      visible={open}
      onClose={onClose}
      title={t("filters.title")}
      subtitle={
        activeCount > 0
          ? t("filters.active", { count: activeCount })
          : t("filters.none")
      }
    >
      <View
        style={{ gap: theme.spacing.lg, paddingHorizontal: theme.spacing.lg }}
      >
        <TextField
          label={t("filters.searchLabel")}
          value={text}
          onChangeText={onText}
          placeholder={t("filters.searchPlaceholder")}
          autoCapitalize="none"
          autoCorrect={false}
        />

        <View style={{ gap: theme.spacing.sm }}>
          <AppText variant="caption" tone="subtle">
            {t("filters.what")}
          </AppText>
          <View style={{ gap: theme.spacing.xs }}>
            {(["all", "pending", "done"] as const).map((value) => (
              <View
                key={value}
                style={[
                  styles.checkRow,
                  {
                    backgroundColor: theme.colors.surfaceMuted,
                    borderRadius: theme.radius.md,
                  },
                ]}
              >
                <Checkbox
                  checked={completed === value}
                  onToggle={() => onCompleted(value)}
                  label={t(`filters.show.${value}`)}
                />
              </View>
            ))}
          </View>
        </View>

        {tags.length > 0 ? (
          <View style={{ gap: theme.spacing.sm }}>
            <AppText variant="caption" tone="subtle">
              {t("filters.labels")}
            </AppText>
            <View style={[styles.labels, { gap: theme.spacing.sm }]}>
              {tags.map(({ tag, count }) => (
                <Button
                  key={tag}
                  label={`${tag} · ${count}`}
                  size="sm"
                  variant={selectedTags.includes(tag) ? "primary" : "secondary"}
                  fullWidth={false}
                  onPress={() => onToggleTag(tag)}
                />
              ))}
            </View>
          </View>
        ) : null}

        <Button
          label={t("filters.reset")}
          variant="ghost"
          icon="refresh"
          disabled={activeCount === 0}
          onPress={onReset}
        />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  labels: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  checkRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
});
