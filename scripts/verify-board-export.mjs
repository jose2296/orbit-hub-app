#!/usr/bin/env node
/**
 * El CSV de un tablero, y el hecho de que no hay puerta para pedirlo.
 *
 *   node scripts/verify-board-export.mjs
 *
 * ---
 *
 * **Que el CSV de un tablero lleve `estado` y no `completado` ya esta probado**, en
 * `apps/api/test/export-builders.test.ts`, con `exportCsvColumnsFor('board')`. Eso es
 * la funcion. Este guion no la vuelve a probar: mira el **fichero que baja la
 * persona**, con su cabecera y sus celdas, porque entre la funcion y el fichero hay
 * el `Content-Type`, el `Content-Disposition`, el nombre, y una fila que sale
 * `; ; ;` porque el titulo del estado no llego.
 *
 * ---
 *
 * **Y el hallazgo que hace que este guion exista: desde el tablero no se puede
 * exportar nada.** El punto 8 del brief pide "exporta a CSV" como el ultimo paso de
 * un recorrido que empieza en el tablero, y el tablero **no monta ningun menu**.
 * `ListMenuSheet` —que es donde vive el boton de exportar— esta montado en tres
 * sitios: `list/[listId].tsx`, `workspace/[workspaceId].tsx` y
 * `media-list-screen.tsx`. El cuarto, `board/[listId].tsx`, no lo monta, y su unica
 * accion de cabecera es `board-states-button` (`useHeaderAction`, una sola llamada en
 * todo el fichero).
 *
 * O sea que la puerta de salida de un tablero esta en la pantalla de **espacios**,
 * en la fila del tablero, y no en el tablero. Se llega, pero hay que saber que esta
 * ahi. Este guion comprueba las dos mitades por separado, porque son dos hechos
 * distintos y uno no sustituye al otro:
 *
 *   1. **que el tablero no tenga puerta de exportacion**, contando los controles de
 *      su cabecera y sus hojas — y no por leer el codigo, que es lo que un recorrido
 *      no puede hacer;
 *   2. **que el CSV que sale por la puerta que si hay lleve `estado` y no
 *      `completado`**, con el fichero abierto de verdad.
 *
 * ---
 *
 * **El fichero se lee del disco, y no de lo que la pagina tiene en memoria.** La
 * descarga de la web es un `blob` y un `<a download>` (`lib/export/save.ts`), asi que
 * la unica forma de mirar el CSV que una persona se lleva es dejar que el navegador
 * lo escriba en un directorio y abrir ese fichero. Se usa `Page.setDownloadBehavior`
 * con `downloadPath`, que es lo que convierte el `click()` de `save.ts` en un
 * fichero en disco.
 *
 * Y **el fichero se abre despues de que la descarga haya terminado**, preguntando al
 * directorio cada 200 ms, y **la comprobacion falla si no aparece** en 30 s. Un
 * `catch` que se comiera la espera daria un "el CSV no lleva completado" que en
 * realidad seria un "el fichero no llego nunca", que es un fallo distinto y mas
 * grande.
 *
 * ---
 *
 * **Lo que este guion no puede comprobar.**
 *
 *   - **El fichero en un telefono.** En nativo la descarga pasa por
 *     `expo-file-system` y `expo-sharing`, y lo que se abre despues es el panel de
 *     compartir del sistema. Nada de eso se ve aqui.
 *   - **Que Excel lo abra sin quejarse**, que es el motivo por el que `typeOf` pone
 *     `text/csv` y no `application/json`. Se comprueba el `Content-Type` que manda la
 *     API, no lo que hace una hoja de calculo al recibirlo.
 *   - **El panel de resultados** de la exportacion —el que dice cuantos elementos
 *     salieron— que es de la pantalla de espacios, no del tablero.
 */

import { randomUUID } from "node:crypto";
import { execSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { launchChrome, openTab, seedSession, collectProblems } from "./cdp.mjs";

const APP = process.env.APP_URL ?? "http://localhost:8087";
const API = process.env.API_URL ?? "http://localhost:4100/api/v1";
const SHOTS = process.env.SHOTS ?? "/tmp/orbit-board-export";
const DESCARGAS = process.env.DESCARGAS ?? join(SHOTS, "descargas");
const CLIENT = "verify-board-export";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * El log de la API, leido del proceso que esta escuchando de verdad.
 *
 * **Con reintentos, porque `lsof` aqui puede no arrancar y el guion no debe
 *$meter eso en el bolsillo de la app.** Medido en esta maquina: con muchos procesos
 * de otras herramientas, `lsof` responde `can't fork: Resource temporarily
 * unavailable`; sin reintentos el `execSync` lanza y, si eso lo traga un `catch`,
 * la ruta del log sale **vacia**, `readLog` devuelve `""` y el guion acaba
 * diciendo que la API no mando el correo de verificacion. La API lo mando. Lo que
 * no se pudo fue leerlo.
 *
 * Por eso si tras los intentos no hay ruta, **se dice exactamente eso y se para**.
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
      "Es el entorno, no la app: sin `lsof` no hay forma de encontrar el correo de " +
      "verificacion, y el guion no debe reportar eso como un fallo de la API.",
  );
}

