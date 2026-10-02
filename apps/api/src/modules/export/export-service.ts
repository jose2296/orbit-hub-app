import { exportFilename, isItemIcon } from '@orbit-hub/contracts';
import type {
  ExportedAttachment,
  Folder,
  List,
  ListExport,
  ListItem,
  Note,
  NoteTemplate,
  Workspace,
} from '@orbit-hub/contracts';
import { and, asc, eq, inArray, or, sql } from 'drizzle-orm';

import { getDatabase } from '../../db/client.js';
import type { Database } from '../../db/client.js';
import {
  attachments,
  folders,
  listItems,
  lists,
  memberships,
  noteTemplates,
  notes,
  users,
  workspaces,
} from '../../db/schema.js';
import { HttpError } from '../../lib/http-error.js';

import type { MembershipRoleName } from '../../db/constants.js';
import {
  accountExportEnvelope,
  itemsToCsv,
  listExportEnvelope,
} from './export-builders.js';

/**
 * Lo que devuelven los tres metodos publicos: exactamente lo que consume
 * `sendFile`.
 *
 * El nombre sale del servicio y no de la ruta porque el servicio es el unico
 * sitio que ha cargado la lista: una ruta que computara el nombre tendria que
 * volver a cargarla o recibirla por parametro, y un nombre que no fuera el
 * mismo que el telefono calcula con el mismo contrato serian dos nombres para
 * el mismo fichero.
 */
export interface ExportFile {
  body: string;
  contentType: string;
  filename: string;
}

/**
 * `role` va en CARPETAS, listas, items y notas: son las cuatro entidades que
 * extienden `nodeAccessSchema` y su `role: membershipRoleSchema` no tiene
 * `.default()`, o sea que es obligatorio en las cuatro. `workspaceSchema`
 * lleva el suyo propio (la pertenencia al espacio) y `noteTemplateSchema` no
 * lleva ninguno: esas dos filas mapean directas.
 */
function toFolder(row: typeof folders.$inferSelect, role: MembershipRoleName): Folder {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    parentId: row.parentId,
    name: row.name,
    emoji: row.emoji,
    position: row.position,
    role,
    shared: false,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}

function toList(
  row: typeof lists.$inferSelect,
  role: MembershipRoleName,
  itemCount: number,
): List {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    folderId: row.folderId,
    kind: row.kind,
    title: row.title,
    description: row.description,
    emoji: row.emoji,
    tags: row.tags ?? [],
    position: row.position,
    // Contado sobre los items que viajan en este mismo fichero, no sobre los
    // vivos: un numero que no cuadra con el array de al lado es un numero que
    // miente, y el sobre del export cuenta sus arrays por la misma razon.
    itemCount,
    role,
    shared: false,
    version: row.version,
    orderMode: row.orderMode,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}

