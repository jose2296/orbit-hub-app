import type { Bookmark } from '@orbit-hub/contracts';
import { bookmarkSchema } from '@orbit-hub/contracts';
import { and, asc, eq, isNull } from 'drizzle-orm';

import { getDatabase } from '../../db/client.js';
import type { Database } from '../../db/client.js';
import type { MembershipRoleName } from '../../db/constants.js';
import type { BookmarkRow } from '../../db/schema.js';
import { bookmarks, memberships } from '../../db/schema.js';
import { HttpError } from '../../lib/http-error.js';

/** Un bookmark del listado: sin `document` ni `plainText`. */
export type BookmarkListItem = Omit<Bookmark, 'document' | 'plainText'>;

/**
 * La fila mas su rol, en la forma del contrato.
 *
 * `shared` es siempre `false` aqui, igual que en las notas: la superficie REST
 * es solo para miembros del espacio.
 */
function toBookmark(row: BookmarkRow, role: MembershipRoleName): Bookmark {
  return bookmarkSchema.parse({
    id: row.id,
    workspaceId: row.workspaceId,
    folderId: row.folderId,
    collectionId: row.collectionId,
    url: row.url,
    title: row.title,
    siteName: row.siteName,
    description: row.description,
    imageUrl: row.imageUrl,
    document: row.document,
    plainText: row.plainText,
    extractionState: row.extractionState,
    extractionError: row.extractionError,
    tags: row.tags ?? [],
    position: row.position,
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
 * El bookmark que la persona puede ver, o 404.
 *
 * No-miembro responde 404 y no 403: la lectura no confirma que el espacio
 * existe (regla 8 de AGENTS.md).
 */
async function readableBookmark(userId: string, id: string): Promise<BookmarkRow> {
  const database = await db();
  const [row] = await database.select().from(bookmarks).where(eq(bookmarks.id, id)).limit(1);
  if (!row || row.deletedAt) {
    throw HttpError.notFound('Bookmark not found');
  }
  const role = await roleIn(userId, row.workspaceId);
  if (role === null) {
    throw HttpError.notFound('Bookmark not found');
  }
  return row;
}

export async function listBookmarks(
  userId: string,
  filters: { workspaceId: string; folderId?: string | null; collectionId?: string | null },
): Promise<BookmarkListItem[]> {
  const role = await roleIn(userId, filters.workspaceId);
  if (role === null) {
    throw HttpError.notFound('Workspace not found');
  }

  const database = await db();
  const conditions = [eq(bookmarks.workspaceId, filters.workspaceId), isNull(bookmarks.deletedAt)];
  if (filters.folderId !== undefined) {
    conditions.push(
      filters.folderId === null ? isNull(bookmarks.folderId) : eq(bookmarks.folderId, filters.folderId),
    );
  }
  if (filters.collectionId !== undefined) {
    conditions.push(
      filters.collectionId === null
        ? isNull(bookmarks.collectionId)
        : eq(bookmarks.collectionId, filters.collectionId),
    );
  }
  const rows = await database
    .select()
    .from(bookmarks)
    .where(and(...conditions))
    .orderBy(asc(bookmarks.position));

  /*
    Sin `document` ni `plainText`: son hasta 512 KB y el listado no los usa. Es
    la misma decision que `listItemsQuerySchema` con su limite: el detalle va
    en el `get`, no en la lista.
  */
  return rows.map((row) => {
    const { document: _document, plainText: _plainText, ...item } = toBookmark(row, role);
    return item;
  });
}

export async function getBookmark(userId: string, id: string): Promise<Bookmark> {
  const row = await readableBookmark(userId, id);
  const role = (await roleIn(userId, row.workspaceId)) ?? 'viewer';
  return toBookmark(row, role);
}
