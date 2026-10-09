import type {
  BoardStates,
  ShareNodeType,
  SyncConflict,
  SyncOperation,
  SyncOperationResult,
  SyncPullRequest,
  SyncPullResponse,
  SyncPushResponse,
} from '@orbit-hub/contracts';
import {
  bookmarkSchema,
  collectionSchema,
  MAX_BOARD_STATES,
  NOTE_DOCUMENT_MAX_BYTES,
  isKnownStateId,
  normalizaColor,
  noteDocumentSchema,
  noteDocumentToPlainText,
  sanitiseIconRef,
  sanitiseTagColors,
  syncOperationSchema,
} from '@orbit-hub/contracts';
import type { IconRef } from '@orbit-hub/contracts';
import { and, eq } from 'drizzle-orm';

import { getDatabase } from '../../db/client.js';
import {
  LIST_KINDS,
  LIST_ORDER_MODES,
  WORKSPACE_COLORS,
  WORKSPACE_WASHES,
  MEMBERSHIP_ROLE_RANK,
  SYNC_ENTITIES,
  SYNC_WRITABLE_FIELDS,
} from '../../db/constants.js';
import type {
  ListKindName,
  MembershipRoleName,
  SyncEntityName,
} from '../../db/constants.js';
import { HttpError } from '../../lib/http-error.js';
import { logger } from '../../lib/logger.js';

import { shareService } from '../shares/share-service.js';
import { syncConflicts } from '../../db/schema.js';

import { syncRepository } from './sync-repository';
import type { StoredEntity } from './sync-repository';

/**
 * The id a result carries when the operation it belongs to has no usable one.
 *
 * The zero uuid is accepted by the contract for exactly this, and inventing a
 * random one would make a rejected operation look like a different operation.
 */
const UNKNOWN_OPERATION_ID = '00000000-0000-0000-0000-000000000000';

/** The most screens a panel is allowed to claim, matching the client's own cap. */
const DASHBOARD_MAX_PAGES = 8;

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;

/** Reads a uuid out of an unvalidated operation, or reports that there is none. */
function readUuid(raw: unknown, key = 'operationId'): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = (raw as Record<string, unknown>)[key];
  return typeof value === 'string' && UUID_PATTERN.test(value) ? value : null;
}

function readEntity(raw: unknown): SyncEntityName | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = (raw as Record<string, unknown>)['entity'];
  return typeof value === 'string' && (SYNC_ENTITIES as readonly string[]).includes(value)
    ? (value as SyncEntityName)
    : null;
}

interface AppliedResult {
  status: SyncOperationResult['status'];
  version: number | null;
  error?: string;
}

/**
 * The contract declares every entity the product will ever sync; this build
 * stores a subset. Anything else is rejected instead of being silently ignored.
 */
function assertSupportedEntity(entity: string): SyncEntityName {
  if (!(SYNC_ENTITIES as readonly string[]).includes(entity)) {
    throw HttpError.validation(`The entity "${entity}" is not synced yet`);
  }
  return entity as SyncEntityName;
}

/**
 * Re-derives the columns a client must not choose.
 *
 * `plain_text` is what search matches on and `document` is what a person reads,
 * so a client that could write them separately could make them disagree, and the
 * note would show one thing and be found by another. The document is re-validated
 * here as well, because this is the write path a device takes when it is offline
 * and syncing later, and it must not be the one place a document skips the check.
 */
function noteFieldsForWrite(
  entity: SyncEntityName,
  values: Record<string, unknown>,
): Record<string, unknown> {
  if (entity !== 'note' || typeof values['document'] !== 'string') return values;
  return { ...values, plainText: noteDocumentToPlainText(values['document']) };
}

/**
 * Keeps only the fields the sync protocol owns, coerced to the column types.
 * Anything else in the payload is dropped instead of being written.
 */
/**
 * Column widths for the free-text fields, per entity.
 *
 * These are the `varchar` lengths in `content-schema.ts`. The contract schemas
 * in `packages/contracts` carry the same numbers as validation, and the two
 * copies are checked against each other by `sync-limits.test.ts` — which reads
 * the columns, so a migration that changes a width cannot leave this stale
 * without a test going red.
 */
const STRING_LIMITS: Partial<Record<SyncEntityName, Record<string, number>>> = {
  // No `icon` entry and no `emoji` one either: the icon is a jsonb object whose
  // shape the contract fixes, so there is no width here to keep in step with.
  workspace: { name: 80, description: 500 },
  folder: { name: 120 },
  list: { title: 120, description: 1000 },
  list_item: { annotation: 2000 },
  note: { title: 200 },
  collection: { name: 120, description: 500, emoji: 16 },
  bookmark: { title: 300 },
};

/**
 * El techo de una URL guardada, y el filtro de esquema que la hace una URL.
 *
 * `url` no lleva entrada en `STRING_LIMITS` a proposito: la columna es `text` y
 * no tiene ancho, asi que ese mapa existe solo para acotar a un `varchar`. El
 * limite de 2048 y el `http`/`https` los trae el contrato, pero **el contrato
 * no es una frontera de confianza para una peticion que sale del servidor**: en
 * la fase 2 el endpoint de extraccion hace `fetch` de esta URL, y un
 * `refine()` que se puede saltar con otro cliente --un script, una version vieja,
 * el movil propio-- deja el SSRF esperando. Las dos capas hacen falta, y esta es
 * la del servidor.
 */
const BOOKMARK_URL_MAX = 2048;

/**
 * Dice si el valor es una URL que el servidor va a pedir.
 *
 * `z.url()` acepta `data:`, y un `data:text/plain,...` pegado del share sheet no
 * es una pagina: es un payload. Se prueba por prefijo y no con `URL` a proposito,
 * porque `new URL('http:/x')` tambien parsea y normaliza a algo que startsWith
 * rechaza: el chequeo tiene que ser el mismo que el del contrato, no uno
 * parecido.
 */
export function esUrlQueSePuedePedir(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    (value.startsWith('http://') || value.startsWith('https://')) &&
    value.length <= BOOKMARK_URL_MAX
  );
}

/**
 * What a device is told when an operation fails.
 *
 * `The operation failed` was the answer for everything that was not an
 * `HttpError`, and that includes every error Postgres raises on its own — a value
 * too long for a column being the one that happens on ordinary input. The device
 * records the reason and drops the operation from the outbox, so a message that
 * says nothing is a message nobody can act on: the write is gone and there is no
 * way to tell whether retrying could ever work.
 *
 * Postgres error codes are the ones worth naming, because they are stable and
 * they are not guesswork: 22001 is a string longer than its column, 23505 a
 * unique violation, 23503 a foreign key that does not resolve. Everything else
 * stays as it was, because an invented message for an unknown failure is worse
 * than an honest one.
 */
function describeFailureInner(error: unknown): string {
  if (error instanceof HttpError) return error.message;

  const code = (error as { code?: unknown } | null)?.code;

  if (code === '22001') {
    return 'A value is longer than the field allows, so it was not saved.';
  }
  if (code === '23505') {
    return 'That would duplicate something that already exists, so it was not saved.';
  }
  if (code === '23503') {
    return 'It refers to something that does not exist, so it was not saved.';
  }

  return 'The operation failed';
}

/**
 * Exported for its tests, which is also how a test can name what a device is
 * told about a failure without a database.
 */
export function describeFailure(error: unknown): string {
  return describeFailureInner(error);
}

