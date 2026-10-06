import { isIP } from 'node:net';

import { describe, expect, it } from 'vitest';

import {
  comprobarDestinoSeguro,
  CuerpoDemasiadoGrande,
  esIpProhibida,
  hayDestinoProhibido,
  leerCuerpoConTope,
  resolverSalto,
  traerHtmlSeguro,
} from '../src/lib/ssrf.js';

/**
 * Los fixtures de la parte corta son URLs, no IPs sueltas, porque lo que se
 * valida es lo que devuelve el resolver. Los de la parte larga son funciones
 * puras del guard, y ahi si tiene sentido fijar la direccion exacta.
 *
 * Los tests que piden red estan marcados. La mayoria no: `dns.lookup` con una
 * IP literal no consulta ningun servidor de nombres, asi que rechazar
 * `169.254.169.254` se prueba sin sacar un paquete de la maquina.
 */
const CON_RED = true;

describe('el guard de SSRF', () => {
  it('rechaza los esquemas que no son http ni https, sin hacer el request', async () => {
    for (const url of [
      'file:///etc/passwd',
      'data:text/html,hola',
      'gopher://127.0.0.1:11211/',
      'ftp://example.com/x',
    ]) {
      const r = await traerHtmlSeguro(url);
      expect(r.ok, url).toBe(false);
    }
  });

  it('rechaza una URL que resuelve a loopback', async () => {
    // El motivo importa tanto como el `ok: false`. `ok: false` solo dice que no
    // se trajo HTML, y eso tambien lo dice "el guard lo dejo pasar y la red no
    // respondio". Si el motivo es el del guard, el paquete ni salio.
    const r = await traerHtmlSeguro('http://127.0.0.1:9/');
    expect(r).toMatchObject({
      ok: false,
      motivo: 'dns resolves to a private address',
    });
  });

  it('rechaza el rango de metadatos de la nube, que es el ataque clasico', async () => {
    // 169.254.169.254 es donde la nube expone los credenciales del servidor.
    const r = await traerHtmlSeguro('http://169.254.169.254/latest/meta-data/');
    expect(r).toMatchObject({
      ok: false,
      motivo: 'dns resolves to a private address',
    });
  });

  it(
    'acepta una pagina publica y devuelve su HTML',
    { skip: !CON_RED },
    async () => {
      const r = await traerHtmlSeguro('https://example.com');
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.html).toContain('<html');
      expect(r.finalUrl).toBe('https://example.com/');
      expect(r.bytes).toBeGreaterThan(0);
    },
  );
});

describe('los rangos se comparan en bits, no por prefijo de texto', () => {
  it('distingue 172.16 de 172.32, que comparten el prefijo "172."', () => {
    // Con `startsWith('172.')` se rechaza una red publica y se deja pasar una
    // privada. Este test es el que hace notar ese error.
    expect(esIpProhibida('172.16.0.1')).toBe(true);
    expect(esIpProhibida('172.31.255.255')).toBe(true);
    expect(esIpProhibida('172.32.0.1')).toBe(false);
    expect(esIpProhibida('172.15.255.255')).toBe(false);
  });

  it('cubre los seis rangos de IPv4 y los bordes de cada mascara', () => {
    for (const prohibida of [
      '0.0.0.1', // 0.0.0.0/8, "any"
      '127.0.0.1',
      '127.255.255.255',
      '10.0.0.1',
      '10.255.255.255',
      '192.168.1.1',
      '169.254.169.254',
    ]) {
      expect(esIpProhibida(prohibida), prohibida).toBe(true);
    }

    for (const publica of [
      '9.255.255.255', // antes de 10/8
      '11.0.0.0', // despues de 10/8
      '126.255.255.255', // antes de 127/8
      '128.0.0.1', // despues de 127/8
      '169.253.255.255', // antes de 169.254/16
      '169.255.0.0', // despues de 169.254/16
      '192.167.255.255', // antes de 192.168/16
      '192.169.0.0', // despues de 192.168/16
      '93.184.216.34',
    ]) {
      expect(esIpProhibida(publica), publica).toBe(false);
    }
  });

  it('cubre IPv6 con prefijos de bytes, y sus bordes', () => {
    for (const prohibida of [
      '::1',
      '::',
      'fc00::1',
      'fd12:3456:789a::1', // unica, no link-local
      'fe80::1',
      'febf:ffff::1', // el ultimo /10 de link-local
    ]) {
      expect(esIpProhibida(prohibida), prohibida).toBe(true);
    }

    for (const publica of [
      'fbff:ffff::1', // fc00::/7 empieza en fc
      'fe00::1', // por debajo de fe80::/10
      'fec0::1', // por encima de fe80::/10
      '2606:4700:4700::1111',
    ]) {
      expect(esIpProhibida(publica), publica).toBe(false);
    }
  });

  it('deshace una IPv4 metida en una IPv6, que es la misma direccion', () => {
    // `::ffff:169.254.169.254` son los metadatos de la nube con otra notacion.
    expect(esIpProhibida('::ffff:127.0.0.1')).toBe(true);
    expect(esIpProhibida('::ffff:169.254.169.254')).toBe(true);
    expect(esIpProhibida('64:ff9b::7f00:1')).toBe(true); // NAT64
    expect(esIpProhibida('::ffff:93.184.216.34')).toBe(false);
  });

  it('falla cerrado con lo que no sabe leer', () => {
    // Un filtro que deja pasar lo que no entiende no es un filtro.
    expect(esIpProhibida('')).toBe(true);
    expect(esIpProhibida('no-es-una-ip')).toBe(true);
    expect(esIpProhibida('1.2.3')).toBe(true);
    expect(esIpProhibida('1.2.3.256')).toBe(true);
    expect(esIpProhibida('fe80::1::2')).toBe(true);
    expect(esIpProhibida('::ffff:1.2.3.4.5')).toBe(true);
  });
});

