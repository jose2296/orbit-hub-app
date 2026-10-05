import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getTableColumns } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { bookmarks } from '../src/db/content-schema.js';

/**
 * Las columnas se preguntan con `getTableColumns`, y las cascadas no.
 *
 * `getTableColumns` devuelve las columnas de la tabla, y en el schema de drizzle
 * una clave foranea no es una propiedad de la columna: es una restriccion de la
 * tabla. Un `expect(columns.collectionId).toBeDefined()` pasa igual con
 * `.references()` y sin el, asi que las tres FK de abajo se vigilan leyendo el
 * `.sql` de la migracion, que es ademas lo que corre de verdad en cada
 * despliegue. Mismo criterio que `collections-table.test.ts`, y por el mismo
 * motivo.
 *
 * Cada FK se aisla partiendo el archivo por `--> statement-breakpoint`: un
 * `toContain` global dejaria pasar el caso de que solo dos de las tres cascadas
 * quedaran bien y la tercera, que es la que importa, no.
 *
 * La ruta se resuelve desde este archivo y no desde el cwd, igual que en
 * `helpers.ts`: si el archivo no estuviera donde se espera, `readFileSync` falla
 * con ENOENT y el test se cae, en vez de leer cualquier cosa y pasar de casualidad.
 */
const here = dirname(fileURLToPath(import.meta.url));
const migrationPath = resolve(here, '..', 'drizzle', '0022_bookmarks.sql');

/** Una sentencia del archivo, sin los `--> statement-breakpoint` de al lado. */
function statement(sql: string, needle: string): string | undefined {
  return sql
    .split('--> statement-breakpoint')
    .map((part) => part.trim())
    .find((part) => part.includes(needle));
}

describe('la tabla bookmarks', () => {
  it('guarda la URL sin tope, y el sitio y el error de extraccion acotados', () => {
    const columns = getTableColumns(bookmarks);
    // Una URL es una URL: no hay una longitud maxima honesta que no corte un
    // enlace largo con sus parametros de seguimiento, y cortarla produce una
    // fila que ya no abre lo que la persona guardo.
    expect('length' in columns.url ? columns.url.length : 'sin-tope').toBe('sin-tope');
    expect('length' in columns.siteName ? columns.siteName.length : null).toBe(120);
    expect('length' in columns.extractionError ? columns.extractionError.length : null).toBe(200);
  });

  it('arranca pending, con el documento vacio', () => {
    const columns = getTableColumns(bookmarks);
    expect(columns.document).toBeDefined();
    expect(columns.plainText).toBeDefined();
    expect(columns.extractionState).toBeDefined();
    // El enlace se guarda antes de que haya texto: el documento y el texto plano
    // arrancan vacios y el estado arranca `pending`, porque todavia no se ha
    // intentado extraer nada y decir "fallo" seria mentira.
    expect(columns.document.notNull).toBe(true);
    expect(columns.plainText.notNull).toBe(true);
    expect(columns.extractionState.notNull).toBe(true);
    expect(columns.extractionState.default).toBe('pending');
  });

  it('colga de workspace, carpeta y coleccion', () => {
    const columns = getTableColumns(bookmarks);
    expect(columns.workspaceId).toBeDefined();
    expect(columns.workspaceId.notNull).toBe(true);
    expect(columns.folderId).toBeDefined();
    expect(columns.folderId.notNull).toBe(false);
    // La coleccion es opcional y ademas se puede quedar en null: por eso su FK
    // dice `set null` y no `cascade`, que vigila la migracion de mas abajo.
    expect(columns.collectionId).toBeDefined();
    expect(columns.collectionId.notNull).toBe(false);
  });

  it('lleva las etiquetas y la posicion que el resto de las tablas llevan', () => {
    const columns = getTableColumns(bookmarks);
    expect('dataType' in columns.tags ? columns.tags.dataType : null).toBe('json');
    expect(columns.position).toBeDefined();
    expect(columns.version).toBeDefined();
    expect(columns.deletedAt).toBeDefined();
  });
});

describe('la migracion que crea bookmarks', () => {
  it('borra en cascada el workspace de un bookmark', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    const fk = statement(sql, 'bookmarks_workspace_id_workspaces_id_fk');
    expect(fk, 'la migracion no declara bookmarks_workspace_id_workspaces_id_fk').toBeDefined();
    expect(fk).toMatch(/ON DELETE cascade/);
  });

  it('borra en cascada la carpeta de un bookmark', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    const fk = statement(sql, 'bookmarks_folder_id_folders_id_fk');
    expect(fk, 'la migracion no declara bookmarks_folder_id_folders_id_fk').toBeDefined();
    expect(fk).toMatch(/ON DELETE cascade/);
  });

  it('deja vivos los bookmarks al borrar su coleccion, en vez de llevarlos por delante', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    const fk = statement(sql, 'bookmarks_collection_id_collections_id_fk');
    expect(fk, 'la migracion no declara bookmarks_collection_id_collections_id_fk').toBeDefined();
    // `set null` y no `cascade`, y es la regla de la spec escrita en el
    // esquema: borrar una coleccion deja sus bookmarks en el mundo con
    // `collection_id` en null, que es lo que "sin clasificar" significa. Con
    // `cascade` borrar una coleccion con 50 enlaces dentro se los lleva en
    // silencio y la persona pierde 50 enlaces sin que nadie le avise.
    expect(fk).toMatch(/ON DELETE set null/);
    expect(fk).not.toMatch(/ON DELETE cascade/);
  });

  it('crea los cuatro indices que el schema declara', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toMatch(/CREATE INDEX "bookmarks_workspace_updated_at_idx"/);
    expect(sql).toMatch(/CREATE INDEX "bookmarks_folder_idx"/);
    expect(sql).toMatch(/CREATE INDEX "bookmarks_collection_idx"/);
    expect(sql).toMatch(/CREATE INDEX "bookmarks_deleted_at_idx"/);
  });

  it('crea los dos indices de busqueda que drizzle-kit no sabe expresar', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toMatch(/CREATE INDEX bookmarks_tags_gin_idx/);
    expect(sql).toMatch(/CREATE INDEX bookmarks_plain_text_trgm_idx/);
    // pg_trgm ya se activo en 0012 con CREATE EXTENSION IF NOT EXISTS, asi que
    // repetirlo aqui seria una segunda fuente de verdad sobre esa decision. El
    // patron se ancla a principio de linea a proposito: el comentario de arriba
    // nombra la sentencia al explicar por que no se repite, y sin ancla el
    // `not` fallaria contra la prosa en vez de contra una sentencia.
    expect(sql).not.toMatch(/^CREATE EXTENSION/im);
  });
});