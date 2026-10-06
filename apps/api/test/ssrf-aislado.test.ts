import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Los tests que necesitan mirar **adentro** del guard.
 *
 * Van aparte porque `vi.mock` es de modulo: mockear `node:dns/promises` o
 * `node:https` aca no puede contaminar `ssrf.test.ts`, que sigue probando
 * contra la red de verdad.
 *
 * Que se gana con esto, y no es poco:
 *
 * - **I1**: `dns.lookup` no se puede abortar. Un mock que devuelve una promesa
 *   que nunca resuelve es el unico modo de probar que el caller recupera el
 *   control, porque contra un nameserver real hay que esperar a que el sistema
 *   operativo se aburre, y eso no es un timeout, es una tarde.
 * - **m1**: con el transporte falso se puede contar **cuantos paquetes salieron**,
 *   en vez de deducirlo del motivo devuelto. "No salio el segundo request" es una
 *   asercion; "el motivo dice que no" es una inferencia.
 * - **m2**: se puede leer las opciones que llegan a `request`, que es donde se
 *   juega el fijado de IP. Sin esto, cambiar `host: ip` por `host: url.hostname`
 *   dejaba la suite entera verde.
 */

const falsos = vi.hoisted(() => ({
  lookup: vi.fn(),
  httpRequest: vi.fn(),
  httpsRequest: vi.fn(),
}));

vi.mock('node:dns/promises', () => ({ lookup: falsos.lookup }));
vi.mock('node:http', () => ({ default: { request: falsos.httpRequest } }));
vi.mock('node:https', () => ({ default: { request: falsos.httpsRequest } }));

const { traerHtmlSeguro } = await import('../src/lib/ssrf.js');

// ---------------------------------------------------------------------------
// El transporte falso
// ---------------------------------------------------------------------------

type OpcionesDeRequest = Record<string, unknown> & {
  host?: string;
  servername?: string;
  family?: number;
  headers?: Record<string, string>;
};

interface Paso {
  statusCode: number;
  headers?: Record<string, string>;
  html?: string;
}

/**
 * Un `IncomingMessage` con lo unico que el guard le pide: status, headers,
 * `destroy` y ser iterable async con el cuerpo.
 */
function respuesta(paso: Paso): object {
  const trozos =
    paso.html === undefined || paso.html === ''
      ? []
      : [new TextEncoder().encode(paso.html)];

  return {
    statusCode: paso.statusCode,
    headers: paso.headers ?? {},
    destroy: () => {},
    [Symbol.asyncIterator]: async function* () {
      for (const trozo of trozos) yield trozo;
    },
  };
}

/** Encola los pasos y devuelve las opciones de cada request, en orden. */
function planear(transporte: 'http' | 'https', pasos: Paso[]): OpcionesDeRequest[] {
  const llamadas: OpcionesDeRequest[] = [];
  falsos[transporte === 'http' ? 'httpRequest' : 'httpsRequest'].mockImplementation(
    (opciones: OpcionesDeRequest, cb: (r: object) => void) => {
      llamadas.push(opciones);
      cb(respuesta(pasos[Math.min(llamadas.length - 1, pasos.length - 1)] ?? { statusCode: 500 }));
      return { on: () => {}, end: () => {} };
    },
  );
  return llamadas;
}

const HTML = '<html><body><article>hola</article></body></html>';

beforeEach(() => {
  falsos.lookup.mockReset();
  falsos.httpRequest.mockReset();
  falsos.httpsRequest.mockReset();
  // Por defecto todo resuelve a una IP publica y responde 200. Cada test
  // sobreescribe lo que necesita.
  falsos.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
  planear('https', [{ statusCode: 200, html: HTML }]);
});

// ---------------------------------------------------------------------------
// I1: el timeout cubre tambien el resolver
// ---------------------------------------------------------------------------

