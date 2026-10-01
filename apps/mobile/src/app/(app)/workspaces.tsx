import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";

import type { Workspace } from "@orbit-hub/contracts";

import { Badge } from "@/components/ui/badge";
import { useLongPressName } from "@/hooks/use-long-press-text";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FloatingButton } from "@/components/ui/floating-button";
import { Screen } from "@/components/ui/screen";
import { SectionHeader } from "@/components/ui/list-row";
import { AppText } from "@/components/ui/text";
import { SpaceWash } from "@/components/ui/wash";
import { WorkspaceCreateSheet } from "@/components/workspace/workspace-create-sheet";
import { useWorkspaces } from "@/hooks/use-workspaces";
import { pluralKey, useTranslation } from "@/lib/i18n";
import { useTheme } from "@/theme";

const ROLE_TONE: Record<Workspace["role"], "accent" | "neutral"> = {
  owner: "accent",
  editor: "accent",
  viewer: "neutral",
};

export default function WorkspacesScreen() {

  /*
    The whole of a space's name on a long press, **on the tile's own press**.

    One hook for the screen and not one per tile, because a hook cannot be called
    once per item inside a loop. A `Pressable` around the name would take the
    gesture away from the tile on a phone and the tile would stop opening, which
    the web cannot show because a click bubbles and both fire. See
    `useLongPressName`.
  */
  const nombreLargo = useLongPressName();
  const theme = useTheme();
  const t = useTranslation();
  const router = useRouter();
  const { workspaces, isLoading, refresh } = useWorkspaces();

  // Whether the form is open. The form itself lives in its own component: it is
  // the same form the menu of a space opens, and the two have to stay the same
  // form, so there is one of it.
  const [creating, setCreating] = useState(false);

  // Every visit syncs in the background; the list itself comes from the cache.
  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  return (
    <Screen
      width="grid"
      overlay={
        <FloatingButton
          label={t("workspaces.create")}
          onPress={() => setCreating(true)}
        />
      }
    >
      {/*
        No title and no description of its own. The header above says what this
        is, and saying it again one centimetre lower is the screen talking over
        itself: "Espacios de trabajo" twice, then a line about projects having
        their own place, before a single space has been looked at. The screen
        starts with the list.
      */}
      <View style={{ gap: theme.spacing.md }}>
        <SectionHeader
          title={t("workspaces.yours")}
          subtitle={t(pluralKey("workspaces.count", workspaces.length), {
            count: workspaces.length,
          })}
        />

        {isLoading ? (
          <Card variant="muted">
            <AppText variant="callout" tone="muted" align="center">
              {t("common.loading")}
            </AppText>
          </Card>
        ) : workspaces.length === 0 ? (
          <Card padded={false}>
            <EmptyState
              title={t("workspaces.empty.title")}
              description={t("workspaces.empty.body")}
            />
          </Card>
        ) : (
          <View style={{ gap: theme.spacing.sm }}>
            {workspaces.map((workspace) => (
              <Pressable
                key={workspace.id}
                accessibilityRole="button"
                accessibilityLabel={workspace.name}
                onLongPress={() => nombreLargo.onLongPress(workspace.name)}
                onPress={() => router.push(`/(app)/workspace/${workspace.id}`)}
                style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
              >
                <Card style={[styles.row, { gap: theme.spacing.md }]}>
                  {/*
                    The space's own colour, on the tile that stands for it.

                    The accent was here, which meant every space in the list was
                    the same colour and the list answered none of the question it
                    exists to answer. The tile is a circle of the same wash the
                    space's own screen and its panel cards are painted with, so a
                    space is the same colour in the list, in the menu, on the panel
                    and on the screen behind it.
                  */}
                  <SpaceWash
                    colorKey={workspace.color}
                    // The end colour the person chose, so this tile is the same
                    // pair as the picker preview and not a derived one.
                    colorToKey={workspace.colorTo}
                    wash={workspace.wash}
                    radius={theme.radius.md}
                    style={[styles.emoji, { borderRadius: theme.radius.md }]}
                  >
                    {/*
                      A space with no emoji of its own gets the **outline**
                      folder, not a 📁.

                      That emoji was the only filled thing in the app: a
                      multicoloured, closed folder drawn by the system, heavier
                      than the line glyphs around it and the one mark on the
                      screen whose colour had nothing to do with the space. A
                      space that has an emoji keeps it — that is the person's
                      own — and one that has not gets the same symbol the
                      folder rows and the drawer already use, so the row reads as
                      part of this app rather than pasted into it.
                    */}
                    {workspace.emoji ? (
                      <AppText variant="title">{workspace.emoji}</AppText>
                    ) : (
                      <Ionicons
                        name="folder-outline"
                        size={22}
                        color={theme.colors.textSubtle}
                      />
                    )}
                  </SpaceWash>

                  <View style={styles.flex}>
                                        <AppText variant="bodyStrong">{workspace.name}</AppText>
                    <View style={[styles.meta, { gap: theme.spacing.sm }]}>
                      <Badge
                        label={t(`workspaces.role.${workspace.role}`)}
                        tone={ROLE_TONE[workspace.role]}
                      />
                      <AppText variant="caption" tone="muted">
                        {t(
                          pluralKey(
                            "workspaces.members",
                            workspace.memberCount,
                          ),
                          { count: workspace.memberCount },
                        )}
                      </AppText>
                    </View>
                  </View>

                  <Ionicons
                    name="chevron-forward"
                    size={18}
                    color={theme.colors.textSubtle}
                  />
                </Card>
              </Pressable>
            ))}
          </View>
        )}
      </View>
      {Platform.OS === "web" ? (
        <AppText variant="caption" tone="subtle" align="center">
          {t("workspaces.webHint")}
        </AppText>
      ) : null}
      {/*
        The plus, in the corner every other screen keeps it in, and it opens the
        form instead of being one. Creating a space was the last card of this
        page, under the list of the ones that already exist, so the only way to
        make a new one was to scroll past everything you have — and the card had
        no colour in it, so a space was born grey and had to be edited to become
        itself. Now the name and the colour are asked together, the way the menu
        of a space asks for them.
      */}
      <WorkspaceCreateSheet
        visible={creating}
        onClose={() => setCreating(false)}
        onCreated={(workspaceId) =>
          router.push(`/(app)/workspace/${workspaceId}`)
        }
      />
      {nombreLargo.sheet}
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
  emoji: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  meta: {
    flexDirection: "row",
    alignItems: "center",
  },
});