export function sanitisePayload(
  entity: SyncEntityName,
  payload: Record<string, unknown> | null,
): Record<string, unknown> {
  const allowed = new Set(SYNC_WRITABLE_FIELDS[entity]);
  const clean: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(payload ?? {})) {
    if (!allowed.has(key) || value === undefined) continue;

    if (key === 'name' || key === 'description' || key === 'emoji') {
      // Keyed by entity, not by field name. `name` is varchar(80) on a workspace
      // and varchar(120) on a folder: a single number per field name let a write
      // past the column, and that is a 500 from Postgres on ordinary input
      // rather than a rejected operation
      // with a message. The widths live in `content-schema.ts`; a test in
      // `sync-limits.test.ts` holds the two together.
      const limit = STRING_LIMITS[entity]?.[key];
      clean[key] = value === null ? null : String(value).slice(0, limit ?? 500);
      continue;
    }

    if (key === 'position') {
      clean[key] = Math.max(0, Math.trunc(Number(value) || 0));
      continue;
    }

    if (key === 'parentId') {
      clean[key] = value === null ? null : String(value);
      continue;
    }

    if (key === 'layout') {
      clean[key] = Array.isArray(value) ? value : [];
      continue;
    }

    if (key === 'pages') {
      // How many screens the panel claims, between one and the most it can hold.
      // A count of zero would erase the panel and a count of thousands would ask
      // for a hundred dots in a bar, and neither is a number a device should be
      // able to send.
      const n = Math.trunc(Number(value));
      clean[key] = Number.isFinite(n) ? Math.min(Math.max(n, 1), DASHBOARD_MAX_PAGES) : 1;
      continue;
    }

    if (key === 'title') {
      // A list title is varchar(120) and a note title is varchar(200), so the
      // old "everything that is not an item is 120" silently threw away eighty
      // characters of a note title. The push still answered `applied`.
      const limit = entity === 'list_item' ? 300 : STRING_LIMITS[entity]?.title ?? 120;
      clean[key] = String(value).slice(0, limit);
      continue;
    }

    if (key === 'position') {
      clean[key] = Math.max(0, Math.trunc(Number(value) || 0));
      continue;
    }

    // Las dos FK opcionales de un bookmark y la unica de una coleccion van
    // juntas: `null` o texto, y nada mas.
    //
    // Sin esta rama no es que `collectionId` se casteara mal: es que el bucle no
    // tiene donde asignarlo y **lo tira**. El allow-list dice que es escribible,
    // el payload lo trae, y la fila se inserta sin el -- el push responde
    // `applied` y el bookmark queda sin clasificar para siempre. Por eso la
    // rama tiene que existir aunque solo castee.
    if (key === 'folderId' || key === 'collectionId') {
      clean[key] = value === null ? null : String(value);
      continue;
    }

    // La URL se limpia antes de nada: un enlace pegado del share sheet llega con
    // espacios, y un espacio en medio de una URL es un fallo de red mas adelante.
    //
    // Sin esta rama el bucle la tira entera, que es peor que guardarla sucia: un
    // bookmark sin `url` no es un error de Postgres porque la columna es `text` y
    // no tiene tope, es un `notNull` en el INSERT. El esquema y el techo los
    // decide la validacion del servicio; aqui lo unico es no escribir lo que no
    // es un texto.
    if (key === 'url') {
      clean[key] = String(value).trim();
      continue;
    }

    if (key === 'completed') {
      clean[key] = value === true;
      continue;
    }

    if (key === 'priority') {
      clean[key] = ['none', 'low', 'medium', 'high'].includes(String(value))
        ? String(value)
        : 'none';
      continue;
    }

    if (key === 'orderMode') {
      // An order from a newer build falls back to manual, which is the order
      // the items are already in: a list is never left unreadable. The list of
      // orders is the contract's, so this cannot fall behind it again.
      const known = LIST_ORDER_MODES.find((mode) => mode === value);
      clean[key] = known ?? 'manual';
      continue;
    }

    if (key === 'color') {
      // One of the names the app offers, or a custom `#RRGGBB`. An unknown one
      // falls back to the default rather than to nothing, because a space with no
      // colour is a card with no colour to read.
      //
      // The hex is checked, not just accepted: this value goes straight into a
      // style on somebody else's phone, and the first version of the check was
      // "is it in the list", which turned every custom colour into slate — and
      // did it silently, so the picker looked like it worked and the space came
      // back grey on every pull.
      //
      // **The check is `normalizaColor`, and the reason is the silent one.** This
      // used to be a second hex regex of its own — six digits, `#` required, any
      // case— and it was the sixth rule for "what is a colour string" in this
      // repository. The app's own validators did not agree with it about `#` or
      // about three digits, so a value a field had just accepted came back
      // `slate` with no error anywhere. The contract owns that question and this
      // file is on the other side of the wire, so this asks it, and it is the
      // normalised hex that is stored: `#abc` and `a1b2c3` now store `#AABBCC` and
      // `#A1B2C3` instead of being thrown away.
      const color = String(value).trim();
      const esNombre = (WORKSPACE_COLORS as readonly string[]).includes(color);
      clean[key] = esNombre ? color : (normalizaColor(color) ?? 'slate');
      continue;
    }

    if (key === 'wash') {
      // One of the two ways a space's colour can be painted. A space written by a
      // build that knew a third gets the default, which is what it had before the
      // field existed.
      const wash = String(value);
      clean[key] = (WORKSPACE_WASHES as readonly string[]).includes(wash) ? wash : 'diagonal';
      continue;
    }

    if (key === 'colorTo') {
      // The colour the wash ends in, chosen the same way as the first one. Null is
      // a real value here and not a failure: it means "not chosen yet", and the app
      // falls back to the darker version of `color` until it is. Anything that is
      // neither null nor a colour this app can draw becomes null, so a broken
      // string cannot become a style object.
      if (value === null || value === undefined) {
        clean[key] = null;
        continue;
      }
      // **The same rule as `color`, and the same function**, which is why there is
      // no regex left here. The fallback is `null` and not `slate`: the two ends are
      // not the same field, and here `null` means "not chosen yet", which is the
      // state the app already knows how to draw.
      const segundo = String(value).trim();
      const esNombre = (WORKSPACE_COLORS as readonly string[]).includes(segundo);
      clean[key] = esNombre ? segundo : normalizaColor(segundo);
      continue;
    }

    if (key === 'icon') {
      // Un objeto, y no una clave suelta: la forma la fija el contrato y una forma
      // que no se puede dibujar es no tener icono, no una fila que no abre.
      clean[key] = sanitiseIconRef(value);
      continue;
    }

    if (key === 'tags') {
      clean[key] = Array.isArray(value)
        ? value.map((tag) => String(tag).trim().slice(0, 40)).filter(Boolean).slice(0, 20)
        : [];
      continue;
    }

    if (key === 'tagColors') {
      // The only labels whose colour somebody chose. A colour this build cannot
      // draw is dropped rather than replaced with `neutral`: dropping leaves the
      // label with no colour chosen, which is a state the map already has and
      // which sends it back to the colour deduced from its name. Replacing it
      // with `neutral` would be a choice nobody made, and it would be stored.
      clean[key] = sanitiseTagColors(value);
      continue;
    }

    if (key === 'kind') {
      // The list of kinds lives in one place, and this was a second copy of it
      // with three entries: a list of series was silently turned into a list of
      // tasks, and the person who created it never found out why.
      clean[key] = LIST_KINDS.includes(value as ListKindName) ? value : 'tasks';
      continue;
    }

    if (key === 'annotation') {
      // A short remark on the row. It was called `notes` until ADR 0008, and the
      // rule here kept the old name, so every `annotation` a client sent fell
      // through every branch below and was dropped without a word: the push
      // answered `applied` and the remark was gone. A rule that names a field
      // that no longer exists is worse than no rule, because the allow-list says
      // the field is writable and this says otherwise.
      clean[key] = value === null ? null : String(value).slice(0, 2000);
      continue;
    }

    if (key === 'stateId') {
      // The column of the board this task is drawn in. Null is a real value and
      // not a failure: it means "wherever the first column is", which is where a
      // task created on any other kind of list lands. Cut to the width of the
      // `varchar(36)` behind it, so an id too long for the column is refused by
      // postgres as a value and not stored as a truncated one that matches no
      // state and silently swallows the task.
      //
      // And **the floor the contract already asks for**, which a ceiling alone
      // does not give: `boardStateSchema.id` is `min(1).max(36)` precisely so an
      // empty string becomes a rejected id instead of an id that matches no state
      // and swallows every task that claims it. An empty string here is stored
      // happily — it is a legal `varchar` — and the two disagree on exactly the
      // edge this comment exists to cover, so the empty one becomes null: the
      // same answer the contract gives it, and the one the invariant check reads.
      const id = value === null ? null : String(value);
      clean[key] = id !== null && id.length > 0 ? id.slice(0, 36) : null;
      continue;
    }

    if (key === 'states') {
      // The columns of a board, as one array and not field by field: reordering,
      // renaming and adding all travel in a single write, and a merge per column
      // would be a merge nobody could resolve anyway.
      //
      // What lands here is only checked for being an array, and the shapes inside
      // are the contract's business: the client is the only thing that builds
      // them, and a board whose states are nonsense is drawn as a board with the
      // columns it could read. Cutting to the contract's own cap keeps a payload
      // from carrying more columns than a board is allowed to have.
      clean[key] = Array.isArray(value)
        ? (value as unknown[]).slice(0, MAX_BOARD_STATES)
        : [];
      continue;
    }

    if (key === 'document') {
      // The body of a note. Cut to the format's own limit rather than to a
      // number chosen here, so the two cannot drift apart. Validation happens
      // after this, at the edge, and a document over the limit is refused
      // rather than quietly shortened: a note that loses its last paragraph is
      // the failure this whole design exists to prevent.
      clean[key] = String(value).slice(0, NOTE_DOCUMENT_MAX_BYTES);
      continue;
    }

    if (key === 'externalId') {
      clean[key] = value === null ? null : String(value).slice(0, 120);
      continue;
    }

    if (key === 'metadata') {
      clean[key] =
        value && typeof value === 'object' && !Array.isArray(value)
          ? (value as Record<string, unknown>)
          : null;
      continue;
    }
  }

  return clean;
}

