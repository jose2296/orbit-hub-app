import { exportFilename } from '@orbit-hub/contracts';
import { Platform } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError, apiRaw, apiRequest, configureApiClient } from '@/lib/api/client';
import { exportErrorKey } from '@/lib/export/errors';
import { readSavedEnvelope, saveExport } from '@/lib/export/save';
import { deliverExport, type ExportResult } from '@/hooks/use-export';

const originalFetch = globalThis.fetch;

/**
 * Los dos modulos nativos de la entrega, suplantados.
 *
 * `vi.mock` se ejecuta antes que todo lo demas del fichero —por eso esto esta
 * arriba del todo y no dentro del `describe` que lo usa—, asi que el
 * `await import(...)` perezoso de `save.ts` recibe estos objetos en cualquier
 * plataforma. Es lo que permite probar en un movil **lo que hace el codigo con un
 * fallo**, que es lo unico de la rama nativa que depende de nosotros: que un 403
 * que llega como `Unable to download` salga con el `kind` que la hoja sabe pintar.
 */
const nativo = vi.hoisted(() => ({
  descargar: vi.fn(),
  compartir: vi.fn(),
  texto: vi.fn(),
}));

vi.mock('expo-file-system', () => ({
  Paths: { cache: 'file:///cache' },
  File: class {
    uri: string;
    exists = true;
    // `new File(Paths.cache, nombre)`: el nombre es la ultima parte.
    constructor(...partes: unknown[]) {
      this.uri = `file:///cache/${String(partes.at(-1))}`;
    }
    static downloadFileAsync = nativo.descargar;
    text = nativo.texto;
  },
}));

vi.mock('expo-sharing', () => ({ shareAsync: nativo.compartir }));

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

/**
 * Lo que se le dice a la persona cuando la exportacion no sale.
 *
 * `kind: 'network'` y `kind: 'timeout'` dan la misma clave a proposito: para quien
 * esta mirando, "se corto" y "tardo demasiado" son el mismo problema con la misma
 * solucion, que es volver a pulsar.
 */
describe('exportErrorKey', () => {
  it('dice que se puede reintentar cuando se corta la red', () => {
    expect(exportErrorKey(new ApiError({ kind: 'network', message: 'x' })))
      .toBe('export.error.network');
  });

  it('trata un timeout como reintentable', () => {
    expect(exportErrorKey(new ApiError({ kind: 'timeout', message: 'x' })))
      .toBe('export.error.network');
  });

  it('avisa cuando el servidor dice que no hay permiso', () => {
    expect(exportErrorKey(new ApiError({ kind: 'forbidden', message: 'x', status: 403 })))
      .toBe('export.error.forbidden');
  });

  it('avisa cuando no encuentra la lista', () => {
    expect(exportErrorKey(new ApiError({ kind: 'not_found', message: 'x', status: 404 })))
      .toBe('export.error.notFound');
  });

  it('no inventa una clave para un error que no es de la API', () => {
    expect(exportErrorKey(new Error('boom'))).toBeNull();
  });
});

/**
 * La entrega en un movil, con los dos modulos nativos suplantados.
 *
 * El `Platform.OS` del stub de `react-native` es una propiedad mutable —se pone y
 * se devuelve—, asi que la rama nativa se puede ejecutar con los dos modulos
 * suplantados (arriba del todo, porque `vi.mock` corre antes que todo lo demas).
 *
 * Ninguna de las dos ramas se puede probar de verdad aqui —no hay dispositivo ni
 * simulador en esta maquina—, asi que esto **no** dice que la descarga funcione en
 * un telefono: dice que un rechazo del modulo nativo sale con el `kind` que la
 * hoja sabe pintar y con el reintento que la persona puede usar. Que el `kind` sea
 * el correcto es justamente lo que no puede comprobar nadie mas.
 *
 * Dos cosas lo hacen posible sin tocar la configuracion del runner: el `OS` del
 * stub de `react-native` es una propiedad mutable —se pone y se devuelve— y
 * `vi.mock` intercepta el `await import(...)` perezoso de `save.ts`.
 */
