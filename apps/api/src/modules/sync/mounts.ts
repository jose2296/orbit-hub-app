import { and, eq, inArray, isNull } from 'drizzle-orm';

import {
  bookmarks,
  collections,
  folders,
  lists,
  listItems,
  notes,
  shareMounts,
  shares,
  workspaces,
} from '../../db/schema.js';
import type { Database } from '../../db/client.js';

/**
 * Where a received thing was filed, and everything that came with it.
 *
 * `share_mounts` records "this person put it in that space, in that folder". Until now
 * nothing read those two columns except the inbox — to take it off the list of things
 * to file — and the pull, so a thing you had filed in your own space still arrived
 * carrying **the owner's** `workspaceId`. The client indexes its tree by
 * `workspaceId:parentId` (`useSpacesTree`), so it appeared under the owner's space and
 * the space you chose changed nothing you could see.
 *
 * So the mount has to be **projected**: the node is the same row, with the same id and
 * the same version, and the pull presents it hanging from where the recipient filed it.
 * Nothing is copied, so an edit on either side is the same row and the other sees it.
 *
 * ## Why the whole subtree, and not the one node
 *
 * The tree is keyed by `workspaceId:parentId`. Rewriting only the mounted folder would
 * leave its children with the owner's `workspaceId`, and they would be looked up under
 * `ownerSpace:mountedFolder` while the recipient asks `theirSpace:mountedFolder` — a
 * folder that opens and has nothing in it. The parent link is untouched, so rewriting
 * the `workspaceId` of every descendant is enough and a walk of the tree is not.
 *
 * ## Why a node gets one place
 *
 * The unique index is on `(shareId, userId)`: one mount per node per person, and filing
 * it again moves it. Two mounts of the same folder would need two rows with the same
 * content and two `workspaceId` values for one node, and this projection — like the cache
 * behind it — has one row per id. A thing you have filed lives in one place, and moving
 * it is the operation for changing your mind.
 *
 * ## Why a member is left where it is
 *
 * Only a person who is **not** a member of the node's own space is rewritten. Somebody
 * who was invited into Ana's space and is handed one of her lists already sees it, in
 * Ana's space, where it belongs. Rewriting it would take it out of the space it lives
 * in for them to file it somewhere that is not where anybody else can see it — and a
 * shared thing appearing in two places is worse than one place that is not the one you
 * asked for.
 */
export interface MontajeProyectado {
  /** The space the recipient filed it in, and the folder inside it. */
  workspaceId: string;
  folderId: string | null;
  /** Only for the node that was mounted: where it sits among its new siblings. */
  position: number;
  /**
   * Whether this entry is the node that was actually filed, or something under it.
   *
   * The distinction is the difference between a filed folder and a flattened one. A
   * descendant keeps its own `parentId`, because that link is what the tree is made of
   * and it still points at its real parent. Only the filed node is re-pointed at the
   * folder the recipient chose, because that is the one place where "its parent" stopped
   * being true — it was filed in their space, not in Ana's.
   */
  esElMontado: boolean;
}

export type MontajesPorNodo = Map<string, MontajeProyectado>;

/** Bounded by the depth a folder tree can actually reach, like `ancestorsOf` walks up. */
const MAX_PROFUNDIDAD = 32;

