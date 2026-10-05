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
    // El panel de la tarea, y es un testID aparte del de los estados porque son
    // dos editores distintos —el de la tarea y el del tablero— y porque esta es la
    // unica puerta que queda al panel cuando la tarjeta no tiene icono.
    hayBotonEditarTarea: !!panel.querySelector('[data-testid="state-picker-edit-task"]'),
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
const LEER_PANEL_TASK = `(() => {
  // **Se mira en todos los paneles y no en el primero**, y el motivo es la
  // transicion: la hoja de estado no se desmonta hasta \`SALIDA + 90\` = 330 ms
  // (\`sheet.tsx\`) y el panel de la tarea se monta en el mismo commit, asi que
  // durante la salida hay **dos** \`sheet-panel\` en el documento y
  // \`querySelector\` devuelve el que se va. El que tiene \`item-name\` es el que
  // importa, y se busca por ese.
  const paneles = [...document.querySelectorAll('[data-testid="sheet-panel"]')];
  const panel = paneles.find((p) => p.querySelector('[data-testid="item-name"]')) ?? null;
  if (!panel) return { nombre: null, descripcion: null, areas: 0, paneles: paneles.length };
  const nombre = panel.querySelector('[data-testid="item-name"]');
  const areas = [...panel.querySelectorAll('textarea')];
  return {
    nombre: nombre ? nombre.value : null,
    // El valor, y no un booleano: un \`textarea\` vacio prueba que hay un campo, y lo
    // que se quiere es que **sea el de la descripcion de esta tarea**.
    descripcion: areas.length === 1 ? areas[0].value : null,
    areas: areas.length,
    paneles: paneles.length,
  };
})()`;

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
 * Es el unico control de la tarjeta que abre la hoja de estado, y `task-row.tsx` lo
 * pone como el `<button>` con `aria-label` del titulo. Se busca por
 * `button[aria-label]` **y no por la clase**: una clase de react-native-web es un
 * nombre interno que cambia entre versiones —`r-cursor-1loqt21` hoy—, y un recorrido
 * que depende de ella se rompe con una actualizacion sin que cambie la app.
 */
const tapTarjeta = (tab, id) => tap(tab, `item-row-${id}`, " button[aria-label]");

/** Deja el elemento en pantalla antes de pedir su centro. */
const verPrimero = async (tab, testId) => {
  await tab.evaluate(`(() => {
    const el = document.querySelector('[data-testid=' + JSON.stringify(${JSON.stringify(testId)}) + ']');
    if (el && el.scrollIntoView) el.scrollIntoView({ block: "center" });
    return !!el;
  })()`);
  await sleep(120);
};

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
const INSTALAR_MUESTREO = (donde) => `(() => {
  const reg = { donde: ${JSON.stringify(donde)}, t0: performance.now(), muestras: [], vivo: true };
  window.__relevo = reg;
  const portales = () => [...document.body.children];
  const portalDe = (el) => {
    const d = el && el.closest("body > div");
    return d ? portales().indexOf(d) : -1;
  };
  const subidaDe = (el) => {
    const t = (getComputedStyle(el).transform || "").match(/,\\s*(-?[\\d.]+)\\s*\\)$/);
    return t ? Math.round(Number(t[1])) : 0;
  };
  const paso = () => {
    const dims = [...document.querySelectorAll('[data-testid="sheet-dim"]')];
    const paneles = [...document.querySelectorAll('[data-testid="sheet-panel"]')];
    const deQuien = (el) => {
      const p = portalDe(el);
      if (p < 0) return "nada";
      const mio = paneles.find((pan) => portalDe(pan) === p);
      if (!mio) return "velo#" + p;
      const quien = mio.querySelector('[data-testid^="state-picker-row-"]')
        ? "hoja"
        : mio.querySelector('[data-testid="item-name"]')
          ? "tarea"
          : "otro";
      return quien + "#" + p;
    };
    /*
      **El velo son dos numeros y no uno.** El \`backgroundColor\` lleva el alfa del
      token (\`rgba(10, 13, 26, 0.62)\` en claro, 0.76 en oscuro) y la \`opacity\` del
      elemento es la que anima \`sheet.tsx\`: el oscurecimiento de cada capa es el
      producto de los dos, y dos capas **se multiplican**, no se suman — lo que queda
      del fondo es \`Π(1 - osc)\`. Medir solo la \`opacity\` daria 1 con una sola capa y
      no distinguiria una hoja de dos, que es justo lo que hay que distinguir.
    */
    const capas = dims.map((d) => {
      const cs = getComputedStyle(d);
      const encontrado = cs.backgroundColor.match(/^rgba?\\(([^)]+)\\)$/);
      const partes = (encontrado ? encontrado[1] : "").split(",").map((x) => Number(x.trim()));
      const alfa = partes.length >= 4 && !Number.isNaN(partes[3]) ? partes[3] : null;
      const op = Number(cs.opacity);
      /*
        **Un velo cuyo color no se puede leer no es un velo de alfa 1.** Con el
        valor por defecto de antes, un \`backgroundColor\` en un formato que la
        expresion regular no reconoce contaba como opaco y el compuesto salia
        mas alto de lo que es —que es la direccion que hace caer la comprobacion,
        no la que la deja pasar—, pero de todos modos un numero inventado no
        vale. Aqui queda \`alfa: null\`, \`osc: null\` y el recuento de
        fotogramas sin alfa legible (\`sinAlfa\`), que la comprobacion del
        velo mira: si un dia el tema escribe el overlay en otro formato, esto dice
        "no lo he medido" en vez de dar un numero.
      */
      const osc = alfa === null ? null : Number((op * alfa).toFixed(3));
      return {
        op: Number(op.toFixed(2)),
        alfa,
        osc,
        color: cs.backgroundColor,
      };
    });
    if (capas.some((c) => c.alfa === null)) reg.sinAlfa = (reg.sinAlfa ?? 0) + 1;
    // Un velo sin alfa legible pesa 1 en el compuesto: se cuenta como opaco, que es
    // lo que hace que el numero no baje, y \`sinAlfa\` deja constancia de que ese
    // fotograma no es una medicion del velo sino una asuncion. La comprobacion
    // del velo no pasa mientras \`sinAlfa\` sea mayor que cero.
    const veloTotal = 1 - capas.reduce((t, c) => t * (1 - (c.osc ?? 1)), 1);
    const tarea = paneles.find((p) => p.querySelector('[data-testid="item-name"]')) ?? null;
    const hoja = paneles.find((p) => p.querySelector('[data-testid^="state-picker-row-"]')) ?? null;
    const r = tarea ? tarea.getBoundingClientRect() : null;
    const dentro = r && r.width > 0 && r.top < window.innerHeight && r.bottom > 0;
    const cx = r ? Math.round(r.left + r.width / 2) : 0;
    const cy = r ? Math.max(2, Math.min(Math.round(r.top + r.height / 2), window.innerHeight - 2)) : 0;
    reg.muestras.push({
      t: Math.round(performance.now() - reg.t0),
      dims: dims.length,
      paneles: paneles.length,
      velos: capas,
      veloTotal: Number(veloTotal.toFixed(3)),
      quien: paneles.map(deQuien).join(" + "),
      /* Los dos rectangulos, porque la pregunta de "se ve el de abajo" es de
         geometria y no de orden: con los dos paneles medidos en el mismo
         fotograma se responde si el que entra tapa al que se va o si se ven los
         dos a la vez. */
      rectHoja: hoja ? [hoja.getBoundingClientRect().top, hoja.getBoundingClientRect().bottom] : null,
      rectTarea: tarea ? [tarea.getBoundingClientRect().top, tarea.getBoundingClientRect().bottom] : null,
      veloDe: dims.map(deQuien).join(" + "),
      fondo: deQuien(document.elementFromPoint(60, 300)),
      // **La pila entera bajo el punto, en los fotogramas de la ventana.**
      // elementFromPoint devuelve el de mas arriba y elementsFromPoint devuelve
      // todos: la diferencia entre los dos es lo que separa un fondo mal
      // alcanzado de un elemento que todavia no estaba en el arbol, y es la
      // pregunta que decide si el peligro del relevo es real.
      pilaVentana:
        dims.length > 1
          ? document
              .elementsFromPoint(60, 300)
              .slice(0, 4)
              .map((e) => {
                const r = e.getBoundingClientRect();
                return (
                  (e.getAttribute("data-testid") || e.getAttribute("role") || e.tagName) +
                  " " + Math.round(r.width) + "x" + Math.round(r.height) +
                  " en " + Math.round(r.left) + "," + Math.round(r.top)
                );
              })
              .join(" > ")
          : null,
      centro: dentro ? deQuien(document.elementFromPoint(cx, cy)) : "fuera de pantalla",
      tareaEnPantalla: dentro === true,
      subidaTarea: tarea ? subidaDe(tarea) : null,
      subidaHoja: hoja ? subidaDe(hoja) : null,
    });
    if (reg.vivo && performance.now() - reg.t0 < 700) requestAnimationFrame(paso);
    else reg.vivo = false;
  };
  requestAnimationFrame(paso);
  return true;
})()`;

