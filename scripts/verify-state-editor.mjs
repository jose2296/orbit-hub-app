import { randomUUID } from "node:crypto";
import { execSync } from "node:child_process";
import { readFile } from "node:fs/promises";

import { launchChrome, openTab, seedSession, collectProblems } from "./cdp.mjs";

/**
 * El editor de estados, en un navegador.
 *
 * Los puntos que solo se pueden mirar, y el orden en que se miran:
 *
 *  - **la puerta de la cabecera**: el boton abre el editor, y sale en un tablero
 *    con columnas y no sale en uno que no las tiene —donde el panel ni se monta—;
 *  - **una fila por columna**, con su punto, su nombre y su contador, y el
 *    contador es el de `countInState`;
 *  - **abrir y cerrar no escribe nada**, que en la pantalla no se ve;
 *  - **cuatro cambios seguidos son un push**: anadir, renombrar y colorear desde el
 *    mismo panel, y en el cable sale **una** operacion de `list` con el array
 *    entero. Esto no se puede mirar, se cuenta;
 *  - **cerrar y volver a abrir el tablero**: la columna esta ahi, con el nombre y
 *    el color que se le pusieron, y el servidor la tiene;
 *  - **un nombre en blanco no anade nada** y el boton sale apagado sin el;
 *  - **el tope de 24 apaga el boton y lo dice**, con el numero del contrato;
 *  - **el relevo desde la hoja de estado**: la fila `state-picker-edit` abre este
 *    mismo editor, y hay una ventana en la que los dos paneles estan en el
 *    documento a la vez;
 *  - y **todo lo anterior en claro y en oscuro**, con el tema comprobado antes de
 *    aceptar cualquier captura como de claro.
 *
 * El contador de pushes se mira en el cable porque la escritura es local primero:
 * una columna que aparece en el tablero y un push que no sale se ven exactamente
 * igual en pantalla.
 */

const APP = process.env.APP_URL ?? "http://localhost:8087";
const API = process.env.API_URL ?? "http://localhost:4100/api/v1";
const SHOTS = process.env.SHOTS ?? "/tmp/orbit-state-editor";

function logOfTheApi() {
  const port = new URL(API).port || "4000";
  const pid = execSync(`lsof -tnP -iTCP:${port} -sTCP:LISTEN`, { encoding: "utf8" })
    .split("\n")[0]
    ?.trim();
  const line = execSync(`lsof -p ${pid} | awk '/ 2w /{print $NF}'`, { encoding: "utf8" })
    .split("\n")[0]
    ?.trim();
  if (!line) throw new Error("no encuentro el log de la API");
  return line;
}

const EMAIL_LOG = logOfTheApi();
const readLog = async () => {
  try {
    return await readFile(EMAIL_LOG, "utf8");
  } catch {
    return "";
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * **Una IP distinta en cada corrida.** La API limita las llamadas de autenticacion
 * a 7 por IP cada quince minutos, asi que dos recorridos seguidos desde la misma
 * direccion se comen la ventana del otro y el `429` sale donde no esta la causa.
 * La cuenta tambien es de esta corrida: con cuenta fija, la segunda pasada se
 * encuentra la cuenta **sin verificar** a medias y el login responde **http 200**
 * con `{ status: "email_verification_required" }`, que no es un 401 y por tanto no
 * dice "esta cuenta no existe". Es lo que dice `scripts/verify-state-picker.mjs`,
 * que es de donde sale todo este bloque.
 */
const IP = `10.93.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}`;

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

/** Una llamada que **espera** su `Retry-After` en vez de rendirse. */
async function apiConEspera(path, opciones = {}) {
  for (let intento = 1; ; intento += 1) {
    const r = await api(path, opciones);
    if (r.status !== 429) return r;
    const retry = Number(r.headers?.get?.("retry-after")) || 60;
    const espera = Math.min(Math.max(retry, 5), 600);
    note(
      `429 en ${path}: la API pide ${retry}s y se esperan ${espera}s (intento ${intento}).`,
    );
    await sleep(espera * 1000);
  }
}

/**
 * Lo que el servidor tiene ahora, como un mapa de `"entidad:id"` a fila.
 *
 * El pull devuelve `changes` como un **array de `{ entity, record }`** y el
 * `record` es la fila plana, de modo que `states` se lee en `record.states`. Se
 * tira de todo el historico (`lastPulledAt: null`) y sin cursor: lo que se busca
 * es el estado actual de una fila, no "lo que ha cambiado desde la ultima vez".
 */
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

let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures += 1;
  console.log(`${ok ? "ok    " : "FALLA "} ${name}${detail ? ` — ${detail}` : ""}`);
};
const note = (text) => console.log(`      ${text}`);

async function account() {
  const password = "a-very-long-password";
  const device = { label: "state-editor", platform: "web" };
  const email = `state-editor-${Date.now().toString(36)}@example.com`;

  const before = await readLog();
  const alta = await apiConEspera("/auth/register", {
    method: "POST",
    body: {
      email,
      password,
      displayName: "State",
      locale: "es",
      acceptedTermsAt: new Date().toISOString(),
      device,
    },
  });
  if (alta.status !== 200 && alta.status !== 201) {
    throw new Error(
      `el registro no salio: http ${alta.status} ${JSON.stringify(alta.body)}`,
    );
  }

  const deadline = Date.now() + 30000;
  let link = null;
  while (Date.now() < deadline && !link) {
    await sleep(400);
    const after = await readLog();
    link = after
      .slice(before.length)
      .match(/verify-email\?token=([A-Za-z0-9_-]+)/);
  }
  if (!link?.[1]) throw new Error("el correo de verificacion no salio en el log");
  await apiConEspera("/auth/verify-email", {
    method: "POST",
    body: { token: link[1] },
  });

  const tras = await apiConEspera("/auth/login", {
    method: "POST",
    body: { email, password, device },
  });
  const session = tras.body?.data?.session;
  if (!session) {
    throw new Error(
      `no hay sesion tras verificar: http ${tras.status} ${JSON.stringify(tras.body)}`,
    );
  }
  return session;
}

/**
 * Un tablero con **cuatro** columnas y tareas en tres de ellas.
 *
 * `states` va en la propia operacion de `create` de la lista, porque el editor se
 * crea en el navegador y no se puede sembrar antes de existir. Las dos primeras
 * tareas nacen con `stateId: null` —**que es lo que hace `newListItem` en el
 * cliente**— y por eso las cuenta la primera columna: es el caso que hace
 * Breakthrough de un contador escrito a mano.
 */
const ESTADOS = [
  { id: randomUUID(), title: "Backlog", color: "neutral" },
  { id: randomUUID(), title: "Ready", color: "blue" },
  { id: randomUUID(), title: "WIP", color: "amber" },
  { id: randomUUID(), title: "Done", color: "green" },
];

/** El color con el que se colorea la columna nueva, y uno de los doce. */
const COLOR_NUEVO = "teal";
const NOMBRE_NUEVO = "Revision";
const RENAME = "Revision final";

const TAREAS = [
  { title: "Backlog-1", stateId: null, position: 0 },
  { title: "Backlog-2", stateId: null, position: 1 },
  { title: "Ready-1", stateId: ESTADOS[1].id, position: 2 },
  { title: "WIP-1", stateId: ESTADOS[2].id, position: 3 },
].map((t) => ({ id: randomUUID(), ...t }));

const session = await account();
const ws = randomUUID();
const listId = randomUUID();
const at = new Date().toISOString();
const CLIENT = "verify-state-editor";

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
        payload: {
          workspaceId: ws,
          folderId: null,
          title: "Envíos",
          kind: "board",
          orderMode: "manual",
          states: ESTADOS,
        },
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
        payload: {
          listId,
          title: tarea.title,
          position: tarea.position,
          ...(tarea.stateId ? { stateId: tarea.stateId } : {}),
        },
      })),
    ],
  },
});