export async function montajesDe(
  db: Database,
  userId: string,
  /** Spaces this person is a member of. A member is never rewritten. */
  espaciosDondeEsMiembro: readonly string[],
): Promise<MontajesPorNodo> {
  const propias = new Set(espaciosDondeEsMiembro);

  /*
    The space you filed it into has to still be alive, and this is a **soft** delete so
    the `onDelete: cascade` on `share_mounts.workspace_id` never fires: the row outlives
    the space, and a mount that points at a space you deleted keeps rewriting the node
    into it. The client filters deleted spaces out, so the effect is that the thing
    disappears from your app entirely — worse than it not having moved, because before
    the mount it was at least visible under its owner.

    A folder you deleted within a live space falls back to the root of it, because the
    space is still there and the thing was filed in it; only the exact spot is gone.
  */
  const montajes = await db
    .select({
      nodeType: shares.nodeType,
      nodeId: shares.nodeId,
      workspaceId: shareMounts.workspaceId,
      folderId: shareMounts.folderId,
      position: shareMounts.position,
      espacioVivo: workspaces.id,
    })
    .from(shareMounts)
    .innerJoin(shares, eq(shareMounts.shareId, shares.id))
    .innerJoin(workspaces, eq(workspaces.id, shareMounts.workspaceId))
    .where(
      and(
        eq(shareMounts.userId, userId),
        isNull(shares.revokedAt),
        isNull(workspaces.deletedAt),
      ),
    );

  const resultado: MontajesPorNodo = new Map();

  for (const montaje of montajes) {
    // The space the node lives in decides whether it is rewritten at all, and it is one
    // query per mount because the four node types live in four tables and a union of
    // four joins to read one column is four chances to get a join wrong.
    const espacioOriginal = await espacioDe(db, montaje.nodeType, montaje.nodeId);
    if (!espacioOriginal) continue;

    // A member already has it where it lives. See the note on the function.
    if (propias.has(espacioOriginal)) continue;

    const destino: MontajeProyectado = {
      workspaceId: montaje.espacioVivo,
      folderId: await carpetaViva(db, montaje.folderId),
      position: montaje.position,
      esElMontado: true,
    };

    if (montaje.nodeType === 'folder') {
      await expandCarpeta(db, montaje.nodeId, destino, resultado);
      continue;
    }

    if (montaje.nodeType === 'list') {
      resultado.set(`list:${montaje.nodeId}`, destino);
      continue;
    }

    if (montaje.nodeType === 'list_item') {
      /*
        A row cannot be filed on its own, so its **list** is what gets filed.
       *
        This used to project the row alone. The row's `workspaceId` moved and the list's
        did not, so the list stayed in the owner's space while the row said it was in the
        recipient's — and a list in a space the device was never sent is a list the client
        cannot index, so the row it holds is a row with nowhere to be. The row had arrived
        in the pull and could not be drawn: the disappearance again, one step further down.
       *
        The list is the mounted node, because it is the one whose place on screen changed.
        The row keeps its own container — a row has no `folderId`, it is inside its list —
        and only moves the space, which `aplicaMontaje` does through `viaListaId`.
       */
      const listaId = await listaDe(db, montaje.nodeId);
      if (!listaId) continue;
      resultado.set(`list:${listaId}`, destino);
      continue;
    }

    /*
      Compartir un enlace o una carpeta de enlaces no es parte de esta fase, y
      eso es lo que impide que `collection` y `bookmark` lleguen aqui.

      Conviene decir **que** los detiene, porque no es esta cadena de `if`: los de
      arriba hacen `continue` y no `else`, asi que un `nodeType: 'collection'` que
      llegara a esta fila se proyectaria igual, y proyectarlo es lo correcto: un
      nodo propio, con su `folderId` y su `position`, tiene que aparecer bajo donde
      lo recibio quien lo guardo. Lo que no se puede es *llegar*:
      `montajesDe` se llama con lo que hay en `share_mounts`, y
      `shareNodeTypeSchema` no acepta estas dos, asi que no hay grant que las
      traga.

      Y "no hay grant" es una frase sobre TypeScript, no sobre la base:
      `shares.nodeType` es un `varchar(16)` cuyo `$type<>` no existe en Postgres,
      y una fila con un tipo raro metida por otra via pasaria por aqui. Por eso su
      rama en `espacioDe` esta igual: esa funcion responde a lo que dice la fila,
      y el dia que haya comparticion tiene que devolver bien.
    */
    resultado.set(`${montaje.nodeType}:${montaje.nodeId}`, destino);
  }

  return resultado;
}

/**
 * The node itself and every folder under it, pointing at the same place.
 *
 * Descending rather than ascending because the rewrite needs every descendant and the
 * client resolves a folder by its own id plus its parent, which both survive: only the
 * `workspaceId` changes.
 */