describe('un nombre, no una IP literal', () => {
  it(
    'rechaza un nombre publico que resuelve a loopback',
    { skip: !CON_RED },
    async () => {
      // `localtest.me` resuelve a 127.0.0.1 para todo el mundo. Importa que sea
      // un NOMBRE: si el guard rechaza `http://127.0.0.1/` pero acepta un
      // nombre que apunta ahi, el guard no existe.
      const r = await comprobarDestinoSeguro('http://localtest.me/');
      expect(r).toMatchObject({ ok: false, motivo: 'dns resolves to a private address' });
    },
  );

  it('tumba el nombre entero si una sola direccion esta prohibida', () => {
    // Un nombre con una A publica y una AAAA a 169.254 es el hueco clasico: si
    // el guard se queda con la primera direccion de la lista, se conecta a la
    // publica, el cliente cree que esta bien y el servidor acaba en la privada.
    // Ningun test de la tabla de rangos nota esto, asi que la regla se prueba
    // aca, con la lista mezclada, y sin red.
    expect(
      hayDestinoProhibido([{ address: '93.184.216.34' }, { address: '169.254.169.254' }]),
    ).toBe(true);
    expect(hayDestinoProhibido([{ address: '169.254.169.254' }, { address: '93.184.216.34' }])).toBe(
      true,
    );
    expect(
      hayDestinoProhibido([{ address: '93.184.216.34' }, { address: '2606:4700:4700::1111' }]),
    ).toBe(false);
    expect(hayDestinoProhibido([])).toBe(false);
  });

  it(
    'mira todas las direcciones del nombre, no solo la primera',
    { skip: !CON_RED },
    async () => {
      // `localhost` devuelve mas de una. El caso de la lista mezclada esta
      // arriba, con `hayDestinoProhibido`, porque no hay un nombre publico y
      // estable que devuelva una A publica junto a una AAAA privada.
      const r = await comprobarDestinoSeguro('http://localhost/');
      expect(r).toMatchObject({ ok: false, motivo: 'dns resolves to a private address' });
    },
  );

  it(
    'devuelve la IP a la que hay que conectarse, no solo un si',
    { skip: !CON_RED },
    async () => {
      // El nombre queda para el SNI y para el `Host`. Si el socket se abriera
      // contra `url.hostname`, el DNS se resolveria una segunda vez y este `ip`
      // no tendria para que estar: la property de "validar una vez" se pierde.
      const r = await comprobarDestinoSeguro('https://example.com/');
      expect(r.ok).toBe(true);
      if (!r.ok) return;

      expect(r.destino.url.hostname).toBe('example.com');
      expect(r.destino.familia).toBe(4);
      expect(isIP(r.destino.ip)).toBe(4);
      expect(esIpProhibida(r.destino.ip)).toBe(false);
    },
  );

  it('rechaza las mayusculas, y lo hace a proposito', async () => {    // Decision heredada de `esUrlQueSePuedePedir`: el filtro tiene que ser el
    // mismo que el del contrato, no uno parecido. Si alguien "arregla" esto con
    // `toLowerCase()`, hay que volver a pensarlo.
    expect(await traerHtmlSeguro('HTTPS://example.com')).toMatchObject({ ok: false });
  });

  it('lee el host despues de parsear la URL, no antes', async () => {    // El userinfo es la forma de esconder el host verdadero detras de algo que
    // parece un nombre. `URL` lo resuelve solo, asi que alcanza con mirarlo.
    const r = await comprobarDestinoSeguro('http://example.com@169.254.169.254/');
    expect(r).toMatchObject({ ok: false, motivo: 'dns resolves to a private address' });
  });

  it('rechaza el loopback escrito de formas que no parecen una IP', async () => {
    // Estas cuatro son 127.0.0.1. El punto de por que funciona sin codigo
    // extra: el filtro mira **lo que devolvio el resolver**, no el texto crudo
    // de `URL.hostname`. El resolver normaliza las tres ultimas, asi que si
    // alguien escribiera el chequeo sobre el texto se colarian. Sin red: un
    // host numerico lo resuelve el sistema, no un servidor de nombres.
    for (const url of [
      'http://2130706433/', // decimal
      'http://0177.0.0.1/', // octal
      'http://0x7f.0.0.1/', // hexadecimal
      'http://127.1/', // forma corta
    ]) {
      const r = await comprobarDestinoSeguro(url);
      expect(r, url).toMatchObject({
        ok: false,
        motivo: 'dns resolves to a private address',
      });
    }
  });
});