/**
 * Three way merge.
 *
 * A field is only a conflict when the server changed it *after* the version the
 * client last saw. The client sends what it believed was stored (`base`), so:
 *
 *   server === base  → the client is the only writer: apply
 *   otherwise        → both sides changed it: conflict
 *
 * Without a base state we cannot tell "the server changed it" from "it was
 * always different", so a stale version plus a differing value is a conflict.
 */
function merge(
  operation: SyncOperation,
  server: StoredEntity,
): { values: Record<string, unknown>; conflictingFields: string[] } {
  const clientValues = sanitisePayload(assertSupportedEntity(operation.entity), operation.payload);
  const baseValues = operation.base ?? null;
  const conflictingFields: string[] = [];
  /** Only the fields that actually differ, so a no-op save stays a no-op. */
  const values: Record<string, unknown> = {};

  for (const [key, rawClientValue] of Object.entries(clientValues)) {
    const clientValue = rawClientValue ?? null;
    const serverValue = server[key] ?? null;
    const sameAsServer = JSON.stringify(serverValue) === JSON.stringify(clientValue);

    // Both sides arrived at the same value, so nobody disagreed about anything.
    //
    // This is the case that made every note created and typed into arrive as a
    // conflict. Two saves of one document, the first applied and the second sent
    // with a base from before it: `serverChanged` and `clientChanged` are both
    // true, and the field was reported as contested even though the two values
    // were byte for byte the same. Asking somebody to choose between a value and
    // itself is worse than doing nothing, because it is a question with no answer
    // that still leaves a conflict in the sync centre.
    if (sameAsServer) continue;

    values[key] = clientValue;

    if (baseValues === null) {
      conflictingFields.push(key);
      continue;
    }

    const baseValue = baseValues[key] ?? null;
    const serverChanged = JSON.stringify(serverValue) !== JSON.stringify(baseValue);
    const clientChanged = JSON.stringify(clientValue) !== JSON.stringify(baseValue);

    if (serverChanged && clientChanged) {
      conflictingFields.push(key);
    }
  }

  return { values, conflictingFields };
}

export class SyncService {
  /**
   * Whether this person may write in this node.
   *
   * Two doors, and this is the second one. The membership of the space decides
   * everything for a person who is in it; for somebody who is not, the only way
   * in is a grant on the node or on something above it, and a grant of `editor` is
   * a real way to edit. Without this, a shared list is a list you can look at and
   * not touch, and nobody was told that when it was shared with them.
   *
   * The 404 for "no membership" comes before the grant is even consulted on
   * purpose: a node in a space you cannot see and a node that does not exist have
   * to look the same, and a grant is not a way to find out whether an id is real
   * in a space you have never seen.
   */
  /**
   * Whether this person owns the space, and may therefore erase what is in it.
   *
   * Deliberately **only** ownership, and not "can edit": see the comment on the delete
   * branch. The two facts a caller has are `roleInWorkspace` and the share access, and
   * this uses the first and ignores the second, because a grant is permission to work
   * on somebody's thing and never permission to destroy it.
   *
   * An `owner` **membership** is the test, and it is the same fact for the space itself
   * as for its contents: the person who made a space has an `owner` row in it. So one
   * method covers "delete this space" and "delete this list", which is why the caller
   * passes the space in both cases instead of branching.
   *
   * A space this person cannot see is a 404 and not a 403, so that "you may not" and
   * "it is not there" stay the same sentence and the error is not a way of finding out
   * which ids are real.
   */
  private async assertCanDelete(workspaceId: string | null, userId: string): Promise<void> {
    if (!workspaceId) throw HttpError.notFound('Workspace not found');
    const role = await syncRepository.roleInWorkspace(workspaceId, userId);
    if (role === null) throw HttpError.notFound('Workspace not found');
    if (role !== 'owner') {
      throw HttpError.forbidden('Only the owner can delete this: you were shared it, not given it');
    }
  }

  private async assertCanWrite(
    workspaceId: string | null,
    userId: string,
    target?: { nodeType: ShareNodeType; nodeId: string },
  ): Promise<void> {
    if (!workspaceId) {
      // Workspaces and dashboards are owned by the user; authorisation is the
      // ownership check below.
      return;
    }

    const role = await syncRepository.roleInWorkspace(workspaceId, userId);
    if (!role) {
      if (target) {
        // The grant is only worth looking up if the node resolves, and a node that
        // does not resolve must not say so: "this exists but is not yours" and
        // "this does not exist" have to be the same 404, or the error is a way of
        // finding out which ids are real in a space you have never seen.
        const resoluble = await shareService.resolveTarget(target.nodeType, target.nodeId).catch(() => null);
        if (resoluble) {
          const acceso = await shareService.accessFor(resoluble, userId);
          if (acceso === 'edit') return;
          if (acceso === 'view') {
            throw HttpError.forbidden('You need edit access to make this change');
          }
        }
      }
      // A resource the user cannot see and one that does not exist look the same.
      throw HttpError.notFound('Workspace not found');
    }

    if (MEMBERSHIP_ROLE_RANK[role as MembershipRoleName] < MEMBERSHIP_ROLE_RANK['editor']) {
      // Being a viewer in the space is a ceiling: a grant on something inside it
      // does not turn you into an editor there. `accessOf` has the rule; this is
      // the same answer reached from the other direction.
      throw HttpError.forbidden('You need edit access to make this change');
    }
  }