describe('el timeout acota tambien la fase de resolver', () => {
  it('vuelve cuando el resolver no responde, sin esperar a que el SO se aburra', async () => {
    // El lookup se queda colgado para siempre, que es lo que hace un dominio
    // cuyo nameserver no contesta. El pool de libuv tiene cuatro hilos: cuatro
    // de estos concurrentes lo agotan y los lookups de los demas modulos del
    // proceso --la base de datos incluida-- empiezan a encolar.
    falsos.lookup.mockImplementation(() => new Promise<never>(() => {}));
    planear('https', [{ statusCode: 200, html: HTML }]);

    const inicio = Date.now();
    const r = await traerHtmlSeguro('https://no-responde.example/', { timeoutMs: 300 });
    const elapsed = Date.now() - inicio;

    expect(r).toMatchObject({ ok: false, motivo: 'the request timed out' });
    // El margen es amplio a proposito: lo que se prueba es que vuelve, no que
    // sea preciso al milisegundo.
    expect(elapsed).toBeGreaterThanOrEqual(250);
    expect(elapsed).toBeLessThan(3_000);
    // Y lo importante: no se abrio ningun socket, porque todavia no se sabe a
    // que IP se-connectaria.
    expect(falsos.httpsRequest).not.toHaveBeenCalled();
  });

  it('el reloj es por salto, no uno solo para toda la llamada', async () => {
    // Cada lookup tarda 400 ms y el reloj del salto son 600. Dos saltos dan
    // 800 ms de reloj en total: con un reloj por salto sobra, y con un unico
    // reloj para toda la llamada el segundo lookup arrancaria a los 400 ms con
    // 200 ms de presupuesto y cortaria con "the request timed out". El archivo
    // promete `4 x timeoutMs` como total, y esto es lo que sostiene esa cuenta.
    falsos.lookup.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
      return [{ address: '93.184.216.34', family: 4 }];
    });

    const opciones = planear('https', [
      { statusCode: 302, headers: { location: 'https://otro.example/final' } },
      { statusCode: 200, html: HTML },
    ]);

    const r = await traerHtmlSeguro('https://lento.example/', { timeoutMs: 600 });

    expect(r.ok).toBe(true);
    expect(opciones).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// m1: el destino prohibido de un redirect no se pide
// ---------------------------------------------------------------------------

describe('un redirect no compra un segundo request a un destino prohibido', () => {
  it('llama a request una sola vez y nombra el motivo', async () => {
    // El `Location` del 302 es un loopback de manual. El motivo importa, pero
    // la asercion que prueba que el segundo paquete no salio es el `toHaveBeen-
    // CalledTimes(1)`: con `redirect: 'follow'` --o con cualquier atajo que
    // revalide solo la primera URL-- ese numero seria 2.
    falsos.lookup.mockImplementation(async (host: string) =>
      host === '169.254.169.254'
        ? [{ address: '169.254.169.254', family: 4 }]
        : [{ address: '93.184.216.34', family: 4 }],
    );

    const opciones = planear('https', [
      { statusCode: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } },
      { statusCode: 200, html: '<html>secreto de la maquina</html>' },
    ]);

    const r = await traerHtmlSeguro('https://articulo.example/');

    expect(r).toMatchObject({
      ok: false,
      motivo: 'dns resolves to a private address',
    });
    expect(opciones).toHaveLength(1);
    expect(falsos.httpsRequest).toHaveBeenCalledTimes(1);
    // Y el HTML prohibido nunca llego a construirse.
    expect(falsos.httpsRequest).not.toHaveBeenCalledWith(
      expect.objectContaining({ path: expect.stringContaining('meta-data') }),
    );
  });

  it('un redirect a un host publico si se sigue, y tambien con la IP fijada', async () => {
    // El otro lado de la misma regla: revalidar no es rechazar. El segundo
    // salto vuelve a pasar por el filtro entero, y por eso tambien vuelve a
    // fijar la IP a la del host nuevo, no a la del primero.
    falsos.lookup.mockImplementation(async (host: string) =>
      host === 'destino.example'
        ? [{ address: '93.184.216.35', family: 4 }]
        : [{ address: '93.184.216.34', family: 4 }],
    );

    const opciones = planear('https', [
      { statusCode: 301, headers: { location: 'https://destino.example/final' } },
      { statusCode: 200, html: HTML },
    ]);

    const r = await traerHtmlSeguro('https://articulo.example/');

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.finalUrl).toBe('https://destino.example/final');
    expect(opciones).toHaveLength(2);
    expect(opciones[0]?.host).toBe('93.184.216.34');
    expect(opciones[1]?.host).toBe('93.184.216.35');
    expect(opciones[1]?.servername).toBe('destino.example');
  });
});

// ---------------------------------------------------------------------------
// m2: el request sale contra la IP fijada
// ---------------------------------------------------------------------------

describe('el request sale contra la IP que devolvio el resolver', () => {
  it('manda la IP en host y el nombre en servername y en Host', async () => {
    // La propiedad es TOCTOU: si el nombre vuelve a cambiar entre el chequeo y
    // el connect, el nombre ya no participa porque el socket se abre contra un
    // literal. Antes de este test eso no lo verificaba nadie.
    const opciones = planear('https', [{ statusCode: 200, html: HTML }]);

    const r = await traerHtmlSeguro('https://articulo.example:8443/lectura');

    expect(r.ok).toBe(true);
    expect(opciones).toHaveLength(1);
    expect(opciones[0]?.host).toBe('93.184.216.34');
    expect(opciones[0]?.servername).toBe('articulo.example');
    // El `Host` lleva el nombre y el puerto, no la IP: con la IP delante el
    // sitio responde otra cosa y el patron queda a la vista.
    expect(opciones[0]?.headers?.host).toBe('articulo.example:8443');
    expect(opciones[0]?.port).toBe(8443);
  });

  it('lleva la familia explicita, aunque el literal ya la imponga', async () => {
    // m3: `familia` estaba en el tipo y ningun consumidor la leia. Ahora va en
    // las opciones del request, que es defensa en profundidad: si alguien
    // vuelve a poner un nombre en `host`, la restriccion de familia sigue
    // vigente en vez de desaparecer con el nombre.
    const opciones = planear('https', [{ statusCode: 200, html: HTML }]);
    falsos.lookup.mockResolvedValue([{ address: '2606:4700:4700::1111', family: 6 }]);

    await traerHtmlSeguro('https://ipv6.example/');

    expect(opciones[0]?.host).toBe('2606:4700:4700::1111');
    expect(opciones[0]?.family).toBe(6);
    // `servername` sin corchetes: los corchetes son sintaxis de URL, no de SNI.
    expect(opciones[0]?.servername).toBe('ipv6.example');
  });

  it('http plano tambien sale contra la IP, y no manda servername', async () => {
    // `servername` es de TLS. Mandarlo en http es ruido que ademas hace ruido
    // en los logs de cualquier proxy.
    const opciones = planear('http', [{ statusCode: 200, html: HTML }]);

    const r = await traerHtmlSeguro('http://articulo.example/');

    expect(r.ok).toBe(true);
    expect(opciones[0]?.host).toBe('93.184.216.34');
    expect(opciones[0]).not.toHaveProperty('servername');
    expect(falsos.httpsRequest).not.toHaveBeenCalled();
  });
});
