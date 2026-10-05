import { randomUUID } from "node:crypto";
import { execSync } from "node:child_process";
import { readFile } from "node:fs/promises";

import { launchChrome, openTab, seedSession, collectProblems } from "./cdp.mjs";

/**
 * La hoja de estado, en un navegador.
 *
 * Los puntos que solo se pueden mirar, y el orden en que se miran:
 *
 *  - la hoja se abre tocando una tarjeta y **el estado actual sale marcado**;
 *  - los contadores son los de `countInState`, **sin corregir el de la columna actual**;
 *  - elegir otra columna mueve la tarjeta **y no la hace desaparecer de ninguna**;
 *  - elegir la columna en la que ya está **no encola nada** — y esto se mide en el
 *    outbox, no en la pantalla: el movimiento se ve igual con o sin operación;
 *  - «+ Nuevo estado...» crea el estado y la tarjeta cae dentro, **con las dos
 *    escrituras en el orden que el servidor acepta** (el `stateId` antes de que la
 *    columna exista es un rechazo silencioso dentro de un 200);
 *  - el tope de 24 apaga el botón y lo dice;
 *  - y al **cerrar la app y volver** todo sigue ahí, que es el outbox.
 *
 * Cada respuesta del push se mira **por dentro**: un 200 con `results` de
 * `rejected` es un sembrado que parece bueno y deja el tablero vacío, y es el
 * fallo que hace perder una tarde entera.
 */

const APP = process.env.APP_URL ?? "http://localhost:8087";
const API = process.env.API_URL ?? "http://localhost:4100/api/v1";
const SHOTS = process.env.SHOTS ?? "/tmp/orbit-state-picker";

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
 * **Una IP distinta en cada corrida**, y es lo que hace `carry-session.mjs` con el
 * mismo comentario: la API limita las llamadas de autenticacion por IP, de modo
 * que dos recorridos seguidos desde la misma direccion se comen la ventana del
 * otro. `x-forwarded-for` es la cabecera que la API lee para eso.
 *
 * Sin esto, y con la cuenta fija, la segunda corrida se come el `429` de la
 * primera y el fallo se canta en un sitio donde no esta la causa — que es
 * exactamente lo que paso aqui: `account()` fallaba con `http 200` y sin sesion,
 * que es lo que responde el login cuando la cuenta existe y **no esta verificada**.
 */
const IP = `10.92.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}`;

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
  // Las cabeceras tambien: un 429 dice en `Retry-After` cuando se puede volver a
  // intentarlo, y es la API la que lo sabe.
  return { status: r.status, body: t ? JSON.parse(t) : null, headers: r.headers };
}

let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures += 1;
  console.log(`${ok ? "ok    " : "FALLA "} ${name}${detail ? ` — ${detail}` : ""}`);
};
const note = (text) => console.log(`      ${text}`);

/**
 * Una llamada a la API que **espera** su `Retry-After` en vez de rendirse.
 *
 * El limite de auth son 7 llamadas sensibles por IP cada quince minutos, asi que un
 * recorrido que muere con un `429` es un recorrido que hay que relanzar a mano — y
 * eso es justo lo que la Task 15 le pide a este fichero: que se pueda volver a
 * correr. Se espera lo que la propia API dice que hay que esperar, y no un numero
 * escrito aqui.
 */

/**
 * Lo que el servidor tiene ahora, **como un mapa de `"entidad:id"` a fila.**
 *
 * El pull devuelve `changes` como un **array de `{ entity, record }`**
 * (`syncChangeSchema`), y el `record` es la fila plana —el `stateId` esta en
 * `record.stateId` y no en `record.payload.stateId`—. Una comprobacion que lo lea
 * como un objeto de objetos, o como `payload`, no encuentra nada y falla diciendo
 * que el servidor no tiene la columna, que es lo que paso aqui antes de mirar el
 * contrato.
 *
 * Se tira de todo el historico (`lastPulledAt: null`) y **sin cursor**, porque lo que
 * se busca es el estado actual de una fila concreta y no "lo que ha cambiado desde
 * la ultima vez"; con un recorrido de esta cuenta eso es una condicion mas que
 * puede fallar sin que el servidor tenga nada malo.
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
  const cambios = r.body?.data?.changes ?? [];
  const mapa = new Map();
  for (const cambio of cambios) {
    if (cambio?.entity && cambio?.record) {
      mapa.set(`${cambio.entity}:${cambio.record.id}`, cambio.record);
    }
  }
  return mapa;
}

async function apiConEspera(path, opciones = {}) {
  for (let intento = 1; ; intento += 1) {
    const r = await api(path, opciones);
    if (r.status !== 429) return r;
    const retry = Number(r.headers?.get?.("retry-after")) || 60;
    const espera = Math.min(Math.max(retry, 5), 600);
    note(
      `429 en ${path}: la API pide ${retry}s y se esperan ${espera}s ` +
        `(intento ${intento}). El limite de auth son 7 llamadas sensibles por IP cada 15 min.`,
    );
    await sleep(espera * 1000);
  }
}

async function account() {
  const password = "a-very-long-password";
  const device = { label: "state-picker", platform: "web" };

  /*
    **El correo es de esta corrida y no uno fijo.** El limite de autenticacion es
    **por IP** —`carry-session.mjs` lo dice y por eso manda un `x-forwarded-for`
    distinto en cada pasada—, de modo que con cuenta fija e IP fija la segunda
    corrida se encuentra con la cuenta **sin verificar** de la primera a medias: el
    login responde entonces **http 200** con `{ status: "email_verification_required" }`,
    que no es un 401 y por lo tanto no dice "esta cuenta no existe". Asi que el fallo
    se canta en `account()` con un codigo de exito, que es la forma mas cara de "no
    hay sesion" que tiene esta API.

    Un alta nueva por corrida es lo que hace el propio `carry-session.mjs`, y con la
    IP distinta la ventana del limitador ni se mira.
  */
  const email = `state-picker-${Date.now().toString(36)}@example.com`;

  // El token de verificacion se lee del log de la API, **del trozo que hay desde
  // este alta**: el log acumula los correos de todas las cuentas, y con el primero
  // que aparezca se verifica la cuenta de otra corrida.
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
 * Un tablero con **cinco** columnas y tareas en las cuatro primeras.
 *
 * `states` va en la propia operacion de `create` de la lista, porque el editor de
 * estados es una tarea posterior y todavia no existe: sembrar la lista sin el
 * array deja `states: []`, la pantalla responde `board.noStates` y no hay ningun
 * tablero contra el que comprobar nada.
 *
 * Las tareas nacen con `stateId: null` —**que es lo que hace `newListItem` en el
 * cliente**— y por eso la primera columna las cuenta a todas. Es tambien el caso
 * que muerde la comparacion en crudo de la hoja, y por eso esta siembra lo trae de
 * serie en vez de repartir los ids a mano.
 */
