/**
 * Mentions: a chip in a note that points at something in the app.
 *
 * The document keeps the name that was there when the chip was made, as a copy.
 * What is drawn is the name the target has now, looked up in the local cache, so a
 * renamed list reads correctly in every note that cites it without any of those
 * notes being rewritten. See `docs/architecture/adr/0034-mencion-en-notas.md`.
 *
 * Pure: the cache is passed in as a function, so the rules are tested without a
 * device and the same code serves the editor and the reader.
 */

import type { ListKind, MentionType } from "@orbit-hub/contracts";

import { routeForList } from "@/lib/lists/route";

/** What a chip needs to be drawn and opened, as the cache knows it. */
export interface MentionTarget {
  /** The name it has now. */
  name: string;
  /** Where pressing it goes. */
  route: string;
}

/**
 * Looks a target up. `null` means the cache does not have it, or it was deleted,
 * or the person cannot see it: all three are the same answer, and they are shown
 * the same way.
 */
export type MentionLookup = (type: MentionType, id: string) => MentionTarget | null;

/** How a chip is drawn when its target cannot be found. */
export type MentionMode =
  /**
   * Being written: a chip that cannot be resolved keeps the name it was made with,
   * so the document is not changed under the person by a cache that has not caught
   * up. Nothing is saved from here, so nothing is lost.
   */
  | "editing"
  /** Being read: a chip whose target is gone says so, instead of pretending. */
  | "reading";

const MENTION_PATTERN = /<mention\b([^>]*)>([\s\S]*?)<\/mention>/g;
const ATTRIBUTE_PATTERN = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*"([^"]*)"/g;

function attributesOf(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  ATTRIBUTE_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ATTRIBUTE_PATTERN.exec(raw)) !== null) {
    out[match[1]!.toLowerCase()] = match[2]!;
  }
  return out;
}

function escapeText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const MENTION_TYPE_SET = new Set<string>(["workspace", "folder", "list", "note", "bookmark"]);

/**
 * The document with each chip's visible name brought up to date.
 *
 * Only the text between the tags changes. The attributes are the document's, and
 * the stored document is never rewritten by this: it is what the editor shows and
 * what the reader draws, and a save goes through the editor as usual.
 */
export function renderMentions(
  html: string,
  lookup: MentionLookup,
  options: { mode: MentionMode; unavailableLabel: string },
): string {
  return html.replace(MENTION_PATTERN, (whole, rawAttributes: string) => {
    const attributes = attributesOf(rawAttributes);
    const type = attributes["type"];
    const id = attributes["id"];
    if (type === undefined || !MENTION_TYPE_SET.has(type) || id === undefined) {
      // Not a chip this app can resolve. It keeps what it was given.
      return whole;
    }

    const target = lookup(type as MentionType, id);
    if (target !== null) {
      return `<mention${rawAttributes}>${escapeText(target.name)}</mention>`;
    }
    if (options.mode === "reading") {
      return `<mention${rawAttributes}>${escapeText(options.unavailableLabel)}</mention>`;
    }
    return whole;
  });
}

/**
 * Where a chip goes when it is pressed.
 *
 * The same routes the global search uses, so a chip and a search result for the
 * same thing always open the same screen.
 */
export function routeForMention(
  type: MentionType,
  id: string,
  context: { workspaceId?: string | null; kind?: ListKind | null } = {},
): string {
  switch (type) {
    case "workspace":
      return `/(app)/workspace/${id}`;
    case "folder":
      return `/(app)/workspace/${context.workspaceId ?? ""}/folder/${id}`;
    case "list":
      return routeForList({ id, kind: context.kind ?? "tasks" });
    case "note":
      return `/(app)/note/${id}`;
    case "bookmark":
      return `/(app)/bookmark/${id}`;
  }
}