  /**
   * Items inherit the workspace of their list. Resolving it here keeps the
   * permission check in one place and hides the list behind the same 404.
   */
  /**
   * El espacio de una fila que lleva su propio `workspace_id`.
   *
   * Un item de lista tiene que buscar su lista porque no lleva ninguno. Una nota,
   * una coleccion y un bookmark si lo llevan, asi que esto lee la fila que ya
   * tenemos en vez de gastar una segunda consulta -- y las tres comparten el
   * metodo porque la pregunta es identica, no por conveniencia.
   */
  private workspaceDeLaFila(row: StoredEntity): string | null {
    return (row['workspaceId'] as string | null) ?? null;
  }

  /** The list a row belongs to. `null` when the row does not say which one. */
  private async listOfItem(item: StoredEntity): Promise<StoredEntity | null> {
    const listId = item['listId'] as string | null;
    if (!listId) return null;

    const list = await syncRepository.findEntity('list', listId);
    if (!list) {
      throw HttpError.notFound('List not found');
    }
    return list;
  }

  /** The space a row belongs to, read off the list it already looked up. */
  private async workspaceOfListItem(item: StoredEntity, userId: string): Promise<string | null> {
    const list = await this.listOfItem(item);
    if (list === null) return null;
    void userId;
    return (list['workspaceId'] as string | null) ?? null;
  }

  /**
   * La carpeta de un destino, comprobada contra el espacio del payload.
   *
   * **Review Focus #3.** El cliente no es una frontera de seguridad (AGENTS.md
   * regla 8), asi que un `folderId` que llega en el payload es una afirmacion y
   * no un hecho: si no se contrasta aqui, un bookmark puede colgar de una carpeta
   * de otro espacio --la fila entra, la FK se cumple porque la carpeta existe, y
   * el arbol del otro espacio se abre con un enlace ajeno dentro--. Este es el
   * unico lugar donde se puede comprobar, porque es el unico que inserta.
   *
   * Los dos fallos son distintos a proposito. Una carpeta que **no existe** es un
   * 404, igual que en el resto del servicio. Una que existe en **otro** espacio
   * es un 422 con el motivo escrito: quien la manda ya es miembro del espacio del
   * payload, o sea que no le revelamos nada nuevo, y "tu carpeta no es de
   * aqui" es un mensaje que la persona puede entender y un 404 no.
   */
  private async resolveCarpetaDeEsteEspacio(
    folderId: string | null | undefined,
    workspaceId: string,
  ): Promise<string | null> {
    /**
     * `== null` y no `=== null`, y no es estilo.
     *
     * `sanitisePayload` copia **solo las claves que vienen en el payload**, asi
     * que una clave ausente llega aqui como `undefined`. Con un guard estricto,
     * `undefined` pasaba el "no hay carpeta" y se iba a `eq(folders.id,
     * undefined)`, que el driver traduce a `NULL`: la consulta no trae filas y el
     * resultado es `HttpError.notFound('Folder not found')` para una coleccion que
     * no queria estar en ninguna carpeta. Eso es el caso normal, no el exotico, y
     * hacia que **no se pudiera crear ninguna coleccion**.
     *
     * Lo loose blinda a todos los que llamen a este metodo, no solo a los que se
     * acuerden del `?? null`. Es el otro camino por el que vuelve a colarse
     * `undefined`.
     */
    if (folderId == null) return null;

    const carpeta = await syncRepository.findEntity('folder', folderId);
    if (!carpeta || carpeta['deletedAt']) {
      throw HttpError.notFound('Folder not found');
    }
    if (carpeta['workspaceId'] !== workspaceId) {
      throw HttpError.validation('That folder is not in this workspace');
    }
    return carpeta['id'] as string;
  }

  /**
   * La coleccion de un destino, comprobada contra el espacio del payload.
   *
   * `null` cuando no hay coleccion: sin clasificar es un destino valido. La fila
   * y no el id, porque el create necesita leerle el `folderId` para derivarlo.
   *
   * El mismo contrato que `resolveCarpetaDeEsteEspacio`, y por el mismo motivo:
   * el cliente no es una frontera de seguridad, y la FK de `collection_id` se
   * cumple con cualquier coleccion que exista, sea de quien sea.
   */
  private async findColeccionDeEsteEspacio(
    collectionId: string | null | undefined,
    workspaceId: string,
  ): Promise<StoredEntity | null> {
    // Loose por la misma razon que `resolveCarpetaDeEsteEspacio`: una clave
    // ausente en el payload es `undefined`, no `null`.
    if (collectionId == null) return null;

    const coleccion = await syncRepository.findEntity('collection', collectionId);
    if (!coleccion || coleccion['deletedAt']) {
      throw HttpError.notFound('Collection not found');
    }
    if (coleccion['workspaceId'] !== workspaceId) {
      throw HttpError.validation('That collection is not in this workspace');
    }
    return coleccion;
  }

  /** El primer motivo de un `safeParse` fallido, en una linea y en ingles. */
  private primerMotivoDe(error: { issues: ReadonlyArray<{ path: PropertyKey[]; message: string }> }): string {
    const issue = error.issues[0];
    if (!issue) return 'The values sent are not valid';
    const donde = issue.path.length ? `"${issue.path.join('.')}" is not valid: ` : '';
    return `${donde}${issue.message}`.slice(0, 500);
  }

  /**
   * Los bookmarks siguen a su coleccion cuando esta se mueve de carpeta.
   *
   * Se compara la fila aplicada con la que habia, y no el payload: asi cubre
   * los dos caminos que escriben (version al dia y merge) sin razonar dos
   * veces sobre que trajo el cliente. Sin cambio de carpeta no hay nada que
   * hacer, y en conflicto no se aplico nada, asi que tampoco.
   */
  private async seguirCarpetaDeColeccion(
    entity: SyncEntityName,
    antes: StoredEntity,
    despues: StoredEntity,
  ): Promise<void> {
    if (entity !== 'collection') return;
    const carpetaAntes = (antes['folderId'] as string | null) ?? null;
    const carpetaAhora = (despues['folderId'] as string | null) ?? null;
    if (carpetaAntes === carpetaAhora) return;
    await syncRepository.moveBookmarksToFolder(despues.id, carpetaAhora);
  }