const ESTADOS = [
  { id: randomUUID(), title: "Backlog", color: "neutral" },
  { id: randomUUID(), title: "Ready", color: "blue" },
  { id: randomUUID(), title: "WIP", color: "amber" },
  { id: randomUUID(), title: "Review", color: "rose" },
  { id: randomUUID(), title: "Done", color: "green" },
];

const session = await account();
const ws = randomUUID();
const listId = randomUUID();
const at = new Date().toISOString();
const CLIENT = "verify-state-picker";

/** Los ids de las tareas, para buscar su tarjeta por `testID` y no por su texto. */
const TAREAS = ESTADOS.slice(0, 4).flatMap((estado, indice) =>
  [0, 1].map((n) => ({
    id: randomUUID(),
    title: `${estado.title}-${n + 1}`,
    position: indice * 2 + n,
    stateId: indice === 0 ? null : estado.id,
  })),
);
const porTitulo = new Map(TAREAS.map((t) => [t.title, t]));
/** Id -> título, para el código que corre dentro de la página. */
const TITULOS_POR_ID = Object.fromEntries(TAREAS.map((t) => [t.id, t.title]));

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
        // `orderMode: 'manual'` porque el tablero lo fija, y `states` porque sin el
        // array no hay columnas.
        payload: {
          workspaceId: ws,
          folderId: null,
          title: "Envíos",
          kind: "board",
          orderMode: "manual",
          states: ESTADOS,
        },
      },
      ...TAREAS.map((tarea, i) => ({
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
  operaciones rechazadas es un 200 con `rejected` dentro, y una siembra que solo mira
  el codigo parece buena y deja un tablero vacio.
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

/* ------------------------------------------------------------------ el DOM -- */

/** Las filas de la hoja, con su nombre y su número, tal como están pintadas. */
const LEER_HOJA = `(() => {
  const panel = document.querySelector('[data-testid="sheet-panel"]');
  if (!panel) return null;
  const filas = [...panel.querySelectorAll('[data-testid^="state-picker-row-"]')].map((el) => {
    const id = el.getAttribute('data-testid').replace('state-picker-row-', '');
    const numero = panel.querySelector('[data-testid="state-picker-count-' + id + '"]');
    return {
      id,
      titulo: (el.innerText || '').split('\\n')[0] ?? '',
      // **El numero sale de su propio elemento y no del texto de la fila.** La fila
      // marcada lleva un glifo de check al final, asi que trocear su innerText
      // devuelve NaN justo en la fila que mas importa comprobar.
      numero: numero ? Number(numero.innerText) : null,
      marcada: (el.getAttribute('aria-label') ?? '').includes('está aquí'),
      fondo: getComputedStyle(el).backgroundColor,
    };
  });
  const nuevo = panel.querySelector('[data-testid="state-picker-new"]');
  return {
    titulo: panel.querySelector('div')?.innerText ?? null,
    filas,
    nuevo: nuevo ? { texto: nuevo.innerText, disabled: nuevo.getAttribute('aria-disabled') === 'true' || nuevo.disabled === true } : null,
    hayBotonEditar: !!panel.querySelector('[data-testid="state-picker-edit"]'),
    texto: panel.innerText,
  };
})()`;

/**
 * Qué columnas está el tablero mostrando y qué hay dibujado en cada una.
 *
 * Las tarjetas se localizan por su `testID`, que es el **id** de la tarea y no su
 * texto: un título escrito a mano puede aparecer en dos sitios y un texto que se
 * renombra rompe la comprobación sin que cambie nada. El mapa de ids a títulos se
 * inyecta en el código de la página, que no tiene acceso a este módulo.
 */
const TABLERO = `(() => {
  const NOMBRES = ${JSON.stringify(TITULOS_POR_ID)};
  const slots = [...document.querySelectorAll('[data-testid^="board-slot-"]')];
  return {
    tabs: [...document.querySelectorAll('[data-testid^="board-tab-"]')].map((el) => ({
      id: el.getAttribute('data-testid').replace('board-tab-', ''),
      texto: (el.innerText || '').replace(/\\n/g, ' '),
      seleccionada: el.getAttribute('aria-selected') === 'true',
    })),
    columnas: slots.map((slot) => ({
      columna: slot.getAttribute('data-testid').replace('board-slot-', ''),
      tarjetas: [...slot.querySelectorAll('[data-testid^="item-row-"]')].map((el) => {
        const id = el.getAttribute('data-testid').replace('item-row-', '');
        return NOMBRES[id] ?? id;
      }),
    })),
  };
})()`;

const readBoard = (tab) => tab.evaluate(TABLERO);

/** Donde esta el centro de un elemento por su `testID`, o `null` si no esta. */
/**
 * El centro de un elemento, por su `testID` y opcionalmente por un descendiente.
 *
 * **`dentro` existe por una razon medida**: el `testID` de una tarjeta esta en la
 * `View` que la envuelve, y **la `View` no es pulsable** —el `<button>` del titulo
 * es un hijo suyo y solo ocupa el ancho del texto. El centro de la tarjeta cae en
 * el hueco de la derecha, fuera del boton, y el recorrido falla en "tocar una
 * tarjeta abre la hoja de estado" con la hoja perfectamente bien.
 *
 * Antes de tocar el boton con el raton se probo con el dedo en el centro de la
 * tarjeta, creyendo que el toque subia por el arbol. La cadena de
 * `elementFromPoint` medida en ese punto dice lo contrario: `item-title-line` ->
 * `item-row` -> `board-cards` -> `board-column` -> `board-slot`, **sin un solo
 * `<button>` en ella**. Un toque en un punto que no esta sobre el control no lo
 * activa por mucho que el ancestro tenga manejadores.
 */
const centro = (tab, testId, dentro) =>
  tab.evaluate(`(() => {
    // **El selector se arma con \`JSON.stringify\` y no con comillas a pelo.**
    // React Native Web escribe los \`testID\` como \`data-testid\`, y un id como
    // \`item-row-6a0068a7-…\` entre comillas dobles es un selector que el navegador
    // rechaza: el fallo sale como \`SyntaxError\` de \`querySelector\` en una linea
    // que no parece tener nada que ver con lo que se estaba tocando.
    // \`JSON.stringify\` ademas escapa el valor, de modo que un id con comillas no
    // rompe el JavaScript que se esta evaluando.
    const el = document.querySelector('[data-testid=' + JSON.stringify(${JSON.stringify(testId)}) + ']' + ${JSON.stringify(dentro ?? "")});
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return null;
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width), h: Math.round(r.height) };
  })()`);

/**
 * Un toque de dedo, **y solo de dedo.**
 *
 * **Medido en este mismo tablero**: con `Input.dispatchTouchEvent` a secas la hoja
 * se abre, y con el par de raton añadido al mismo punto **no se abre**. La razon es
 * que un `Pressable` de react-native-web es un `<button>` con manejadores de
 * puntero: el navegador sintetiza los eventos de compatibilidad a partir del toque,
 * y al mandarlos tambien a mano le llegan dos secuencias de puntero sobre el mismo
 * elemento —con la segunda empezando antes de que termine la primera— y la que gana
 * no es la del dedo.
 *
 * Asi que el toque va solo. `mousePressed`/`mouseReleased` quedan para lo que sea de
 * verdad un clic, y en esta app no hay nada que lo sea: las tarjetas se abren al
 * tocarlas.
 *
 * **El punto es el centro del `testID` y no el de su `<button>`.** El `testID` de la
 * tarjeta esta en la `View` que la envuelve y el boton del titulo es un hijo suyo; el
 * centro de la tarjeta cae dentro del area pulsable en una tarjeta de una linea y el
 * toque sube por el arbol, que es lo que lo hace funcionar. Con el `elementFromPoint`
 * medido sobre el centro de la tarjeta se ve la cadena completa: `item-title-line` ->
 * `item-row` -> `board-cards` -> `board-column` -> `board-slot`, **sin un solo
 * `<button>` en ella**, porque el titulo ocupa la izquierda y el centro cae en el
 * hueco de la derecha. Por eso el punto se pide del `testID` y no del boton.
 */
async function tap(tab, testId, dentro) {
  const p = await centro(tab, testId, dentro);
  if (!p) throw new Error(`no encuentro ${testId}${dentro ?? ""}`);
  await tab.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: p.x, y: p.y, radiusX: 8, radiusY: 8, force: 1 }],
  });
  await sleep(80);
  await tab.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(400);
  return p;
}

