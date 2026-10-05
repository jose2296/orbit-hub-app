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

  it('una URL de 5000 caracteres o un data: URI no pasan', () => {
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
    expect(() => bookmarkSchema.parse({ ...base, url: `https://e.com/${'a'.repeat(5000)}` })).toThrow();
    expect(() => bookmarkSchema.parse({ ...base, url: 'data:text/plain,hola' })).toThrow();
  });
});
