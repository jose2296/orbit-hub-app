import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

export type Seeded = {
  email: string;
  password: string;
  displayName: string;
  otherEmail: string;
  otherDisplayName: string;
  spaceName: string;
  friendSpaceName: string;
  folderName: string;
  listTitle: string;
  noteTitle: string;
  friendNoteTitle: string;
  firstItemTitle: string;
  secondItemTitle: string;
  workspaceId: string;
  folderId: string;
  listId: string;
  noteId: string;
  friendSpaceId: string;
  friendNoteId: string;
};

export const PASSWORD = 'Con-un-muy-largo-secreto-1';

/** Solo ASCII y sin acentos: los flujos afirman sobre estas cadenas, asi que
 *  tienen que sobrevivir a que se escriban en YAML sin una sorpresa de codificacion. */
export const NOMBRES = {
  ana: 'E2E Ana',
  otherUser: 'E2E Friend',
  spaceName: 'E2E Space',
  friendSpaceName: 'E2E Friend Space',
  friendNoteTitle: 'E2E Friend Note',
  folderName: 'E2E Folder',
  listTitle: 'E2E List',
  noteTitle: 'E2E Note',
  items: ['E2E Item One', 'E2E Item Two'],
} as const;

/**
 * El token de verificacion de una direccion, sacado del log de la propia API.
 *
 * Pura a proposito: la regla que importa es que gana la ultima coincidencia, y
 * una funcion que solo se puede ejercitar contra un log de verdad dejaria esa
 * regla sin demostrar. Sin demostrar, una carrera acaba verificando una cuenta
 * con un token de la anterior, contra una base de datos que ya no lo tiene.
 *
 * Las dos clausulas del filtro tienen su caso propio y en el orden que las hace
 * fallar: una linea ajena al final, y una linea de Ana que no es la
 * verificacion. Sin esos dos casos el filtro se puede borrar entero y la
 * suite sigue en verde.
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
  // El prefijo `e2e-` sale del nombre, y los nombres llevan `E2E` delante, asi
  // que la direccion sale `e2e-e2e-ana-<uuid>@example.com`. No es bonito y es a
  // proposito: un flujo que necesite la direccion del amigo la lee de
  // `otherEmail`, porque reconstruirla a mano es una forma de romperse el dia
  // que el nombre cambie.
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
 * Cada fila se ha vuelto a leer de la base con un proceso aparte; los codigos de
 * respuesta no dicen nada de eso.
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
          // Ocho caracteres, el minimo de `clientId` en el contrato, y validados
          // uno a uno en `sync-service.ts` con `safeParse`: uno menos y cada
          // operacion vuelve con HTTP 200 y `status: "rejected"`, que es
          // precisamente la trampa que esta siembra existe para no pisar.
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
  const ana = await registrar(api, NOMBRES.ana, apiLog);
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
  for (const [indice, titulo] of NOMBRES.items.entries()) {
    await push(api, ana.token, ana.userId, {
      kind: 'create',
      entity: 'list_item',
      entityId: randomUUID(),
      payload: { listId, title: titulo, position: indice },
    });
  }

  await call(api, '/shares', {
    method: 'POST',
    token: ana.token,
    body: { nodeType: 'note', nodeId: noteId, granteeUserId: amigo.userId, role: 'editor' },
  });

  /*
   * Y ahora al reves, que es lo que faltaba: con la siembra anterior las tres
   * pantallas que dependen de otra persona se recorrian vacias para la cuenta
   * con la que entra el arnes. Una pantalla vacia renderiza -que es justo por lo
   * que esta siembra existe-, asi que un recorrido que solo mira vacias no
   * encuentra la mitad de los fallos.
   *
   * El amigo necesita un espacio propio para poder compartir algo: una cuenta
   * que solo recibe no puede devolver nada.
   */
  const friendSpaceId = randomUUID();
  await push(api, amigo.token, amigo.userId, {
    kind: 'create',
    entity: 'workspace',
    entityId: friendSpaceId,
    payload: { name: NOMBRES.friendSpaceName, color: 'purple' },
  });

  /*
   * Y una nota DENTRO de ese espacio, porque lo que se comparte a Ana tiene que
   * ser algo que se pueda colocar.
   *
   * Medido, no supuesto: compartir el espacio entero deja la `inbox` de Ana a cero.
   * `share-service.ts` excluye los espacios de `inbox` a proposito -"un espacio no
   * se coloca dentro de otro"-, y la `inbox` es la lista con la que se trabaja: es
   * la que ofrece "poner esto en un espacio mio". Compartir solo el espacio deja la
   * pantalla a medias, con la fila de "ha llegado" y sin ninguna que colocar.
   */
  const friendNoteId = randomUUID();
  await push(api, amigo.token, amigo.userId, {
    kind: 'create',
    entity: 'note',
    entityId: friendNoteId,
    payload: {
      workspaceId: friendSpaceId,
      folderId: null,
      title: NOMBRES.friendNoteTitle,
      document: '<p>E2E body from the friend.</p>',
      tags: [],
    },
  });

  await call(api, '/shares', {
    method: 'POST',
    token: amigo.token,
    body: {
      nodeType: 'note',
      nodeId: friendNoteId,
      granteeUserId: ana.userId,
      role: 'editor',
    },
  });

  /*
   * La invitacion se deja SIN ACEPTAR a proposito, y no por descuido.
   * `invitation-service.ts` la lista con `status = "pending"`, asi que aceptarla
   * devuelve `invitations` a cero y deja la pantalla igual de vacia de lo que
   * estaba. Ademas el filtro de `listForCaller` exige que la persona no sea ya
   * miembro, y aceptarla la convierte en miembro: las dos cosas van juntas y por
   * eso el orden es este.
   */
  await call(api, `/workspaces/${friendSpaceId}/invitations`, {
    method: 'POST',
    token: amigo.token,
    body: { role: 'editor', email: ana.email },
  });

  /*
   * Que ve cada pantalla, con cada cuenta, medido y no supuesto. Las dos cuentas
   * entran con la MISMA `password`; `otherEmail` es para el flujo que quiera
   * mirar la bandeja del amigo.
   *
   *   people      -> Ana: 1 (E2E Friend, shared_by + shared_with); amigo: 1 (E2E Ana, las dos)
   *   shared      -> Ana: inbox 1 (E2E Friend Note) + incoming 1 (la misma)
   *                amigo: inbox 1 (E2E Note) + incoming 1 (la misma)
   *   invitations -> Ana: 1 pendiente (E2E Friend Space, editor); amigo: 0
   *
   * `incoming` trae la misma fila que `inbox` y no otra: es la misma concesion
   * vista por los dos lados, y el enlace de aviso no distingue. Las dos cuentas
   * salen con la suya porque cada una tiene algo suyo que enviar.
   *
   * La invitacion de Ana esta SIN ACEPTAR a proposito: `invitations` la lista con
   * `status = "pending"`, asi que aceptarla devuelve la pantalla a cero.
   *
   * Cambiar cualquier fila de aqui obliga a cambiar el contrato de `Seeded`.
   * Estan medidas leyendo las filas con un proceso aparte, no contando
   * respuestas 200: un 200 no dice si la fila existe.
   */
  return {
    email: ana.email,
    password: PASSWORD,
    displayName: NOMBRES.ana,
    otherEmail: amigo.email,
    otherDisplayName: NOMBRES.otherUser,
    spaceName: NOMBRES.spaceName,
    friendSpaceName: NOMBRES.friendSpaceName,
    friendNoteTitle: NOMBRES.friendNoteTitle,
    folderName: NOMBRES.folderName,
    listTitle: NOMBRES.listTitle,
    noteTitle: NOMBRES.noteTitle,
    firstItemTitle: NOMBRES.items[0],
    secondItemTitle: NOMBRES.items[1],
    workspaceId,
    folderId,
    listId,
    noteId,
    friendSpaceId,
    friendNoteId,
  };
}

export function writeSeedEnv(archivo: string, sembrado: Seeded): void {
  const cuerpo = Object.entries(sembrado)
    .map(([clave, valor]) => `${clave}: "${valor}"`)
    .join('\n');
  writeFileSync(archivo, `${cuerpo}\n`, 'utf8');
}
