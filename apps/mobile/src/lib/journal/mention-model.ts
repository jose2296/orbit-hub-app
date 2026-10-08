/**
 * What a mention record is, and what it is drawn with. Pure: no cache, so the
 * picker's rules can be tested without the app's storage.
 */

import type { ListKind, MentionType } from "@orbit-hub/contracts";

export interface MentionRecord {
  type: MentionType;
  id: string;
  name: string;
  /** The space it is in. A space is its own. */
  workspaceId: string | null;
  /** The folder it is filed in, or null when it sits at the top of its space. */
  folderId: string | null;
  kind: ListKind | null;
  /** The emoji text to draw before the name, or null when the icon is not an emoji. */
  emoji: string | null;
  /** The colour of the space, when the thing is in one. */
  colour: string | null;
}

/** The emoji drawn for a kind of thing that has no emoji of its own. */
export const TYPE_EMOJI: Record<MentionType, string> = {
  workspace: "🏠",
  folder: "📁",
  list: "📋",
  note: "📝",
  bookmark: "🔖",
};

/** The emoji a board draws, so a board is told apart from a list in a chip. */
export const BOARD_EMOJI = "🗂️";

export function iconTextOf(record: Pick<MentionRecord, "type" | "emoji" | "kind">): string {
  if (record.emoji !== null) return record.emoji;
  if (record.type === "list" && record.kind === "board") return BOARD_EMOJI;
  return TYPE_EMOJI[record.type];
}
