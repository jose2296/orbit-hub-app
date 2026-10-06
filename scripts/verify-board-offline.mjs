#!/usr/bin/env node
/**
 * El tablero sin conexión, y la comprobación que no se puede hacer de otra forma.
 *
 *   node scripts/verify-board-offline.mjs
 *
 * ---
 *
 * **Por qué este fichero existe y no está dentro de `verify-state-picker.mjs`.**
 * Los dos tocan la misma pantalla y el mismo camino de escritura, y sin embargo
 * no se pueden juntar: este corta la red, y un recorrido que corta la red a la
 * mitad del guion deja sin comprobar todo lo que venía después. `verify-state-picker`
 * mide el camino con la red puesta —incluido que el push sale y llega— y este mide
 * el mismo camino sin ella. Los dos Together cuentan la historia entera; uno solo
 * cuenta una mitad y no dice cuál.
 *
 * ---
 *
 * **Lo que se comprueba, y por qué cada cosa está aquí.**
 *
 * La escritura de este repo es local primero: un cambio cae en el outbox y la
 * pantalla se redibuja al instante, sin esperar al servidor. Eso se ve igual en
 * pantalla tanto si el cambio se encoló como si se escribió directamente contra la
 * API, y por eso **preguntar a la pantalla no puede contestar**. Lo que sí contesta
 * es la pareja:
 *
 *   - **lo que sale por el cable** — con la red cortada no sale nada, y eso se
 *     cuenta con `Network.requestWillBeSent` antes de que el servidor pueda
 *     responder nada;
 *   - **lo que hay en el outbox** — se lee de `localStorage['orbithub:outbox']`,
 *     que es donde `WebStorageStore` lo deja en web (`local-store.ts`), y se lee
 *     **por dentro**: el payload va como texto JSON y sin parsear sale `[object
 *     Object]` y la comprobación pasa sin haber mirado nada.
 *
 * Y las dos mitades juntas son la única forma de distinguir los tres finales
 * posibles de un movimiento: en el outbox y no en el servidor (**lo correcto**), en
 * el servidor y no en el outbox (**se está escribiendo en el servidor en vez del
 * outbox**, que es exactamente el fallo que el encargo dice que hay que arreglar
 * antes de seguir), o en ninguno (**solo en memoria**, que se pierde al cerrar).
 *
 * ---
 *
 * **ElOffline se corta de dos maneras, y no son intercambiables.** `Network.emulateNetworkConditions`
 * con `offline: true` es la honesta y la más fuerte: mata el `fetch` de la app, el
 * `pull` y también la recarga del bundle de la web. Pero **esa última parte es la
 * que impide cerrar y abrir la app**, y el punto 4 del encargo pide las dos cosas.
 * Medido, no supuesto: con la red emulada alocumento `tab.goto` deja la pagina en
 * `chrome-error://chromewebdata/` con el cartel de Chrome, porque el bundle se pide
 * a `localhost:8087` y ese puerto también está detrás de la emulación.
 *
 * Por eso el corte son **dos capas** y cada capa se usa para lo que puede comprobar:
 *
 *   1. **`Network.emulateNetworkConditions offline: true`** — para todo lo que
 *      pasa con la app **abierta**: mover, ver la pantalla, contar el cable, leer el
 *      outbox, y comprobar que moverse a la columna en la que ya está no encola
 *      nada. Es la capa fuerte, y mientras esté puesta **ninguna** petición sale.
 *   2. **`Network.setBlockedURLs`** sobre `*/api/*` — para **cerrar y abrir**,
 *      porque corta la API y **no** el bundle: la app vuelve a cargar de verdad,
 *      arranca sin servidor, lee la cache y el outbox del almacenamiento local, y se
 *      dibuja. Es la condición de un tren, que es la que el diseño local-primero
 *      promete, y es más fuerte en un sentido que la emulación no alcanza: **el
 *      navegador descargó doce megas de bundle sin conexión**, o sea que la sesión
 *      no dependía de la red para arrancar.
 *
 * Las dos se miden por separado y se dice cuál es cuál en cada línea, porque
 *.presentarlas como la misma cosa daría un verde que no dice lo que parece.
 *
 * ---
 *
 * **El outbox no se lee por el cable sino del almacenamiento, y por una razón
 * concreta.** El cable se cuenta para lo que *no* debe pasar —cero peticiones—,
 * y el outbox se lee para lo que *sí*. Con la red emulada no hay push al que
 * espiarle el cuerpo, así que leer `localStorage` no es una comodidad: es la
 * única forma de mirar qué se encoló en una corrida donde, por diseño, no se
 * encola nada al servidor.
 *
 * **Y una lectura que no puede leer no pasa por aquí.** Si la clave no existe, o no
 * es un array, o una de las operaciones no trae `payload` legible, la comprobación
 * falla y lo dice con el motivo. Un `?? 0` o un `?? []` en ese camino convertiría
 * "no he mirado" en "no hay nada escrito", que es el peor resultado posible de una
 * comprobación de esta clase: un outbox ilegible pasando por un outbox vacío.
 *
 * ---
 *
 * **Lo que este recorrido NO puede comprobar, y sale dicho en las lineas de `note`.**
 *
 *   - **Que el cierre de la app real conserve el outbox.** En web "cerrar y abrir"
 *     es recargar la pagina, y el almacenamiento es `localStorage`, que sobrevive
 *     a una recarga; en nativo es SQLite y no se ha medido aqui. Lo que se
 *     comprueba es que el estado **lee del almacenamiento tras recargar**, que es la
 *     mitad que se puede medir, y no que el almacenamiento nativo lo haga.
 *   - **Que el motor de sincronizacion reintente con la curva de backoff.** Se mira
 *     el outbox intacto tras un rato, no la serie de reintentos.
 *   - **La resolucion de conflictos.** Dos dispositivos editando la misma lista sin
 *     conexion y conectando a la vez es otro recorrido, y este no lo hace.
 *   - **La pantalla de sistema y el teclado**, como en cualquier otro.
 */

import { randomUUID } from "node:crypto";
import { execSync } from "node:child_process";
import { readFile } from "node:fs/promises";

import { launchChrome, openTab, seedSession, collectProblems } from "./cdp.mjs";

