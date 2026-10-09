/**
 * What the app knows about each thing a chip can point at, read from the cache.
 *
 * One reader for the chips and for the picker, so the name, the icon and the
 * space a thing belongs to are decided in one place. The picker arranges the same
 * records as a tree; a chip only needs one of them.
 */

import { iconRefSchema } from "@orbit-hub/contracts";
import type { IconRef, ListKind, MentionType } from "@orbit-hub/contracts";

import type { MentionRecord } from "./mention-model";

export { iconTextOf, TYPE_EMOJI, BOARD_EMOJI } from "./mention-model";
export type { MentionRecord } from "./mention-model";

import { getLocalStoreReady } from "@/lib/offline";
import type { CachedEntity } from "@/lib/offline";

import { nameOfRecord } from "./mentions";

const TYPES: readonly MentionType[] = ["workspace", "folder", "list", "note", "bookmark"];

function merged(row: CachedEntity): Record<string, unknown> {
  const payload = JSON.parse(row.payload) as Record<string, unknown>;
  const pending = row.pending ? (JSON.parse(row.pending) as Record<string, unknown>) : {};
  return { ...payload, ...pending };
}

function emojiOf(icon: unknown): string | null {
  const value = icon as IconRef | null | undefined;
  return value && value.type === "emoji" && typeof value.value === "string" && value.value.length > 0
    ? value.value
    : null;
}

/**
 * The icon as it was configured, refused when the cache has something the contract
 * does not describe. A chip cannot draw a vector — it is text — but the picker can,
 * and a row that drew the emoji of a thing someone gave a vector icon to was a row
 * that showed the wrong thing.
 */
function iconRefOf(icon: unknown): IconRef | null {
  const parsed = iconRefSchema.safeParse(icon);
  return parsed.success ? parsed.data : null;
}

/** Every named, live thing a chip can point at, with its space and folder. */
export async function readMentionRecords(): Promise<MentionRecord[]> {
  const store = await getLocalStoreReady();
  const colourOfSpace = new Map<string, string | null>();
  const workspaces = await store.listCached("workspace");
  for (const row of workspaces) {
    if (row.deletedAt !== null) continue;
    colourOfSpace.set(row.entityId, (merged(row)["color"] as string | undefined) ?? null);
  }

  const out: MentionRecord[] = [];
  for (const type of TYPES) {
    const rows = await store.listCached(type);
    for (const row of rows) {
      if (row.deletedAt !== null) continue;
      const record = merged(row);
      const name = nameOfRecord(type, record);
      if (name.length === 0) continue;
      const workspaceId =
        type === "workspace" ? row.entityId : ((record["workspaceId"] as string | null | undefined) ?? null);
      out.push({
        type,
        id: row.entityId,
        name,
        workspaceId,
        folderId:
          type === "folder"
            ? ((record["parentId"] as string | null | undefined) ?? null)
            : ((record["folderId"] as string | null | undefined) ?? null),
        kind: (record["kind"] as ListKind | undefined) ?? null,
        icon: iconRefOf(record["icon"]),
        emoji: emojiOf(record["icon"]),
        colour:
          type === "workspace"
            ? ((record["color"] as string | undefined) ?? null)
            : workspaceId !== null
              ? (colourOfSpace.get(workspaceId) ?? null)
              : null,
      });
    }
  }
  return out;
}
