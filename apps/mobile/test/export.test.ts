import { exportFilename } from '@orbit-hub/contracts';
import { Platform } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError, apiRaw, apiRequest, configureApiClient } from '@/lib/api/client';
import { exportCountsLine } from '@/lib/export/counts';
import { exportErrorKey } from '@/lib/export/errors';
import { readSavedEnvelope, saveExport } from '@/lib/export/save';
import { dictionaries, formatTranslation } from '@/lib/i18n/dictionaries';
import type { TranslationKey } from '@/lib/i18n/dictionaries';
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

  /**
   * Un 500 dice algo, y esta es la comprobacion que lo protege.
   *
   * `error-handler.ts` convierte toda excepcion sin manejar en `internal_error`, y
   * el export de cuenta hace siete selects seguidos —el de una lista, tres—: un
   * timeout de la base de datos o un fallo en un mapper llegan aqui. Cuando este
   * caso vivia en el `null` de al
   * lado, la hoja —que solo pinta la linea cuando hay clave— dejaba a la persona
   * con "Reintentar" y "Cerrar" y ninguna palabra. Ese es el fallo que nadie se
   * enteraria de que ha pasado.
   *
   * No hay renderizador en este repo, asi que se comprueba lo que la hoja hace con
   * la clave en vez de lo que pinta: que existe, y que **tiene frase en los dos
   * idiomas**. Un `not.toBeNull()` solo bastaria si la clave pudiera no estar en el
   * diccionario; que este en `es` y en `en` es la mitad de que la linea se dibuje,
   * porque `t()` de una clave ausente devuelve **la propia clave** —no
   * `undefined`, que es lo que hace `i18n-provider.tsx` a proposito para que una
   * etiqueta que falta se vea en vez de dejar la pantalla a medias— y lo que
   * receberia el `<AppText>` seria la linea `export.error.internal` escrita en la
   * pantalla: raro, pero visible.
   */
  it('el 500 del servidor tiene frase propia, no un null', () => {
    const clave = exportErrorKey(new ApiError({ kind: 'internal_error', message: 'x', status: 500 }));

    // Lo que decide si la hoja dibuja la linea de error.
    expect(clave).toBe('export.error.internal');
    expect(clave).not.toBeNull();

    // Y lo que la haria vacia: la frase existe y no esta vacia en ninguno de los
    // dos diccionarios, que es lo que hace que `t(clave)` devuelva algo que pintar.
    expect(dictionaries.es[clave!]).toBeTruthy();
    expect(dictionaries.en[clave!]).toBeTruthy();
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
      journal: 0,
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

  /**
   * El mismo camino con el sobre de una **coleccion**, que es donde el numero se
   * perdia.
   *
   * Lo que se comprueba es la mitad de `countsOf`: la respuesta lleva un sobre de
   * coleccion y el `counts` que sale del `run` tiene que ser `{ bookmarks }`. Sin
   * la tercera rama el `safeParse` de los otros dos fallaba —el sobre de una
   * coleccion no tiene `items`— y `counts` volvia `null`, que la hoja pinta como
   * una linea de menos: el fichero llegaba igual y el panel no decia cuanto.
   *
   * Y se comprueba **contra la respuesta de verdad**, no contra un `counts` pasado a
   * mano, porque lo que se protege es el viaje entero: el `json()` del sobre, el
   * `safeParse` y el numero que sale. `exportCountsLine` ya tiene sus propios tests,
   * con el diccionario de verdad.
   */
  it('lee los enlaces del sobre de una coleccion y los pasa tal cual', async () => {
    globalThis.fetch = async () => {
      peticiones += 1;
      return new Response(
        JSON.stringify({
          format: 'orbit-hub.export',
          version: 1,
          collection: { id: 'c1', name: 'Recetas' },
          bookmarks: [{ id: 'b1' }, { id: 'b2' }, { id: 'b3' }],
          counts: { bookmarks: 3 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const resultado = await deliverExport({
      path: '/collections/c1/export',
      format: 'json',
      title: 'Recetas',
      fallbackId: 'c1',
    });

    expect(resultado.counts).toEqual({ bookmarks: 3 });
  });

  it('y un sobre que no es de nadie da null, no los numeros de otro', async () => {
    // La red de seguridad: un `counts` que no encaja en ninguno de los tres schemas
    // vuelve `null` y la linea se queda sin dibujar. Devolver los de otro —leer
    // `items` de un sobre que no los tiene— seria ensenar un numero que no salio
    // del fichero.
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({ format: 'orbit-hub.export', version: 1, counts: { notas: 9 } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );

    const resultado = await deliverExport({
      path: '/collections/c1/export',
      format: 'json',
      title: 'Recetas',
      fallbackId: 'c1',
    });

    expect(resultado.counts).toBeNull();
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

/**
 * La linea que se ensena al terminar una exportacion.
 *
 * El `t` es el de verdad, montado sobre el diccionario de castellano, y no una
 * funcion de mentira que devuelve la clave: asi lo que se comprueba es la frase
 * que se leeria en la pantalla —con sus tres grupos y su separador— y no solo que
 * se llamo a la clave correcta. Una clave que se renombre o un `{listas}` que se
 * escriba de otra manera rompe esto, que es justo lo que hay que que se rompa.
 */
const t = (key: TranslationKey, values?: Record<string, string | number>): string =>
  formatTranslation(dictionaries.es[key], values);

/**
 * Los tres grupos de la cuenta, y solo los tres que dice su frase.
 *
 * El sobre de la cuenta lleva siete numeros —espacios, carpetas, adjuntos y
 * plantillas tambien— y `export.counts` solo nombra tres. Los otros cuatro se
 * cuentan igual de bien y no se ensenan: una linea con todo son cuatro cifras mas
 * que nadie va a leer.
 */
describe('los numeros de una exportacion de la cuenta', () => {
  it('enseña listas, elementos y notas, y nada mas', () => {
    expect(
      exportCountsLine(
        { workspaces: 1, folders: 2, lists: 3, items: 4, notes: 5, attachments: 6, templates: 7 },
        t,
      ),
    ).toBe('3 listas · 4 elementos · 5 notas');
  });

  it('los numeros que no estan en la frase no se inventan un lugar', () => {
    // Los siete numeros del sobre, con las carpetas y los adjuntos a montones: si
    // la frase crease un grupo para ellos, esta seria otra linea.
    const linea = exportCountsLine(
      { workspaces: 9, folders: 40, lists: 1, items: 0, notes: 12, attachments: 300, templates: 5 },
      t,
    );

    expect(linea).toBe('1 listas · 0 elementos · 12 notas');
    expect(linea).not.toContain('9');
    expect(linea).not.toContain('300');
  });
});

/**
 * Una lista solo tiene `items`, y la frase de una lista solo tiene una cifra.
 *
 * Esta es la rama que se confunde: los dos sobres llevan `counts`, asi que la
 * decision no es si hay numeros sino **de quien son**. Con `"lists" in counts` mal
 * puesto, o con el orden de los dos `safeParse` del hook invertido, una lista cae
 * en la frase de la cuenta y se ensena "listas · elementos · notas" con dos de
 * los tres grupos en `undefined` — que es lo que hace `formatTranslation` con un
 * marcador sin valor: lo deja tal cual, con las llaves.
 */
describe('los numeros de una exportacion de una lista', () => {
  it('enseña solo los items, en plural', () => {
    expect(exportCountsLine({ items: 7 }, t)).toBe('7 elementos');
  });

  it('enseña el singular cuando hay uno', () => {
    // La rama del plural, no la de la cuenta: "1 elemento" y no "1 elementos", y
    // desde luego no "1 listas · 1 elementos · 1 notas".
    expect(exportCountsLine({ items: 1 }, t)).toBe('1 elemento');
  });

  it('no deja ningun grupo de la cuenta colgando', () => {
    // La asercion que pincha la confusion de verdad: un marcador sin valor se
    // queda en la pantalla con sus llaves, asi que basta con que no haya ninguno.
    const linea = exportCountsLine({ items: 42 }, t);

    expect(linea).toBe('42 elementos');
    expect(linea).not.toContain('{');
    expect(linea).not.toContain('·');
  });

  it('una lista vacia dice cero elementos y no nada', () => {
    // `counts.items` es un numero del sobre, y vale cero: una lista sin items
    // exportada sale con un cero delante, que es la verdad, y no con una linea
    // vacia que parece un fallo.
    expect(exportCountsLine({ items: 0 }, t)).toBe('0 elementos');
  });
});

/**
 * Una coleccion son **enlaces**, y la palabra es la del sobre y la de la pantalla.
 *
 * El bloque de arriba prueba la rama de una lista y el de la cuenta; este es el
 * tercero, y el que mas se confunde porque las tres ramas son frases contadas de
 * una sola cifra: `bookmarks` y `items` son dos numeros que compilan igual, asi que
 * la palabra equivocada no la caza el compilador —la caza el diccionario.
 */
describe('los numeros de una exportacion de una coleccion', () => {
  it('enseña los enlaces, en plural', () => {
    expect(exportCountsLine({ bookmarks: 7 }, t)).toBe('7 enlaces');
  });

  it('enseña el singular cuando hay uno', () => {
    expect(exportCountsLine({ bookmarks: 1 }, t)).toBe('1 enlace');
  });

  it('con la palabra del conteo de la pantalla, y no con la de una lista', () => {
    // `collections.count.*` y no una clave nueva de la familia `export.*`: esa
    // clave ya existe y es la que dice cuantos enlaces tiene una coleccion en la
    // lista de al lado. Un export que dijera "7 elementos" mientras la pantalla
    // dice "7 enlaces" seria la misma cuenta con dos palabras.
    expect(exportCountsLine({ bookmarks: 7 }, t)).not.toContain('elemento');
    expect(exportCountsLine({ bookmarks: 7 }, t)).toContain('enlaces');
    // Y la palabra existe en los dos idiomas, que es lo que la hace dibujable.
    expect(dictionaries.en['collections.count.other']).toBe('{count} links');
  });

  it('una coleccion vacia dice cero enlaces y no nada', () => {
    expect(exportCountsLine({ bookmarks: 0 }, t)).toBe('0 enlaces');
  });

  it('no deja ningun grupo de la cuenta colgando, ni ningun numero de otra cosa', () => {
    const linea = exportCountsLine({ bookmarks: 42 }, t);

    expect(linea).toBe('42 enlaces');
    expect(linea).not.toContain('{');
    expect(linea).not.toContain('·');
  });
});

/**
 * Las tres ramas se distinguen **por sus claves**, y por eso el orden no importa.
 *
 * Lo que se comprueba es que una forma de `counts` no caiga en la frase de otra.
 * Cada schema pide claves que los demas no tienen —la cuenta las siete, una lista
 * `items`, una coleccion `bookmarks`—, asi que un corte equivocado se ve aqui como
 * una palabra que no es la del sobre, no como un error de tipografia.
 */
describe('una forma de counts no se pinta como otra', () => {
  it('la coleccion no dice elementos ni listas', () => {
    const linea = exportCountsLine({ bookmarks: 3 }, t);

    expect(linea).toBe('3 enlaces');
    expect(linea).not.toContain('listas');
    expect(linea).not.toContain('notas');
  });

  it('la lista no dice enlaces', () => {
    expect(exportCountsLine({ items: 3 }, t)).toBe('3 elementos');
  });

  it('y un numero con la misma cifra en las dos formas no las vuelve indistinguibles', () => {
    // La confusion que de verdad cuesta dinero: dos sobres con el mismo numero y
    // frases distintas. Si las dos devolvieran lo mismo, el numero no diria de que
    // fichero viene y el panel seria decoration.
    expect(exportCountsLine({ items: 7 }, t)).not.toBe(exportCountsLine({ bookmarks: 7 }, t));
  });
});

/**
 * Un CSV no lleva sobre, y por eso `counts` es `null`.
 *
 * Lo que se decide aqui es que no se pinte **nada**, y no "un cero" o "un
 * separador solo": la cadena vacia es lo unico que la hoja puede recibir sin
 * dibujar una linea de la que no hay nada que decir. Un `·` suelto al final de un
 * panel es el sintoma de haber usado aqui un valor por defecto.
 */
describe('una exportacion sin sobre', () => {
  it('no dice nada, ni una cifra ni un separador', () => {
    expect(exportCountsLine(null, t)).toBe('');
  });

  it('la cadena vacia es de verdad vacia, no un espacio', () => {
    // Un `trim()` de la linea que la hoja pinta: si esto salia con un espacio, el
    // panel dibujaria una linea de altura con nada en ella.
    expect(exportCountsLine(null, t).trim()).toBe('');
  });
});
