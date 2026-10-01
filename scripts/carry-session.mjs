import { randomUUID } from "node:crypto";
import { execSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";

/**
 * Una cuenta con un panel sembrado, para comprobar el panel en un navegador.
 *
 * Vive en su propio módulo porque lo usan **dos** scripts y porque dupliqué el alta
 * una vez y me costó una tarde: la sesión que se guarda sirve para una corrida y
 * nada más. El token de acceso caduca en corto y la app **rota** el de refresco al
 * arrancar —que es lo correcto en una app de verdad—, así que una sesión guardada
 * de hace diez minutos está revocada y comprobarla con ella no mide nada.
 *
 * Por eso cada comprobación da de alta su cuenta, y por eso el alta lleva espera:
 * la API limita a cinco peticiones de autenticación cada quince minutos por IP, y
 * sin una IP distinta por corrida la segunda se queda sin ventana a mitad y falla
 * con un 429 que dice "el registro no llega" y no "has gastado las cinco".
 */

const API = process.env.API_URL ?? "http://localhost:4000/api/v1";

/** Una IP distinta en cada corrida, para no compartir la ventana del limitador. */
export function ipDeEstaCorrida() {
  const marca = Math.floor(Date.now() / 1000);
  return `10.90.${marca % 250}.${(Math.floor(Math.random() * 250) + 1).toString()}`;
}

export async function api(path, { method = "GET", body, token, ip } = {}) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip ?? ipDeEstaCorrida(),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const texto = await r.text();
  return { status: r.status, body: texto ? JSON.parse(texto) : null };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Dónde está escribiendo el servidor, que es donde sale el correo. */
function logDelServidor() {
  const puerto = new URL(API).port || "4000";
  const pid = execSync(`lsof -tnP -iTCP:${puerto} -sTCP:LISTEN`, { encoding: "utf8" })
    .split("\n")[0]
    ?.trim();
  return execSync(`lsof -p ${pid} | awk '/ 2w /{print $NF}'`, { encoding: "utf8" })
    .split("\n")[0]
    ?.trim();
}

/**
 * El token del correo de verificación de esta cuenta.
 *
 * Del trozo de log que ha aparecido **desde el alta**, y el último de ese trozo: el
 * log acumula todos los correos que ha enviado el servidor, así que el primero que
 * aparece es el de una cuenta de hace un rato —que además ya está verificada— y
 * con él el alta se queda esperando un correo que no es suyo. Es un fallo que se lee
 * como "el registro no llega" y en realidad es "se verificó otra cuenta".
 */
async function tokenDeVerificacion(log, antes) {
  const hasta = Date.now() + 25000;
  while (Date.now() < hasta) {
    await sleep(600);
    const ahora = await readFile(log, "utf8").catch(() => "");
    const nuevos = [
      ...ahora.slice(antes.length).matchAll(/verify-email\?token=([A-Za-z0-9_-]+)/g),
    ];
    if (nuevos.length > 0) return nuevos[nuevos.length - 1][1];
  }
  return null;
}

/** Una cuenta nueva, verificada y con sesión. */
export async function cuenta({ reintentos = 4 } = {}) {
  const log = logDelServidor();
  for (let intento = 1; intento <= reintentos; intento += 1) {
    const email = `carry-${Date.now().toString(36)}-${intento}@example.com`;
    const password = "a-very-long-password";
    const antes = await readFile(log, "utf8").catch(() => "");
    const alta = await api("/auth/register", {
      method: "POST",
      body: {
        email,
        password,
        displayName: "Carry",
        locale: "es",
        acceptedTermsAt: new Date().toISOString(),
        device: { label: "carry", platform: "web" },
      },
    });
    if (alta.status === 429) {
      console.log("      429, la API limita por ventana; se espera");
      await sleep(20000 * intento);
      continue;
    }
    if (alta.status !== 201 && alta.status !== 200) {
      console.log(`      registro ${alta.status}, se espera un momento`);
      await sleep(5000);
      continue;
    }
    const token = await tokenDeVerificacion(log, antes);
    if (!token) continue;
    await api("/auth/verify-email", { method: "POST", body: { token } });
    const entrada = await api("/auth/login", {
      method: "POST",
      body: { email, password, device: { label: "carry", platform: "web" } },
    });
    const session = entrada.body?.data?.session;
    if (!session) continue;
    const fichero = `/private/tmp/orbit-carry-${Date.now().toString(36)}.json`;
    await writeFile(fichero, JSON.stringify(session, null, 2));
    return session;
  }
  throw new Error("no se pudo dar de alta una cuenta");
}

/**
 * Un panel con dos pantallas con tarjetas y una vacía.
 *
 * Dos con tarjetas porque hacen falta para poder llevar una de una a otra, y una
 * vacía porque es la única donde el panel entero se dibuja vacío —que es donde se
 * pierde el swipe si el track se dibuja en lugar de ella— y porque una pantalla sin
 * nada es lo que se crea al final arrastrando.
 *
 * Las listas se crean de cero en cada corrida, así que los nombres de las tarjetas
 * son siempre nuevos y el texto que se busca en la pantalla es siempre el que se
 * acaba de escribir. Van en la lista y no en el `settings` de la tarjeta porque es la
 * lista de la que el panel saca el título: una comprobación que busca el nombre
 * escrito en el widget busca un texto que la pantalla nunca pinta.
 */
export async function sembrarPanel(session, nombres, { pantallas = 3, todasEnLaUltima = false, repartir = null } = {}) {
  const at = new Date().toISOString();
  const ip = ipDeEstaCorrida();
  const ws = randomUUID();
  const listas = nombres.map(() => randomUUID());

  const fila = await api("/sync/pull", {
    method: "POST",
    token: session.accessToken,
    ip,
    body: { deviceId: randomUUID(), lastPulledAt: null, clientTimestamp: at },
  });
  const cambios = fila.body?.data?.changes ?? fila.body?.data ?? [];
  const existente = (Array.isArray(cambios) ? cambios : Object.values(cambios))
    .flatMap((cambio) => Object.values(cambio ?? {}))
    .find((entidad) => entidad?.entity === "dashboard");

  const pushed = await api("/sync/push", {
    method: "POST",
    token: session.accessToken,
    ip,
    body: {
      deviceId: randomUUID(),
      lastPulledAt: null,
      clientTimestamp: at,
      operations: [
        {
          operationId: randomUUID(),
          clientId: "panel-carry",
          entity: "workspace",
          kind: "create",
          entityId: ws,
          baseVersion: 0,
          base: null,
          clientTimestamp: at,
          payload: { name: "Fondo", color: "teal" },
        },
        ...listas.map((id, i) => ({
          operationId: randomUUID(),
          clientId: "panel-carry",
          entity: "list",
          kind: "create",
          entityId: id,
          baseVersion: 0,
          base: null,
          clientTimestamp: at,
          payload: { workspaceId: ws, folderId: null, title: nombres[i], kind: "tasks" },
        })),
        {
          operationId: randomUUID(),
          clientId: "panel-carry",
          entity: "dashboard",
          kind: "update",
          entityId: existente?.entityId ?? "d5a0d1f2-4b3c-4a7e-9c2f-1b6d8e5a4f30",
          baseVersion: existente?.version ?? 0,
          base: null,
          clientTimestamp: at,
          payload: {
            /*
              `todasEnLaUltima` porque arrastrar más allá de la última pantalla sólo
              tiene sentido **desde** la última: si hay una pantalla vacía detrás,
              el dedo no sale del panel y no crea nada. Es lo que hacen las manos.
            */
            layout: nombres.map((nombre, i) => ({
              id: `list:${listas[i]}`,
              kind: "recent_lists",
              x: (i % 2) * 2,
              y: Math.floor(i / 2) * 2,
              w: 2,
              h: 2,
              page: repartir ? repartir[i] ?? 0 : todasEnLaUltima ? pantallas - 1 : i < 2 ? 0 : 1,
              pinned: true,
              settings: { listId: listas[i], title: nombre, kind: "tasks" },
            })),
            pages: pantallas,
          },
        },
      ],
    },
  });
  return { status: pushed.status };
}