describe('entregar la exportacion en un movil', () => {
  const pending = {
    url: 'https://api.test/lists/l1/export',
    headers: { Authorization: 'Bearer tok' },
    send: async () => new Response('id,titulo\n1,uno\n', { status: 200 }),
  };

  beforeEach(() => {
    (Platform as { OS: string }).OS = 'ios';
    nativo.descargar.mockReset().mockResolvedValue(undefined);
    nativo.compartir.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    (Platform as { OS: string }).OS = 'web';
  });

  it('escribe el fichero con el nombre que tiene y lo deja en el cache', async () => {
    const outcome = await saveExport({
      pending,
      filename: 'orbit-hub-peliculas-2026-10-02.json',
    });

    expect(outcome).toBe('shared');
    const [, destino, opciones] = nativo.descargar.mock.calls.at(-1) as [string, unknown, { headers: Record<string, string>; idempotent: boolean }];
    // El destino es el fichero con su nombre dentro del cache, no un directorio:
    // `downloadFileAsync` quiere una ruta de fichero.
    expect((destino as { uri: string }).uri).toContain('orbit-hub-peliculas-2026-10-02.json');
    expect(opciones.headers).toEqual({ Authorization: 'Bearer tok' });
    // Sin `idempotent`, la segunda exportacion del mismo dia falla con
    // `DestinationAlreadyExists` en vez de sobrescribir.
    expect(opciones.idempotent).toBe(true);
  });

  it('abre el panel de compartir con el tipo del fichero y su nombre', async () => {
    await saveExport({ pending, filename: 'orbit-hub-peliculas-2026-10-02.csv' });

    const [uri, opciones] = nativo.compartir.mock.calls.at(-1) as [string, Record<string, string>];
    // Android lee `mimeType` del `Intent`; iOS lee el `UTI`. Van los dos porque
    // cada plataforma descarta el del otro.
    expect(opciones.mimeType).toBe('text/csv');
    expect(opciones.UTI).toBe('public.comma-separated-values-text');
    expect(opciones.dialogTitle).toBe('orbit-hub-peliculas-2026-10-02.csv');
    expect(uri).toContain('.csv');
  });

  it('un fallo de descarga sale como red, con su reintento y su frase', async () => {
    // El intercambio HTTP entero ocurre dentro de `expo-file-system`: su error
    // solo menciona el codigo en el texto y no se puede leer de el. Lo que si se
    // sabe es que el fichero no ha llegado, y `network` es el `kind` que la hoja
    // pinta como reintentable. Sin esto, un 403 en un movil acabaria en
    // `unknown`, que no tiene frase ni boton de reintentar.
    nativo.descargar.mockRejectedValueOnce(new Error('Unable to download: 403'));

    const caught = await saveExport({
      pending,
      filename: 'orbit-hub-peliculas-2026-10-02.json',
    }).catch((error: unknown) => error);

    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).kind).toBe('network');
    expect((caught as ApiError).isRetryable).toBe(true);
    expect(exportErrorKey(caught)).toBe('export.error.network');
  });

  it('un fallo al compartir se queda sin pintar, porque no hay nada que reintentar', async () => {
    // La persona cerro el panel, o la app de destino no lo acepta: no es un fallo
    // de la descarga y volver a pulsar abriria el mismo panel que acaba de cerrar.
    // Sin `kind` que lo mapee, la hoja no pinta una frase que alarmaria.
    nativo.compartir.mockRejectedValueOnce(new Error('The operation was cancelled'));

    const caught = await saveExport({
      pending,
      filename: 'orbit-hub-peliculas-2026-10-02.json',
    }).catch((error: unknown) => error);

    expect(caught).toBeInstanceOf(Error);
    expect(exportErrorKey(caught)).toBeNull();
  });
});

/**
 * El sobre que se relee del cache en un movil.
 *
 * El `format` va como argumento y la pregunta se hace dentro a proposito: un CSV
 * son filas y no tiene sobre, asi que `JSON.parse` de un CSV solo produciria un
 * error tragado por el `catch` y un `null` que parece la respuesta correcta.
 */
describe('leer el sobre del cache', () => {
  beforeEach(() => {
    (Platform as { OS: string }).OS = 'ios';
    nativo.texto.mockReset();
  });

  afterEach(() => {
    (Platform as { OS: string }).OS = 'web';
  });

  it('un CSV ni se intenta leer', async () => {
    expect(await readSavedEnvelope({ filename: 'orbit-hub-x-2026-10-02.csv', format: 'csv' })).toBeNull();
    expect(nativo.texto).not.toHaveBeenCalled();
  });

  it('devuelve el sobre tal cual, con el tipo del contrato', async () => {
    const sobre = {
      format: 'orbit-hub.export',
      version: 1,
      list: { id: 'l1', title: 'Peliculas', items: [], createdAt: '2026-01-01T00:00:00.000Z' },
      items: [],
      counts: { items: 7 },
    };
    nativo.texto.mockResolvedValueOnce(JSON.stringify(sobre));

    const leido = await readSavedEnvelope({ filename: 'orbit-hub-x-2026-10-02.json', format: 'json' });

    expect(leido).toEqual(sobre);
    // El tipo no es un `unknown` que el llamante tenga que adivinar: aqui se
    // accede a `counts.items` sin castear nada.
    expect(leido?.counts).toEqual({ items: 7 });
  });

  it('un fichero que no se puede parsear da null y no un fallo', async () => {
    // El fichero ya esta entregado cuando se llega aqui: lo que se pierde son los
    // numeros de la linea de debajo, y una exportacion fallida seria mentira.
    nativo.texto.mockRejectedValueOnce(new Error('EACCES'));

    expect(await readSavedEnvelope({ filename: 'orbit-hub-x-2026-10-02.json', format: 'json' })).toBeNull();
  });
});