describe('los redirects se revalidan en cada salto', () => {
  it('resuelve la cabecera location contra la URL actual', () => {
    const actual = new URL('https://example.com/articulos/uno');

    expect(resolverSalto('/articulos/dos', actual)).toEqual({
      ok: true,
      url: 'https://example.com/articulos/dos',
    });
    expect(resolverSalto('https://otro.example/x', actual)).toEqual({
      ok: true,
      url: 'https://otro.example/x',
    });

    // Sin base, `//host/x` no es una URL: solo lo es con la URL actual.
    expect(() => new URL('//169.254.169.254/x')).toThrow();
    expect(resolverSalto('//169.254.169.254/x', actual)).toEqual({
      ok: true,
      url: 'https://169.254.169.254/x',
    });
  });

  it('cae en el filtro de esquema cuando el location cambia de protocolo', () => {
    // Sale del `resolverSalto` como una URL normal y se cae en el
    // `esUrlQueSePuedePedir` del siguiente salto, que es lo que lo para.
    const salto = resolverSalto('gopher://127.0.0.1:11211/', new URL('https://example.com/'));
    expect(salto).toEqual({ ok: true, url: 'gopher://127.0.0.1:11211/' });
    return expect(
      comprobarDestinoSeguro(salto.ok ? salto.url : ''),
    ).resolves.toMatchObject({ ok: false });
  });

  it(
    'sigue el redirect y reporta la URL final',
    { skip: !CON_RED },
    async () => {
      // El punto de este test es que el bucle existe: sin manejo de redirects
      // el 301 de GitHub volveria como si fuera el HTML del articulo.
      const r = await traerHtmlSeguro('http://github.com/');
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.finalUrl.startsWith('https://')).toBe(true);
    },
  );

  it(
    'corta cuando se pasa el techo de redirects',
    { skip: !CON_RED },
    async () => {
      // Tambien muerde si el bucle no contara: sin el tope, `maxRedirects: 0`
      // seguiria el redirect y devolveria ok.
      const r = await traerHtmlSeguro('http://github.com/', { maxRedirects: 0 });
      expect(r).toMatchObject({ ok: false, motivo: 'too many redirects' });
    },
  );

  it(
    'no pide el destino de un redirect si ese destino esta prohibido',
    { skip: !CON_RED },
    async () => {
      // El error clasico, de punta a punta. httpbin.org devuelve un 302 real
      // hacia 169.254.169.254: con `redirect: 'follow'` --o con cualquier atajo
      // que revalide solo la primera URL-- el segundo request sale igual y se
      // lleva los credenciales de la maquina. Aca no sale, y el motivo dice por
      // que.
      //
      // DEPENDENCIA DE UN TERCERO: si httpbin.org se cae o el entorno lo
      // bloquea, este es el test que falla, y el motivo va a ser la red y no el
      // guard. Es el precio de probar el bucle entero sin abrir un puerto
      // local, que el guard rechazaria por ser loopback.
      const r = await traerHtmlSeguro(
        'https://httpbin.org/redirect-to?url=http%3A%2F%2F169.254.169.254%2F',
      );
      expect(r).toMatchObject({
        ok: false,
        motivo: 'dns resolves to a private address',
      });
    },
  );
});