const EMAIL_LOG = logOfTheApi();
/**
 * El log entero, **y sin `catch` que lo degrade a `""`**.
 *
 * Un log ilegible devuelto como log vacio hace que el correo de verificacion
 * parezca no haber salido nunca, y eso es una acusacion falsa contra la API que
 * si lo mando. El error se propaga.
 */
const readLog = () => readFile(EMAIL_LOG, "utf8");

const IP = `10.90.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}`;

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
/** Cuantos `check` se han emitido, para que la cuenta no haya que hacerla a mano. */
let emitidos = 0;
const check = (name, ok, detail = "") => {
  emitidos += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? "ok    " : "FALLA "} ${name}${detail ? ` — ${detail}` : ""}`);
};
const note = (text) => console.log(`      ${text}`);

/**
 * Las ramas del punto 3 que **no se han podido medir**, y que por eso ponen la
 * corrida en rojo.
 *
 * El punto 3 son cinco `if` anidados —el boton de menu, la hoja, la fila de exportar,
 * el CSV y el fichero— y cada uno podia no cumplirse sin que saliera **ningun**
 * `check`: el `else` de fuera escribia una nota ("no se ha podido medir y sale como
 * tal") y la corrida terminaba en `TODO OK` con codigo 0 y **cuatro o cinco
 * comprobaciones menos**. No es hipotetico: en §6.5 del informe de la Task 15 el
 * selector cogia la fila del cajon, `fila.menu` salia `null`, y el resultado fue un
 * verde con menos comprobaciones.
 *
 * Por eso `saltar` **no es una nota**: acumula, y al final de la corrida cada rama
 * saltada emite su propio `check` en `FALLA`. Un guion que se salta una rama no ha
 * comprobado menos y ha comprobado lo mismo: sale en rojo y dice cual.
 */
const saltadas = [];
const saltar = (guardia, porQue) => {
  saltadas.push({ guardia, porQue });
  note(`rama NO medida: ${guardia} — ${porQue}`);
};

/** Las ramas saltadas, como `check` de verdad, al final de la corrida. */
function reportarSaltadas() {
  if (!saltadas.length) return 0;
  note("");
  note(`=== 4. Ramas del punto 3 que NO se han podido medir: ${saltadas.length} ===`);
  for (const s of saltadas) {
    check(`**la rama "${s.guardia}" se ha medido**`, false, `${s.porQue} — sus comprobaciones NO se han hecho, y por eso esto sale en rojo y no en un verde con menos checks`);
  }
  return saltadas.length;
}

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

async function leerDelServidor(sesion) {
  const r = await apiConEspera("/sync/pull", {
    method: "POST",
    token: sesion.accessToken,
    body: { deviceId: randomUUID(), lastPulledAt: null, clientTimestamp: new Date().toISOString() },
  });
  const mapa = new Map();
  for (const cambio of r.body?.data?.changes ?? []) {
    if (cambio?.entity && cambio?.record) mapa.set(`${cambio.entity}:${cambio.record.id}`, cambio.record);
  }
  return mapa;
}

async function account() {
  const password = "a-very-long-password";
  const device = { label: "board-export", platform: "web" };
  const email = `board-export-${Date.now().toString(36)}@example.com`;

  const before = await readLog();
  const alta = await apiConEspera("/auth/register", {
    method: "POST",
    body: { email, password, displayName: "Export", locale: "es", acceptedTermsAt: new Date().toISOString(), device },
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
 * Un tablero de cuatro columnas con una tarea en cada una, **y una lista de tareas
 * al lado**, que es la contraprueba: la regla del spec es que el CSV depende del
 * tipo de lista, y una comprobacion que solo mira el tablero no puede distinguir
 * "el tablero cambia las columnas" de "este endpoint cambio las columnas para
 * todos". Las dos se piden por el mismo camino y con el mismo cliente.
 */
const ESTADOS = [
  { id: randomUUID(), title: "Backlog", color: "neutral" },
  { id: randomUUID(), title: "Ready", color: "blue" },
  { id: randomUUID(), title: "WIP", color: "amber" },
  { id: randomUUID(), title: "Done", color: "green" },
];

const session = await account();
const ws = randomUUID();
const boardId = randomUUID();
const listaId = randomUUID();
const at = new Date().toISOString();

const TAREAS = ESTADOS.map((estado, indice) => ({
  id: randomUUID(),
  titulo: `Envío-${estado.title}`,
  position: indice,
  // La primera con `stateId` nulo, que es lo que hace el cliente: el CSV tiene que
  // decir "Backlog" de todas formas, porque `csvStateCell` resuelve con `stateOf`.
  stateId: indice === 0 ? null : estado.id,
}));

const TAREAS_LISTA = [0, 1].map((n) => ({
  id: randomUUID(),
  titulo: `Pendiente-${n + 1}`,
  position: n,
  completed: n === 0,
}));

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
        payload: { name: "Envíos", color: "teal" },
      },
      {
        operationId: randomUUID(),
        clientId: CLIENT,
        entity: "list",
        kind: "create",
        entityId: boardId,
        baseVersion: 0,
        base: null,
        clientTimestamp: at,
        // **Sin carpeta, a proposito.** La puerta de la fila vive en la pantalla del
        // espacio, y con la lista dentro de una carpeta habria que abrir la carpeta
        // primero: dos pasos para una comprobacion que es de una. `folderId: null`
        // deja las dos listas en la raiz, que es donde las ve una persona que acaba
        // de crear el tablero.
        payload: { workspaceId: ws, folderId: null, title: "Tablero de prueba", kind: "board", orderMode: "manual", states: ESTADOS },
      },
      {
        operationId: randomUUID(),
        clientId: CLIENT,
        entity: "list",
        kind: "create",
        entityId: listaId,
        baseVersion: 0,
        base: null,
        clientTimestamp: at,
        payload: { workspaceId: ws, folderId: null, title: "Lista de prueba", kind: "tasks", orderMode: "manual" },
      },
      ...[...TAREAS.map((t) => ({ ...t, listId: boardId })), ...TAREAS_LISTA.map((t) => ({ ...t, listId: listaId }))].map(
        (t) => ({
          operationId: randomUUID(),
          clientId: CLIENT,
          entity: "list_item",
          kind: "create",
          entityId: t.id,
          baseVersion: 0,
          base: null,
          clientTimestamp: at,
          payload: {
            listId: t.listId,
            title: t.titulo,
            position: t.position,
            ...(t.stateId !== undefined ? { stateId: t.stateId } : {}),
            ...(t.completed !== undefined ? { completed: t.completed } : {}),
          },
        }),
      ),
    ],
  },
});

/*
  **El codigo de la respuesta no es el estado de las operaciones.** Un push con
  operaciones rechazadas es un 200 con `rejected` dentro.
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

const servidor = await leerDelServidor(session);
check(
  "el servidor tiene las dos listas con el tipo que les toca",
  servidor.get(`list:${boardId}`)?.kind === "board" && servidor.get(`list:${listaId}`)?.kind === "tasks",
  `tablero: ${servidor.get(`list:${boardId}`)?.kind} | lista: ${servidor.get(`list:${listaId}`)?.kind}`,
);

/**
 * Una linea del CSV en celdas, **respetando las comillas**.
 *
 * `csvCell` de `export-builders.ts` envuelve **cada** celda en comillas dobles y
 * solo dobla las comillas de dentro, asi que un punto y coma dentro de una celda no
 * separa nada para un lector que sepa de CSV. Un `split(';')` a lo bruto devuelve
 * `"Backlog"` con sus comillas, y comparar eso con `Backlog` da un fallo que parece
 * del endpoint y es del guion.
 *
 * Por que importa mas alla de la comodidad: **una comprobacion que parte el CSV con
 * `split(';')` no puede encontrar un titulo con punto y coma dentro**, que es
 * justamente el caso que separaria las columnas de verdad. El mismo troceador se
 * usa en las dos mitades —la del endpoint y la del fichero descargado— y por eso las
 * dos son comparables entre si.
 */
const celdasDe = (linea) => {
  const celdas = [];
  let actual = "";
  let dentro = false;
  for (let i = 0; i < linea.length; i += 1) {
    const c = linea[i];
    if (c === '"') {
      // `""` dentro de una celda es una comilla literal, no el cierre y la
      // reapertura. Sin esta distincion, un titulo con comillas correria las
      // columnas de la fila entera.
      if (dentro && linea[i + 1] === '"') {
        actual += '"';
        i += 1;
      } else {
        dentro = !dentro;
      }
      continue;
    }
    if (c === ";" && !dentro) {
      celdas.push(actual);
      actual = "";
      continue;
    }
    actual += c;
  }
  celdas.push(actual);
  return celdas;
};

/** La cabecera y las filas del CSV, ya troceadas y sin la fila vacia final. */
function tablaDe(texto) {
  // **El BOM se quita antes de trocear, y por que importa.** El fichero que descarga
  // el navegador trae `\uFEFF` delante de la primera celda —medido en la corrida que
  // escribio esto: la cabecera empieza por `﻿id`—, y sin quitarlo la primera columna
  // se llama `\uFEFFid` en vez de `id`. No rompe el indice de `estado`, que es el que
  // se mira, pero haria que una comprobacion de "la primera columna es `id`" pasara
  // por algo que no es cierto. El BOM se quita una vez y se dice.
  const limpio = texto.replace(/^\uFEFF/, "");
  const lineas = limpio.split("\n").filter((l) => l.trim().length > 0);
  return {
    conBom: limpio.length !== texto.length,
    lineas,
    cabecera: celdasDe(lineas[0] ?? ""),
    filas: lineas.slice(1).map(celdasDe),
  };
}

/* ------------------------------------------------------------------ el endpoint, por las dos formas */

note("");
note("=== 1. El endpoint, con el mismo token que usa la app ===");

/**
 * El CSV crudo, con sus cabeceras, **sin parsear**.
 *
 * Se pide por `fetch` y no por la UI porque este bloque responde a una pregunta
 * distinta del bloque 2: aqui importa **lo que dice el servidor** —la cabecera, el
 * `Content-Type`, el nombre del fichero— y el bloque 2 responde a si una persona
 * puede llegar a pedirlo. Confundir las dos seria medir el endpoint y creer que se
 * ha medido la pantalla.
 */
async function csvDe(listId) {
  const r = await fetch(`${API}/lists/${listId}/export?format=csv`, {
    headers: { authorization: `Bearer ${session.accessToken}`, "x-forwarded-for": IP },
  });
  return {
    status: r.status,
    contentType: r.headers.get("content-type"),
    disposition: r.headers.get("content-disposition"),
    texto: await r.text(),
  };
}

const csvTablero = await csvDe(boardId);
const tablaTablero = tablaDe(csvTablero.texto);
const cabeceraTablero = tablaTablero.lineas[0] ?? "";
const columnasTablero = tablaTablero.cabecera;
const indiceEstado = columnasTablero.indexOf("estado");
const indiceCompletado = columnasTablero.indexOf("completado");
const indiceTitulo = columnasTablero.indexOf("titulo");

note(`cabecera del tablero: ${cabeceraTablero}`);
note(`Content-Type: ${csvTablero.contentType}`);
note(`Content-Disposition: ${csvTablero.disposition}`);
note(`lineas: ${tablaTablero.lineas.length} (cabecera + ${tablaTablero.filas.length} tareas)`);

check(
  "**el CSV del tablero tiene `estado` y NO tiene `completado`**",
  indiceEstado >= 0 && indiceCompletado === -1,
  `columnas: ${columnasTablero.length} | indice de "estado": ${indiceEstado} | indice de "completado": ${indiceCompletado}`,
);
check(
  "**`estado` ocupa el sitio que ocupaba `completado`**, y `year` sigue en el 8",
  indiceEstado === 3 && columnasTablero.indexOf("year") === 8,
  `"estado" en ${indiceEstado} (esperado 3) | "year" en ${columnasTablero.indexOf("year")} (esperado 8) | ` +
    `cabecera: ${cabeceraTablero}`,
);
check(
  "el tablero devuelve CSV de verdad: `text/csv` y quince columnas",
  /^text\/csv/.test(csvTablero.contentType ?? "") && columnasTablero.length === 15,
  `Content-Type: ${csvTablero.contentType} | columnas: ${columnasTablero.length}`,
);
check(
  "y el nombre del fichero sale del servidor, en `Content-Disposition`",
  /filename\*?=/.test(csvTablero.disposition ?? "") && /\.csv/.test(csvTablero.disposition ?? ""),
  `Content-Disposition: ${csvTablero.disposition}`,
);

/*
  **Las celdas, y no solo la cabecera.** Una cabecera con `estado` y quince columnas
  es exactamente lo mismo con una celda vacia debajo, que es lo que sale si el
  titulo del estado no llega: `csvStateCell` devuelve `stateOf(...)?.title ?? ""`, y
  un `""` en un CSV es una celda vacia, no un error.
*/
const celdas = tablaTablero.filas;
const estadosEscritos = celdas.map((c) => c[indiceEstado] ?? "(fuera de rango)");
const estadosEsperados = ESTADOS.map((e) => e.title);
check(
  "**cada celda dice el TITULO del estado, y no su id**",
  JSON.stringify(estadosEscritos) === JSON.stringify(estadosEsperados),
  `celdas: ${JSON.stringify(estadosEscritos)} | esperado: ${JSON.stringify(estadosEsperados)}`,
);
check(
  "**la tarea con `stateId` nulo sale en el PRIMERO**, como la dibuja la pantalla",
  celdas[0]?.[indiceEstado] === ESTADOS[0].title && celdas[0]?.[indiceTitulo] === TAREAS[0].titulo,
  `primera fila: titulo "${celdas[0]?.[indiceTitulo]}", estado "${celdas[0]?.[indiceEstado]}" ` +
    `(sembrada con stateId ${JSON.stringify(TAREAS[0].stateId)})`,
);
check(
  "y salen todas las tareas del tablero, en el orden de sus columnas",
  celdas.length === TAREAS.length && celdas.every((c, i) => c[indiceTitulo] === TAREAS[i].titulo),
  `filas: ${celdas.length} | titulos: ${JSON.stringify(celdas.map((c) => c[indiceTitulo]))}`,
);

/** La contraprueba: el mismo endpoint, el mismo cliente, una lista que no es tablero. */
const csvLista = await csvDe(listaId);
const columnasLista = tablaDe(csvLista.texto).cabecera;
check(
  "**y una lista de tareas SI lleva `completado` y NO lleva `estado`** (la regla es por tipo)",
  columnasLista.includes("completado") && !columnasLista.includes("estado"),
  `cabecera de la lista: ${columnasLista.join(";")}`,
);
check(
  "las dos cabeceras tienen el mismo numero de columnas, que es lo que mantiene los indices",
  columnasLista.length === columnasTablero.length,
  `tablero: ${columnasTablero.length} columnas | lista: ${columnasLista.length}`,
);

/* ------------------------------------------------------------------ la puerta, en la pantalla */

note("");
note("=== 2. La puerta: se busca en el tablero y se cuenta ===");

rmSync(DESCARGAS, { recursive: true, force: true });
mkdirSync(DESCARGAS, { recursive: true });

const chrome = await launchChrome({ width: 1440, height: 900 });
let tab;
try {
  tab = await openTab(chrome.port);
  await tab.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  /*
    **La descarga se convierte en fichero con `Page.setDownloadBehavior`.** Es lo que
    hace que el `blob` + `<a download>` de `lib/export/save.ts` escriba en disco, y
    sin esto no hay ningun fichero que abrir: el `URL.createObjectURL` se revoca en
    cuanto termina el `click()` y el blob no existe despues.
  */
  await tab.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: DESCARGAS });

  const problems = collectProblems(tab);
  const PONER_TEMA = (apariencia) =>
    tab.evaluate(`localStorage.setItem('orbithub:appearance', ${JSON.stringify(
      JSON.stringify({ appearance: apariencia, accent: "orbit" }),
    )})`);

  await seedSession(tab, session, APP);
  await PONER_TEMA("light");
  await tab.goto(`${APP}/board/${boardId}`);

  const listo = Date.now() + 45000;
  let abierto = null;
  while (Date.now() < listo) {
    /*
      **Todos los botones de la pantalla, con su etiqueta, y no solo los que tienen
      `testID`.** La pregunta es "hay una puerta de exportar aqui", y una puerta sin
      `testID` es tan puerta como una con `testID`: buscarla solo entre los `testID`
      daria "no hay" por un motivo que no es el motivo.

      Y el motivo de que esto viva en una cadena y no en un fichero aparte es que el
      codigo de la pagina no puede llevar acentos graves dentro de este literal:
      cierra la cadena y el \`evaluate\` se come el resto del fichero.
    */
    abierto = await tab.evaluate(`(() => {
      const slots = [...document.querySelectorAll('[data-testid^="board-slot-"]')];
      return {
        columnas: slots.length,
        botones: [...document.querySelectorAll('button, [role=button], a')].map((el) => {
          const r = el.getBoundingClientRect();
          return {
            testId: el.getAttribute('data-testid'),
            etiqueta: (el.getAttribute('aria-label') || el.innerText || el.textContent || '')
              .replace(/[\\uE000-\\uF8FF]/g, '')
              .trim()
              .slice(0, 40),
            visible: r.width > 0 && r.height > 0,
          };
        }).filter((b) => b.visible),
      };
    })()`);
    if (abierto?.columnas === 4) break;
    await sleep(600);
  }
  check("el tablero se abre con sus cuatro columnas", abierto?.columnas === 4, `columnas: ${abierto?.columnas}`);
  await tab.screenshot(`${SHOTS}/01-tablero-sin-puerta-de-exportar.png`);

  const visibles = abierto?.botones ?? [];
  const etiquetadas = visibles.map((b) => `${b.testId ?? "(sin testID)"}: ${b.etiqueta}`);
  note(`controles visibles en el tablero (${visibles.length}):`);
  for (const b of etiquetadas) note(`  - ${b}`);

  /*
    **Se busca la palabra "export" en la etiqueta, en los dos idiomas.**

    **Este check esta INVERTIDO y es una trampa para quien lo arregle: pone en verde
    porque la puerta NO existe.** Es el defecto de §6.1, declarado y no arreglado por
    decision —el plan no lo pide en ninguna de sus quince tareas—, asi que mientras la
    puerta no exista el check es correcto y describe el defecto. **El dia que se monte
    un `ListMenuSheet` en `board/[listId].tsx`, este check pasa a rojo**: eso no sera un
    fallo del guion, sera el defecto arreglado, y habra que cambiarlo por el otro
    (`>= 1` puerta de exportacion). Por eso lleva `TODO(bug)` al lado y la nota de
    abajo: para que nadie lo lea como "el tablero no tiene puerta, y eso es lo
    correcto".
  */
  const pareceExportar = visibles.filter((b) => /export|csv|descarg|download/i.test(b.etiqueta));
  check(
    "**el tablero no tiene ninguna puerta de exportar** (ni por `testID`, ni por etiqueta, en ningun idioma)  // TODO(bug): este check se pone ROJO cuando se arregle, y hay que invertirlo",
    pareceExportar.length === 0,
    pareceExportar.length
      ? `parecen puertas: ${JSON.stringify(pareceExportar)}`
      : `${visibles.length} controles visibles, ninguno de exportacion; el unico de cabecera es board-states-button`,
  );
  if (pareceExportar.length === 0) {
    note("ATENCION, este ok es un DEFECTO de producto, no una buena noticia: el tablero no tiene forma de exportar.");
    note("TODO(bug): montar `ListMenuSheet` en board/[listId].tsx. Cuando exista, este check sale en rojo y hay que invertirlo.");
    note('Defecto registrado en docs/verificacion-en-navegador.md, fila "Una pantalla nueva sin ListMenuSheet".');
  }
  /*
    **El nombre dice lo que la condicion mide, y lo medido va ahi al lado.**

    El nombre de antes era *"y su unica accion de cabecera es el editor de estados"* y
    la condicion contaba **un `testID`**: `visibles.filter((b) => b.testId ===
    "board-states-button").length === 1`. Un **segundo** boton de cabecera con **otro**
    `testID` —que es exactamente lo que pasaria al montar el `ListMenuSheet`— pasaria
    en verde, y el nombre estaria afirmando algo que nadie ha mirado.

    No se puede afirmar de otra forma sin inventar el metodo: **la cabecera no esta
    marcada en el DOM.** `app-header.tsx` no le pone `testID` a su contenedor —la barra
    se dibuja con `styles.fondo`, `styles.fila` y `styles.derecha`—, y sus unicas
    marcas son `titulo-cabecera` y lo que cada pantalla pone en `slotAccion()`. Decidir
    "este boton es de cabecera" por su geometria seria una regla inventada aqui dentro,
    que es la clase de cosa que se rompe en cuanto se toca el layout.

    Asi que el check mide lo que puede y **el `detail` lleva los demas `testID`
    visibles**, para que un boton de cabecera nuevo aparezca en la salida en vez de
    esconderse detras de un nombre que no lo afirmaba.
  */
  check(
    "y el boton de cabecera del tablero es el editor de estados (medido por `testID`: el nombre no afirma que sea el unico de la barra)",
    visibles.filter((b) => b.testId === "board-states-button").length === 1,
    `botones con testID board-states-button: ${visibles.filter((b) => b.testId === "board-states-button").length}` +
      ` | los demas controles CON testID: ${
        visibles.filter((b) => b.testId && b.testId !== "board-states-button").map((b) => b.testId).join(", ") || "(ninguno)"
      }`,
  );

  /* --- la puerta que si hay: la fila del tablero en la pantalla de espacios --- */

  note("");
  note("=== 3. La puerta que si existe: la fila del tablero, en la pantalla del espacio ===");

  await tab.goto(`${APP}/workspace/${ws}`);

  /*
    **El cajon se cierra antes de buscar la fila, y es un paso de verdad.**
  */
  const hayCajon = await tab.evaluate(`(() => {
    const b = document.querySelector('[data-testid="drawer-button"]');
    if (!b) return false;
    const r = b.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  })()`);
  if (hayCajon) {
    const centro = await tab.evaluate(`(() => {
      const r = document.querySelector('[data-testid="drawer-button"]').getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`);
    await tab.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: centro.x, y: centro.y, radiusX: 8, radiusY: 8, force: 1 }],
    });
    await sleep(80);
    await tab.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await sleep(900);
    note("el cajon estaba abierto y se ha cerrado: sus filas tienen el mismo nombre que las del contenido");
  }

  const filaLista = Date.now() + 45000;
  let fila = null;
  while (Date.now() < filaLista) {
    fila = await tab.evaluate(`(() => {
      // **El de la derecha, no el primero.**
      //
      // El cajon lleva una fila por lista con el MISMO nombre, asi que hay dos
      // elementos con aria-label "Tablero de prueba": el del cajon, a la izquierda, y
      // el del contenido, a la derecha. Buscar el primero pulsaba el menu del cajon —
      //que mueve el foco del cajon y no abre nada—, y la comprobacion fallaba con
      //"no hay sheet-panel" sin que hubiera nada malo en la hoja. Se coge el de la
      //derecha porque el cajon esta siempre a la izquierda.
      const candidatos = [...document.querySelectorAll('[aria-label]')]
        .filter((el) => (el.getAttribute('aria-label') || '') === 'Tablero de prueba')
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter((c) => c.r.width > 0 && c.r.height > 0)
        .sort((a, b) => a.r.left - b.r.left);
      const tablero = candidatos[candidatos.length - 1];
      if (!tablero) return { encontrado: false, candidatos: candidatos.length };
      const r = tablero.r;
      const botones = [...document.querySelectorAll('button, [role=button]')].map((el) => ({
        el,
        r: el.getBoundingClientRect(),
      })).filter((b) => b.r.width > 0 && b.r.height > 0 && b.r.left > r.left);
      // El boton de menu es **el de la derecha**, no el primero: la fila tiene el
      // titulo pulsable y el menu, y pulsar el titulo abre la lista en vez del menu.
      // Se ordena de izquierda a derecha y se coge el ultimo, y se enseña la fila
      // entera para que se vea que son dos y no uno.
      const enLaFila = botones
        .filter((b) => b.r.top >= r.top - 8 && b.r.bottom <= r.bottom + 8)
        .sort((a, b) => a.r.left - b.r.left);
      const menu = enLaFila[enLaFila.length - 1];
      return {
        encontrado: true,
        fila: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
        menu: menu
          ? {
              x: Math.round(menu.r.left + menu.r.width / 2),
              y: Math.round(menu.r.top + menu.r.height / 2),
              etiqueta: (menu.el.getAttribute('aria-label') || menu.el.innerText || '').slice(0, 40),
            }
          : null,
        controles: enLaFila.length,
        candidatos: candidatos.length,
        todos: enLaFila.map((b) => ({
          etiqueta: (b.el.getAttribute('aria-label') || b.el.innerText || '').slice(0, 30),
          x: Math.round(b.r.left),
        })),
      };
    })()`);
    if (fila?.encontrado) break;
    await sleep(700);
  }
  check("la fila del tablero aparece en la pantalla del espacio", fila?.encontrado === true, `encontrado: ${fila?.encontrado}`);
  note(`la fila tiene ${fila?.controles ?? 0} control(es): ${JSON.stringify(fila?.todos)} | el de menu es el ultimo: ${JSON.stringify(fila?.menu)}`);
  await tab.screenshot(`${SHOTS}/02-espacio-con-la-fila.png`);

  if (!fila?.menu) {
    saltar(
      "el boton de menu de la fila",
      `la fila se encontro con ${fila?.controles ?? 0} control(es) pero el ultimo, el de menu, salio ${JSON.stringify(fila?.menu)}`,
    );
  }
  if (fila?.menu) {
    await tab.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: fila.menu.x, y: fila.menu.y, radiusX: 8, radiusY: 8, force: 1 }],
    });
    await sleep(80);
    await tab.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await sleep(700);

    const hoja = await tab.evaluate(`(() => {
      const paneles = [...document.querySelectorAll('[data-testid="sheet-panel"]')];
      const panel = paneles[paneles.length - 1] ?? null;
      if (!panel) return null;
      const r = panel.getBoundingClientRect();
      return {
        texto: panel.innerText,
        filas: [...panel.querySelectorAll('button, [role=button]')].map((el) => {
          const rr = el.getBoundingClientRect();
          const etiqueta = (el.getAttribute('aria-label') || el.innerText || el.textContent || '')
            .replace(/[\\uE000-\\uF8FF]/g, '')
            .trim();
          return { etiqueta, x: Math.round(rr.left + rr.width / 2), y: Math.round(rr.top + rr.height / 2), w: Math.round(rr.width) };
        }).filter((f) => f.etiqueta.length > 0 && f.w > 0),
        centro: { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + Math.min(r.height / 2, 300)) },
      };
    })()`);
    check("el menu de la fila abre una hoja", hoja !== null, hoja ? `hoja con ${hoja.filas.length} filas` : "no hay sheet-panel");
    if (!hoja) {
      saltar("la hoja del menu", 'el "sheet-panel" no esta: el menu se pulso y no abrio nada');
    }
    if (hoja) {
      note(`filas del menu: ${JSON.stringify(hoja.filas.map((f) => f.etiqueta))}`);
      await tab.screenshot(`${SHOTS}/03-menu-de-la-fila.png`);

      /*
        **La exportacion son dos paginas dentro de la hoja**: la de opciones y la de
        formatos. Se busca la fila de exportar por su etiqueta y se pulsa; si la hoja
        no la tiene, se dice con su texto entero para que se pueda leer por que.
      */
      const exportar = hoja.filas.find((f) => /export|exportar|descarg|download/i.test(f.etiqueta));
      check(
        "el menu ofrece exportar",
        Boolean(exportar),
        exportar ? `fila: "${exportar.etiqueta}"` : `filas: ${JSON.stringify(hoja.filas.map((f) => f.etiqueta))}`,
      );

      if (!exportar) {
        saltar(
          "la fila de exportar del menu",
          `ninguna de las ${hoja.filas.length} filas dice exportar: ${JSON.stringify(hoja.filas.map((f) => f.etiqueta))}`,
        );
      }
      if (exportar) {
        await tab.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [{ x: exportar.x, y: exportar.y, radiusX: 8, radiusY: 8, force: 1 }],
        });
        await sleep(80);
        await tab.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        await sleep(800);
        await tab.screenshot(`${SHOTS}/04-pagina-de-formatos.png`);

        const formatos = await tab.evaluate(`(() => {
          const paneles = [...document.querySelectorAll('[data-testid="sheet-panel"]')];
          const panel = paneles[paneles.length - 1] ?? null;
          if (!panel) return null;
          return [...panel.querySelectorAll('button, [role=button]')].map((el) => {
            const rr = el.getBoundingClientRect();
            const etiqueta = (el.getAttribute('aria-label') || el.innerText || el.textContent || '')
              .replace(/[\\uE000-\\uF8FF]/g, '')
              .trim();
            return { etiqueta, x: Math.round(rr.left + rr.width / 2), y: Math.round(rr.top + rr.height / 2), w: Math.round(rr.width) };
          }).filter((f) => f.etiqueta.length > 0 && f.w > 0);
        })()`);
        note(`formatos: ${JSON.stringify((formatos ?? []).map((f) => f.etiqueta))}`);
        const csv = (formatos ?? []).find((f) => /csv/i.test(f.etiqueta));
        check("la pagina de formatos ofrece el CSV", Boolean(csv), csv ? `fila: "${csv.etiqueta}"` : `formatos: ${JSON.stringify((formatos ?? []).map((f) => f.etiqueta))}`);

        if (!csv) {
          saltar("la fila de CSV de la pagina de formatos", `formatos: ${JSON.stringify((formatos ?? []).map((f) => f.etiqueta))}`);
        }
        if (csv) {
          await tab.send("Input.dispatchTouchEvent", {
            type: "touchStart",
            touchPoints: [{ x: csv.x, y: csv.y, radiusX: 8, radiusY: 8, force: 1 }],
          });
          await sleep(80);
          await tab.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });

          /*
            **Se espera al FICHERO, y si no llega se falla.**
          */
          const deadline = Date.now() + 30000;
          let fichero = null;
          while (Date.now() < deadline) {
            const enDisco = readdirSync(DESCARGAS).filter((f) => !f.endsWith(".crdownload"));
            if (enDisco.length > 0) {
              // El fichero se espera a que **deje de crecer**: un `.csv` a medio
              // escribir tiene una cabecera y ningun dato, y mirarlo en ese
              // instante daria un "el CSV no trae las tareas" que es un "el fichero
              // aun no estaba".
              const ruta = join(DESCARGAS, enDisco[0]);
              const antes = statSync(ruta).size;
              await sleep(700);
              if (statSync(ruta).size === antes) {
                fichero = { nombre: enDisco[0], ruta };
                break;
              }
            }
            await sleep(250);
          }
          check(
            "**el CSV se descarga de verdad: hay un fichero en disco**",
            fichero !== null,
            fichero ? `${fichero.nombre} (${statSync(fichero.ruta).size} bytes)` : `en ${DESCARGAS} no aparecio ningun fichero en 30 s`,
          );

          if (!fichero) {
            saltar(
              "el fichero descargado",
              `en ${DESCARGAS} no aparecio ningun fichero en 30 s: el CSV se pidio y no llego a disco, asi que las cuatro comprobaciones del fichero no se han hecho`,
            );
          }
          if (fichero) {
            const contenido = readFileSync(fichero.ruta, "utf8");
            const tabla = tablaDe(contenido);
            const cabecera = tabla.cabecera;
            const celdas = tabla.filas;
            note(`fichero descargado: ${fichero.nombre} — cabecera: ${tabla.lineas[0]}`);
            check(
              "**el fichero que baja la persona lleva `estado` y no `completado`**",
              cabecera.includes("estado") && !cabecera.includes("completado"),
              `cabecera del fichero: ${tabla.lineas[0]}`,
            );
            check(
              "la primera columna se llama `id`, sin el BOM pegado delante",
              cabecera[0] === "id",
              `primera celda de la cabecera: ${JSON.stringify(cabecera[0])} | el fichero trae BOM: ${tabla.conBom}`,
            );
            check(
              "y sus celdas dicen el titulo del estado de cada tarea",
              celdas.every((c) => ESTADOS.some((e) => e.title === c[cabecera.indexOf("estado")])),
              `celdas de estado: ${JSON.stringify(celdas.map((c) => c[cabecera.indexOf("estado")]))}`,
            );
            check(
              "y trae todas las tareas del tablero",
              celdas.length === TAREAS.length,
              `filas: ${celdas.length} | tareas sembradas: ${TAREAS.length}`,
            );
            await sleep(600);
            await tab.screenshot(`${SHOTS}/05-resultado-de-la-exportacion.png`);
          }
        }
      }
    }
  }

  const errores = problems.filter((p) => !/favicon|Failed to load resource/i.test(p.text));
  check("sin errores de consola en toda la pasada", errores.length === 0, errores.slice(0, 3).map((e) => e.text.slice(0, 140)).join(" | "));

  /*
    **El recuento de lo que se ha comprobado, y sale DESPUES de las ramas saltadas.**
    Antes el `else` de fuera escribia "el punto 3 no se ha podido medir y sale como tal"
    y la corrida terminaba en `TODO OK`. Con cuatro de las cinco ramas sin recorrer, la
    salida decia verde con cuatro comprobaciones menos, que es el peor resultado posible
    de un guion de este tipo: no es un fallo, es un hueco que se lee como un aprobado.
  */
  reportarSaltadas();
} catch (e) {
  failures += 1;
  console.log(`FALLA  la corrida entera: ${e.message}`);
  if (tab) await tab.screenshot(`${SHOTS}/99-error.png`).catch(() => {});
} finally {
  chrome.kill();
}

/*
  **La cuenta final, y por que se imprime aunque no haya saltado ninguna rama.** Un guion
  que dice cuantos checks ha hecho es un guion del que se puede dudar; uno que solo dice
  "TODO OK" obliga a contar las lineas a mano, que es donde empiezan los "168 sitios de
  check()" del informe de la Task 15.
*/
console.log(
  `comprobaciones emitidas: ${emitidos} | ramas saltadas: ${saltadas.length} | fallos: ${failures}`,
);
console.log(`\n${failures === 0 ? "TODO OK" : `${failures} FALLOS`} — capturas en ${SHOTS}`);
process.exit(failures === 0 ? 0 : 1);
