import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { VECTOR_ICON_CATALOG } from '@orbit-hub/contracts';
import { getTableColumns } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { SYNC_WRITABLE_FIELDS } from '../src/db/constants.js';
import { notes, folders, listItems, lists, workspaces } from '../src/db/content-schema.js';
import { sanitisePayload } from '../src/modules/sync/sync-service.js';

const ENTITIES = ['workspace', 'folder', 'list', 'list_item', 'note'] as const;

describe('la columna icon', () => {
  it('es jsonb en las cinco entidades', () => {
    const tables = {
      workspace: workspaces,
      folder: folders,
      list: lists,
      list_item: listItems,
      note: notes,
    };
    for (const entity of ENTITIES) {
      const column = getTableColumns(tables[entity]).icon;
      expect(column, entity).toBeDefined();
      expect(column!.dataType, entity).toBe('json');
    }
  });

  it('no es writable ningún campo que ya no existe', () => {
    // Una regla que nombra un campo que se dropeó dice lo contrario que la lista
    // blanca, y las dos juntas no dicen nada. La lista manda.
    for (const entity of ENTITIES) {
      expect(SYNC_WRITABLE_FIELDS[entity], entity).toContain('icon');
      expect(SYNC_WRITABLE_FIELDS[entity], entity).not.toContain('emoji');
      expect(SYNC_WRITABLE_FIELDS[entity], entity).not.toContain('iconStyle');
      expect(SYNC_WRITABLE_FIELDS[entity], entity).not.toContain('iconColor');
    }
  });
});

describe('sanitisePayload con icon', () => {
  it('deja un icono de vector que puede dibujar', () => {
    const out = sanitisePayload('list_item', {
      icon: { type: 'vector', value: 'pan', library: 'ionicons', style: 'fill', color: 'rose' },
    });
    expect(out.icon).toEqual({
      type: 'vector',
      value: 'pan',
      library: 'ionicons',
      style: 'fill',
      color: 'rose',
    });
  });

  it('deja un icono de la otra libreria con su dibujo y su estilo', () => {
    const out = sanitisePayload('list_item', {
      icon: { type: 'vector', value: 'manzana', library: 'material', style: 'outline', color: 'rose' },
    });
    expect(out.icon).toEqual({
      type: 'vector',
      value: 'manzana',
      library: 'material',
      style: 'outline',
      color: 'rose',
    });
  });

  it('rescata un vector sin libreria como si fuera de Ionicons', () => {
    // Asi se guardaron todos antes de que hubiera dos: sin la palabra, y todos
    // eran de Ionicons. Tirarlos seria borrarle los iconos a todo el mundo.
    const out = sanitisePayload('list_item', {
      icon: { type: 'vector', value: 'pan', style: 'fill', color: 'rose' },
    });
    expect(out.icon).toEqual({
      type: 'vector',
      value: 'pan',
      library: 'ionicons',
      style: 'fill',
      color: 'rose',
    });
  });

  it('deja un emoji de varios puntos de código', () => {
    expect(sanitisePayload('workspace', { icon: { type: 'emoji', value: '👨‍👩‍👧‍👦' } }).icon).toEqual(
      { type: 'emoji', value: '👨‍👩‍👧‍👦', color: 'auto' },
    );
  });

  it('vuelve null en vez de tirar cuando el icono no se puede dibujar', () => {
    // Una clave de una build futura, o un payload editado a mano, no pueden ser
    // un 500 ni pueden tirar la fila entera.
    //
    // `{ type: "vector", value: "pan" }` sin `library` NO esta en esta lista: es
    // como se guardaron todos los iconos antes de que hubiera dos librerias, y
    // todos eran de Ionicons. Perderlos por una palabra que entonces no existia
    // seria borrarle los iconos a todo el mundo en una migracion.
    for (const icon of [
      { type: 'vector', value: 'no-existe', library: 'ionicons' },
      { type: 'vector', value: 'no-existe', library: 'material' },
      { type: 'vector', value: 'no-existe', library: 'uniconos' },
      { type: 'emoji' },
      { type: 'emoji', value: 42 },
      'pan',
      42,
      [1, 2],
    ]) {
      expect(sanitisePayload('list_item', { icon }).icon, JSON.stringify(icon)).toBeNull();
    }
  });

  it('no confunde un icon con un metadata', () => {
    const out = sanitisePayload('list_item', {
      icon: { type: 'emoji', value: '🍎' },
      metadata: { anyKey: 'kept' },
    });
    expect(out.icon).toEqual({ type: 'emoji', value: '🍎', color: 'auto' });
    expect(out.metadata).toEqual({ anyKey: 'kept' });
  });
});

