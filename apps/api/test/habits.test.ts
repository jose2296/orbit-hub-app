import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createVerifiedUser, startTestServer } from './helpers';
import type { TestServer } from './helpers';

let api: TestServer;

beforeAll(async () => {
  api = await startTestServer();
});

afterAll(async () => {
  await api.close();
});

/**
 * Un lunes programado y nada mas: `BYDAY=MO` deja al jueves fuera, que es
 * justo el dia que los tests de disciplina intentan marcar.
 */
const LUNES = '2026-03-02';
const JUEVES = '2026-03-05';

async function crearHabito(token: string, extra: Record<string, unknown> = {}) {
  const r = await api.post(
    '/habits',
    {
      name: 'Leer',
      schedule: { kind: 'rrule', rule: 'FREQ=WEEKLY;BYDAY=MO' },
      timezone: 'Europe/Madrid',
      startDate: LUNES,
      ...extra,
    },
    token,
  );
  expect(r.status).toBe(201);
  return r.body.data;
}

const marcar = (token: string, habitId: string, body: unknown) =>
  api.post(`/habits/${habitId}/entries`, body, token);

/**
 * El servicio y las rutas de habitos.
 *
 * La autorizacion es del servidor: el cliente no es una frontera de seguridad,
 * asi que cada ruta solo ve los habitos del que llama y todo lo demas es 404.
 * Y la disciplina es dura: un dia no programado, futuro o anterior al inicio
 * se rechaza con 422, y el mensaje nombra el proximo dia para que no parezca
 * un bug sino una cita ("el lunes te toca").
 */