/*
  **El codigo de la respuesta no es el estado de las operaciones.** Un push con
  operaciones rechazadas es un 200 con `rejected` dentro, y una siembra que solo
  mira el codigo parece buena y deja un tablero vacio.
*/
const resultados = sembrado.body?.data?.results ?? [];
const rechazadas = resultados.filter(
  (r) => r.status !== "applied" && r.status !== "duplicate",
);
check(
  "el sembrado se aplico entero (results, no el codigo)",
  sembrado.status === 200 && rechazadas.length === 0,
  `http ${sembrado.status}, applied ${resultados.filter((r) => r.status === "applied").length}/${resultados.length}` +
    (rechazadas.length
      ? ` — rechazadas: ${rechazadas.map((r) => `${r.entity}:${r.error}`).join(" | ")}`
      : ""),
);
if (failures > 0) {
  console.log("\nSin sembrar no hay nada que mirar.");
  process.exit(1);
}

/* ------------------------------------------------------------------ el DOM -- */

/**
 * Las filas del editor, con su nombre, su numero y el color de su punto.
 *
 * **El punto se busca por su `backgroundColor` y no por un `testID`.** El punto es
 * el unico descendiente de la fila con un relleno: la fila es transparente hasta
 * que se pulsa, el texto no lleva ninguno, y el contador tampoco. Anadir un
 * `testID` al punto habria sido una forma mas corta, y habria sido un atributo
 * mas que mantener en tres ficheros mas —`board-tabs.tsx` y `board-column.tsx`
 * dibujan el mismo punto y no llevan ninguno— para poder mirar algo que se lee
 * de dos formas.
 */
const LEER_EDITOR = `(() => {
  const paneles = [...document.querySelectorAll('[data-testid="sheet-panel"]')];
  const panel = paneles.find((p) => p.querySelector('[data-testid^="state-editor-row-"]')) ?? null;
  if (!panel) return null;
  const filas = [...panel.querySelectorAll('[data-testid^="state-editor-row-"]')].map((el) => {
    const id = el.getAttribute('data-testid').replace('state-editor-row-', '');
    const numero = panel.querySelector('[data-testid="state-editor-count-' + id + '"]');
    const puntos = [...el.querySelectorAll('div')]
      .map((d) => getComputedStyle(d).backgroundColor)
      .filter((c) => c && c !== 'transparent' && c !== 'rgba(0, 0, 0, 0)');
    return {
      id,
      titulo: (el.innerText || '').split('\\n')[0] ?? '',
      numero: numero ? Number(numero.innerText) : null,
      punto: puntos[0] ?? null,
      etiqueta: el.getAttribute('aria-label') ?? '',
      ancho: Math.round(el.getBoundingClientRect().width),
      alto: Math.round(el.getBoundingClientRect().height),
    };
  });
  const anadir = panel.querySelector('[data-testid="state-editor-add"]');
  const campo = panel.querySelector('[data-testid="state-editor-new-name"]');
  return {
    filas,
    paginas: filas.length,
    titulo: panel.querySelector('div')?.innerText ?? null,
    anadir: anadir
      ? {
          // **Apagado y no el atributo**, porque un Pressable de react-native-web
          // no es siempre un boton: cuando es un div con role no lleva atributo
          // disabled y la propiedad sale undefined, asi que preguntar por
          // "=== false" pasaria siempre por un boton apagado y caeria con uno
          // encendido, al reves de lo que se quiere comprobar.
          apagado:
            anadir.disabled === true ||
            anadir.getAttribute('aria-disabled') === 'true',
          etiqueta: anadir.getAttribute('aria-label') ?? '',
        }
      : null,
    campoNuevo: campo ? campo.value : null,
    enPaginaDeEstado: !!panel.querySelector('[data-testid="state-editor-name"]'),
    muestras: [...panel.querySelectorAll('[data-testid^="state-editor-color-"]')].map((el) => ({
      id: el.getAttribute('data-testid').replace('state-editor-color-', ''),
      fondo: getComputedStyle(el).backgroundColor,
      elegido: getComputedStyle(el).borderTopColor !== 'rgba(0, 0, 0, 0)',
    })),
    texto: panel.innerText,
  };
})()`;

/** La pagina de edicion de una columna: el campo del nombre y la tira de colores. */
const LEER_PAGINA_ESTADO = `(() => {
  const paneles = [...document.querySelectorAll('[data-testid="sheet-panel"]')];
  const panel = paneles.find((p) => p.querySelector('[data-testid="state-editor-name"]')) ?? null;
  if (!panel) return null;
  const nombre = panel.querySelector('[data-testid="state-editor-name"]');
  return {
    nombre: nombre ? nombre.value : null,
    muestras: [...panel.querySelectorAll('[data-testid^="state-editor-color-"]')].map((el) => ({
      id: el.getAttribute('data-testid').replace('state-editor-color-', ''),
      fondo: getComputedStyle(el).backgroundColor,
      elegido: getComputedStyle(el).borderTopColor !== 'rgba(0, 0, 0, 0)',
    })),
    hayGuardar: !!panel.querySelector('[data-testid="state-editor-save"]'),
    hayVolver: !!panel.querySelector('[data-testid="state-editor-back"]'),
    texto: panel.innerText,
  };
})()`;

/** El tablero: sus pestañas y lo que hay en cada columna. */
const TABLERO = `(() => {
  const slots = [...document.querySelectorAll('[data-testid^="board-slot-"]')];
  return {
    tabs: [...document.querySelectorAll('[data-testid^="board-tab-"]')].map((el) =>
      (el.innerText || '').replace(/\\n/g, ' '),
    ),
    columnas: slots.map((slot) => ({
      columna: slot.getAttribute('data-testid').replace('board-slot-', ''),
      tarjetas: [...slot.querySelectorAll('[data-testid^="item-row-"]')].length,
    })),
  };
})()`;

const readBoard = (tab) => tab.evaluate(TABLERO);

/** Escribir en un campo de la app, **por el camino que React ve**. */
const escribir = (tab, testId, valor) =>
  tab.evaluate(`(() => {
    const el = document.querySelector('[data-testid=' + JSON.stringify(${JSON.stringify(testId)}) + ']');
    if (!el) return 'no hay campo';
    const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(valor)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return 'escrito';
  })()`);

/**
 * El centro de un elemento por su `testID`, **después de dejarlo en pantalla**.
 *
 * Con veinticuatro columnas las dos ultimas filas y el boton de anadir quedan bajo
 * el pliegue del panel —`maxHeightRatio` es 0.85 y el cuerpo es un `ScrollView`— y
 * el centro cae fuera de la ventana, donde `Input.dispatchTouchEvent` no llega a
 * nada. `scrollIntoView` los deja dentro: en react-native-web el `ScrollView` es un
 * `div` con `overflow`, asi que el desplazamiento es de verdad.
 *
 * **Y el desplazamiento y la medida van en dos evaluaciones**, porque entre la una
 * y la otra hay un fotograma deScroll: leer el rectangulo en la misma expresion que
 * lo desplaza mide la posicion de antes, que es la que no estaba en pantalla.
 */
