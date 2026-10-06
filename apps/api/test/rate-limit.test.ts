import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it } from 'vitest';

import { createRateLimiter } from '../src/middleware/rate-limit.js';

/**
 * The limiter is unit tested with a tiny window: the integration suite runs
 * every request from the same IP and would throttle itself.
 */
function fakeRequest(ip: string, body: unknown = {}): Request {
  return {
    ip,
    body,
    header: () => undefined,
    socket: { remoteAddress: ip },
  } as unknown as Request;
}

/** Lo que el limitador necesita de una respuesta, más cómo termina esta. */
interface FakeResponse extends Response {
  headers: Record<string, string>;
  /** Termina la respuesta con este estado y dispara lo que escuchaba. */
  finishWith(statusCode: number): void;
}

function fakeResponse(): FakeResponse {
  const headers: Record<string, string> = {};
  // Los oyentes del `finish`, porque un limitador que solo cobra los errores del
  // cliente devuelve el presupuesto cuando la respuesta no es un rechazo, y eso
  // se entera escuchando el final de la respuesta — igual que en el servidor.
  const listeners = new Map<string, Array<() => void>>();
  const res = {
    headers,
    statusCode: 200,
    setHeader(key: string, value: string) {
      headers[key] = value;
    },
    on(event: string, handler: () => void) {
      const current = listeners.get(event) ?? [];
      current.push(handler);
      listeners.set(event, current);
      return res;
    },
    finishWith(statusCode: number) {
      res.statusCode = statusCode;
      for (const handler of listeners.get('finish') ?? []) handler();
    },
    status() {
      return res;
    },
    json() {
      return res;
    },
    end() {
      return res;
    },
  };
  return res as unknown as FakeResponse;
}

function run(
  limiter: ReturnType<typeof createRateLimiter>,
  req: Request,
  res: Response = fakeResponse(),
): { status: number | null; error: unknown; res: Response } {
  let status: number | null = null;
  let error: unknown = null;

  const next: NextFunction = (err?: unknown) => {
    if (err) {
      error = err;
      status = (err as { status?: number }).status ?? null;
    }
  };

  limiter(req, res, next);
  return { status, error, res };
}

/** Un intento que el servidor contesta con este estado. */
function intento(
  limiter: ReturnType<typeof createRateLimiter>,
  req: Request,
  statusCode: number,
): number | null {
  const res = fakeResponse();
  const { status } = run(limiter, req, res);
  res.finishWith(statusCode);
  return status;
}

describe('createRateLimiter', () => {
  it('lets the first requests through and blocks the rest', () => {
    const limiter = createRateLimiter({
      name: 'test',
      windowMs: 60_000,
      max: 3,
      keyFn: (req) => req.ip ?? 'unknown',
    });

    const req = fakeRequest('10.0.0.1');

    expect(run(limiter, req).status).toBeNull();
    expect(run(limiter, req).status).toBeNull();
    expect(run(limiter, req).status).toBeNull();

    const blocked = run(limiter, req);
    expect(blocked.status).toBe(429);
    expect((blocked.error as { code: string }).code).toBe('rate_limited');
  });

  it('counts each key separately', () => {
    const limiter = createRateLimiter({
      name: 'test-keys',
      windowMs: 60_000,
      max: 1,
      keyFn: (req) => req.ip ?? 'unknown',
    });

    expect(run(limiter, fakeRequest('10.0.0.1')).status).toBeNull();
    expect(run(limiter, fakeRequest('10.0.0.2')).status).toBeNull();
    expect(run(limiter, fakeRequest('10.0.0.1')).status).toBe(429);
  });

  it('can key on the request body, as the account limiter does', () => {
    const limiter = createRateLimiter({
      name: 'test-body',
      windowMs: 60_000,
      max: 1,
      keyFn: (req) => String((req.body as { email?: string }).email ?? 'none'),
    });

    expect(run(limiter, fakeRequest('10.0.0.1', { email: 'a@example.com' })).status).toBeNull();
    expect(run(limiter, fakeRequest('10.0.0.1', { email: 'b@example.com' })).status).toBeNull();
    expect(run(limiter, fakeRequest('10.0.0.1', { email: 'a@example.com' })).status).toBe(429);
  });

  it('sets Retry-After when it blocks', () => {
    const limiter = createRateLimiter({
      name: 'test-headers',
      windowMs: 60_000,
      max: 1,
      keyFn: () => 'same',
    });

    const req = fakeRequest('10.0.0.3');
    run(limiter, req);

    const res = fakeResponse();
    limiter(req, res, () => undefined);
    expect(Number(res.headers['Retry-After'])).toBeGreaterThan(0);
  });

  it('resets after the window', async () => {
    const limiter = createRateLimiter({
      name: 'test-window',
      windowMs: 30,
      max: 1,
      keyFn: () => 'window',
    });

    const req = fakeRequest('10.0.0.4');
    expect(run(limiter, req).status).toBeNull();
    expect(run(limiter, req).status).toBe(429);

    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(run(limiter, req).status).toBeNull();
  });
});

/**
 * El límite por cuenta, que es el que muerde.
 *
 * Existe para que nadie pruebe contraseñas contra **una** cuenta. Contar los
 * intentos que **acaban bien** no frena a nadie: un atacante no coincide nunca.
 * Lo que hace es cerrarle la puerta a una persona que entra cinco veces en un
 * cuarto de hora, y encima dice `rate_limited` como si hubiera alguien probando
 * contraseñas — que es justo lo que la persona va a pensar.
 *
 * El presupuesto se gasta con lo que el servidor le **rechaza al cliente** y se
 * devuelve con lo demás. La resistencia contra un ataque no cambia: los cinco
 * intentos por ventana siguen siendo cinco. Lo que cambia es quién se queda sin
 * poder entrar.
 */
