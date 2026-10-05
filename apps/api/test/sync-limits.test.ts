import { listOrderModeSchema } from '@orbit-hub/contracts';
import { getTableColumns } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { LIST_ORDER_MODES } from '../src/db/constants.js';
import { notes, folders, listItems, lists, workspaces } from '../src/db/content-schema.js';
import { describeFailure, sanitisePayload } from '../src/modules/sync/sync-service.js';
import { HttpError } from '../src/lib/http-error.js';
import type { SYNC_ENTITIES } from '../src/db/constants.js';
import type { ListOrderModeName } from '../src/db/constants.js';

type SyncEntity = (typeof SYNC_ENTITIES)[number];

/**
 * The sanitiser exists to stop a device from breaking the database, so it has to
 * cut at the width the column actually has. When it cut at a different number
 * the write reached Postgres and came back as a 500: not a rejected operation
 * with a message, a server error, on an ordinary input.
 */

const uuid = '11111111-1111-4111-8111-111111111111';

describe('sanitisePayload', () => {
  it('corta el nombre de un workspace a lo que su columna admite', () => {
    // workspaces.name is varchar(80). The sanitiser used to allow 120.
    const out = sanitisePayload('workspace', { name: 'a'.repeat(120) });

    expect(out.name).toHaveLength(80);
  });

  it('corta un emoji al ancho de su columna, no al de un nombre', () => {
    // workspaces.emoji, folders.emoji and lists.emoji are all varchar(16).
    // The sanitiser used to allow 500 for anything that was not `name`.
    for (const entity of ['workspace', 'folder', 'list'] as const) {
      const out = sanitisePayload(entity, { emoji: 'a'.repeat(40) });

      expect(out.emoji, `${entity}.emoji`).toHaveLength(16);
    }
  });

  it('deja intacto un emoji corto, porque 16 es un límite y no un objetivo', () => {
    const out = sanitisePayload('workspace', { emoji: '🏠' });

    expect(out.emoji).toBe('🏠');
  });

  it('sigue admitiendo un nombre de 80 caracteres entero', () => {
    const name = 'a'.repeat(80);
    const out = sanitisePayload('workspace', { name });

    expect(out.name).toBe(name);
  });

  it('no confunde el nombre de una carpeta con el de un workspace', () => {
    // folders.name is varchar(120), workspaces.name is varchar(80): the same
    // field name, two different columns, which is why this could not be keyed
    // on the field name alone.
    const long = 'a'.repeat(100);

    expect(sanitisePayload('folder', { name: long }).name).toHaveLength(100);
    expect(sanitisePayload('workspace', { name: long }).name).toHaveLength(80);
  });

  it('deja pasar un null, porque null es una decisión y no una ausencia', () => {
    const out = sanitisePayload('workspace', { name: null, emoji: null });

    expect(out.name).toBeNull();
    expect(out.emoji).toBeNull();
  });

  it('sigue sin tocar un título de item, que es más largo a propósito', () => {
    const out = sanitisePayload('list_item', { title: 'a'.repeat(300) });

    expect(out.title).toHaveLength(300);
  });

  it('sigue sin tocar un id, que no es un texto libre', () => {
    const out = sanitisePayload('list', { folderId: uuid });

    expect(out.folderId).toBe(uuid);
  });

  describe('los modos de orden', () => {
    it('la API conoce todos los modos que el contrato declara', () => {
      // El enum estaba escrito dos veces y solo una se actualizó al añadir los
      // dos modos por estreno. El sanitizador cae a `manual` para lo que no
      // conoce, así que elegir "por estreno" se pintaba, sincronizaba como
      // `applied` y volvía a manual en el siguiente pull, en cada dispositivo.
      expect([...LIST_ORDER_MODES].sort()).toEqual([...listOrderModeSchema.options].sort());
    });

    it('un modo de estreno llega al servidor como Montana', () => {
      for (const mode of ['released_asc', 'released_desc'] as const) {
        expect(sanitisePayload('list', { orderMode: mode }).orderMode, mode).toBe(mode);
      }
    });

    it('un modo que nadie declara sigue cayendo a manual, porque es legible', () => {
      // La red de seguridad se queda: un build más nuevo puede mandar un modo
      // que este servidor no conoce, y manual es el orden en que ya están.
      expect(sanitisePayload('list', { orderMode: 'por_el_color' }).orderMode).toBe('manual');
    });

    it('manual sigue siendo manual', () => {
      expect(sanitisePayload('list', { orderMode: 'manual' }).orderMode).toBe('manual');
    });

    it('el tipo de la lista acepta lo que el contrato declara, sin castear', () => {
      // El narrow del `.includes` era el motivo de que los modos se copiaran a
      // mano: un array `as const` propio da `string` en el `includes` y obliga a
      // castear, y castear es lo que deja que la lista se quede atrás.
      const mode: ListOrderModeName = 'released_desc';

      expect(sanitisePayload('list', { orderMode: mode }).orderMode).toBe('released_desc');
    });
  });

  describe('lo que se le dice al dispositivo cuando algo falla', () => {
    it('nombra un valor demasiado largo en vez de decir "the operation failed"', () => {
      // Postgres 22001. Esto pasaba con un nombre de workspace de 81 caracteres
      // o un emoji de 17, que son entrada corriente: el sanitize los dejaba
      // pasar, la columna los rechazaba, y el movil recibía un mensaje que no
      // dice nada sobre un error que sí tiene nombre.
      const postgres = Object.assign(new Error('value too long for type character varying(80)'), {
        code: '22001',
      });

      expect(describeFailure(postgres)).toMatch(/longer/i);
      expect(describeFailure(postgres)).not.toBe('The operation failed');
    });

    it('nombra una clave que no resuelve', () => {
      const postgres = Object.assign(new Error('insert or update violates foreign key'), {
        code: '23503',
      });

      expect(describeFailure(postgres)).toMatch(/does not exist/i);
    });

    it('respeta lo que dice un HttpError, que ya está escrito para una persona', () => {
      expect(describeFailure(HttpError.validation('"title" is not valid'))).toBe(
        '"title" is not valid',
      );
    });

    it('no inventa un motivo para un fallo que no conoce', () => {
      // Un mensaje inventado es peor que uno honesto: manda a buscar una causa
      // que no está donde dice.
      expect(describeFailure(new Error('boom'))).toBe('The operation failed');
      expect(describeFailure({ code: '99999', message: 'algo' })).toBe('The operation failed');
      expect(describeFailure(null)).toBe('The operation failed');
    });
  });

  describe('los límites son los de la columna', () => {
    /**
     * The reason this file exists as well as the three assertions above: a table
     * of numbers that agrees with itself is worthless. These read the actual
     * `varchar` widths, so a migration that widens or narrows a column fails
     * here instead of failing in production as a 500.
     */
    const columns: ReadonlyArray<readonly [PgTable, SyncEntity]> = [
      [workspaces, 'workspace'],
      [folders, 'folder'],
      [lists, 'list'],
      [listItems, 'list_item'],
      [notes, 'note'],
    ];

    const FREE_TEXT = ['name', 'title', 'description', 'emoji', 'annotation'];

    for (const [table, entity] of columns) {
      for (const field of FREE_TEXT) {
        it(`${entity}.${field} se corta al ancho real de su columna`, () => {
          const column = getTableColumns(table)[field];
          if (!column) return;

          const width = 'length' in column ? column.length : undefined;
          if (typeof width !== 'number') return;

          // A value well past any plausible limit: if the sanitiser lets this
          // through untouched, the write reaches Postgres and 500s.
          const out = sanitisePayload(entity, { [field]: 'a'.repeat(width + 50) });

          expect(out[field], `${entity}.${field} column is varchar(${width})`).toHaveLength(width);
        });
      }
    }
  });
});
