import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

export type Seeded = {
  email: string;
  password: string;
  otherEmail: string;
  spaceName: string;
  listTitle: string;
  noteTitle: string;
  workspaceId: string;
  folderId: string;
  listId: string;
  noteId: string;
};

export const PASSWORD = 'Con-un-muy-largo-secreto-1';

/** Solo ASCII y sin acentos: los flujos afirman sobre estas cadenas, asi que
 *  tienen que sobrevivir a que se escriban en YAML sin una sorpresa de codificacion. */
export const NOMBRES = {
  spaceName: 'E2E Space',
  folderName: 'E2E Folder',
  listTitle: 'E2E List',
  noteTitle: 'E2E Note',
  otherUser: 'E2E Friend',
} as const;

/**
 * El token de verificacion de una direccion, sacado del log de la propia API.
 *
 * Pura a proposito: la regla que importa es que gana la ultima coincidencia, y
 * una funcion que solo se puede ejercitar contra un log de verdad dejaria esa
 * regla sin demostrar. Sin demostrar, una carrera acaba verificando una cuenta
 * con un token de la anterior, contra una base de datos que ya no lo tiene.
 */
export function verificationTokenFor(lineas: string[], email: string): string | null {
  const linea = lineas.filter((l) => l.includes(email) && l.includes('verify-email')).pop();
  return linea ? (/token=([A-Za-z0-9_-]+)/.exec(linea)?.[1] ?? null) : null;
}