/**
 * La entrega en la web.
 *
 * El `Platform.OS` del stub de `react-native` es `web`, asi que esta es la rama
 * que el runner ejecuta por defecto. Y es justo la que hay que vigilar: si
 * `deliverExport` llegara a pasarle a `saveExport` el `pending` de verdad en vez
 * de la respuesta ya enviada, el fichero se bajaria **dos veces** —varios megas,
 * en silencio— y nada fallaria. Por eso se cuenta el numero de peticiones, y no
 * solo que la entrega funcione.
 */
describe('entregar la exportacion en la web', () => {
  interface Ancla {
    href: string;
    download: string;
    eventos: string[];
  }

  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;

  let eventos: string[];
  let creados: string[];
  let revocados: string[];
  let peticiones: number;
  let ancla: Ancla;

  /** El `document` de mentira: solo lo que usa la rama del navegador. */
  function documentoFalso(ancla: Ancla): Document {
    return {
      createElement: () => {
        ancla.eventos.push('createElement');
        return {
          href: '',
          download: '',
          click: () => ancla.eventos.push('click'),
          remove: () => ancla.eventos.push('remove'),
        };
      },
      body: {
        append: (link: Ancla) => {
          ancla.href = link.href;
          ancla.download = link.download;
          ancla.eventos.push('append');
        },
      },
    } as unknown as Document;
  }

  beforeEach(() => {
    // Se pone aunque el stub ya valga `web`: el bloque de arriba lo cambia a
    // `ios` y devuelve, y un test que depende del orden del fichero es un test
    // que pasa por casualidad.
    (Platform as { OS: string }).OS = 'web';

    eventos = [];
    creados = [];
    revocados = [];
    peticiones = 0;
    ancla = { href: '', download: '', eventos };

    // El token se configura aqui y no se hereda de los describes de arriba: el
    // ultimo que se ejecuto deja un `getAccessToken` que lanza a proposito.
    configureApiClient({ getAccessToken: async () => 'tok-entrega' });

    globalThis.URL.createObjectURL = () => {
      const url = `blob:orbithub/${creados.length}`;
      creados.push(url);
      return url;
    };
    globalThis.URL.revokeObjectURL = (url: string) => {
      revocados.push(url);
    };

    globalThis.fetch = async () => {
      peticiones += 1;
      return new Response(
        JSON.stringify({
          format: 'orbit-hub.export',
          version: 1,
          counts: {
            workspaces: 1,
            folders: 2,
            lists: 3,
            items: 4,
            notes: 5,
            attachments: 6,
            templates: 7,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    // El `document` va en el `beforeEach` y no en un solo test: sin el, la rama
    // del navegador revienta en `document.createElement` y los tres estarian
    // probando un camino que en la app no existe.
    globalThis.document = documentoFalso(ancla);
  });

  afterEach(() => {
    globalThis.URL.createObjectURL = originalCreateObjectURL;
    globalThis.URL.revokeObjectURL = originalRevokeObjectURL;
    delete (globalThis as { document?: Document }).document;
  });

  /** Una exportacion de la cuenta, que es la unica que lleva todos los `counts`. */
  function entregar(): Promise<ExportResult> {
    return deliverExport({
      path: '/account/export',
      format: 'json',
      title: 'export',
      fallbackId: 'a1b2c3d4',
    });
  }

  it('pide el fichero una sola vez y lee los numeros de esa misma respuesta', async () => {
    const resultado = await entregar();

    // Una peticion para las dos mitades —el `blob` y el sobre—. Y los numeros
    // vienen de esa misma respuesta, no de una segunda descarga.
    expect(peticiones).toBe(1);
    expect(resultado.how).toBe('downloaded');
    expect(resultado.counts).toEqual({
      workspaces: 1,
      folders: 2,
      lists: 3,
      items: 4,
      notes: 5,
      attachments: 6,
      templates: 7,
    });
  });

  it('devuelve el blob al sistema con la misma url que creo', async () => {
    await entregar();

    // Sin revocar, cada exportacion deja su `ArrayBuffer` retenido por la object
    // URL hasta que se cierra la pestana. El `finally` es lo que lo hace
    // dependable: el `revokeObjectURL` tiene que ser el ultimo de los tres.
    expect(creados).toHaveLength(1);
    expect(revocados).toEqual(creados);
  });

  it('mete el <a> en el documento y lo saca en cuanto ha hecho falta', async () => {
    const resultado = await entregar();

    expect(ancla.eventos).toEqual(['createElement', 'append', 'click', 'remove']);
    expect(ancla.download).toBe(resultado.filename);
    // El `href` es la object URL, no la de la API: al navegador lo que le importa
    // para descargar es el blob, no de donde salio.
    expect(ancla.href).toBe(creados[0]);
  });
});
