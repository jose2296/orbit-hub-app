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
    .map((part) =>
      // El bloque de los indices escritos a mano viene con su comentario pegado
      // a la sentencia y sin separador entre los dos, asi que sin esto
      // `statement` devuelve la prosa junto con el `CREATE INDEX`. Una asercion
      // sobre el operador tiene que leer la sentencia y no el comentario que
      // explica por que existe.
      part
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('--'))
        .join('\n')
        .trim(),
    )
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

  it('indexa las etiquetas con un GIN, que es lo que un array necesita', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    const index = statement(sql, 'bookmarks_tags_gin_idx');
    expect(index, 'la migracion no declara bookmarks_tags_gin_idx').toBeDefined();
    // El nombre del indice no es el indice. Estos dos los escribe una persona y
    // no el generador, y un btree sobre un jsonb no contesta "las etiquetas que
    // tocan esta palabra": por eso se afirma el operador, no solo el nombre.
    // Un `toMatch` global sobre el nombre pasaria con `USING btree` debajo.
    expect(index).toMatch(/USING gin \(tags jsonb_path_ops\)/);
  });

  it('indexa el texto del articulo con trigram, y un btree no contesta eso', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    const index = statement(sql, 'bookmarks_plain_text_trgm_idx');
    expect(index, 'la migracion no declara bookmarks_plain_text_trgm_idx').toBeDefined();
    // Este es el indice del que depende que buscar una palabra dentro de un
    // articulo guardado sea un index hit. Un btree sobre una columna de prosa no
    // la encuentra, y el fallo es silencioso: la busqueda sigue funcionando,
    // solo que recorriendo la tabla entera, y nada en ningun test se queja.
    expect(index).toMatch(/USING gin \(plain_text gin_trgm_ops\)/);
    expect(index).not.toMatch(/USING btree/);
  });

  it('no repite la sentencia que activa pg_trgm, que ya la activo 0012', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    // pg_trgm ya se activo en 0012 con CREATE EXTENSION IF NOT EXISTS, asi que
    // repetirla aqui seria una segunda fuente de verdad sobre esa decision.
    //
    // El ancla va con `\s*` y no solo `^`: una sentencia indentada dos espacios
    // sigue siendo una sentencia, y con el ancla estricta se colaba sin que
    // nadie lo notara. El `\s*` no hace perder nada del otro lado, porque el
    // comentario que explica por que no se repite tiene el texto en medio de
    // linea y no en principio de linea.
    expect(sql).not.toMatch(/^\s*CREATE EXTENSION/im);
  });
});