describe('habitos', () => {
  it('crea y lista con su resumen', async () => {
    const yo = await createVerifiedUser(api);
    const creado = await crearHabito(yo.accessToken);

    const lista = await api.get('/habits', yo.accessToken);
    expect(lista.status).toBe(200);
    const items = lista.body.data.items;
    expect(items).toHaveLength(1);
    // La proyeccion de resumen: el habito mas sus entradas, con lo que el
    // movil calcula el estado de hoy sin pedir mas.
    expect(items[0].habit.id).toBe(creado.id);
    expect(items[0].entries).toEqual([]);
  });

  it('el habito de otra persona es 404, no 403', async () => {
    const yo = await createVerifiedUser(api);
    const otra = await createVerifiedUser(api);
    const suyo = await crearHabito(otra.accessToken);

    // 404 y no 403: confirmar que existe ya dice que existe.
    const r = await marcar(yo.accessToken, suyo.id, { date: LUNES, status: 'done' });
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('not_found');
  });

  it('no se puede registrar un dia que no estaba programado', async () => {
    const yo = await createVerifiedUser(api);
    const habito = await crearHabito(yo.accessToken);

    const r = await marcar(yo.accessToken, habito.id, { date: JUEVES, status: 'done' });
    expect(r.status).toBe(422);
    // El mensaje NOMBRA el proximo dia: es una cita, no un muro.
    expect(r.body.error.message).toContain('lunes');
  });

  it('no se puede registrar en el futuro', async () => {
    const yo = await createVerifiedUser(api);
    const habito = await crearHabito(yo.accessToken, {
      schedule: { kind: 'rrule', rule: 'FREQ=DAILY' },
    });

    const r = await marcar(yo.accessToken, habito.id, { date: '2099-06-01', status: 'done' });
    expect(r.status).toBe(422);
  });

  it('no se puede registrar antes de startDate', async () => {
    const yo = await createVerifiedUser(api);
    const habito = await crearHabito(yo.accessToken);

    const r = await marcar(yo.accessToken, habito.id, { date: '2026-02-23', status: 'done' });
    expect(r.status).toBe(422);
  });

  it('skipped solo en un dia programado', async () => {
    const yo = await createVerifiedUser(api);
    const habito = await crearHabito(yo.accessToken);

    const malo = await marcar(yo.accessToken, habito.id, { date: JUEVES, status: 'skipped' });
    expect(malo.status).toBe(422);

    const bueno = await marcar(yo.accessToken, habito.id, { date: LUNES, status: 'skipped' });
    expect(bueno.status).toBe(200);
    expect(bueno.body.data.status).toBe('skipped');
  });

  it('en una cuota se puede marcar cualquier dia de la semana', async () => {
    const yo = await createVerifiedUser(api);
    // El lunes de la semana en curso en Madrid: siempre pasado o hoy, nunca
    // futuro, y siempre dentro del periodo abierto.
    const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date());
    const dia = new Date(`${hoy}T12:00:00Z`);
    const atraso = (dia.getUTCDay() + 6) % 7;
    dia.setUTCDate(dia.getUTCDate() - atraso);
    const lunes = dia.toISOString().slice(0, 10);
    const habito = await crearHabito(yo.accessToken, {
      schedule: { kind: 'quota', count: 3, period: 'week' },
      startDate: lunes,
    });

    const dias = [lunes];
    const miercoles = new Date(`${lunes}T12:00:00Z`);
    miercoles.setUTCDate(miercoles.getUTCDate() + 2);
    const miercolesTexto = miercoles.toISOString().slice(0, 10);
    if (miercolesTexto <= hoy) dias.push(miercolesTexto);

    for (const fecha of dias) {
      const r = await marcar(yo.accessToken, habito.id, { date: fecha, status: 'done' });
      expect(r.status).toBe(200);
    }

    const entradas = await api.get(
      `/habits/${habito.id}/entries?from=${lunes}&to=${hoy}`,
      yo.accessToken,
    );
    expect(entradas.status).toBe(200);
    expect(entradas.body.data.items).toHaveLength(dias.length);
  });

  it('marcar dos veces el mismo dia no acumula', async () => {
    const yo = await createVerifiedUser(api);
    const habito = await crearHabito(yo.accessToken);

    expect((await marcar(yo.accessToken, habito.id, { date: LUNES, status: 'done' })).status).toBe(
      200,
    );
    const segunda = await marcar(yo.accessToken, habito.id, {
      date: LUNES,
      status: 'done',
      note: 'otra vez',
    });
    expect(segunda.status).toBe(200);

    // Un dia cuenta una vez: el UNIQUE (habito, dia) es la regla.
    const entradas = await api.get(
      `/habits/${habito.id}/entries?from=${LUNES}&to=${JUEVES}`,
      yo.accessToken,
    );
    expect(entradas.body.data.items).toHaveLength(1);
    expect(entradas.body.data.items[0].note).toBe('otra vez');
  });

  it('checkIn devuelve 200 y solo la entrada', async () => {
    const yo = await createVerifiedUser(api);
    const habito = await crearHabito(yo.accessToken);

    const r = await marcar(yo.accessToken, habito.id, {
      date: LUNES,
      status: 'done',
      amount: 2,
      note: 'capitulo 3',
    });
    expect(r.status).toBe(200);
    // Solo la entrada recien escrita: el resumen lo recalcula el movil con
    // progressForPeriod, y dos fuentes para el mismo numero es un bug.
    expect(Object.keys(r.body.data).sort()).toEqual(
      ['amount', 'date', 'habitId', 'note', 'status', 'version'].sort(),
    );
    expect(r.body.data).toMatchObject({
      habitId: habito.id,
      date: LUNES,
      status: 'done',
      amount: 2,
      note: 'capitulo 3',
    });
  });

  it('archivar esconde y el include lo trae de vuelta', async () => {
    const yo = await createVerifiedUser(api);
    const habito = await crearHabito(yo.accessToken);

    expect((await api.post(`/habits/${habito.id}/archive`, {}, yo.accessToken)).status).toBe(200);
    expect((await api.get('/habits', yo.accessToken)).body.data.items).toHaveLength(0);

    const conArchivo = await api.get('/habits?include=archived', yo.accessToken);
    expect(conArchivo.status).toBe(200);
    expect(conArchivo.body.data.items).toHaveLength(1);

    expect((await api.post(`/habits/${habito.id}/unarchive`, {}, yo.accessToken)).status).toBe(
      200,
    );
    expect((await api.get('/habits', yo.accessToken)).body.data.items).toHaveLength(1);
  });

  it('borrar es logico y despues es 404', async () => {
    const yo = await createVerifiedUser(api);
    const habito = await crearHabito(yo.accessToken);

    expect((await api.delete(`/habits/${habito.id}`, yo.accessToken)).status).toBe(204);
    expect((await api.get('/habits', yo.accessToken)).body.data.items).toHaveLength(0);
    expect(
      (await marcar(yo.accessToken, habito.id, { date: LUNES, status: 'done' })).status,
    ).toBe(404);
  });

  it('la entrada se edita y se desmarca', async () => {
    const yo = await createVerifiedUser(api);
    const habito = await crearHabito(yo.accessToken);
    await marcar(yo.accessToken, habito.id, { date: LUNES, status: 'done' });

    const editada = await api.patch(
      `/habits/${habito.id}/entries/${LUNES}`,
      { note: 'con lluvia' },
      yo.accessToken,
    );
    expect(editada.status).toBe(200);
    expect(editada.body.data.note).toBe('con lluvia');

    expect((await api.delete(`/habits/${habito.id}/entries/${LUNES}`, yo.accessToken)).status).toBe(
      204,
    );
    const entradas = await api.get(
      `/habits/${habito.id}/entries?from=${LUNES}&to=${JUEVES}`,
      yo.accessToken,
    );
    expect(entradas.body.data.items).toHaveLength(0);
  });

  it('una zona que no existe es 422 al crear', async () => {
    const yo = await createVerifiedUser(api);
    const r = await api.post(
      '/habits',
      {
        name: 'Leer',
        schedule: { kind: 'rrule', rule: 'FREQ=DAILY' },
        timezone: 'No/Existe',
        startDate: LUNES,
      },
      yo.accessToken,
    );
    expect(r.status).toBe(422);
  });

  it('sin sesion no hay habitos', async () => {
    expect((await api.get('/habits')).status).toBe(401);
  });
});
