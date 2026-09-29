import type { Folder, List, ListOrderMode, Note } from "@orbit-hub/contracts";

/**
 * One thing in a folder, whatever kind of thing it is.
 *
 * A folder, a list and a note are three tables and three routes, and for a person
 * standing in a folder they are three rows in the same list. This is the shape
 * that says so: a discriminated union with the fields all three have, so
 * ordering and filtering never has to ask what it is holding.
 */
export type ContentRow = {
  kind: "folder" | "list" | "note";
  id: string;
  /** The name, and what every sort and every search reads. */
  name: string;
  position: number;
  createdAt: string;
  /** The folder it is filed in, for the rows of a whole space. */
  folderId: string | null;
  /** Only on a list, and only the filter reads it. */
  listKind?: List["kind"];
  itemCount?: number;
  notePreview?: string;
};

export const toRow = {
  folder: (folder: Folder): ContentRow => ({
    kind: "folder",
    id: folder.id,
    name: folder.name,
    position: folder.position ?? 0,
    createdAt: String(folder.createdAt ?? ""),
    folderId: folder.parentId ?? null,
  }),
  list: (list: List): ContentRow => ({
    kind: "list",
    id: list.id,
    name: list.title,
    position: list.position ?? 0,
    createdAt: String(list.createdAt ?? ""),
    folderId: list.folderId ?? null,
    listKind: list.kind,
    itemCount: list.itemCount,
  }),
  note: (note: Note): ContentRow => ({
    kind: "note",
    id: note.id,
    name: note.title,
    position: note.position ?? 0,
    createdAt: String(note.createdAt ?? ""),
    folderId: note.folderId ?? null,
    notePreview: note.plainText,
  }),
};

/**
 * Position zero means **not placed**, and it is not the first place.
 *
 * Folders and lists have carried a `position` for a while and notes have just
 * started, so almost every note on every account is a zero. Sorting zero first
 * would put every note on an account above everything a person has ever
 * arranged, which is the exact opposite of what the number is for. So a zero
 * sorts last, and among the zeros the newest comes first — which is the order
 * somebody expects to find a note they never placed in.
 */
const PLACED_AFTER = Number.MAX_SAFE_INTEGER;

function manualRank(row: ContentRow): number {
  return row.position > 0 ? row.position : PLACED_AFTER;
}

function porNombre(a: ContentRow, b: ContentRow): number {
  return a.name.localeCompare(b.name, undefined, { numeric: true });
}

/**
 * What breaks a tie between two rows holding the same number.
 *
 * **This is not a corner case, it is the state every folder starts in.** A
 * folder has a `position` counting from one, and so does each of its lists, and
 * so does each of its notes, and none of the three has ever heard of the other
 * two. So three lists and two notes arrive as `1,2,3` and `1,2`, and "by
 * position" over both is interleaving two sequences that do not relate to each
 * other.
 *
 * There are two ways out and one of them is the thing that was asked to go away.
 * **Grouping by kind** would draw them as all the folders, then all the lists,
 * then all the notes — which is the three headed list this replaced, with the
 * headings taken off. So the tie is broken by **date**: every row in a folder
 * that nobody has arranged comes out in the order it was made, across all three
 * kinds, and it looks like a list somebody would have written.
 *
 * And the real order arrives at the first drag: `moveRow` renumbers the rows it
 * moves across the whole visible list, so from then on the numbers are unique
 * across the three kinds and this never runs again. The by-hand order is real
 * from the first time somebody uses it, which is the only thing it can honestly
 * be for a folder that has never had one.
 */
function desempate(a: ContentRow, b: ContentRow): number {
  return porCreacion(a, b) || porNombre(a, b);
}

function porCreacion(a: ContentRow, b: ContentRow): number {
  return a.createdAt.localeCompare(b.createdAt);
}

/**
 * The rows, in the order somebody asked for.
 *
 * The modes are the ones the app already has for the items of a list, reused
 * rather than reinvented: a person who has learned "manual" here has learned it
 * where the most rows are. The two that make no sense over a mixed list —
 * `priority` and `updated` — are not offered, because a folder has no priority
 * and a note that was not edited today is not "less important than" one that was.
 */
export function sortRows(rows: ContentRow[], mode: ListOrderMode): ContentRow[] {
  const copia = [...rows];
  switch (mode) {
    case "manual":
      copia.sort((a, b) => manualRank(a) - manualRank(b) || desempate(a, b));
      break;
    case "alphabetical":
      copia.sort(porNombre);
      break;
    case "alphabetical_desc":
      copia.sort((a, b) => porNombre(b, a));
      break;
    case "created_asc":
      copia.sort(porCreacion);
      break;
    case "created_desc":
    case "updated_desc":
      copia.sort((a, b) => porCreacion(b, a));
      break;
    default:
      copia.sort((a, b) => manualRank(a) - manualRank(b) || desempate(a, b));
  }
  return copia;
}

/** Whether this order can be dragged. One place, so the UI cannot disagree. */
export function isDraggableOrder(mode: ListOrderMode): boolean {
  return mode === "manual";
}

