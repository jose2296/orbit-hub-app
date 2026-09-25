import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import type { ListKind } from "@orbit-hub/contracts";

import { Segmented } from "@/components/ui/segmented";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Divider } from "@/components/ui/divider";
import { EmptyState } from "@/components/ui/empty-state";
import { Screen } from "@/components/ui/screen";
import { AppText } from "@/components/ui/text";
import { TextField } from "@/components/ui/text-field";
import { useLists } from "@/hooks/use-lists";
import { pluralKey, useTranslation } from "@/lib/i18n";
import { useTheme } from "@/theme";
import type { TranslationKey } from "@/lib/i18n";

const KIND_META: Record<
  ListKind,
  { icon: keyof typeof Ionicons.glyphMap; labelKey: TranslationKey }
> = {
  tasks: { icon: "checkbox-outline", labelKey: "lists.kind.tasks" },
  movies: { icon: "film-outline", labelKey: "lists.kind.movies" },
  books: { icon: "book-outline", labelKey: "lists.kind.books" },
};

type Filter = ListKind | "all";

export default function ListsScreen() {
  const theme = useTheme();
  const t = useTranslation();
  const router = useRouter();
  const { workspaceId } = useLocalSearchParams<{ workspaceId: string }>();

  const [filter, setFilter] = useState<Filter>("all");
  const [title, setTitle] = useState("");
  const [newKind, setNewKind] = useState<ListKind>("tasks");
  const [creating, setCreating] = useState(false);

  const { lists, isLoading, createList } = useLists({ workspaceId });

  const visible = useMemo(
    () =>
      filter === "all" ? lists : lists.filter((list) => list.kind === filter),
    [filter, lists],
  );

  async function onCreate() {
    const trimmed = title.trim();
    if (trimmed.length === 0 || !workspaceId) return;

    setCreating(true);
    try {
      const id = await createList({
        workspaceId,
        title: trimmed,
        kind: newKind,
      });
      setTitle("");
      router.push(`/(app)/list/${id}`);
    } finally {
      setCreating(false);
    }
  }

  return (
    <Screen>
      <View style={{ gap: theme.spacing.md }}>
        <Segmented<Filter>
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: t("lists.filter.all") },
            { value: "tasks", label: t("lists.kind.tasks") },
            { value: "movies", label: t("lists.kind.movies") },
            { value: "books", label: t("lists.kind.books") },
          ]}
        />
      </View>

      {isLoading ? (
        <Card variant="muted">
          <AppText variant="callout" tone="muted" align="center">
            {t("common.loading")}
          </AppText>
        </Card>
      ) : visible.length === 0 ? (
        <Card padded={false}>
          <EmptyState
            title={t("lists.empty.title")}
            description={t("lists.empty.body")}
          />
        </Card>
      ) : (
        <Card padded={false}>
          {visible.map((list, index) => (
            <View key={list.id}>
              {index > 0 ? <Divider inset={56} /> : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={list.title}
                onPress={() => router.push(`/(app)/list/${list.id}`)}
                style={({ pressed }) => [
                  styles.row,
                  {
                    gap: theme.spacing.md,
                    padding: theme.spacing.lg,
                    opacity: pressed ? 0.85 : 1,
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
                    name={KIND_META[list.kind].icon}
                    size={20}
                    color={theme.colors.accentSoftText}
                  />
                </View>

                <View style={styles.flex}>
                  <AppText variant="bodyStrong">
                    {list.emoji ? `${list.emoji} ` : ""}
                    {list.title}
                  </AppText>
                  <View style={[styles.meta, { gap: theme.spacing.sm }]}>
                    <Badge
                      label={t(KIND_META[list.kind].labelKey)}
                      tone="neutral"
                    />
                    <AppText variant="caption" tone="muted">
                      {t(pluralKey("lists.itemCount", list.itemCount), {
                        count: list.itemCount,
                      })}
                    </AppText>
                  </View>
                </View>

                {list.favorite ? (
                  <Ionicons
                    name="bookmark"
                    size={16}
                    color={theme.colors.accent}
                  />
                ) : null}
                <Ionicons
                  name="chevron-forward"
                  size={18}
                  color={theme.colors.textSubtle}
                />
              </Pressable>
            </View>
          ))}
        </Card>
      )}

      {/* A list belongs to a space, so the form only appears where there is one
          to put it in. */}
      {workspaceId ? (
        <Card variant="muted" style={{ gap: theme.spacing.md }}>
          <AppText variant="callout" tone="muted">
            {t("lists.createHint")}
          </AppText>
          <Segmented<ListKind>
            label={t("lists.kindLabel")}
            value={newKind}
            onChange={setNewKind}
            options={(Object.keys(KIND_META) as ListKind[]).map((kind) => ({
              value: kind,
              label: t(KIND_META[kind].labelKey),
            }))}
          />
          <TextField
            label={t("lists.titleLabel")}
            value={title}
            onChangeText={setTitle}
            placeholder={t("lists.titlePlaceholder")}
            autoCapitalize="sentences"
            returnKeyType="done"
            onSubmitEditing={() => void onCreate()}
          />
          <Button
            label={t("lists.create")}
            icon="add"
            onPress={() => void onCreate()}
            loading={creating}
            disabled={title.trim().length === 0}
          />
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
  },
  flex: {
    flex: 1,
  },
  icon: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  meta: {
    flexDirection: "row",
    alignItems: "center",
  },
});