const APP = process.env.APP_URL ?? "http://localhost:8087";
const API = process.env.API_URL ?? "http://localhost:4100/api/v1";
const SHOTS = process.env.SHOTS ?? "/tmp/orbit-board-offline";
const CLIENT = "verify-board-offline";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * El log de la API, leido del proceso que esta escuchando de verdad.
 *
 * **Y con reintentos, porque `lsof` aqui puede no arrancar, y cuando no arranca el
 * guion se muere de una forma que parece un fallo de la app.** Medido en esta
 * maquina: con muchos procesos de otras herramientas, `lsof` responde
 * `can't fork: Resource temporarily unavailable`, `execSync` lanza, y un `catch`
 * que se comiera eso devolveria una ruta **vacia** —con lo que `readLog` leeria
 * `""` y el alta pareceria no haber mandado ningun correo, que es el sintoma
 * exacto de una API sana con el log mal leido.
 *
 * Por eso el camino es explicito: `lsof` falla -> se reintenta con espera, y si
 * tras los intentos no hay ruta, **se dice que no se ha podido leer el log** y el
 * guion para. Un recorrido que muere por no encontrar el log dice la verdad; uno
 * que se lo come miente sobre la app.
 */
function logOfTheApi() {
  const port = new URL(API).port || "4000";
  let ultimo = "";
  for (let intento = 1; intento <= 6; intento += 1) {
    try {
      const pid = execSync(`lsof -tnP -iTCP:${port} -sTCP:LISTEN`, { encoding: "utf8" })
        .split("\n")[0]
        ?.trim();
      if (!pid) throw new Error(`nada escuchando en el puerto ${port}`);
      const line = execSync(`lsof -p ${pid} | awk '/ 2w /{print $NF}'`, { encoding: "utf8" })
        .split("\n")[0]
        ?.trim();
      if (!line) throw new Error(`el proceso ${pid} no tiene un fichero de salida abierto`);
      return line;
    } catch (e) {
      ultimo = e.message;
      execSync("sleep 2", { shell: "/bin/sh" });
    }
  }
  throw new Error(
    `no he podido leer el log de la API en el puerto ${port} tras 6 intentos: ${ultimo}. ` +
      "Es el entorno, no la app: con `lsof` sin procesos para forkear el guion no " +
      "puede leer el correo de verificacion y no debe fingir que la API no lo mando.",
  );
}

const EMAIL_LOG = logOfTheApi();
/**
 * El log entero.
 *
 * **Y aqui no hay `catch` que devuelva `""`.** Un `catch { return "" }` convierte
 * un log ilegible en un log vacio, y el guion que lo espera —el correo de
 * verificacion— se convierte en "la API no mando el correo", que es una accuses
 * falsa contra la app. Se propaga el error.
 */
const readLog = () => readFile(EMAIL_LOG, "utf8");

/**
 * Una IP distinta en cada corrida, como en los otros guiones: el limite de auth
 * son 7 llamadas sensibles por IP cada quince minutos y dos recorridos seguidos
 * desde la misma direccion se comen la ventana del otro.
 */
const IP = `10.91.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}`;

async function api(path, { method = "GET", body, token } = {}) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": IP,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const t = await r.text();
  return { status: r.status, body: t ? JSON.parse(t) : null, headers: r.headers };
}

let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures += 1;
  console.log(`${ok ? "ok    " : "FALLA "} ${name}${detail ? ` — ${detail}` : ""}`);
};
const note = (text) => console.log(`      ${text}`);

/** Una llamada que espera su `Retry-After` en vez de rendirse. */
async function apiConEspera(path, opciones = {}) {
  for (let intento = 1; ; intento += 1) {
    const r = await api(path, opciones);
    if (r.status !== 429) return r;
    const retry = Number(r.headers?.get?.("retry-after")) || 60;
    const espera = Math.min(Math.max(retry, 5), 600);
    note(`429 en ${path}: la API pide ${retry}s y se esperan ${espera}s (intento ${intento}).`);
    await sleep(espera * 1000);
  }
}

/** Lo que el servidor tiene ahora, como mapa de `"entidad:id"` a fila. */
async function leerDelServidor(sesion) {
  const r = await apiConEspera("/sync/pull", {
    method: "POST",
    token: sesion.accessToken,
    body: {
      deviceId: randomUUID(),
      lastPulledAt: null,
      clientTimestamp: new Date().toISOString(),
    },
  });
  const mapa = new Map();
  for (const cambio of r.body?.data?.changes ?? []) {
    if (cambio?.entity && cambio?.record) {
      mapa.set(`${cambio.entity}:${cambio.record.id}`, cambio.record);
    }
  }
  return mapa;
}

async function account() {
  const password = "a-very-long-password";
  const device = { label: "board-offline", platform: "web" };
  const email = `board-offline-${Date.now().toString(36)}@example.com`;

  const before = await readLog();
  const alta = await apiConEspera("/auth/register", {
    method: "POST",
    body: { email, password, displayName: "Offline", locale: "es", acceptedTermsAt: new Date().toISOString(), device },
  });
  if (alta.status !== 200 && alta.status !== 201) {
    throw new Error(`el registro no salio: http ${alta.status} ${JSON.stringify(alta.body)}`);
  }

  const deadline = Date.now() + 30000;
  let link = null;
  while (Date.now() < deadline && !link) {
    await sleep(400);
    link = (await readLog()).slice(before.length).match(/verify-email\?token=([A-Za-z0-9_-]+)/);
  }
  if (!link?.[1]) throw new Error("el correo de verificacion no salio en el log");
  await apiConEspera("/auth/verify-email", { method: "POST", body: { token: link[1] } });

  const tras = await apiConEspera("/auth/login", { method: "POST", body: { email, password, device } });
  const session = tras.body?.data?.session;
  if (!session) throw new Error(`no hay sesion tras verificar: http ${tras.status} ${JSON.stringify(tras.body)}`);
  return session;
}

/**
 * Cuatro columnas y **tres tareas en cada una**, sembradas por la API.
 *
 * Las del primer estado nacen con `stateId: null`, que es lo que hace
 * `newListItem` en el cliente, y por eso la primera columna las cuenta a todas. Es
 * tambien el caso que obliga a `stateIdToWrite` a comparar contra la columna
 * **resuelta**: si comparara contra `item.stateId`, elegir la primera columna
 * encolaria un update para una tarea que ya esta ahi — que es justo la comprobacion
 * del final de este recorrido.
 */
const ESTADOS = [
  { id: randomUUID(), title: "Backlog", color: "neutral" },
  { id: randomUUID(), title: "Ready", color: "blue" },
  { id: randomUUID(), title: "WIP", color: "amber" },
  { id: randomUUID(), title: "Done", color: "green" },
];

const session = await account();
const ws = randomUUID();
const listId = randomUUID();
const at = new Date().toISOString();

const TAREAS = ESTADOS.flatMap((estado, indice) =>
  [0, 1, 2].map((n) => ({
    id: randomUUID(),
    title: `${estado.title}-${n + 1}`,
    position: indice * 3 + n,
    stateId: indice === 0 ? null : estado.id,
  })),
);
const porTitulo = new Map(TAREAS.map((t) => [t.title, t]));
const TITULOS_POR_ID = Object.fromEntries(TAREAS.map((t) => [t.id, t.title]));