/**
 * The same list with one row moved, and the numbers that actually changed.
 *
 * It returns **only the rows whose position differs**, and that is the whole
 * point: a drag from the first row to the last of a folder of forty is one move
 * and two writes, not forty. Renumbering everything is what makes an arrangement
 * feel slow and what fills the outbox with writes nobody asked for.
 *
 * Positions are `index + 1` and never zero, because zero is the sentinel for
 * "this row has never been placed" and a row that has just been dragged has.
 */
export function moveRow(
  rows: ContentRow[],
  rowId: string,
  delta: number,
): { ordered: ContentRow[]; changed: ContentRow[] } {
  const ordered = [...rows];
  const from = ordered.findIndex((row) => row.id === rowId);
  if (from < 0) return { ordered, changed: [] };
  const to = from + delta;
  if (to < 0 || to >= ordered.length || to === from) {
    return { ordered, changed: [] };
  }

  const movida = ordered.splice(from, 1)[0];
  // `splice` devuelve un array y TypeScript no lo acota al ancho de la llamada,
  // asi que aqui se dice lo que ya se sabe: ese indice existia.
  if (!movida) return { ordered, changed: [] };
  ordered.splice(to, 0, movida);

  const antes = new Map(rows.map((row) => [row.id, row.position]));
  const changed: ContentRow[] = [];
  ordered.forEach((row, index) => {
    const nueva = index + 1;
    if (antes.get(row.id) !== nueva) changed.push({ ...row, position: nueva });
  });

  return { ordered, changed };
}

/** The filter, as a value somebody can compare and a chip can be built from. */
export interface ContentFilter {
  /** `null` is "everything", which is the default and is not a choice. */
  kind: "all" | "folder" | "list" | "note";
  /** A list's kind, and ignored when `kind` is not `list`. */
  listKind?: string;
  /** A folder id, and ignored when it is null. */
  folderId: string | null;
  /** Text over the name, and over the note's own text. */
  query: string;
}

export const EMPTY_FILTER: ContentFilter = {
  kind: "all",
  folderId: null,
  query: "",
};

/**
 * Whether a row survives the filter, and why a row that does not was dropped.
 *
 * The kinds are **additive**: a person who chose "notas" and a folder is looking
 * for notes in that folder, not for either of the two. Making them exclusive
 * would mean that choosing a folder loses the type, and the two controls sit next
 * to each other and look like they belong to the same question.
 */
export function matchesFilter(row: ContentRow, filter: ContentFilter): boolean {
  if (filter.kind !== "all" && row.kind !== filter.kind) return false;
  if (filter.kind === "list" && filter.listKind && row.listKind !== filter.listKind) {
    return false;
  }
  if (filter.folderId !== null && row.folderId !== filter.folderId) return false;
  if (filter.query.length > 0) {
    const aguja = filter.query.toLocaleLowerCase();
    const nombre = row.name.toLocaleLowerCase();
    // The note's own words, and not only its title: a note called "Recetas" whose
    // text is full of "salsa" is a note somebody is looking for with the word
    // "salsa", and a filter that only reads titles would not find it.
    const cuerpo = (row.notePreview ?? "").toLocaleLowerCase();
    if (!nombre.includes(aguja) && !cuerpo.includes(aguja)) return false;
  }
  return true;
}

/**
 * Which rows the list is allowed to consider at all.
 *
 * A filter that can only look at the level you happen to be standing in is a
 * filter that mostly finds nothing, and "Listas" on a space whose root holds one
 * folder and no lists is exactly that: an empty screen and a lit chip, which is
 * the one thing a filter must never be. Somebody who asks for the lists of a
 * space wants the lists of the space, wherever inside it they are filed.
 *
 * So the scope is decided by the filter, and it is three cases and not one:
 *
 * - **a folder chosen** is that folder's contents, and not the level's. Going in
 *   is still a screen and the back button still means one press; this is a
 *   second, quicker way to see the same thing, and the chips stay the ones of the
 *   level so the chosen one is still there to change or unchoose.
 * - **a kind chosen** is the whole space. "Películas" is a question about the
 *   space, not about the root of it, and the folder chips are how you narrow it.
 * - **nothing chosen** is this level, which is the tree the back button walks.
 */
export type Alcance =
  | { tipo: "nivel" }
  | { tipo: "carpeta"; folderId: string }
  | { tipo: "espacio" };

export function alcanceDe(filter: ContentFilter): Alcance {
  if (filter.folderId !== null) {
    return { tipo: "carpeta", folderId: filter.folderId };
  }
  if (filter.kind !== "all") return { tipo: "espacio" };
  return { tipo: "nivel" };
}

/** Whether a row is in the scope, which is asked before the filter is. */
export function enAlcance(row: ContentRow, alcance: Alcance, nivel: string | null): boolean {
  switch (alcance.tipo) {
    case "carpeta":
      return row.folderId === alcance.folderId;
    case "espacio":
      return true;
    default:
      return row.folderId === nivel;
  }
}

/** How many filters are narrowing the list, for the "clear" that appears. */
export function activeFilterCount(filter: ContentFilter): number {
  let n = 0;
  if (filter.kind !== "all") n += 1;
  if (filter.listKind) n += 1;
  if (filter.folderId !== null) n += 1;
  if (filter.query.length > 0) n += 1;
  return n;
}
