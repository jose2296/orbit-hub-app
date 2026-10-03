import type {
  ShareNodeType,
  SyncConflict,
  SyncOperation,
  SyncOperationResult,
  SyncPullRequest,
  SyncPullResponse,
  SyncPushResponse,
} from '@orbit-hub/contracts';
import {
  MAX_BOARD_STATES,
  NOTE_DOCUMENT_MAX_BYTES,
  noteDocumentSchema,
  noteDocumentToPlainText,
  sanitiseTagColors,
  syncOperationSchema,
} from '@orbit-hub/contracts';
import { and, eq } from 'drizzle-orm';

import { getDatabase } from '../../db/client.js';
import {
  ITEM_ICON_COLORS,
  isItemIcon,
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
  ListOrderModeName,
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
function sanitisePayload(
  entity: SyncEntityName,
  payload: Record<string, unknown> | null,
): Record<string, unknown> {
  const allowed = new Set(SYNC_WRITABLE_FIELDS[entity]);
  const clean: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(payload ?? {})) {
    if (!allowed.has(key) || value === undefined) continue;

    if (key === 'name' || key === 'description' || key === 'emoji') {
      clean[key] = value === null ? null : String(value).slice(0, key === 'name' ? 120 : 500);
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
      clean[key] = String(value).slice(0, entity === 'list_item' ? 300 : 120);
      continue;
    }

    if (key === 'position') {
      clean[key] = Math.max(0, Math.trunc(Number(value) || 0));
      continue;
    }

    if (key === 'folderId') {
      clean[key] = value === null ? null : String(value);
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
      // the items are already in: a list is never left unreadable.
      clean[key] = LIST_ORDER_MODES.includes(value as ListOrderModeName) ? value : 'manual';
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
      const color = String(value).trim();
      const esNombre = (WORKSPACE_COLORS as readonly string[]).includes(color);
      const esPropio = /^[#][0-9A-F]{6}$/.test(color.toUpperCase());
      clean[key] = esNombre ? color : esPropio ? color.toUpperCase() : 'slate';
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
      const segundo = String(value).trim();
      const esNombre = (WORKSPACE_COLORS as readonly string[]).includes(segundo);
      const esPropio = /^#[0-9A-F]{6}$/.test(segundo.toUpperCase());
      clean[key] = esNombre ? segundo : esPropio ? segundo.toUpperCase() : null;
      continue;
    }

    if (key === 'icon') {
      // A key out of the icons the app offers, never free text: the same shape
      // on every device and something the app can draw.
      const icon = String(value);
      clean[key] = isItemIcon(icon) ? icon : null;
      continue;
    }

    if (key === 'iconStyle') {
      // Outline or filled. Anything else is the outline, which is what a row
      // with no style has always been drawn as.
      clean[key] = value === 'fill' ? 'fill' : 'outline';
      continue;
    }

    if (key === 'iconColor') {
      // One of the colours the app offers, and not a colour value: a row with a
      // colour nobody can draw is a row with no colour.
      const color = String(value);
      clean[key] = (ITEM_ICON_COLORS as readonly string[]).includes(color) ? color : 'neutral';
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
      clean[key] = value === null ? null : String(value).slice(0, 36);
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
   * The space a note belongs to, which is its own `workspace_id`.
   *
   * A list item has to look its list up because it does not carry one. A note
   * does, so this reads the row it already has instead of a second query.
   */
  private workspaceOfNote(note: StoredEntity): string | null {
    return (note['workspaceId'] as string | null) ?? null;
  }

  private async workspaceOfListItem(item: StoredEntity, userId: string): Promise<string | null> {
    const listId = item['listId'] as string | null;
    if (!listId) return null;

    const list = await syncRepository.findEntity('list', listId);
    if (!list) {
      throw HttpError.notFound('List not found');
    }
    void userId;
    return (list['workspaceId'] as string | null) ?? null;
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
            emoji: (payload['emoji'] as string) ?? null,
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
        await this.assertCanDelete(this.workspaceOfNote(existing), userId);
      }

      const row = await syncRepository.updateEntity(entity, operation.entityId, {}, {
        tombstone: true,
      });
      return { status: 'applied', version: row.version };
    }

    // update
    if (entity === 'workspace') {
      await this.assertCanWrite(operation.entityId, userId);
    } else if (entity === 'folder' || entity === 'list') {
      await this.assertCanWrite((existing['workspaceId'] as string | null) ?? null, userId, {
        nodeType: entity,
        nodeId: operation.entityId,
      });
    } else if (entity === 'list_item') {
      await this.assertCanWrite(await this.workspaceOfListItem(existing, userId), userId, {
        nodeType: 'list_item',
        nodeId: operation.entityId,
      });
    } else if (entity === 'note') {
      await this.assertCanWrite(this.workspaceOfNote(existing), userId, {
        nodeType: 'note',
        nodeId: operation.entityId,
      });
    }

    if (operation.baseVersion === existing.version) {
      const row = await syncRepository.updateEntity(
        entity,
        operation.entityId,
        noteFieldsForWrite(entity, sanitisePayload(entity, operation.payload)),
      );
      return { status: 'applied', version: row.version };
    }

    const { values, conflictingFields } = merge(operation, existing);

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
        const message = error instanceof HttpError ? error.message : 'The operation failed';
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
