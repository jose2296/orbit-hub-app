#!/usr/bin/env node
/**
 * Importa la lista de la compra exportada de la app antigua como una lista de
 * OrbitHub, por la API HTTP.
 *
 *   node scripts/import-compra-list.mjs --dry-run
 *   TOKEN=... WORKSPACE_ID=... EXPECTED_EMAIL=... node scripts/import-compra-list.mjs
 *
 * Todo va por `/sync/push`. No toca la base de datos por la puerta de atrás, que
 * es la diferencia entre una importación que deja auditoría, versions y el resto
 * de dispositivos al día y una que deja cien filas que el siguiente pull borra.
 *
 * --- Por qué `TOKEN` y no `EMAIL` + `PASSWORD` ------------------------------
 *
 * `seed-showcase.mjs` se autentica con correo y contraseña. Esta cuenta no: es
 * una cuenta creada por `loginWithGoogle`, que escribe su identidad **solo** en
 * `auth_identities` y no crea identidad de correo — el comentario de
 * `createUserWithGoogleIdentity` lo dice ("no email identity, so no password can
 * be guessed"). `/auth/login` no tiene contra qué comprobar una contraseña, y
 * `/auth/google` exige un `code` de OAuth de verdad, que solo se consigue
 * iniciando sesión en un navegador. Por eso el token se pasa por fuera.
 *
 * --- Los ids no son aleatorios ---------------------------------------------
 *
 * La lista tiene un id fijo y cada item uno derivado del id de la app antigua,
 * así que **volver a correr esto no duplica nada**: el `create` de una fila que ya
 * existe vuelve como `duplicate` y el `operationId` derivado hace que el servidor
 * ni siquiera vuelva a mirar la operación. Un `crypto.randomUUID()` por item, como
 * en los seeds, convierte cada reejecución en una lista nueva al lado de la
 * anterior, y la que se ve en la app es la que no querías.
 *
 * --- `order` no es un orden, y por qué se renumera --------------------------
 *
 * El `order` de la app antigua tiene huecos (0, 1, 2, 7, 8…) y **repetidos**: el 17
 * aparece dos veces, el 28 dos y el 21 cuatro. No es una posición, es un contador
 * que se guardaba al reordenar y del que se borraban filas, así que por sí solo no
 * ordena nada. Se ordena por `(order, created_at, id)` —el desempate por fecha de
 * creación es lo que hace estable el resultado— y se renumera `position` de 0 a
 * N-1. Copiar el `order` tal cual dejaría tres posiciones repetidas en la lista,
 * que es exactamente donde el arrastre de la app deja de saber dónde soltar la
 * fila.
 *
 * --- Lo que este import NO puede hacer --------------------------------------
 *
 * **`created_at` y `updated_at` se pierden.** No están en `SYNC_WRITABLE_FIELDS`
 * (`apps/api/src/db/constants.ts`), así que `sanitisePayload` los **tira en
 * silencio**: el push responde `applied`, sube la versión, y las cien filas quedan
 * con la fecha de hoy. El comentario de esa constante avisa de que ese silencio es
 * peor que un rechazo, y aquí se nota de verdad: las fechas del exportado
 * (2025-09-18 → 2026-04-13) no se pueden llevar por la API. Habría que hacerlo con
 * un `UPDATE` sobre `list_items` después, y eso ya es escribir en la base sin la
 * validación del contrato.
 *
 * **`user_id` también se pierde**, y con razón: en el modelo nuevo una fila no
 * tiene dueño, la tiene el espacio. El exportado venía de dos personas (user_id 4
 * y 5) y las dos son miembros del espacio de destino.
 *
 * Los emojis se quedan en el título, tal cual estaban. El campo `icon` existe y es
 * una clave de `ITEM_ICONS`, no un emoji, pero solo hay 130 claves para 100 filas
 * con ~80 emojis distintos: mapearlos sería inventar el icono de la mitad de la
 * lista. Se quedan a `null`, que es un estado real.
 */

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const API = (process.env.API ?? 'https://orbithub-api.jrz-labs.com/api/v1').replace(/\/$/, '');
const TOKEN = process.env.TOKEN;
const WORKSPACE_ID = process.env.WORKSPACE_ID;
const SOURCE = process.env.SOURCE ?? `${process.env.HOME}/Downloads/list_items_rows.json`;
const DRY = process.argv.includes('--dry-run');