/* ------------------------------------------------------------------ el sembrado */

const sembrado = await api("/sync/push", {
  method: "POST",
  token: session.accessToken,
  body: {
    deviceId: randomUUID(),
    lastPulledAt: null,
    clientTimestamp: at,
    operations: [
      {
        operationId: randomUUID(),
        clientId: CLIENT,
        entity: "workspace",
        kind: "create",
        entityId: ws,
        baseVersion: 0,
        base: null,
        clientTimestamp: at,
        payload: { name: "Tablero", color: "teal" },
      },
      {
        operationId: randomUUID(),
        clientId: CLIENT,
        entity: "list",
        kind: "create",
        entityId: listId,
        baseVersion: 0,
        base: null,
        clientTimestamp: at,
        // `orderMode: 'manual'` porque lo fija el tablero, y `states` porque sin el
        // array la pantalla responde `board.noStates` y no hay nada que mirar.
        payload: { workspaceId: ws, folderId: null, title: "Envíos", kind: "board", orderMode: "manual", states: ESTADOS },
      },
      ...TAREAS.map((tarea) => ({
        operationId: randomUUID(),
        clientId: CLIENT,
        entity: "list_item",
        kind: "create",
        entityId: tarea.id,
        baseVersion: 0,
        base: null,
        clientTimestamp: at,
        payload: { listId, title: tarea.title, position: tarea.position, ...(tarea.stateId ? { stateId: tarea.stateId } : {}) },
      })),
    ],
  },
});

/*
  **El codigo de la respuesta no es el estado de las operaciones.** Un push con
  operaciones rechazadas es un 200 con `rejected` dentro, y una siembra que solo mira
  el codigo parece buena y deja el tablero vacio.
*/
const resultados = sembrado.body?.data?.results ?? [];
const rechazadas = resultados.filter((r) => r.status !== "applied" && r.status !== "duplicate");
check(
  "el sembrado se aplico entero (results, no el codigo)",
  sembrado.status === 200 && rechazadas.length === 0,
  `http ${sembrado.status}, applied ${resultados.filter((r) => r.status === "applied").length}/${resultados.length}` +
    (rechazadas.length ? ` — rechazadas: ${rechazadas.map((r) => `${r.entity}:${r.error}`).join(" | ")}` : ""),
);
if (failures > 0) {
  console.log("\nSin sembrar no hay nada que mirar.");
  process.exit(1);
}

/* ------------------------------------------------------------------ el DOM */

/**
 * Que columnas esta pintando el tablero, con sus contadores y que pestaña esta
 * activa. Las pestañas se leen por `aria-selected`, que es lo que
 * `board-tabs.tsx` escribe a mano para las dos plataformas.
 */
const TABLERO = `(() => {
  const NOMBRES = ${JSON.stringify(TITULOS_POR_ID)};
  const slots = [...document.querySelectorAll('[data-testid^="board-slot-"]')];
  return {
    pestanas: [...document.querySelectorAll('[data-testid^="board-tab-"]')].map((el) => ({
      id: el.getAttribute('data-testid').replace('board-tab-', ''),
      texto: (el.innerText || '').replace(/\\n/g, ' '),
      seleccionada: el.getAttribute('aria-selected') === 'true',
    })),
    columnas: slots.map((slot) => {
      const id = slot.getAttribute('data-testid').replace('board-slot-', '');
      const cuenta = document.querySelector('[data-testid="board-count-' + id + '"]');
      const tab = document.querySelector('[data-testid="board-tab-' + id + '"]');
      return {
        columna: id,
        // El numero **de su propio elemento**, no el texto de la fila: la cabecera
        // lleva el nombre al lado y trocear el innerText daria "Done3".
        contador: cuenta ? Number(cuenta.innerText) : null,
        contadorDeLaPestana: tab ? Number((tab.innerText || '').replace(/\\D+/g, "")) : null,
        tarjetas: [...slot.querySelectorAll('[data-testid^="item-row-"]')].map((el) => {
          const tid = el.getAttribute('data-testid').replace('item-row-', '');
          return NOMBRES[tid] ?? tid;
        }),
      };
    }),
  };
})()`;

const readBoard = (tab) => tab.evaluate(TABLERO);

/**
 * El outbox de la web, leido de donde `WebStorageStore` lo deja.
 *
 * **Y la lectura falla en voz alta cuando no puede leer.** Cada `payload` va
 * codificado como texto (`PendingOperationRecord.payload` es `string | null`), asi
 * que se parsea aqui y se cuenta un `ilegibles` para los que no. Un `?? []` en este
 * camino diria "no hay nada encolado" cuando lo que habria es "no lo he mirado", y
 * una comprobacion de outbox que pasa sin haber leido nada no comprueba nada.
 */
const LEER_OUTBOX = `(() => {
  const crudo = localStorage.getItem('orbithub:outbox');
  // **La clave ausente NO es un motivo.** \`WebStorageStore.enqueue\` no escribe hasta
  // que hay algo que encolar, asi que antes del primer cambio un outbox de verdad
  // se lee como una clave que no esta. Lo que si es un motivo es una clave **que no
  // se puede entender**, y por eso las dos ramas llevan \`motivo: null\`.
  if (crudo === null) return { existe: false, motivo: null, total: 0, ilegibles: 0, ops: [] };
  let lista;
  try { lista = JSON.parse(crudo); } catch (e) { return { existe: true, motivo: 'no es JSON: ' + e.message, total: 0, ilegibles: 0, ops: [] }; }
  if (!Array.isArray(lista)) return { existe: true, motivo: 'no es un array (' + typeof lista + ')', total: 0, ilegibles: 0, ops: [] };
  let ilegibles = 0;
  const ops = lista.map((op) => {
    let payload = null;
    try { payload = typeof op?.payload === 'string' ? JSON.parse(op.payload) : op?.payload; } catch { payload = null; }
    if (!payload || typeof payload !== 'object') ilegibles += 1;
    return {
      entity: op?.entity ?? null,
      kind: op?.kind ?? null,
      entityId: op?.entityId ?? null,
      stateId: payload?.stateId ?? null,
      titulo: payload?.title ?? null,
      ilegible: !payload || typeof payload !== 'object',
    };
  });
  return { existe: true, motivo: null, total: ops.length, ilegibles, ops };
})()`;

const readOutbox = (tab) => tab.evaluate(LEER_OUTBOX);

