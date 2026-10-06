import type { Collection } from '@orbit-hub/contracts';
import { collectionSchema } from '@orbit-hub/contracts';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';

import { getDatabase } from '../../db/client.js';
import type { Database } from '../../db/client.js';
import type { MembershipRoleName } from '../../db/constants.js';
import type { CollectionRow } from '../../db/schema.js';
import { bookmarks, collections, memberships } from '../../db/schema.js';
import { HttpError } from '../../lib/http-error.js';

/**
 * La fila mas su rol, en la forma del contrato.
 *
 * `shared` es siempre `false` aqui, igual que en las notas: la superficie REST
 * es solo para miembros del espacio, y quien la recibio prestada la lee por el
 * pull, donde la proyeccion si dice `shared: true`.
 */
function toCollection(
  row: CollectionRow,
  bookmarkCount: number,
  role: MembershipRoleName,
): Collection {
  return collectionSchema.parse({
    id: row.id,
    workspaceId: row.workspaceId,
    folderId: row.folderId,
    name: row.name,
    description: row.description,
    emoji: row.emoji,
    position: row.position,
    bookmarkCount,
    role,
    shared: false,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  });
}

async function db(): Promise<Database> {
  return (await getDatabase()).db;
}

async function roleIn(userId: string, workspaceId: string): Promise<MembershipRoleName | null> {
  const database = await db();
  const [row] = await database
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.workspaceId, workspaceId)))
    .limit(1);
  return row ? (row.role as MembershipRoleName) : null;
}

/**
 * La coleccion que la persona puede ver, o 404.
 *
 * No-miembro responde 404 y no 403: la lectura no confirma que el espacio
 * existe (regla 8 de AGENTS.md).
 */
async function readableCollection(userId: string, id: string): Promise<CollectionRow> {
  const database = await db();
  const [row] = await database.select().from(collections).where(eq(collections.id, id)).limit(1);
  if (!row || row.deletedAt) {
    throw HttpError.notFound('Collection not found');
  }
  const role = await roleIn(userId, row.workspaceId);
  if (role === null) {
    throw HttpError.notFound('Collection not found');
  }
  return row;
}

/**
 * Cuantos bookmarks vivos cuelgan de cada coleccion del espacio, en una sola
 * consulta agrupada por `collectionId`.
 *
 * Sin esto, una lista de colecciones es una consulta por fila: el mismo truco
 * que `attachmentCount` en los items de lista, y por el mismo motivo.
 */
async function countsByCollection(workspaceId: string): Promise<Map<string, number>> {
  const database = await db();
  const rows = await database
    .select({
      collectionId: bookmarks.collectionId,
      total: sql<number>`count(*)::int`,
    })
    .from(bookmarks)
    .where(and(eq(bookmarks.workspaceId, workspaceId), isNull(bookmarks.deletedAt)))
    .groupBy(bookmarks.collectionId);
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.collectionId !== null) {
      counts.set(row.collectionId, row.total);
    }
  }
  return counts;
}

export async function listCollections(
  userId: string,
  filters: { workspaceId: string; folderId?: string | null; includeEmpty?: boolean },
): Promise<Collection[]> {
  const role = await roleIn(userId, filters.workspaceId);
  if (role === null) {
    throw HttpError.notFound('Workspace not found');
  }

  const database = await db();
  const conditions = [eq(collections.workspaceId, filters.workspaceId), isNull(collections.deletedAt)];
  if (filters.folderId !== undefined) {
    conditions.push(
      filters.folderId === null ? isNull(collections.folderId) : eq(collections.folderId, filters.folderId),
    );
  }
  const rows = await database
    .select()
    .from(collections)
    .where(and(...conditions))
    .orderBy(asc(collections.position));

  const counts = await countsByCollection(filters.workspaceId);
  const items = rows.map((row) => toCollection(row, counts.get(row.id) ?? 0, role));
  if (filters.includeEmpty === false) {
    return items.filter((item) => item.bookmarkCount > 0);
  }
  return items;
}

export async function getCollection(userId: string, id: string): Promise<Collection> {
  const row = await readableCollection(userId, id);
  const role = (await roleIn(userId, row.workspaceId)) ?? 'viewer';
  const counts = await countsByCollection(row.workspaceId);
  return toCollection(row, counts.get(row.id) ?? 0, role);
}

/**
 * Borrado logico: pone la lapida y nada mas destructivo.
 *
 * La fila se queda. Los bookmarks quedan vivos y vuelven a "sin clasificar":
 * su `collectionId` se pone en null a mano, porque la FK `set null` solo se
 * dispara al borrar la fila de verdad y aqui la fila sigue existiendo. Si se
 * borrara la fila, el pull no veria el cambio y el cliente no sabria que la
 * coleccion desaparecio.
 *
 * La lapida mueve `version` y `updatedAt` igual que la del sync
 * (`updateEntity` con `tombstone: true`), y el `collectionId` en null de cada
 * bookmark tambien: el pull filtra por `updatedAt`, y un cambio que no lo
 * tocara seria invisible para el otro dispositivo.
 */
export async function deleteCollection(userId: string, id: string): Promise<void> {
  const existing = await readableCollection(userId, id);

  const database = await db();
  await database
    .update(bookmarks)
    .set({
      collectionId: null,
      version: sql`${bookmarks.version} + 1`,
      updatedAt: new Date(),
    })
    .where(and(eq(bookmarks.collectionId, id), isNull(bookmarks.deletedAt)));
  await database
    .update(collections)
    .set({ deletedAt: new Date(), version: existing.version + 1, updatedAt: new Date() })
    .where(and(eq(collections.id, id), isNull(collections.deletedAt)));
}