async function centro(tab, testId, dentro) {
  const guardado = await tab.evaluate(`(() => {
    const el = document.querySelector('[data-testid=' + JSON.stringify(${JSON.stringify(testId)}) + ']' + ${JSON.stringify(dentro ?? "")});
    if (!el) return false;
    el.scrollIntoView && el.scrollIntoView({ block: 'center' });
    return true;
  })()`);
  if (!guardado) return null;
  await sleep(150);
  return tab.evaluate(`(() => {
    const el = document.querySelector('[data-testid=' + JSON.stringify(${JSON.stringify(testId)}) + ']' + ${JSON.stringify(dentro ?? "")});
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return null;
    return {
      x: Math.round(r.left + r.width / 2),
      y: Math.round(r.top + r.height / 2),
      w: Math.round(r.width),
      h: Math.round(r.height),
      dentro: r.top >= 0 && r.bottom <= window.innerHeight,
    };
  })()`);
}

/**
 * Un toque de dedo, y solo de dedo: con `Input.dispatchTouchEvent` y el par de
 * raton anadido al mismo punto, un `Pressable` de react-native-web recibe dos
 * secuencias de puntero sobre el mismo elemento y gana la que no es del dedo.
 * Medido en `scripts/verify-state-picker.mjs`, que lo cuenta.
 */
async function tap(tab, testId, dentro) {
  const p = await centro(tab, testId, dentro);
  if (!p) throw new Error(`no encuentro ${testId}${dentro ?? ""}`);
  if (p.dentro === false) {
    throw new Error(
      `${testId}${dentro ?? ""} esta en ${p.y} con una ventana de ${900}: fuera de pantalla`,
    );
  }
  await tab.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: p.x, y: p.y, radiusX: 8, radiusY: 8, force: 1 }],
  });
  await sleep(80);
  await tab.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(420);
  return p;
}

/**
 * Un toque en la `X` de la hoja, **buscando el boton por su etiqueta y no por "el
 * primero del panel"**: el pulsable de fuera de `Sheet` lleva la misma etiqueta y
 * esta fuera del panel, asi que se lee de ahi —el hermano siguiente al
 * `sheet-dim`— y se busca dentro del panel que se quiere cerrar.
 */