  private async apply(operation: SyncOperation, userId: string): Promise<AppliedResult> {
    // Narrowed once: this build stores a subset of the entities in the contract.
    const entity = assertSupportedEntity(operation.entity);
    // The dashboard row is per user and created on first write, so it is
    // handled before the generic "record does not exist" path.
    if (entity === 'dashboard') {
      const limpio = sanitisePayload('dashboard', operation.payload);
      const row = await syncRepository.upsertDashboard(
        userId,
        limpio['layout'] ?? [],
        Number(limpio['pages'] ?? 1),
      );
      return { status: 'applied', version: row.version };
    }

    const existing = await syncRepository.findEntity(entity, operation.entityId);

    if (operation.kind === 'create') {
      if (existing) {
        // A workspace whose owner membership went missing is a row nobody can
        // reach: every read of it joins on the membership and 404s, every child
        // fails the write check, and retrying the create can never fix it because
        // the retry is absorbed here. That is how a space somebody made on their
        // phone ends up permanently invisible — the client asks for its members
        // and the server says it does not exist, with nothing to recover from.
        //
        // Repaired only when the workspace has no members at all. A workspace that
        // already has owners belongs to them, and a create naming somebody else's
        // workspace is not a way in: the row stays closed, which is why the check
        // is "orphan" and not "the caller is not a member".
        if (entity === 'workspace' && !(await syncRepository.hasAnyMember(operation.entityId))) {
          await syncRepository.addMembership(operation.entityId, userId, 'owner');
        }
        // The client created something that already exists: the row wins and
        // the duplicate create is absorbed. This is the retry case.
        return { status: 'duplicate', version: existing.version };
      }

      const payload = sanitisePayload(entity, operation.payload);
      const rawWorkspaceId = operation.payload?.['workspaceId'];
      const workspaceId = typeof rawWorkspaceId === 'string' ? rawWorkspaceId : '';

      switch (entity) {
        case 'workspace': {
          // Every writable field flows through from the sanitised payload, and
          // only the ones with no default are filled in here, for the same
          // reason the list and the item are built that way.
          const row = await syncRepository.insertEntity('workspace', {
            ...payload,
            id: operation.entityId,
            name: (payload['name'] as string) ?? 'Workspace',
            // Named by hand even though the payload is spread above: the spread
            // carries `icon` whatever the sanitiser made of it, and an explicit
            // `null` is the state the column is nullable for.
            icon: (payload['icon'] as IconRef | null) ?? null,
          });
          // The creator owns what they create.
          await syncRepository.addMembership(row.id, userId, 'owner');
          return { status: 'applied', version: row.version };
        }

        case 'folder': {
          if (workspaceId.length === 0) {
            throw HttpError.validation('A folder needs a workspaceId');
          }
          await this.assertCanWrite(workspaceId, userId, {
            nodeType: 'folder',
            nodeId: operation.entityId,
          });

          const row = await syncRepository.insertEntity('folder', {
            id: operation.entityId,
            workspaceId,
            parentId: (payload['parentId'] as string | null) ?? null,
            name: (payload['name'] as string) ?? 'Folder',
            icon: (payload['icon'] as IconRef | null) ?? null,
            position: (payload['position'] as number) ?? 0,
          });
          return { status: 'applied', version: row.version };
        }

        case 'list': {
          if (workspaceId.length === 0) {
            throw HttpError.validation('A list needs a workspaceId');
          }
          await this.assertCanWrite(workspaceId, userId, {
            nodeType: 'list',
            nodeId: operation.entityId,
          });

          // Every writable field flows through from the sanitised payload, and
          // only the ones with no default are filled in here. Spelling the
          // fields out one by one is how a new field ends up accepted by the
          // validator and then dropped on the floor by the insert, with nothing
          // anywhere saying so.
          const row = await syncRepository.insertEntity('list', {
            ...payload,
            id: operation.entityId,
            workspaceId,
            kind: (payload['kind'] as string) ?? 'tasks',
            title: (payload['title'] as string) ?? 'List',
            position: (payload['position'] as number) ?? 0,
          });
          return { status: 'applied', version: row.version };
        }

        case 'list_item': {
          const rawListId = operation.payload?.['listId'];
          const listId = typeof rawListId === 'string' ? rawListId : '';
          if (listId.length === 0) {
            throw HttpError.validation('An item needs a listId');
          }

          // An item inherits its workspace from the list, and the list is
          // checked for existence first so a dangling item is not created.
          const owner = await syncRepository.findEntity('list', listId);
          if (owner === null || owner['deletedAt']) {
            throw HttpError.notFound('List not found');
          }
          await this.assertCanWrite((owner['workspaceId'] as string | null) ?? null, userId, {
            nodeType: 'list_item',
            nodeId: operation.entityId,
          });

          // The column the item claims is checked against the columns the list
          // has, from the row just read. A task pointing at a state no screen can
          // draw is refused rather than stored: an unknown field is dropped in
          // silence and the push still answers `applied`, and this is the other
          // half of that rule — being writable is not being valid.
          const states = (owner['states'] as BoardStates) ?? [];
          const stateId = (payload['stateId'] as string | null) ?? null;
          if (!isKnownStateId(states, stateId)) {
            throw HttpError.validation('An item needs a state its list has');
          }

          const row = await syncRepository.insertEntity('list_item', {
            ...payload,
            id: operation.entityId,
            listId,
            title: (payload['title'] as string) ?? 'Item',
            position: (payload['position'] as number) ?? 0,
          });
          return { status: 'applied', version: row.version };
        }

        case 'note': {
          // The space comes from the raw payload, not the sanitised one, and it
          // is named rather than spread in. The sanitiser drops `workspaceId`
          // because on an *update* the server owns where a note lives; on a
          // create the client has to say which space the note is for, which is
          // what the `folder` case does above and for the same reason.
          if (workspaceId.length === 0) {
            throw HttpError.validation('A note needs a workspaceId');
          }

          await this.assertCanWrite(workspaceId, userId, {
            nodeType: 'note',
            nodeId: operation.entityId,
          });

          // Validated before it is written, not after: the editor does not
          // sanitise HTML on iOS or Android, and this is the last place the
          // document is ever checked before it reaches a device.
          const document = noteDocumentSchema.parse(payload['document'] ?? '');

          const row = await syncRepository.insertEntity('note', {
            id: operation.entityId,
            workspaceId,
            folderId: (payload['folderId'] as string | null) ?? null,
            title: (payload['title'] as string) ?? 'Note',
            document,
            // Derived here rather than taken from the client, so the body and
            // the text that search matches on cannot drift apart.
            plainText: noteDocumentToPlainText(document),
            tags: Array.isArray(payload['tags']) ? (payload['tags'] as string[]) : [],
            // Named by hand because this `create` does not spread: it is the same
            // one that dropped the icon of a list item once.
            icon: (payload['icon'] as IconRef | null) ?? null,
          });
          return { status: 'applied', version: row.version };
        }

        case 'collection': {
          // Igual que una carpeta: el espacio viene del payload crudo y se nombra
          // uno por uno en vez de esparcirlo, porque el sanitizador tira
          // `workspaceId` y en un create es el cliente quien dice donde vive.
          if (workspaceId.length === 0) {
            throw HttpError.validation('A collection needs a workspaceId');
          }
          // Sin `target`: la puerta del grant es `resolveTarget`, y su
          // `shareNodeTypeSchema` no acepta `collection` ni `bookmark` todavia.
          // Compartir estas entidades es otra fase; mientras tanto el unico
          // permiso que se consulta es la pertenencia al espacio, que es
          // ademas el unico que puede existir.
          await this.assertCanWrite(workspaceId, userId);

          const folderId = await this.resolveCarpetaDeEsteEspacio(
            (payload['folderId'] as string | null | undefined) ?? null,
            workspaceId,
          );

          // Se valida lo que se va a insertar, no lo que llego. Un nombre que
          // el sanitizador corto a 120 y una posicion que el contrato exige
          // entera son cosas que se pueden comprobar aqui, antes del INSERT,
          // en vez de convertirlas en un error de Postgres.
          const fila = {
            folderId,
            name: (payload['name'] as string) ?? 'Collection',
            description: (payload['description'] as string | null) ?? null,
            emoji: (payload['emoji'] as string | null) ?? null,
            position: (payload['position'] as number) ?? 0,
          };
          const valida = collectionSchema.safeParse({
            ...fila,
            id: operation.entityId,
            workspaceId,
            version: 1,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            role: 'editor',
            shared: false,
          });
          if (!valida.success) {
            throw HttpError.validation(this.primerMotivoDe(valida.error));
          }

          const row = await syncRepository.insertEntity('collection', {
            ...fila,
            id: operation.entityId,
            workspaceId,
          });
          return { status: 'applied', version: row.version };
        }

        case 'bookmark': {
          if (workspaceId.length === 0) {
            throw HttpError.validation('A bookmark needs a workspaceId');
          }
          // Mismo criterio que la coleccion: sin `target`, porque compartir un enlace no
          // es parte de esta fase.
          await this.assertCanWrite(workspaceId, userId);

          // El destino se resuelve **antes** de validar nada, y en este orden.
          //
          // La regla de la spec es "si se elige una coleccion, el workspaceId y
          // el folderId salen de la coleccion". Hacerla aqui, en el servidor, es
          // lo que hace que no dependa de que todos los clientes la hagan bien: un
          // cliente que mande `folderId: null` con una coleccion que si tiene
          // carpeta igual termina en la carpeta correcta, en vez de quedar
          // flotando. Y un cliente que mande los tres campos y se equivoque en uno
          // recibe un `rejected` limpio en vez de un bookmark en el espacio
          // ajeno.
          const collectionId = (payload['collectionId'] as string | null | undefined) ?? null;
          const folderIdDelPayload = (payload['folderId'] as string | null | undefined) ?? null;
          let folderId = folderIdDelPayload;

          if (collectionId !== null) {
            const coleccion = await this.findColeccionDeEsteEspacio(collectionId, workspaceId);
            const carpetaDeLaColeccion = (coleccion?.['folderId'] as string | null) ?? null;

            /*
              Los dos campos tienen que decir lo mismo.

              Aceptarlos y creerse el del cliente deja el bookmark clasificado en
              una coleccion y archivado en una carpeta que no es la de esa
              coleccion: un estado que ninguna pantalla sabe dibujar, y que la
              regla de la spec no contempla porque dice que el destino **sale** de
              la coleccion. Se rechaza con el motivo escrito porque el que se
              equivoco es el cliente y necesita saber cual de los dos.
            */
            if (folderIdDelPayload !== null && folderIdDelPayload !== carpetaDeLaColeccion) {
              throw HttpError.validation(
                'The folder has to be the one that belongs to the collection',
              );
            }
            // Si no vino carpeta --ausente o en null-- la de la coleccion manda.
            // Es lo que hace que la regla no dependa de que todos los clientes la
            // hagan bien: uno que mande `folderId: null` con una coleccion que si
            // tiene carpeta termina igual en la carpeta correcta.
            folderId = carpetaDeLaColeccion;
          }

          folderId = await this.resolveCarpetaDeEsteEspacio(folderId, workspaceId);

          // **El segundo filtro de la URL.** El `refine` del contrato exige
          // http/https, y no basta: en la fase 2 el servidor hace `fetch` de esta
          // URL, y un cliente --un script, una version vieja, el movil propio-- no
          // pasa por el contrato. Un `data:text/plain,...` guardado aqui es el
          // SSRF esperando.
          const url = payload['url'];
          if (!esUrlQueSePuedePedir(url)) {
            throw HttpError.validation('A bookmark URL has to be http or https');
          }

          /*
            Los siete campos del servidor, forzados a sus defaults **sin mirar el
            payload**.

            `document` y `plainText` son lo que hace que la busqueda sea un index
            hit y que se pueda leer sin red; `extractionState`, `extractionError`,
            `siteName`, `description` e `imageUrl` los escribe la extraccion de la
            fase 2. El sanitizador ya los tira, porque no son escribibles, y
            ponerlos aqui deja el invariante explicito en el unico lugar que
            inserta: si manana el allow-list crece por lo que sea, el default de
            aqui sigue siendo el que gana.
          */
          const fila = {
            folderId,
            collectionId,
            url,
            title: (payload['title'] as string) ?? '',
            tags: Array.isArray(payload['tags']) ? (payload['tags'] as string[]) : [],
            position: (payload['position'] as number) ?? 0,
            document: '',
            plainText: '',
            extractionState: 'pending' as const,
            extractionError: null,
            siteName: null,
            description: null,
            imageUrl: null,
          };

          const valida = bookmarkSchema.safeParse({
            ...fila,
            id: operation.entityId,
            workspaceId,
            version: 1,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            role: 'editor',
            shared: false,
          });
          if (!valida.success) {
            throw HttpError.validation(this.primerMotivoDe(valida.error));
          }

          const row = await syncRepository.insertEntity('bookmark', {
            ...fila,
            id: operation.entityId,
            workspaceId,
          });
          return { status: 'applied', version: row.version };
        }

        default:
          throw HttpError.validation(`The entity "${entity}" cannot be created`);
      }
    }

    if (!existing) {
      return {
        status: 'rejected',
        version: null,
        error: 'The record no longer exists',
      };
    }

    if (existing.deletedAt) {
      return {
        status: 'rejected',
        version: existing.version,
        error: 'The record has been deleted',
      };
    }

    if (operation.kind === 'delete') {
      /*
       * **Ownership**, and not write access.
       *
       * `assertCanWrite` is the wrong gate here and it was a hole with data loss
       * behind it: a tombstone is global. Somebody lent a note as `editor` — which
       * the share menu offers, and which the badge calls "Puedes editarlo" — could
       * delete it, and the delete applied to the **owner's** note. Verified: the
       * owner's copy came back with `deletedAt` set, from a `status: "applied"`.
       *
       * The two are not on a scale. Editing somebody's list is the thing the role
       * means and it is useful. Deleting it is not editing: it takes it away from the
       * person who wrote it, in every space they have, on every device, and nobody
       * granted that by picking "editor".
       *
       * A `viewer` was already stopped — `acceso === 'view'` throws. That left exactly
       * one hole and it was the widest one, because the person with an editor role is
       * the one the product actively invites to have.
       */
      if (entity === 'workspace') {
        await this.assertCanDelete(operation.entityId, userId);
      } else if (entity === 'folder' || entity === 'list') {
        await this.assertCanDelete((existing['workspaceId'] as string | null) ?? null, userId);
      } else if (entity === 'list_item') {
        await this.assertCanDelete(await this.workspaceOfListItem(existing, userId), userId);
      } else if (entity === 'note') {
        await this.assertCanDelete(this.workspaceDeLaFila(existing), userId);
      } else if (entity === 'collection' || entity === 'bookmark') {
        // Las dos tienen su propia `workspace_id`, igual que una nota: no hace
        // falta cruzarlas con nada para saber de quien son. Sin esta rama un
        // delete de cualquiera de las dos se aplicaria sin comprobar nada.
        await this.assertCanDelete(this.workspaceDeLaFila(existing), userId);
      }

      const row = await syncRepository.updateEntity(entity, operation.entityId, {}, {
        tombstone: true,
      });
      return { status: 'applied', version: row.version };
    }

    // update
    /**
     * La operacion tal cual se va a escribir, y las entidades nuevas pueden
     * necesitar corregirla antes: un cambio de coleccion tiene que mover la
     * carpeta con ella, y eso no cabe en el payload que mando el cliente. Se
     * reescribe la operacion y no el `updateEntity` para que los dos caminos de
     * abajo --la coincidencia de version y el merge-- escriban lo mismo.
     */
    let operacion: SyncOperation = operation;

    if (entity === 'workspace') {
      await this.assertCanWrite(operation.entityId, userId);
    } else if (entity === 'folder' || entity === 'list') {
      await this.assertCanWrite((existing['workspaceId'] as string | null) ?? null, userId, {
        nodeType: entity,
        nodeId: operation.entityId,
      });
    } else if (entity === 'list_item') {
      const list = await this.listOfItem(existing);
      await this.assertCanWrite((list?.['workspaceId'] as string | null) ?? null, userId, {
        nodeType: 'list_item',
        nodeId: operation.entityId,
      });

      // The state is read from the sanitised payload and not from the raw one,
      // because the raw one carries keys that are never written and this has to
      // look at the same keys that are. Sanitising twice is also how the two
      // answers to "what does this payload say" drift apart.
      const limpio = sanitisePayload('list_item', operation.payload);
      // And only when the payload carries a state at all. An item can be left
      // pointing at a column another device deleted, and from then on every edit
      // to it — a title, an icon, its position — is one that does not mention the
      // column. Checking the stored value would make such an item uneditable, and
      // the only write that could rescue it is the write being refused.
      if ('stateId' in limpio) {
        const states = (list?.['states'] as BoardStates) ?? [];
        if (!isKnownStateId(states, (limpio['stateId'] as string | null) ?? null)) {
          throw HttpError.validation('An item needs a state its list has');
        }
      }
    } else if (entity === 'note') {
      await this.assertCanWrite(this.workspaceDeLaFila(existing), userId, {
        nodeType: 'note',
        nodeId: operation.entityId,
      });
    } else if (entity === 'collection' || entity === 'bookmark') {
      // Sin `target`: la puerta del grant no los conoce todavia.
      await this.assertCanWrite(this.workspaceDeLaFila(existing), userId);

      const destino = sanitisePayload(entity, operation.payload);

      /*
        Mover de espacio se valida **en el destino**, no en el origen.

        Cambiar el `workspaceId` de una fila es la unica escritura de este camino
        que cambia de quien es el contenedor, y por eso la unica que necesita **dos**
        permisos: el del espacio viejo (el de arriba, que dice que la fila es tuya) y
        el del nuevo (este, que dice que puedes escribir ahi).

        Sin el segundo, `workspaceId` seria un campo que el cliente puede poner a
        cualquier valor: se podria mandar el id de un espacio ajeno y filtrar ahi un
        enlace. No es robar —la fila ya es tuya— es **dejar algo en un espacio que no
        es tuyo**, que es peor porque no hay sintoma.

        El permiso se pide con `assertCanWrite`, que es el mismo chequeo de membresia
        y rol que usa el create de una coleccion (`:950`), y sin `target` porque
        `resolveTarget` no conoce `collection` ni `bookmark` — lo dice el comentario
        de arriba. Mismo ayudante, misma respuesta.

        Y `folderId` y `collectionId` se resuelven contra el espacio de destino:
        llevarlos del viejo dejaria un bookmark archivado en una carpeta que no
        existe en su espacio nuevo, que es la clase de fila que despues no se puede
        ni borrar desde la app.
      */
      if (entity === 'bookmark' && 'workspaceId' in destino) {
        const espacioDestino = destino['workspaceId'];
        if (typeof espacioDestino !== 'string' || espacioDestino.length === 0) {
          throw HttpError.validation('A bookmark needs a workspaceId to move to');
        }
        if (espacioDestino !== this.workspaceDeLaFila(existing)) {
          await this.assertCanWrite(espacioDestino, userId);
          const carpetaDelDestino = await this.resolveCarpetaDeEsteEspacio(
            (destino['folderId'] as string | null | undefined) ?? null,
            espacioDestino,
          );
          destino['folderId'] = carpetaDelDestino;
          // Si la coleccion vieja no es de este espacio, el bookmark pierde la
          // clasificacion: arrastrarla la dejaria apuntando a una carpeta de otro
          // espacio, y un enlace sin clasificar es un estado valido.
          destino['collectionId'] = null;
        }
      }

      /*
        La URL se filtra tambien en un update, y no solo en el create.

        Filtrarla solo al crear deja la defensa a medias: un cliente que no
        valida --un script, una version vieja-- manda `data:text/html,...` en un
        update y la fila lo acepta igual, porque el sanitizador solo recorta
        espacios. El `refine` del contrato corre antes de la red, no de esta
        escritura, asi que el filtro del servidor tiene que estar en **los dos**
        caminos que escriben la columna.
      */
      if (entity === 'bookmark' && destino['url'] !== undefined) {
        if (!esUrlQueSePuedePedir(destino['url'])) {
          throw HttpError.validation('A bookmark URL has to be http or https');
        }
      }

      /*
        El destino se comprueba tambien aqui, y no solo en el create.

        La regla 8 de AGENTS.md dice que cualquier `folderId` o `collectionId` se
        verifica contra el workspace, y sin esto un update es un agujero igual de
        grande que el create: la FK se cumple porque la carpeta existe, y el
        bookmark queda colgando de una carpeta de otro espacio.
      */
      const workspaceDeLaFila = this.workspaceDeLaFila(existing);
      if (workspaceDeLaFila !== null) {
        const coleccion = await this.findColeccionDeEsteEspacio(
          (destino['collectionId'] as string | null | undefined) ?? null,
          workspaceDeLaFila,
        );
        await this.resolveCarpetaDeEsteEspacio(
          (destino['folderId'] as string | null | undefined) ?? null,
          workspaceDeLaFila,
        );

        if (entity === 'bookmark' && 'collectionId' in destino) {
          /*
            La invariante que create establece tiene que sobrevivir a la primera
            edicion.

            Antes, un update que mandaba solo `collectionId` dejaba el `folderId`
            viejo, que ya no era el de la coleccion nueva: la regla de la spec
            era cierta al crear y falsa a partir de la primera edicion. Y uno
            que mandara los dos con valores distintos se guardaba clasificado en
            una coleccion y archivado en una carpeta que no era de esa coleccion.

            Las formas, entonces:
            - clasificar sin `folderId`: la carpeta se deriva de la coleccion.
            - los dos de acuerdo: se acepta tal cual.
            - los dos en discrepancia: 422 con el motivo, porque el que se
              equivoco es el cliente y necesita saber cual de los dos.
            - desempaquetar (`collectionId` en null) sin `folderId`: la carpeta
              actual se conserva y no se toca nada. Sin clasificar, la carpeta
              la elige la persona, y un update que no la trae no tiene por que
              pisarla. Solo un `folderId` explicito --incluido null-- usa el
              valor traido, porque ese si es una decision.
          */
          const clasifica = (destino['collectionId'] as string | null) !== null;
          if (clasifica) {
            const carpetaDeLaColeccion = (coleccion?.['folderId'] as string | null) ?? null;
            const carpetaDelPayload = (destino['folderId'] as string | null | undefined) ?? null;
            const claveFolderId = Object.prototype.hasOwnProperty.call(destino, 'folderId');

            if (claveFolderId && carpetaDelPayload !== carpetaDeLaColeccion) {
              throw HttpError.validation(
                'The folder has to be the one that belongs to the collection',
              );
            }

            if (!claveFolderId) {
              operacion = {
                ...operation,
                payload: { ...(operation.payload ?? {}), folderId: carpetaDeLaColeccion },
              };
            }
          }
        }

        /*
          Un update que trae solo `folderId` tambien puede romper la
          invariante, y este es el camino por el que entra: `updateBookmarkAction`
          acepta `folderId` suelto, asi que un bookmark clasificado en A (carpeta
          F1) que recibe `{ folderId: F2 }` quedaba clasificado en A y archivado
          en F2. Se compara contra la carpeta de la coleccion actual de la fila:
          si discrepa, 422 con el motivo. Si coincide o la fila no tiene
          coleccion, pasa como hoy.
        */
        if (entity === 'bookmark' && !('collectionId' in destino) && 'folderId' in destino) {
          const actual = (existing['collectionId'] as string | null) ?? null;
          if (actual !== null) {
            const coleccionActual = await syncRepository.findEntity('collection', actual);
            if (coleccionActual !== null) {
              const carpetaDeLaColeccion = (coleccionActual['folderId'] as string | null) ?? null;
              const carpetaDelPayload =
                (destino['folderId'] as string | null | undefined) ?? null;
              if (carpetaDelPayload !== carpetaDeLaColeccion) {
                throw HttpError.validation(
                  'The folder has to be the one that belongs to the collection',
                );
              }
            }
          }
        }
      }
    }

    if (operacion.baseVersion === existing.version) {
      const row = await syncRepository.updateEntity(
        entity,
        operacion.entityId,
        noteFieldsForWrite(entity, sanitisePayload(entity, operacion.payload)),
      );
      await this.seguirCarpetaDeColeccion(entity, existing, row);
      return { status: 'applied', version: row.version };
    }

    const { values, conflictingFields } = merge(operacion, existing);

    if (conflictingFields.length === 0) {
      if (Object.keys(values).length === 0) {
        // Nothing to write: every field the client sent is already the server's
        // value. Bumping the version anyway would tell every other device the
        // note changed when it did not, and each of them would re-render and
        // re-cache a document they already had. A save that changes nothing is
        // answered, not performed.
        return { status: 'applied', version: existing.version };
      }
      // The client had stale data but touched nothing that changed: a safe merge.
      const row = await syncRepository.updateEntity(entity, operation.entityId, values);
      await this.seguirCarpetaDeColeccion(entity, existing, row);
      return { status: 'applied', version: row.version };
    }

    const conflict: Omit<SyncConflict, 'id'> = {
      entity: operation.entity,
      entityId: operation.entityId,
      workspaceId: (existing['workspaceId'] as string | null) ?? null,
      baseVersion: operation.baseVersion,
      serverVersion: existing.version,
      serverRecord: existing as Record<string, unknown>,
      clientRecord: values,
      conflictingFields,
      status: 'pending',
      detectedAt: new Date().toISOString(),
      resolvedAt: null,
    };

    await this.storeConflict(conflict, userId);
    logger.info(
      { entity, entityId: operation.entityId, fields: conflictingFields },
      'sync conflict stored for review',
    );

    return {
      status: 'conflict',
      version: existing.version,
      error: `Conflicting fields: ${conflictingFields.join(', ')}`,
    };
  }