async function call(
  api: string,
  ruta: string,
  init: { method?: string; body?: unknown; token?: string } = {},
): Promise<any> {
  const res = await fetch(`${api}${ruta}`, {
    method: init.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
    },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
  });
  const texto = await res.text();
  const json = texto ? JSON.parse(texto) : null;
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${ruta} -> ${res.status} ${texto}`);
  return json?.data ?? json;
}

/**
 * Espera a que el correo de verificacion aparezca en el log, con tope.
 *
 * La carrera es real: la API escribe el correo **despues** de contestar al
 * registro, asi que leer el log una vez falla de vez en cuando. Y hay un segundo
 * motivo con el mismo sintoma -este log no existe nunca- que es que la API ya
 * estaba en pie de antes de la carrera y su stdout esta en otro sitio; por eso el
 * error dice las dos cosas en vez de senalar solo `EMAIL_TRANSPORT`.
 *
 * Falla de golpe y con nombre, nunca devuelve un token a medias: una siembra que
 * se queda a medias deja fixtures a medio construir que hacen pasar unas
 * afirmaciones y fallar otras sin motivo.
 */
async function waitForToken(apiLog: string, email: string, timeoutMs = 15_000): Promise<string> {
  const limite = Date.now() + timeoutMs;
  for (;;) {
    let lineas: string[] = [];
    try {
      lineas = readFileSync(apiLog, 'utf8').split('\n');
    } catch {
      /* el log todavia no existe */
    }
    const token = verificationTokenFor(lineas, email);
    if (token) return token;
    if (Date.now() > limite) {
      throw new Error(
        `no llego el correo de verificacion de ${email} a ${apiLog}. ` +
          'La API tiene que arrancar con EMAIL_TRANSPORT=console escribiendo ahi; si ya ' +
          'estaba en pie de antes, su salida esta en otro log y ese es el motivo.',
      );
    }
    await new Promise((r) => setTimeout(r, 400));
  }
}

async function registrar(api: string, nombre: string, apiLog: string) {
  const email = `e2e-${nombre.toLowerCase().replace(/\s+/g, '-')}-${randomUUID().slice(0, 8)}@example.com`;
  await call(api, '/auth/register', {
    method: 'POST',
    body: {
      email,
      password: PASSWORD,
      displayName: nombre,
      acceptedTermsAt: new Date().toISOString(),
      device: { label: 'E2E', platform: 'web' },
    },
  });
  await call(api, '/auth/verify-email', {
    method: 'POST',
    body: { token: await waitForToken(apiLog, email) },
  });
  const sesion = await call(api, '/auth/login', {
    method: 'POST',
    body: { email, password: PASSWORD, device: { label: 'E2E', platform: 'web' } },
  });
  if (sesion.status !== 'authenticated') {
    throw new Error(`el login de ${email} respondio ${JSON.stringify(sesion)}`);
  }
  return {
    email,
    token: sesion.session.accessToken as string,
    userId: (await call(api, '/auth/me', { token: sesion.session.accessToken })).id as string,
  };
}

/**
 * Una operacion por push, y cada una comprobada.
 *
 * En lote, una operacion rechazada vuelve con HTTP 200 y `status: "rejected"`, y
 * una siembra que se queda con el codigo de respuesta se pasa de largo por una
 * nota que no existe y falla tres pasos mas tarde, compartiendo algo que no esta.
 * Comprobado tambien leyendo la base despues: seis pushes, seis filas.
 */
async function push(
  api: string,
  token: string,
  deviceId: string,
  operacion: { kind: string; entity: string; entityId: string; payload: Record<string, unknown> },
): Promise<void> {
  const r = await call(api, '/sync/push', {
    method: 'POST',
    token,
    body: {
      deviceId,
      lastPulledAt: null,
      operations: [
        {
          operationId: randomUUID(),
          clientId: 'e2e-seed',
          baseVersion: 0,
          clientTimestamp: new Date().toISOString(),
          // El payload no lleva valor por defecto a proposito: viene en
          // `operacion` y siempre lo pisa, asi que un `{}` aqui seria un default
          // que no puede llegar a enviarse nunca, y TS2783 lo delata.
          ...operacion,
        },
      ],
    },
  });
  const resultado = r.results?.[0];
  if (resultado?.status !== 'applied') {
    throw new Error(`no se pudo crear ${operacion.entity} ${operacion.entityId}: ${JSON.stringify(resultado)}`);
  }
}

export async function seed(options: { api: string; apiLog: string }): Promise<Seeded> {
  const { api, apiLog } = options;
  const ana = await registrar(api, 'ana', apiLog);
  const amigo = await registrar(api, NOMBRES.otherUser, apiLog);

  const workspaceId = randomUUID();
  const folderId = randomUUID();
  const listId = randomUUID();
  const noteId = randomUUID();

  await push(api, ana.token, ana.userId, {
    kind: 'create',
    entity: 'workspace',
    entityId: workspaceId,
    payload: { name: NOMBRES.spaceName, color: 'teal' },
  });
  await push(api, ana.token, ana.userId, {
    kind: 'create',
    entity: 'folder',
    entityId: folderId,
    payload: { workspaceId, name: NOMBRES.folderName, position: 0 },
  });
  await push(api, ana.token, ana.userId, {
    kind: 'create',
    entity: 'note',
    entityId: noteId,
    payload: {
      workspaceId,
      folderId: null,
      title: NOMBRES.noteTitle,
      document: '<p>E2E body.</p>',
      tags: [],
    },
  });
  await push(api, ana.token, ana.userId, {
    kind: 'create',
    entity: 'list',
    entityId: listId,
    payload: { workspaceId, folderId, title: NOMBRES.listTitle, kind: 'tasks', position: 0 },
  });
  for (const [indice, titulo] of ['E2E Item One', 'E2E Item Two'].entries()) {
    await push(api, ana.token, ana.userId, {
      kind: 'create',
      entity: 'list_item',
      entityId: randomUUID(),
      payload: { listId, title: titulo, position: indice },
    });
  }

  // La segunda cuenta no es adorno, y conviene saber exactamente que es lo que
  // aporta: `/people` de Ana trae una fila real, y el compartido cae en la
  // bandeja del amigo. La bandeja de Ana sigue vacia, y no hay invitacion de
  // espacio -comprobado leyendo la base-, asi que `shared` e `invitations` se
  // recorren vacias si el recorrido entra con `email`. Para un inbox con algo y
  // una invitacion esta `scripts/seed-people.mjs`.
  await call(api, '/shares', {
    method: 'POST',
    token: ana.token,
    body: { nodeType: 'note', nodeId: noteId, granteeUserId: amigo.userId, role: 'editor' },
  });

  return {
    email: ana.email,
    password: PASSWORD,
    otherEmail: amigo.email,
    spaceName: NOMBRES.spaceName,
    listTitle: NOMBRES.listTitle,
    noteTitle: NOMBRES.noteTitle,
    workspaceId,
    folderId,
    listId,
    noteId,
  };
}

export function writeSeedEnv(archivo: string, sembrado: Seeded): void {
  const cuerpo = Object.entries(sembrado)
    .map(([clave, valor]) => `${clave}: "${valor}"`)
    .join('\n');
  writeFileSync(archivo, `${cuerpo}\n`, 'utf8');
}