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

import { mentionIndicatorFor } from "@orbit-hub/contracts";
import type { ListKind, MentionType } from "@orbit-hub/contracts";

import { routeForList } from "@/lib/lists/route";

/** What a chip needs to be drawn and opened, as the cache knows it. */
export interface MentionTarget {
  /** The name it has now. */
  name: string;
  /** Where pressing it goes. */
  route: string;
  /**
   * What is drawn before the name: the emoji the element was given, or the emoji
   * of its type when it has no emoji. A vector icon cannot be drawn inside text,
   * so it is replaced by the type's emoji rather than left out.
   */
  icon: string;
  /** The colour of the space the element belongs to, or null when it has none. */
  colour: string | null;
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
      // The indicator is re-read from the target, so a chip follows its space's
      // colour as it is now and not as it was when the chip was made.
      const indicator = mentionIndicatorFor(target.colour);
      const attributesNow = rawAttributes.replace(
        /indicator\s*=\s*"[^"]*"/,
        `indicator="${indicator}"`,
      );
      return `<mention${attributesNow}>${escapeText(`${target.icon} ${target.name}`)}</mention>`;
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

/**
 * The chips in a document, in the order they are written, without repeats.
 *
 * What the day's "links" row is made of. Only the attributes are read: the name
 * a chip carries is not what it points at.
 */
export function mentionsIn(html: string): Array<{ type: MentionType; id: string }> {
  const seen = new Set<string>();
  const out: Array<{ type: MentionType; id: string }> = [];
  for (const match of html.matchAll(MENTION_PATTERN)) {
    const attributes = attributesOf(match[1] ?? "");
    const type = attributes["type"];
    const id = attributes["id"];
    if (type === undefined || id === undefined || !MENTION_TYPE_SET.has(type)) continue;
    const key = `${type}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ type: type as MentionType, id });
  }
  return out;
}

/**
 * A name short enough to be stored in a chip. The validator refuses a longer one,
 * and a chip whose name is refused would make the whole note refused.
 */
export const MENTION_NAME_MAX = 120;

export function mentionNameFor(name: string): string {
  return name.replace(/["<>]/g, "").trim().slice(0, MENTION_NAME_MAX);
}

/**
 * The name a record of this type is known by.
 *
 * Not the same field everywhere: a space and a folder are `name`, and a list, a
 * note and a bookmark are `title`. Reading `name` for all of them made every list
 * a chip could not name, which is the kind of mistake a single shared field hides.
 */
export function nameOfRecord(type: MentionType, record: Record<string, unknown>): string {
  const field = type === "workspace" || type === "folder" ? "name" : "title";
  return String(record[field] ?? "");
}
