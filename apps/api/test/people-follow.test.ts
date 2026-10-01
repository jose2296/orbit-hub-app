import { randomUUID } from 'node:crypto';
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

const buscar = async (token: string, q: string) =>
  api.get(`/people/search?q=${encodeURIComponent(q)}`, token);

const seguir = async (token: string, id: string) =>
  api.post(`/people/${id}/follow`, {}, token);

const dejar = async (token: string, id: string) =>
  api.delete(`/people/${id}/follow`, token);

const directorio = async (token: string) => (await api.get('/people', token)).body?.data?.items ?? [];

const esDe = (items: { user: { email: string }; relations: string[] }[], email: string) =>
  items.find((p) => p.user.email === email);

/**
 * Following somebody, and looking them up in order to do it.
 *
 * This is the one place the app reads the accounts table, and the tests below are
 * mostly about **where it stops**: two letters, a stranger, yourself. A search that
 * lists is the thing ADR 0032 was written against, and a test that only checked
 * "it finds Marta" would pass just as happily on a version that returns everybody.
 */
describe('seguir a alguien', () => {
  it('busca por correo y lo anade al directorio', async () => {
    const yo = await createVerifiedUser(api, { displayName: 'Yo' });
    const otra = await createVerifiedUser(api, { displayName: 'Marta' });

    const r = await buscar(yo.accessToken, otra.email);
    expect(r.status).toBe(200);
    const items = r.body?.data?.items ?? [];
    expect(items.some((p: { user: { email: string } }) => p.user.email === otra.email)).toBe(true);

    expect((await seguir(yo.accessToken, otra.userId)).status).toBe(200);

    const mio = await directorio(yo.accessToken);
    const fila = esDe(mio, otra.email);
    expect(fila).toBeTruthy();
    expect(fila?.relations).toContain('followed');
  });

  it('busca por nombre, y por el nombre de su correo sin el dominio', async () => {
    const yo = await createVerifiedUser(api, { displayName: 'Yo' });
    const otra = await createVerifiedUser(api, { displayName: 'Marta Ruiz' });

    // "Marta Ruiz" is enough; the second one is the local part on its own, which is
    // what somebody types when they remember the name but not the company domain.
    const porNombre = await buscar(yo.accessToken, 'Marta Ruiz');
    expect(
      (porNombre.body?.data?.items ?? []).some(
        (p: { user: { email: string } }) => p.user.email === otra.email,
      ),
    ).toBe(true);

    const local = otra.email.split('@')[0] ?? otra.email;
    const porLocal = await buscar(yo.accessToken, local);
    expect(
      (porLocal.body?.data?.items ?? []).some(
        (p: { user: { email: string } }) => p.user.email === otra.email,
      ),
    ).toBe(true);
  });

  it('con menos de tres letras no busca, y lo dice con un error de validacion', async () => {
    const yo = await createVerifiedUser(api, { displayName: 'Yo' });
    const r = await buscar(yo.accessToken, 'ab');
    // A validation error and not an empty list: "you typed two letters" and "nobody
    // matched" are different answers and the app draws them differently. Answering
    // 200 with zero rows would make the search look broken instead of guarded.
    expect(r.status).toBe(422);
  });

  it('no te ofrece a ti mismo', async () => {
    const yo = await createVerifiedUser(api, { displayName: 'Yo' });
    const r = await buscar(yo.accessToken, yo.email);
    expect(
      (r.body?.data?.items ?? []).some(
        (p: { user: { email: string } }) => p.user.email === yo.email,
      ),
    ).toBe(false);

    // Y seguirte a ti mismo es un no-op, no un 500 por el CHECK de la tabla.
    const s = await seguir(yo.accessToken, yo.userId);
    expect(s.status).toBe(200);
    expect(s.body?.data?.following).toBe(false);
  });

  it('no ofrece a quien ya esta en tu directorio', async () => {
    // Buscar a Marta para seguirla no debe devolverte tambien a la Carla que ya
    // tienes: la fila necesitaria un boton que no aplica a ella.
    const yo = await createVerifiedUser(api, { displayName: 'Yo' });
    const carla = await createVerifiedUser(api, { displayName: 'Carla' });

    await seguir(yo.accessToken, carla.userId);

    const r = await buscar(yo.accessToken, carla.email);
    expect(
      (r.body?.data?.items ?? []).some(
        (p: { user: { email: string } }) => p.user.email === carla.email,
      ),
    ).toBe(false);
  });

  it('seguir dos veces es lo mismo que seguir una, no un error', async () => {
    const yo = await createVerifiedUser(api, { displayName: 'Yo' });
    const otra = await createVerifiedUser(api, { displayName: 'Marta' });

    const uno = await seguir(yo.accessToken, otra.userId);
    const dos = await seguir(yo.accessToken, otra.userId);
    // Un segundo toque en un boton no puede parecer un fallo. El indice unico del
    // par es lo que lo hace un no-op en vez de una fila mas.
    expect(uno.status).toBe(200);
    expect(dos.status).toBe(200);
    expect(dos.body?.data?.following).toBe(true);

    const mio = await directorio(yo.accessToken);
    expect(mio.filter((p: { user: { email: string } }) => p.user.email === otra.email)).toHaveLength(1);
  });

  it('dejar de seguir saca a la persona del directorio', async () => {
    const yo = await createVerifiedUser(api, { displayName: 'Yo' });
    const otra = await createVerifiedUser(api, { displayName: 'Marta' });

    await seguir(yo.accessToken, otra.userId);
    expect(esDe(await directorio(yo.accessToken), otra.email)).toBeTruthy();

    await dejar(yo.accessToken, otra.userId);
    // Y vuelve a poder buscarse, que es la otra mitad de "ya no esta en tu gente".
    expect(esDe(await directorio(yo.accessToken), otra.email)).toBeFalsy();
    const r = await buscar(yo.accessToken, otra.email);
    expect(
      (r.body?.data?.items ?? []).some(
        (p: { user: { email: string } }) => p.user.email === otra.email,
      ),
    ).toBe(true);
  });

  it('seguir es en una sola direccion y no le dice nada a la otra persona', async () => {
    // La fila es unilateral a proposito: no hay bandeja de avisos dentro de la app,
    // asi que una "solicitud" seria una solicitud que nadie ve. Y la otra persona no
    // gana nada: su directorio no cambia.
    const yo = await createVerifiedUser(api, { displayName: 'Yo' });
    const otra = await createVerifiedUser(api, { displayName: 'Marta' });

    await seguir(yo.accessToken, otra.userId);

    expect(esDe(await directorio(yo.accessToken), otra.email)).toBeTruthy();
    expect(esDe(await directorio(otra.accessToken), yo.email)).toBeFalsy();
  });

  it('no se puede seguir a alguien que no existe', async () => {
    const yo = await createVerifiedUser(api, { displayName: 'Yo' });
    const r = await seguir(yo.accessToken, randomUUID());
    expect(r.status).toBe(200);
    expect(r.body?.data?.following).toBe(false);
  });

  it('buscar pide sesion', async () => {
    const sinToken = await api.get('/people/search?q=alguien');
    expect(sinToken.status).toBe(401);
  });

  it('la cuenta que desaparece no se puede seguir', async () => {
    const yo = await createVerifiedUser(api, { displayName: 'Yo' });
    const otra = await createVerifiedUser(api, { displayName: 'Marta' });
    await seguir(yo.accessToken, otra.userId);

    // Una cuenta borrada es un tombstone, no una fila que desaparece: seguirla y
    // buscarla tienen que dejar de encontrar a alguien que ya no esta.
    const { getDatabase } = await import('../src/db/client.js');
    const { users } = await import('../src/db/auth-schema.js');
    const { eq } = await import('drizzle-orm');
    const { db } = await getDatabase();
    await db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, otra.userId));

    const r = await buscar(yo.accessToken, otra.email);
    expect(
      (r.body?.data?.items ?? []).some(
        (p: { user: { email: string } }) => p.user.email === otra.email,
      ),
    ).toBe(false);

    const mio = await directorio(yo.accessToken);
    expect(esDe(mio, otra.email)).toBeFalsy();
  });
});