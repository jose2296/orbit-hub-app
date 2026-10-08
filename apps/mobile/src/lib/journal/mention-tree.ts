/**
 * The picker's list, arranged the way the app is: a space, the folders in it, and
 * the things filed in those folders, one level in at a time.
 *
 * A search keeps the path to each hit, so a list that matches shows the folder and
 * the space it sits in above it, and the picker never shows a loose hit with no
 * place. Pure: the records come in, the rows come out, and the rules are tested.
 */

import type { MentionRecord } from "./mention-model";
import { iconTextOf } from "./mention-model";

export interface TreeRow {
  key: string;
  type: MentionRecord["type"];
  id: string;
  name: string;
  /** 0 for a space, 1 for what is in it, and so on down the folders. */
  depth: number;
  icon: string;
  colour: string | null;
}

/** Folders first, then lists, notes and bookmarks: how a space reads, top down. */
const ORDER: Record<MentionRecord["type"], number> = {
  workspace: 0,
  folder: 0,
  list: 1,
  note: 2,
  bookmark: 3,
  // Never placed inside a folder, but the order is total for the type.
};

function byName(a: MentionRecord, b: MentionRecord): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

function normalise(value: string): string {
  return value.trim().toLowerCase();
}

export function buildMentionTree(records: MentionRecord[], query: string): TreeRow[] {
  const needle = normalise(query);
  const spaces = records.filter((record) => record.type === "workspace");
  const folders = new Set(records.filter((r) => r.type === "folder").map((r) => r.id));

  // Children of each container: a space holds its top-level things, a folder holds
  // its own. A thing filed in a folder that is gone sits at the top of its space.
  const children = new Map<string, MentionRecord[]>();
  const add = (container: string, record: MentionRecord) => {
    const list = children.get(container) ?? [];
    list.push(record);
    children.set(container, list);
  };
  for (const record of records) {
    if (record.type === "workspace" || record.workspaceId === null) continue;
    const parent =
      record.folderId !== null && folders.has(record.folderId)
        ? `folder:${record.folderId}`
        : `space:${record.workspaceId}`;
    add(parent, record);
  }

  const matches = (record: MentionRecord) => needle.length === 0 || normalise(record.name).includes(needle);

  // A container is shown when it or anything under it matches.
  const keptCache = new Map<string, boolean>();
  const kept = (record: MentionRecord): boolean => {
    const cacheKey = `${record.type}:${record.id}`;
    const hit = keptCache.get(cacheKey);
    if (hit !== undefined) return hit;
    let result = matches(record);
    if (!result && record.type !== "list" && record.type !== "note" && record.type !== "bookmark") {
      const under = children.get(record.type === "workspace" ? `space:${record.id}` : `folder:${record.id}`) ?? [];
      result = under.some(kept);
    }
    if (!result && record.type === "workspace") {
      result = (children.get(`space:${record.id}`) ?? []).some(kept);
    }
    keptCache.set(cacheKey, result);
    return result;
  };

  const rows: TreeRow[] = [];
  const emit = (container: string, depth: number) => {
    const items = (children.get(container) ?? []).filter(kept).sort((a, b) => {
      const byKind = ORDER[a.type] - ORDER[b.type];
      return byKind !== 0 ? byKind : byName(a, b);
    });
    for (const record of items) {
      rows.push({
        key: `${record.type}:${record.id}`,
        type: record.type,
        id: record.id,
        name: record.name,
        depth,
        icon: iconTextOf(record),
        colour: record.colour,
      });
      if (record.type === "folder") emit(`folder:${record.id}`, depth + 1);
    }
  };

  for (const space of [...spaces].sort(byName)) {
    if (!kept(space)) continue;
    rows.push({
      key: `workspace:${space.id}`,
      type: "workspace",
      id: space.id,
      name: space.name,
      depth: 0,
      icon: iconTextOf(space),
      colour: space.colour,
    });
    emit(`space:${space.id}`, 1);
  }
  return rows;
}
