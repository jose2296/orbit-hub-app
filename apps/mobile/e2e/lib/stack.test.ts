import { once } from 'node:events';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureService, isListening, waitForHttp, type Service } from './stack';

/** Nombre imposible de colisionar con el entorno real, que es de lo que se trata. */
const CLAVE = 'MARCA_ARNES_E2E';

const abiertos: { close(): void }[] = [];
const arrancados: Service[] = [];

afterEach(async () => {
  // Los dos en este orden: parar un hijo suelta su puerto, y cerrar un servidor
  // suelto el suyo. Al reves, el `stop` del hijo espera a un puerto que el
  // servidor que se cerro todavia no ha soltado.
  for (const s of arrancados.splice(0)) await s.stop();
  for (const s of abiertos.splice(0)) s.close();
});

/**
 * Servidor de un solo uso. `estado` es lo que contesta, para poder pinning de un
 * codigo concreto; por defecto responde 200 como cualquier cosa en pie.
 */
async function servir(estado = 200): Promise<string> {
  const server = createServer((_peticion, respuesta) => {
    respuesta.statusCode = estado;
    respuesta.end(estado === 503 ? 'degraded' : 'ok');
  });
  // `listen` no es sincrono: el puerto se asigna despues, asi que `address()` en la
  // linea siguiente devuelve null y no un numero. Por eso esto es async y por eso
  // hay que esperarlo antes de construir la url.
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  abiertos.push(server);
  const puerto = (server.address() as { port: number }).port;
  return `http://127.0.0.1:${puerto}/`;
}

/**
 * Un puerto libre, reservado y soltado. Sin host, `listen` reserva en el acto y
 * `address()` ya responde; con host pasa por DNS y devuelve null. Por eso este
 * helper puede devolver el puerto sin esperar a ningun evento, que es lo que hace
 * falta para conocer la url antes de que nada conteste en ella.
 */
function puertoReservado(): number {
  const sonda = createServer();
  sonda.listen(0);
  const puerto = (sonda.address() as { port: number }).port;
  sonda.close();
  return puerto;
}

/**
 * El hijo escribe por una tuberia y puede vaciarla un rato despues de imprimir,
 * asi que se lee hasta que aparezca la marca. Con limite, para que un hijo que no
 * imprime nada falle el test y no lo deje colgado.
 */