describe('el tope de bytes corta mientras se lee', () => {
  function endless(chunkBytes: number): {
    stream: ReadableStream<Uint8Array>;
    cuantos: () => number;
  } {
    const trozo = new TextEncoder().encode('a'.repeat(chunkBytes));
    let emitidos = 0;
    return {
      stream: new ReadableStream<Uint8Array>({
        pull(control) {
          emitidos += 1;
          control.enqueue(trozo);
        },
      }),
      cuantos: () => emitidos,
    };
  }

  it('aborta un stream que no termina, y deja de pedirle chunks', async () => {
    const { stream, cuantos } = endless(4096);
    // "Leer todo y despues medir" no puede pasar este test: no hay fin al que
    // llegar. Y el limite de emisiones es lo que separa "corto al pasar el tope"
    // de "corto cuando el servidor se cansa".
    await expect(leerCuerpoConTope(stream, 10_000)).rejects.toBeInstanceOf(
      CuerpoDemasiadoGrande,
    );
    expect(cuantos()).toBeLessThanOrEqual(4);
  });

  it('deja pasar un cuerpo que entra, y cuenta los bytes reales', async () => {
    const cuerpo = new ReadableStream<Uint8Array>({
      start(control) {
        control.enqueue(new TextEncoder().encode('<h1>'));
        control.enqueue(new TextEncoder().encode('hola</h1>'));
        control.close();
      },
    });

    const r = await leerCuerpoConTope(cuerpo, 1000);
    expect(r.texto).toBe('<h1>hola</h1>');
    expect(r.bytes).toBe(13);
  });

  it('el motivo del corte es una frase, no un codigo', () => {
    expect(new CuerpoDemasiadoGrande().message).toBe(
      'the page is larger than the byte limit',
    );
  });

  it(
    'corta tambien por la ruta real, no solo por la unidad',
    { skip: !CON_RED },
    async () => {
      // La misma funcion, llamada desde el guard. Sin esto, un test verde de
      // `leerCuerpoConTope` no probaria que el guard lo use.
      const r = await traerHtmlSeguro('https://example.com', { maxBytes: 64 });
      expect(r).toMatchObject({ ok: false, motivo: 'the page is larger than the byte limit' });
    },
  );
});

describe('el motivo de un fallo es corto y en ingles', () => {
  it('no devuelve ni un stack ni un codigo de error de Node', async () => {
    const r = await traerHtmlSeguro('https://example.invalid/');
    expect(r.ok).toBe(false);
    if (r.ok) return;

    expect(typeof r.motivo).toBe('string');
    expect(r.motivo).toBe('the host does not resolve');
    expect(r.motivo).not.toMatch(/Error|at |0x[0-9a-f]/);
  });

  it(
    'el timeout es por request y se puede ver en el motivo',
    { skip: !CON_RED },
    async () => {
      // Un milisegundo no alcanza para un DNS, un TCP y un TLS, asi que el
      // corte es del reloj y no una carrera: el motivo dice "se agoto" y no
      // "fallo la request", que es la distincion que permite leer un
      // `extractionError` y saber si hay que reintentar.
      const r = await traerHtmlSeguro('https://example.com', { timeoutMs: 1 });
      expect(r).toMatchObject({ ok: false, motivo: 'the request timed out' });
    },
  );

  it('rechaza unas opciones que no tienen sentido, sin salir a la red', async () => {
    for (const opciones of [
      { timeoutMs: 0 },
      { timeoutMs: Number.NaN },
      { maxBytes: 0 },
      { maxBytes: 1.5 },
      { maxRedirects: -1 },
    ]) {
      const r = await traerHtmlSeguro('https://example.com', opciones);
      expect(r, JSON.stringify(opciones)).toMatchObject({
        ok: false,
        motivo: 'the search options are not valid',
      });
    }
  });
});
