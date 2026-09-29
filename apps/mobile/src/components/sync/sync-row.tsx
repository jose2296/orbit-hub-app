import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, View } from "react-native";

import { useSyncAttention } from "@/hooks/use-sync-attention";
import { useSyncStatus } from "@/hooks/use-sync-status";
import { pluralKey, useTranslation } from "@/lib/i18n";
import { useTheme } from "@/theme";

import { AppText } from "@/components/ui/text";

import { SyncBadge } from "./sync-badge";

/**
 * The row that opens the sync centre, for both menus.
 *
 * One component and not two, because it was two and they had drifted — and
 * because the thing that is wrong with it is a design mistake that is easy to
 * repeat by accident.
 *
 * WHAT IT SAYS, AND WHY. The name of the thing is the text. The state is a
 * second line under it, and it is left out entirely when there is nothing to
 * report. It used to be the other way round: the row's only text was the state, so
 * with everything in order it read "Al día" in a muted grey under a list of
 * spaces — which is a status label, not a button, and nobody could tell there was
 * anything there to press. The name is what makes the row a control you can aim
 * at; the state is what tells you whether going there is worth it.
 *
 * The badge is inside a row that is `position: relative`. It is absolutely
 * positioned, and without that it is placed against whatever ancestor happens to
 * be positioned — which is how a dot that means "this row needs you" ends up in
 * the corner of the screen, pointing at nothing.
 */
export function SyncRow({
  onPress,
  /** The wide column is narrower and has less room for a second line. */
  compact = false,
}: {
  onPress: () => void;
  compact?: boolean;
}) {
  const theme = useTheme();
  const t = useTranslation();
  const { status } = useSyncStatus();
  const attention = useSyncAttention();

  /**
   * What there is to say, and nothing when there is nothing.
   *
   * A conflict is said before a pending change: it is the one that needs a person,
   * and "3 cambios sin subir" would understate it.
   */
  const detail = (() => {
    if (status.pendingConflicts > 0 || status.state === "blocked") {
      return status.pendingConflicts > 0
        ? t(pluralKey("sync.conflicts.pending", status.pendingConflicts), {
            count: status.pendingConflicts,
          })
        : t("sync.state.blocked");
    }
    if (status.state === "error") return t("sync.state.error");
    if (status.state === "offline") return t("sync.state.offline");
    if (status.pendingOperations > 0) {
      return t(pluralKey("drawer.pending", status.pendingOperations), {
        count: status.pendingOperations,
      });
    }
    return null;
  })();

  return (
    <Pressable
      accessibilityRole="button"
      // The name and not the state: a screen reader is told what the control is
      // and then what it is saying, which is the same order the row is drawn in.
      accessibilityLabel={
        detail ? `${t("sync.title")}: ${detail}` : t("sync.title")
      }
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          borderRadius: theme.radius.md,
          backgroundColor: pressed
            ? theme.colors.surfaceMuted
            : attention.needed
              ? theme.colors.accentSoft
              : "transparent",
          paddingHorizontal: theme.spacing.sm,
          paddingVertical: theme.spacing.sm,
        },
      ]}
    >
      <Ionicons
        name={attention.needed ? "cloud-upload-outline" : "cloud-done-outline"}
        size={18}
        color={attention.needed ? theme.colors.accent : theme.colors.textMuted}
      />

      <View style={styles.text}>
        <AppText
          variant="callout"
          style={[
            styles.name,
            { color: attention.needed ? theme.colors.accent : theme.colors.text },
          ]}
        >
          {t("sync.title")}
        </AppText>
        {detail && !compact ? (
          <AppText variant="caption" tone="subtle" numberOfLines={1}>
            {detail}
          </AppText>
        ) : null}
      </View>

      <SyncBadge size={8} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 34,
    // The containing block for the badge, which is `position: absolute`. Without
    // it the dot is placed against an ancestor that has nothing to do with this
    // row and lands in the corner of the screen.
    position: "relative",
  },
  text: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    fontWeight: "600",
  },
});
