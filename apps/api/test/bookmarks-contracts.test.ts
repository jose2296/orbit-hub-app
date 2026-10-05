import {
  bookmarkExtractionStateSchema,
  bookmarkSchema,
  collectionSchema,
} from '@orbit-hub/contracts';
import { describe, expect, it } from 'vitest';

/**
 * `role` y `shared` van a proposito en cada objeto, y no por relleno.
 *
 * `collectionSchema` y `bookmarkSchema` extienden `nodeAccessSchema`, cuyo
 * `role: membershipRoleSchema` no tiene `.default()`: es obligatorio, como en
 * carpetas, listas, items y notas. Sin el, los tres primeros `it` no pueden
 * pasar, y el quinto pasaria por el motivo equivocado --`toThrow()` se come
 * tambien el error de `role` y nunca llegaria a mirar la URL--, que es la razon
 * por la que el quinto comprobaria que el esquema existe y no que filtra.
 */
describe('los contratos de bookmarks', () => {
  it('un bookmark acepta una URL y arranca pending', () => {
    const parsed = bookmarkSchema.parse({
      id: crypto.randomUUID(),
      version: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      deletedAt: null,
      workspaceId: crypto.randomUUID(),
      folderId: null,
      collectionId: null,
      url: 'https://example.com/articulo',
      position: 0,
      role: 'owner',
      shared: false,
    });
    expect(parsed.extractionState).toBe('pending');
    expect(parsed.title).toBe('');
    expect(parsed.document).toBe('');
    expect(parsed.tags).toEqual([]);
  });

  it('sin coleccion es una forma valida, no un error', () => {
    const parsed = bookmarkSchema.parse({
      id: crypto.randomUUID(),
      version: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      deletedAt: null,
      workspaceId: crypto.randomUUID(),
      folderId: null,
      collectionId: null,
      url: 'https://example.com',
      position: 0,
      role: 'owner',
      shared: false,
    });
    expect(parsed.collectionId).toBeNull();
  });

  it('los cuatro estados de extraccion son los de la spec', () => {
    for (const state of ['pending', 'ready', 'metadata_only', 'failed']) {
      expect(bookmarkExtractionStateSchema.parse(state)).toBe(state);
    }
  });

  it('una coleccion exige nombre y acepta carpeta vacia', () => {
    const parsed = collectionSchema.parse({
      id: crypto.randomUUID(),
      version: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      deletedAt: null,
      workspaceId: crypto.randomUUID(),
      folderId: null,
      name: 'Rust',
      position: 0,
      role: 'owner',
      shared: false,
    });
    expect(parsed.bookmarkCount).toBe(0);
  });

  it('una URL de 5000 caracteres o un data: URI no pasan, y pasan solo por la URL', () => {
    const base = {
      id: crypto.randomUUID(),
      version: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      deletedAt: null,
      workspaceId: crypto.randomUUID(),
      folderId: null,
      collectionId: null,
      position: 0,
      role: 'owner',
      shared: false,
    };

    /**
     * La contraprueba, y es la parte que le da dientes al test.
     *
     * Este `base` tiene que ser un bookmark valido de punta a punta: si la URL es
     * buena, el `parse` devuelve el objeto. Sin esta linea, `toThrow()` no
     * distingue "el filtro de la URL tiro" de "tiro cualquier otra
     * validacion" --una de `role`, un `base` mal escrito--, y el test pasa
     * igual. Con ella, `base` roto hace fallar el test en vez de hacerlo pasar.
     */
    const buena = bookmarkSchema.safeParse({ ...base, url: 'https://example.com/articulo' });
    expect(buena.success).toBe(true);
    expect(buena.data?.url).toBe('https://example.com/articulo');

    /**
     * Y el filtro se comprueba por donde falla, no por el hecho de que falle:
     * un solo `issue`, y su `path` es `url`.
     *
     * `toHaveLength(1)` es lo que dice "solo por la URL" --si `role` o cualquier
     * otro campo estuvieran mal, serian dos `issue` y este test lo canta--, y el
     * `path` es lo que dice que el fallo es del campo de la URL y no de otro.
     * El `code` distingue cual de las dos mitades del filtro esta mordiendo.
     */
    const larga = bookmarkSchema.safeParse({ ...base, url: `https://e.com/${'a'.repeat(5000)}` });
    expect(larga.success).toBe(false);
    expect(larga.error?.issues).toHaveLength(1);
    expect(larga.error?.issues[0]?.path).toEqual(['url']);
    expect(larga.error?.issues[0]?.code).toBe('too_big');

    // El `data:` es media defensa del SSRF de la fase 2, asi que no basta con que
    // algo tire: el fallo tiene que ser el `refine` de la URL y su mensaje tiene
    // que hablar de la URL. Un `code: 'custom'` en `path: ['url']` es el `refine`,
    // y si manana el filtro de la URL se mueve este test hay que volver a mirarlo.
    const dataUri = bookmarkSchema.safeParse({ ...base, url: 'data:text/plain,hola' });
    expect(dataUri.success).toBe(false);
    expect(dataUri.error?.issues).toHaveLength(1);
    expect(dataUri.error?.issues[0]?.path).toEqual(['url']);
    expect(dataUri.error?.issues[0]?.code).toBe('custom');
    expect(dataUri.error?.issues[0]?.message).toMatch(/url/i);
  });
});
