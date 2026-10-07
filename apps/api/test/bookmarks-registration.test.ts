import { describe, expect, it } from 'vitest';

import { SYNC_ENTITIES, SYNC_WRITABLE_FIELDS } from '../src/db/constants.js';
import { sanitisePayload } from '../src/modules/sync/sync-service.js';

/**
 * El registro de las entidades nuevas en el motor de sync, sin base de datos.
 *
 * Seis de los doce lugares fallan en silencio: sin la entidad en
 * `SYNC_WRITABLE_FIELDS` el payload se descarta y el push responde `applied` con
 * la version sumada, que parece un guardado y no escribio nada. Este archivo
 * mira las constantes y el sanitizador, que es donde ese fallo es mudo; los
 * `switch` que faltan los encuentra el typecheck, porque `SYNC_WRITABLE_FIELDS`
 * esta tipado como `Record<SyncEntityName, ...>`.
 */
describe('las entidades nuevas estan registradas donde tienen que estar', () => {
  it('las dos estan en SYNC_ENTITIES y en los campos escribibles', () => {
    expect(SYNC_ENTITIES).toContain('collection');
    expect(SYNC_ENTITIES).toContain('bookmark');
    expect(SYNC_WRITABLE_FIELDS.collection).toBeDefined();
    expect(SYNC_WRITABLE_FIELDS.bookmark).toBeDefined();
  });

  it('el servidor se queda con el documento: no es un campo escribible', () => {
    expect(SYNC_WRITABLE_FIELDS.bookmark).not.toContain('document');
    expect(SYNC_WRITABLE_FIELDS.bookmark).not.toContain('plainText');
    expect(SYNC_WRITABLE_FIELDS.bookmark).not.toContain('extractionState');
    expect(SYNC_WRITABLE_FIELDS.bookmark).not.toContain('imageUrl');
  });

  it('el cliente escribe la URL, el titulo, el destino, las etiquetas y la posicion', () => {
    expect([...SYNC_WRITABLE_FIELDS.bookmark].sort()).toEqual([
      'collectionId',
      'folderId',
      'position',
      'tags',
      'title',
      'url',
    ]);
  });

  it('un bookmark nuevo no puede mover su workspace', () => {
    expect(SYNC_WRITABLE_FIELDS.bookmark).not.toContain('workspaceId');
  });

  it('sanitisePayload pasa la URL limpia y deja la coleccion como texto o null', () => {
    const out = sanitisePayload('bookmark', {
      url: '  https://example.com/a  ',
      collectionId: 'abc',
      folderId: null,
    });
    expect(out.url).toBe('https://example.com/a');
    expect(out.collectionId).toBe('abc');
    expect(out.folderId).toBeNull();
  });
});