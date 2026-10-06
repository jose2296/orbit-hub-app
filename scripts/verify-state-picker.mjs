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

/**
 * Los ids de las tareas, para buscar su tarjeta por `testID` y no por su texto.
 *
 * **Una de las ocho lleva icono, y es a propósito.** Las ocho sin icono —que es
 * lo que sale por defecto, porque `item-record.ts` pone `icon: null` cuando no
 * viene— no dibujan el icono pulsable de la tarjeta (`task-row.tsx`:
 * `{item.icon ? … : null}`), así que la otra ruta al panel de la tarea no existe y
 * un recorrido sembrado solo así no puede comprobar la que importa: que el panel
 * se alcanza **desde una tarjeta sin icono**. Con una tarjeta con icono, el
 * recorrido mira las dos puertas y puede decir la verdad sobre la segunda.
 */
const CON_ICONO = "Ready-2";
/**
 * Una descripcion sembrada, y en `Ready-1` a proposito.
 *
 * El spec dice que la tarjeta **no** lleva la descripcion y que "vive en la hoja de
 * edicion", asi que el unico sitio donde se la puede ver es el panel de la tarea. Con
 * el campo vacio, una comprobacion que lo encuentra prueba que hay un `textarea`;
 * con texto en el, prueba **que es la descripcion de esa tarea y no un hueco**.
 */