/**
 * **Tocar una tarjeta por su boton de titulo**, y no por el centro de la tarjeta.
 *
 * Es el unico control de la tarjeta que abre la hoja de estado, y `task-row.tsx` lo
 * pone como el `<button>` con `aria-label` del titulo. Se busca por
 * `button[aria-label]` **y no por la clase**: una clase de react-native-web es un
 * nombre interno que cambia entre versiones —`r-cursor-1loqt21` hoy—, y un recorrido
 * que depende de ella se rompe con una actualizacion sin que cambie la app.
 */
const tapTarjeta = (tab, id) => tap(tab, `item-row-${id}`, " button[aria-label]");

const chrome = await launchChrome({ width: 1440, height: 900 });
let tab;
try {
  tab = await openTab(chrome.port);

  /*
    **La ventana se fija por CDP y no solo con `--window-size`.**

    Con la bandera sola esta corrida vino up en **500 x 845**, que es un ancho de
    movil, y ahi el tablero cae en el modo de `columnLayout` de **una columna a
    pantalla completa** (`BOARD_SINGLE_COLUMN_BELOW` = 720). Las otras cuatro
    existen en el DOM pero estan desplazadas fuera de la pantalla, asi que
    `centro()` devuelve unas coordenadas fuera del viewport y
    `Input.dispatchTouchEvent` no las recibe: el recorrido tocaba una tarjeta que
    no estaba en pantalla y "tocar una tarjeta abre la hoja de estado" fallaba sin
    que hubiera nada malo en la hoja.

    `Emulation.setDeviceMetricsOverride` pone el viewport **ahi donde se pide**, que
    es lo unico que hace que un toque sea un toque. A 1440 caben las cinco columnas
    de 230 (`columnLayout`: `floor((1392 + 16) / (230 + 16))` = 5), que es la
    disposicion que miden las capturas del plan, y cada `testID` que este recorrido
    toca esta de verdad en pantalla.

    **Lo que esto NO mide**: el ancho de movil. La hoja se usa con el pulgar, y a
    500 el recorrido habria que rehacerlo entera —tocar antes la columna que esta
    a la vista— en vez de fallar en un elemento fuera de pantalla.
  */
  await tab.send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const viewport = await tab.evaluate(
    "({ w: window.innerWidth, h: window.innerHeight })",
  );
  check(
    "el viewport es el pedido y no el que venga por defecto",
    viewport?.w === 1440,
    `innerWidth: ${viewport?.w} x ${viewport?.h}`,
  );

  const problems = collectProblems(tab);

  /*
    **La pasada en claro se fuerza, y el motivo es una captura que miente.**

    `ThemeProvider` resuelve `appearance: 'system'` con `useColorScheme()`, y **Chrome
    sin cabeza arranca en `prefers-color-scheme: dark`**. La primera pasada de este
    recorrido —la que se llamaba "claro" en el nombre del fichero y en los nombres de
    las capturas— salio entera en oscuro: el tablero, la hoja, el tope de 24. Las dos
    pasadas eran la misma pasada y las capturasTenian dos nombres.

    Por eso el tema se escribe en `orbithub:appearance` **antes de sembrar la sesion**
    y se **comprueba** despues con el mismo `document.documentElement.style.colorScheme`
    que escribe `theme-provider.tsx`: una pasada en el tema que no es seannota como tal
    en vez de presume de las dos.
  */
  const PONER_TEMA = (apariencia) =>
    tab.evaluate(`localStorage.setItem('orbithub:appearance', ${JSON.stringify(
      JSON.stringify({ appearance: apariencia, accent: "orbit" }),
    )})`);

  /*
    **Primero una carga y despues la preferencia**, porque `localStorage` necesita un
    documento con origen: en `about:blank` la escritura es un `SecurityError` y el
    recorrido muere antes de sembrar nada. `seedSession` ya hace esa primera carga,
    asi que el tema se escribe en medio de su propio ciclo: se siembra la sesion y
    luego se pone el tema, antes de la ultima carga que es la que se dibuja.
  */
  await seedSession(tab, session, APP);
  await PONER_TEMA("light");
  await tab.goto(`${APP}/board/${listId}`);
  // El tablero se dibuja despues del cache; el camino son las cuatro columnas.
  const ready = Date.now() + 45000;
  let visto = null;
  while (Date.now() < ready) {
    visto = await readBoard(tab);
    if (visto?.columnas?.length === 5) break;
    await sleep(600);
  }
  check("el tablero se abre con sus cinco columnas", visto?.columnas?.length === 5,
    `columnas: ${visto?.columnas?.length}`);
  if (visto?.columnas?.length !== 5) {
    await tab.screenshot(`${SHOTS}/00-no-abre.png`);
    throw new Error("el tablero no se abrio");
  }

  // El tema de esta pasada, comprobado y no supuesto. Ver el comentario del `PONER_TEMA`.
  const temaClaro = await tab.evaluate(
    `document.documentElement.style.colorScheme || getComputedStyle(document.documentElement).colorScheme`,
  );
  check("la primera pasada esta en CLARO de verdad", temaClaro === "light", `colorScheme: ${temaClaro}`);

  note(`columnas: ${visto.columnas.map((c) => `${c.columna.slice(0, 4)}=[${c.tarjetas.join(",")}]`).join(" ")}`);
  await tab.screenshot(`${SHOTS}/01-tablero-claro.png`);

  /* --- 1. La hoja se abre tocando una tarjeta, y el estado actual sale marcado --- */

  await tapTarjeta(tab, porTitulo.get("Ready-1").id);
  await sleep(500);
  let hoja = await tab.evaluate(LEER_HOJA);
  check("tocar una tarjeta abre la hoja de estado", hoja !== null);

  if (hoja) {
    note(`hoja: ${hoja.filas.map((f) => `${f.titulo} · ${f.numero}${f.marcada ? " [MARCADA]" : ""}`).join(" | ")}`);

    const marcada = hoja.filas.find((f) => f.marcada);
    check(
      "el estado actual sale marcado, y es Ready (donde esta la tarea)",
      marcada?.id === ESTADOS[1].id,
      `marcada: ${marcada?.id ?? "ninguna"} de ${ESTADOS.map((e) => e.title).join("/")}`,
    );
    check(
      "solo una fila sale marcada",
      hoja.filas.filter((f) => f.marcada).length === 1,
      `marcadas: ${hoja.filas.filter((f) => f.marcada).length}`,
    );
    check("hay una fila por estado", hoja.filas.length === 5, `filas: ${hoja.filas.length}`);

    /*
      Los contadores, **calculados aqui con la misma regla** en lugar de escritos a
      mano: una cuenta esperada escrita a mano sobrevive al cambio de la regla y
      pasa a comprobar otra cosa sin que se note.

      La regla es `stateOf`: `stateId` nulo y `stateId` que no existe cuentan en la
      primera columna. En esta siembra la primera tiene las dos tareas con `null` y
      las demas tienen las suyas, asi que los numeros son 2, 2, 2, 2, 0 — y el 0 de
      "Done" es el que demuestra que la hoja dibuja lo que le dieron y no un
      numero de la cuenta de filas.
    */
    const enLaColumna = (estado) =>
      TAREAS.filter((t) => {
        const suyo = t.stateId ?? ESTADOS[0].id;
        const resuelta = ESTADOS.some((e) => e.id === suyo) ? suyo : ESTADOS[0].id;
        return resuelta === estado.id;
      }).length;
    const contadores = hoja.filas.map((f) => ({ id: f.id, numero: f.numero }));
    for (const fila of contadores) {
      const estado = ESTADOS.find((e) => e.id === fila.id);
      const quiere = enLaColumna(estado);
      check(
        `el contador de ${estado?.title} es ${quiere}`,
        fila.numero === quiere,
        `dibujado ${fila.numero}`,
      );
    }
    check(
      "**el contador de la columna actual INCLUYE la tarea y no se corrige**",
      contadores.find((c) => c.id === ESTADOS[1].id)?.numero === 2,
      `Ready dice ${contadores.find((c) => c.id === ESTADOS[1].id)?.numero}, y sus tareas son 2`,
    );

    check("hay enlace al editor completo", hoja.hayBotonEditar);
    await tab.screenshot(`${SHOTS}/02-hoja-abierta-claro.png`);
  }

  /* --- 2. Elegir la columna en la que ya esta: no encola nada --- */

  /*
    **Como se mide "no encola nada".**

    La escritura es local antes que nada, asi que en la pantalla un movimiento que
    no escribe nada y uno que escribe se ven **exactamente igual**. Preguntar a la
    pantalla no puede contestarlo, y leer la base del navegador exigiria adivinar
    donde la deja `expo-sqlite` en web.

    Lo que si se puede leer es **lo que sale por el cable**: cada operacion del
    outbox viaja en el cuerpo de un `POST /sync/push`, y el vacio del outbox es
    un push que no ocurre. Se cuentan las peticiones y las operaciones de
    `list_item` que llevan, con `Network.requestWillBeSent` — que ve el cuerpo
    antes de que se envie, y por lo tanto antes de que el servidor pueda
    responder nada.

    Y se espera lo que hay que esperar: el motor de sincronizacion agrupa y deja
    salir las operaciones **alrededor de un segundo y medio** despues de escribirlas,
    asi que un push que no llega en cuatro segundos es un outbox vacio y no una
    sincronizacion lenta.
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
      items: ops.filter((o) => o?.entity === "list_item" && o?.kind === "update").length,
      listas: ops.filter((o) => o?.entity === "list" && o?.kind === "update").length,
      stateIds: ops.filter((o) => o?.entity === "list_item").map((o) => o?.payload?.stateId ?? null),
    });
  });

  const vaciarPushes = () => { pushes.length = 0; };
  const cuenta = (desde) => {
    const dentro = pushes.filter((p) => p.at >= desde);
    return {
      pushes: dentro.length,
      ops: dentro.reduce((t, p) => t + p.total, 0),
      updatesDeItem: dentro.reduce((t, p) => t + p.items, 0),
      updatesDeLista: dentro.reduce((t, p) => t + p.listas, 0),
    };
  };
  /** Los cinco segundos de gracia del agrupador, redondeados a seis. */
  const ESPERA = 6000;

  const desde1 = Date.now();
  await tap(tab, `state-picker-row-${ESTADOS[1].id}`);
  check("la hoja se cierra al elegir", (await tab.evaluate(LEER_HOJA)) === null);
  await sleep(ESPERA);
  const c1 = cuenta(desde1);
  check(
    "elegir la columna en la que ya esta NO encola nada (0 pushes en 6 s)",
    c1.pushes === 0 && c1.ops === 0,
    `pushes: ${c1.pushes}, operaciones: ${c1.ops} (${JSON.stringify(c1)})`,
  );

  /* --- 3. Elegir otra columna: la tarjeta se mueve y no desaparece --- */

  vaciarPushes();
  const desde2 = Date.now();
  await tapTarjeta(tab, porTitulo.get("Ready-1").id);
  await sleep(450);
  await tab.screenshot(`${SHOTS}/03-hoja-para-mover.png`);
  await tap(tab, `state-picker-row-${ESTADOS[3].id}`);
  await sleep(ESPERA);

  let tablero = await readBoard(tab);
  const enReview = tablero.columnas.find((c) => c.columna === ESTADOS[3].id)?.tarjetas ?? [];
  const enReady = tablero.columnas.find((c) => c.columna === ESTADOS[1].id)?.tarjetas ?? [];
  const enTodo = tablero.columnas.map((c) => c.tarjetas).flat();
  check("la tarjeta esta en la columna nueva", enReview.includes("Ready-1"), `Review: [${enReview.join(",")}]`);
  check("y no esta en la de la que salio", !enReady.includes("Ready-1"), `Ready: [${enReady.join(",")}]`);
  check(
    "**y no desaparece de ninguna parte**: sale una vez en todo el tablero",
    enTodo.filter((t) => t === "Ready-1").length === 1,
    `${enTodo.filter((t) => t === "Ready-1").length} apariciones de ${enTodo.length} tarjetas`,
  );
  check("ninguna otra tarjeta se ha movido", enTodo.length === TAREAS.length, `tarjetas: ${enTodo.length}`);
  note(`tableros: ${tablero.columnas.map((c) => `[${c.tarjetas.join(",")}]`).join(" ")}`);
  await tab.screenshot(`${SHOTS}/04-tras-mover-claro.png`);

  /*
    Una operacion de `list_item` y **ninguna otra**, que es lo que hace la funcion
    pura: el cambio de columna es un update de una fila y nada mas. Un push con dos
    updates de item seria una escritura duplicada, y uno con ninguna seria un
    movimiento que solo se ve en local — que es el otro fallo que la pantalla
    esconde.
  */
  const c2 = cuenta(desde2);
  check(
    "mover de columna encola UNA operacion de la tarea y nada mas",
    c2.updatesDeItem === 1 && c2.updatesDeLista === 0 && c2.ops === 1,
    `pushes: ${c2.pushes}, ops: ${c2.ops}, updates de item: ${c2.updatesDeItem}, de lista: ${c2.updatesDeLista}`,
  );
  const conElId = pushes.filter((p) => p.at >= desde2).flatMap((p) => p.stateIds);
  check(
    "y lleva el id de la columna elegida",
    conElId.length === 1 && conElId[0] === ESTADOS[3].id,
    `stateIds enviados: ${JSON.stringify(conElId)}`,
  );

  /* --- 4. «+ Nuevo estado...»: crea la columna y la tarjeta cae dentro --- */

  await tapTarjeta(tab, porTitulo.get("WIP-1").id);
  await sleep(450);
  hoja = await tab.evaluate(LEER_HOJA);
  check("la hoja se abre sobre otra tarjeta", hoja?.filas?.length === 5);
  await tab.screenshot(`${SHOTS}/05-hoja-para-nuevo-estado.png`);

  await tap(tab, "state-picker-new");
  await sleep(400);
  await tab.evaluate(`(() => {
    const el = document.querySelector('[data-testid="state-picker-name"]');
    if (!el) return 'no hay campo';
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, 'Revision final');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return 'escrito';
  })()`);
  await sleep(300);
  await tab.screenshot(`${SHOTS}/06-nuevo-estado-escrito.png`);
  vaciarPushes();
  const desde3 = Date.now();
  await tap(tab, "state-picker-create");
  await sleep(ESPERA + 2500);

  tablero = await readBoard(tab);
  const tituloNuevo = [...tablero.tabs].map((t) => t.texto).join(" | ");
  check("el estado nuevo existe en el tablero", /Revision final/.test(tituloNuevo), `pestanas: ${tituloNuevo}`);
  check("el tablero tiene ahora seis columnas", tablero.columnas.length === 6, `columnas: ${tablero.columnas.length}`);
  const enLaNueva = tablero.columnas[tablero.columnas.length - 1]?.tarjetas ?? [];
  check(
    "**la tarjeta cae dentro del estado nuevo** (las dos escrituras, en orden)",
    enLaNueva.includes("WIP-1"),
    `la columna nueva tiene [${enLaNueva.join(",")}]`,
  );
  await tab.screenshot(`${SHOTS}/07-estado-nuevo-creado-claro.png`);

  /*
    **El orden de las dos escrituras, mirado en el cable y no en la intention.**

    «+ Nuevo estado...» es un update de la lista y un update de la tarea. El
    servidor rechaza un `stateId` que su lista no tiene, con
    `isKnownStateId`, leyendo la lista **en el momento de aplicar la
    operacion** — asi que si la operacion de la tarea saliera antes, el push la
    rechazaria y el tablero no se moveria, con un 200 y sin que se note.

    Se mira, por tanto, el **orden dentro del mismo push**: las dos operaciones
    tienen que viajar juntas, y la de la lista antes. Si sale la de la tarea en un
    push y la de la lista en otro, hay una ventana en la que el servidor no
    conoce la columna.
  */
  const delNuevo = pushes.filter((p) => p.at >= desde3);
  const opsTotales = delNuevo.reduce((t, p) => t + p.total, 0);
  check(
    "crear un estado encola **dos** operaciones: la lista y la tarea",
    opsTotales === 2,
    `operaciones en cola: ${opsTotales} (${JSON.stringify(delNuevo.map((p) => ({ ops: p.total, items: p.items, listas: p.listas })))})`,
  );
  check(
    "y las dos salen en el MISMO push (no hay ventana sin la columna)",
    delNuevo.some((p) => p.total === 2 && p.listas === 1 && p.items === 1),
    `pushes: ${JSON.stringify(delNuevo.map((p) => p.total))}`,
  );
  const enElServidor = await leerDelServidor(session);
  const itemNuevo = enElServidor.get(`list_item:${porTitulo.get("WIP-1").id}`);
  const listaServidor = enElServidor.get(`list:${listId}`);
  const estadosServidor = listaServidor?.states ?? [];
  const idNuevo = estadosServidor.at(-1)?.id;
  check(
    "**el servidor acepto el movimiento**: la columna existe y la tarea apunta a ella",
    idNuevo != null && itemNuevo?.stateId === idNuevo,
    `la lista tiene ${estadosServidor.length} columnas, la ultima es "${estadosServidor.at(-1)?.title}" ` +
      `(${idNuevo}) y la tarea apunta a ${itemNuevo?.stateId}` +
      (itemNuevo?.stateId === idNuevo ? "" : " — **no coinciden**"),
  );

  /* --- 5. El tope de 24 estados --- */

  /**
   * El tope se comprueba **en el tablero de verdad**, no con un tablero de 24
   * estados sembrado aparte: lo que se quiere ver es el boton apagado y el motivo
   * escrito al lado, y eso solo existe en la hoja de una persona con 24 columnas.
   *
   * Se llega con la lista por API —`update` de `states`— y despues se vuelve a
   * entrar. **Se comprueba `results`, no el codigo del push**: un 200 con
   * rechazos deja el tablero como estaba y la comprobacion del boton pasa sin
   * haber nada que comprobar.
   */
  const tope = [...ESTADOS, ...Array.from({ length: 19 }, (_, i) => ({
    id: randomUUID(),
    title: `Columna ${i + 1}`,
    color: "neutral",
  }))];

  /*
    La version de la lista **se lee del servidor justo antes de escribir**, y no se
    supone. La lista de esta corrida ya ha escrito una vez —«+ Nuevo estado...», desde
    el navegador—, asi que su version ya no es la del `create`.
  */
  const antesDelTope = await leerDelServidor(session);
  const versionDeLaLista = antesDelTope.get(`list:${listId}`)?.version ?? 1;

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
          // **`baseVersion` sale del servidor y no de un 1 escrito aqui**, y la
          // razon es una que ya ha costado una corrida: «+ Nuevo estado...» acaba
          // de escribir la lista desde el navegador, asi que su version ya no es 1
          // sino 2 (o mas). Un `baseVersion` de 1 llega como **conflicto** —que es
          // un `status` mas en `results` y no un error— y el tablero se queda con
          // cinco columnas mientras el recorrido dice que el push fue bien: el
          // `http 200` con una operacion en `conflict` es la misma trampa que el
          // `rejected` en un 200, un nivel mas arriba.
          baseVersion: versionDeLaLista,
          base: { states: estadosServidor },
          clientTimestamp: new Date().toISOString(),
          payload: { states: tope },
        },
      ],
    },
  });
  const resSubida = subida.body?.data?.results ?? [];
  check(
    "el tablero llega a 24 estados por la API",
    subida.status === 200 && resSubida.every((r) => r.status === "applied" || r.status === "duplicate"),
    `http ${subida.status}, resultados: ${resSubida.map((r) => r.status + (r.error ? ` (${r.error})` : "")).join(", ")}`,
  );

  await tab.goto(`${APP}/board/${listId}`);
  const listo = Date.now() + 45000;
  while (Date.now() < listo) {
    const t = await readBoard(tab);
    if (t?.columnas?.length === 24) break;
    await sleep(600);
  }
  tablero = await readBoard(tab);
  check("el tablero se abre con 24 columnas", tablero?.columnas?.length === 24, `columnas: ${tablero?.columnas?.length}`);
  await tab.screenshot(`${SHOTS}/08-tablero-con-24.png`);

  if (tablero?.columnas?.length === 24) {
    await tapTarjeta(tab, porTitulo.get("Backlog-1").id);
    await sleep(500);
    hoja = await tab.evaluate(LEER_HOJA);
    check("la hoja se abre con 24 estados", hoja?.filas?.length === 24, `filas: ${hoja?.filas?.length}`);
    check(
      "el boton de nuevo estado sale APAGADO",
      hoja?.nuevo?.disabled === true,
      `disabled: ${hoja?.nuevo?.disabled}`,
    );
    /*
      El motivo escrito se busca **por su frase y no por un numero suelto**: un
      `/24/` a secas pasa con cualquier tablero cuyo contador llegue a 24, y aqui lo
      unico que se quiere es la frase de `board.stateLimit`. Se imprime **la linea
      entera**, que es lo que se ve en pantalla.
    */
    const lineas = (hoja?.texto ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
    const lineaDelMaximo = lineas.find((l) => /m[aá]ximo/i.test(l));
    check(
      "y hay un texto que dice POR QUE (la frase del maximo, no un 24 suelto)",
      Boolean(lineaDelMaximo) && /\b24\b/.test(lineaDelMaximo ?? ""),
      `linea: ${lineaDelMaximo ?? "(no hay ninguna que hable del maximo)"}`,
    );
    await tab.screenshot(`${SHOTS}/09-tope-de-24.png`);
  }

  /* --- 6. Cerrar y volver: el outbox --- */

  /**
   * **Esto es lo que casi nadie mira y es la mitad del encargo.** La escritura es
   * local antes que nada, asi que todo lo de arriba ya estaba "bien" en pantalla con
   * el servidor sin saber nada. Lo que demuestra esto es que la operacion salio de
   * verdad: se recargan los datos de la API y el estado de la tarea es el que se
   * eligio.
   */
  await tab.goto(`${APP}/lists`);
  await sleep(2500);
  await tab.goto(`${APP}/board/${listId}`);
  const deVuelta = Date.now() + 45000;
  while (Date.now() < deVuelta) {
    const t = await readBoard(tab);
    if (t?.columnas?.length === 24) break;
    await sleep(600);
  }

  const filas = await leerDelServidor(session);
  const item = filas.get(`list_item:${porTitulo.get("Ready-1").id}`);
  check(
    "el servidor tiene el estado que se elegio (el outbox salio)",
    item?.stateId === ESTADOS[3].id,
    `stateId en el servidor: ${item?.stateId} (elegido: ${ESTADOS[3].id})`,
  );
  const fila = filas.get(`list_item:${porTitulo.get("WIP-1").id}`);
  check(
    "y tambien el estado creado desde la hoja",
    fila?.stateId != null,
    `stateId en el servidor: ${fila?.stateId}`,
  );
  const lista = filas.get(`list:${listId}`);
  check(
    "la columna creada existe en el servidor con sus 24 columnas",
    (lista?.states?.length ?? 0) === 24,
    `states en el servidor: ${lista?.states?.length}`,
  );
  await tab.screenshot(`${SHOTS}/10-tras-reabrir.png`);

  /* --- 7. El mismo recorrido en oscuro --- */

  /*
    **La clave es la del tema y no una cualquiera.** 'orbithub:appearance' es lo que
    lee 'theme-provider.tsx' con getJson, y la app se dibuja en claro si no
    encuentra lo que espera: escribir una clave inventada deja la corrida entera en
    claro y las capturas de "oscuro" son del tema claro con otro nombre.
  */
  await PONER_TEMA("dark");
  await tab.goto(`${APP}/board/${listId}`);
  await sleep(5000);
  /*
    **Una tarjeta que existe de verdad, y no la primera que se le ocurra.**
    `Done` se quedo sin tareas en la siembra —cuatro columnas con dos tarjetas cada
    una— asi que "Done-1" no esta en ningun sitio y `porTitulo.get("Done-1")` es
    `undefined`: el fallo sale como `Cannot read properties of undefined` en la
    linea del toque, que no dice nada de la hoja ni del tema. Se toma la primera
    tarjeta **que el tablero tiene dibujada**, leida del DOM.
  */
  const enPantalla = (await readBoard(tab))
    ?.columnas?.find((c) => c.tarjetas.length > 0)?.tarjetas?.[0];
  if (!enPantalla) throw new Error("no hay ninguna tarjeta en el tablero para la pasada en oscuro");
  note(`pasada en oscuro sobre la tarjeta "${enPantalla}"`);
  const idEnOscuro = TAREAS.find((t) => t.title === enPantalla)?.id ?? enPantalla;
  await tapTarjeta(tab, idEnOscuro);
  await sleep(600);
  const oscuro = await tab.evaluate(LEER_HOJA);
  check("la hoja se abre tambien en oscuro", oscuro?.filas?.length === 24, `filas: ${oscuro?.filas?.length}`);

  /*
    **Y que de verdad esta en oscuro**, no "tambien se abre". La hoja del tema claro
    y la del oscuro se abren igual; lo que cambia son los pixeles. Se lee el fondo
    que el propio tema escribe en el documento —`theme-provider.tsx` pone
    `colorScheme` en la raiz cuando la preferencia ya se sabe— y se compara con el
    de la corrida en claro.
  */
  const esquema = await tab.evaluate(
    `document.documentElement.style.colorScheme || getComputedStyle(document.documentElement).colorScheme`,
  );
  const fondo = await tab.evaluate(
    `getComputedStyle(document.querySelector('[data-testid="sheet-panel"]')).backgroundColor`,
  );
  check("el tema oscuro esta puesto de verdad", esquema === "dark", `colorScheme: ${esquema}`);
  check(
    "y el panel se pinta con el fondo del tema, no el de claro",
    /^rgb\((\d+), (\d+), (\d+)\)$/.test(fondo ?? "") &&
      Number(fondo.match(/^rgb\((\d+)/)?.[1]) < 80,
    `fondo del panel: ${fondo}`,
  );
  note(`oscuro: ${oscuro?.filas?.slice(0, 5).map((f) => `${f.titulo} · ${f.numero}`).join(" | ")}`);

  /*
    **La marca tambien en oscuro, y no solo "la hoja se abre".** Es la misma regla
    dibujada con otros pixeles, y es donde un `backgroundColor` que se queda en el
    del tema claro pasaria desapercibido: abrir la hoja en claro y en oscuro se ve
    igual de bien, lo que cambia es si el estado actual esta distinguido.
  */
  const marcadaEnOscuro = oscuro?.filas?.find((f) => f.marcada);
  const columnaEsperada = TAREAS.find((t) => t.title === enPantalla)?.stateId ?? ESTADOS[0].id;
  check(
    "en oscuro el estado actual sale marcado tambien",
    Boolean(marcadaEnOscuro) && marcadaEnOscuro.id === columnaEsperada,
    `marcada: ${marcadaEnOscuro?.titulo ?? "ninguna"} (se esperaba ${ESTADOS.find((e) => e.id === columnaEsperada)?.title})`,
  );
  const fondoDeLaMarcada = marcadaEnOscuro
    ? oscuro.filas.find((f) => f.id === marcadaEnOscuro.id)?.fondo
    : null;
  note(`fondo de la fila marcada en oscuro: ${fondoDeLaMarcada}`);
  await tab.screenshot(`${SHOTS}/11-hoja-oscuro.png`);

  const errores = problems.filter(
    (p) => !/10\.0\.2\.2|4000|Failed to load resource/.test(p.text),
  );
  check("sin errores de consola ni promesas rotas", errores.length === 0,
    errores.slice(0, 4).map((e) => e.text.slice(0, 160)).join(" | "));
} catch (e) {
  failures += 1;
  console.log(`FALLA  la corrida entera: ${e.message}`);
  if (tab) await tab.screenshot(`${SHOTS}/99-error.png`).catch(() => {});
} finally {
  chrome.kill();
}

console.log(`\n${failures === 0 ? "TODO OK" : `${failures} FALLOS`} — capturas en ${SHOTS}`);
process.exit(failures === 0 ? 0 : 1);