import { exportFilename } from '@orbit-hub/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import { ApiError, apiRaw, apiRequest, configureApiClient } from '@/lib/api/client';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('exportFilename', () => {
  it('deja un nombre sin espacios ni acentos', () => {
    expect(
      exportFilename({ title: 'Películas para ver', fallbackId: 'x', extension: 'csv', date: '2026-10-02' }),
    ).toBe('orbit-hub-peliculas-para-ver-2026-10-02.csv');
  });

  it('quita los emojis y los simbolos, no los tira todos', () => {
    expect(
      exportFilename({ title: 'Café ☕ & cosas', fallbackId: 'x', extension: 'json', date: '2026-10-02' }),
    ).toBe('orbit-hub-cafe-cosas-2026-10-02.json');
  });

  it('cae al id cuando el titulo no deja nada', () => {
    expect(
      exportFilename({ title: '🎬🎬', fallbackId: 'a1b2c3d4', extension: 'csv', date: '2026-10-02' }),
    ).toBe('orbit-hub-a1b2c3d4-2026-10-02.csv');
  });

  it('corta el slug a 40 caracteres sin comerse el guion', () => {
    const slug = exportFilename({
      title: 'a'.repeat(80), fallbackId: 'x', extension: 'csv', date: '2026-10-02',
    });
    expect(slug).toBe(`orbit-hub-${'a'.repeat(40)}-2026-10-02.csv`);
  });

  it('produce el nombre de la cuenta sin titulo', () => {
    expect(
      exportFilename({ title: 'export', fallbackId: 'export', extension: 'json', date: '2026-10-02' }),
    ).toBe('orbit-hub-export-2026-10-02.json');
  });
});

/**
 * `configureApiClient` muta estado a nivel de módulo, así que **los tres tests
 * configuran su propio token**. Si uno depende del que dejó el anterior, el test
 * pasa por casualidad y no porque el código sea correcto.
 */
describe('apiRaw', () => {
  it('pone el token en las cabeceras sin enviar nada todavia', async () => {
    configureApiClient({ getAccessToken: async () => 'tok-123' });
    const pending = await apiRaw('/account/export', { query: { format: 'json' } });

    expect(pending.url).toContain('/account/export');
    expect(pending.url).toContain('format=json');
    expect(pending.headers.Authorization).toBe('Bearer tok-123');
  });

  it('no manda Authorization cuando la peticion es anonima', async () => {
    configureApiClient({ getAccessToken: async () => 'tok-123' });
    const pending = await apiRaw('/health', { anonymous: true });

    expect(pending.headers.Authorization).toBeUndefined();
  });

  it('permite al llamante cambiar el Accept', async () => {
    configureApiClient({ getAccessToken: async () => 'tok-123' });
    const pending = await apiRaw('/lists/l1/export', {
      headers: { Accept: 'text/csv' },
    });

    expect(pending.headers.Accept).toBe('text/csv');
  });

  it('send() reintenta una vez y con el token nuevo cuando la respuesta es 401', async () => {
    const authorizations: (string | null)[] = [];
    let currentToken = 'stale';

    globalThis.fetch = async (_url, init) => {
      authorizations.push(new Headers(init?.headers).get('Authorization'));

      if (authorizations.length === 1) {
        return new Response(JSON.stringify({ error: { code: 'unauthorized', message: 'nope' } }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response('id,name\n1,uno\n', {
        status: 200,
        headers: { 'Content-Type': 'text/csv' },
      });
    };

    configureApiClient({
      getAccessToken: async () => currentToken,
      onUnauthorized: async () => {
        // El refresh renueva el token guardado, que es justo lo que el reintento
        // tiene que leer. Si `send()` reusara las cabeceras compuestas antes del
        // refresh, volveria a mandar el token caducado y recibiria otro 401.
        currentToken = 'fresh';
        return true;
      },
    });

    const pending = await apiRaw('/lists/l1/export', { headers: { Accept: 'text/csv' } });
    const response = await pending.send();

    expect(response.status).toBe(200);
    // El cuerpo vuelve entero y sin parsear: son bytes del llamante.
    expect(await response.text()).toBe('id,name\n1,uno\n');
    expect(authorizations).toHaveLength(2);
    expect(authorizations).toEqual(['Bearer stale', 'Bearer fresh']);
  });
});

/**
 * El nucleo que comparten las dos rutas. Componer tambien puede fallar —
 * `getAccessToken` es estado inyectado, no una constante — y un fallo ahi no
 * puede salir como una excepcion suelta por el punto de entrada de la app: la
 * red se reintenta y un `unknown` de `toApiError` no.
 */
describe('el nucleo de la peticion', () => {
  it('reporta como red un token que no se puede leer, en las dos rutas', async () => {
    configureApiClient({
      getAccessToken: async () => {
        throw new Error('el almacen seguro no esta disponible');
      },
    });

    const fromJson = await apiRequest('/health').catch((caught) => caught);
    const fromRaw = await apiRaw('/account/export').catch((caught) => caught);

    for (const error of [fromJson, fromRaw]) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).kind).toBe('network');
      expect((error as ApiError).isRetryable).toBe(true);
    }
  });
});