const LEER_MUESTREO = `(() => {
  const reg = window.__relevo;
  if (!reg) return { error: "el muestreo no estaba instalado" };
  reg.vivo = false;
  const m = reg.muestras;
  // **La ventana de dos hojas**: los fotogramas en los que el documento tiene mas de
  // un velo o mas de un panel. Es la pregunta con nombre, y su duracion en
  // milisegundos es lo que dice si el relevo es un commit o dos.
  const conDos = m.filter((x) => x.dims > 1 || x.paneles > 1);
  const llega = m.findIndex((x) => x.quien.indexOf("tarea#") >= 0);
  const despues = llega >= 0 ? m.slice(llega) : [];
  const pico = m.reduce((a, b) => (b.veloTotal > a.veloTotal ? b : a), m[0] ?? { veloTotal: 0 });
  const picoDeLaVentana = conDos.length
    ? conDos.reduce((a, b) => (b.veloTotal > a.veloTotal ? b : a))
    : null;
  const capa = (v) => "op " + v.op + " x alfa " + v.alfa + " = " + v.osc;
  return {
    donde: reg.donde,
    fotogramas: m.length,
    hasta: m.length ? m.at(-1).t : 0,
    llegada: llega >= 0 ? m[llega].t : null,
    ventana: conDos.length
      ? {
          desde: conDos[0].t,
          hasta: conDos.at(-1).t,
          ms: conDos.at(-1).t - conDos[0].t,
          fotogramas: conDos.length,
        }
      : { desde: null, hasta: null, ms: 0, fotogramas: 0 },
    quienEnLaVentana: conDos[0] ? conDos[0].quien : null,
    // Los dos rectangulos en el mismo fotograma, para poder decir si el panel que
    // entra tapa al que se va o si se ven los dos a la vez. Sin plantillas de
    // texto aqui: esto vive dentro de una plantilla del fichero y una mas
    // cerraria la de fuera.
    rectsEnLaVentana: conDos[0]
      ? "la que se va de " + Math.round(conDos[0].rectHoja?.[0] ?? 0) + " a " +
        Math.round(conDos[0].rectHoja?.[1] ?? 0) + ", y la que entra de " +
        Math.round(conDos[0].rectTarea?.[0] ?? 0) + " a " +
        Math.round(conDos[0].rectTarea?.[1] ?? 0) + " (ventana de " + window.innerHeight + " px)"
      : null,
    velosEnLaVentana: (conDos[0]?.velos ?? []).map(capa),
    picoVeloEnLaVentana: picoDeLaVentana ? picoDeLaVentana.veloTotal : null,
    velosDelPicoDeLaVentana: (picoDeLaVentana?.velos ?? []).map(capa),
    maxDims: m.reduce((a, x) => Math.max(a, x.dims), 0),
    maxPaneles: m.reduce((a, x) => Math.max(a, x.paneles), 0),
    picoVelo: pico.veloTotal ?? 0,
    velosDelPico: (pico.velos ?? []).map(capa),
    picoEn: pico.t ?? null,
    velosDistintos: [...new Set(m.flatMap((x) => x.velos.map((v) => v.osc)))].sort(
      (a, b) => a - b,
    ),
    sinVelo: m.filter((x) => x.paneles > 0 && x.dims === 0).length,
    // Los fotogramas en los que un velo traia un color cuyo alfa no se pudo leer.
    sinAlfa: reg.sinAlfa ?? 0,
    fondoTrasLaLlegada: [...new Set(despues.map((x) => x.fondo))],
    /*
      Los fotogramas en los que el fondo de mas arriba es el de la hoja que se va, con
      lo que habia en pantalla en ese momento. Sin esto un FALLA solo dice que la
      comprobacion fallo; esto dice en que fotograma y con que numeros, que es la
      diferencia entre un fallo que se entiende y uno que se busca.
    */
    fondoMalo: despues
      .filter((x) => x.fondo.startsWith(String.fromCharCode(104) + "oja#"))
      .map(
        (x) =>
          "t=" + x.t + " ms, dims=" + x.dims + ", paneles=" + x.paneles +
          ", fondo=" + x.fondo + ", quien=" + x.quien +
          ", velos=" + x.velos.map((v) => v.osc) +
          ", subida del que entra=" + x.subidaTarea +
          ", rect del que entra=" + JSON.stringify(x.rectTarea) +
          ", rect del que se va=" + JSON.stringify(x.rectHoja) + ", pila=" + x.pilaVentana,
      ),
    // Los instantes de los fotogramas en los que el fondo de mas arriba NO es el de
    // la hoja que entra: uno solo es lo medido, y es el primero de la ventana.
    fondoMaloT: despues
      .filter((x) => x.fondo.startsWith(String.fromCharCode(104) + "oja#"))
      .map((x) => x.t),
    // **Los mismos fotogramas, pero por posicion dentro de la ventana y no por
    // cuenta.** Un tope de "dos fotogramas" depende de cada cuanto el navegador
    // pinto: con la maquina cargada un fotograma puede tardar 140 ms, y el mismo
    // useEffect de ModalAnimation que dura un frame en una maquina
    // descargada cabe en dos en una cargada. La posicion no depende de eso: lo
    // que se vigila es que el orden invertido este **al principio de la ventana**
    // y no repartido, que es lo que distingue una carrera de una capa mal puesta.
    fondoMaloPos: conDos
      .map((x, i) => (x.fondo.startsWith(String.fromCharCode(104) + "oja#") ? i : -1))
      .filter((i) => i >= 0),
    centroMaloPos: conDos
      .map((x, i) =>
        x.tareaEnPantalla && !x.centro.startsWith("tarea#") ? i : -1,
      )
      .filter((i) => i >= 0),
    centroMalo: despues.filter((x) => x.tareaEnPantalla && !x.centro.startsWith("tarea#")).length,
    /*
      **La subida del panel que entra, en pixeles y fotograma a fotograma de la
      ventana.** Esta existia en el resumen desde la ronda 2 y **ninguna
      comprobacion la imprimia**: era el numero que el comentario de mas abajo
      daba por bueno ("91% de su altura") sin que nada lo dijera. Se imprime
      entero, porque su valor no es el que el comentario suponia.
    */
    subidasEnLaVentana: conDos.map(
      (x) => x.t + " ms: " + (x.subidaTarea === null ? "sin panel" : x.subidaTarea + " px"),
    ),
    // El alto del panel que entra en el primer fotograma de la ventana, para poder
    // contrastar la subida contra el alto: sheet.tsx:290 dice que la subida es
    // "(1 - entrada) * altoPanel", y los dos factores estan en [0, 1], asi que la
    // subida no puede pasar del alto. Un tope que sale del codigo, no del ojo.
    // **Sin ventana esto sale null**, y la comprobacion de la subida cae: una
    // medida sin marco no es una medida.
    altoTareaEnLaVentana: conDos[0]?.rectTarea
      ? Math.round(conDos[0].rectTarea[1] - conDos[0].rectTarea[0])
      : null,
    subidaTareaMax: despues.reduce((a, x) => Math.max(a, x.subidaTarea ?? 0), 0),
    subidaTareaFin: despues.length ? despues.at(-1).subidaTarea : null,
    subidaHojaMax: m.reduce((a, x) => Math.max(a, x.subidaHoja ?? 0), 0),
    ordenFinal: m.length ? m.at(-1).quien : null,
    velosFinales: (m.at(-1)?.velos ?? []).map(capa),
  };
})()`;

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
const LEER_VELO = `(() => {
  const el = document.querySelector('[data-testid="sheet-dim"]');
  if (!el) return { color: "(no hay sheet-dim en el documento)", alfa: null };
  const color = getComputedStyle(el).backgroundColor;
  const partes = (color.match(/^rgba?\\(([^)]+)\\)$/) || [, ""])[1].split(",").map((p) => p.trim());
  if (partes.length < 4) return { color, alfa: null };
  return { color, alfa: Number(partes[3]) };
})()`;