/**
 * La lista que este script crea.Fijo a propósito: es lo que hace que reejecutar
 * el script sea un no-op en lugar de una segunda lista.
 */
const LIST_ID = 'c3d1f0a6-4b2e-4c7a-9e15-7a83b6d20e41';
const LIST_TITLE = 'Lista de la compra';
const CLIENT_ID = 'import-compra-list';

/**
 * `deviceId` no lo usa `push` — el servicio lo recibe como `_envelope` y no lo
 * mira — pero el contrato lo exige como uuid, así que uno fijo y no un
 * `randomUUID()` por operación.
 */
const DEVICE_ID = '7f4a1e93-52c8-4d61-b7a0-3e9f18c25d74';

/**
 * La cuenta a la que se le escribe, comprobada contra `/auth/me` antes de tocar
 * nada. Es una cuenta de Google y solo hay una sesión abierta en el navegador, así
 * que el token puede ser de otra: una lista de la compra escrita en el espacio de
 * otra persona no se ve hasta que se busca, y para entonces ya está ahí.
 *
 * **Sin valor por defecto y a propósito.** El repo es público, así que un correo
 * aquí no es un detalle: es el correo de alguien. Ponerlo de valor por defecto lo
 * publica y además hace que el guard se pueda saltar sin querer —un default que
 * ya coincide no comprueba nada—. Quien lo ejecute dice a quién escribe.
 */
const EXPECTED_EMAIL = process.env.EXPECTED_EMAIL;

/** La lista de la app antigua. Todo lo de otro `list_id` en el fichero se ignora. */
const LEGACY_LIST_ID = 18;

/** Namespace fijo para derivar ids, de modo que no dependan del reloj ni del azar. */
const NAMESPACE = '2b1f4c88-9d3a-5e6b-8c07-1a5e9f2d7b34';

/** UUID v5 (SHA-1 sobre el namespace y el nombre). Determinista y con versión. */
function uuidv5(namespace, name) {
  const space = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const digest = createHash('sha1')
    .update(space)
    .update(Buffer.from(name, 'utf8'))
    .digest()
    .subarray(0, 16);

  digest[6] = (digest[6] & 0x0f) | 0x50; // version 5
  digest[8] = (digest[8] & 0x3f) | 0x80; // variante RFC 4122

  const hex = digest.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const itemIdOf = (legacyId) => uuidv5(NAMESPACE, `list_item:${LIST_ID}:${legacyId}`);
const operationIdOf = (entity, entityId) => uuidv5(NAMESPACE, `op:${entity}:${entityId}`);

async function call(path, { method = 'GET', body, token = TOKEN } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    throw new Error(
      `${method} ${path} -> ${res.status}: ${json?.error?.message ?? json?.message ?? JSON.stringify(json)}`,
    );
  }
  return json?.data ?? json;
}

/**
 * Las 100 filas del exportado, ordenadas y con `position` ya puesto.
 *
 * El orden es el que tenía la lista y no el que tenía el fichero: el export sale
 * por id, y por id el orden de la compra no se parece en nada.
 */
function leerItems() {
  const crudos = JSON.parse(readFileSync(SOURCE, 'utf8'));
  if (!Array.isArray(crudos) || crudos.length === 0) {
    throw new Error(`${SOURCE} no es una lista de filas`);
  }

  const deEsteExport = crudos.filter((fila) => fila.list_id === LEGACY_LIST_ID);
  const otros = crudos.length - deEsteExport.length;

  const ordenados = deEsteExport.sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
    return a.id - b.id;
  });

  return {
    items: ordenados.map((fila, position) => ({
      entityId: itemIdOf(fila.id),
      legacyId: fila.id,
      position,
      title: String(fila.content).trim(),
      completed: fila.completed === true,
      legacyOrder: fila.order,
      legacyCreatedAt: fila.created_at,
    })),
    otros,
  };
}