function toItem(row: typeof listItems.$inferSelect, role: MembershipRoleName): ListItem {
  return {
    id: row.id,
    listId: row.listId,
    title: row.title,
    position: row.position,
    completed: row.completed,
    priority: row.priority,
    // Un icono que este build no conoce no es icono, y no una fila rota: la
    // columna es texto libre y el contrato es un conjunto cerrado.
    icon: isItemIcon(row.icon) ? row.icon : null,
    iconStyle: row.iconStyle,
    iconColor: row.iconColor,
    tags: row.tags ?? [],
    externalId: row.externalId,
    // Identidad: sin parsear, sin serializar y sin seleccionar claves. Lo que
    // hay almacenado es lo que viaja.
    metadata: row.metadata,
    annotation: row.annotation,
    // El role de la lista, no uno propio: lo que se puede hacer con una fila
    // lo decide la lista en la que esta.
    role,
    shared: false,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}

function toNote(row: typeof notes.$inferSelect, role: MembershipRoleName): Note {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    folderId: row.folderId,
    title: row.title,
    document: row.document,
    plainText: row.plainText,
    tags: row.tags ?? [],
    position: row.position,
    // Columna desnormalizada: se mapea tal como esta guardada, no se recuenta.
    attachmentCount: row.attachmentCount,
    role,
    shared: false,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}

function toAttachment(row: typeof attachments.$inferSelect): ExportedAttachment {
  // `storageKey` se queda fuera a proposito: es una clave interna del servidor
  // y el fichero exportado se lee fuera de la cuenta. Lo que un importador
  // necesita es el nombre, el tipo y el tamano; los bytes se vuelven a subir.
  const { storageKey: _omitida, ...resto } = row;
  return {
    ...resto,
    createdAt: row.createdAt.toISOString(),
  };
}

function toTemplate(row: typeof noteTemplates.$inferSelect): NoteTemplate {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    description: row.description,
    icon: row.icon,
    scope: row.scope,
    document: row.document,
    plainText: row.plainText,
    builtInKey: row.builtInKey,
    createdBy: row.createdBy,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}

/**
 * Leer una cuenta entera y devolverla como fichero.
 *
 * La diferencia con el servicio de lectura es una y es deliberada: **aqui no
 * hay ningun `isNull(deletedAt)` en ninguna consulta**. Una fila borrada es
 * dato: el export la incluye CON su `deletedAt`, porque sin el un restore
 * devolveria las cosas que la persona borro sin forma de distinguirlas de las
 * que no. Lo que borra un `isNull` copiado de `contentQueryService` no es un
 * detalle, es el proposito del fichero.
 *
 * La autorizacion es la misma pregunta que hace el resto de la API:
 * pertenencia al espacio. Y como estos endpoints solo devuelven espacios de
 * los que la persona es miembro, `shared` es `false` en todas las filas y el
 * `role` sale de `memberships.role` — igual que en `contentQueryService` y
 * `note-service.ts`, donde la razon esta escrita con mas calma.
 */
export class ExportService {
  private async db(): Promise<Database> {
    return (await getDatabase()).db;
  }

  /** Espacios a los que pertenece la persona. Todo lo demas se filtra por esto. */
  private async visibleWorkspaceIds(userId: string): Promise<string[]> {
    const db = await this.db();
    const rows = await db
      .select({ id: memberships.workspaceId })
      .from(memberships)
      .where(eq(memberships.userId, userId));
    return rows.map((row) => row.id);
  }

  /** El role de la persona en cada espacio suyo, en una consulta. */
  private async membershipRoles(userId: string): Promise<Map<string, MembershipRoleName>> {
    const db = await this.db();
    const rows = await db
      .select({ workspaceId: memberships.workspaceId, role: memberships.role })
      .from(memberships)
      .where(eq(memberships.userId, userId));
    return new Map(rows.map((row) => [row.workspaceId, row.role]));
  }

  private async roleIn(
    userId: string,
    workspaceId: string,
  ): Promise<MembershipRoleName | null> {
    const db = await this.db();
    const [row] = await db
      .select({ role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.userId, userId), eq(memberships.workspaceId, workspaceId)))
      .limit(1);
    return row ? row.role : null;
  }

  private async canSeeWorkspace(userId: string, workspaceId: string): Promise<void> {
    const db = await this.db();
    const [row] = await db
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.userId, userId), eq(memberships.workspaceId, workspaceId)))
      .limit(1);

    if (!row) {
      // Invisible e inexistente son la misma respuesta a proposito.
      throw HttpError.notFound('Workspace not found');
    }
  }

  private async accountOf(userId: string): Promise<{
    id: string;
    email: string;
    displayName: string;
  }> {
    const db = await this.db();
    const [row] = await db
      .select({ id: users.id, email: users.email, displayName: users.displayName })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!row) {
      throw HttpError.notFound('Account not found');
    }
    return row;
  }

  /**
   * La cuenta entera: los siete arrays y el sobre que los cuenta.
   *
   * Siete select ordenados de fuera a dentro — espacios, carpetas, listas,
   * items, notas, adjuntos y plantillas — y los tres ultimos cuelgan de los
   * anteriores por id. Ninguno filtra por `deletedAt`.
   */
  async accountJson(userId: string): Promise<ExportFile> {
    const account = await this.accountOf(userId);
    // Una sola vez para todo el fichero: las piezas no pueden llevar dos
    // momentos distintos dentro del mismo export, y el nombre del fichero
    // lleva la misma fecha.
    const exportedAt = new Date().toISOString();

    // Sin vuelta temprana para la cuenta sin espacios: tambien puede tener
    // plantillas personales, y esas no cuelgan de ningun id. Las consultas
    // con `inArray` se guardan por longitud para no emitir SQL vacio.
    const workspaceIds = await this.visibleWorkspaceIds(userId);
    const roles = await this.membershipRoles(userId);
    const db = await this.db();

    // 1. Espacios, con el role y el memberCount que pide el contrato: salen de
    //    la pertenencia, igual que en `workspace-query-service.ts`. Sin filtro
    //    de `deletedAt`: un espacio borrado tambien es cuenta.
    const workspaceRows = await db
      .select({
        id: workspaces.id,
        name: workspaces.name,
        description: workspaces.description,
        emoji: workspaces.emoji,
        color: workspaces.color,
        colorTo: workspaces.colorTo,
        wash: workspaces.wash,
        version: workspaces.version,
        createdAt: workspaces.createdAt,
        updatedAt: workspaces.updatedAt,
        deletedAt: workspaces.deletedAt,
        role: memberships.role,
        memberCount: sql<number>`(
          select count(*)::int from ${memberships} as m
          where m.workspace_id = ${workspaces.id}
        )`,
      })
      .from(memberships)
      .innerJoin(workspaces, eq(memberships.workspaceId, workspaces.id))
      .where(eq(memberships.userId, userId));

    const workspacesExportados: Workspace[] = workspaceRows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      emoji: row.emoji,
      color: row.color,
      colorTo: row.colorTo,
      wash: row.wash,
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
      role: row.role as Workspace['role'],
      memberCount: row.memberCount,
      // Todo sale de memberships, asi que nada de aqui fue prestado: la
      // bandera es falsa por construccion, no por atajo.
      shared: false,
    }));

    // 2. Carpetas. El role es el del espacio: una carpeta no tiene uno propio,
    //    y olvidarlo aqui es el error mas facil de toda la exportacion porque
    //    el servicio de lectura casi nunca devuelve carpetas.
    const folderRows =
      workspaceIds.length > 0
        ? await db.select().from(folders).where(inArray(folders.workspaceId, workspaceIds))
        : [];

    // 3. Listas.
    const listRows =
      workspaceIds.length > 0
        ? await db.select().from(lists).where(inArray(lists.workspaceId, workspaceIds))
        : [];

    // 4. Items, por los ids de las listas, no por rango.
    const listIds = listRows.map((row) => row.id);
    const itemRows =
      listIds.length > 0
        ? await db
            .select()
            .from(listItems)
            .where(inArray(listItems.listId, listIds))
            .orderBy(asc(listItems.position), asc(listItems.createdAt))
        : [];

    // 5. Notas.
    const noteRows =
      workspaceIds.length > 0
        ? await db.select().from(notes).where(inArray(notes.workspaceId, workspaceIds))
        : [];

    // 6. Adjuntos, por los ids de las notas.
    const noteIds = noteRows.map((row) => row.id);
    const attachmentRows =
      noteIds.length > 0
        ? await db.select().from(attachments).where(inArray(attachments.noteId, noteIds))
        : [];

    // 7. Plantillas: las de los espacios de la persona Y las suyas propias.
    //    Las personales no cuelgan de ningun id — tienen `workspaceId: null`
    //    y siguen a su autor — y una copia de seguridad que las pierde es
    //    justo el agujero por el que las plantillas entraron en el export.
    //    Las personales de otra persona no casan con ninguna rama, y las
    //    integradas del catalogo no tienen `createdBy` y se reinstalan solas:
    //    tampoco viajan. Sin filtro de `deletedAt`, como en el resto.
    const templateRows = await db
      .select()
      .from(noteTemplates)
      .where(
        workspaceIds.length > 0
          ? or(
              inArray(noteTemplates.workspaceId, workspaceIds),
              eq(noteTemplates.createdBy, userId),
            )
          : eq(noteTemplates.createdBy, userId),
      );

    const roleOf = (workspaceId: string): MembershipRoleName =>
      roles.get(workspaceId) ?? 'viewer';

    // El espacio de cada lista, para darle a cada item el role de su lista.
    const spaceOfList = new Map(listRows.map((row) => [row.id, row.workspaceId]));

    // Los items que viajan con cada lista, para que el `itemCount` cuente el
    // fichero y no otra cosa.
    const itemsPerList = new Map<string, number>();
    for (const row of itemRows) {
      itemsPerList.set(row.listId, (itemsPerList.get(row.listId) ?? 0) + 1);
    }

    const sobre = accountExportEnvelope({
      account,
      exportedAt,
      workspaces: workspacesExportados,
      folders: folderRows.map((row) => toFolder(row, roleOf(row.workspaceId))),
      lists: listRows.map((row) =>
        toList(row, roleOf(row.workspaceId), itemsPerList.get(row.id) ?? 0),
      ),
      items: itemRows.map((row) =>
        toItem(row, roleOf(spaceOfList.get(row.listId) ?? '')),
      ),
      notes: noteRows.map((row) => toNote(row, roleOf(row.workspaceId))),
      attachments: attachmentRows.map(toAttachment),
      templates: templateRows.map(toTemplate),
    });

    return {
      body: JSON.stringify(sobre, null, 2),
      contentType: 'application/json',
      filename: exportFilename({
        title: 'export',
        fallbackId: account.id,
        extension: 'json',
        date: exportedAt.slice(0, 10),
      }),
    };
  }

  /**
   * Una lista con su contexto minimo: el espacio, la carpeta si la hay, y sus
   * items — incluidos los borrados, por la misma razon que en la cuenta.
   *
   * Privado: los dos metodos publicos (JSON y CSV) salen del mismo sobre, asi
   * que el fichero y la hoja no pueden discrepar, y el nombre del fichero sale
   * siempre del titulo que ya esta cargado aqui.
   */
  private async listEnvelope(userId: string, listId: string): Promise<ListExport> {
    const db = await this.db();
    // Sin `isNull(deletedAt)`: exportar una lista borrada tiene sentido, es
    // exactamente el dato que alguien querria recuperar.
    const [row] = await db.select().from(lists).where(eq(lists.id, listId)).limit(1);

    if (!row) {
      throw HttpError.notFound('List not found');
    }

    // La autorizacion va despues de la carga, igual que en `getList`: una lista
    // en un espacio que la persona no ve es indistinguible de una que no
    // existe, y por eso la respuesta es 404 y no 403.
    await this.canSeeWorkspace(userId, row.workspaceId);
    const role = (await this.roleIn(userId, row.workspaceId)) ?? 'viewer';

    const account = await this.accountOf(userId);

    const [workspaceRow] = await db
      .select({ id: workspaces.id, name: workspaces.name })
      .from(workspaces)
      .where(eq(workspaces.id, row.workspaceId))
      .limit(1);
    if (!workspaceRow) {
      throw HttpError.notFound('Workspace not found');
    }

    let folder: { id: string; name: string } | null = null;
    if (row.folderId) {
      const [folderRow] = await db
        .select({ id: folders.id, name: folders.name })
        .from(folders)
        .where(eq(folders.id, row.folderId))
        .limit(1);
      folder = folderRow ? { id: folderRow.id, name: folderRow.name } : null;
    }

    const itemRows = await db
      .select()
      .from(listItems)
      .where(eq(listItems.listId, listId))
      .orderBy(asc(listItems.position), asc(listItems.createdAt));

    const items = itemRows.map((itemRow) => toItem(itemRow, role));

    return listExportEnvelope({
      account,
      workspace: workspaceRow,
      folder,
      list: toList(row, role, items.length),
      items,
      exportedAt: new Date().toISOString(),
    });
  }

  async listJson(userId: string, listId: string): Promise<ExportFile> {
    const sobre = await this.listEnvelope(userId, listId);
    return {
      body: JSON.stringify(sobre, null, 2),
      contentType: 'application/json',
      filename: exportFilename({
        title: sobre.list.title,
        fallbackId: sobre.list.id,
        extension: 'json',
        date: sobre.exportedAt.slice(0, 10),
      }),
    };
  }

  /**
   * El CSV de una lista. Sale del mismo sobre que el JSON — las mismas filas,
   * el mismo orden — y lo escribe `itemsToCsv`, que es el unico sitio donde
   * se construye un CSV. El nombre sale del mismo titulo: una ruta que lo
   * computara sin la lista cargada daria dos nombres para la misma lista.
   */
  async listCsv(userId: string, listId: string): Promise<ExportFile> {
    const sobre = await this.listEnvelope(userId, listId);
    return {
      body: itemsToCsv({ list: sobre.list, items: sobre.items }),
      contentType: 'text/csv',
      filename: exportFilename({
        title: sobre.list.title,
        fallbackId: sobre.list.id,
        extension: 'csv',
        date: sobre.exportedAt.slice(0, 10),
      }),
    };
  }
}

export const exportService = new ExportService();