async function esperarEnLog(logFile: string, marca: string, limiteMs = 5000): Promise<string> {
  const limite = Date.now() + limiteMs;
  for (;;) {
    const contenido = existsSync(logFile) ? readFileSync(logFile, 'utf8') : '';
    if (contenido.includes(marca)) return contenido;
    if (Date.now() > limite) {
      throw new Error(`${marca} no salio en ${logFile}. Contenido: ${contenido}`);
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}

type hijo = { servicio: Service; url: string; logFile: string };

/**
 * Levanta un hijo de verdad, un `node -e`, que se queda sirviendo para que
 * `ensureService` tenga algo que encontrar. Un `spawn` untrueado comprobaria que se
 * leyo el `env`, no que el hijo recibio el valor, y el binding de este arnes es
 * justo ese: las variables van al entorno del hijo y el del arnes no se toca.
 *
 * `alSalirTarda` hace que el hijo tarde en soltarse al recibir SIGTERM, para poder
 * comprobar que `stop` espera de verdad y no solo manda la senal.
 */
async function arrancarHijo(alSalirTarda = 0): Promise<hijo> {
  const logFile = join(mkdtempSync(join(tmpdir(), 'arnes-stack-')), 'hijo.log');
  const puerto = puertoReservado();
  const url = `http://127.0.0.1:${puerto}/`;
  const seRetira = alSalirTarda
    ? `process.on('SIGTERM', () => setTimeout(() => process.exit(0), ${alSalirTarda}));`
    : '';
  const servicio = await ensureService({
    label: 'un hijo',
    url,
    cmd: process.execPath,
    args: [
      '-e',
      [
        `const http = require('node:http');`,
        seRetira,
        `http.createServer((_q, r) => r.end('ok')).listen(${puerto}, '127.0.0.1');`,
        `console.log('${CLAVE}=' + (process.env.${CLAVE} ?? 'nada'));`,
      ].join(''),
    ],
    env: { [CLAVE]: 'hola' },
    logFile,
    timeoutMs: 10_000,
  });
  arrancados.push(servicio);
  return { servicio, url, logFile };
}

describe('isListening', () => {
  it('es verdad cuando algo contesta', async () => {
    await expect(isListening(await servir())).resolves.toBe(true);
  });

  it('es falso cuando el puerto esta cerrado, y no lanza', async () => {
    await expect(isListening('http://127.0.0.1:1/')).resolves.toBe(false);
  });

  it('da por buena una respuesta 404, porque lo que pregunta es el puerto', async () => {
    // La ruta no es lo que se comprueba aqui, y por eso una respuesta sirve como
    // prueba de que el puerto esta cogido aunque no sea la ruta correcta. Lo que
    // si se rechaza es el 503, que es un puerto cogido con un servicio roto.
    await expect(isListening(await servir(404))).resolves.toBe(true);
  });

  it('es falso con un 503: hay puerto, pero hay un servicio roto', async () => {
    // La API contesta 503 cuando su ping a la base de datos falla. Aceptarlo
    // haria que el arnes dijera "arrancado" y entregara al paso siguiente una
    // conexion que falla en su primera consulta de verdad.
    await expect(isListening(await servir(503))).resolves.toBe(false);
  });
});

describe('waitForHttp', () => {
  it('da por buena una url que ya responde', async () => {
    await expect(waitForHttp(await servir(), { timeoutMs: 2000 })).resolves.toBe(true);
  });

  it('insiste hasta que el servicio aparece, en vez de mirar una sola vez', async () => {
    // El bucle de reintento es lo unico que hace que `ensureService` sirva de algo:
    // un servicio tarda segundos en contestar y se comprueba antes de que exista.
    // Con una sola pregunta, quitar el bucle no rompia ningun test.
    const server = createServer((_peticion, respuesta) => respuesta.end('ok'));
    const escuchando = once(server, 'listening');
    const puerto = puertoReservado();
    // Sin await a proposito: mientras el temporizador corre, en esa url no contesta
    // nadie, que es justo lo que obliga a preguntar mas de una vez.
    setTimeout(() => server.listen(puerto, '127.0.0.1'), 250);
    abiertos.push(server);

    await expect(
      waitForHttp(`http://127.0.0.1:${puerto}/`, { timeoutMs: 5000, intervalMs: 50 }),
    ).resolves.toBe(true);
    // La espera del fixture va por su propio lado, para que el test dependa del
    // evento y no de haber leido antes el estado del servidor.
    await escuchando;
  });

  it('devuelve falso, en vez de lanzar, cuando se agota el tiempo', async () => {
    // El arranque de Metro falla asi. Que devuelva falso deja que ensureService
    // tire el error con el log delante, que es lo que hace falta para diagnosticar.
    await expect(waitForHttp('http://127.0.0.1:1/', { timeoutMs: 600, intervalMs: 100 })).resolves.toBe(false);
  });
});

describe('ensureService', () => {
  it('pone las variables en el entorno del hijo y no en el del arnes', async () => {
    const { servicio, logFile } = await arrancarHijo();
    expect(servicio.started).toBe(true);
    // El hijo la vio: sale del log del hijo, no de una asercion sobre el `env`.
    await esperarEnLog(logFile, `${CLAVE}=hola`);
    // Y el arnes no se quedo con ella: es la unica forma de saber que nadie
    // asigno nada a `process.env`, que es lo que esta prohibido.
    expect(process.env[CLAVE]).toBeUndefined();
  });

  it('no se devuelve del stop hasta que el puerto del hijo queda libre', async () => {
    const { servicio, url } = await arrancarHijo(700);
    await servicio.stop();
    await expect(isListening(url)).resolves.toBe(false);
  });

  it('no toca un servicio que ya estaba en pie', async () => {
    const url = await servir();
    const servicio = await ensureService({
      label: 'un servicio que ya estaba',
      url,
      cmd: process.execPath,
      args: ['-e', 'process.exit(0)'],
      logFile: join(mkdtempSync(join(tmpdir(), 'arnes-stack-')), 'nunca.log'),
      timeoutMs: 2000,
    });
    expect(servicio.started).toBe(false);
    await servicio.stop();
    await expect(isListening(url)).resolves.toBe(true);
  });
});