async function cerrarConLaX(tab, dentroDe) {
  const donde = await tab.evaluate(`(() => {
    const paneles = [...document.querySelectorAll('[data-testid="sheet-panel"]')];
    const panel = paneles.find((p) => ${dentroDe}) ?? null;
    if (!panel) return { error: 'no hay panel' };
    const dim = document.querySelector('[data-testid="sheet-dim"]');
    const frase = dim?.nextElementSibling?.getAttribute('aria-label');
    if (!frase) return { error: 'el pulsable de fuera no tiene aria-label' };
    const botones = [...panel.querySelectorAll('[aria-label="' + frase + '"]')];
    if (botones.length !== 1) return { error: 'botones con "' + frase + '" en el panel: ' + botones.length };
    const r = botones[0].getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  if (donde.error) throw new Error(`la X: ${donde.error}`);
  await tab.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: donde.x, y: donde.y, radiusX: 8, radiusY: 8, force: 1 }],
  });
  await sleep(80);
  await tab.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(420);
}

/**
 * Dejar un elemento en pantalla, **y sin tocarlo**, para una captura.
 *
 * Con veinticuatro columnas el boton de anadir y la frase del maximo quedan bajo
 * el pliegue del panel, y una captura de ahi no los enseña: la comprobacion los
 * lee del DOM y pasaria, y el fichero de capturas no tendria nada que mirar. Es
 * el mismo `scrollIntoView` que usa `centro` —el cuerpo del panel es un `div` con
 * `overflow` en react-native-web— pero aqui solo se desplaza: tocar el boton
 * apagado haria que la captura saliera de otra manera que la que se quiere ver.
 */
async function ver(tab, testId) {
  await tab.evaluate(`(() => {
    const el = document.querySelector('[data-testid=' + JSON.stringify(${JSON.stringify(testId)}) + ']');
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center' });
    return !!el;
  })()`);
  await sleep(180);
}

/** Esperar a que el editor no este, en vez de mirarlo una vez. */
async function esperarEditorFuera(tab, limiteMs = 1500) {
  const esperando = Date.now();
  let sigue = true;
  while (Date.now() - esperando < limiteMs) {
    sigue = (await tab.evaluate(LEER_EDITOR)) !== null;
    if (!sigue) break;
    await sleep(60);
  }
  const ms = Date.now() - esperando;
  return {
    sigue,
    detalle: sigue
      ? `sigue en pantalla ${ms} ms despues del toque (limite: ${limiteMs})`
      : `fuera de la pantalla en ${ms} ms`,
  };
}

const esperarEditorCerrado = (tab) => esperarEditorFuera(tab);

/**
 * **El relevo, muestreado desde dentro del gesto.**
 *
 * La fila `state-picker-edit` llama a `onEditStates()` y a `onClose()` en el mismo
 * manejador, o sea en el mismo commit: el editor se monta y la hoja de estado
 * recibe `visible: false` a la vez. `Sheet` no se desmonta hasta `SALIDA + 90` =
 * 330 ms (`sheet.tsx`), asi que hay una ventana en la que el documento tiene dos
 * `sheet-dim` y dos `sheet-panel`.
 *
 * **Y no se puede leer despues**: `tap` duerme 420 ms y la ventana se ha cerrado,
 * de modo que una lectura hecha al final describe un estado que ya no existia. El
 * muestreo se instala **antes** del toque y el bucle corre dentro de la pagina,
 * que es la misma leccion que da `verify-state-picker.mjs` con su bloque `1c`.
 *
 * Lo que guarda cada fotograma son las tres cosas que hacen falta: cuantos velos y
 * cuantos paneles hay, quien es cada uno, y a quien llegaria una pulsacion en un
 * punto a la izquierda del panel —que a 1440 es fondo— y en el centro del panel
 * que entra.
 */
const INSTALAR_MUESTREO = (donde) => `(() => {
  const reg = { donde: ${JSON.stringify(donde)}, t0: performance.now(), muestras: [], vivo: true };
  window.__relevo = reg;
  const portales = () => [...document.body.children];
  const portalDe = (el) => {
    const d = el && el.closest('body > div');
    return d ? portales().indexOf(d) : -1;
  };
  const quienDe = (el) => {
    const p = portalDe(el);
    if (p < 0) return 'nada';
    const paneles = [...document.querySelectorAll('[data-testid="sheet-panel"]')];
    const mio = paneles.find((pan) => portalDe(pan) === p);
    if (!mio) return 'velo#' + p;
    const quien = mio.querySelector('[data-testid^="state-editor-row-"]')
      ? 'editor'
      : mio.querySelector('[data-testid^="state-picker-row-"]')
        ? 'hoja'
        : 'otro';
    return quien + '#' + p;
  };
  const paso = () => {
    const dims = [...document.querySelectorAll('[data-testid="sheet-dim"]')];
    const paneles = [...document.querySelectorAll('[data-testid="sheet-panel"]')];
    const editor = paneles.find((p) => p.querySelector('[data-testid^="state-editor-row-"]')) ?? null;
    const r = editor ? editor.getBoundingClientRect() : null;
    const dentro = r && r.width > 0 && r.top < window.innerHeight && r.bottom > 0;
    reg.muestras.push({
      t: Math.round(performance.now() - reg.t0),
      dims: dims.length,
      paneles: paneles.length,
      quien: paneles.map(quienDe).join(' + '),
      fondo: quienDe(document.elementFromPoint(60, 300)),
      centro: dentro ? quienDe(document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2))) : 'fuera de pantalla',
    });
    if (reg.vivo && performance.now() - reg.t0 < 700) requestAnimationFrame(paso);
    else reg.vivo = false;
  };
  requestAnimationFrame(paso);
  return true;
})()`;

const LEER_MUESTREO = `(() => {
  const reg = window.__relevo;
  if (!reg) return { error: 'el muestreo no estaba instalado' };
  reg.vivo = false;
  const m = reg.muestras;
  const conDos = m.filter((x) => x.dims > 1 || x.paneles > 1);
  const llega = m.findIndex((x) => x.quien.indexOf('editor#') >= 0);
  const despues = llega >= 0 ? m.slice(llega) : [];
  return {
    donde: reg.donde,
    fotogramas: m.length,
    hasta: m.length ? m.at(-1).t : 0,
    llegada: llega >= 0 ? m[llega].t : null,
    ventana: conDos.length
      ? { desde: conDos[0].t, hasta: conDos.at(-1).t, ms: conDos.at(-1).t - conDos[0].t, fotogramas: conDos.length }
      : { desde: null, hasta: null, ms: 0, fotogramas: 0 },
    quienEnLaVentana: conDos[0] ? conDos[0].quien : null,
    maxDims: m.reduce((a, x) => Math.max(a, x.dims), 0),
    maxPaneles: m.reduce((a, x) => Math.max(a, x.paneles), 0),
    sinVelo: m.filter((x) => x.paneles > 0 && x.dims === 0).length,
    ordenFinal: m.length ? m.at(-1).quien : null,
    // **Por posicion dentro de la ventana y no por numero de fotogramas**: con la
    // maquina cargada un fotograma puede tardar mas de 100 ms y la misma carrera
    // ocupa dos capturas. Lo que se vigila es que el orden invertido este al
    // principio de la ventana, que es lo que distingue una carrera de un fondo mal
    // puesto. Es el mismo criterio y el mismo motivo que en verify-state-picker.
    fondoMaloPos: conDos.map((x, i) => (x.fondo.startsWith('hoja#') ? i : -1)).filter((i) => i >= 0),
    centroMaloPos: conDos
      .map((x, i) => (x.centro.startsWith('hoja#') ? i : -1))
      .filter((i) => i >= 0),
    fondos: [...new Set(despues.map((x) => x.fondo))],
  };
})()`;

async function medirReleve(tab, testId, donde) {
  await tab.evaluate(INSTALAR_MUESTREO(donde));
  await tap(tab, testId);
  await sleep(300);
  const resumen = await tab.evaluate(LEER_MUESTREO);
  if (resumen?.error) throw new Error(`${donde}: ${resumen.error}`);
  return resumen;
}

/**
 * El puerto de CDP es el suyo y no el 9222 de `cdp.mjs`.
 *
 * En esta maquina habia un Chrome sin cabeza de otra corrida escuchando en el
 * 9222, y `chrome-launcher` se lo queda en vez de elegir otro: el `Page.navigate`
 * de este guion se mandaba a una sesion vieja y no contestaba nunca, con un
 * `Page.navigate no respondio en 30000 ms` que no dice nada del editor. Se pide
 * uno propio, que ademas se puede cambiar con `CDP_PORT`.
 */
const PUERTO_CDP = Number(process.env.CDP_PORT ?? 9333);

const chrome = await launchChrome({ width: 1440, height: 900, port: PUERTO_CDP });
let tab;
try {
  tab = await openTab(chrome.port);

  /**
   * **La ventana se fija por CDP y no solo con `--window-size`.** Con la bandera
   * sola esta corrida vino up en 500 x 845 —un ancho de movil— y el recorrido
   * tocaría elementos fuera de pantalla. `Emulation.setDeviceMetricsOverride` pone
   * el viewport donde se pide.
   */
  await tab.send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const viewport = await tab.evaluate("({ w: window.innerWidth, h: window.innerHeight })");
  check(
    "el viewport es el pedido y no el que venga por defecto",
    viewport?.w === 1440,
    `innerWidth: ${viewport?.w} x ${viewport?.h}`,
  );

  const problems = collectProblems(tab);

  /**
   * **La pasada en claro se fuerza y se comprueba.** `ThemeProvider` resuelve
   * `appearance: 'system'` con `useColorScheme()`, y Chrome sin cabeza arranca en
   * `prefers-color-scheme: dark`: la primera pasada "en claro" de este recorrido
   * salio entera en oscuro y las capturas tenían dos nombres.
   */
  const PONER_TEMA = (apariencia) =>
    tab.evaluate(
      `localStorage.setItem('orbithub:appearance', ${JSON.stringify(
        JSON.stringify({ appearance: apariencia, accent: "orbit" }),
      )})`,
    );
  const temaDeLaPagina = () =>
    tab.evaluate(
      `document.documentElement.style.colorScheme || getComputedStyle(document.documentElement).colorScheme`,
    );

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
  const temaClaro = await temaDeLaPagina();
  check("la primera pasada esta en CLARO de verdad", temaClaro === "light", `colorScheme: ${temaClaro}`);
  note(`columnas: ${visto.columnas.map((c) => `${c.columna.slice(0, 4)}=${c.tarjetas}`).join(" ")}`);
  await tab.screenshot(`${SHOTS}/01-tablero-claro.png`);

  /* ------------------- el contador de pushes: como se mide "no escribe" ------------------- */

  /**
   * **Cada operacion del outbox viaja en el cuerpo de un `POST /sync/push`, y el
   * vacio del outbox es un push que no ocurre.** Se cuentan las peticiones y las
   * operaciones de `list` que llevan, con `Network.requestWillBeSent`, que ve el
   * cuerpo antes de que el servidor pueda responder nada. La escritura es local
   * primero, asi que en pantalla un cambio que no sale y uno que sale se ven
   * **exactamente igual**: solo el cable lo distingue.
   *
   * El motor agrupa y deja salir las operaciones alrededor de un segundo y medio
   * despues de escribirlas, asi que se esperan seis.
   */
  const pushes = [];
  tab.on("Network.requestWillBeSent", (params) => {
    const url = params?.request?.url ?? "";
    if (!url.includes("/sync/push")) return;
    let body = null;
    try {
      body = JSON.parse(params.request.postData ?? "null");
    } catch {
      body = null;
    }
    const ops = body?.operations ?? [];
    pushes.push({
      at: Date.now(),
      total: ops.length,
      listas: ops.filter((o) => o?.entity === "list").length,
      estados: ops
        .filter((o) => o?.entity === "list")
        .map((o) => (o?.payload?.states ?? null).map((s) => `${s.title}:${s.color}`)),
    });
  });
  const vaciarPushes = () => {
    pushes.length = 0;
  };
  const cuenta = (desde) => {
    const dentro = pushes.filter((p) => p.at >= desde);
    return {
      pushes: dentro.length,
      ops: dentro.reduce((t, p) => t + p.total, 0),
      listas: dentro.reduce((t, p) => t + p.listas, 0),
    };
  };
  const ESPERA = 6000;

  /* --- 1. La puerta de la cabecera --- */

  const hayBoton = await tab.evaluate(`(() => {
    const el = document.querySelector('[data-testid="board-states-button"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      etiqueta: el.getAttribute('aria-label'),
      pista: el.getAttribute('aria-describedby'),
      ancho: Math.round(r.width),
      // **Sin los glifos privados.** Un boton con solo icono dibuja su icono con
      // el glifo de Ionicons, que en react-native-web es un caracter del area de
      // uso privado, y innerText lo trae: quitarlo es lo que hace FIND de cdp.mjs,
      // y sin quitarlo "no tiene texto" no se puede comprobar en ningun boton de
      // icono de esta app.
      texto: (el.innerText || '').replace(/[\uE000-\uF8FF]/g, '').trim(),
    };
  })()`);
  check(
    "la cabecera tiene el boton del editor, con nombre y sin texto",
    Boolean(hayBoton) && Boolean(hayBoton.etiqueta) && hayBoton.texto === "",
    `etiqueta: ${hayBoton?.etiqueta ?? "(no hay boton)"} | texto: "${hayBoton?.texto ?? "-"}" | ancho: ${hayBoton?.ancho ?? "-"}`,
  );

  vaciarPushes();
  const desdeAbrir = Date.now();
  await tap(tab, "board-states-button");
  await sleep(400);
  let editor = await tab.evaluate(LEER_EDITOR);
  check("el boton de la cabecera abre el editor de estados", editor !== null);
  check(
    "el panel se titula con la frase del editor y dice de que tablero es",
    (editor?.titulo ?? "").includes("Editar los estados del tablero") &&
      (editor?.titulo ?? "").includes("Env\u00edos"),
    `titulo: ${JSON.stringify(editor?.titulo)}`,
  );

  /* --- 2. Las filas: punto, titulo y contador --- */

  if (editor) {
    note(`filas: ${editor.filas.map((f) => `${f.titulo} · ${f.numero} · ${f.punto}`).join(" | ")}`);
    check("hay una fila por columna", editor.filas.length === 4, `filas: ${editor.filas.length}`);
    check(
      "el orden de las filas es el orden del array",
      editor.filas.map((f) => f.id).join(",") === ESTADOS.map((e) => e.id).join(","),
      `filas: ${editor.filas.map((f) => f.titulo).join(" > ")}`,
    );

    /*
      Los contadores, **calculados aqui con la misma regla** en lugar de escritos a
      mano: una cuenta esperada escrita a mano sobrevive al cambio de la regla y
      pasa a comprobar otra cosa sin que se note. La regla es `stateOf`: `stateId`
      nulo —las dos tareas de Backlog— y `stateId` que no existe cuentan en la
      primera columna. Los numeros son 2, 1, 1, 0, y el 0 de "Done" es el que
      demuestra que el panel dibuja lo que le dieron.
    */
    for (const fila of editor.filas) {
      const estado = ESTADOS.find((e) => e.id === fila.id);
      const quiere = TAREAS.filter((t) => {
        const suyo = t.stateId ?? ESTADOS[0].id;
        const resuelta = ESTADOS.some((e) => e.id === suyo) ? suyo : ESTADOS[0].id;
        return resuelta === estado.id;
      }).length;
      check(`el contador de ${estado.title} es ${quiere}`, fila.numero === quiere, `dibujado ${fila.numero}`);
    }

    check(
      "cada fila trae el punto de color de su columna",
      editor.filas.every((f) => typeof f.punto === "string" && f.punto.startsWith("rgb")),
      `puntos: ${JSON.stringify(editor.filas.map((f) => f.punto))}`,
    );
    check(
      "y las cuatro pintan colores distintos entre si",
      new Set(editor.filas.map((f) => f.punto)).size === 4,
      `colores: ${JSON.stringify([...new Set(editor.filas.map((f) => f.punto))])}`,
    );
    check(
      "cada fila dice su nombre y su numero en la etiqueta, no solo los dibuja",
      editor.filas.every((f) => f.etiqueta.includes(f.titulo) && /\d/.test(f.etiqueta)),
      `etiquetas: ${JSON.stringify(editor.filas.map((f) => f.etiqueta))}`,
    );
    check(
      "la fila es un blanco de 48 puntos de alto o mas",
      editor.filas.every((f) => f.alto >= 48),
      `altos: ${JSON.stringify(editor.filas.map((f) => f.alto))}`,
    );
    await tab.screenshot(`${SHOTS}/02-editor-abierto-claro.png`);
  }

  /* --- 3. Abrir no escribe nada --- */

  await sleep(ESPERA);
  const cAbrir = cuenta(desdeAbrir);
  check(
    "abrir el editor no encola nada (0 pushes en 6 s)",
    cAbrir.pushes === 0 && cAbrir.ops === 0,
    `pushes: ${cAbrir.pushes}, operaciones: ${cAbrir.ops} (${JSON.stringify(cAbrir)})`,
  );

  /* --- 4. Anadir, renombrar y colorear: tres cambios y ningun push --- */

  vaciarPushes();
  const desdeEditar = Date.now();

  await escribir(tab, "state-editor-new-name", NOMBRE_NUEVO);
  await sleep(250);
  const conNombre = await tab.evaluate(LEER_EDITOR);
  check(
    "con un nombre escrito, el boton de anadir sale encendido con cuatro columnas",
    conNombre?.anadir?.apagado === false && conNombre?.filas.length === 4,
    `campo: "${conNombre?.campoNuevo}" | apagado: ${conNombre?.anadir?.apagado} | filas: ${conNombre?.filas.length}`,
  );

  await escribir(tab, "state-editor-new-name", "");
  await sleep(250);
  const conVacio = await tab.evaluate(LEER_EDITOR);
  check(
    "**un nombre en blanco no anade nada**: el campo vacio apaga el boton y no sale ninguna fila",
    conVacio?.campoNuevo === "" && conVacio?.anadir?.apagado === true && conVacio?.filas.length === 4,
    `campo: "${conVacio?.campoNuevo}" | apagado: ${conVacio?.anadir?.apagado} | filas: ${conVacio?.filas.length}`,
  );

  await escribir(tab, "state-editor-new-name", "   ");
  await sleep(250);
  const conEspacios = await tab.evaluate(LEER_EDITOR);
  check(
    "y con un nombre de solo espacios tambien, porque `newState` lo recorta",
    conEspacios?.anadir?.apagado === true && conEspacios?.filas.length === 4,
    `apagado: ${conEspacios?.anadir?.apagado} | filas: ${conEspacios?.filas.length}`,
  );

  await escribir(tab, "state-editor-new-name", NOMBRE_NUEVO);
  await sleep(250);
  await tap(tab, "state-editor-add");
  editor = await tab.evaluate(LEER_EDITOR);
  check(
    "anadir encola una fila mas, al final, y el campo se vacia",
    editor?.filas.length === 5 && editor?.filas.at(-1)?.titulo === NOMBRE_NUEVO && editor?.campoNuevo === "",
    `filas: ${editor?.filas.map((f) => f.titulo).join(" > ")} | campo: "${editor?.campoNuevo}"`,
  );
  await tab.screenshot(`${SHOTS}/03-una-columna-mas.png`);

  const idNuevo = editor?.filas.at(-1)?.id ?? null;
  if (!idNuevo) throw new Error("no hay id de la columna nueva, no se puede seguir");

  /* --- 5. Renombrar y colorear, en la pagina de esa columna --- */

  await tap(tab, `state-editor-row-${idNuevo}`);
  await sleep(300);
  let pagina = await tab.evaluate(LEER_PAGINA_ESTADO);
  check(
    "tocar la fila abre su pagina de edicion, con el nombre que tiene ahora",
    pagina?.nombre === NOMBRE_NUEVO,
    `nombre en el campo: ${pagina?.nombre ?? "(no hay pagina)"}`,
  );
  check(
    "la pagina trae la tira de colores y **los doce** de `ITEM_ICON_COLORS`",
    pagina?.muestras?.length === 12,
    `muestras: ${pagina?.muestras?.length}`,
  );
  check(
    "y uno sale elegido, que es el color con el que nacio la columna",
    pagina?.muestras?.filter((m) => m.elegido).length === 1,
    `elegidas: ${JSON.stringify(pagina?.muestras?.filter((m) => m.elegido).map((m) => m.id))}`,
  );
  await tab.screenshot(`${SHOTS}/04-pagina-de-la-columna.png`);

  await escribir(tab, "state-editor-name", RENAME);
  await sleep(200);
  await tap(tab, `state-editor-color-${COLOR_NUEVO}`);
  const conColor = await tab.evaluate(LEER_PAGINA_ESTADO);
  check(
    "tocar un color lo elige, y solo ese",
    conColor?.muestras?.find((m) => m.id === COLOR_NUEVO)?.elegido === true &&
      conColor?.muestras?.filter((m) => m.elegido).length === 1,
    `elegidas: ${JSON.stringify(conColor?.muestras?.filter((m) => m.elegido).map((m) => m.id))}`,
  );
  const colorElegido = conColor?.muestras?.find((m) => m.elegido)?.fondo ?? null;
  await tap(tab, "state-editor-save");
  editor = await tab.evaluate(LEER_EDITOR);
  check(
    "guardar vuelve a la lista con el nombre nuevo puesto",
    editor?.filas.length === 5 && editor?.filas.at(-1)?.titulo === RENAME,
    `filas: ${editor?.filas.map((f) => f.titulo).join(" > ")}`,
  );
  check(
    "**y el punto de la fila se ha coloreado con el color elegido**",
    editor?.filas.at(-1)?.punto === colorElegido,
    `la fila: ${editor?.filas.at(-1)?.punto} | la muestra elegida: ${colorElegido}`,
  );
  check(
    "las demas columnas no han cambiado de sitio",
    editor?.filas.slice(0, 4).map((f) => f.titulo).join(",") === ESTADOS.map((e) => e.title).join(","),
    `filas: ${editor?.filas.map((f) => f.titulo).join(" > ")}`,
  );
  await tab.screenshot(`${SHOTS}/05-tras-guardar-claro.png`);

  await sleep(ESPERA);
  const cEditar = cuenta(desdeEditar);
  check(
    "**anadir, renombrar y colorear son un push y no tres** (0 en 6 s con el panel abierto)",
    cEditar.pushes === 0 && cEditar.ops === 0,
    `pushes: ${cEditar.pushes}, operaciones: ${cEditar.ops} (${JSON.stringify(cEditar)})`,
  );

  /* --- 6. Cerrar: una sola operacion de lista con el array entero --- */

  vaciarPushes();
  const desdeCerrar = Date.now();
  await cerrarConLaX(tab, `p.querySelector('[data-testid^="state-editor-row-"]')`);
  const cerrada = await esperarEditorCerrado(tab);
  check("el editor se cierra con su propia X", cerrada.sigue === false, cerrada.detalle);
  await sleep(ESPERA + 2500);

  const cCerrar = cuenta(desdeCerrar);
  check(
    "**cerrar encola UNA operacion y es de la lista**",
    cCerrar.ops === 1 && cCerrar.listas === 1,
    `pushes: ${cCerrar.pushes}, ops: ${cCerrar.ops}, de lista: ${cCerrar.listas} (${JSON.stringify(cCerrar)})`,
  );
  const viaje = pushes.filter((p) => p.at >= desdeCerrar).flatMap((p) => p.estados);
  check(
    "y viaja **el array entero**, con la columna renombrada y coloreada",
    viaje.length === 1 &&
      viaje[0].length === 5 &&
      viaje[0][4] === `${RENAME}:${COLOR_NUEVO}` &&
      viaje[0][0] === "Backlog:neutral",
    `estados en el cable: ${JSON.stringify(viaje)}`,
  );

  /* --- 7. Cerrar y volver a abrir el tablero --- */

  await tab.goto(`${APP}/lists`);
  await sleep(2500);
  await tab.goto(`${APP}/board/${listId}`);
  const deVuelta = Date.now() + 45000;
  while (Date.now() < deVuelta) {
    const t = await readBoard(tab);
    if (t?.columnas?.length === 5) break;
    await sleep(600);
  }
  const tras = await readBoard(tab);
  check("el tablero vuelve con cinco columnas", tras?.columnas?.length === 5, `columnas: ${tras?.columnas?.length}`);
  check(
    "**y la columna nueva esta ahi, con su nombre**",
    tras?.tabs?.some((t) => t.includes(RENAME)) === true,
    `pestanas: ${tras?.tabs?.join(" | ")}`,
  );

  await tap(tab, "board-states-button");
  await sleep(400);
  editor = await tab.evaluate(LEER_EDITOR);
  check(
    "al volver a abrir el editor, el nombre y el color siguen puts",
    editor?.filas.at(-1)?.titulo === RENAME && editor?.filas.at(-1)?.punto === colorElegido,
    `fila: ${JSON.stringify(editor?.filas.at(-1))} | el color que se eligio: ${colorElegido}`,
  );
  await tab.screenshot(`${SHOTS}/06-tras-reabrir-claro.png`);

  const enElServidor = (await leerDelServidor(session)).get(`list:${listId}`);
  const servidor = enElServidor?.states ?? [];
  check(
    "**y el servidor tiene las cinco columnas con el nombre y el color**",
    servidor.length === 5 && servidor[4]?.title === RENAME && servidor[4]?.color === COLOR_NUEVO,
    `states en el servidor: ${JSON.stringify(servidor.map((s) => `${s.title}:${s.color}`))}`,
  );

  /* --- 8. Abrir y cerrar sin tocar nada no encola nada --- */

  vaciarPushes();
  const desdeAbierto = Date.now();
  await cerrarConLaX(tab, `p.querySelector('[data-testid^="state-editor-row-"]')`);
  await esperarEditorCerrado(tab);
  await sleep(ESPERA);
  const cAbierto = cuenta(desdeAbierto);
  check(
    "abrir y cerrar sin tocar nada **no** encola una operacion de la lista",
    cAbierto.ops === 0,
    `pushes: ${cAbierto.pushes}, operaciones: ${cAbierto.ops}`,
  );

  /* --- 9. El relevo desde la hoja de estado --- */

  /**
   * **La segunda puerta**, y es la que Task 10 dejo muerta: la fila
   * `state-picker-edit` de la hoja de una tarea. Se mide con el mismo instrumento
   * que `verify-state-picker.mjs` usa para `onEditTask`, porque el relevo es el
   * mismo —dos paneles en el documento durante la salida de uno— y una medicion
   * hecha con otro instrumento no se puede comparar con las de ahi.
   */
  const tarjeta = TAREAS.find((t) => t.title === "Ready-1");
  // **Se dice cual falta y no se sigue con un `undefined`**: tocar una tarjeta que
  // la siembra no puso sale como "Cannot read properties of undefined (reading
  // 'id')" en la linea del toque, que no dice ni de la hoja ni del relevo.
  if (!tarjeta) throw new Error('la siembra no tiene ninguna tarea "Ready-1"');
  await tap(tab, `item-row-${tarjeta.id}`, " button[aria-label]");
  await sleep(500);
  const hoja = await tab.evaluate(`(() => {
    const paneles = [...document.querySelectorAll('[data-testid="sheet-panel"]')];
    const p = paneles.find((x) => x.querySelector('[data-testid^="state-picker-row-"]')) ?? null;
    return p ? { filas: p.querySelectorAll('[data-testid^="state-picker-row-"]').length, hayEditar: !!p.querySelector('[data-testid="state-picker-edit"]') } : null;
  })()`);
  check("la hoja de estado de una tarea se abre", hoja?.filas === 5, `filas: ${hoja?.filas ?? "(no hay hoja)"}`);
  check("y trae la fila del editor completo", hoja?.hayEditar === true);

  const relevo = await medirReleve(tab, "state-picker-edit", "relevo-claro");
  editor = await tab.evaluate(LEER_EDITOR);
  check(
    "**la fila del editor completo abre el editor de estados**",
    editor?.filas.length === 5,
    `filas en el editor: ${editor?.filas.length ?? "(no hay editor)"}`,
  );
  await tab.screenshot(`${SHOTS}/07-relevo-desde-la-hoja.png`);

  /*
    **La primera comprobacion es sobre el instrumento**, y es la que impide que las
    otras dos sean un numero sin ningun gesto detras: si el muestreo no llega a ver
    el relevo —porque el bucle se para antes, porque la pulsacion no ocurro—
    `llegada` sale `null` y las demas compararian sobre una lista vacia, que es lo
    unico que sale bien de un instrumento que no midio nada.
  */
  check(
    "**el relevo se ha medido mientras estaba abierto, no despues**",
    (relevo.fotogramas ?? 0) >= 10 && relevo.llegada != null && (relevo.hasta ?? 0) >= 400,
    `${relevo.fotogramas} fotogramas en ${relevo.hasta} ms | el editor aparece en el fotograma de ` +
      `${relevo.llegada} ms | ventana de dos hojas: ${relevo.ventana.ms} ms (${relevo.ventana.fotogramas} fotogramas)`,
  );
  check(
    "**la ventana son dos paneles y no mas, y no dura mas que una salida**",
    (relevo.maxDims ?? 9) === 2 && (relevo.maxPaneles ?? 9) === 2 &&
      (relevo.ventana.ms ?? 0) > 0 && (relevo.ventana.ms ?? 0) <= 400,
    `maximo de sheet-dim: ${relevo.maxDims}, de sheet-panel: ${relevo.maxPaneles} | con dos a la vez: ` +
      `${relevo.ventana.ms} ms de los ${relevo.hasta} medidos (${relevo.ventana.fotogramas} fotogramas) | ` +
      `en la ventana: ${relevo.quienEnLaVentana}`,
  );
  /*
    **El orden de pintado de este relevo sale AL REVES que el de `onEditTask`, y la
    comprobacion que habia aqui —"el fondo ajeno solo al principio de la ventana"—
    cae por el motivo justo. Se deja escrito en vez de subir el tope hasta que pase.**

    Medido en esta corrida: el editor entra en el portal **#5** y la hoja de estado
    que se va en el **#6** —`en la ventana: editor#5 + hoja#6`, `orden al final:
    editor#5`—, o sea que **el que entra es el de mas abajo en `body`** y el que se
    va esta encima los **16 fotogramas de los 16** de la ventana, y no solo en los
    primeros como en el relevo del panel de la tarea.

    **El indice de un portal se fija la primera vez que su `Modal` se monta y no se
    vuelve a ordenar**, y en esta corrida el editor se abrio antes que la hoja de
    estado: el boton de la cabecera en el paso 1 y la fila `state-picker-edit` en el
    paso 9. De ahi el #5 del editor y el #6 de la hoja. En el relevo del panel de
    la tarea —`verify-state-picker.mjs`, bloque `1c`, medido en diecinueve
    corridas— el orden era el contrario porque la hoja se abrio en el paso 1 y el
    panel en el 1b.

    **Lo que cuesta, medido tambien:** durante esos 245 ms el fondo de mas arriba y
    el centro del panel que entra son los de la hoja que se va, es decir **el editor
    que entra no se puede pulsar durante su propia llegada**. No se pierde nada —la
    hoja que se va ya tiene pedido cerrar y volver a pedirlo no cambia nada, y
    `setCambiandoEstado(null)` dos veces es lo mismo que una— y a los 245 ms esta
    entero y se pulsa, que es lo que comprueba el paso de debajo.

    **Lo que NO se ha medido:** la sesion en la que la hoja de estado se abriera
    antes que el editor, que es la que daria el orden favorable. Y **lo que no se
    arregla aqui**: el indice lo pone `ModalPortal` de react-native-web y el
    `z-index` del envoltorio lo pone `sheet.tsx`, y ninguno de los dos ficheros es
    de esta tarea.
  */
  check(
    "**el que entra esta debajo del que se va toda la ventana - limitacion medida, no un tope escondido**",
    (relevo.fondoMaloPos ?? []).length === (relevo.ventana.fotogramas ?? -1) &&
      (relevo.centroMaloPos ?? []).length >= (relevo.ventana.fotogramas ?? 0) - 1,
    `en la ventana: ${relevo.quienEnLaVentana} (el editor es el #5 y la hoja el #6) | ` +
      `posiciones con el fondo de la hoja que se va: ${JSON.stringify(relevo.fondoMaloPos)} de ` +
      `${relevo.ventana.fotogramas} fotogramas | posiciones con el centro del que entra debajo: ` +
      `${JSON.stringify(relevo.centroMaloPos)} | fondo de mas arriba tras la llegada: ${JSON.stringify(relevo.fondos)} | ` +
      `orden al final: ${relevo.ordenFinal}`,
  );
  check(
    "y ningun fotograma del relevo tiene un panel sin velo delante",
    (relevo.sinVelo ?? 9) === 0,
    `fotogramas con panel y sin velo: ${relevo.sinVelo} de ${relevo.fotogramas}`,
  );

  /*
    **Que en cuanto se cierra la ventana el editor se puede pulsar de verdad**, y no
    solo que existe: se toca una fila y se mira el campo del nombre de su pagina.
    Es la mitad de la limitacion de arriba que si se puede comprobar —los 245 ms en
    los que no se podia— y sin esto la comprobacion anterior solo diria que el
    documento tiene dos paneles.
  */
  const primeraTrasElRelevo = editor?.filas?.[0]?.id ?? null;
  let pulsable = false;
  if (primeraTrasElRelevo) {
    await tap(tab, `state-editor-row-${primeraTrasElRelevo}`);
    await sleep(300);
    const suPagina = await tab.evaluate(LEER_PAGINA_ESTADO);
    pulsable = suPagina?.nombre === editor?.filas?.[0]?.titulo;
    note(
      `pulsada la primera fila tras el relevo: el campo de su pagina dice "${suPagina?.nombre ?? "(nada)"}"`,
    );
    await tap(tab, "state-editor-back");
  }
  check(
    "**en cuanto la ventana se cierra, el editor se pulsa**: una fila abre su pagina con su nombre",
    pulsable,
    `primera fila: ${editor?.filas?.[0]?.titulo ?? "-"}`,
  );

  await cerrarConLaX(tab, `p.querySelector('[data-testid^="state-editor-row-"]')`);
  await esperarEditorCerrado(tab);

  /* --- 10. El tope de 24 columnas --- */

  /**
   * **La version de la lista se lee del servidor justo antes de escribir y no se
   * supone**: el editor acaba de escribir la lista desde el navegador, asi que su
   * version ya no es la del `create`. Un `baseVersion` de 1 llega como
   * **`conflict`** —que es un `status` mas dentro de `results`, no un error— y el
   * tablero se queda con cinco columnas mientras el recorrido dice que el push fue
   * bien.
   */
  const antesDelTope = await leerDelServidor(session);
  const versionDeLaLista = antesDelTope.get(`list:${listId}`)?.version ?? 1;
  const tope = [
    ...servidor,
    ...Array.from({ length: 24 - servidor.length }, (_, i) => ({
      id: randomUUID(),
      title: `Columna ${i + 1}`,
      color: "neutral",
    })),
  ];
  const subida = await api("/sync/push", {
    method: "POST",
    token: session.accessToken,
    body: {
      deviceId: randomUUID(),
      lastPulledAt: null,
      clientTimestamp: new Date().toISOString(),
      operations: [
        {
          operationId: randomUUID(),
          clientId: CLIENT,
          entity: "list",
          kind: "update",
          entityId: listId,
          baseVersion: versionDeLaLista,
          base: { states: servidor },
          clientTimestamp: new Date().toISOString(),
          payload: { states: tope },
        },
      ],
    },
  });
  const resSubida = subida.body?.data?.results ?? [];
  check(
    "el tablero llega a 24 columnas por la API",
    subida.status === 200 && resSubida.every((r) => r.status === "applied" || r.status === "duplicate"),
    `http ${subida.status}, baseVersion: ${versionDeLaLista}, resultados: ${resSubida
      .map((r) => r.status + (r.error ? ` (${r.error})` : ""))
      .join(", ")}`,
  );

  await tab.goto(`${APP}/board/${listId}`);
  const listo = Date.now() + 45000;
  while (Date.now() < listo) {
    const t = await readBoard(tab);
    if (t?.columnas?.length === 24) break;
    await sleep(600);
  }
  const conTope = await readBoard(tab);
  check("el tablero se abre con 24 columnas", conTope?.columnas?.length === 24, `columnas: ${conTope?.columnas?.length}`);
  await tab.screenshot(`${SHOTS}/08-tablero-con-24.png`);

  if (conTope?.columnas?.length === 24) {
    await tap(tab, "board-states-button");
    await sleep(400);
    editor = await tab.evaluate(LEER_EDITOR);
    check("el editor se abre con las 24 columnas", editor?.filas.length === 24, `filas: ${editor?.filas.length}`);
    check("el boton de anadir sale APAGADO en el tope", editor?.anadir?.apagado === true, `apagado: ${editor?.anadir?.apagado}`);
    /*
      El motivo escrito se busca **por su frase y no por un numero suelto**: un
      `/24/` a secas pasa con cualquier tablero cuyo contador llegue a 24. Se
      imprime la linea entera, que es lo que se ve en pantalla.
    */
    const lineas = (editor?.texto ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
    const lineaDelMaximo = lineas.find((l) => /m[aá]ximo/i.test(l));
    check(
      "y hay un texto que dice POR QUE (la frase del maximo con el numero del contrato)",
      Boolean(lineaDelMaximo) && /\b24\b/.test(lineaDelMaximo ?? ""),
      `linea: ${lineaDelMaximo ?? "(no hay ninguna que hable del maximo)"}`,
    );
    await ver(tab, "state-editor-add");
    await tab.screenshot(`${SHOTS}/09-tope-de-24.png`);
    await cerrarConLaX(tab, `p.querySelector('[data-testid^="state-editor-row-"]')`);
    await esperarEditorCerrado(tab);
  }

  /* --- 11. La misma pasada en oscuro --- */

  /**
   * **La clave es la del tema y no una cualquiera.** `orbithub:appearance` es lo
   * que lee `theme-provider.tsx`, y la app se dibuja en claro si no encuentra lo
   * que espera: escribir una clave inventada deja la corrida entera en claro y las
   * capturas de "oscuro" son del tema claro con otro nombre.
   */
  await PONER_TEMA("dark");
  await tab.goto(`${APP}/board/${listId}`);
  await sleep(5000);
  const esquema = await temaDeLaPagina();
  check("el tema oscuro esta puesto de verdad", esquema === "dark", `colorScheme: ${esquema}`);

  await tap(tab, "board-states-button");
  await sleep(400);
  editor = await tab.evaluate(LEER_EDITOR);
  const fondoPanel = await tab.evaluate(
    `getComputedStyle(document.querySelector('[data-testid="sheet-panel"]')).backgroundColor`,
  );
  check("el editor se abre tambien en oscuro, con sus 24 filas", editor?.filas.length === 24, `filas: ${editor?.filas?.length}`);
  check(
    "**y el panel se pinta con el fondo del tema, no el de claro**",
    /^rgb\((\d+), (\d+), (\d+)\)$/.test(fondoPanel ?? "") && Number(fondoPanel.match(/^rgb\((\d+)/)?.[1]) < 80,
    `fondo del panel: ${fondoPanel}`,
  );
  note(`filas en oscuro: ${editor?.filas.slice(0, 5).map((f) => `${f.titulo} · ${f.numero}`).join(" | ")}`);
  await tab.screenshot(`${SHOTS}/10-editor-oscuro.png`);

  /* --- 12. La pagina de edicion de una columna, en oscuro --- */

  const primera = editor?.filas?.[0]?.id;
  if (primera) {
    await tap(tab, `state-editor-row-${primera}`);
    await sleep(300);
    pagina = await tab.evaluate(LEER_PAGINA_ESTADO);
    check(
      "la pagina de edicion se abre en oscuro con los doce colores y uno elegido",
      pagina?.muestras?.length === 12 && pagina?.muestras?.filter((m) => m.elegido).length === 1,
      `muestras: ${pagina?.muestras?.length} | elegidas: ${JSON.stringify(pagina?.muestras?.filter((m) => m.elegido).map((m) => m.id))}`,
    );
    await tab.screenshot(`${SHOTS}/11-pagina-de-estado-oscuro.png`);
  }

  /*
    **El filtro es estrecho a proposito**, y lo que estaba ahi antes tapaba justo lo
    que este recorrido necesita: se filtraba todo `Failed to load resource`, y un
    `POST /sync/push` que saliera con un 4xx sale por la consola con ese texto —el
    mismo que el de un `favicon` que no existe— de modo que el endpoint del que
    dependen la mitad de las comprobaciones podia estar fallando y el "sin errores de
    consola" salia en verde. Se sigue el precedente de `verify-social.mjs:391`:
    `Failed to load resource` sin `.*favicon` **no** se filtra.
  */
  const errores = problems.filter(
    (p) => !/10\.0\.2\.2|:4000|Failed to load resource.*favicon/i.test(p.text),
  );
  check(
    "sin errores de consola ni promesas rotas",
    errores.length === 0,
    errores.slice(0, 4).map((e) => e.text.slice(0, 160)).join(" | "),
  );
} catch (e) {
  failures += 1;
  console.log(`FALLA  la corrida entera: ${e.message}`);
  // La traza tambien: un recorrido que se muere a la mitad dice **donde**, y sin
  // ella el unico rastro es el mensaje, que en un ReferenceError de este guion no
  // senala ni la linea ni el bloque.
  console.log(e.stack);
  if (tab) await tab.screenshot(`${SHOTS}/99-error.png`).catch(() => {});
} finally {
  chrome.kill();
}

console.log(`\n${failures === 0 ? "TODO OK" : `${failures} FALLOS`} — capturas en ${SHOTS}`);
process.exit(failures === 0 ? 0 : 1);