/**
 * Un relevo medido: se instala el muestreo, se toca, **se espera a que la ventana se
 * haya cerrado** y solo entonces se lee el resumen.
 *
 * La espera es lo que separa esto de una lectura a posteriori: los 400 ms del `tap` se
 * quedan cortos por 330 + lo que tarde el toque en llegar al boton, y resumir con el
 * bucle a medias es medir la ventana por la mitad sin decir que se ha medido a medias.
 */
async function medirReleve(tab, testId, donde) {
  await tab.evaluate(INSTALAR_MUESTREO(donde));
  await tap(tab, testId);
  await sleep(300);
  const resumen = await tab.evaluate(LEER_MUESTREO);
  if (resumen?.error) throw new Error(`${donde}: ${resumen.error}`);
  return resumen;
}

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
    check("y hay un enlace al panel de la tarea", hoja.hayBotonEditarTarea);
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

  /* --- 1b. Las dos puertas al panel de la tarea --- */

  /*
    **Este bloque es el que comprueba el hallazgo de la primera revision: sin el,
    el recorrido entero pasa en verde con la descripcion sin camino a ninguna parte.**

    La hoja sigue abierta sobre `Ready-1`, que **no tiene icono** —la siembra lo
    pone solo en `CON_ICONO`—, y por lo tanto su tarjeta no dibuja el icono
    pulsable de `TaskRow` (`{item.icon ? … : null}`). Lo que se comprueba aqui es:

    1. que la tarjeta **con** icono sembrado si lo dibuja, y que la **sin** icono no
       —el hecho que hace necesaria la segunda puerta, medido y no supuesto;
    2. que la hoja tiene la fila `state-picker-edit-task`;
    3. que esa fila abre **el panel de la tarea** con el nombre y **la descripcion
       que se sembraron**, que es donde el spec dice que vive.

    Se mira `item-name` y no el titulo del panel porque `item-name` es un
    `testID` que **solo existe en la pagina de edicion** de `item-edit-sheet.tsx`:
    el titulo lo pone cualquiera de las paginas, el campo del nombre no.
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
    `**y la de "${CON_DESCRIPCION}", sembrada sin icono, NO dibuja ninguno** — por eso hace falta la fila del panel`,
    sinIcono?.enElTablero === true && sinIcono?.conIcono === false,
    `${CON_DESCRIPCION} en el tablero: ${sinIcono?.enElTablero}, con icono: ${sinIcono?.conIcono}`,
  );

  /*
    **El muestreo se instala antes del toque, no despues.** Es la parte de este bloque
    que no se puede hacer de otra manera: el relevo abre y cierra una ventana de unos
    330 ms en medio de un gesto, y `tap` duerme 400 ms al final, asi que cualquier
    lectura posterior describe un estado que ya no existia. `medirReleve` hace las tres
    cosas en su orden —instalar, tocar, esperar a que la ventana se cierre y solo
    entonces resumir— y el resumen sale con los numeros de todos los fotogramas.
  */
  const relevo = await medirReleve(tab, "state-picker-edit-task", "relevo-claro");
  const panelDeLaTarea = await tab.evaluate(LEER_PANEL_TASK);
  check(
    "**desde una tarjeta SIN icono se llega al panel de la tarea, con su nombre y su descripcion**",
    panelDeLaTarea?.nombre === "Ready-1" && panelDeLaTarea?.descripcion === DESCRIPCION,
    `nombre: ${panelDeLaTarea?.nombre ?? "(no hay panel con item-name)"} | ` +
      `descripcion: ${panelDeLaTarea?.descripcion ?? "-"} (sembrada: "${DESCRIPCION}") | ` +
      `textareas: ${panelDeLaTarea?.areas ?? "-"} | paneles a la vez: ${panelDeLaTarea?.paneles ?? "-"}`,
  );
  await tab.screenshot(`${SHOTS}/12-panel-desde-una-tarjeta-sin-icono.png`);

