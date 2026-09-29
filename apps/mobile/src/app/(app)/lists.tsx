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
import { useWorkspaces } from "@/hooks/use-workspaces";
import { LIST_KIND_ICON, LIST_KIND_LABEL } from "@/lib/lists/kind";
import { listPlacement, needsSpaceChoice } from "@/lib/lists/placement";
import { pluralKey, useTranslation } from "@/lib/i18n";
import { useTheme } from "@/theme";
import type { TranslationKey } from "@/lib/i18n";

const KIND_META: Record<
  ListKind,
  { icon: keyof typeof Ionicons.glyphMap; labelKey: TranslationKey }
> = Object.fromEntries(
  (Object.keys(LIST_KIND_ICON) as ListKind[]).map((kind) => [
    kind,
    { icon: LIST_KIND_ICON[kind], labelKey: LIST_KIND_LABEL[kind] },
  ]),
) as Record<
  ListKind,
  { icon: keyof typeof Ionicons.glyphMap; labelKey: TranslationKey }
>;

type Filter = ListKind | "all";

export default function ListsScreen() {
  const theme = useTheme();
  const t = useTranslation();
  const router = useRouter();
  const { workspaceId } = useLocalSearchParams<{ workspaceId?: string }>();

  const [filter, setFilter] = useState<Filter>("all");
  const [title, setTitle] = useState("");
  const [newKind, setNewKind] = useState<ListKind>("tasks");
  const [creating, setCreating] = useState(false);
  /**
   * El espacio donde se creará la lista cuando la ruta no dijo uno.
   *
   * Se elige de una vez, y no en el momento de crear: el formulario enseña el
   * destino antes de que nadie escriba el título, y una lista con el nombre
   * puesto y en el espacio equivocado es un trabajo repetido.
   */
  const [destino, setDestino] = useState<string | null>(null);

  const { workspaces } = useWorkspaces();
  const { lists, isLoading, createList } = useLists({ workspaceId });

  const visible = useMemo(
    () =>
      filter === "all" ? lists : lists.filter((list) => list.kind === filter),
    [filter, lists],
  );

  async function onCreate() {
    const trimmed = title.trim();
    if (trimmed.length === 0) return;

    const target = listPlacement({ workspaceId }, workspaces, destino);
    if (!target) return;

    setCreating(true);
    try {
      const id = await createList({
        workspaceId: target.workspaceId,
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
    <Screen width="grid">
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

      {/*
        A list belongs to a space, so the form needs one to put it in.

        It used to appear only when the route carried a space, and the route the
        menu uses — `/(app)/lists` — carries none: the menu is a flat list of
        everything, across spaces. So the one way into this screen from the menu
        had no form on it, and the screen said nothing about why. Somebody with
        five spaces and nothing filed was told to create a list and given no way
        to do it.

        So the form is always here, and the space is asked for only when the route
        did not say. One space is used without asking, the same rule as
        `WhereNoteSheet`; several is a question with a real answer.
      */}
      {(() => {
        // Sin ningún espacio no hay dónde ponerla, y el botón se apaga en vez de
        // dejar que se pulse para no pasar nada.
        const sinEspacio = !listPlacement({ workspaceId }, workspaces, destino);
        return (
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
            disabled={title.trim().length === 0 || sinEspacio}
          />

          {/*
            Solo cuando la ruta no trajo un espacio y hay más de uno entre los que
            elegir. Con uno solo se usa sin preguntar, porque preguntar por algo
            que ya no tiene otra respuesta es un formulario vacío.
          */}
          {needsSpaceChoice({ workspaceId }, workspaces) ? (
            <View style={{ gap: theme.spacing.xs }}>
              <AppText variant="caption" tone="subtle">
                {t("place.chooseSpace")}
              </AppText>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.xs }}>
                {workspaces.map((space) => (
                  <Button
                    key={space.id}
                    label={space.name}
                    variant={destino === space.id ? "primary" : "ghost"}
                    onPress={() => setDestino(space.id)}
                  />
                ))}
              </View>
            </View>
          ) : null}
        </Card>
        );
      })()}
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