describe('un limitador que solo cobra los errores del cliente', () => {
  const soloErrores = (max: number) =>
    createRateLimiter({
      name: 'test-solo-errores',
      windowMs: 60_000,
      max,
      countOnlyClientErrors: true,
      keyFn: () => 'cuenta',
    });

  it('deja entrar las veces que quieras cuando aciertas', () => {
    const limiter = soloErrores(2);
    const req = fakeRequest('10.0.1.1', { email: 'a@example.com' });

    for (let i = 0; i < 25; i += 1) {
      expect(intento(limiter, req, 200), `intento ${i + 1}`).toBeNull();
    }
  });

  it('gasta el presupuesto con las contraseñas equivocadas', () => {
    const limiter = soloErrores(3);
    const req = fakeRequest('10.0.1.2', { email: 'b@example.com' });

    expect(intento(limiter, req, 401)).toBeNull();
    expect(intento(limiter, req, 401)).toBeNull();
    expect(intento(limiter, req, 401)).toBeNull();
    expect(intento(limiter, req, 401)).toBe(429);
  });

  it('el primer fallo de la ventana cuenta, y no se CUENTA de más', () => {
    // El cubo nace con la primera petición y esa tiene que quedar dentro del
    // presupuesto igual que las demás. Una implementación que reembolse el primer
    // intento sin mirar el estado permite `max + 1` intentos, que es un límite
    // que no dice lo que dice.
    const limiter = soloErrores(2);
    const req = fakeRequest('10.0.1.7', { email: 'g@example.com' });

    expect(intento(limiter, req, 401)).toBeNull();
    expect(intento(limiter, req, 401)).toBeNull();
    expect(intento(limiter, req, 401)).toBe(429);
  });

  it('un acierto en medio no le devuelve el presupuesto al que va fallando', () => {
    // El que prueba cinco veces y una de ellas acierta no puede seguir: el acierto
    // devuelve su unidad, pero los cuatro fallos siguen gastados.
    const limiter = soloErrores(3);
    const req = fakeRequest('10.0.1.3', { email: 'c@example.com' });

    intento(limiter, req, 401);
    intento(limiter, req, 401);
    intento(limiter, req, 200);
    expect(intento(limiter, req, 401)).toBeNull();
    expect(intento(limiter, req, 401)).toBe(429);
  });

  it('una caída del servidor no gasta el presupuesto de nadie', () => {
    // Un 5xx es culpa del servidor y no dice nada de una contraseña. Si gastara,
    // una sola caída vaciaría el presupuesto de todas las cuentas y la siguiente
    // persona normal se encontraría la puerta cerrada sin poder entender por qué.
    const limiter = soloErrores(2);
    const req = fakeRequest('10.0.1.4', { email: 'd@example.com' });

    for (let i = 0; i < 10; i += 1) {
      expect(intento(limiter, req, 500), `intento ${i + 1}`).toBeNull();
    }
  });

  it('un cuerpo mal formado se cuenta, porque también es un intento', () => {
    const limiter = soloErrores(2);
    const req = fakeRequest('10.0.1.6', { email: 'f@example.com' });

    expect(intento(limiter, req, 400)).toBeNull();
    expect(intento(limiter, req, 400)).toBeNull();
    expect(intento(limiter, req, 400)).toBe(429);
  });

  it('no cuenta un fallo mientras la respuesta sigue en vuelo', () => {
    // Se cuenta al entrar y se devuelve al salir: si no, un ataque con peticiones
    // concurrentes pasaría sin gastar nada.
    const limiter = soloErrores(2);
    const req = fakeRequest('10.0.1.5', { email: 'e@example.com' });

    expect(run(limiter, req, fakeResponse()).status).toBeNull();
    expect(run(limiter, req, fakeResponse()).status).toBeNull();
    // Las dos siguen en vuelo: la tercera tiene que entrar todavía.
    expect(run(limiter, req, fakeResponse()).status).toBe(429);
  });

  it('el 429 del propio limitador no gasta nada, porque nunca gastó', () => {
    const limiter = soloErrores(2);
    const req = fakeRequest('10.0.1.8', { email: 'h@example.com' });

    intento(limiter, req, 401);
    intento(limiter, req, 401);
    // Bloqueado tres veces seguidas, con el cubo lleno, y sigue lleno.
    for (let i = 0; i < 5; i += 1) {
      const res = fakeResponse();
      expect(run(limiter, req, res).status, `bloqueo ${i + 1}`).toBe(429);
      res.finishWith(429);
    }
    // Y en cuanto la ventana se acaba, entra otra vez: un 429 no alarga el castigo.
    expect(intento(limiter, req, 401), 'despues del bloqueo').toBe(429);
  });

  it('un limitador normal sigue contando los aciertos', () => {
    // El límite por IP es un guardián de inundación y cuenta todo. Este test
    // dice que el arreglo no se ha derramado al otro limitador.
    const limiter = createRateLimiter({
      name: 'test-todo',
      windowMs: 60_000,
      max: 2,
      keyFn: () => 'ip',
    });
    const req = fakeRequest('10.0.1.9');

    expect(intento(limiter, req, 200)).toBeNull();
    expect(intento(limiter, req, 200)).toBeNull();
    expect(intento(limiter, req, 200)).toBe(429);
  });
});