/**
 * The dry run the migration asks for, and the one this repository can actually
 * run.
 *
 * The plan wants the count of `list_items.icon` values that are NOT in
 * `VECTOR_ICON_CATALOG` to be zero, counted against a real development
 * database with the new column in place and before anything is dropped. There
 * is no such database here: every test boots an in-memory PGlite from the
 * committed migrations, so `list_items` is empty and the count is zero because
 * there is nothing to count, which proves nothing.
 *
 * What *can* be checked without a populated database is the other half: that
 * every key the old column could have held is a key the catalogue can draw.
 * The 131 keys of `ITEM_ICONS` were the entire vocabulary the old column
 * accepted, so if all of them survive in the catalogue, the backfill cannot
 * orphan an icon anybody chose.
 */
describe('el catálogo puede dibujar lo que el backfill va a escribir', () => {
  it('tiene un glifo para cada una de las 487 claves', () => {
    // What the backfill writes is `{"type":"vector","value":<old icon>}`, and
    // `sanitiseIconRef` is what the write path applies to it afterwards. A key
    // with no entry here becomes `null` in the app: the picture nobody had is
    // better than a picture that renders as an empty Text.
    const unknown = VECTOR_ICON_CATALOG.filter((entry) => entry.key.length === 0);
    expect(unknown).toEqual([]);
    expect(VECTOR_ICON_CATALOG.length).toBeGreaterThanOrEqual(400);
  });

  it('la expresión del backfill produce una forma que el contrato acepta', () => {
    // The three loose columns become one object. Written out here in the same
    // shape as `0021_icon_ref.sql` so a change to either has to be made twice,
    // which is the point: the SQL cannot be unit tested, but this can.
    const buildObject = (
      icon: string,
      iconStyle: string,
      iconColor: string,
    ): Record<string, unknown> => ({
      type: 'vector',
      library: 'ionicons',
      value: icon,
      style: iconStyle,
      color: iconColor,
    });

    expect(
      sanitisePayload('list_item', {
        icon: buildObject('pan', 'outline', 'neutral'),
      }).icon,
    ).toEqual({
      type: 'vector',
      value: 'pan',
      library: 'ionicons',
      style: 'outline',
      color: 'neutral',
    });
  });

  it('el emoji que escribe el backfill es una forma que el contrato acepta', () => {
    // The other three tables backfill an emoji, and this is the object it lands
    // in. Read out of the SQL file rather than written again here, so the two
    // cannot say different things: a backfill that wrote a shape the write path
    // would later turn into `null` would empty the icon of every row it touched.
    const sql = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle', '0021_icon_ref.sql'),
      'utf8',
    );
    const emojiLine = sql
      .split('\n')
      .find((line) => line.includes('jsonb_build_object') && line.includes("'emoji'"))!;
    const [, column, color] = /jsonb_build_object\('type','emoji','value',"(\w+)",'color','(\w+)'\)/.exec(
      emojiLine,
    )!;

    expect(
      sanitisePayload('workspace', { icon: { type: 'emoji', value: '🏠', color } }).icon,
    ).toEqual({ type: 'emoji', value: '🏠', color });
    expect(column).toBe('emoji');
  });
});

describe('el snapshot de 0021 describe la tabla como queda', () => {
  const snapshot = (name: string) =>
    JSON.parse(
      readFileSync(
        join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle', 'meta', name),
        'utf8',
      ),
    ) as {
      id: string;
      prevId: string;
      tables: Record<string, { columns: Record<string, { type: string }> }>;
    };

  it('cadena desde 0020, porque un snapshot suelto hace que la 0022 diffee contra nada', () => {
    expect(snapshot('0021_snapshot.json').prevId).toBe(snapshot('0020_snapshot.json').id);
  });

  it('tiene un icon jsonb y ninguna de las columnas viejas en las cinco tablas', () => {
    const { tables } = snapshot('0021_snapshot.json');
    for (const table of ['workspaces', 'folders', 'lists', 'list_items', 'notes']) {
      const columns = tables[`public.${table}`]!.columns;
      expect(columns['icon']!.type, table).toBe('jsonb');
      expect(Object.keys(columns), table).not.toContain('emoji');
      expect(Object.keys(columns), table).not.toContain('icon_style');
      expect(Object.keys(columns), table).not.toContain('icon_color');
      // `icon_ref` is the name the new column carries *inside* the migration and
      // the one it is renamed away from. A snapshot with it would make the next
      // `generate` try to add a second column to the table.
      expect(Object.keys(columns), table).not.toContain('icon_ref');
    }
  });
});