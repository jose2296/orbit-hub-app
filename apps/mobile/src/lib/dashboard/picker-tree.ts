import type { Folder, List } from '@orbit-hub/contracts';

/**
 * El árbol del selector del panel, como índice.
 *
 * El selector recorreva el árbol de carpetas **como si fuera plano**: filtraba
 * `folders` por `workspaceId` y nada más, así que una subcarpeta salía al lado de
 * su propia madre, en el primer nivel del espacio, y una carpeta que solo contenía
 * subcarpetillas respondía "aquí no hay nada que poner en el panel todavía", que
 * es falso: tenía una subcarpeta dentro.
 *
 * `useSpacesTree` ya resolvía esto y lo usan el drawer y tres sitios más. Este es
 * un第四 copia con la respuesta equivocada, y por eso vive aquí como una función
 * pura con sus tests en vez de dentro del componente: la regla del árbol se
 * comprueba sin React Native.
 *
 *.Indexa una vez y responde por clave, que es lo que hace un menú que se abre
 * muchas veces: recorrer el árbol entero en cada pregunta es un menú que tarda en
 * abrirse.
 */
export interface PickerTree {
  /** The folders that hang directly from a space, or from a folder inside it. */
  foldersOf(workspaceId: string, parentId: string | null): Folder[];
  /** The lists that hang directly from a space, or from a folder inside it. */
  listsOf(workspaceId: string, parentId: string | null): List[];
  /** How many folders hang directly from here. */
  childCountOf(workspaceId: string, parentId: string | null): number;
  /**
   * Whether a folder has nothing in it at all — no lists and no sub-folders.
   *
   * Both, because a folder with only sub-folders is **not** empty: it has somewhere
   * to go, and saying otherwise is what hid a whole branch of a space.
   */
  isFolderEmpty(folderId: string): boolean;
  /** The folder above this one, or null at the root of the space. */
  parentOf(folderId: string): Folder | null;
}

const key = (workspaceId: string, parentId: string | null) =>
  `${workspaceId}:${parentId ?? 'root'}`;

export function buildPickerTree(folders: Folder[], lists: List[]): PickerTree {
  const foldersByParent = new Map<string, Folder[]>();
  const listsByParent = new Map<string, List[]>();
  const foldersById = new Map<string, Folder>();
  /** Direct children, folders and lists together: what "is this empty" means. */
  const childCount = new Map<string, number>();
  const bump = (id: string) => childCount.set(id, (childCount.get(id) ?? 0) + 1);

  const push = <T>(map: Map<string, T[]>, k: string, value: T) => {
    const row = map.get(k);
    if (row) row.push(value);
    else map.set(k, [value]);
  };

  for (const folder of folders) {
    push(foldersByParent, key(folder.workspaceId, folder.parentId), folder);
    foldersById.set(folder.id, folder);
    if (folder.parentId) bump(folder.parentId);
  }

  for (const list of lists) {
    push(listsByParent, key(list.workspaceId, list.folderId), list);
    if (list.folderId) bump(list.folderId);
  }

  const byName = (rows: Folder[]) =>
    [...rows].sort((one, two) => one.name.localeCompare(two.name));
  const byTitle = (rows: List[]) =>
    [...rows].sort((one, two) => one.title.localeCompare(two.title));

  return {
    foldersOf: (workspaceId, parentId) =>
      byName(foldersByParent.get(key(workspaceId, parentId)) ?? []),
    listsOf: (workspaceId, parentId) =>
      byTitle(listsByParent.get(key(workspaceId, parentId)) ?? []),
    childCountOf: (workspaceId, parentId) =>
      foldersByParent.get(key(workspaceId, parentId))?.length ?? 0,
    isFolderEmpty: (folderId) => (childCount.get(folderId) ?? 0) === 0,
    parentOf: (folderId) => {
      const parentId = foldersById.get(folderId)?.parentId;
      if (!parentId) return null;
      return foldersById.get(parentId) ?? null;
    },
  };
}
