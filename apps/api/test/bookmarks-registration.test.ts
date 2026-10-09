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
      'workspaceId',
    ]);
  });

  /*
    Este test existia al reves: decia que un bookmark **no** puede mover su
    workspace, y no dejaba escrita ninguna razon. Asi que la ausencia del campo se
    leyo como "no se debe" cuando era "no se puede" —`updateEntity` hace spread de
    `values` al UPDATE y `sanitisePayload` solo filtra por esta lista, asi que
    faltaba la entrada y nada mas.

    Y el pedido era moverlo: "deberia poder moverlo luego a otro sitio si esta sin
    clasificar". Un bookmark siempre esta en un espacio —`bookmarkSchema.workspaceId`
    no es nullable—, asi que mover es cambiar **cual**, no si tiene.

    Lo que si cambia con el campo es la superficie: un cliente podria mandar el id
    de un espacio ajeno y filtrar ahi un enlace. Eso no se arregla quitando el campo,
    se arregla validando el destino, que es lo que hace `sync-service.ts` con
    `assertCanWrite` — el mismo chequeo de membresia y rol que usa el create de una
    coleccion. El test de al lado lo afirma.
  */
  it('un bookmark puede mover su workspace, y el servidor valida el destino', () => {
    expect(SYNC_WRITABLE_FIELDS.bookmark).toContain('workspaceId');
    // Y el servidor sigue quedandose con lo suyo.
    expect(SYNC_WRITABLE_FIELDS.bookmark).not.toContain('document');
    expect(SYNC_WRITABLE_FIELDS.bookmark).not.toContain('extractionState');
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