/**
 * Una operación por push, y el resultado comprobado.
 *
 * Una operación rechazada vuelve con `status: "rejected"` y un **HTTP 200**, así
 * que un import que solo mira el código se pasa por alto el item que no se creó y
 * termina con una lista de 99 filas y un "todo bien" en el log. `duplicate` se
 * cuenta como éxito a propósito: es lo que devuelve un reejecución.
 */
async function push(operaciones) {
  const resumen = { applied: 0, duplicate: 0, rejected: 0 };
  const fallos = [];

  for (const operacion of operaciones) {
    const respuesta = await call('/sync/push', {
      method: 'POST',
      body: {
        deviceId: DEVICE_ID,
        lastPulledAt: null,
        operations: [
          {
            operationId: operationIdOf(operacion.entity, operacion.entityId),
            clientId: CLIENT_ID,
            kind: 'create',
            baseVersion: 0,
            base: null,
            clientTimestamp: new Date().toISOString(),
            ...operacion,
          },
        ],
      },
    });

    const salida = respuesta.results?.[0];
    if (salida?.status === 'applied' || salida?.status === 'duplicate') {
      resumen[salida.status] += 1;
    } else {
      resumen.rejected += 1;
      fallos.push(`${operacion.entity} ${operacion.entityId}: ${JSON.stringify(salida)}`);
    }
  }

  return { resumen, fallos };
}

const { items, otros } = leerItems();
const pendientes = items.filter((i) => !i.completed).length;

// ------------------------------------------------------------------ dry ----

if (DRY) {
  console.log(`[dry-run] no se ha llamado a la API. Leído ${SOURCE}\n`);
  console.log(`  ${items.length} filas · ${pendientes} sin marcar · ${items.length - pendientes} marcadas`);
  if (otros > 0) console.log(`  (${otros} filas del fichero son de otra lista y se ignoran)`);
  console.log(`\n  lista   ${LIST_TITLE}  kind tasks  → workspace ${WORKSPACE_ID ?? '(sin poner)'}`);
  console.log(`          ${LIST_ID}\n`);
  console.log('  items, en el orden en que se importarían:\n');
  for (const item of items) {
    const marca = item.completed ? '[x]' : '[ ]';
    console.log(
      `   ${String(item.position).padStart(3)}  ${marca}  ${item.title}` +
        `        (legacy id=${item.legacyId} order=${item.legacyOrder})`,
    );
  }
  console.log(`\n  ${items.length + 1} operaciones: 1 de lista y ${items.length} de items.`);
  console.log('  Los ids se derivan del id antiguo, así que reejecutarlo no duplica nada.\n');
  process.exit(0);
}

if (!TOKEN || !WORKSPACE_ID || !EXPECTED_EMAIL) {
  console.error('Faltan TOKEN, WORKSPACE_ID y EXPECTED_EMAIL.\n');
  console.error('  node scripts/import-compra-list.mjs --dry-run');
  console.error('  TOKEN=<access token> WORKSPACE_ID=<uuid> EXPECTED_EMAIL=<tu correo> \\');
  console.error('    node scripts/import-compra-list.mjs\n');
  console.error('EXPECTED_EMAIL no tiene valor por defecto a propósito: es la cuenta a la que');
  console.error('se escribe, y el repo es público. Además, un default que ya coincide con el');
  console.error('token no comprueba nada.\n');
  process.exit(1);
}

// ----------------------------------------------------------- ejecución ----

console.log(`[import] ${API}`);
const yo = await call('/auth/me');
console.log(`[import] sesión de ${yo.email} (${yo.id})`);

if (yo.email !== EXPECTED_EMAIL) {
  console.error(`\n[import] el token es de ${yo.email} y se pidió ${EXPECTED_EMAIL}. Parando.\n`);
  console.error('[import] no se escribe nada hasta que las dos coincidan.\n');
  process.exit(1);
}