async function expandCarpeta(
  db: Database,
  carpetaId: string,
  destino: MontajeProyectado,
  hacia: MontajesPorNodo,
): Promise<void> {
  hacia.set(`folder:${carpetaId}`, destino);

  // Every level, and **the lists filed at each one**. A folder rewrite that stops at
  // the folder produces a folder that opens empty, because the lists inside it keep
  // the owner's `workspaceId` and the client looks them up under a key nobody asks for.
  // That was the first version of this, and it failed for exactly this reason.
  let nivel: string[] = [carpetaId];
  for (let profundidad = 0; profundidad < MAX_PROFUNDIDAD && nivel.length > 0; profundidad += 1) {
    const [hijos, listas] = await Promise.all([
      db
        .select({ id: folders.id })
        .from(folders)
        .where(inArray(folders.parentId, nivel)),
      db
        .select({ id: lists.id })
        .from(lists)
        .where(inArray(lists.folderId, nivel)),
    ]);

    // Descendants, and the lists inside them: same space, **their own parent kept**.
    // Re-pointing them all at the destination folder would move the whole subtree into
    // one flat pile at the root of the recipient's space, which is not what "you filed
    // this folder" means.
    const bajo = { ...destino, esElMontado: false };
    for (const hijo of hijos) hacia.set(`folder:${hijo.id}`, bajo);
    for (const lista of listas) hacia.set(`list:${lista.id}`, bajo);

    nivel = hijos.map((hijo) => hijo.id);
  }
}

/**
 * Which space a granted node lives in, per node type.
 *
 * A `workspace` grant points at the space itself. Everything else has to be walked to,
 * and the three shapes are a folder, a list or one of its rows, and a note.
 *
 * `null` when the node is gone, which is a share pointing at something that was deleted
 * — the row is left behind on purpose so the other device hears about it, and there is
 * nothing left to project.
 */
async function espacioDe(
  db: Database,
  nodeType: string,
  nodeId: string,
): Promise<string | null> {
  if (nodeType === 'workspace') return nodeId;

  if (nodeType === 'folder') {
    const fila = await db
      .select({ workspaceId: folders.workspaceId })
      .from(folders)
      .where(eq(folders.id, nodeId))
      .limit(1);
    return fila[0]?.workspaceId ?? null;
  }

  if (nodeType === 'list') {
    const fila = await db
      .select({ workspaceId: lists.workspaceId })
      .from(lists)
      .where(eq(lists.id, nodeId))
      .limit(1);
    return fila[0]?.workspaceId ?? null;
  }

  if (nodeType === 'list_item') {
    const fila = await db
      .select({ workspaceId: lists.workspaceId })
      .from(listItems)
      .innerJoin(lists, eq(listItems.listId, lists.id))
      .where(eq(listItems.id, nodeId))
      .limit(1);
    return fila[0]?.workspaceId ?? null;
  }

  /*
    Las dos ramas de abajo van **antes** de la de notas, y no por orden.

    La de notas es el final de la cadena y no lleva `else`: `workspace` devuelve
    temprano y las demas son `if` con `return`, asi que cualquier `nodeType` que
    no conozca cae aqui y se consulta contra `notes`. No encuentra nada y
    devuelve `null` -- que es tambien lo que devuelve una nota que ya no existe.
    Con dos tipos mas sin su rama, un bookmark compartido se resolveria contra
    la tabla de notas, daria `null`, y el montaje se descartaria en silencio: la
    fila seguiria llegando en el pull, pero colgando del espacio del dueno, que
    es justo la desapareccion que este archivo existe para impedir.
  */
  if (nodeType === 'collection') {
    const fila = await db
      .select({ workspaceId: collections.workspaceId })
      .from(collections)
      .where(eq(collections.id, nodeId))
      .limit(1);
    return fila[0]?.workspaceId ?? null;
  }

  if (nodeType === 'bookmark') {
    const fila = await db
      .select({ workspaceId: bookmarks.workspaceId })
      .from(bookmarks)
      .where(eq(bookmarks.id, nodeId))
      .limit(1);
    return fila[0]?.workspaceId ?? null;
  }

  const fila = await db
    .select({ workspaceId: notes.workspaceId })
    .from(notes)
    .where(eq(notes.id, nodeId))
    .limit(1);
  return fila[0]?.workspaceId ?? null;
}

/** Which list a row belongs to, or `null` when the row is gone. */
async function listaDe(db: Database, itemId: string): Promise<string | null> {
  const fila = await db
    .select({ listId: listItems.listId })
    .from(listItems)
    .where(eq(listItems.id, itemId))
    .limit(1);

  return fila[0]?.listId ?? null;
}

/** `null` for "no folder", and `null` for "that folder is gone, use the root". */
async function carpetaViva(db: Database, folderId: string | null): Promise<string | null> {
  if (!folderId) return null;

  const fila = await db
    .select({ id: folders.id })
    .from(folders)
    .where(and(eq(folders.id, folderId), isNull(folders.deletedAt)))
    .limit(1);

  return fila[0]?.id ?? null;
}