/* --- 1c. La ventana del relevo: dos hojas, medidas --- */

  /*
    **La ventana del relevo, y por que esta a parte.**

    La fila `state-picker-edit-task` llama a `onEditTask()` y a `onClose()` en el mismo
    manejador, o sea en el mismo commit: el panel de la tarea se monta y la hoja de
    estado recibe `visible: false` a la vez. **El commit es uno y el documento no lo es
    durante la salida de la hoja que se va** —`Sheet` no se desmonta hasta
    `SALIDA + 90` = 330 ms (`sheet.tsx:230`)—, asi que hay una ventana en la que estan
    las dos: dos `sheet-dim` y dos `sheet-panel`.

    Y no se puede responder leyendo el DOM despues, que es lo que hacia la primera
    version de este bloque: `LEER_PANEL_TASK` de arriba dice `paneles a la vez: 1` y ese
    1 se leia **400 ms despues del toque**, con la hoja que se va ya desmontada. Un
    numero asi no dice nada de la ventana: es una foto de despues con la etiqueta de
    durante. Los numeros de aqui salen de `relevo`, que se leyo mientras la ventana
    estaba abierta.

    **Lo medido decide lo que se hace, y lo medido dice que no hay que hacer nada.**
    Con el codigo de este checkout, a 1440 x 900, la ventana dura **entre 220 y 241 ms en 15 o
    16 fotogramas** —tres corridas con la maquina cargada la cerraron en 8—; el rango es de
    las diecinueve corridas completas de la ronda 3. El numero fluctua porque depende de donde
    caiga cada fotograma dentro de la salida, y por eso lo que se comprueba es la forma y no
    el milisegundo. En esos fotogramas:

    - la hoja que entra esta en el portal **#6** y la que se va en el **#5**: es la
      ultima del `body`, y por lo tanto la que se pinta encima y la que recibe las
      pulsaciones;
    - **el punto de fondo no siempre devuelve la entrante.** En diecinueve corridas completas
      de esta ronda (38 mediciones, una por pasada) el punto de fondo dio `["tarea#6"]` —cero
      fotogramas con el fondo de la hoja que se va— **12 veces**, y uno o dos fotogramas malos
      las otras 26, **siempre en las posiciones 0 y 1 de la ventana**. La version anterior de este
      comentario afirmaba lo contrario —"siempre `tarea#6`, ninguna pulsacion alcanza a la
      hoja que se va"— y se contradecia mas abajo, en el comentario del quinto `check`, que
      si describe el fotograma. Lo que queda es lo que las corridas enseñan: **el orden
      invertido existe, dura de uno a dos fotogramas y siempre esta al principio de la
      ventana**. El mecanismo esta en `ModalAnimation.js:67` y esta en el comentario del
      quinto `check`, que es donde vive;
    - el panel que entra esta **encima del velo que se va** —portal 6 sobre portal 5—,
      asi que **no lo oscurece**: se puede leer con los dos arriba;
    - el unico numero que se mueve es el fondo de la pantalla: de **0.62 a 0.629-0.705** en
      claro —un 1% a un 14% relativo— y de **0.76 a 0.765-0.886** en oscuro, un 1% a un 17%.
      El pico se mueve con el fotograma porque depende de donde caiga dentro de los dos
      desvanecidos, y con el ancho del pico —la ventana empieza antes de que el velo
      entrante haya subido y termina cuando el saliente ya ha bajado del todo—.

    Un pico de 1-17% en el fondo durante unos 100 ms esta por debajo del umbral, y las formas
    de quitarlo cambian ese pico por un hueco **mas claro**, que se ve mas. **Ese argumento
    no trae una tabla de numeros medidos y no puede traerla**: en la ronda 2 se publico una
    con tres filas de cifras que no habian salido de ninguna corrida, y la tercera ni
    siquiera era derivable de su propio mecanismo. Lo que sostiene la decision es lo que
    sale del codigo: `fondo` arranca en 0 (`sheet.tsx:105`) y tarda 150 ms en llegar a 1
    (`sheet.tsx:130`), asi que **en el instante del relevo el velo entrante vale 0** y
    cualquier arreglo que quite un velo deja el compuesto en el valor del otro —0 en ese
    instante—, que es un hueco sin oscurecer mas largo que el 1-17% que evita. La tabla y
    el porque de borrarla estan en el informe de la ronda 3.

    Asi que aqui no hay nada que arreglar: **lo que hay es una forma de que esto cambie
    sin que nadie se entere**, y son las seis comprobaciones siguientes. No son "todo
    bien": son las seis cosas que tienen que seguir siendo verdad.
  */
  const veloDeLaTanda = await tab.evaluate(LEER_VELO);
  if (veloDeLaTanda.alfa == null) {
    note(
      `el velo del tema no se ha podido leer (${veloDeLaTanda.color}): las dos ` +
        "comprobaciones de velo de este bloque van a fallar por falta de techo, no por",
    );
  }

  /*
    **La primera comprobacion es sobre el instrumento, y es la que impide que las otras
    cuatro sean un numero sin ningun gesto detras.**

    Si el muestreo no llega a ver el relevo —porque el bucle se para antes, porque la
    pulsacion no ocurrio, porque la ventana fue tan corta que no hubo ni un
    fotograma— `relevo.llegada` sale `null` y las demas sumarian comparaciones sobre
    una lista vacia, que es lo unico que sale bien de un instrumento que no midio nada.
    Un recorrido que solo mira el final del gesto no puede distinguir "no ha pasado
    nada" de "no lo he mirado", que es exactamente el fallo que la primera version de
    este bloque tenia.
  */
  check(
    "**el relevo se ha medido mientras estaba abierto, no despues**",
    (relevo.fotogramas ?? 0) >= 10 && relevo.llegada != null && (relevo.hasta ?? 0) >= 400,
    `${relevo.fotogramas} fotogramas en ${relevo.hasta} ms | el panel de la tarea aparece en el ` +
      `fotograma de ${relevo.llegada} ms | ventana de dos hojas: ${relevo.ventana.ms} ms ` +
      `(${relevo.ventana.fotogramas} fotogramas)`,
  );

  /*
    **Cuantas hojas hay a la vez: exactamente dos, y la ventana no crece.**

    El maximo de los dos recuentos en todos los fotogramas es la respuesta cruda, y son
    **dos y no tres**: una tercera hoja en el relevo seria otro `Modal` en el `body` y el
    numero lo diria. Y la duracion lleva un techo de 400 ms porque la ventana no es una
    constante del codigo —es la salida de `Sheet`—: si `SALIDA` subiera, o si
    `onEditTask` se llamara antes de tiempo, esta comprobacion caeria en vez de dejar que
    el comentario del componente se quedara diciendo una verdad que ya no es.
  */
  check(
    "**la ventana son dos hojas y no mas, y no dura mas de lo que dura una salida**",
    (relevo.maxDims ?? 9) === 2 && (relevo.maxPaneles ?? 9) === 2 &&
      (relevo.ventana.ms ?? 0) > 0 && (relevo.ventana.ms ?? 0) <= 400,
    `maximo de sheet-dim: ${relevo.maxDims}, de sheet-panel: ${relevo.maxPaneles} | ` +
      `con dos a la vez: ${relevo.ventana.ms} ms de los ${relevo.hasta} medidos ` +
      `(${relevo.ventana.fotogramas} fotogramas) | en la ventana: ${relevo.quienEnLaVentana} | ` +
      `${relevo.rectsEnLaVentana ?? ""}`,
  );

  /*
    **El velo, comparado con el velo del tema.**

    Dos velos no se suman: se multiplican, asi que el compuesto es `1 - Π(1 - a)` con
    `a = opacidad x alfa del token`, y los dos numeros se leen del elemento. El techo es
    **un 20% por encima del velo que el tema escribe** —`techoVelo`, mas abajo, que las dos
    comprobaciones comparten— y no un numero absoluto, para que la comprobacion sea la misma
    en las dos pasadas: leidos del elemento, en claro son 0.62 y en oscuro 0.76.

    Ese 20% no es un margen puesto a ojo: es el maximo medido redondeado hacia arriba, y el
    maximo esta mas abajo con su cuenta. Y el margen tiene que existir porque los dos
    desvanizados no coinciden: el velo que entra dura 150 ms y el que sale 180
    (`sheet.tsx:130` y `sheet.tsx:214`), asi que mientras los dos coexisten el que entra
    todavia va por su cuenta y el compuesto **no puede** llegar a dos velos completos, que
    es `1 - (1 - 0.62)²` = 0.856 en claro y 0.942 en oscuro.
    **Ese techo esta medido**, con la mutacion que quita el desvanecido del velo saliente
    (`sheet.tsx:214`) y deja las dos capas en opacidad 1: la corrida dio 0.856 en claro y
    0.942 en oscuro, los dos por encima de sus techos, y las dos comprobaciones cayeron. Sin
    esa mutacion el pico real anda en 0.629-0.705 en claro y 0.765-0.886 en oscuro. Ese es
    el fallo que muerde, y muerde en las dos pasadas.

    **El techo tiene que existir para que la comprobacion pueda fallar, asi que su
    ausencia la hace caer.** Sin `sheet-dim` el alfa se leeria `1` (ver `LEER_VELO`) y el
    techo se iria al maximo, con lo que **cualquier** compuesto pasaria; con el velo
    presente pero de un color sin alfa legible, `sinAlfa` cuenta los fotogramas y el mismo.
    Las dos cosas salen en la linea del `ok`.

    **El 15% de la ronda 2 era una cifra puesta a ojo, y medirla la ha desmentido.** Era el
    techo que decia "lo que permite el desvanecido", y en las diecinueve corridas completas
    de la ronda 3 el pico real subio a **0.705 en claro** —0.62 x 1.15 = 0.713, al limite— y
    a **0.886 en oscuro**, que es un **16.6%** sobre el token y **se paso del techo de
    0.874**: una corrida en `FALLA` y las demas en verde. El techo aqui es **1.20**, derivado
    del maximo medido y no de una idea de cuanto "deberia" subir. Sigue muerdiendo: la
    mutacion del desvanecido da 0.856 en claro —sobre un techo de 0.744— y 0.942 en oscuro
    —sobre 0.912—, asi que las dos comprobaciones caen igual. Lo que **no** se puede decir es
    que el pico real se quede en un 15%: se queda en un 1%-17%, y depende de donde caiga el
    fotograma dentro de los dos desvanizados.
  */
  const techoVelo = (alfa) =>
    alfa == null ? null : Math.round(alfa * 1.2 * 1000) / 1000;
  check(
    "**el velo de la pantalla no se pasa de un 20% por encima del velo del tema**",
    (relevo.picoVelo ?? 1) <= techoVelo(veloDeLaTanda?.alfa) &&
      veloDeLaTanda?.alfa != null &&
      (relevo.sinAlfa ?? 0) === 0,
    `pico del velo compuesto: ${relevo.picoVelo} en el fotograma de ${relevo.picoEn} ms ` +
      `(capas: ${relevo.velosDelPico}) | el tema escribe ${veloDeLaTanda?.color} y el techo ` +
      `es ${techoVelo(veloDeLaTanda?.alfa) ?? "n/d (sin alfa legible: la comprobacion no puede pasar)"} | ` +
      `fotogramas con un velo sin alfa legible: ${relevo.sinAlfa} | el pico dentro de la ventana de dos hojas: ` +
      `${relevo.picoVeloEnLaVentana} (${relevo.velosDelPicoDeLaVentana})`,
  );

  /*
    **Y que la ventana no se paga con un fondo sin velar.**

    Un recorte de la ventana se puede pagar de otra manera: que la hoja que se va se vaya
    y el panel que entra aun no haya puesto su velo. Eso es un tablero sin oscurecer
    durante un fotograma o dos, y aqui no se nota; con una maquina cargada se nota. Se
    cuenta, y el numero sale en la linea del `ok` para que un fallo diga cuantos
    fotogramas fueron.
  */
  check(
    "**y ningun fotograma del relevo tiene un panel sin velo delante**",
    (relevo.sinVelo ?? 9) === 0,
    `fotogramas con panel y sin velo: ${relevo.sinVelo} de ${relevo.fotogramas}` +
      ` | velos al final: ${relevo.velosFinales}`,
  );