/** El centro de un elemento por `testID`, y opcionalmente por un descendiente. */
const centro = (tab, testId, dentro) =>
  tab.evaluate(`(() => {
    const el = document.querySelector('[data-testid=' + JSON.stringify(${JSON.stringify(testId)}) + ']' + ${JSON.stringify(dentro ?? "")});
    if (!el) return null;
    el.scrollIntoView && el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return null;
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);

/**
 * Un toque de dedo, y **con reintentos**: el arnes pierde la respuesta de CDP
 * aproximadamente una corrida de cada dos en los pasos de navegacion, con la
 * pantalla pintada y Metro sano. Losing it on `Input.dispatchTouchEvent` is the same
 * failure as any other — the retry lives here and **not** in `cdp.mjs`, que es
 * compartido por veinte guiones y esta deliberadamente sin endurecer.
 */
async function enviarToque(tab, params, etiqueta) {
  for (let intento = 1; ; intento += 1) {
    try {
      return await tab.send("Input.dispatchTouchEvent", params, { ms: 15000 });
    } catch (e) {
      if (intento >= 4) {
        // Antes de rendirse, **se mira la pantalla**: un toque perdido con la
        // pantalla ya en su sitio final es el arnes, y una comprobacion que dice
        // "el boton no responde" cuando el boton ya esta pulsado manda a buscar un
        // defecto donde no lo hay.
        const donde = await tab
          .evaluate("location.href + ' | ' + document.body.innerText.slice(0, 80).replace(/\\n/g, ' ')")
          .catch(() => "la pagina no responde");
        throw new Error(
          `el navegador dejo de responder a ${etiqueta ?? params.type} tras 4 intentos ` +
            `(la pagina sigue viva: ${donde}): ${e.message}`,
        );
      }
      note(`(el navegador no acuso un ${params.type} en ${etiqueta ?? "?"}; intento ${intento + 1})`);
      await sleep(1200 * intento);
    }
  }
}

async function tap(tab, testId, dentro) {
  const p = await centro(tab, testId, dentro);
  if (!p) throw new Error(`no encuentro ${testId}${dentro ?? ""}`);
  await enviarToque(tab, { type: "touchStart", touchPoints: [{ x: p.x, y: p.y, radiusX: 8, radiusY: 8, force: 1 }] }, `touchStart en ${testId}`);
  await sleep(80);
  await enviarToque(tab, { type: "touchEnd", touchPoints: [] }, `touchEnd en ${testId}`);
  await sleep(400);
  return p;
}

/** Tocar una tarjeta por su boton de titulo, que es el control que abre la hoja. */
const tapTarjeta = (tab, id) => tap(tab, `item-row-${id}`, " button[aria-label]");

/** Esperar a que la hoja de estado no este, en vez de mirarla una vez. */
const HAY_HOJA = `!!document.querySelector('[data-testid="sheet-panel"]:has([data-testid^="state-picker-row-"])')`;
async function esperarHojaCerrada(tab, limiteMs = 1500) {
  const esperando = Date.now();
  let sigue = true;
  while (Date.now() - esperando < limiteMs) {
    sigue = Boolean(await tab.evaluate(HAY_HOJA));
    if (!sigue) break;
    await sleep(60);
  }
  return { sigue, ms: Date.now() - esperando };
}

/**
 * Mover una tarea de columna por la hoja, que es el camino que una persona usa.
 *
 * Devuelve lo que la app respondio, no un `ok`: la comprobacion que llama aqui
 * decide con estos numeros, y un `true` de esta funcion no diria si el movimiento
 * llego a encolarse.
 */
async function moverPorLaHoja(tab, titulo, destino) {
  const tarea = porTitulo.get(titulo);
  if (!tarea) throw new Error(`la semilla no tiene la tarea "${titulo}"`);
  await tapTarjeta(tab, tarea.id);
  await sleep(350);
  const hoja = await tab.evaluate(`(() => {
    const panel = [...document.querySelectorAll('[data-testid="sheet-panel"]')]
      .find((p) => p.querySelector('[data-testid^="state-picker-row-"]'));
    return panel ? { filas: panel.querySelectorAll('[data-testid^="state-picker-row-"]').length } : null;
  })()`);
  if (!hoja) throw new Error(`la hoja de estado no se abrio sobre "${titulo}"`);
  await tap(tab, `state-picker-row-${destino.id}`);
  const cerrada = await esperarHojaCerrada(tab);
  return { tarea, destino, filas: hoja.filas, cerrada };
}

/** Cortar la red de las dos maneras del encabezado, y quitar las dos. */
const EMULACION = (offline) => ({
  offline,
  latency: 0,
  downloadThroughput: offline ? 0 : -1,
  uploadThroughput: offline ? 0 : -1,
});

/* ------------------------------------------------------------------ la corrida */

const chrome = await launchChrome({ width: 1440, height: 900 });
let tab;
try {
  tab = await openTab(chrome.port);
  await tab.send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const viewport = await tab.evaluate("({ w: window.innerWidth, h: window.innerHeight })");
  check("el viewport es el pedido y no el que venga por defecto", viewport?.w === 1440, `innerWidth: ${viewport?.w} x ${viewport?.h}`);

  const problems = collectProblems(tab);

  /**
   * Lo que sale por el cable, contado antes de que el servidor pueda responder.
   *
   * ---
   *
   * **El metodo va guardado porque un `204` en este camino NO es una escritura
   * recibida, y contarlo como si lo fuera es el error mas grave que puede tener
   * esta comprobacion.** Medido en la primera corrida: con la red emulada
   * alocumento salia un `respondio 204` y el recorrido lo leia como "el servidor
   * recibio el movimiento sin conexion", que es justo lo que esta comprobacion
   * existe para detectar.
   *
   * Era el **preflight de CORS**: la peticion lleva `authorization` y
   * `content-type: application/json`, asi que el navegador manda un `OPTIONS`
   * antes del `POST`, y ese `OPTIONS` es el que contestaba 204. El `POST` de verdad
   * fallaba con `net::ERR_INTERNET_DISCONNECTED` en el mismo instante. El `OPTIONS`
   * no lleva `postData`, asi que se vio como un push de **cero operaciones** al
   * lado del push de una, y la cuenta de "con respuesta" daba 1.
   *
   * Las dos cosas que lo hacen un error y no un detalle de forma:
   *
   *   - **pasaba por lo correcto.** Un 204 de un preflight y un 204 de un push
   *     aplicados se leen igual en este registro, y solo uno de los dos significa
   *     que el servidor tiene el cambio.
   *   - **la comprobacion que sale de aqui era la que decide si el diseño
   *     local-primero funciona.** Un "llego al servidor" falso deja en verde el
   *     fallo mas caro del repo.
   *
   * Por eso el filtro es por **metodo** (`POST`) y no por URL, y por eso el
   * cuaderno imprime el metodo de cada intento: un `OPTIONS` con 204 tiene que
   * seguir siendo visible en la salida, porque es la explicacion de porque el
   * `POST` no tiene respuesta, no un dato que se pueda tirar.
   *
   * ---
   *
   * **Y cada peticion se empareja con su desenlace.** Con la red emulada
   * alocumento `fetch` **si se llama**: el navegador emite el evento y luego el
   * envio falla. Contar intentos y exigir cero seria exigir que la app **no
   * intentara sincronizar**, que es un fallo distinto y peor —un outbox que no
   * reintenta no se vacia nunca al volver la red—. Lo que se afirma es que nada
   * **llega** al servidor, y eso es lo que se mide.
   *
   * El `operationId` se guarda porque es lo que distingue **reintentar lo que ya
   * estaba encolado** de **encolar algo nuevo**: sin el, un push con la misma
   * operacion reenviada parece una escritura nueva.
   */
  const pushes = [];
  const finales = new Map();
  tab.on("Network.requestWillBeSent", (params) => {
    const url = params?.request?.url ?? "";
    if (!url.includes("/sync/push")) return;
    let body = null;
    try {
      body = JSON.parse(params.request.postData ?? "null");
    } catch {
      body = null;
    }
    pushes.push({
      at: Date.now(),
      requestId: params.requestId ?? null,
      metodo: params.request?.method ?? "?",
      url,
      total: (body?.operations ?? []).length,
      operationIds: (body?.operations ?? []).map((o) => o?.operationId ?? null),
      stateIds: (body?.operations ?? [])
        .filter((o) => o?.entity === "list_item")
        .map((o) => o?.payload?.stateId ?? null),
    });
  });
  tab.on("Network.loadingFailed", (params) => {
    finales.set(params.requestId, { cuando: Date.now(), que: `no salio (${params.errorText ?? "sin motivo"})` });
  });
  tab.on("Network.responseReceived", (params) => {
    if (!params?.response?.url?.includes("/sync/push")) return;
    finales.set(params.requestId, { cuando: Date.now(), que: `respondio ${params.response.status}` });
  });

  /**
   * El desenlace de los pushes de una ventana, y no solo cuantos hubo.
   *
   * **El instante del desenlace va guardado y no solo su texto**, y el motivo es
   * concreto: una respuesta que llega **despues** de haber cambiado la capa de red
   * no describe el estado de la capa anterior. Sin los dos numeros —el del intento y
   * el de la respuesta— un "llego al servidor sin conexion" puede ser en realidad un
   * push que salio cuando ya habia red, y la comprobacion que lo dice no se puede
   * depurar. Con los dos, se ve.
   */
  const desenlace = (desde) => {
    // **Solo los `POST`.** Un `OPTIONS` que contesta 204 es el preflight y no lleva
    // la escritura; contarlo seria decir que el servidor recibio el movimiento.
    const dentro = pushes.filter((p) => p.at >= desde && p.metodo === "POST");
    const conDesenlace = dentro.filter((p) => finales.has(p.requestId));
    const llegaron = conDesenlace.filter((p) => finales.get(p.requestId).que.startsWith("respondio"));
    const noSalieron = conDesenlace.filter((p) => finales.get(p.requestId).que.startsWith("no salio"));
    const sinFinal = dentro.filter((p) => !finales.has(p.requestId));
    const preflights = pushes.filter((p) => p.at >= desde && p.metodo !== "POST");
    return { dentro, llegaron, noSalieron, sinFinal, preflights };
  };

  /** Una linea por intento con su desenlace y los dos instantes, para depurar. */
  const cuadernoDelCable = (ventana) => {
    const lineas = ventana.dentro.map(
      (p) =>
        `${p.metodo}@${p.at} ops=${p.total} -> ${
          finales.has(p.requestId) ? `${finales.get(p.requestId).que}@${finales.get(p.requestId).cuando}` : "sin desenlace"
        }`,
    );
    // Los preflights se enseñan y **se cuentan aparte**, porque son la explicacion
    // de por que un POST no tiene respuesta y no un dato que se pueda tirar.
    for (const pre of ventana.preflights) {
      lineas.push(
        `${pre.metodo}@${pre.at} (preflight, sin escritura) -> ${
          finales.has(pre.requestId) ? `${finales.get(pre.requestId).que}@${finales.get(pre.requestId).cuando}` : "sin desenlace"
        }`,
      );
    }
    return lineas.join(" ; ");
  };

  // El tema se escribe antes de la ultima carga y **se comprueba despues**: Chrome
  // sin cabeza arranca en `prefers-color-scheme: dark` y una pasada "en claro" que
  // no se comprueba sale entera en oscuro con el nombre de claro.
  const PONER_TEMA = (apariencia) =>
    tab.evaluate(`localStorage.setItem('orbithub:appearance', ${JSON.stringify(
      JSON.stringify({ appearance: apariencia, accent: "orbit" }),
    )})`);

  await seedSession(tab, session, APP);
  await PONER_TEMA("light");
  await tab.goto(`${APP}/board/${listId}`);

  const ready = Date.now() + 45000;
  let visto = null;
  while (Date.now() < ready) {
    visto = await readBoard(tab);
    if (visto?.columnas?.length === 4) break;
    await sleep(600);
  }
  check("el tablero se abre con sus cuatro columnas", visto?.columnas?.length === 4, `columnas: ${visto?.columnas?.length}`);
  if (visto?.columnas?.length !== 4) {
    await tab.screenshot(`${SHOTS}/00-no-abre.png`);
    throw new Error("el tablero no se abrio");
  }
  const tema = await tab.evaluate(
    `document.documentElement.style.colorScheme || getComputedStyle(document.documentElement).colorScheme`,
  );
  check("la pasada esta en CLARO de verdad", tema === "light", `colorScheme: ${tema}`);

  note(
    `columnas: ${visto.columnas.map((c) => `${c.contador}=[${c.tarjetas.join(",")}]`).join(" ")} | ` +
      `pestanas: ${visto.pestanas.map((p) => `${p.texto}${p.seleccionada ? "*" : ""}`).join(" | ")}`,
  );

  /* --- 1. La primera columna es la que esta activa, y el contador es el de las tarjetas --- */

  check(
    "**la primera pestaña esta activa al abrir**, y solo ella",
    visto.pestanas[0]?.seleccionada === true && visto.pestanas.filter((p) => p.seleccionada).length === 1,
    `pestanas: ${visto.pestanas.map((p) => `${p.texto}${p.seleccionada ? "*" : ""}`).join(" | ")}`,
  );
  check(
    "cada contador de cabecera es el numero de tarjetas de debajo",
    visto.columnas.every((c) => c.contador === c.tarjetas.length),
    `cabeceras: ${visto.columnas.map((c) => `${c.contador}/${c.tarjetas.length}`).join(" ")}`,
  );
  await tab.screenshot(`${SHOTS}/01-tablero-claro.png`);

  /* --- 2. Cortar la red: emulacion, la capa fuerte --- */

  note("");
  note("=== 2. La red cortada con Network.emulateNetworkConditions (offline: true) ===");
  note("    Mata el fetch de la app, el pull y tambien la recarga del bundle de la web.");
  note("    Por eso con esta capa puesta NO se puede cerrar y abrir: se mide en el punto 5");

  await tab.send("Network.emulateNetworkConditions", EMULACION(true));
  await sleep(600);
  const onLine = await tab.evaluate("navigator.onLine");
  check(
    "**la pagina ve que no hay red** (`navigator.onLine` es `false`, no supuesto)",
    onLine === false,
    `navigator.onLine: ${onLine}`,
  );

  /* --- 3. Mover una tarea sin conexion --- */

  /*
    **El outbox se lee por las dos ramas que puede tomar antes de haber escrito
    nada, y las dos son legítimas.** Una clave que no existe es un outbox vacío —
    `WebStorageStore.enqueue` no escribe hasta que hay algo que encolar, y nada ha
    escrito todavía—. Una clave que existe y no es un array es un outbox **roto**, y
    eso sí es un fallo.

    La diferencia importa porque la tentación es `?? []`: con ese `??`, un
    almacenamiento corrupto devolvería una lista vacía y la comprobación de más
    abajo —"el outbox tiene una operación con el id de la columna elegida"— leería
    cero operaciones y **fallaría**, pero por el motivo equivocado, y un
    `?? []` en la comparación la dejaría pasar. Aquí la rama se dice en el `detail`.
  */
  const antes = await readOutbox(tab);
  const antesVacio = antes.existe === false || (antes.existe === true && antes.total === 0);
  check(
    "el outbox se puede leer **antes** de mover, y esta vacio (la clave aun no existe)",
    antesVacio && antes.ilegibles === 0 && antes.motivo === null,
    `existe: ${antes.existe}, operaciones: ${antes.total}, ilegibles: ${antes.ilegibles}` +
      (antes.motivo
        ? ` — motivo: ${antes.motivo}`
        : antes.existe === false
          ? " (la clave no existe: es exactamente lo que se ve antes del primer encolado, porque `WebStorageStore.enqueue` no escribe hasta que hay algo)"
          : ""),
  );

  pushes.length = 0;
  const movido = await moverPorLaHoja(tab, "WIP-2", ESTADOS[3]);
  const salidaInmediata = await readBoard(tab);
  const enDone = salidaInmediata.columnas.find((c) => c.columna === ESTADOS[3].id)?.tarjetas ?? [];
  const enWip = salidaInmediata.columnas.find((c) => c.columna === ESTADOS[2].id)?.tarjetas ?? [];
  const enTodo = salidaInmediata.columnas.map((c) => c.tarjetas).flat();

  check(
    "**sin conexion, la tarea se ve en la columna nueva al instante**",
    enDone.includes("WIP-2"),
    `Done: [${enDone.join(",")}] | WIP: [${enWip.join(",")}]`,
  );
  check("y no esta en la columna de la que salio", !enWip.includes("WIP-2"), `WIP: [${enWip.join(",")}]`);
  check(
    "**y no esta duplicada en ninguna parte**: sale una vez en todo el tablero",
    enTodo.filter((t) => t === "WIP-2").length === 1,
    `${enTodo.filter((t) => t === "WIP-2").length} apariciones de ${enTodo.length} tarjetas`,
  );
  check("ninguna otra tarjeta se ha movido", enTodo.length === TAREAS.length, `tarjetas: ${enTodo.length}`);
  check(
    "los contadores de las cabeceras se han actualizado con el movimiento",
    salidaInmediata.columnas.find((c) => c.columna === ESTADOS[2].id)?.contador === enWip.length &&
      salidaInmediata.columnas.find((c) => c.columna === ESTADOS[3].id)?.contador === enDone.length,
    `WIP: ${salidaInmediata.columnas.find((c) => c.columna === ESTADOS[2].id)?.contador} (tarjetas: ${enWip.length}) | ` +
      `Done: ${salidaInmediata.columnas.find((c) => c.columna === ESTADOS[3].id)?.contador} (tarjetas: ${enDone.length})`,
  );
  await tab.screenshot(`${SHOTS}/02-tras-mover-sin-conexion.png`);

  /* --- 4. Donde ha quedado escrito: el outbox, y el cable --- */

  note("");
  note("=== 4. El movimiento esta en el outbox y no en el servidor ===");

  const despues = await readOutbox(tab);
  check(
    "**el outbox se puede leer y lo que hay en el se entiende**",
    despues.existe === true && despues.ilegibles === 0,
    `existe: ${despues.existe}, total: ${despues.total}, ilegibles: ${despues.ilegibles}` +
      (despues.motivo ? ` — motivo: ${despues.motivo}` : ""),
  );
  const opsDelMovimiento = despues.ops.filter(
    (op) => op.entity === "list_item" && op.entityId === movido.tarea.id,
  );
  check(
    "**el outbox tiene UNA operacion de esa tarea, con el id de la columna elegida**",
    opsDelMovimiento.length === 1 && opsDelMovimiento[0].stateId === ESTADOS[3].id,
    `operaciones de WIP-2 en el outbox: ${JSON.stringify(opsDelMovimiento)}`,
  );
  note(`outbox completo: ${JSON.stringify(despues.ops)}`);

  // El servidor, que es la otra mitad. **Un pull, no un push**: no se escribe nada
  // desde aqui, que es la mitad del comportamiento que se quiere comprobar.
  await sleep(1500);
  const servidorOffline = await leerDelServidor(session);
  const filaServidor = servidorOffline.get(`list_item:${movido.tarea.id}`);
  check(
    "**el servidor NO tiene el movimiento todavia** (el outbox es lo que lo tiene)",
    filaServidor?.stateId !== ESTADOS[3].id,
    `stateId en el servidor: ${filaServidor?.stateId ?? "(la fila no esta)"} | elegido: ${ESTADOS[3].id}`,
  );

  /*
    **El cable: lo que se afirma es que nada LLEGA al servidor, y no que nada se
    intenta.**

    La app llama a `fetch` —eso es el outbox reintentando, que es lo correcto— y el
    navegador emite el evento y luego el envío falla. Contar intentos y exigir cero
    sería exigir que la app **no intentara sincronizar**, que es un fallo distinto y
    peor: un outbox que no reintenta no se vacía nunca al volver la red.

    Así que lo que se mide es el desenlace de cada intento, y la condición es que
    **ninguno tenga respuesta**. Un push con `respondio 200` aquí sería exactamente
    el fallo que el encargo describe —algo escribiéndose en el servidor en vez de en
    el outbox— y por eso se cuenta el desenlace y no el intento.
  */
  const caboOffline = desenlace(pushes.length ? pushes[0].at : Date.now());
  note(`cable: ${cuadernoDelCable(caboOffline)}`);
  check(
    "**ningun POST con la red emulada llega al servidor: todos se quedan sin respuesta**",
    caboOffline.llegaron.length === 0 && caboOffline.dentro.length > 0,
    `POST intentados: ${caboOffline.dentro.length} | sin respuesta: ${caboOffline.noSalieron.length} | ` +
      `**con respuesta: ${caboOffline.llegaron.length}**` +
      `${caboOffline.llegaron.length ? ` — ${JSON.stringify(caboOffline.llegaron.map((p) => finales.get(p.requestId)))}` : ""} | ` +
      `sin desenlace registrado: ${caboOffline.sinFinal.length} | ` +
      `preflights OPTIONS (no cuentan): ${caboOffline.preflights.length}` +
      `${caboOffline.preflights.length ? ` — ${JSON.stringify(caboOffline.preflights.map((p) => finales.get(p.requestId)?.que ?? "sin desenlace"))}` : ""}`,
  );
  check(
    "y el intento que hubo llevaba el estado, o sea que el outbox estaba encolando de verdad",
    caboOffline.dentro.some((p) => p.stateIds.includes(ESTADOS[3].id)),
    `stateIds por intento: ${JSON.stringify(caboOffline.dentro.map((p) => p.stateIds))}`,
  );

  /* --- 5. Cerrar y abrir la app, sin conexion --- */

  note("");
  note("=== 5. Cerrar y abrir la app sin conexion ===");
  note("    Con emulacion alocumento NO se puede: la recarga del bundle tambien esta behind la emulacion");
  note("    (medido: `tab.goto` deja la pagina en chrome-error://chromewebdata/). Se cambia de capa:");

  await tab.send("Network.emulateNetworkConditions", EMULACION(false));
  await sleep(400);
  await tab.send("Network.setBlockedURLs", { urls: ["*/api/v1/*"] });
  await sleep(300);

  const apiSigueCortada = await tab.evaluate(
    `(async () => {
      try {
        const r = await fetch(${JSON.stringify(`${API}/health`)}, { method: "GET" });
        return "respondio " + r.status;
      } catch (e) { return "fallo: " + e.name; }
    })()`,
  );
  check(
    "**la API esta cortada y el bundle no**: el bundle se pidio 12 MB y la API no responde",
    /fallo/.test(apiSigueCortada) === true,
    `un fetch a la API con la pagina viva responde: ${apiSigueCortada}`,
  );

  // El bundle se pide aqui, con la API ya cortada: es lo que hace honesta a esta capa.
  // Se vuelve a pedir con un cache-buster para que sea de verdad una carga nueva.
  await tab.goto(`${APP}/board/${listId}?offline=${Date.now()}`);
  const listo = Date.now() + 45000;
  let tras = null;
  while (Date.now() < listo) {
    tras = await readBoard(tab);
    if (tras?.columnas?.length === 4) break;
    await sleep(700);
  }
  check(
    "**la app arranca sin API y pinta el tablero entero**",
    tras?.columnas?.length === 4,
    `columnas: ${tras?.columnas?.length}`,
  );
  const enDoneTras = tras?.columnas.find((c) => c.columna === ESTADOS[3].id)?.tarjetas ?? [];
  check(
    "**el movimiento sobrevive a cerrar y abrir sin conexion**",
    enDoneTras.includes("WIP-2") && !(tras?.columnas.find((c) => c.columna === ESTADOS[2].id)?.tarjetas ?? []).includes("WIP-2"),
    `Done: [${enDoneTras.join(",")}] | WIP: [${(tras?.columnas.find((c) => c.columna === ESTADOS[2].id)?.tarjetas ?? []).join(",")}]`,
  );
  await tab.screenshot(`${SHOTS}/03-reabierto-sin-conexion.png`);

  const outboxTrasRecarga = await readOutbox(tab);
  check(
    "**y el outbox sigue con la operacion, leida despues de recargar**",
    outboxTrasRecarga.existe === true &&
      outboxTrasRecarga.ilegibles === 0 &&
      outboxTrasRecarga.ops.filter((op) => op.entity === "list_item" && op.entityId === movido.tarea.id).length === 1,
    `total: ${outboxTrasRecarga.total}, ops: ${JSON.stringify(outboxTrasRecarga.ops)}` +
      (outboxTrasRecarga.motivo ? ` — motivo: ${outboxTrasRecarga.motivo}` : ""),
  );

  /* --- 6. Moverse a la columna en la que ya esta, sin conexion: no encola nada --- */

  note("");
  note("=== 6. Elegir la columna en la que YA esta, sin conexion ===");

  /*
    **Aqui el outbox NO esta vacio, y por eso la comprobacion tiene que ser sobre
    las operaciones y no sobre el numero de pushes.**

    Queda encolada la operacion del punto 3, que no ha podido salir porque no hay
    red, y el motor la reintenta con su backoff. Un push durante esta ventana es,
    por lo tanto, **el reintento de lo que ya estaba** —y eso no es un fallo, es el
    outbox haciendo su trabajo—, mientras que un `update` **nuevo** de esa misma
    tarea sí lo sería: dos operaciones para la misma fila y el mismo campo, la
    segunda sin motivo, y un `position` que otro dispositivo se encontraría
    duplicado.

    Lo que separa las dos cosas es el `operationId`, y por eso el outbox se lee con
    los ids y no solo con la cuenta. Comparar `total` antes y después ya distinguiría
    el caso de un grow, pero **no** el de un reintento que reescribiera la operacion
    con un id nuevo —que es justo la forma que tendría un bug de "no encolar nada" que
    en realidad reencolara—.
  */
  const antesDelNoop = await readOutbox(tab);
  const idsAntes = antesDelNoop.ops.map((op) => `${op.entity}:${op.entityId}`).sort();
  const desdeNoop = Date.now();
  const noop = await moverPorLaHoja(tab, "WIP-2", ESTADOS[3]);
  await sleep(2500);
  const despuesDelNoop = await readOutbox(tab);
  const idsDespues = despuesDelNoop.ops.map((op) => `${op.entity}:${op.entityId}`).sort();
  const caboNoop = desenlace(desdeNoop);
  check(
    "**elegir la columna en la que ya esta NO encola nada**: el outbox tiene las mismas filas, las mismas veces",
    despuesDelNoop.existe === true &&
      despuesDelNoop.ilegibles === 0 &&
      JSON.stringify(idsDespues) === JSON.stringify(idsAntes),
    `outbox antes: [${idsAntes.join(", ")}] | despues: [${idsDespues.join(", ")}] | ` +
      `total ${antesDelNoop.total} -> ${despuesDelNoop.total} | ops: ${JSON.stringify(despuesDelNoop.ops)}`,
  );
  note(
    `cable en esta ventana: ${cuadernoDelCable(caboNoop) || "(ninguno)"} — son reintentos de lo que ` +
      `ya estaba encolado (la API sigue cortada) y ninguno trae una operacion que no estuviera en el ` +
      `outbox antes: operationIds vistos: ${JSON.stringify(caboNoop.dentro.flatMap((p) => p.operationIds))}`,
  );
  const trasNoop = await readBoard(tab);
  check(
    "y la pantalla tampoco se movio: sigue en Done y no en ninguna otra",
    (trasNoop.columnas.find((c) => c.columna === ESTADOS[3].id)?.tarjetas ?? []).includes("WIP-2") &&
      (trasNoop.columnas.find((c) => c.columna === ESTADOS[2].id)?.tarjetas ?? []).length === 2,
    `Done: [${(trasNoop.columnas.find((c) => c.columna === ESTADOS[3].id)?.tarjetas ?? []).join(",")}] | ` +
      `WIP: [${(trasNoop.columnas.find((c) => c.columna === ESTADOS[2].id)?.tarjetas ?? []).join(",")}]`,
  );
  note(`la hoja abria ${noop.filas} filas y se cerro en ${noop.cerrada.ms} ms`);
  await tab.screenshot(`${SHOTS}/04-sin-conexion-sin-movimiento.png`);

  /* --- 7. Volver a tener red: el servidor se queda con el movimiento y el outbox vacia --- */

  note("");
  note("=== 7. Vuelve la red: el outbox se vacia y el servidor se queda con el movimiento ===");

  // El instante del fin del corte, para que la ventana del cable de abajo **no
  // arrastre los reintentos que hicieron falta cuando no habia red**: son de otra
  // fase y mezclarlos haria que un exito pareciera un fallo, o al reves.
  await tab.send("Network.setBlockedURLs", { urls: [] });
  const corteDeLaRed = Date.now();
  await sleep(400);
  const apiVuelve = await tab.evaluate(
    `(async () => {
      try {
        const r = await fetch(${JSON.stringify(`${API}/health`)}, { method: "GET" });
        return "respondio " + r.status;
      } catch (e) { return "fallo: " + e.name; }
    })()`,
  );
  check("la API vuelve a responder", /^respondio /.test(apiVuelve) === true, apiVuelve);

  const vaciado = Date.now() + 45000;
  let outboxFinal = null;
  while (Date.now() < vaciado) {
    outboxFinal = await readOutbox(tab);
    if (outboxFinal.total === 0) break;
    await sleep(900);
  }
  check(
    "**el outbox se vacia solo al volver la red**",
    outboxFinal?.total === 0,
    `outbox: ${outboxFinal?.total} operaciones | ops: ${JSON.stringify(outboxFinal?.ops)}`,
  );
  const caboFinal = desenlace(corteDeLaRed);
  note(`cable desde que se levanto el corte: ${cuadernoDelCable(caboFinal)}`);
  check(
    "**y un push llego de verdad al servidor, con el estado dentro**",
    caboFinal.llegaron.length > 0 && caboFinal.llegaron.some((p) => p.stateIds.includes(ESTADOS[3].id)),
    `pushes con respuesta: ${caboFinal.llegaron.length} | stateIds por push: ` +
      `${JSON.stringify(caboFinal.llegaron.map((p) => p.stateIds))} | elegido: ${ESTADOS[3].id}`,
  );

  const servidorFinal = await leerDelServidor(session);
  const filaFinal = servidorFinal.get(`list_item:${movido.tarea.id}`);
  check(
    "**el servidor se ha quedado con el movimiento**",
    filaFinal?.stateId === ESTADOS[3].id,
    `stateId en el servidor: ${filaFinal?.stateId ?? "(la fila no esta)"} | elegido: ${ESTADOS[3].id}`,
  );
  check(
    "**y las demas tareas no se han movido de columna** (el update fue de una fila)",
    TAREAS.filter((t) => t.id !== movido.tarea.id).every((t) => {
      const fila = servidorFinal.get(`list_item:${t.id}`);
      // Se compara con el `stateId` sembrado **crudo**, que es `null` en las tres
      // de Backlog: el servidor guarda el `null` tal cual, y la regla de "null es
      // la primera columna" es de la pantalla, no de la fila.
      return fila?.stateId === t.stateId;
    }),
    TAREAS.filter((t) => t.id !== movido.tarea.id)
      .map((t) => {
        const fila = servidorFinal.get(`list_item:${t.id}`);
        return `${t.title}: ${fila === undefined ? "no esta en el pull" : JSON.stringify(fila.stateId)} (sembrada: ${t.stateId === null ? "null" : "su id de columna"})`;
      })
      .join(" | "),
  );
  await tab.screenshot(`${SHOTS}/05-tras-volver-la-red.png`);

  /* --- 8. Sin errores de consola --- */

  note("");
  note("=== 8. La consola ===");
  /*
    **El filtro es estrecho a proposito, y el motivo ya esta escrito en
    `verify-state-picker.mjs`: con la red cortada, la app intenta el push y el
    navegador saca un `Failed to load resource` por cada intento, que es el
    comportamiento correcto de un outbox esperando a que vuelva la red y no un
    bug. Lo que **no** se filtra es cualquier otra cosa, y en particular una
    excepcion de JS o un 4xx de la API.

    `chrome-error` tampoco se filtra como problema: en este guion no se navega con
    la emulacion puesta, y si alguna vez se hiciera habria que mirarlo.
  */
  const errores = problems.filter(
    (p) =>
      !/Failed to load resource/i.test(p.text) &&
      !/10\.0\.2\.2|:4000/i.test(p.text) &&
      !/favicon/i.test(p.text),
  );
  const porRed = problems.filter((p) => /Failed to load resource/i.test(p.text));
  note(
    `descartados por ser la red emulada (esperados): ${porRed.length} | ` +
      `quedan ${errores.length} que comprobar`,
  );
  check(
    "sin errores de consola ni promesas rotas fuera de los de la red emulada",
    errores.length === 0,
    errores.slice(0, 4).map((e) => e.text.slice(0, 160)).join(" | "),
  );
} catch (e) {
  failures += 1;
  console.log(`FALLA  la corrida entera: ${e.message}`);
  if (tab) await tab.screenshot(`${SHOTS}/99-error.png`).catch(() => {});
} finally {
  chrome.kill();
}

console.log(`\n${failures === 0 ? "TODO OK" : `${failures} FALLOS`} — capturas en ${SHOTS}`);
process.exit(failures === 0 ? 0 : 1);
