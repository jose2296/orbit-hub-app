import { once } from 'node:events';
import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { isListening, waitForHttp } from './stack';

const abiertos: { close(): void }[] = [];
// `listen` no es sincrono: el puerto se asigna despues, asi que `address()` en la
// linea siguiente devuelve null y no un numero. Por eso esto es async y por eso
// hay que esperarlo antes de construir la url.
async function servir(): Promise<string> {
  const server = createServer((_peticion, respuesta) => respuesta.end('ok'));
  server.listen(0, '127.0.0.1');
  // Antes de esperar, no despues: si `once` falla, el servidor tiene que estar ya
  // en la lista o `afterEach` no lo cierra y la prueba siguiente encuentra el
  // puerto cogido.
  abiertos.push(server);
  await once(server, 'listening');
  const puerto = (server.address() as { port: number }).port;
  return `http://127.0.0.1:${puerto}/`;
}
afterEach(() => {
  for (const s of abiertos.splice(0)) s.close();
});

describe('isListening', () => {
  it('es verdad cuando algo contesta', async () => {
    await expect(isListening(await servir())).resolves.toBe(true);
  });

  it('es falso cuando el puerto esta cerrado, y no lanza', async () => {
    await expect(isListening('http://127.0.0.1:1/')).resolves.toBe(false);
  });
});

describe('waitForHttp', () => {
  it('da por buena una url que ya responde', async () => {
    await expect(waitForHttp(await servir(), { timeoutMs: 2000 })).resolves.toBe(true);
  });

  it('devuelve falso, en vez de lanzar, cuando se agota el tiempo', async () => {
    // El arranque de Metro falla asi. Que devuelva falso deja que ensureService
    // tire el error con el log delante, que es lo que hace falta para diagnosticar.
    await expect(waitForHttp('http://127.0.0.1:1/', { timeoutMs: 600, intervalMs: 100 })).resolves.toBe(false);
  });
});