/*
    **A donde llega una pulsacion, que es el peligro de dos fondos — y aqui hay UN
    fotograma, o dos, que no son los que uno quiere.**

    `fondo` es el elemento de mas arriba en un punto a la izquierda del panel, o sea uno
    de los dos fondos. Lo que no puede pasar es que ese fondo sea **el de la hoja que se
    va** y se quede si: una pulsacion ahi cerraria la hoja de estado —que se esta yendo
    sola— mientras el panel de la tarea se queda abierto encima, y una pulsacion sobre una
    fila suya moveria la tarea.

    **Medido: en uno o dos fotogramas de cada relevo, el de mas arriba es el de la que se
    va.** No sale en todas las corridas: en las 38 mediciones de la ronda 3 (diecinueve corridas
    completas, una por pasada) salio **12 veces con 0 fotogramas, 23 con 1 y 3 con 2**, pero
    cuando sale **siempre esta en las posiciones 0 y 1 de la ventana**. El mecanismo esta
    en react-native-web y no en esta app:

    - `ModalAnimation` (RNW 0.21.2, `ModalAnimation.js:67`) pinta su envoltorio con
      `isRendering ? getAnimationStyle(...) : styles.hidden`, y **`isRendering` lo pone un
      `useEffect`**. En el primer fotograma de una hoja recien montada el envoltorio es
      `styles.hidden` = `{ opacity: 0 }`: sin `position` y sin `z-index`.
    - La hoja que se va, en cambio, sigue con `visible={montada}` en su `Modal` —de eso
      sirve `montada`— y su envoltorio va con `styles.container` = `z-index: 9999`.
    - Con una en la capa de `z-index: 9999` y la otra en la de `auto`, **gana la que se
      va**, hasta que el `useEffect` de la entrante la mete en su capa. Uno o dos
      fotogramas.

    **Lo que cuesta, y que parte de eso se puede decir.** La hoja que se va en ese fotograma
    ya esta cerrando —su `onClose` se llamo en el mismo commit, y volver a llamarlo no
    cambia nada—, y eso es lo que sostiene el "el coste es nada". Lo que **no** se puede
    decir es que el panel que entre este lejos de su sitio: eso se afirmaba con un 91% que
    salia de `entrada = 0.09` a los 16 ms, un numero que no esta en ninguna parte —la
    cuenta del `Easing.out(cubic)` da 0.244 a los 16 ms, y `sheet.tsx:290` multiplica por
    `altoPanel`, que es 0 hasta el primer `onLayout` (`sheet.tsx:399`)—. La sexta
    comprobacion imprime la subida real, en pixeles y fotograma a fotograma, y es la que
    manda.

    Por eso la comprobacion no dice "nunca" sino **"solo al principio de la ventana"**: si el
    orden de pintado se invirtiese entero —es decir, si la que se va quedara encima durante
    toda su salida— las posiciones serian todas y esto caeria. Y el tope se cuenta **por
    posicion dentro de la ventana, no por numero de fotogramas**: en una maquina descargada
    la carrera dura un fotograma, pero con la maquina cargada un fotograma puede tardar mas
    de 100 ms y la misma carrera ocupa dos capturas. Medido: 0, 1 y 2 fotogramas, **siempre
    en las posiciones 0 y 1**. Es un tope medido sobre lo que se ha visto, no una figura de
    rock: lo que no se permite es que llegue a la posicion 3.

    Y `centro` es la otra mitad: el panel que entra tiene que **poder pulsarse** en el
    resto de la ventana, y lo tiene —el centro del panel que entra devuelve suyo en todos
    los fotogramas salvo los mismos del principio, por el mismo `z-index` de arriba.
  */
  check(
    "**una pulsacion en el fondo llega a la hoja que entra, y su panel se puede pulsar**",
    (relevo.fondoTrasLaLlegada ?? []).length <= 2 &&
      (relevo.fondoMaloPos ?? []).every((i) => i < 3) &&
      (relevo.centroMaloPos ?? []).every((i) => i < 3),
    `fondo de mas arriba tras la llegada: ${JSON.stringify(relevo.fondoTrasLaLlegada)} | ` +
      `fotogramas con el fondo de la hoja que se va: ${(relevo.fondoMaloT ?? []).length}` +
      `${(relevo.fondoMaloT ?? []).length ? ` (en el ${(relevo.fondoMaloT ?? []).join(", ")} ms, y la ventana empieza en el ${relevo.ventana.desde} ms; posiciones ${JSON.stringify(relevo.fondoMaloPos)} de ${relevo.ventana.fotogramas})` : ""} | ` +
      `fotogramas con el centro del panel que entra debajo de otro: ${relevo.centroMalo}` +
      `${relevo.centroMalo ? ` (posiciones ${JSON.stringify(relevo.centroMaloPos)} de ${relevo.ventana.fotogramas})` : ""} | ` +
      `orden al final: ${relevo.ordenFinal}`,
  );

  /*
    **La subida del panel que entra, en pixeles y en los quince fotogramas de la
    ventana. Esta comprobacion existe porque el numero se afirmaba y no se
    imprimia.**

    Dos rondas el comentario de este bloque y el de `onEditTask` de
    `state-picker-sheet.tsx` dijeron que "el panel que entra todavia esta al 91% de
    su altura hacia abajo", y ese 91% **no salia de ninguna comprobacion**: el
    muestreo guardaba `subidaTarea` (`INSTALAR_MUESTREO`), el resumen lo llevaba a
    `subidaTareaMax` y `subidaTareaFin`, y ningun `check()` lo imprimia. Un numero
    que solo existe en el resumen es un numero que nadie mira.

    **Y el 91% tampoco sale del codigo.** `sheet.tsx:126` anima `entrada` a 1 en
    `DURACION` = 180 ms con `Easing.out(Easing.cubic)`, asi que a los 16 ms vale
    `1 - (1 - 16/180)³` = 0.244 y no 0.09 — el 0.09 corresponde a unos 5.5 ms. Y
    `sheet.tsx:290` multiplica por `altoPanel.value`, que **es 0 hasta el primer
    `onLayout`** (lo dice el comentario de `sheet.tsx:287-288`), de modo que en el
    fotograma de llegada la subida puede ser exactamente 0: el panel en su sitio,
    al reves de "91% por debajo".

    Lo que se comprueba no es la forma de la subida —esa la cuenta del `Easing`, y
    no vale como medida— sino dos cosas que si valen: que **todos** los fotogramas
    de la ventana traigan un numero (si alguno saliera `sin panel`, el resumen
    estaria describiendo un panel que no estaba) y que la subida **no pase del alto
    del panel**, que es lo que sale de `sheet.tsx:290` con los dos factores en
    [0, 1]. Los numeros enteros van en la linea del `ok`.
  */
  const subidas = relevo.subidasEnLaVentana ?? [];
  const conNumero = subidas.filter((s) => !s.includes("sin panel"));
  check(
    "**la subida del panel que entra sale medida en cada fotograma de la ventana**",
    subidas.length === (relevo.ventana.fotogramas ?? -1) &&
      conNumero.length === subidas.length &&
      relevo.altoTareaEnLaVentana != null &&
      (relevo.subidaTareaMax ?? Infinity) <= relevo.altoTareaEnLaVentana,
    `subida, fotograma a fotograma: ${subidas.join(", ")} | alta del panel que entra: ` +
      `${relevo.altoTareaEnLaVentana} px | subida maxima: ${relevo.subidaTareaMax} px | ` +
      `subida al final: ${relevo.subidaTareaFin} px`,
  );
  /*
    **El panel se cierra por el boton de la `X`, con el mismo toque que el resto del
    recorrido** y no con un `click` sintetico. `sheet.tsx` pone ese boton como un
    `Pressable` con `accessibilityRole="button"`, y react-native-web lo pinta como
    un `<div role="button">` con manejadores de puntero: un `MouseEvent('click')`
    a pelo depende de que el navegador sintetice los de compatibilidad y es
    exactamente el atajo que el comentario de `tap` dice que no funciona. Se toca
    por coordenadas con `Input.dispatchTouchEvent`.

    **Se busca por su etiqueta y no por "el primer boton del panel".** La `X` de
    `sheet.tsx` es un `Pressable` con `accessibilityLabel={t("common.close")}`, y esa
    etiqueta es lo unico que la distingue: la pagina de edicion tiene cuatro
    prioridades pulsables y un boton por etiqueta, todos con `role="button"`, asi que
    "el primero" seria el que saliera por orden del DOM.

    **La frase se lee del pulsable de fuera y no esta escrita aqui.** Ese pulsable y el
    boton de la `X` llevan la misma etiqueta, y el pulsable esta **fuera** del panel
    —es su hermano en el `root` de `Sheet`—, asi que tomarla de ahi la deja en el
    idioma que tenga la sesion y no en el que el fichero asumia. Es el hermano
    **siguiente** al `sheet-dim` porque ese es el orden del fuente; un "primer
    `aria-label` que diga cerrar" en la pagina es "Cerrar el menú" de la cabecera, y
    eso es exactamente lo que fallo en la primera corrida.
  */
  const botonDeCerrar = await tab.evaluate(`(() => {
    const panel = [...document.querySelectorAll('[data-testid="sheet-panel"]')]
      .find((p) => p.querySelector('[data-testid="item-name"]'));
    if (!panel) return { error: 'no hay panel con item-name' };
    // **La frase se lee del fondo pulsable, que es el hermano siguiente al
    // \`sheet-dim\`**, y no de cualquier \`aria-label\` que diga "cerrar": en una
    // pantalla de listas hay media docena ("Cerrar el menú" entre ellas) y el
    // primero que aparece no es el de la hoja. La posicion es la de \`sheet.tsx\`:
    // dim, pulsable de fuera, panel.
    const dim = document.querySelector('[data-testid="sheet-dim"]');
    const frase = dim?.nextElementSibling?.getAttribute('aria-label');
    if (!frase) return { error: 'el pulsable de fuera no tiene aria-label' };
    const botones = [...panel.querySelectorAll('[aria-label="' + frase + '"]')];
    if (botones.length !== 1) return { error: 'botones con "' + frase + '" dentro del panel: ' + botones.length };
    const r = botones[0].getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  if (botonDeCerrar.error) {
    check("el panel de la tarea se cierra con su boton", false, botonDeCerrar.error);
  } else {
    await tab.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: botonDeCerrar.x, y: botonDeCerrar.y, radiusX: 8, radiusY: 8, force: 1 }],
    });
    await sleep(80);
    await tab.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }
  const panelFuera = await esperarTareaCerrada(tab);
  check(
    "**y el panel de la tarea se cierra con su boton, y la hoja de estado se fue con el**",
    panelFuera.sigue === false && (await tab.evaluate(LEER_HOJA)) === null,
    `${panelFuera.detalle} — hoja de estado: ${
      (await tab.evaluate(LEER_HOJA)) === null ? "cerrada tambien" : "SIGUE ABIERTA"
    }`,
  );

  /* --- 2. Elegir la columna en la que ya esta: no encola nada --- */

  const desde1 = Date.now();
  await tapTarjeta(tab, porTitulo.get("Ready-1").id);
  await sleep(300);
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
    **El relevo tambien en oscuro, y aqui el velo es el que mas se mueve.**

    El velo del tema oscuro es `rgba(2, 4, 10, 0.76)` (`tokens.ts`), y dos velos de 0.76
    llegaron a valer **0.942** en la mutacion que quita el desvanecido del saliente —esa
    cifra esta medida, en esa mutacion—. Sin ella el compuesto sale **entre 0.765 y 0.886**
    en las diecinueve corridas completas de la ronda 3, porque el velo que entra dura 150 ms y cuando el
    compuesto llega a su maximo el de la hoja que se va ya va por debajo: de un 1% a un
    17% por encima del token. **El techo de la comprobacion es 1.20 y no el 1.15 de la ronda
    2**, porque el pico de 0.886 —un 16.6%— se paso de 0.874 y hizo caer la comprobacion en
    una corrida; el detalle esta en el comentario de la comprobacion del velo en claro, que
    es donde vive `techoVelo`. Que el techo sea **relativo al token** y no absoluto es justo
    por el maximo que se acaba de medir: la misma regla sirve para las dos pasadas y compara
    cada una con su propio tema.

    **La fila hay que verla antes de tocarla, y no es un detalle del guion**: con 24
    columnas las dos puertas quedan bajo el pliegue del panel —`maxHeightRatio` es 0.85
    y el cuerpo es un `ScrollView`—, asi que el centro de la fila cae fuera de la
    pantalla y el toque no llega a nada. `verPrimero` la deja en pantalla con
    `scrollIntoView`, que en react-native-web es un desplazamiento de verdad porque el
    `ScrollView` es un `div` con `overflow`.

    Las dos comprobaciones son las de la pasada en clara con los mismos topes: dos hojas y
    no mas, ventana corta, y **el fondo ajeno solo al principio de la ventana** —los del
    primer `useEffect` de `ModalAnimation`, que esta explicado alli y no se repite—. Ese
    tope cambio de forma en la ronda 3: era "un fotograma malo" y hay corridas en las que
    salen dos, asi que ahora se cuenta **por posicion dentro de la ventana** y se pide que
    no llegue a la tercera.
  */
  const veloEnOscuro = await tab.evaluate(LEER_VELO);
  if (veloEnOscuro.alfa == null) {
    note(
      `en oscuro el velo del tema tampoco se ha podido leer (${veloEnOscuro.color}): la ` +
        "comprobacion de velo de abajo va a fallar por falta de techo, no por el velo.",
    );
  }
  await verPrimero(tab, "state-picker-edit-task");
  const relevoOscuro = await medirReleve(tab, "state-picker-edit-task", "relevo-oscuro");
  check(
    "**y en oscuro la ventana del relevo son dos hojas, y el fondo ajeno solo al principio**",
    (relevoOscuro.maxDims ?? 9) === 2 && (relevoOscuro.maxPaneles ?? 9) === 2 &&
      (relevoOscuro.ventana.ms ?? 0) > 0 && (relevoOscuro.ventana.ms ?? 0) <= 400 &&
      (relevoOscuro.centroMaloPos ?? []).every((i) => i < 3) &&
      (relevoOscuro.fondoMaloPos ?? []).every((i) => i < 3),
    `ventana de dos hojas: ${relevoOscuro.ventana.ms} ms (${relevoOscuro.ventana.fotogramas} ` +
      `fotogramas) | maximo de sheet-dim: ${relevoOscuro.maxDims}, de sheet-panel: ` +
      `${relevoOscuro.maxPaneles} | fondo de mas arriba: ` +
      `${JSON.stringify(relevoOscuro.fondoTrasLaLlegada)} | fotogramas con el fondo de la hoja ` +
      `que se va: ${(relevoOscuro.fondoMaloT ?? []).length}` +
      `${(relevoOscuro.fondoMaloT ?? []).length ? ` (en el ${(relevoOscuro.fondoMaloT ?? []).join(", ")} ms, y la ventana empieza en el ${relevoOscuro.ventana.desde} ms; posiciones ${JSON.stringify(relevoOscuro.fondoMaloPos)} de ${relevoOscuro.ventana.fotogramas})` : ""} | ` +
      `fotogramas con el centro del panel que entra ` +
      `debajo de otro: ${relevoOscuro.centroMalo} (posiciones ` +
      `${JSON.stringify(relevoOscuro.centroMaloPos)}) | fotogramas con panel sin velo: ` +
      `${relevoOscuro.sinVelo}`,
  );
  check(
    "**y en oscuro el velo tampoco se pasa de un 20% por encima del del tema**",
    (relevoOscuro.picoVelo ?? 1) <= techoVelo(veloEnOscuro?.alfa) &&
      veloEnOscuro?.alfa != null &&
      (relevoOscuro.sinAlfa ?? 0) === 0,
    `pico del velo compuesto: ${relevoOscuro.picoVelo} en el fotograma de ` +
      `${relevoOscuro.picoEn} ms (capas: ${relevoOscuro.velosDelPico}) | el tema escribe ` +
      `${veloEnOscuro?.color} y el techo es ${
        techoVelo(veloEnOscuro?.alfa) ?? "n/d (sin alfa legible: la comprobacion no puede pasar)"
      } | fotogramas con un velo sin alfa legible: ${relevoOscuro.sinAlfa} | el pico ` +
      `dentro de la ventana: ${relevoOscuro.picoVeloEnLaVentana} ` +
      `(${relevoOscuro.velosDelPicoDeLaVentana})`,
  );


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