const enElEspacio = await call(`/lists?workspaceId=${WORKSPACE_ID}&limit=100`);
const yaEsta = enElEspacio.items?.find((l) => l.id === LIST_ID);
if (yaEsta) {
  console.log(`[import] la lista ya existe (${yaEsta.title}, ${yaEsta.itemCount} items).`);
  console.log('[import] los items que ya estén se devuelven como `duplicate`; se sigue para completar los que falten.');
} else {
  console.log(`[import] ${enElEspacio.items?.length ?? 0} listas en el espacio`);
}

/** Al final, para que la nueva no se cuelgue encima de las que ya había. */
const position = Math.max(-1, ...(enElEspacio.items ?? []).map((l) => l.position ?? 0)) + 1;

const lista = await push([
  {
    entity: 'list',
    entityId: LIST_ID,
    payload: {
      workspaceId: WORKSPACE_ID,
      folderId: null,
      title: LIST_TITLE,
      kind: 'tasks',
      position,
      orderMode: 'manual',
      tags: [],
    },
  },
]);
console.log(`[import] lista: ${JSON.stringify(lista.resumen)}`);
if (lista.fallos.length) {
  console.error(lista.fallos.join('\n'));
  process.exit(1);
}

const operaciones = items.map((item) => ({
  entity: 'list_item',
  entityId: item.entityId,
  payload: {
    listId: LIST_ID,
    title: item.title,
    position: item.position,
    completed: item.completed,
    tags: [],
  },
}));

// En lotes de 25 para que un fallo no obligue a repetir las 101, y cada resultado
// se sigue comprobando uno a uno dentro del push.
const LOTE = 25;
const total = { applied: 0, duplicate: 0, rejected: 0 };
const fallos = [];
for (let i = 0; i < operaciones.length; i += LOTE) {
  const trozo = operaciones.slice(i, i + LOTE);
  const r = await push(trozo);
  for (const clave of Object.keys(total)) total[clave] += r.resumen[clave];
  fallos.push(...r.fallos);
  console.log(
    `[import] items ${Math.min(i + LOTE, operaciones.length)}/${operaciones.length}  ` +
      `applied=${total.applied} duplicate=${total.duplicate} rejected=${total.rejected}`,
  );
}

if (fallos.length) {
  console.error(`\n[import] ${fallos.length} operaciones NO se aplicaron:\n`);
  console.error(fallos.join('\n'));
  process.exit(1);
}

// ------------------------------------------------------------ comprobación ----

const leida = await call(`/lists/${LIST_ID}`);
const itemsLeidos = await call(`/lists/${LIST_ID}/items?limit=200&completed=any`);
const rows = itemsLeidos.items ?? [];

const porPosicion = [...rows].sort((a, b) => a.position - b.position);
const contenidoIgual =
  porPosicion.length === items.length &&
  porPosicion.every((row, i) => row.title === items[i].title && row.completed === items[i].completed);

console.log('\n[import] comprobación leyendo la lista de vuelta por la API:');
console.log(`  title      ${leida.title}`);
console.log(`  kind       ${leida.kind}   orderMode ${leida.orderMode}   position ${leida.position}`);
console.log(`  workspace  ${leida.workspaceId}`);
console.log(`  items      ${rows.length} (esperados ${items.length})`);
console.log(`  sin marcar ${rows.filter((r) => !r.completed).length} (esperados ${pendientes})`);
console.log(`  posición 0 ${JSON.stringify(porPosicion[0]?.title)}`);
console.log(`  última     ${JSON.stringify(porPosicion.at(-1)?.title)}`);
console.log(`  título y marcado en el mismo orden que el exportado: ${contenidoIgual ? 'sí' : 'NO'}`);

if (!contenidoIgual) {
  console.error('\n[import] la lista de vuelta NO coincide con el exportado.');
  process.exit(1);
}
console.log(`\n[import] lista ${LIST_ID} importada. Reejecutar esto no duplica nada.`);
