/**
 * The picker, one level at a time: the spaces, then what is inside a space, then
 * what is inside a folder. Going in is a step; going back is the same step reversed.
 *
 * Only one path is ever open, because the picker shows one level and the path to
 * it is the list of levels the person went through. Nothing is searched here: a
 * person who knows where a thing is walks to it, as they do in the rest of the app.
 * Pure, so the rules are tested without the cache.
 */

import type { IconRef } from "@orbit-hub/contracts";

import type { MentionRecord } from "./mention-model";
import { iconTextOf } from "./mention-model";

/** A level of the picker: `null` for the spaces, `space:<id>` or `folder:<id>` otherwise. */
export type PickerLevel = string | null;

export interface LevelRow {
  key: string;
  type: MentionRecord["type"];
  id: string;
  name: string;
  /** The emoji drawn before the name: the one given, or the type's. */
  icon: string;
  /**
   * The icon as it was configured, for a row to draw. A vector icon cannot go in
   * a chip — a chip is text — but a row in this picker draws whatever the thing
   * was given, so a thing with a vector icon no longer reads as another one.
   */
  iconRef: IconRef | null;
  colour: string | null;
  /** True when pressing the row goes into it, rather than picking it. */
  enters: boolean;
}

/** Folders first, then lists, notes and bookmarks: how a space reads, top down. */
const ORDER: Record<MentionRecord["type"], number> = {
  workspace: 0,
  folder: 0,
  list: 1,
  note: 2,
  bookmark: 3,
};

function byName(a: MentionRecord, b: MentionRecord): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

/** The rows of one level, in the order the app keeps them. */
export function levelRows(records: MentionRecord[], level: PickerLevel): LevelRow[] {
  if (level === null) {
    return records
      .filter((record) => record.type === "workspace")
      .sort(byName)
      .map((space) => rowOf(space, true));
  }

  const folders = new Set(records.filter((record) => record.type === "folder").map((r) => r.id));
  const [kind, id] = level.split(":") as ["space" | "folder", string];
  const inside = records.filter((record) => {
    if (record.type === "workspace" || record.workspaceId === null) return false;
    if (kind === "space") {
      // A thing filed in a folder that is gone is shown at the top of its space.
      const orphan = record.folderId !== null && !folders.has(record.folderId);
      return record.workspaceId === id && (record.folderId === null || orphan);
    }
    return record.folderId === id;
  });

  return inside
    .sort((a, b) => {
      const byKind = ORDER[a.type] - ORDER[b.type];
      return byKind !== 0 ? byKind : byName(a, b);
    })
    .map((record) => rowOf(record, record.type === "folder"));
}

/** The level a row opens when it is entered, or null when it is not a container. */
export function levelOf(row: LevelRow): PickerLevel {
  if (row.type === "workspace") return `space:${row.id}`;
  if (row.type === "folder") return `folder:${row.id}`;
  return null;
}

function rowOf(record: MentionRecord, enters: boolean): LevelRow {
  return {
    key: `${record.type}:${record.id}`,
    type: record.type,
    id: record.id,
    name: record.name,
    icon: iconTextOf(record),
    iconRef: record.icon,
    colour: record.colour,
    enters,
  };
}