  private async storeConflict(
    conflict: Omit<SyncConflict, 'id'>,
    userId: string,
  ): Promise<void> {
    const { db } = await getDatabase();

    await db
      .insert(syncConflicts)
      .values({
        userId,
        entity: assertSupportedEntity(conflict.entity),
        entityId: conflict.entityId,
        workspaceId: conflict.workspaceId,
        baseVersion: conflict.baseVersion,
        serverVersion: conflict.serverVersion,
        serverRecord: conflict.serverRecord,
        clientRecord: conflict.clientRecord,
        conflictingFields: conflict.conflictingFields,
        status: conflict.status,
        detectedAt: new Date(conflict.detectedAt),
        resolvedAt: null,
      })
      .onConflictDoNothing();
  }

  /**
   * Applies a batch, one operation at a time and each one on its own terms.
   *
   * A push is everything a person wrote while offline, and the batch is
   * validated here rather than at the door: one operation the server cannot
   * read comes back as `rejected` with the reason, and the other hundred are
   * applied. Rejecting the whole batch for one bad operation left the outbox
   * unable to drain, and the app silent, because a client that retries a
   * rejected batch gets the same rejection forever.
   */
  async push(
    _envelope: { deviceId: string; lastPulledAt: string | null },
    userId: string,
    rawOperations: unknown[],
  ): Promise<SyncPushResponse> {
    const results: SyncOperationResult[] = [];

    for (const raw of rawOperations) {
      const parsed = syncOperationSchema.safeParse(raw);

      if (!parsed.success) {
        // The id is the one thing the result cannot do without, and an
        // operation with no usable id has no id at all: the zero uuid is the
        // one the schema itself accepts as "nothing".
        const operationId = readUuid(raw) ?? UNKNOWN_OPERATION_ID;
        const issues = parsed.error.issues.slice(0, 3);
        logger.warn({ issues }, 'sync operation is not valid');

        /*
         * What the client actually sent, in the message.
         *
         * The `entity` field of the result is part of the contract and has to be
         * one the server knows, so an unrecognised name cannot be echoed back
         * there — `dashboard` stands in. It used to stand in *silently*, and that
         * is a trap rather than a fallback: sending `item` where the server knows
         * `list_item` comes back as fifteen rejections of the **dashboard**, and
         * whoever reads that goes to the panel to look for a bug that is in the
         * items. Two things go in the message instead, because both are what the
         * reader needs: the name that arrived, and the first of the validator's
         * own complaints, which is the actual reason.
         */
        const sent = (raw as Record<string, unknown> | null)?.['entity'];
        const from = typeof sent === 'string' ? ` (llega como "${sent}")` : '';
        const why = issues
          .map((issue) =>
            issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message,
          )
          .join('; ');

        results.push({
          operationId,
          status: 'rejected',
          // The contract has no room for a name it does not know, so the field says
          // the nearest thing it can and the message below says the truth.
          entity: readEntity(raw) ?? 'dashboard',
          entityId: readUuid(raw, 'entityId') ?? UNKNOWN_OPERATION_ID,
          version: null,
          error: `The operation is not valid and was not applied${from}${why ? `: ${why}` : ''}`.slice(0, 500),
        });
        continue;
      }

      const operation = parsed.data;
      try {
        const seen = await syncRepository.findOperation(operation.operationId);
        if (seen) {
          // Idempotent replay: answer with what happened the first time.
          results.push({
            operationId: operation.operationId,
            status: 'duplicate',
            entity: operation.entity,
            entityId: operation.entityId,
            version: seen.resultVersion,
            error: null,
          });
          continue;
        }

        const applied = await this.apply(operation, userId);

        await syncRepository.recordOperation({
          operationId: operation.operationId,
          userId,
          entity: assertSupportedEntity(operation.entity),
          entityId: operation.entityId,
          status: applied.status,
          resultVersion: applied.version,
        });

        results.push({
          operationId: operation.operationId,
          status: applied.status,
          entity: operation.entity,
          entityId: operation.entityId,
          version: applied.version,
          error: applied.error ?? null,
        });
      } catch (error) {
        const message = describeFailure(error);
        logger.warn({ err: error, operationId: operation.operationId }, 'sync operation failed');

        results.push({
          operationId: operation.operationId,
          status: 'rejected',
          entity: operation.entity,
          entityId: operation.entityId,
          version: null,
          error: message,
        });
      }
    }

    return { results, serverTime: new Date().toISOString() };
  }

  async pull(input: SyncPullRequest, userId: string, deviceId: string): Promise<SyncPullResponse> {
    const { changes, nextCursor, hasMore } = await syncRepository.changesSince({
      userId,
      cursor: input.cursor,
      limit: input.limit,
    });

    await syncRepository.saveCursor(userId, deviceId, nextCursor);

    return { changes, nextCursor, hasMore, serverTime: new Date().toISOString() };
  }

  async listConflicts(userId: string): Promise<SyncConflict[]> {
    const { db } = await getDatabase();

    const rows = await db
      .select()
      .from(syncConflicts)
      .where(and(eq(syncConflicts.userId, userId), eq(syncConflicts.status, 'pending')))
      .orderBy(syncConflicts.detectedAt);

    return rows.map((row) => ({
      id: row.id,
      entity: row.entity,
      entityId: row.entityId,
      workspaceId: row.workspaceId,
      baseVersion: row.baseVersion,
      serverVersion: row.serverVersion,
      serverRecord: row.serverRecord,
      clientRecord: row.clientRecord,
      conflictingFields: row.conflictingFields,
      status: 'pending',
      detectedAt: row.detectedAt.toISOString(),
      resolvedAt: null,
    }));
  }
}

export const syncService = new SyncService();