const CON_DESCRIPCION = "Ready-1";
const DESCRIPCION = "Traer dos bolsas";
const TAREAS = ESTADOS.slice(0, 4).flatMap((estado, indice) =>
  [0, 1].map((n) => {
    const title = `${estado.title}-${n + 1}`;
    return {
      id: randomUUID(),
      title,
      position: indice * 2 + n,
      stateId: indice === 0 ? null : estado.id,
      // `pan` esta en `ITEM_ICONS` (`packages/contracts/src/item-icons.ts`) y el
      // contrato lo acepta como `z.enum(ITEM_ICONS)`, asi que no hay que inventarse
      // un icono que el servidor vaya a rechazar.
      ...(title === CON_ICONO ? { icon: "pan" } : {}),
      ...(title === CON_DESCRIPCION ? { annotation: DESCRIPCION } : {}),
    };
  }),
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
          ...(tarea.icon ? { icon: tarea.icon } : {}),
          ...(tarea.annotation ? { annotation: tarea.annotation } : {}),
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
  // **El panel se busca por lo que tiene dentro y no por el primero del
  // documento.** \`ItemEditSheet\` usa el mismo \`Sheet\` y por tanto el mismo
  // \`sheet-panel\`, asi que con los dos montados —la hoja de estado saliendo y el
  // panel de la tarea entrando— \`querySelector\` devuelve el que se va y esta
  // funcion leeria filas de un panel que ya no esta en pantalla. Se elige el que
  // tiene una fila de estado, y \`null\` cuando no hay ninguno: que no haya filas es
  // lo que "la hoja esta cerrada" quiere decir aqui.
  const paneles = [...document.querySelectorAll('[data-testid="sheet-panel"]')];
  const panel = paneles.find((p) => p.querySelector('[data-testid^="state-picker-row-"]')) ?? null;
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

/**
 * El panel de la tarea, y **que `item-name` sea la prueba y no el titulo**.
 *
 * `item-name` es el `testID` del campo del nombre en la pagina de edicion de
 * `item-edit-sheet.tsx`, y **solo existe en esa pagina**: los iconos, las
 * etiquetas y la de marcar tienen las suyas. El titulo del panel lo pone
 * cualquiera de las paginas, asi que un `ok` sobre el titulo no distingue "ha
 * abierto el panel de la tarea" de "ha abierto el panel de otra cosa".
 *
 * La descripcion se busca como un `textarea`, y no por un `testID` suyo, porque
 * **no lo tiene**: `TextField` no lo pone y `multiline` es lo unico que la
 * distingue. En la pagina de edicion hay exactamente un `textarea` —la
 * descripcion—, y esta comprobacion cuenta eso en vez de suponerlo.
 */

/** Donde esta el centro de un elemento por su `testID`, o `null` si no esta. */
/**
 * Evaluar con reintento, porque `cdp.mjs` pierde respuestas.
 *
 * `Page.navigate` cae una de cada dos, y `Runtime.evaluate` tambien cae —rara
 * vez, pero cuando cae la corrida entera muere con "no respondio en 60000 ms"
 * en un punto que no tiene nada que ver con la app. El reintento vive aqui y no
 * en `cdp.mjs`: ese fichero lo comparten cinco guiones mas y el que navega y
 * pregunta mucho es este. Tres intentos con un segundo entre ellos; si el tercero
 * tampoco responde, el error sale tal cual y no disfrazado de fallo de la app.
 */
async function evaluar(tab, codigo, intentos = 3) {
  let ultimo = null;
  for (let i = 1; i <= intentos; i += 1) {
    try {
      return await tab.evaluate(codigo);
    } catch (e) {
      ultimo = e;
      if (i < intentos) await sleep(1000);
    }
  }
  throw ultimo;
}
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
  evaluar(tab, `(() => {
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
 * Esperar a que la hoja no este, en vez de mirarla una vez.
 *
 * **El montage la tarda, y eso no es un detalle del guion.** `Sheet` monta el panel
 * mientras `visible` es falso, se va con `SALIDA + 90` = 330 ms (`sheet.tsx`: 240 de
 * viaje y 90 de red de seguridad) y `tap` duerme 400. Preguntar al final de esos
 * 400 gana por 70 ms, y 70 ms es el margen que tiene cualquier vez que el navegador
 * va cargado —el fallo sale como "la hoja no se cierra" y no como "la maquina
 * tardo".
 *
 * Se pregunta cada 60 ms hasta un segundo, y se dice cuanto se tardo, para que un
 * "no se cierra" de verdad y un "tardo" se lean distinto en la linea del `ok`.
 *
 * **La sonda es un parametro y no `LEER_HOJA` a pelo**, porque esta misma espera
 * la usan las dos hojas del recorrido y "cerrada" significa una cosa distinta en
 * cada una: para la hoja de estado es que no queden filas suyas, y para el panel de
 * la tarea es que no quede **ningun** `sheet-panel` en el documento —la de estado ya
 * se habia ido, asi que preguntar por sus filas daria "cerrado" con el otro
 * abierto—.
 */
async function esperarPanelFuera(tab, abierto, limiteMs = 1000) {
  const esperando = Date.now();
  let sigue = true;
  while (Date.now() - esperando < limiteMs) {
    sigue = Boolean(await tab.evaluate(abierto));
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

/** La sonda de la hoja de estado: hay un `sheet-panel` con filas suyas. */
const HAY_HOJA = `!!document.querySelector('[data-testid="sheet-panel"]:has([data-testid^="state-picker-row-"])')`;
/** La sonda del panel de la tarea: hay cualquier `sheet-panel` en el documento. */
const HAY_PANEL_TASK = `!!document.querySelector('[data-testid="sheet-panel"]')`;

const esperarHojaCerrada = (tab) => esperarPanelFuera(tab, HAY_HOJA);
const esperarTareaCerrada = (tab) => esperarPanelFuera(tab, HAY_PANEL_TASK);

/**
 * **Tocar una tarjeta por su boton de titulo**, y no por el centro de la tarjeta.
 *
 * Es el unico control de la tarjeta que abre algo —desde el lote 1B, el
 * formulario de la tarea— y `task-row.tsx` lo pone como el `<button>` con
 * `aria-label` del titulo. Se busca por `button[aria-label]` **y no por la
 * clase**: una clase de react-native-web es un nombre interno que cambia entre
 * versiones —`r-cursor-1loqt21` hoy—, y un recorrido que depende de ella se
 * rompe con una actualizacion sin que cambie la app.
 *
 * El centro de la fila puede caer fuera del boton, y entonces el toque lo coge
 * el gesto de arrastrar y no se abre nada — un fallo que se lee como "la tarjeta
 * no abre" cuando lo que paso fue pulsar al lado del boton.
 */
const tapTarjeta = (tab, id) => tap(tab, `item-row-${id}`, " button[aria-label]");

/**
 * Abrir la hoja de estados sobre una tarjeta, por el camino que hay desde el
 * lote 1B: la tarjeta abre el formulario y la fila de estado del formulario
 * (`item-state-row`) abre la hoja encima.
 *
 * Dos esperas con nombre y no dos `sleep`: el formulario tarda lo que tarde en
 * montar y la hoja lo suyo, y un recorrido que supone 300 ms falla cuando el
 * navegador va cargado — que se lee como "la hoja no se abre" cuando lo que se
 * rompio fue la maquina. Cada espera dice cuanto tardo, para que un lento cante
 * antes de ser un fallo.
 */
const abrirHoja = async (tab, id) => {
  /*
    **Cerrar antes de abrir.** Cada bloque deja sus paneles como los deja —la hoja,
    el formulario, o los dos— y un toque a una tarjeta con la hoja encima no
    llega a la tarjeta: lo coge la hoja. Se cierran por la X de cada panel, que
    es el unico `button` sin `testID` que hay en ellos, de arriba abajo.
  */
  for (let i = 0; i < 3; i += 1) {
    const n = await evaluar(tab, `document.querySelectorAll('[data-testid="sheet-panel"]').length`);
    if (n === 0) break;
    const cerrada = await evaluar(tab, `(() => {
      const paneles = [...document.querySelectorAll('[data-testid="sheet-panel"]')];
      const ultimo = paneles[paneles.length - 1];
      const x = ultimo ? ultimo.querySelector('button:not([data-testid])') : null;
      if (!x) return false;
      const r = x.getBoundingClientRect();
      if (r.width === 0) return false;
      x.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      x.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      x.click();
      return true;
    })()`);
    if (!cerrada) break;
    await sleep(500);
  }
  await tapTarjeta(tab, id);
  let desde = Date.now();
  while (Date.now() - desde < 8000) {
    const form = await evaluar(tab, `!!document.querySelector('[data-testid="item-state-row"]')`);
    if (form) break;
    await sleep(250);
  }
  const form = await evaluar(tab, `!!document.querySelector('[data-testid="item-state-row"]')`);
  if (!form) throw new Error(`el formulario no se abrio sobre la tarjeta ${id}`);
  await tap(tab, "item-state-row");
  desde = Date.now();
  let hoja = null;
  while (Date.now() - desde < 8000) {
    hoja = await evaluar(tab, LEER_HOJA);
    if (hoja) break;
    await sleep(250);
  }
  if (!hoja) throw new Error(`la hoja no se abrio sobre la tarjeta ${id}`);
  return hoja;
};

/** Deja el elemento en pantalla antes de pedir su centro. */

/**
 * **La ventana del relevo, muestreada desde dentro del gesto.**
 *
 * Las dos hojas —la de estado, que se va, y la de la tarea, que llega— se montan en el
 * mismo commit, asi que hay una ventana en la que las dos estan en el documento a la
 * vez: dos `sheet-dim` y dos `sheet-panel`, que es lo que significa "dos fondos" en
 * una pantalla. Es la unica ventana de esta forma en toda la app, y **no se puede
 * mirar despues**: `Sheet` no se desmonta hasta `SALIDA + 90` = 330 ms
 * (`sheet.tsx:230`) y `tap` duerme 400 ms al final, asi que una lectura hecha cuando el
 * toque se ha terminado dice "un panel" sobre un estado que ya no existe. Ese es el
 * fallo de metodo, no de la app: una medicion tomada cuando la ventana ya se ha cerrado
 * se lee como un aprobado.
 *
 * Asi que el muestreo se instala **antes** del toque y el bucle corre **dentro de la
 * pagina**: un `requestAnimationFrame` que va dejando muestras mientras el gesto pasa, y
 * el resumen se lee despues. Es la misma leccion que el colector de
 * `Network.requestWillBeSent` mas abajo: lo que ocurre durante el gesto solo se mide
 * desde dentro del gesto.
 *
 * Lo que guarda cada fotograma, que es exactamente lo que hace falta para las tres
 * preguntas del relevo:
 *
 *  - **cuantos hay**: `dims` y `paneles`, los dos recuentos del documento entero;
 *  - **en que orden**: `quien` es la lista de paneles en orden de documento con el
 *    indice de su portal, y el portal es el `div` que react-native-web cuelga de
 *    `body` (`ModalPortal.js:18`); el ultimo del `body` se pinta encima y es el que
 *    recibe la pulsacion;
 *  - **el velo**: `velos` es una entrada por capa con su `opacidad`, su `alfa` del
 *    token y el producto —el oscurecimiento de esa capa—, y `veloTotal` es el
 *    compuesto, `1 - Π(1 - osc)`: dos velos no se suman, se multiplican;
 *  - **a quien llegaria una pulsacion**: `fondo` es el elemento de mas arriba en un
 *    punto fijo a la izquierda del panel, que en el tablero ancho es fondo, y `centro`
 *    es el de mas arriba en el centro del panel que entra.
 */


/**
 * El alfa del velo que escribe el tema, leido del propio `sheet-dim`.
 *
 * **Y si no hay velo, lo dice; no devuelve un alfa.** Sin este elemento el
 * `backgroundColor` era `""`, la expresion regular no casaba, `partes` era
 * `[""]` y el alfa salia `Number(undefined ?? 1) = 1`: el techo de las dos
 * comprobaciones de velo se iba a 1.15 y **cualquier compuesto pasaba**. Es un
 * fallo que abre en la direccion "verde" en la comprobacion que existe para
 * morder, asi que aqui se devuelve `alfa: null` y quien la usa tiene que mirarlo
 * antes de comparar. El `ok` lleva el color para que un `null` se vea sin abrir
 * el fichero.
 */

/**
 * Un relevo medido: se instala el muestreo, se toca, **se espera a que la ventana se
 * haya cerrado** y solo entonces se lee el resumen.
 *
 * La espera es lo que separa esto de una lectura a posteriori: los 400 ms del `tap` se
 * quedan cortos por 330 + lo que tarde el toque en llegar al boton, y resumir con el
 * bucle a medias es medir la ventana por la mitad sin decir que se ha medido a medias.
 */

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

  /* --- 1. La tarjeta abre el formulario, su fila abre la hoja, y el estado actual sale marcado --- */

  /*
    **Desde el lote 1B la tarjeta ya no abre la hoja**: abre el formulario de la
    tarea, y la columna se elige en su fila de estado (`item-state-row`), que
    abre esta hoja encima. Lo que este bloque comprueba de la apertura es ese
    camino en dos pasos —que el panel es el formulario y que la hoja sale de su
    fila— y todo lo demas (la marcada, los contadores, el fondo) se lee una vez
    la hoja esta abierta, como antes.
  */
  await tapTarjeta(tab, porTitulo.get("Ready-1").id);
  await sleep(500);
  const formAbierto = await tab.evaluate(`!!document.querySelector('[data-testid="item-state-row"]')`);
  check("tocar una tarjeta abre el formulario y no la hoja", formAbierto === true, formAbierto ? "fila de estado a la vista" : "sin fila de estado");
  await tap(tab, "item-state-row");
  await sleep(500);
  let hoja = await tab.evaluate(LEER_HOJA);
  check("y su fila de estado abre la hoja", hoja !== null);
  await tab.screenshot(`${SHOTS}/01-hoja-abierta-claro.png`);

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

    /*
      **El relleno de la fila marcada, comparado con el de una que no lo esta.**

      `LEER_HOJA` lee el `backgroundColor` de cada fila desde el principio del
      recorrido, y hasta ahora **nada comprobaba sobre el**: en la pasada en claro
      no se miraba y en la oscura solo se anotaba. Asi que una regresion que
      dejara la fila actual sin `surfaceMuted` —que `sheet.tsx` y
      `board-column.tsx` justifican los dos como algo de lo que la pantalla
      depende— pasaria el recorrido entero y en verde.

      La comprobacion es una **diferencia entre las dos filas y no un color
      escrito aqui**: el token lo resuelve el tema, y lo que tiene que ser cierto
      es que la marcada se distingue de la que tiene al lado. Se compara con la
      primera fila sin marcar y se imprimen los dos valores, para que un fallo diga
      que colores se dibujaron.
    */
    const sinMarcar = hoja.filas.find((f) => !f.marcada);
    check(
      "**la fila marcada sale con un fondo distinto al de las demas**",
      Boolean(marcada) && Boolean(sinMarcar) && Boolean(marcada.fondo) &&
        marcada.fondo !== sinMarcar.fondo,
      `marcada ${marcada?.titulo ?? "-"}: ${marcada?.fondo ?? "-"} | ` +
        `sin marcar ${sinMarcar?.titulo ?? "-"}: ${sinMarcar?.fondo ?? "-"}`,
    );

    check("hay enlace al editor completo", hoja.hayBotonEditar);
    /*
      **Y ya no hay vuelta al panel de la tarea, a proposito.** La hoja solo se
      abre desde dentro de ese panel desde el lote 1B, asi que una fila que lo
      abriera seria la vuelta al sitio del que se vino — un rodeo vestido de
      puerta. Se lee del documento y no del lector de arriba, que ya no trae ese
      campo: si esta comprobacion cae es que la fila volvio.
    */
    const hayVuelta = await tab.evaluate(`!!document.querySelector('[data-testid="state-picker-edit-task"]')`);
    check("y NO hay vuelta al panel de la tarea", hayVuelta === false, "sin state-picker-edit-task");
    await tab.screenshot(`${SHOTS}/02-hoja-abierta-claro.png`);
  }

  /* --- 1a. El contador de pushes: como se mide "no encola nada" --- */

  /*
    **Este bloque introduce el instrumento, no el paso 2.** El paso 2 —elegir la columna
    en la que ya esta— esta mas abajo, en su sitio, y usa lo que se declara aqui; por
    eso el marcador no lo nombra: un `--- 2. ---` sobre el colector hacia que el
    siguiente que se lea es el del paso y el paso no aparece hasta cien lineas mas
    abajo, con el contador a la vista y sin decir de donde salio.

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

  /* --- 1b. El icono sigue siendo condicional, y la tarjeta sin icono llega al panel por su propio toque --- */

  /*
    **Lo que queda del bloque que comprobo el hallazgo de la primera revision.**
    El resto —la fila `state-picker-edit-task` y el relevo a la hoja del panel—
    se fue en el lote 1B con el camino que justificaba: la tarjeta abre el panel
    directamente, asi que una tarjeta sin icono ya no necesita una segunda puerta
    en la hoja. Lo que sigue valiendo es el hecho medido que la hacia necesaria:
    la tarjeta **con** icono sembrado dibuja su icono pulsable y la **sin** icono
    no (`{item.icon ? … : null}`), y desde las dos se llega al panel con el toque.
  */
  const tarjetas = await tab.evaluate(`(() => {
    const ids = ${JSON.stringify(TAREAS.map((t) => t.id))};
    return ids.map((id) => {
      const el = document.querySelector('[data-testid=' + JSON.stringify('item-row-' + id) + ']');
      return {
        id,
        enElTablero: !!el,
        conIcono: !!el?.querySelector('[data-testid^="item-icon-"]'),
      };
    });
  })()`);
  const conIcono = tarjetas.find((t) => t.id === porTitulo.get(CON_ICONO).id);
  const sinIcono = tarjetas.find((t) => t.id === porTitulo.get(CON_DESCRIPCION).id);
  check(
    `la tarjeta de "${CON_ICONO}" (sembrada con icono) dibuja su icono pulsable`,
    Boolean(conIcono?.conIcono),
    `${CON_ICONO} en el tablero: ${conIcono?.enElTablero}, con icono: ${conIcono?.conIcono}`,
  );
  check(
    `**y la de "${CON_DESCRIPCION}", sembrada sin icono, NO dibuja ninguno** — y aun asi su toque abre el panel`,
    sinIcono?.enElTablero === true && sinIcono?.conIcono === false,
    `${CON_DESCRIPCION} en el tablero: ${sinIcono?.enElTablero}, con icono: ${sinIcono?.conIcono}`,
  );

  /* --- 1c. La ventana del relevo: eliminada en el lote 1B --- */

  /*
    **Este bloque media el relevo hoja-de-estado -> panel-de-la-tarea**: 220-241 ms
    con dos `sheet-dim` y dos `sheet-panel` en el documento, el velo compuesto y
    los fotogramas con el fondo ajeno. El flujo ya no existe —la tarjeta abre el
    panel directamente y la hoja sale de dentro de el—, asi que no hay ventana que
    medir. Se elimina en vez de saltarse: un bloque saltado es una medicion que
    parece pendiente y esta no lo esta, esta obsoleta.

    Lo que el bloque guardaba y sigue valiendo vive en `sheet.tsx` (SALIDA + 90) y
    en el lote 1B, que comprueba la apertura apilada —formulario debajo, hoja
    encima— en `.superpowers/sdd/2026-10-03-tablero-de-estados/verificar-lote-1b.mjs`.
  */
  /* --- 2. Elegir la columna en la que ya esta: no encola nada --- */

  const desde1 = Date.now();
  await abrirHoja(tab, porTitulo.get("Ready-1").id);
  await tap(tab, `state-picker-row-${ESTADOS[1].id}`);
  /*
    **Esperar a que se cierre, y no suponer que ya se ha cerrado.**

    `tap` duerme 400 ms al final y el panel se desmonta en `SALIDA + 90` = **330 ms**
    (`sheet.tsx`), asi que los 400 ms ganaban por 70: una comprobacion que funciona
    por 70 ms de margen es una comprobacion que falla cuando el navegador va
    cargado, y un recorrido que falla por eso se lee como "la hoja no se cierra"
    cuando lo que se rompio fue la maquina. Se pregunta cada 60 ms hasta un segundo
    y se dice cuanto se tardo.
  */
  const cerrada = await esperarHojaCerrada(tab);
  check("la hoja se cierra al elegir", cerrada.sigue === false, cerrada.detalle);
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
  await abrirHoja(tab, porTitulo.get("Ready-1").id);
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

  hoja = await abrirHoja(tab, porTitulo.get("WIP-1").id);
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
    hoja = await abrirHoja(tab, porTitulo.get("Backlog-1").id);
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
  const oscuro = await abrirHoja(tab, idEnOscuro);
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
  /*
    El relleno en oscuro, **comparado con el de una fila sin marcar y no anotado**.

    Antes esto era un `note`, que es lo mismo que no comprobar: el `ok` de arriba
    ("el estado actual sale marcado tambien") va del `aria-label` y pasaria igual
    con la fila sin un solo pixel de diferencia con las de al lado. Ahora es la
    misma comprobacion que la de la pasada en claro —una diferencia entre las dos
    filas, no un color escrito aqui— y en las dos pasadas.
  */
  const sinMarcarEnOscuro = oscuro?.filas?.find((f) => !f.marcada);
  check(
    "**y en oscuro la fila marcada sale con un fondo distinto al de las demas**",
    Boolean(marcadaEnOscuro) && Boolean(sinMarcarEnOscuro) &&
      Boolean(marcadaEnOscuro.fondo) && marcadaEnOscuro.fondo !== sinMarcarEnOscuro.fondo,
    `marcada ${marcadaEnOscuro?.titulo ?? "-"}: ${marcadaEnOscuro?.fondo ?? "-"} | ` +
      `sin marcar ${sinMarcarEnOscuro?.titulo ?? "-"}: ${sinMarcarEnOscuro?.fondo ?? "-"}`,
  );
  await tab.screenshot(`${SHOTS}/11-hoja-oscuro.png`);

/*
  /* --- El relevo en oscuro: eliminado con el de claro en el lote 1B --- */

  /*
    Media la ventana hoja-de-estado -> panel-de-la-tarea en oscuro, con los mismos
    topes que en claro. El flujo ya no existe y se fue con el bloque 1c.
  */
  /*
    **El filtro es estrecho a proposito, y lo que estaba ahi antes tapaba justo lo
    que este recorrido necesita.**

    Se filtraba **todo** `Failed to load resource`, y un `POST /sync/push` que
    saliera con un 4xx o un 5xx sale por la consola con ese texto —que es el mismo
    que el de un `favicon` que no existe. O sea: el endpoint del que dependen la
    mitad de las comprobaciones de este fichero podia estar fallando y el "sin
    errores de consola" salia en verde. El precedente del repo
    (`scripts/verify-social.mjs:391`) estrecha a `.*favicon`, y se sigue ahi:
    `Failed to load resource` sin el `.*favicon` **no** se filtra, porque es un
    fallo de una peticion y no el ruido de un icono que nadie pidio.

    `10.0.2.2` y `4000` siguen fuera porque son los otros dos hosts de este
    entorno —el emulador y el puerto de otro checkout— y no son de esta app.
  */
  const errores = problems.filter(
    (p) => !/10\.0\.2\.2|:4000|Failed to load resource.*favicon/i.test(p.text),
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
