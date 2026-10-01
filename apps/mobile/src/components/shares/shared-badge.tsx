import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, View } from "react-native";

import { AppText } from "@/components/ui/text";
import { useTranslation } from "@/lib/i18n";
import { useTheme } from "@/theme";

export interface SharedBadgeProps {
  /**
   * Whether it was handed to this person, rather than being theirs because they are
   * a member of the space it lives in.
   *
   * And deliberately **not** "whether other people have this": a list three
   * colleagues have open is still yours, and a badge built from that instead would
   * put a shared mark on your own shopping list.
   */
  shared: boolean;
  /** What they can do with it: `owner` and `editor` both mean they can change it. */
  role: "owner" | "editor" | "viewer";
}

/**
 * Whether it is yours or it was handed to you, and whether you may touch it.
 *
 * **It lives in the options menu and nowhere else**, and that is where it belongs.
 * It used to be also at the top of the workspace, the list and the note, and having
 * it in two places was worse than having it in one: the answer can change — somebody
 * revokes a share, the person is added to a space — and a copy in the header is a
 * copy that can be wrong for as long as nobody opens the menu to compare. One place
 * means one thing to keep true.
 *
 * It is also where the question actually gets asked. You open the menu to find out
 * what you can do with a thing, and the answer is the first thing in it.
 *
 * **The two questions are not collapsed into one word.** `viewer` and `shared` do not
 * imply each other in either direction: a list can be yours and read-only if you are
 * a viewer of the space, and it can be somebody else's and editable. One "read only"
 * label would put itself on your own list and take itself off a lent one.
 *
 * The glyph is `eye-off` and not a padlock, because nothing here stops you opening
 * it and it is meant that you can.
 */
export function SharedBadge({ shared, role }: SharedBadgeProps) {
  const theme = useTheme();
  const t = useTranslation();

  const soloLectura = role === 'viewer';
  const nombre = shared ? t("shared.fromThem") : t("shared.yours");
  const permiso = soloLectura ? t("shared.canOnlyRead") : t("shared.canEdit");

  // `accent` for a share, `subtle` for your own: the point of the badge is to be
  // noticed when something is not yours, and a badge on everything is no badge.
  const color = shared ? theme.colors.accent : theme.colors.textSubtle;

  return (
    <View
      style={[
        styles.caja,
        {
          gap: theme.spacing.xs,
          paddingHorizontal: theme.spacing.md,
          paddingVertical: theme.spacing.sm,
          borderRadius: theme.radius.md,
          borderWidth: 1,
          borderColor: shared ? theme.colors.accent : theme.colors.border,
          /*
            An opaque surface in **both** states, and this is a fix for something
            only a browser showed: with a transparent background the "yours" badge sat
            directly on the space's colour band — the note editor paints one behind the
            title — and dark text on a dark gradient is unreadable. A tint that
            follows the space cannot be read on every space, and the spaces include
            some very dark ones.
          */
          backgroundColor: shared ? theme.colors.accentSoft : theme.colors.surface,
        },
      ]}
      // One label that says both things: two would be read as two separate states by
      // a screen reader, and it is one state with two parts.
      accessibilityLabel={`${nombre} · ${permiso}`}
      testID="shared-badge"
    >
      <View style={styles.linea}>
        <Ionicons
          name={shared ? "people-outline" : "lock-closed-outline"}
          size={16}
          color={color}
        />
        <AppText variant="bodyStrong" style={{ color: shared ? theme.colors.accent : undefined }}>
          {nombre}
        </AppText>
      </View>

      <View style={styles.linea}>
        <Ionicons
          name={soloLectura ? "eye-off-outline" : "create-outline"}
          size={14}
          color={theme.colors.textSubtle}
        />
        <AppText variant="caption" tone="subtle">
          {permiso}
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  linea: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  caja: {
    // Left aligned with the rest of the options and not centred: this is a fact
    // about the thing, not a heading. Full width so the surface stops short of the
    // panel's own edges instead of the text sitting in a gutter.
    alignItems: 'flex-start',
    alignSelf: 'stretch',
  },
});