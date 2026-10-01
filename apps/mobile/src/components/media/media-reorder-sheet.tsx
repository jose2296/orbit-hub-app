import { Ionicons } from "@expo/vector-icons";
import { Image, StyleSheet } from "react-native";

import { mediaCardOf } from "@/lib/lists/media-card";
import type { ListItem } from "@orbit-hub/contracts";
import { ReorderSheet } from "@/components/ui/reorder-sheet";
import { useTheme } from "@/theme";

/**
 * The year, on its own, without asking whether there is a poster.
 *
 * `mediaCardOf` returns `null` for anything without an image — deliberately,
 * because a card *is* the picture — and this sheet was reading the year through
 * it. So the year only appeared for rows that had a poster, and an item imported
 * without one showed a bare title with nothing else, which read as "no data"
 * rather than "no picture". The two are independent fields and they are read
 * independently here.
 */
function releasedOf(item: ListItem): string | null {
  const metadata = (item.metadata ?? {}) as Record<string, unknown>;
  const raw =
    metadata.releaseDate ?? metadata.publishedDate ?? metadata.year ?? null;
  if (typeof raw !== "string") return null;
  // A full date is cut to its year, which is all a list of films needs to say and
  // is the only part that fits next to a title without pushing it.
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed.slice(0, 4);
}

/**
 * Reorder a list of films, **which is the generic sheet with a poster in it**.
 *
 * The sheet, the handle, the drag and the move are `ReorderSheet`'s, the same ones
 * a list of folders and a list of tasks use: three copies of a reorder screen is
 * three chances to have one of them with a different gap, a different drop maths
 * or a different idea of what a move means.
 *
 * **What is this one's own is the picture**, because a list of films cannot be
 * scanned without one. A row with no poster keeps its place with the kind's glyph
 * instead, so the column does not jump about as the images arrive.
 */
export function MediaReorderSheet({
  open,
  visible,
  onMove,
  onClose,
  title,
  body,
}: {
  open: boolean;
  /** The rows in the order they are being shown in. */
  visible: ListItem[];
  /**
   * Move a row, and it is a **displacement and not a place**: see `ReorderSheet`.
   */
  onMove: (id: string, delta: number) => void;
  onClose: () => void;
  title: string;
  body: string;
}) {
  const theme = useTheme();

  return (
    <ReorderSheet
      open={open}
      onMove={onMove}
      onClose={onClose}
      title={title}
      hint={body}
      rows={visible.map((item) => {
        const card = mediaCardOf(item);
        return {
          id: item.id,
          title: item.title,
          subtitle: releasedOf(item),
          leadingSize: { width: 32, height: 44, radius: theme.radius.sm },
          leading: card?.imageUrl ? (
            <Image
              source={{ uri: card.imageUrl }}
              style={styles.poster}
              resizeMode="cover"
            />
          ) : (
            <Ionicons
              name={item.metadata ? "film-outline" : "document-text-outline"}
              size={16}
              color={theme.colors.textSubtle}
            />
          ),
        };
      })}
    />
  );
}

const styles = StyleSheet.create({
  poster: {
    width: "100%",
    height: "100%",
  },
});
