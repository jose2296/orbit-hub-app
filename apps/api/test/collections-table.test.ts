import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getTableColumns } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { collections } from '../src/db/content-schema.js';

/**
 * Las columnas se preguntan con `getTableColumns`, y las cascadas no.
 *
 * `getTableColumns` devuelve las columnas de la tabla, y en el schema de drizzle
 * una clave foranea no es una propiedad de la columna: es una restriccion de la
 * tabla. Por mas que se le pregunte, la API no la tiene, y un
 * `expect(columns.folderId).toBeDefined()` pasa igual con `.references()` y sin
 * el. Ese era el agujero: la cascada de `folder_id` es lo unico de esta tabla que,
 * si falta, deja colecciones colgadas de una carpeta sin quien las borre, y el
 * sintoma son filas huerfanas en produccion, no un test rojo.
 *
 * El unico lugar donde la cascada es un hecho comprobable es el SQL de la
 * migracion, que es ademas lo que corre de verdad en cada despliegue. Por eso la
 * vigila el bloque de abajo y no las columnas.
 *
 * La ruta se resuelve desde este archivo y no desde el cwd, igual que en
 * `helpers.ts`: si el archivo no estuviera donde se espera, `readFileSync` falla
 * con ENOENT y el test se cae, en vez de leer cualquier cosa y pasar de casualidad.
 */
const here = dirname(fileURLToPath(import.meta.url));
const migrationPath = resolve(here, '..', 'drizzle', '0021_collections.sql');

/** Una sentencia del archivo, sin los `--> statement-breakpoint` de al lado. */
function statement(sql: string, needle: string): string | undefined {
  return sql
    .split('--> statement-breakpoint')
    .map((part) => part.trim())
    .find((part) => part.includes(needle));
}

describe('la tabla collections', () => {
  it('declara el nombre como un varchar de 120', () => {
    const columns = getTableColumns(collections);
    expect(columns.name).toBeDefined();
    expect('length' in columns.name ? columns.name.length : null).toBe(120);
  });

  it('exige un workspace y deja la carpeta opcional', () => {
    const columns = getTableColumns(collections);
    expect(columns.workspaceId).toBeDefined();
    expect(columns.workspaceId.notNull).toBe(true);
    // Que la carpeta se pueda omitir es lo que hace `folder_id` nullable en la
    // migracion, y es lo unico que este test puede afirmar de ella. Que borre en
    // cascada lo vigila el bloque de abajo.
    expect(columns.folderId).toBeDefined();
    expect(columns.folderId.notNull).toBe(false);
    // El token de concurrencia y la lapida, que el motor de sync necesita para no
    // perder una escritura ni un delete.
    expect(columns.version).toBeDefined();
    expect(columns.deletedAt).toBeDefined();
  });
});

describe('la migracion que crea collections', () => {
  it('borra en cascada la carpeta de una coleccion', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    const fk = statement(sql, 'collections_folder_id_folders_id_fk');
    expect(fk, 'la migracion no declara collections_folder_id_folders_id_fk').toBeDefined();
    expect(fk).toMatch(/ON DELETE cascade/);
  });

  it('borra en cascada el workspace de una coleccion', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    const fk = statement(sql, 'collections_workspace_id_workspaces_id_fk');
    expect(fk, 'la migracion no declara collections_workspace_id_workspaces_id_fk').toBeDefined();
    expect(fk).toMatch(/ON DELETE cascade/);
  });

  it('crea los tres indices que el schema declara', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toMatch(/CREATE INDEX "collections_workspace_updated_at_idx"/);
    expect(sql).toMatch(/CREATE INDEX "collections_folder_idx"/);
    expect(sql).toMatch(/CREATE INDEX "collections_deleted_at_idx"/);
  });
});
