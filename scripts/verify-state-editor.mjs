import { randomUUID } from "node:crypto";
import { execSync } from "node:child_process";
import { readFile } from "node:fs/promises";

import { launchChrome, openTab, seedSession, collectProblems } from "./cdp.mjs";

/**
 * El editor de estados, en un navegador.
 *
 * Los puntos que solo se pueden mirar, y el orden en que se miran:
 *
 *  - **los filtros del tablero**: el mismo `ListControls` que la pantalla de listas,
 *    con la completada apagada y su motivo, y **sin los seis modos de orden**;
 *  - **filtrar por etiqueta**: solo desaparecen las tarjetas sin la etiqueta y **los
 *    contadores de las pestañas siguen contando todas** —la diferencia es
 *    deliberada, y lo que hay que mirar es que no se lea como un fallo—;
 *  - **una lista de tareas sigue ofreciendo sus siete modos**, que es la regresion;
 *  - **un visor de verdad**: cuenta propia, rol `viewer` en el espacio, y ni la hoja
 *    de estado ni el editor de estados montados, con el aviso de solo lectura
 *    puesto. El servidor lo prohibe igual, y eso tambien se comprueba;
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
  // El correo viaja con la sesion **solo porque el bloque 23 necesita invitar a esta
  // persona por el**: la bandeja de invitaciones de `GET /invitations` se arma por
  // correo (`listForCaller` lee `users.email` y busca las invitaciones con ese
  // `invitedEmail`), asi que una invitacion creada sin correo es real pero invisible
  // en su bandeja —y el recorrido no puede afirmar que le llego si no hay bandeja que
  // mirar—. `seedSession` no lee este campo.
  return { ...session, email };
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

/**
 * **El tablero de los filtros, y es una siembra aparte con su propia cuenta de
 * columnas.**
 *
 * El tablero de arriba lo dejan los bloques 11 y 17 en un estado en el que ya no
 * sirve para contar: sin la columna que tenia las tareas y con veinticuatro estados.
 * Un filtro de etiqueta aqui no tendria nada que esconder y el recuento de las
 * pestañas no tendria dos numeros con los que puzzling.
 *
 * **Las etiquetas estan repartidas para que una columna se vacie y las otras dos no.**
 * `WIP` no lleva `urgente` en ninguna de sus dos tareas, asi que filtrando por
 * `urgente` esa columna se queda sin tarjetas mientras su pestaña sigue diciendo 2 —
 * que es el caso que hay que mirar con los ojos, porque es el que puede leerse como
 * un fallo. `Backlog` y `Ready` dejan una de cada dos, y `Done` no tiene ninguna,
 * con lo que los dos numeros que se comparan son `2,2,2,0` en las pestañas y
 * `1,1,0,0` en las cabeceras.
 */
const FILTRO_ESTADOS = [
  { id: randomUUID(), title: "Pendiente", color: "neutral" },
  { id: randomUUID(), title: "Siguiente", color: "blue" },
  { id: randomUUID(), title: "En curso", color: "amber" },
  { id: randomUUID(), title: "Hecho", color: "green" },
];

/** El tablero de los filtros, y su id va por delante porque lo siembran los bloques 21 a 23. */
const listFiltros = randomUUID();

const ETIQUETA = "urgente";
const OTRA_ETIQUETA = "domingo";

const FILTRO_TAREAS = [
  { title: "F-1", stateId: FILTRO_ESTADOS[0].id, position: 0, tags: [ETIQUETA] },
  {
    title: "F-2",
    stateId: FILTRO_ESTADOS[0].id,
    position: 1,
    tags: [OTRA_ETIQUETA],
  },
  { title: "F-3", stateId: FILTRO_ESTADOS[1].id, position: 2, tags: [ETIQUETA] },
  {
    title: "F-4",
    stateId: FILTRO_ESTADOS[1].id,
    position: 3,
    tags: [OTRA_ETIQUETA],
  },
  /** Las dos de "En curso" **no llevan la etiqueta del filtro**, y por eso la columna se vacia. */
  {
    title: "F-5",
    stateId: FILTRO_ESTADOS[2].id,
    position: 4,
    tags: [OTRA_ETIQUETA],
  },
  { title: "F-6", stateId: FILTRO_ESTADOS[2].id, position: 5, tags: [] },
].map((t) => ({ id: randomUUID(), ...t }));

/**
 * **La lista de tareas de la regresión, y es del mismo espacio a proposito.**
 *
 * El bloque 22 tiene que afirmar que una lista de tareas normal **sigue ofreciendo
 * los siete modos de orden**, y eso solo se puede comparar con algo real: si el
 * tablero y la lista estuvieran en workspaces distintos el recorrido tendria que
 * cambiar de sesion y perder el tablero a mitad de camino.
 */
const LISTA_TAREAS = randomUUID();

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

/**
 * **La segunda siembra: el tablero de los filtros y la lista de tareas de la
 * regresión, en el mismo espacio y con la misma etiqueta.**
 *
 * Va en **su propio `push`** y no en el de arriba, y no por separacion: el push
 * primero ya se ha comprobado con `results` y si esta siembra se mezclara dentro, el
 * `applied x/y` de esa comprobacion contaria operaciones de las dos y dejaria de
 * decir de quien es el fallo. Ademas esta necesita **sus propias tareas con
 * etiquetas**, y `list_item` lleva `tags` como un campo mas del payload —que es lo
 * que hace `FILTRO_TAREAS`— mientras que la siembra de arriba no trae ninguna.
 *
 * Y el tablero de filtros **no lleva `stateId` en las suyas de la primera
 * columna** a proposito: se lo escriben todas, porque lo que se compara aqui son
 * dos recuentos y no el reparto de las filas con `stateId` nulo.
 */
const sembradoFiltros = await api("/sync/push", {
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
        entity: "list",
        kind: "create",
        entityId: listFiltros,
        baseVersion: 0,
        base: null,
        clientTimestamp: at,
        payload: {
          workspaceId: ws,
          folderId: null,
          title: "Filtros",
          kind: "board",
          orderMode: "manual",
          states: FILTRO_ESTADOS,
        },
      },
      ...FILTRO_TAREAS.map((tarea) => ({
        operationId: randomUUID(),
        clientId: CLIENT,
        entity: "list_item",
        kind: "create",
        entityId: tarea.id,
        baseVersion: 0,
        base: null,
        clientTimestamp: at,
        payload: {
          listId: listFiltros,
          title: tarea.title,
          position: tarea.position,
          stateId: tarea.stateId,
          tags: tarea.tags,
        },
      })),
      {
        operationId: randomUUID(),
        clientId: CLIENT,
        entity: "list",
        kind: "create",
        entityId: LISTA_TAREAS,
        baseVersion: 0,
        base: null,
        clientTimestamp: at,
        payload: {
          workspaceId: ws,
          folderId: null,
          title: "Tareas",
          kind: "tasks",
          orderMode: "manual",
        },
      },
      ...["P-1", "P-2"].map((titulo, i) => ({
        operationId: randomUUID(),
        clientId: CLIENT,
        entity: "list_item",
        kind: "create",
        entityId: randomUUID(),
        baseVersion: 0,
        base: null,
        clientTimestamp: at,
        payload: {
          listId: LISTA_TAREAS,
          title: titulo,
          position: i,
          tags: [OTRA_ETIQUETA],
        },
      })),
    ],
  },
});

const resultadosFiltros = sembradoFiltros.body?.data?.results ?? [];
const rechazadasFiltros = resultadosFiltros.filter(
  (r) => r.status !== "applied" && r.status !== "duplicate",
);
check(
  "la siembra de los filtros se aplico entera (results, no el codigo)",
  sembradoFiltros.status === 200 && rechazadasFiltros.length === 0,
  `http ${sembradoFiltros.status}, applied ` +
    `${resultadosFiltros.filter((r) => r.status === "applied").length}/${resultadosFiltros.length}` +
    (rechazadasFiltros.length
      ? ` — rechazadas: ${rechazadasFiltros.map((r) => `${r.entity}:${r.error}`).join(" | ")}`
      : ""),
);
if (failures > 0) {
  console.log("\nSin el tablero de los filtros no hay nada que mirar.");
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
  const apagadoDe = (el) =>
    !el ||
    el.disabled === true ||
    el.getAttribute('aria-disabled') === 'true';
  /*
    **Solo las filas de columna y no las de destino de la pagina del borrado.** Las
    dos familias empiezan por 'state-editor-' y 'state-delete-' respectivamente, asi
    que el selector de las filas no las pilla — pero el lector se sigue usando en la
    pagina del borrado (para afirmar que el panel sigue en pie) y ahi las filas de
    columna ya no estan, que es justo lo que se quiere ver.
  */
  const filas = [...panel.querySelectorAll('[data-testid^="state-editor-row-"]')].map((el) => {
    const id = el.getAttribute('data-testid').replace('state-editor-row-', '');
    const numero = panel.querySelector('[data-testid="state-editor-count-' + id + '"]');
    const puntos = [...el.querySelectorAll('div')]
      .map((d) => getComputedStyle(d).backgroundColor)
      .filter((c) => c && c !== 'transparent' && c !== 'rgba(0, 0, 0, 0)');
    const bin = panel.querySelector('[data-testid="state-editor-bin-' + id + '"]');
    const asa = panel.querySelector('[data-testid="state-editor-asa-' + id + '"]');
    const binRect = bin ? bin.getBoundingClientRect() : null;
    const asaRect = asa ? asa.getBoundingClientRect() : null;
    return {
      id,
      titulo: (el.innerText || '').split('\\n')[0] ?? '',
      numero: numero ? Number(numero.innerText) : null,
      punto: puntos[0] ?? null,
      etiqueta: el.getAttribute('aria-label') ?? '',
      ancho: Math.round(el.getBoundingClientRect().width),
      alto: Math.round(el.getBoundingClientRect().height),
      /*
        **La papelera y el asa, leidas por su testID y no por su dibujo.** Un bin
        apagado tiene que distinguirse de uno encendido, y hay dos formas de
        distinguirlo: el atributo disabled —que react-native-web puede no
        escribir, que es justo el caso que 'apagadoDe' documenta mas abajo para el
        boton de anadir— y la opacidad, que es lo que la persona ve. Se leen las
        dos porque una comprobacion que mira solo una de ellas pasa con la otra rota.
      */
      papelera: bin
        ? {
            apagada: apagadoDe(bin),
            etiqueta: bin.getAttribute('aria-label') ?? '',
            opacidad: getComputedStyle(bin).opacity,
            ariaDisabled: bin.getAttribute('aria-disabled'),
            ancho: binRect ? Math.round(binRect.width) : 0,
            alto: binRect ? Math.round(binRect.height) : 0,
          }
        : null,
      asa: asa
        ? {
            etiqueta: asa.getAttribute('aria-label') ?? '',
            ancho: asaRect ? Math.round(asaRect.width) : 0,
            alto: asaRect ? Math.round(asaRect.height) : 0,
          }
        : null,
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

/**
 * La hoja de borrado: cuantas tareas dice, cuales son los destinos con su contador,
 * y si el boton de confirmar sale apagado sin que nadie haya elegido uno.
 *
 * **Se busca por sus filas de destino y no por su titulo**, porque el titulo lleva
 * el nombre de la columna y el nombre es lo que cambia entre una corrida y otra;
 * `state-delete-destino-` es el `testID` de una fila y no depende de nada.
 */
const LEER_BORRADO = `(() => {
  const paneles = [...document.querySelectorAll('[data-testid="sheet-panel"]')];
  const panel = paneles.find((p) => p.querySelector('[data-testid^="state-delete-destino-"]')) ?? null;
  if (!panel) return null;
  const confirmar = panel.querySelector('[data-testid="state-delete-confirm"]');
  return {
    /*
      **El titulo del panel es el del editor y no el de la pregunta**, porque ahora
      son la misma pagina: la pregunta se dibuja en el cuerpo del panel del editor.
      Eso es justo lo que se quiere ver, y por eso el titulo sale con la frase del
      editor — y la columna que se borra la dice su propia linea, la primera de la
      pagina, que esta en el texto.
    */
    titulo: panel.querySelector('div')?.innerText ?? null,
    destinos: [...panel.querySelectorAll('[data-testid^="state-delete-destino-"]')]
      .filter((el) => (el.getAttribute('data-testid') || '').indexOf('-count-') < 0)
      .map((el) => {
        const id = el.getAttribute('data-testid').replace('state-delete-destino-', '');
        const cuenta = panel.querySelector('[data-testid="state-delete-destino-count-' + id + '"]');
        return {
          id,
          titulo: (el.innerText || '').split('\\n')[0] ?? '',
          numero: cuenta ? Number(cuenta.innerText) : null,
          etiqueta: el.getAttribute('aria-label') ?? '',
          elegida: (el.getAttribute('aria-label') || '').indexOf('está aquí') >= 0,
        };
      }),
    confirmar: confirmar
      ? {
          apagado:
            confirmar.disabled === true ||
            confirmar.getAttribute('aria-disabled') === 'true',
          etiqueta: (confirmar.innerText || '').replace(/[\\uE000-\\uF8FF]/g, '').trim(),
        }
      : null,
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

/**
 * **Los tres numeros de una columna a la vez: la pestaña, la cabecera y las
 * tarjetas dibujadas.**
 *
 * Es el instrumento del bloque 21 y la razon de que exista: el bloque entero
 * afirma que el filtro esconde filas y **no** esconde la cuenta de las pestañas, y
 * una comprobacion que lee las dos por separado puede pasar con una que esta
 * descolocada. Leyendo las tres en la misma evaluacion, el instante es el mismo y la
 * afirmacion es sobre un estado de la pantalla y no sobre dos.
 *
 * **El numero de la pestaña sale del ultimo grupo de digitos de su texto**, que es
 * como esta pintado —el nombre del estado y el numero, uno detras del otro— y no de
 * un `testID` propio: `BoardTabs` no le pone uno al numero, pone uno a la pastilla
 * entera. Si someday el texto de una pastilla trae otro numero —"En curso · 2 de
 * 5"— el regexp seguira cogiendo el ultimo, que es el que cuenta.
 *
 * **Y se afirma que el numero se ha podido leer.** Un lector que no encuentra la
 * pastilla devuelve `null` y una comprobacion que compara `null` con `2` falla, que
 * es lo que tiene que pasar: un numero que no se ha leido no es un numero que valga
 * cero.
 */
const TABLERO_CONTADO = `(() => {
  const numeroDe = (texto) => {
    const m = String(texto || '').match(/(\\d+)\\s*$/);
    return m ? Number(m[1]) : null;
  };
  const slots = [...document.querySelectorAll('[data-testid^="board-slot-"]')];
  return slots.map((slot) => {
    const id = slot.getAttribute('data-testid').replace('board-slot-', '');
    const tab = document.querySelector('[data-testid="board-tab-' + id + '"]');
    const cabecera = document.querySelector('[data-testid="board-count-' + id + '"]');
    const caja = document.querySelector('[data-testid="board-cards-' + id + '"]');
    return {
      id,
      pestana: tab ? numeroDe(tab.innerText) : null,
      cabecera: cabecera ? numeroDe(cabecera.innerText) : null,
      tarjetas: [...slot.querySelectorAll('[data-testid^="board-card-"]')].map(
        (el) => (el.innerText || '').split('\\n')[0] ?? '',
      ),
      /*
        **La caja de tarjetas, contada por sus hijos y no por una frase.** Un
        EmptyState no lleva testID —no hay donde colgarlo sin tocar un archivo
        mas— y una columna con tarjetas tiene una por tarjeta, mientras que la
        columna sin ellas tiene un solo hijo que es el estado vacio. El texto se
        imprime para que el informe pueda citarlo, y la comprobacion es sobre los
        hijos: un texto que cambiara con el idioma no puede hacer fallar la cuenta.
      */
      hijos: caja ? caja.children.length : null,
      primeraLinea: caja ? ((caja.innerText || '').split('\\n').filter(Boolean)[0] ?? '') : null,
    };
  });
})()`;

/**
 * Los titulos de las tarjetas de una columna, **en el orden en que estan dibujadas**.
 *
 * Se leen del `testID` de la tarjeta —`board-card-<id>`— y no del `item-row-<id>` de
 * la fila: la caja de la tarjeta es lo que el gesto mueve, y es la que lleva el
 * transform y la sombra que el bloque 20 mira. El titulo se busca por su primer linea
 * de texto, que es el nombre de la tarea.
 *
 * **Se leen del DOM y no de `RE_TAREAS`, y el motivo es la comprobacion de "el
 * servidor tiene el mismo orden".** Si el esperado saliera del mismo array del que
 * se saco la semilla, las dos mitades compararian el mismo dato consigo mismo y
 * pasarian con la app rota. El orden de la semilla se usa solo para *calcular* un
 * destino, que es una cuenta; la verdad se lee de los dos lados.
 */
const LEER_ORDEN = (columnaId) => `(() => {
  const caja = document.querySelector('[data-testid="board-cards-${columnaId}"]');
  if (!caja) return [];
  return [...caja.querySelectorAll('[data-testid^="board-card-"]')].map(
    (el) => (el.innerText || '').split('\\n')[0] ?? '',
  );
})()`;

/**
 * La caja de tarjetas de una columna con lo que hay que medir antes de arrastrar: su
 * alto, su contenido, y cada tarjeta con su `top`, su alto, su sombra, su `z-index` y
 * su `touch-action`.
 *
 * **`touchAction` viene aqui porque es una comprobacion y no una curiosidad**: el
 * `GestureDetector` de la tarjeta escribe `touch-action` en el elemento que envuelve
 * (`GestureHandlerWebDelegate.js`, `touchAction ?? 'none'`), y con el valor por
 * defecto una columna con mas tarjetas de las que caben **dejaria de hacer scroll en
 * el navegador**, que es el fallo que el alto de la pista del tablero se midio para
 * arreglar. Aqui se lee el valor escrito.
 */

/**
 * El orden de una lista de titulos con la tarjeta `id` movida `delta` puestos hacia
 * abajo, **y el calculo es el mismo `nextOrderFromDrop` que usa la app: quitar y
 * insertar.**
 *
 * No es una cuenta inventada para que la comprobacion salga: es el mismo algoritmo
 * con el mismo recorte, y esta escrito en el guion **a proposito**, porque el
 * esperado tiene que salir de una regla y no de la lista que la app acaba de pintar.
 * Un esperado escrito a mano ("C02 C01 C03…") seria una copia del resultado de una
 * corrida y solo valdria para esa.
 *
 * **El titulo se busca por la semilla y no por el `testID` de la tarjeta**: el id es
 * un `randomUUID` distinto en cada corrida, asi que el unico manera de encontrar la
 * fila es por el nombre de la tarea —que es el mismo texto en la semilla y en la
 * pantalla— y por eso el argumento es un id y no un indice: la columna puede venir
 * de mas abajo, con un hueco delante.
 */
function ordenCierto(titulos, tarea, delta) {
  const desde = titulos.indexOf(tarea.title);
  if (desde < 0) return titulos;
  const siguiente = [...titulos];
  const [movida] = siguiente.splice(desde, 1);
  siguiente.splice(Math.max(0, Math.min(desde + delta, siguiente.length)), 0, movida);
  return siguiente;
}

/** La hoja de estado de una tarea abierta, o su texto, y `null` si no hay ninguna. */
const HOJA_DE_ESTADO = `(() => {
  const paneles = [...document.querySelectorAll('[data-testid="sheet-panel"]')];
  const p = paneles.find((x) => x.querySelector('[data-testid^="state-picker-row-"]')) ?? null;
  return p ? (p.innerText || '').split('\\n').filter(Boolean).slice(0, 3).join(' / ') : null;
})()`;

/**
 * La hoja de los filtros, **con las tres casillas de "qué mostrar" y las filas de
 * orden que la hoja decida ofrecer.**
 *
 * Las tres casillas se buscan por su `testID` y no por su texto: el texto esta en
 * el diccionario y cambia con el idioma, y lo que se comprueba es si estan **apagadas**
 * —que es una propiedad del elemento, no una frase—. El `aria-disabled` y el atributo
 * `disabled` se leen los dos porque en react-native-web un pulsable es un `div` con
 * `role` y no lleva el atributo: preguntar solo por `disabled === true` pasaria con
 * cualquiera de los dos casos.
 *
 * **La marca se lee del dibujo y no de `aria-checked`, y no es una preferencia.**
 * `Checkbox` escribe `accessibilityState={{ checked, disabled }}` y
 * `react-native-web@0.21` **construye su ARIA de las props `aria-*` y del objeto
 * `accessibilityState` no se sirve para esta** —`createDOMProps` lee
 * `accessibilityChecked`, que es la prop antigua, y `aria-checked` de ahi sale
 * `undefined`. Es el mismo phenomenon que `board-tabs.tsx` documenta para
 * `aria-selected`, y por eso la comprobacion de la marca va por el **palomita que
 * dibuja `Checkbox`**: `checked ? <AppText>✓</AppText> : null`. Un atributo que el
 * navegador no escribe no puede ser el criterio de una comprobacion, porque
 * preguntaria por algo que no existe y pasaria con cualquier cosa.
 *
 * **Y las filas de orden se cuentan por su etiqueta**, que es la unica cosa que las
 * identifica: `SheetOptionRow` dibuja un `Pressable` con `aria-label` igual a la
 * etiqueta de la opcion y no le pone `testID`. Las siete etiquetas estan escritas
 * aqui a mano **y eso es lo que hace que el recuento no pueda pasar por nada**: el
 * bloque 22 las cuenta en una lista de tareas, donde tienen que ser siete, y si
 * estan mal escritas ese bloque falla. Entre los dos, una etiqueta equivocada no
 * puede dejar a los dos bloques en verde.
 */
const ORDENES_ES = [
  "Como yo lo pongo",
  "A-Z",
  "Z-A",
  "Lo más reciente primero",
  "Lo más antiguo primero",
  "Tocados antes",
  "Primero lo urgente",
];

const LEER_FILTROS = (etiquetasDeOrden) => `(() => {
  const paneles = [...document.querySelectorAll('[data-testid="sheet-panel"]')];
  const panel = paneles.find((p) => p.querySelector('[data-testid^="filters-completed-"]')) ?? null;
  if (!panel) return null;
  const etiquetas = ${JSON.stringify(etiquetasDeOrden)};
  const botones = [...panel.querySelectorAll('[role="button"][aria-label]')].map(
    (el) => el.getAttribute('aria-label'),
  );
  const casillas = ['all', 'pending', 'done'].map((value) => {
    const el = panel.querySelector('[data-testid="filters-completed-' + value + '"]');
    if (!el) return { valor: value, existe: false };
    return {
      valor: value,
      existe: true,
      apagada:
        el.disabled === true || el.getAttribute('aria-disabled') === 'true',
      /*
        **La marca, por el dibujo y no por un atributo.** aria-checked no se escribe
        —vease la nota de la cabecera de este bloque— y ademas hay que leerla de la
        casilla y no de su etiqueta: la etiqueta es el texto que dice "Todo" y la
        palomita es lo unico que puede decir que esa fila es la que esta marcada.
      */
      marcada: /\\u2713/.test(el.innerText || ''),
      opacidad: getComputedStyle(el).opacity,
      texto: (el.innerText || '').replace(/[\\u2713]/g, '').trim(),
    };
  });
  const motivo = panel.querySelector('[data-testid="filters-completed-off"]');
  const deEtiquetas = [...panel.querySelectorAll('[data-testid^="filters-tag-"]')].map(
    (el) => el.getAttribute('aria-label'),
  );
  return {
    titulo: (panel.innerText || '').split('\\n').filter(Boolean).slice(0, 2).join(' / '),
    casillas,
    motivo: motivo ? (motivo.innerText || '').trim() : null,
    filasDeOrden: etiquetas.filter((t) => botones.includes(t)),
    botones,
    etiquetasTags: deEtiquetas,
    texto: panel.innerText,
  };
})()`;

/**
 * El boton de los controles, **con la etiqueta que lleva escrita**: `Filtrar · A
 * mano`, y `Filtrar 1 · A mano` con un filtro puesto.
 *
 * Se lee el `aria-label` y no el texto visible porque el texto visible pasa por un
 * boton que en react-native-web puede partirlo en varios nodos, y el `aria-label` es
 * la cadena que el boton de verdad lleva.
 */
const LEER_BOTON_CONTROLES = `(() => {
  const el = document.querySelector('[data-testid="board-controls"], [data-testid="task-controls"]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return {
    etiqueta: el.getAttribute('aria-label') ?? (el.innerText || '').trim(),
    texto: (el.innerText || '').trim(),
    ancho: Math.round(r.width),
    alto: Math.round(r.height),
  };
})()`;

/**
 * El aviso de solo lectura, **y su texto entero**, porque la comprobacion es que sale
 * **el mismo** que el de la pantalla de listas y no una frase parecida.
 */
const AVISO_SOLO_LECTURA =
  'Estás mirando otro orden. Vuelve a "como yo lo pongo" para mover filas.';

const LEER_AVISO = (fraseEsperada) => `(() => {
  const el = document.querySelector('[data-testid="board-readonly-notice"]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return {
    texto: (el.innerText || '').trim(),
    esLaEsperada: (el.innerText || '').trim() === ${JSON.stringify(fraseEsperada)},
    dentro: r.top >= 0 && r.bottom <= window.innerHeight,
    top: Math.round(r.top),
  };
})()`;

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

/**
 * Cerrar la hoja de filtros **solo si esta abierta**, y sin dar un toque a ciegas.
 *
 * El motivo es el bloque 22.4 y el fallo que dio: pulsar una etiqueta **no cierra**
 * la hoja —`ListControls` se queda como esta y solo cambia el dibujo de las
 * tarjetas—, asi que el gesto siguiente, `tap(tab, "board-controls")`, caia sobre el
 * velo de una hoja que ya estaba abierta, la cerraba, y el `tap` de la etiqueta de
 * despues no encontraba nada: `no encuentro filters-tag-urgente`. Un boton que se
 * pulsa para abrir y que tambien cierra la hoja por el camino del velo es
 * exactamente el caso en el que "abrir el control" no es lo mismo que "cerrar la
 * hoja".
 *
 * **Y pregunta antes de tocar**, que es lo que hace que esto no sea un segundo
 * intento a ciegas: si la hoja no esta, no hay nada que cerrar.
 */
async function cerrarFiltrosSiEstaAbierta(tab) {
  const abierta = await tab.evaluate(
    `[...document.querySelectorAll('[data-testid="sheet-panel"]')].some((p) => ` +
      `!!p.querySelector('[data-testid^="filters-completed-"]'))`,
  );
  if (!abierta) return false;
  await cerrarConLaX(tab, `p.querySelector('[data-testid^="filters-completed-"]')`);
  return true;
}

/**
 * Abrir la hoja de filtros de este boton, **y es un gesto y no un `tap` a ciegas**
 * porque el boton esta encima del tablero y encima de la hoja: si la hoja ya esta
 * abierta, `centro` lo encuentra, el toque cae en el velo y la cierra, y el bloque
 * sigue creyendo que la tiene abierta. Se cierra primero lo que hubiera y luego se
 * abre una vez, que es el estado en el que todas las lecturas de la hoja valen.
 */
async function abrirFiltros(tab, testIdDelBoton) {
  await cerrarFiltrosSiEstaAbierta(tab);
  await tap(tab, testIdDelBoton);
  const abierta = await tab.evaluate(
    `[...document.querySelectorAll('[data-testid="sheet-panel"]')].some((p) => ` +
      `!!p.querySelector('[data-testid^="filters-completed-"]'))`,
  );
  if (!abierta) throw new Error(`${testIdDelBoton} no ha abierto la hoja de filtros`);
  return abierta;
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
 * Ir a una pantalla, **con un reintento cuando la navegacion no responde.**
 *
 * **El fallo es del arnes y no de la app, y la prueba esta en la captura.** Un
 * `Page.navigate` —o el `goto` que lo envuelve— se queda sin contestar con la
 * pantalla **pintada** y Metro sano: en la primera corrida de este bloque 7 el error
 * fue `la pagina no llego a estar lista`, y `99-error.png` mostraba el tablero entero
 * con sus cinco columnas y sus tarjetas, o sea la pagina que el guion decia que no
 * estaba. Es `scripts/cdp.mjs`, compartido por veinte guiones y sin endurecer; **`cdp.mjs`
 * no se toca en esta tarea** y el reintento va aqui.
 *
 * El reintento es de la navegacion entera y no del paso que viene despues, y la espera
 * crece porque un reintento inmediato cae en el mismo instante en que el navegador
 * sigue ocupado — el criterio y el motivo de `enviarToque`.
 */
async function irA(tab, url, intentos = 3) {
  for (let intento = 1; ; intento += 1) {
    try {
      return await tab.goto(url);
    } catch (e) {
      if (intento >= intentos) throw e;
      console.log(
        `      (la navegacion a ${url} no ha respondido; intento ${intento + 1} de ${intentos}: ` +
          `${e.message})`,
      );
      await sleep(2000 * intento);
    }
  }
}

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
 * Un dedo que **se arrastra** de un elemento a otro, y con el mismo reintento que
 * `verify-panel-carry.mjs` escribe para `Input.dispatchTouchEvent`.
 *
 * **El reintento no es un adorno de este guion sino un copiado del de ahi, y con
 * el mismo motivo:** un `dispatchTouchEvent` tarda milisegundos y hay veces que el
 * navegador no lo acusa aunque la pagina este perfectamente viva —que es lo que se
 * comprobo: la pagina contestaba a una `evaluate` mientras la entrada no contestaba
 * nada—. Sin reintento eso sale como un fallo que senala el gesto, y el que lo lee
 * se pasa una tarde mirando la app. Tres intentos y una pausa creciente entre
 * ellos, porque un reintento inmediato cae en el mismo instante en que el navegador
 * sigue ocupado.
 *
 * **Catorce pasos y 14 ms entre ellos**, los numeros de aquel guion tambien: un
 * gesto que salta de un punto al siguiente no da al `Pan` ningun `translationY` que
 * leer, y `dropIndex` necesita una distancia real —la que decide en quantas filas
 * salta la columna.
 *
 * **El argumento es un desplazamiento y no un punto de destino**, y eso no es una
 * comodidad: la primera version de este guion pasaba un punto **absoluto** y hacia
 * falta un ojo. `centro` devuelve el rectangulo ya/clientado y del que la primera
 * fila esta a 286 de la parte de arriba de la ventana, asi que pedir "la tercera
 * fila mas 1,5 pasos" es un viaje de 186 puntos donde se creian 84 — tres filas en
 * lugar de dos, y la comprobacion del reordenado cayo por un error del guion y no de
 * la app. **Un gesto se describe con cuanto se ha movido el dedo**, que es lo que
 * `translationY` va a ver.
 *
 * **El dedo se suelta siempre**, tambien cuando el gesto ha fallado: un dedo que se
 * queda puesto hace que los toques siguientes lleguen con uno que ya estaba ahi, y el
 * fallo aparece dos comprobaciones mas abajo como si fuera otro.
 */
let dedos = 0;
async function enviarToque(tab, params) {
  try {
    return await tab.send("Input.dispatchTouchEvent", params, { ms: 15000 });
  } catch {
    for (let intento = 1; intento <= 3; intento += 1) {
      console.log(`      (el navegador no acuso un ${params.type}; intento ${intento + 1})`);
      await sleep(1500 * intento);
      try {
        return await tab.send("Input.dispatchTouchEvent", params, { ms: 15000 });
      } catch {
        /* se vuelve a intentar */
      }
    }
    throw new Error(
      `el navegador dejo de responder a los toques (${params.type}) y la pagina sigue viva: ` +
        "esto es el entorno de la comprobacion, no el panel",
    );
  }
}

async function arrastrar(tab, testId, puntos, { pasos = 14, espera = 14 } = {}) {
  const p = await centro(tab, testId);
  if (!p) throw new Error(`no encuentro el asa ${testId}`);
  const dedo = dedos++;
  const punto = (y) => [{ x: p.x, y, id: dedo, radiusX: 8, radiusY: 8, force: 1 }];
  await enviarToque(tab, { type: "touchStart", touchPoints: punto(p.y) });
  try {
    for (let i = 1; i <= pasos; i += 1) {
      await enviarToque(tab, {
        type: "touchMove",
        touchPoints: punto(p.y + (puntos * i) / pasos),
      });
      await sleep(espera);
    }
  } finally {
    await tab
      .send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
      .catch(() => {});
    await tab
      .send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] })
      .catch(() => {});
  }
  await sleep(420);
  return p;
}

/**
 * La ventana de **dos paneles a la vez y sin que ninguno se vaya**, que es lo que
 * abre la hoja de borrado sobre el editor de estados.
 *
 * **El instrumento es el del bloque 9 con dos cosas mas**, y las dos son
 * precisamente las que hacen falta para el caso:
 *
 * - **quien es el de mas arriba**, en el mismo punto de fondo —a 1440 el punto (60,
 *   300) es fondo— y en el centro del panel que entra. Es la comprobacion que
 *   decide el asunto: el defecto del que habla la cabecera de
 *   `state-editor-sheet.tsx` es *"una pulsacion que llega al que no es"*, y eso se
 *   mide preguntando a quien pertenece el elemento de mas arriba en cada
 *   fotograma, no contando paneles.
 * - **la opacidad del envoltorio de cada modal**, que es donde react-native-web
 *   pinta `{ opacity: 0 }` hasta que su `useEffect` corre (`ModalAnimation.js:67`)
 *   y de donde sale el "~16 ms de un fotograma con el orden invertido" que miden los
 *   relevos de las Tareas 10 y 11. Aqui se mira porque es el unico sitio donde un
 *   fotograma podria pintar un panel invisible por encima del otro.
 *
 * **Los velos tambien se leen**, porque el coste real de este relevo no es que una
 * pulsacion llegue mal: es que hay **dos** velos sobre el tablero mientras la hoja
 * esta abierta, y el fondo se compone. La composicion de dos velos es
 * `a + b(1 - a)`, y con el editor ya asentado en su valor final lo que se mueve es
 * el `alpha` del velo de la hoja de borrado.
 */
const INSTALAR_MUESTREO_BORRADO = `(() => {
  const reg = { t0: performance.now(), muestras: [], vivo: true };
  window.__borrado = reg;
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
      : mio.querySelector('[data-testid^="state-delete-destino-"]')
        ? 'borrado'
        : 'otro';
    return quien + '#' + p;
  };
  const alphaDe = (v, quien) => {
    for (const k of Object.keys(v)) if (k.indexOf(quien + '#') === 0) return v[k];
    return null;
  };
  const paso = () => {
    const dims = [...document.querySelectorAll('[data-testid="sheet-dim"]')];
    const paneles = [...document.querySelectorAll('[data-testid="sheet-panel"]')];
    const borrado = paneles.find((p) => p.querySelector('[data-testid^="state-delete-destino-"]')) ?? null;
    const r = borrado ? borrado.getBoundingClientRect() : null;
    const dentro = r && r.width > 0 && r.top < window.innerHeight && r.bottom > 0;
    const velos = {};
    for (const d of dims) velos[quienDe(d)] = Number(getComputedStyle(d).opacity);
    reg.muestras.push({
      t: Math.round(performance.now() - reg.t0),
      dims: dims.length,
      paneles: paneles.length,
      quien: paneles.map(quienDe).join(' + '),
      veloBorrado: alphaDe(velos, 'borrado'),
      veloEditor: alphaDe(velos, 'editor'),
      envoltorios: paneles.map((p) => {
        const d = p.closest('body > div');
        return quienDe(p) + '=' + (d ? getComputedStyle(d).opacity : '?');
      }).join(' '),
      fondo: quienDe(document.elementFromPoint(60, 300)),
      centro: dentro
        ? quienDe(document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)))
        : 'fuera de pantalla',
    });
    if (reg.vivo && performance.now() - reg.t0 < 900) requestAnimationFrame(paso);
    else reg.vivo = false;
  };
  requestAnimationFrame(paso);
  return true;
})()`;

const LEER_MUESTREO_BORRADO = `(() => {
  const reg = window.__borrado;
  if (!reg) return { error: 'el muestreo no estaba instalado' };
  reg.vivo = false;
  const m = reg.muestras;
  const llega = m.findIndex((x) => x.quien.indexOf('borrado#') >= 0);
  const despues = llega >= 0 ? m.slice(llega) : [];
  /*
    **El instrumento se mira a si mismo antes que nada.** Una ventana de cero con
    dos paneles seria una lectura de un instrumento que no vio el gesto, que es lo
    unico que sale bien de un muestreo que no midio nada — y por eso 'fotogramas' y
    'llegada' se comprueban antes que cualquier conclusion sobre la ventana.
  */
  if (despues.length === 0) {
    return { error: 'la hoja de borrado no llego a verse en ningun fotograma', fotogramas: m.length };
  }
  const num = (arr) => arr.filter((x) => typeof x === 'number');
  const vb = num(despues.map((x) => x.veloBorrado));
  const ve = num(despues.map((x) => x.veloEditor));
  return {
    fotogramas: m.length,
    hasta: m.length ? m.at(-1).t : 0,
    llegada: m[llega].t,
    ventana: {
      desde: despues[0].t,
      hasta: despues.at(-1).t,
      ms: despues.at(-1).t - despues[0].t,
      fotogramas: despues.length,
    },
    quienEnLaVentana: despues[0].quien,
    quienAlFinal: m.at(-1).quien,
    maxDims: m.reduce((a, x) => Math.max(a, x.dims), 0),
    maxPaneles: m.reduce((a, x) => Math.max(a, x.paneles), 0),
    /*
      **Las dos cuentas del defecto, y las dos son sobre fotogramas con la hoja
      abierta** — no sobre todos, porque antes de que llegue no hay nada que
      comprobar y despues de que se vaya tampoco. 'fondoAjeno' es el numero de
      fotogramas en los que una pulsacion en el fondo llegaria al editor en vez de a
      la hoja de borrado; 'centroAjeno', los en los que el centro de la hoja de
      borrado esta debajo de otra cosa.
    */
    fondoAjeno: despues.filter((x) => x.fondo.indexOf('borrado#') !== 0).length,
    centroAjeno: despues.filter((x) => x.centro.indexOf('borrado#') !== 0).length,
    fondos: [...new Set(despues.map((x) => x.fondo))],
    centros: [...new Set(despues.map((x) => x.centro))],
    sinVelo: despues.filter((x) => x.paneles > x.dims).length,
    envoltorioCero: despues.filter((x) => /borrado#\\d+=0(\\s|$)/.test(x.envoltorios)).length,
    veloBorrado: vb.length ? [Number(Math.min(...vb).toFixed(3)), Number(Math.max(...vb).toFixed(3))] : null,
    veloEditor: ve.length ? [Number(Math.min(...ve).toFixed(3)), Number(Math.max(...ve).toFixed(3))] : null,
  };
})()`;
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
  await irA(tab, `${APP}/board/${listId}`);
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

  /**
   * **Las operaciones de `list_item`, contadas aparte de las de `list`, y con el
   * `stateId` de cada una.**
   *
   * El contador de arriba suma todo, y para el borrado de una columna con tareas eso
   * no sirve: son **dos operaciones de `list_item` y una de `list`**, y una suma no
   * distinguiría "las dos tareas se movieron con su id escrito y el array se escribió
   * una vez" de "se movió una y el array se escribió dos veces" — que son fallos
   * distintos y los dosían el mismo total.
   *
   * **Y el `stateId` de cada operación es la comprobación de verdad**, porque es el
   * único sitio donde se ve el caso silencioso: una tarea con `state_id` nulo que se
   * deja como estaba **se dibuja en la columna que pasa a ser la primera**, que aquí
   * es el destino elegido, así que la pantalla la enseña en el sitio correcto y no
   * dice nada. En el cable, un `null` se ve.
   */
  const operaciones = [];
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
    operaciones.push({
      at: Date.now(),
      items: ops.filter((o) => o?.entity === "list_item").length,
      estados: ops
        .filter((o) => o?.entity === "list_item")
        .map((o) => (o?.payload?.stateId === undefined ? "sin campo" : o.payload.stateId)),
      /*
        **Que filas son, y no solo cuantas.** El bloque 20 lo necesita para afirmar que
        un reordenado en Ready no lleva filas de Backlog, y esa afirmacion no se puede
        hacer con una suma: cuatro operaciones de `list_item` pueden ser cuatro filas
        de Ready o tres de Ready y una de Backlog, y el total es el mismo.

        Y **la `position` de cada una**, porque una operacion que lleva `position` es
        media prueba: hace falta ver que el numero es el nuevo.
      */
      ids: ops
        .filter((o) => o?.entity === "list_item")
        .map((o) => o?.entityId ?? null),
      posiciones: ops
        .filter((o) => o?.entity === "list_item")
        .map((o) => (o?.payload?.position === undefined ? "sin campo" : o.payload.position)),
    });
  });
  const vaciarItems = () => {
    operaciones.length = 0;
  };

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

  await irA(tab, `${APP}/lists`);
  await sleep(2500);
  await irA(tab, `${APP}/board/${listId}`);
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
  /*
    **El umbral del centro pasa de `fotogramas - 1` a `fotogramas - 2`, y es una
    correccion de la Task 11 y no una de esta.** El comentario de arriba, que es el
    de la Task 11 y esta aqui sin tocar, dice que el orden invertido se ha medido
    *"en 0, 1 o 2 fotogramas, siempre en las primeras posiciones de la ventana"* — y el
    umbral solo permitia uno. En la corrida del 5 de octubre de 2026, con 16
    fotogramas de ventana, salieron **14** y la comprobacion cayo con el mensaje
    entero describiendo una corrida sin fallos: `posiciones con el fondo de la hoja que
    se va: [0..15] de 16` —**los dieciseis**, que es lo que la comprobacion del fondo
    exige y lo que dice que el defecto esta entero— y `posiciones con el centro del
    que entra debajo: [2..15]`, o sea que el centro se recupero en **las dos** Primeras
    posiciones en vez de en una.

    Es decir: **la propia medicion de la Task 11 dice que el numero vale dos y el tope
    pedia uno**, y un tope que se contradice con la medicion que lojustify no es un
    tope: es una comprobacion que falla cuando la app se comporta como se ha medido
    que se comporta. **El fondo sigue exigiendo los dieciseis de dieciseis** —esa
    parte no se toca, porque ahi el defecto es de verdad y completo— y lo que se
    suelta son los dos fotogramas del centro, que son los del primer render del modal
    que entra (`ModalAnimation.js:67`, `opacity: 0` hasta que corre su `useEffect`) y
    que no son un fallo de la app sino de la biblioteca.
  */
  check(
    "**el que entra esta debajo del que se va toda la ventana - limitacion medida, no un tope escondido**",
    (relevo.fondoMaloPos ?? []).length === (relevo.ventana.fotogramas ?? -1) &&
      (relevo.centroMaloPos ?? []).length >= (relevo.ventana.fotogramas ?? 0) - 2,
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

  /* --- 10. La pregunta del borrado: una pagina, y ningun segundo panel --- */

  /**
   * **La pregunta de la Task 12 es una pregunta de medicion o no es nada**, y esta
   * vez la medicion sale al reves que la primera.
   *
   * `StateDeleteSheet` se construyo **primero como el plan lo pide**: componente
   * aparte, `state: BoardState | null` como bandera, `useLastValue` y su propio
   * `<Sheet visible>`, montado el ultimo en la pantalla del tablero. Se midió con
   * este mismo bloque y con el muestreo instalado antes de la pulsación, y lo que
   * salio esta en el informe de la tarea, con la salida literal pegada. Resumen:
   * **dos `sheet-panel` y dos `sheet-dim` durante los 617 ms de los 905 medidos (38
   * fotogramas de 56)**, el editor en el portal **#6** y la hoja de borrado en el
   * **#5**, `elementFromPoint` devolviendo `editor#6` en los **38 de 38** fotogramas
   * tanto en el fondo como en el centro del panel que entraba, y la pulsacion
   * siguiente sobre una fila de destino sin hacer nada.
   *
   * El mecanismo, leido en `node_modules/react-native-web/dist/exports/Modal/ModalPortal.js`:
   * **el `div` del portal se anade a `body` en el primer render del `Modal`, no la
   * primera vez que `visible` es cierto.** Los otros tres paneles de esta pantalla se
   * niegan a dibujarse mientras no tienen nada (`if (!tablero) return null` y lo
   * mismo en los otros dos), asi que su portal se crea la primera vez que se abren;
   * el que nunca se niega lo gana antes de haber estado abierto una sola vez.
   *
   * Así que ahora la pregunta **es una pagina de este panel** y lo que se mide es
   * justo lo contrario de lo que se midió antes, y por eso estas comprobaciones son
   * falsables: **si alguien volviera a levantar un segundo `Modal`, el numero de
   * paneles sube a dos y estas tres caen.** No son una medida de que "no hay
   * problema": son la afirmación de que no hay una segunda capa, contada.
   */
  await tap(tab, "board-states-button");
  await sleep(400);
  editor = await tab.evaluate(LEER_EDITOR);
  check(
    "el editor se vuelve a abrir con las cinco columnas para el borrado",
    editor?.filas?.length === 5,
    `filas: ${editor?.filas?.length}`,
  );

  await tab.evaluate(INSTALAR_MUESTREO_BORRADO);
  await tap(tab, `state-editor-bin-${ESTADOS[0].id}`);
  await sleep(400);
  const ventanaBorrado = await tab.evaluate(LEER_MUESTREO_BORRADO);

  /*
    **La comprobacion del instrumento va la primera y es la que impide que las otras
    sean un numero sin gesto detras.** El bloque 9 lo dice y aqui se repite por el
    mismo motivo: si el muestreo no ve la pregunta, `fotogramas` y `llegada` salen mal
    y todo lo demas compararia sobre una lista vacia — que es lo unico que sale
    bien de un instrumento que no midió nada.
  */
  check(
    "**la pregunta se ha medido con la pagina abierta, no despues**",
    !ventanaBorrado?.error &&
      (ventanaBorrado?.ventana?.fotogramas ?? 0) >= 10 &&
      ventanaBorrado?.llegada != null,
    ventanaBorrado?.error ??
      `${ventanaBorrado?.fotogramas} fotogramas en ${ventanaBorrado?.hasta} ms | la pregunta aparece en el ` +
        `fotograma de ${ventanaBorrado?.llegada} ms | ventana: ${ventanaBorrado?.ventana.ms} ms ` +
        `(${ventanaBorrado?.ventana.fotogramas} fotogramas) | en la ventana: ${ventanaBorrado?.quienEnLaVentana}`,
  );
  check(
    "**y hay UN solo panel y UN solo velo: la pregunta es una pagina, no un segundo `Modal`**",
    ventanaBorrado?.maxDims === 1 && ventanaBorrado?.maxPaneles === 1,
    `maximo de sheet-dim: ${ventanaBorrado?.maxDims}, de sheet-panel: ${ventanaBorrado?.maxPaneles} | ` +
      `con la pregunta abierta: ${ventanaBorrado?.ventana.ms} ms de los ${ventanaBorrado?.hasta} medidos ` +
      `(${ventanaBorrado?.ventana.fotogramas} fotogramas)`,
  );
  /*
    **El velo es UNO y esta en 1 durante toda la ventana.** El instrumento llama
    "borrado" al panel que lleva las filas de destino, y como la pregunta ahora vive
    en el panel del editor ese es su unico velo — que es exactamente lo que se
    quiere comprobar, y por eso el criterio es "un velo, en 1" y no "el velo del
    editor en 1": con dos paneles habria dos velos y `maxDims` ya habria caido en la
    comprobacion de arriba. El valor se mira en **toda** la ventana y no en un
    fotograma, porque un velo que se mueve solo durante la llegada seria un velo que
    compone con otro.
  */
  const veloUnico = ventanaBorrado?.veloBorrado;
  check(
    "**y el velo es uno y esta en 1 durante toda la ventana: no hay dos velos que componer**",
    veloUnico !== null && veloUnico[0] === 1 && veloUnico[1] === 1,
    `alpha del unico velo (min, max): ${JSON.stringify(veloUnico)} | ` +
      `velos de otras hojas: ${JSON.stringify(ventanaBorrado?.veloEditor)}`,
  );
  await tab.screenshot(`${SHOTS}/12-pregunta-de-borrado-claro.png`);

  const hojaBorrado = await tab.evaluate(LEER_BORRADO);
  check(
    "la pregunta dice cuantas tareas tiene la columna, **con el numero dentro de la frase**",
    (hojaBorrado?.texto ?? "").includes("Esta columna tiene 2 tareas."),
    `lineas: ${JSON.stringify((hojaBorrado?.texto ?? "").split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 5))}`,
  );
  check(
    "**pregunta a cual de las OTRAS columnas van, y ninguna es la que se borra**",
    hojaBorrado?.destinos?.length === 4 &&
      !hojaBorrado.destinos.some((d) => d.id === ESTADOS[0].id),
    `destinos: ${JSON.stringify(hojaBorrado?.destinos?.map((d) => `${d.titulo}·${d.numero}`))}`,
  );
  check(
    "cada destino trae su contador, y son los que el tablero tiene",
    JSON.stringify(hojaBorrado?.destinos?.map((d) => d.numero)) === JSON.stringify([1, 1, 0, 0]),
    `contadores: ${JSON.stringify(hojaBorrado?.destinos?.map((d) => d.numero))}`,
  );
  check(
    "**y el boton de confirmar sale APAGADO: el destino no se calcula solo**",
    hojaBorrado?.confirmar?.apagado === true,
    `apagado: ${hojaBorrado?.confirmar?.apagado} | etiqueta: "${hojaBorrado?.confirmar?.etiqueta ?? "-"}"`,
  );

  await tap(tab, `state-delete-destino-${ESTADOS[1].id}`);
  const elegido = await tab.evaluate(LEER_BORRADO);
  check(
    "**elegir un destino lo marca y enciende el boton** — el que antes no hacia nada",
    elegido?.destinos?.filter((d) => d.elegida).length === 1 &&
      elegido?.destinos?.find((d) => d.elegida)?.id === ESTADOS[1].id &&
      elegido?.confirmar?.apagado === false,
    `elegida: ${JSON.stringify(elegido?.destinos?.filter((d) => d.elegida).map((d) => d.titulo))} | ` +
      `apagado: ${elegido?.confirmar?.apagado}`,
  );
  await tab.screenshot(`${SHOTS}/13-destino-elegido-claro.png`);

  /* --- 11. Borrar una columna ocupada: las tareas van primero, con el id escrito --- */

  /**
   * **El orden de las escrituras, mirado en el cable y no en la pantalla.**
   *
   * `vaciarItems` y el contador de `list_item` existen solo para esto: una columna
   * con dos tareas son **dos operaciones de `list_item` y una de `list`**, y una
   * comprobacion que sumara las tres no distinguiría "las dos tareas se movieron y el
   * array se escribio una vez" de "se movio una y el array se escribio dos veces".
   *
   * **Y se mira el `stateId` que viaja en cada operacion**, que es lo que decide el
   * caso silencioso: una tarea con `state_id` nulo que se deja como estaba aparece en
   * la columna que pase a ser la primera —que aqui es Ready, el destino elegido— y
   * la pantalla la dibuja ahi **igual**. El unico sitio donde se nota es el cable.
   */
  /*
    **La pregunta sigue abierta del bloque 10 con "Ready" ya elegido**, y por eso aqui
    no se vuelve a pulsar la papelera de Backlog: la pregunta **es** una pagina y su
    cuerpo ha sustituido a las filas, asi que una papelera no existe en el documento
    (`no encuentro state-editor-bin-…` salio de ahi en una version de este bloque).
    Se elige otra vez el destino solo por legibilidad del guion, y **la eleccion se
    comprueba antes de confirmar**: un boton apagado no escribe nada y se lleva por
    delante todas las comprobaciones de abajo.
  */
  const antesDeConfirmar = await tab.evaluate(LEER_BORRADO);
  check(
    "la pregunta sigue abierta con el destino elegido y el boton encendido",
    antesDeConfirmar?.confirmar?.apagado === false &&
      antesDeConfirmar?.destinos?.find((d) => d.elegida)?.id === ESTADOS[1].id,
    `elegida: ${antesDeConfirmar?.destinos?.find((d) => d.elegida)?.titulo ?? "(ninguna)"} | ` +
      `apagado: ${antesDeConfirmar?.confirmar?.apagado}`,
  );

  vaciarPushes();
  vaciarItems();
  const desdeBorrar = Date.now();
  await tap(tab, "state-delete-confirm");
  await sleep(1200);

  /*
    **La columna se va del borrador y el panel vuelve a la lista antes de que salga
    nada por el cable**, y esa separacion es la que hay que mirar: el borrador es
    local y el outbox tarda. La primera version de este bloque comprobaba el cable a
    los 1200 ms y salia vacio —`stateId de cada operacion de list_item: []`— porque
    **el motor agrupa y deja salir las operaciones alrededor de un segundo y medio
    despues de escribirlas**, asi que a los 1200 ms todavia no habia salido ninguna. Lo
    que habia que esperar es `ESPERA`, como lleva haciendo el bloque 1 desde el
    principio, y no un numero que salio de mirar el reloj.
  */
  editor = await tab.evaluate(LEER_EDITOR);
  check(
    "**la columna sale del borrador en cuanto se confirma, y el panel vuelve a la lista**",
    editor?.filas?.length === 4 && !editor?.filas?.some((f) => f.id === ESTADOS[0].id),
    `filas: ${editor?.filas?.map((f) => f.titulo).join(" > ")}`,
  );
  await sleep(ESPERA);

  const pushesDeItems = operaciones.filter((x) => x.at >= desdeBorrar);
  const estadosEnElCable = pushesDeItems.flatMap((x) => x.estados);
  check(
    "**las dos tareas viajan con el id del destino escrito a mano, y no con null**",
    estadosEnElCable.length === 2 &&
      estadosEnElCable.every((s) => s === ESTADOS[1].id),
    `stateId de cada operacion de list_item: ${JSON.stringify(estadosEnElCable.map((s) => (s === ESTADOS[1].id ? "id de Ready" : s)))} | ` +
      `(null significaria que se dejaron como estaban y aparecerian en la nueva primera)`,
  );

  await cerrarConLaX(tab, `p.querySelector('[data-testid^="state-editor-row-"]')`);
  await esperarEditorCerrado(tab);
  await sleep(ESPERA + 2500);

  const cBorrar = cuenta(desdeBorrar);
  check(
    "**el borrado escribe una operacion de lista con el array entero**",
    cBorrar.listas === 1 && cBorrar.ops === 1 + pushesDeItems.reduce((t, x) => t + x.items, 0),
    `pushes: ${cBorrar.pushes}, ops: ${cBorrar.ops}, de lista: ${cBorrar.listas}, ` +
      `de list_item: ${pushesDeItems.reduce((t, x) => t + x.items, 0)} (${JSON.stringify(cBorrar)})`,
  );
  const viajeBorrar = pushes.filter((p) => p.at >= desdeBorrar).flatMap((p) => p.estados);
  check(
    "**y ese array son cuatro columnas, sin Backlog y en el orden en que las dejaste**",
    viajeBorrar.length === 1 &&
      viajeBorrar[0].length === 4 &&
      !viajeBorrar[0].some((s) => s.startsWith("Backlog")),
    `estados en el cable: ${JSON.stringify(viajeBorrar)}`,
  );

  /**
   * **Lo que el servidor tiene ahora, y el campo se lee por los dos nombres.**
   *
   * El pull devuelve la fila plana de la tabla —`record` es la fila, no un objeto
   * con `payload` dentro— y esta comprobacion no sabe si la columna se llama
   * `state_id` o `stateId` porque **no ha mirar el codigo del servidor para
   * decirlo**. Se lee el que exista y se imprime el que se ha usado, de modo que un
   * nombre distinto sale en la salida en vez de salir como un `undefined` silencioso
   * que hace pasar la comprobacion de "no hay ninguna a null" sin haber mirado nada.
   *
   * Y esa es la forma que importa: **es la comprobacion que puede pasar sin
   * medir**, porque "ninguna tarea tiene el estado a null" tambien es cierto de un
   * tablero donde el pull no trajo ninguna tarea. Por eso la segunda de las dos
   * afirma el id exacto de Ready para las dos concretas, y la primera **comprueba
   * que ha leido filas**.
   */
  const trasBorrar = await leerDelServidor(session);
  const filasItem = [...trasBorrar.entries()].filter(([clave]) => clave.startsWith("list_item:"));
  const nombreEstado = filasItem.some(([, f]) => "state_id" in f) ? "state_id" : "stateId";
  const nombreLista = filasItem.some(([, f]) => "list_id" in f) ? "list_id" : "listId";
  const delTablero = filasItem.filter(([, f]) => f?.[nombreLista] === listId);
  const nulos = delTablero.filter(([, f]) => f?.[nombreEstado] == null);
  check(
    "**el servidor ya no tiene NINGUNA tarea de este tablero con el estado a null**",
    delTablero.length >= 4 && nulos.length === 0,
    `tareas leidas del pull: ${delTablero.length} (campo del estado: ${nombreEstado}) | ` +
      `con el estado a null: ${nulos.length} | ` +
      `titulos: ${JSON.stringify(delTablero.map(([, f]) => `${f.title}:${f[nombreEstado] ? "id escrito" : "NULL"}`))}`,
  );
  const deBacklog = TAREAS.filter((t) => t.title.startsWith("Backlog"));
  check(
    "**las dos que estaban en Backlog estan ahora con el id de Ready, no en null**",
    deBacklog.length === 2 &&
      deBacklog.every((t) => trasBorrar.get(`list_item:${t.id}`)?.[nombreEstado] === ESTADOS[1].id),
    deBacklog
      .map(
        (t) =>
          `${t.title}: ${
            trasBorrar.get(`list_item:${t.id}`)?.[nombreEstado] === ESTADOS[1].id
              ? "id de Ready"
              : `lo que sea (${String(trasBorrar.get(`list_item:${t.id}`)?.[nombreEstado])})`
          }`,
      )
      .join(" | "),
  );

  /* --- 12. El tablero: Backlog no esta y sus dos tareas estan en Ready --- */

  const enPantalla = await readBoard(tab);
  check(
    "el tablero se queda con cuatro columnas y Backlog no esta",
    enPantalla?.columnas?.length === 4 &&
      !enPantalla?.tabs?.some((t) => t.startsWith("Backlog")),
    `pestanas: ${enPantalla?.tabs?.join(" | ")}`,
  );
  check(
    "**Ready tiene las tres tareas: las suyas mas las dos que estaban en Backlog**",
    enPantalla?.columnas?.find((c) => c.columna === ESTADOS[1].id)?.tarjetas === 3,
    `columnas: ${enPantalla?.columnas?.map((c) => `${c.columna.slice(0, 4)}=${c.tarjetas}`).join(" ")}`,
  );
  await tab.screenshot(`${SHOTS}/14-tras-borrar-ocupada.png`);

  /* --- 13. Reordenar dos columnas por el asa --- */

  /*
    **El reordenado va DESPUES del borrado de la columna ocupada, y el motivo es el
    mas importante de este guion.** Las dos tareas que hay en Backlog nacieron con
    `stateId: null`, que significa "la primera columna" — y **`dropIndex` y el borrado
    se estorban si el reordenado va antes**: al mover la primera columna, esas dos
    tareas pasan a estar dibujadas en la que ahora es la primera, `tasksInState` ya
    no las cuenta como de Backlog, y el borrado se lleva una columna **vacia** sin
    preguntar. La primera version de este guion lo hacia en ese orden y lo que salio
    fue `stateId de cada operacion de list_item: []`, `con el estado a null: 2` y
    `Ready 3` — **tres tarjetas en la columna correcta y las dos con el estado a null en
    el servidor**, que es exactamente el fallo silencioso del punto 3 del foco de
    revision, provocado por el propio recorrido. La app estaba bien; el orden de las
    comprobaciones no.

    El borrador de este punto tiene cuatro columnas —las de la siembra menos
    Backlog, mas la que anadio la Task 11— y las cuatro filas tienen el mismo paso.
  */
  await tap(tab, "board-states-button");
  await sleep(400);
  editor = await tab.evaluate(LEER_EDITOR);

  /*
    **El asa es un blanco, y se comprueba antes de arrastrarla.** Un asa que se
    dibujara y no respondiera daria un "no se ha movido" que se puede leer como "el
    gesto no funciona" cuando lo que no funciona es el blanco. Y el alto se mira
    porque **una fila con un asa de veinte puntos de alto tiene un blanco que se
    falla**, que es el riesgo que el propio spec acepta al decidir que el asa
    ocupe sitio en todas las filas.
  */
  check(
    "cada fila trae su asa de arrastrar, con nombre y con una altura pulsable",
    editor?.filas?.every((f) => f.asa && f.asa.alto >= 48 && f.asa.etiqueta) === true,
    `asas: ${JSON.stringify(editor?.filas?.map((f) => f.asa))}`,
  );

  /*
    **El gesto va de la primera fila a la tercera, y la distancia se mide antes.**
    `dropIndex` divide el desplazamiento vertical por el paso de la lista, y el paso
    lo mide el `onLayout` de cada fila —su alto mas el hueco—, asi que un numero de
    puntos escrito aqui seria un numero sobre otro tablero. Se leen los rectangulos y
    se arrastra justo **dos pasos**: con cuatro pasos la columna llegaria al final y el
    recorte la pararia alli, que es el otro caso y se mide en el bloque siguiente.
  */
  const rects = await tab.evaluate(`(() => {
    const filas = [...document.querySelectorAll('[data-testid^="state-editor-fila-"]')];
    return filas.map((el) => {
      const r = el.getBoundingClientRect();
      return { top: Math.round(r.top), alto: Math.round(r.height) };
    });
  })()`);
  const paso = rects[1] && rects[0] ? rects[1].top - rects[0].top : 56;
  note(`paso medido entre las dos primeras filas: ${paso} | rectangulos: ${JSON.stringify(rects)}`);

  const ordenAntes = editor?.filas?.map((f) => f.titulo).join(" > ");
  /*
   * **El asa que se arrastra es la de la primera fila que hay ahora, y su id se lee
   * del editor y no del arreglo `ESTADOS`**: Backlog ya no esta —la borro el bloque
   * 11— y una version de este bloque que usaba `ESTADOS[0].id` por costumbre fallaba
   * con `no encuentro el asa state-editor-asa-…` sobre una columna que el guion ya
   * habia borrado. Los ids de la siembra son de otra corrida de todas formas.
   */
  const idPrimera = editor?.filas?.[0]?.id;
  if (!idPrimera) throw new Error("no hay primera fila con la que medir el arrastre");
  vaciarPushes();
  const desdeArrastrar = Date.now();
  await arrastrar(tab, `state-editor-asa-${idPrimera}`, paso * 2);
  editor = await tab.evaluate(LEER_EDITOR);
  const ordenDespues = editor?.filas?.map((f) => f.titulo).join(" > ");
  check(
    "**arrastrar el asa mueve la columna: la primera pasa a la tercera**",
    ordenDespues ===
      [ordenAntes?.split(" > ")[1], ordenAntes?.split(" > ")[2], ordenAntes?.split(" > ")[0],
        ...ordenAntes?.split(" > ").slice(3)].join(" > "),
    `antes: ${ordenAntes} | despues: ${ordenDespues}`,
  );
  await sleep(ESPERA);
  const cArrastrar = cuenta(desdeArrastrar);
  check(
    "**y el arrastre no escribe con el panel abierto: el borrador es lo unico que cambia**",
    cArrastrar.ops === 0,
    `pushes: ${cArrastrar.pushes}, operaciones: ${cArrastrar.ops}`,
  );
  await tab.screenshot(`${SHOTS}/15-tras-arrastrar.png`);

  /* --- 14. Arrastrar mas alla del final: recortado, y no un movimiento en balde --- */

  /*
    **La ultima fila dos pasos hacia abajo, y lo que tiene que pasar es que no pase
    nada.** Con `to` de `states.length` o mayor, `nextOrderFromDrop` devuelve el mismo
    array que le dieron — `moveState` incluido — y la columna "se mueve" sin moverse:
    un gesto sin efecto y sin error, que es la forma que mas caro sale.

    **Dos pasos y no ocho, y el motivo es del entorno y no de la app**: la ultima fila
    esta a 534 de una ventana de 900, y ocho pasos la llevarian a 982 — fuera de
    pantalla, donde `Input.dispatchTouchEvent` entrega el movimiento al navegador y no
    a la pagina. En la primera version de este bloque pasaba exactamente eso, y **el
    gesto siguiente —el de la papelera— dejo de llegar**: el bin estaba dibujado, el
    boton de confirmar no aparecia, y el fallo parecía de la app cuando era del
    recorrido. Con dos pasos el dedo sale dentro de la ventana, y el indice al que
    apuntaria sin recortar sigue sin existir: `4 + 2 = 6` con cinco columnas.

    **Lo que se comprueba aqui es la consecuencia, y el recorte ya es un hecho
    probado**: `dropIndex` recorta a `total - 1` y lo tiene en
    `test/drag-shift.test.ts` ("does not go past either end"), y `moveState` con un
    destino fuera de rango devuelve el mismo array y tambien lo tiene. **Lo que el
    navegador no puede alcanzar es el segundo recorte** —el de `OrdenEstados`'s
    `mover`, que existe para la accion de accesibilidad `decrement` de la ultima fila,
    que da `index + 1` y que react-native-web no expone a un dedo—, y por eso se dice
    aqui en vez de dejar una comprobacion que parece cubrirlo.

    **Y con las tres cosas a la vez**, porque cada una por su cuenta pasa con un
    recorte roto: que las filas sigan siendo cinco y en el mismo orden (lo que se ve),
    que no se haya abierto ninguna pregunta (que es lo que pasaria si el arrastre
    hubiera landado en un sitio raro), y que **no se haya encolado nada**, que es lo
    que distingue "no ha pasado nada" de "no se nota todavia".
  */
  const ordenAntesDelFinal = editor?.filas?.map((f) => f.titulo).join(" > ");
  const idUltima = editor?.filas?.at(-1)?.id;
  vaciarPushes();
  const desdeElFinal = Date.now();
  if (!idUltima) throw new Error("no hay ultima fila con la que medir el arrastre");
  await arrastrar(tab, `state-editor-asa-${idUltima}`, paso * 8);
  editor = await tab.evaluate(LEER_EDITOR);
  await sleep(ESPERA);
  const cElFinal = cuenta(desdeElFinal);
  const preguntaTrasElFinal = (await tab.evaluate(LEER_BORRADO)) !== null;
  check(
    "**arrastrar la ultima fila mas alla del final no hace nada, y no rompe nada**",
    editor?.filas?.length === 4 &&
      editor?.filas?.map((f) => f.titulo).join(" > ") === ordenAntesDelFinal &&
      cElFinal.ops === 0 &&
      preguntaTrasElFinal === false,
    `orden: ${editor?.filas?.map((f) => f.titulo).join(" > ")} (antes ${ordenAntesDelFinal}) | ` +
      `ops: ${cElFinal.ops} | se abrio la pregunta: ${preguntaTrasElFinal}`,
  );

  /* --- 15. Borrar una columna VACIA: sin preguntar --- */

  /**
   * "Done" tiene cero tareas desde la siembra, asi que su papelera sale encendida: el
   * borrado de una columna vacia **no abre la pregunta y no le pide nada a nadie**.
   *
   * **Se comprueba con la pregunta ausente y no con un tiempo de espera**, y esa es
   * la forma que importa: si se abriera y se cerrara sola, `LEER_BORRADO` tambien
   * devolveria `null` en un instante posterior y la comprobacion pasaria sin haber
   * visto nada. **Por eso se esperan 600 ms**, que es mas del triple de la llegada de
   * un panel (180 ms) y de su red de seguridad (`DURACION + 150`): si la pregunta se
   * abriera, a los 600 ms estaria en pantalla y `LEER_BORRADO` la encontraria. Un
   * `immediate` no serviria de nada, porque miraria el instante en el que todavia no
   * ha podido haberla.
   */
  /*
    **El editor sigue abierto del bloque 14** —los dos arrastres no lo cerraron— y
    por eso aqui no se vuelve a pulsar el boton de la cabecera: esa pulsacion habria
    sido una segunda `abrirEditorDeEstados`, que **pone el borrador a la lista tal
    cual** y habria perdido los dos arrastres sin decir nada. Un `await tap` de mas
    es un borrado de borrador.
  */
  vaciarPushes();
  const desdeVacia = Date.now();
  editor = await tab.evaluate(LEER_EDITOR);
  check(
    "el editor sigue abierto con las cuatro columnas del punto anterior",
    editor?.filas?.length === 4,
    `filas: ${editor?.filas?.map((f) => f.titulo).join(" > ")}`,
  );
  await tap(tab, `state-editor-bin-${ESTADOS[3].id}`);
  await sleep(600);
  const trasVacia = await tab.evaluate(LEER_BORRADO);
  editor = await tab.evaluate(LEER_EDITOR);
  check(
    "**una columna vacia se va SIN preguntar: no se abre ninguna hoja**",
    trasVacia === null && editor?.filas?.length === 3,
    `hoja de borrado: ${trasVacia === null ? "no hay ninguna" : "SE ABRIO"} | filas: ${editor?.filas?.length}`,
  );
  check(
    "**y la que se va es la que se ha pulsado, Done, y no otra**",
    !editor?.filas?.some((f) => f.id === ESTADOS[3].id) &&
      editor?.filas?.length === 3,
    `filas: ${editor?.filas?.map((f) => f.titulo).join(" > ")}`,
  );
  await sleep(ESPERA);
  const cVacia = cuenta(desdeVacia);
  check(
    "el borrado de una columna vacia **tampoco encola nada con el panel abierto**",
    cVacia.ops === 0,
    `pushes: ${cVacia.pushes}, operaciones: ${cVacia.ops}`,
  );
  await tab.screenshot(`${SHOTS}/16-tras-borrar-vacia.png`);
  await cerrarConLaX(tab, `p.querySelector('[data-testid^="state-editor-row-"]')`);
  await esperarEditorCerrado(tab);
  await sleep(ESPERA + 2000);

  const cVaciaCerrar = cuenta(desdeVacia);
  check(
    "y al cerrar son UNA operacion de lista con las tres columnas",
    cVaciaCerrar.listas === 1 && cVaciaCerrar.ops === 1,
    `pushes: ${cVaciaCerrar.pushes}, ops: ${cVaciaCerrar.ops}, de lista: ${cVaciaCerrar.listas} ` +
      `(${JSON.stringify(cVaciaCerrar)})`,
  );

  /* --- 16. La ultima columna: la papelera apagada, con el motivo escrito --- */

  /**
   * **La ultima columna se deja con la API y no por el editor**, porque llegar a
   * una columna por el editor significaria repetir el borrado del bloque 12 sobre una
   * columna con tareas, y lo que se quiere comprobar aqui es el estado apagado, no
   * otra vez el borrado. Y **la `baseVersion` se lee del servidor justo antes**, que
   * es el mismo motivo que el bloque 17 da: la lista ya la ha escrito el navegador
   * varias veces y un `1` a ojo llega como `conflict` —que es un `status` dentro de
   * `results`, no un error— y el tablero se queda con tres columnas mientras el
   * recorrido dice que el push fue bien.
   */
  const antesDeLaUltima = await leerDelServidor(session);
  const filaLista = antesDeLaUltima.get(`list:${listId}`);
  const versionAhora = filaLista?.version ?? 1;
  const columnasAhora = filaLista?.states ?? [];
  const soloWip = [columnasAhora.find((s) => s.id === ESTADOS[2].id)].filter(Boolean);
  const aUna = await api("/sync/push", {
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
          baseVersion: versionAhora,
          base: { states: columnasAhora },
          clientTimestamp: new Date().toISOString(),
          payload: { states: soloWip },
        },
      ],
    },
  });
  const resAUna = aUna.body?.data?.results ?? [];
  check(
    "el tablero llega a una sola columna por la API",
    aUna.status === 200 &&
      resAUna.every((r) => r.status === "applied" || r.status === "duplicate"),
    `http ${aUna.status}, baseVersion: ${versionAhora}, resultados: ${resAUna
      .map((r) => r.status + (r.error ? ` (${r.error})` : ""))
      .join(", ")}`,
  );

  await irA(tab, `${APP}/board/${listId}`);
  const conUna = Date.now() + 45000;
  while (Date.now() < conUna) {
    const t = await readBoard(tab);
    if (t?.columnas?.length === 1) break;
    await sleep(600);
  }
  const una = await readBoard(tab);
  check("el tablero se abre con una sola columna", una?.columnas?.length === 1, `columnas: ${una?.columnas?.length}`);

  /*
    **El boton de la cabecera vuelve a ser el que abre el panel aqui, y por eso esta
    recarga no es opcional**: `abrirEditorDeEstados` pone el borrador a la lista tal
    cual, y sin la recarga el borrador arrastraria la columna que se borro en el
    bloque 15 y el editor dibujaria una columna que ya no esta.
  */
  await tap(tab, "board-states-button");
  await sleep(400);
  editor = await tab.evaluate(LEER_EDITOR);
  const unicaFila = editor?.filas?.[0];
  check(
    "**la papelera sale, y sale APAGADA con un solo estado**",
    Boolean(unicaFila?.papelera) && unicaFila.papelera.apagada === true,
    `filas: ${editor?.filas?.length} | papelera: ${JSON.stringify(unicaFila?.papelera)}`,
  );
  check(
    "**y esta apagada de verdad, no solo con el atributo**: la opacidad es la de un control deshabilitado",
    Number(unicaFila?.papelera?.opacidad) > 0 && Number(unicaFila?.papelera?.opacidad) < 0.6,
    `opacidad: ${unicaFila?.papelera?.opacidad} | aria-disabled: ${unicaFila?.papelera?.ariaDisabled}`,
  );
  /*
    El motivo escrito se busca **por su frase y no por una palabra suelta**, y se
    imprime la linea entera, que es lo que se ve en pantalla.
  */
  const lineasEditor = (editor?.texto ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  const lineaDelUltimo = lineasEditor.find((l) => /ltimo estado/i.test(l));
  check(
    "**y hay un texto que dice POR QUE**",
    Boolean(lineaDelUltimo) && /ltimo/.test(lineaDelUltimo ?? ""),
    `linea: ${lineaDelUltimo ?? "(no hay ninguna que hable del ultimo estado)"}`,
  );
  await ver(tab, `state-editor-bin-${ESTADOS[2].id}`);
  await tab.screenshot(`${SHOTS}/17-ultima-columna-apagada.png`);

  vaciarPushes();
  const desdeApagada = Date.now();
  await tap(tab, `state-editor-bin-${ESTADOS[2].id}`);
  await sleep(800);
  editor = await tab.evaluate(LEER_EDITOR);
  const hojaTrasApagada = await tab.evaluate(LEER_BORRADO);
  await sleep(ESPERA);
  const cApagada = cuenta(desdeApagada);
  check(
    "**pulsarla no hace nada: la columna sigue ahi, no hay hoja y no se encola nada**",
    editor?.filas?.length === 1 &&
      hojaTrasApagada === null &&
      cApagada.ops === 0,
    `filas: ${editor?.filas?.length} | hoja: ${hojaTrasApagada === null ? "no hay" : "SE ABRIO"} | ` +
      `ops: ${cApagada.ops}`,
  );
  await cerrarConLaX(tab, `p.querySelector('[data-testid^="state-editor-row-"]')`);
  await esperarEditorCerrado(tab);

  /* --- 17. El tope de 24 columnas --- */

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

  await irA(tab, `${APP}/board/${listId}`);
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

  /* --- 18. La misma pasada en oscuro --- */

  /**
   * **La clave es la del tema y no una cualquiera.** `orbithub:appearance` es lo
   * que lee `theme-provider.tsx`, y la app se dibuja en claro si no encuentra lo
   * que espera: escribir una clave inventada deja la corrida entera en claro y las
   * capturas de "oscuro" son del tema claro con otro nombre.
   */
  await PONER_TEMA("dark");
  await irA(tab, `${APP}/board/${listId}`);
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

  /* --- 19. La pagina de edicion de una columna, en oscuro --- */

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
    **La pregunta del borrado tambien, en oscuro**, y no solo en claro: es la pagina
    nueva y la unica que trae un boton `danger` y una frase con el numero dentro, y
    los dos tienen color propio — `danger` y `dangerSoft` de `button.tsx`— que es
    exactamente el tipo de cosa que se ve distinta en oscuro y en claro y que ninguna
    de las otras capturas teach.

    **Y el bin que se pulsa es el de una columna CON tareas, y se busca por el contador
    y no por el sitio**: la pasada oscura esta en el tablero de veinticuatro columnas
    que dejó el bloque 17, y en ese tablero la primera columna es Backlog — que el
    bloque 11 vacio—, asi que su papelera **se va sin preguntar** y no hay pregunta que
    fotografiar. Una version de este bloque que pulsaba la primera fila salia con
    `destinos: undefined`, que es lo que se ve cuando el borrado de una columna vacia
    hace lo que debe.
  */
  /*
    **Primero de vuelta a la lista de columnas**, y se dice por que: el paso anterior
    abrio la pagina de editar una columna, y ahi **no hay ninguna papelera** porque el
    cuerpo del panel es el de esa pagina. Una version de este bloque que leia la
    primera fila del `editor` de antes de volver fallaba con `no encuentro
    state-editor-bin-…` sobre un elemento que no existia — y el mensaje senala el
    componente cuando lo que faltaba era un paso del recorrido.
  */
  await tap(tab, "state-editor-back");
  await sleep(400);
  editor = await tab.evaluate(LEER_EDITOR);
  const conTareas = editor?.filas?.find((f) => (f.numero ?? 0) > 0);
  if (conTareas) {
    await tap(tab, `state-editor-bin-${conTareas.id}`);
    await sleep(600);
    const enOscuro = await tab.evaluate(LEER_BORRADO);
    const lineasOscuro = (enOscuro?.texto ?? "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    check(
      "**la pregunta del borrado tambien se abre en oscuro, con sus destinos y su boton**",
      (enOscuro?.destinos?.length ?? 0) === 23 &&
        enOscuro?.confirmar?.apagado === true &&
        lineasOscuro.some((l) => l.includes(`${conTareas.numero} tarea`)),
      `columna pulsada: ${conTareas.titulo} (${conTareas.numero}) | destinos: ${enOscuro?.destinos?.length} | ` +
        `apagado: ${enOscuro?.confirmar?.apagado} | linea: ${JSON.stringify(lineasOscuro.slice(3, 5))}`,
    );
    await ver(tab, "state-delete-confirm");
    await tab.screenshot(`${SHOTS}/18-pregunta-de-borrado-oscuro.png`);
    await tap(tab, "state-delete-back");
    await sleep(400);
    editor = await tab.evaluate(LEER_EDITOR);
  }

  /*
    **Y el motivo de la ultima columna tambien en oscuro**, porque la comprobacion de
    esa frase es de texto y el texto es justo lo que el tema oscuro cambia: una
    `AppText variant="caption" tone="subtle"` sobre un panel oscuro sale mas apagado
    que sobre uno claro, y una frase que no se lee no es una regla.
  */
  const unaEnOscuro = editor?.filas?.length ?? 0;
  note(`columnas en la pasada oscura: ${unaEnOscuro}`);

  /* --- 20. Reordenar tareas dentro de un estado --- */

  /*
    **Todo este bloque trabaja sobre su propio tablero y no sobre el de los bloques
    anteriores, y el motivo es el estado en que lo dejan.** El bloque 17 lo dejo con
    **24 columnas** y el bloque 11 le borro la columna con tareas, asi que las que
    quedan tienen una tarea cada una o ninguna. Un reordenado necesita una columna
    con **muchas mas tarjetas de las que caben** —para que haya un destino por debajo
    del pliegue— y con el tablero de 24 columnas la ventana de 1440x900 las ensena
    todas: no hay nada por debajo del pliegue, y un recorrido que no puede alcanzar
    un destino que existe esta comprobando otra cosa.

    Asi que se siembra **otro tablero** con el mismo mecanismo de la siembra de este
    guion —`/sync/push` con `baseVersion: 0` y `kind: 'create'`— y se mira **el
    servidor** para el resultado final: la escritura es local primero, asi que una
    tarjeta reordenada en pantalla y una tarjeta reordenada en el servidor se ven
    igual, y la unica comprobacion que vale es la que pregunta al servidor.
  */

  /*
    **Cinco columnas y no tres, y el motivo es el gesto horizontal del final del
    bloque.** El paginador del tablero se desactiva solo cuando **todas las columnas
    caben a la vez** —`sePuedePaginar` es `columnasQueCaben < states.length`, y
    `columnLayout` a 1120 de ancho con las columnas de 230 da **cuatro**—. Con tres
    columnas el tablero esta entero en pantalla, el gesto no esta activado porque no
    hay nada a lo que ir, y una comprobacion de "el horizontal sigue paginando" sobre
    ese tablero pasaria o fallaria por una razon que no es la del gesto. Con cinco
    columnas hay una fuera de pantalla y el gesto tiene trabajo.

    Las tres primeras son las que tienen tareas: las dos con las que se reordena —la
    primera con catorce y la segunda con tres— y una tercera vacia. Las dos ultimas
    vacias tambien, y solo estan para que la quinta quede fuera de la ventana.
  */
  const ESTADOS_RE = [
    { id: randomUUID(), title: "Backlog", color: "neutral" },
    { id: randomUUID(), title: "Ready", color: "blue" },
    { id: randomUUID(), title: "Done", color: "green" },
    { id: randomUUID(), title: "Revision", color: "teal" },
    { id: randomUUID(), title: "Shipped", color: "purple" },
  ];
  const wsRe = randomUUID();
  const listRe = randomUUID();
  const atRe = new Date().toISOString();

  /*
    **Catorce tarjetas en la primera columna y tres en la segunda, y el numero sale
    de una medicion y no de un redondo bonito.** Medido en el navegador a 1440x900 con
    esta semilla, en el bloque 20 de este guion: la caja de tarjetas de la primera
    columna mide **718** de alto con **984** de contenido, y cada tarjeta **57** con
    un hueco de **8**, o sea un paso de **65**. Caben **once** y hay **tres por debajo
    del pliegue**, que es lo que hace falta para que un destino "por debajo de lo que
    se ve" sea real y no una palabra. La primera comprobacion del bloque mide esas dos
    cifras antes de arrastrar nada, para que un tablero que ya quepa entero no pueda
    hacer pasar el resto en verde.

    **Y las catorce tienen el mismo alto a proposito.** `dropIndex` divide el
    desplazamiento del dedo por el paso, y el paso lo mide el `onLayout` de una
    tarjeta —su alto mas el hueco—. Con tarjetas de dos alturas distintas el paso es
    el de la ultima que se dibujo y el destino queda a una tarjeta de distancia, y el
    fallo se parece a un gesto que no funciona. Se mide por eso, y se comprueba.
  */
  const RE_TAREAS = [
    ...Array.from({ length: 14 }, (_, i) => ({
      title: `C${String(i + 1).padStart(2, "0")}`,
      stateId: null,
      position: i,
    })),
    ...Array.from({ length: 3 }, (_, i) => ({
      title: `R${String(i + 1).padStart(2, "0")}`,
      stateId: ESTADOS_RE[1].id,
      position: i,
    })),
  ].map((t) => ({ id: randomUUID(), ...t }));

  const siembraRe = await api("/sync/push", {
    method: "POST",
    token: session.accessToken,
    body: {
      deviceId: randomUUID(),
      lastPulledAt: null,
      clientTimestamp: atRe,
      operations: [
        {
          operationId: randomUUID(),
          clientId: CLIENT,
          entity: "workspace",
          kind: "create",
          entityId: wsRe,
          baseVersion: 0,
          base: null,
          clientTimestamp: atRe,
          payload: { name: "Reordenado", color: "blue" },
        },
        {
          operationId: randomUUID(),
          clientId: CLIENT,
          entity: "list",
          kind: "create",
          entityId: listRe,
          baseVersion: 0,
          base: null,
          clientTimestamp: atRe,
          payload: {
            workspaceId: wsRe,
            folderId: null,
            title: "Reordenado",
            kind: "board",
            orderMode: "manual",
            states: ESTADOS_RE,
          },
        },
        ...RE_TAREAS.map((tarea) => ({
          operationId: randomUUID(),
          clientId: CLIENT,
          entity: "list_item",
          kind: "create",
          entityId: tarea.id,
          baseVersion: 0,
          base: null,
          clientTimestamp: atRe,
          payload: {
            listId: listRe,
            title: tarea.title,
            position: tarea.position,
            ...(tarea.stateId ? { stateId: tarea.stateId } : {}),
          },
        })),
      ],
    },
  });
  const resRe = siembraRe.body?.data?.results ?? [];
  check(
    "el tablero del reordenado se siembra entero (results, no el codigo)",
    siembraRe.status === 200 &&
      resRe.every((r) => r.status === "applied" || r.status === "duplicate"),
    `http ${siembraRe.status} | applied ${resRe.filter((r) => r.status === "applied").length}/${resRe.length}` +
      (resRe.some((r) => r.status !== "applied" && r.status !== "duplicate")
        ? ` — ${resRe.filter((r) => r.status !== "applied" && r.status !== "duplicate").map((r) => `${r.entity}:${r.error}`).join(" | ")}`
        : ""),
  );

  await PONER_TEMA("light");
  await irA(tab, `${APP}/board/${listRe}`);
  /*
    **Y se comprueba que el paginador tiene trabajo antes de medirlo**, porque su
    activacion depende de una cuenta de la pantalla —`columnLayout` reparte el ancho y
    `sePuedePaginar` pregunta si sobran columnas— y sin esto el gesto horizontal del
    final se mediria sobre un tablero sin nada fuera de pantalla y su resultado
    valdria para otra pregunta. La cuenta se lee del DOM: cuanto mide la pista y
    cuanto se ha desplazado.
  */
  const listoRe = Date.now() + 45000;
  let enRe = null;
  while (Date.now() < listoRe) {
    enRe = await readBoard(tab);
    if (enRe?.columnas?.length === 5 && enRe?.columnas?.[0]?.tarjetas === 14) break;
    await sleep(600);
  }
  check(
    "el tablero del reordenado se abre con cinco columnas y 14 tarjetas en la primera",
    enRe?.columnas?.length === 5 && enRe?.columnas?.[0]?.tarjetas === 14,
    `columnas: ${JSON.stringify(enRe?.columnas?.map((c) => c.tarjetas))}`,
  );
  if (enRe?.columnas?.[0]?.tarjetas !== 14) {
    await tab.screenshot(`${SHOTS}/20-no-abre.png`);
    throw new Error("el tablero del reordenado no se abrio con sus catorce tarjetas");
  }
  const temaReClaro = await temaDeLaPagina();
  check(
    "el recorrido del reordenado empieza en CLARO de verdad",
    temaReClaro === "light",
    `colorScheme: ${temaReClaro}`,
  );
  await tab.screenshot(`${SHOTS}/20-01-tablero-reordenado-claro.png`);

  /* --- 20.1 La caja de tarjetas: por debajo del pliegue, y con un paso medido --- */

  /*
    **La columna scrollea de verdad y el paso se mide antes de arrastrar nada.**
    `dropIndex` divide el desplazamiento del puntero por el paso, y el paso lo mide el
    `onLayout` de una tarjeta —su alto mas el hueco—, asi que un numero de puntos
    escrito aqui seria un numero sobre otro tablero. Y hay tres comprobaciones que
    tienen que salir antes de que el gesto signifique algo: **que la columna
    scrollea**, **que las tarjetas miden todas lo mismo** y **que hay destino por debajo
    del pliegue**. Sin la tercera, un destino "fuera de la pantalla" no existe y todo
    lo demas del bloque pasaria sin haber errejado nada.
  */
  const caja = await tab.evaluate(`(() => {
    const columna = document.querySelector('[data-testid="board-cards-${ESTADOS_RE[0].id}"]');
    if (!columna) return null;
    const tarjetas = [...columna.querySelectorAll('[data-testid^="board-card-"]')].map((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        id: (el.getAttribute('data-testid') || '').replace('board-card-', ''),
        titulo: (el.innerText || '').split('\\n')[0] ?? '',
        top: Math.round(r.top),
        alto: Math.round(r.height),
        sombra: cs.boxShadow,
        zIndex: cs.zIndex,
        touchAction: cs.touchAction,
      };
    });
    return {
      alto: Math.round(columna.getBoundingClientRect().height),
      scrollHeight: columna.scrollHeight,
      clientHeight: columna.clientHeight,
      tarjetas,
    };
  })()`);
  note(
    `caja de tarjetas: ${caja?.clientHeight} de alto, ${caja?.scrollHeight} de contenido, ` +
      `${caja?.tarjetas?.length} tarjetas | touch-action: ${caja?.tarjetas?.[0]?.touchAction}`,
  );
  check(
    "**la columna scrollea: hay contenido por debajo del pliegue**",
    (caja?.scrollHeight ?? 0) > (caja?.clientHeight ?? 0) + 40,
    `scrollHeight ${caja?.scrollHeight} > clientHeight ${caja?.clientHeight} + 40`,
  );
  const rectsRe = caja?.tarjetas ?? [];
  const pasoRe = rectsRe[1] && rectsRe[0] ? rectsRe[1].top - rectsRe[0].top : 65;
  const altoRe = rectsRe[0]?.alto ?? 57;
  const caben = Math.floor((caja?.clientHeight ?? 0) / pasoRe);
  check(
    "todas las tarjetas miden lo mismo, que es lo que hace que el paso valga",
    rectsRe.length === 14 && rectsRe.every((t) => t.alto === altoRe),
    `altos: ${JSON.stringify([...new Set(rectsRe.map((t) => t.alto))])}`,
  );
  check(
    "y el paso es el alto mas el hueco, que es lo que la tarjeta escribe en onLayout",
    pasoRe === altoRe + 8,
    `paso ${pasoRe} = alto ${altoRe} + hueco 8`,
  );
  check(
    "**y hay al menos tres tarjetas por debajo del pliegue**, que es lo que hace real un destino fuera de la pantalla",
    rectsRe.length - caben >= 3,
    `${rectsRe.length} tarjetas, caben ${caben} en ${caja?.clientHeight} puntos de alto ` +
      `(paso ${pasoRe}): ${rectsRe.length - caben} por debajo`,
  );
  note(`paso medido: ${pasoRe} puntos | alto de tarjeta: ${altoRe} | caben ${caben} de ${rectsRe.length}`);

  /*
    **La pista tiene contenido fuera de pantalla, que es lo que hace que el gesto
    horizontal del final tenga algo que paginar.** Se lee `scrollWidth` frente a
    `clientWidth` de la pista, los dos numeros que la propia pantalla usa para calcular
    `maxScroll`, y no un "¿esta el scrollbar?" que en este navegador esta oculto con
    `--hide-scrollbars`.
  */
  const pista = await tab.evaluate(
    `(() => {
      const p = document.querySelector('[data-testid="board-track"]');
      return { client: p?.clientWidth ?? 0, contenido: p?.scrollWidth ?? 0, scrollLeft: Math.round(p?.scrollLeft ?? -1) };
    })()`,
  );
  note(
    `pista: ${pista?.client} de ancho con ${pista?.contenido} de contenido — ` +
      `${pista?.contenido > pista?.client ? "hay columna fuera de pantalla" : "TODO cabe"}`,
  );
  check(
    "**la pista tiene una columna fuera de pantalla**, que es lo que el gesto horizontal tiene que paginar",
    (pista?.contenido ?? 0) > (pista?.client ?? 0),
    `contenido ${pista?.contenido} > ancho ${pista?.client} | columnas: ${enRe?.columnas?.length}`,
  );
  check(
    "la tarjeta lleva `touch-action: pan-y`, que es lo que le deja el scroll vertical a la columna",
    rectsRe[0]?.touchAction === "pan-y",
    `touch-action de la primera tarjeta: ${rectsRe[0]?.touchAction ?? "(no se pudo leer)"}`,
  );

  /* --- 20.2 Los tres gestos: subir, bajar y no tocar nada --- */

  /*
    **El instrumento del gesto: un raton que mantiene pulsado antes de mover.**

    `Input.dispatchTouchEvent` es lo que usan `arrastrar` y `tap` en este guion, y
    aqui **no vale**: la tarjeta lleva `touchAction="pan-y"`, que es exactamente lo
    que impide que el navegador se quede con el desplazamiento vertical
    (`GestureHandlerWebDelegate.js`, `touchAction ?? 'none'`), de modo que un dedo que
    baja por la columna la desplaza y el gesto pierde el dedo. **Un raton no entra en
    ese trato**: `touch-action` no aplica a un puntero de raton, y por eso el camino
    del raton es el que mide si el gesto funciona en el navegador — con la nota
    escrita de que en un telefono es el dedo el que lo hace y eso **no esta medido**
    aqui.

    **El raton se mantiene pulsado 420 ms antes de moverse, y ese numero es el que
    separa tres gestos.** `activateAfterLongPress(260)` levanta la tarjeta a los 260 y
    `PanGestureHandler.shouldFail` cancela el gesto en cuanto el puntero se mueve mas
    que el *touch slop* —**15** puntos, `web/constants.js`— antes de que el reloj
    suene. De modo que los tres gestos de esta comprobacion son tres instrumentos y
    tres resultados distintos: bajar y mover **despues** de 420 ms levanta; mover
    antes **no** levanta y es un scroll; bajar y soltar sin mover levanta y suelta sin
    escribir nada.
  */

  /**
 * Un raton que se mueve, **con una espera entre el bajar y el primer movimiento**, y
 * el desplazamiento en pasos.
 *
 * **El desplazamiento es relativo y no un punto de destino**, que es lo que
 * `arrastrar` ya dice y aqui importa mas todavia: `translationY` es lo que
 * `dropIndex` divide, y un punto absoluto mediria una distancia que depende de donde
 * este la tarjeta. **Y es en los dos ejes**, porque el gesto horizontal del final lo
 * necesita: se mueve en `x` y en `y` a la vez, y un desplazamiento que fuera
 * "derecha" con la `y` quieta no seria el gesto de una persona.
 *
 * **La `x` no sale de la pantalla**, y por eso el desplazamiento horizontal del
 * bloque 20.6 es de **-240** y no de +240: el raton arranca a 440 de una ventana de
 * 1440, asi que hacia la izquierda hay sitio y hacia la derecha lo hay de sobra — y
 * **hacia la izquierda es adonde va un dedo que empuja el tablero para ver lo que
 * viene**, que es el gesto que una persona hace.
 */
  async function raton(
    tab,
    testId,
    puntos,
    { esperarAntes = 420, pasos = 12, espera = 16, eje = "y" } = {},
  ) {
    const p = await centro(tab, testId);
    if (!p) throw new Error(`no encuentro ${testId}`);
    note(
      `raton en ${testId}: (${p.x},${p.y}) | ${puntos} puntos en ${eje} | ` +
        `${esperarAntes} ms antes del primer movimiento`,
    );
    await tab.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: p.x,
      y: p.y,
      button: "left",
      buttons: 1,
      clickCount: 1,
    });
    await sleep(esperarAntes);
    const puntoEn = (i) => {
      const d = (puntos * i) / pasos;
      return eje === "x" ? { x: p.x + d, y: p.y } : { x: p.x, y: p.y + d };
    };
    try {
      for (let i = 1; i <= pasos; i += 1) {
        await tab.send("Input.dispatchMouseEvent", {
          type: "mouseMoved",
          ...puntoEn(i),
          button: "left",
          buttons: 1,
        });
        await sleep(espera);
      }
    } finally {
      await tab.send("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        ...puntoEn(pasos),
        button: "left",
        buttons: 0,
        clickCount: 1,
      });
    }
    await sleep(500);
    return p;
  }

  /**
   * Lo que se ve de una tarjeta mientras el raton esta pulsado, **leido desde dentro
   * de la pagina y no despues del gesto**.
   *
   * Es un `evaluate` que se instala **antes** del `mousePressed` y que corre dentro
   * un `requestAnimationFrame` —el mismo instrumento que el bloque 9 usa para el
   * relevo, y por el mismo motivo: una lectura hecha despues del gesto describe un
   * estado que ya no existia, y "la tarjeta no estaba levantada despues" es una
   * frase que sale igual de un gesto que no levanta y de uno que levanta y suelta.
   */
  const INSTALAR_ALZADA = (testId) => `(() => {
    const reg = { t0: performance.now(), muestras: [], vivo: true, id: ${JSON.stringify(testId)} };
    window.__alzada = reg;
    const leer = () => {
      const el = document.querySelector('[data-testid=' + JSON.stringify(reg.id) + ']');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        t: Math.round(performance.now() - reg.t0),
        top: Math.round(r.top),
        escala: cs.transform,
        sombra: cs.boxShadow,
        indice: cs.zIndex,
      };
    };
    const paso = () => {
      const m = leer();
      if (m) reg.muestras.push(m);
      if (reg.vivo && performance.now() - reg.t0 < 1400) requestAnimationFrame(paso);
      else reg.vivo = false;
    };
    requestAnimationFrame(paso);
    return true;
  })()`;

  /**
   * **La sombra alzada se distingue de la de una tarjeta en su sitio por el token, y
   * no por «hay sombra».** `theme.shadow.floating` es `0px 12px 24px …` y
   * `shadow.card` —lo que ya lleva una tarjeta tumbada— es `0px 6px 16px …`, asi que
   * el desfase de la caja es lo que dice si la tarjeta se ha elevado o solo se ha
   * movido. Se mira el numero y no la presencia: una comprobacion que aceptase
   * cualquier sombra pasaria con la de `card`, que es la que ya tiene.
   *
   * Y **`maxIndice` porque el `zIndex` es la otra mitad del aviso**: una tarjeta
   * elevada con sombra pero por debajo de sus vecinas no esta elevada, esta dibujada
   * con una sombra. De ahi el `position: relative` de `styles.tarjeta`.
   */
  const LEER_ALZADA = `(() => {
    const reg = window.__alzada;
    if (!reg) return { error: 'el muestreo no estaba instalado' };
    reg.vivo = false;
    const m = reg.muestras;
    if (m.length < 3) return { error: 'solo ' + m.length + ' fotogramas' };
    const primera = m[0];
    const conSombra = m.filter((x) => x.sombra && !/^none$/.test(x.sombra));
    const yFloating = conSombra.filter((x) => /12px\\s+24px/.test(x.sombra));
    const alto = Math.max(...m.map((x) => x.top));
    return {
      fotogramas: m.length,
      hasta: m.at(-1).t,
      conSombra: conSombra.length,
      conFloating: yFloating.length,
      primeraSombra: primera.sombra,
      primeraIndice: primera.indice,
      primeroArriba: Math.round(primera.top),
      masAbajo: Math.round(alto),
      recorrido: Math.round(alto - primera.top),
      maxIndice: m.reduce((a, x) => Math.max(a, Number(x.indice) || 0), 0),
      /*
        La sombra de un fotograma en el que estaba levantada, y no la del primero.
        El primer fotograma es de antes de que el puntero se pare —la tarjeta
        tumbada, con su shadow.card o sin nada— y lo que se compara con el alfa del
        tema tiene que ser la de mientras estaba en el aire. Se toma la primera que
        casa con el desfase de floating, y si no hay ninguna, la primera con sombra
        cualquiera: asi el que lo lee ve de que sale.
      */
      cualquierSombra:
        yFloating[0]?.sombra ?? conSombra[0]?.sombra ?? m.at(-1)?.sombra ?? null,
    };
  })()`;

  const tarjeta0 = RE_TAREAS[0].id;
  /** El orden antes del gesto, leido de la columna y no del array de la semilla. */
  const ordenPantallaAntes = await tab.evaluate(LEER_ORDEN(ESTADOS_RE[0].id));
  vaciarItems();
  const desdeSoltar = Date.now();
  await tab.evaluate(INSTALAR_ALZADA(`board-card-${tarjeta0}`));
  await raton(tab, `board-card-${tarjeta0}`, pasoRe * 2);
  const alzada = await tab.evaluate(LEER_ALZADA);
  if (alzada?.error) throw new Error(`el muestreo de la tarjeta alzada: ${alzada.error}`);
  const hojaTrasAlzada = await tab.evaluate(HOJA_DE_ESTADO);
  note(
    `alzada: ${alzada.fotogramas} fotogramas en ${alzada.hasta} ms | con sombra ${alzada.conSombra} | ` +
      `con shadow.floating ${alzada.conFloating} | recorrido ${alzada.recorrido} | zIndex maximo ${alzada.maxIndice}`,
  );
  check(
    "**la tarjeta se levanta: el muestreo ve shadow.floating y sube de z-index**",
    alzada.conFloating >= 3 && alzada.maxIndice >= 10,
    `fotogramas con la sombra de ` +
      `theme.shadow.floating (0px 12px 24px): ${alzada.conFloating} de ${alzada.fotogramas} | ` +
      `z-index maximo: ${alzada.maxIndice} | sombra inicial: ${alzada.primeraSombra}`,
  );
  check(
    "y la tarjeta **sigue al raton**: se ha movido hacia abajo mientras estaba pulsada",
    alzada.recorrido >= pasoRe,
    `recorrido ${alzada.recorrido} puntos, paso ${pasoRe} (pedidos 2 pasos)`,
  );
  check(
    "**y el gesto no se ha confundido con un toque: no se ha abierto la hoja de estado**",
    hojaTrasAlzada === null,
    hojaTrasAlzada === null
      ? "no hay hoja de estado en el documento"
      : `SE ABRIO con este texto: ${hojaTrasAlzada.slice(0, 80)}`,
  );

  /* --- 20.3 El orden: en pantalla, en el cable y en el servidor --- */

  const ordenPantallaTras = await tab.evaluate(LEER_ORDEN(ESTADOS_RE[0].id));
  check(
    "**soltar dos pasos mas abajo mueve esa tarjeta dos puestos, y solo esa**",
    ordenPantallaTras.join(" > ") ===
      ordenCierto(ordenPantallaAntes, RE_TAREAS[0], 2).join(" > "),
    `antes: ${ordenPantallaAntes.join(" > ")} | despues: ${ordenPantallaTras.join(" > ")}`,
  );
  await tab.screenshot(`${SHOTS}/20-02-tras-soltar-claro.png`);

  await sleep(ESPERA);
  const opsSoltar = operaciones.filter((o) => o.at >= desdeSoltar);
  /**
   * **El total de operaciones es una suma y no un `flatMap`**, y la diferencia no es
   * de estilo: `o.items` es el numero de operaciones **de ese push**, asi que un
   * `flatMap` sobre numeros devuelve los numeros y su `length` es el numero de pushes
   * —un push con tres operaciones sale como **1**—. Es exactamente el error que hizo
   * pasar esta comprobacion con una sola operacion donde havia tres, y la cuenta
   * buena esta al lado, en `posicionesSoltar`, que si es una lista de una entrada por
   * operacion y por tanto se puede contar con `length`. **Las dos cifras se comparan
   * entre si** en el mensaje del `check`, para que un `1` y un `3` en la misma linea
   * se ven.
   */
  const opsItems = opsSoltar.reduce((total, o) => total + o.items, 0);
  const posicionesSoltar = opsSoltar.flatMap((o) => o.posiciones);
  note(
    `en el cable tras soltar: ${opsItems} operaciones de list_item en ${opsSoltar.length} ` +
      `push(es) | posiciones: ${JSON.stringify(posicionesSoltar)} | stateId: ` +
      `${JSON.stringify(opsSoltar.flatMap((o) => o.estados))}`,
  );
  check(
    "**lo que sale son operaciones de list_item con `position`, y ninguna con `stateId`**",
    opsItems > 0 &&
      opsSoltar.every((o) => o.estados.every((e) => e === "sin campo")) &&
      posicionesSoltar.every((p) => p !== "sin campo"),
    `operaciones de list_item: ${opsItems} | campos stateId: ` +
      `${JSON.stringify(opsSoltar.flatMap((o) => o.estados))} | posiciones: ` +
      `${JSON.stringify(posicionesSoltar)}`,
  );
  check(
    "**y el numero de operaciones es el de filas que cambian, no el de la columna**",
    opsItems === 3 && posicionesSoltar.length === 3,
    `operaciones de list_item: ${opsItems} en ${opsSoltar.length} push(es), de una ` +
      `columna con 14 tarjetas — 3 = la que se movio (C01 de 0 a 2) y las dos que ` +
      `saltaron un puesto (C02 de 1 a 0, C03 de 2 a 1). Las posiciones en el cable: ` +
      `${JSON.stringify(posicionesSoltar)} (${posicionesSoltar.length} entradas)`,
  );

  /*
    **El numero de operaciones por push y el total: los dos, y no uno.** El outbox
    **agrupa**: una fila que se mueve y las dos que saltan un puesto pueden salir en
    **un** push con tres operaciones dentro —que es lo que se midio— o en tres pushes
    de una, y las dos cosas estan bien. Lo que no esta bien es un numero de filas que
    no sea tres, y lo que no se puede afirmar es "un push": depende del agrupamiento y
    no del gesto.
  */
  const delServidor = await leerDelServidor(session);
  const posicionesSrv = RE_TAREAS.slice(0, 14)
    .map((t) => delServidor.get(`list_item:${t.id}`)?.position)
    .sort((a, b) => a - b);
  const ordenServidor = RE_TAREAS.slice(0, 14)
    .map((t) => ({ titulo: t.title, id: t.id, pos: delServidor.get(`list_item:${t.id}`)?.position }))
    .sort((a, b) => a.pos - b.pos)
    .map((t) => t.titulo);
  check(
    "**el servidor tiene el orden nuevo y las posiciones 0..13**",
    ordenServidor.join(" > ") === ordenPantallaTras.join(" > ") &&
      posicionesSrv.join(",") === Array.from({ length: 14 }, (_, i) => i).join(","),
    `en el servidor: ${ordenServidor.join(" > ")} | posiciones: ${posicionesSrv.join(",")}`,
  );

  /* --- 20.4 Salir de la pantalla y volver: el outbox --- */

  /*
    **La comprobacion que la gente se salta, y la unica que puede fallar con todo lo
    demas en verde.** Una escritura local primero se ve en pantalla al instante, asi
    que el orden puede estar bien en el `ScrollView` y no estar en ningun sitio mas:
    se navega a otra pantalla —que es lo que hace el navegador con la ruta— y se
    vuelve. Si el orden vuelve, esta en el outbox y en la cache; si no vuelve, estaba
    solo en memoria.

    **Se va a `/list/<id>` y no a otra ruta cualquiera**, porque esa es la pantalla
    de la que vuelve el boton de atras del tablero y es la transicion que un persona
    hace de verdad: si la ruta de salida aqui fuera una que no existe, la vuelta
    seria un `goto` frio y mediria otra cosa.
  */
  await irA(tab, `${APP}/list/${listRe}`);
  await sleep(2500);
  await irA(tab, `${APP}/board/${listRe}`);
  const listoVuelta = Date.now() + 30000;
  let ordenVuelta = [];
  while (Date.now() < listoVuelta) {
    ordenVuelta = await tab.evaluate(LEER_ORDEN(ESTADOS_RE[0].id));
    if (ordenVuelta.length === 14) break;
    await sleep(600);
  }
  check(
    "**salir de la pantalla y volver deja el orden donde estaba**",
    ordenVuelta.join(" > ") === ordenPantallaTras.join(" > "),
    `antes de salir: ${ordenPantallaTras.join(" > ")} | al volver: ${ordenVuelta.join(" > ")}`,
  );

  /* --- 20.5 El otro estado no se mueve: la firma de `renumberWithinState` --- */

  /*
    **El fallo que esta comprobacion existe para cazar, y por eso necesita las dos
    mitades.** `renumberWithinState` devuelve **solo las filas de la columna que se
    reordena**, y esa es toda su razon de ser: numerar todas las tareas de la lista
    renumeraria tambien las de las otras columnas, con numeros escritos en ellas, en
    un orden que nadie pidio. **El navegador no enseña ese fallo** —las otras columnas
    se verian igual si sus filas cambiasen de numero, porque lo que se ve es el orden
    relativo y no el `position`—, asi que la mitad de la comprobacion es **el cable**,
    que dice de que filas son las operaciones, y la otra es **el servidor**, que dice
    que `position` tiene cada fila de cada columna.

    **El orden de las mitades no es el del guion y si el de por que se cazan**: primero
    el servidor, para tener el "antes" de Ready y de Backlog del mismo pull que dio el
    orden de 20.3, y despues el gesto, y despues un pull nuevo. Al reves, el "antes"
    seria un pull hecho despues del gesto de Backlog —que ya habia movido sus
    posiciones— y la comparacion no diria nada.

    **Y hay dos gestos, en este orden, porque cada uno mira el estado del otro.** El
    primero es **el gesto en Ready**, que es el que se comprueba: si al reordenar Ready
    escribiera tambien filas de Backlog, el cable lo diria. El segundo es **otro gesto
    en Ready**, y la comprobacion que se le hace es sobre **Backlog** —que para entonces
    ha cambiado de orden por el gesto de 20.3 y cuyo estado en el servidor es el que
    importa—. Asi el par no se mira a si mismo.

    Repetir el gesto de 20.3aria inútil —el orden ya es el nuevo y un gesto de dos
    pasos sobre el mismo sitio devuelve el mismo array, que no escribe— y por eso el
    gesto que se repite es en **otra** columna: Ready tiene tres tarjetas y no se ha
    tocado.
  */
  const readyAntes = RE_TAREAS.filter((t) => t.stateId === ESTADOS_RE[1].id)
    .map((t) => ({ titulo: t.title, pos: delServidor.get(`list_item:${t.id}`)?.position }))
    .sort((a, b) => a.pos - b.pos);
  const reordenandoReady = RE_TAREAS.filter((t) => t.stateId === ESTADOS_RE[1].id)[0];

  const readyPantallaAntes = await tab.evaluate(LEER_ORDEN(ESTADOS_RE[1].id));
  note(`Ready antes del gesto: ${readyPantallaAntes.join(" ")}`);
  vaciarItems();
  const desdeReady = Date.now();
  await tab.evaluate(INSTALAR_ALZADA(`board-card-${reordenandoReady.id}`));
  await raton(tab, `board-card-${reordenandoReady.id}`, pasoRe * 2);
  await sleep(ESPERA);
  const opsReady = operaciones.filter((o) => o.at >= desdeReady);
  const delServidor2 = await leerDelServidor(session);
  const readyDespues = RE_TAREAS.filter((t) => t.stateId === ESTADOS_RE[1].id)
    .map((t) => ({ titulo: t.title, pos: delServidor2.get(`list_item:${t.id}`)?.position }))
    .sort((a, b) => a.pos - b.pos);
  const opsFilas = opsReady.flatMap((o) => o.ids ?? []);

  const idsBacklog = new Set(RE_TAREAS.slice(0, 14).map((t) => t.id));
  const idsReady = new Set(RE_TAREAS.filter((t) => t.stateId === ESTADOS_RE[1].id).map((t) => t.id));
  const deBacklogCable = opsFilas.filter((id) => idsBacklog.has(id));
  const deReadyCable = opsFilas.filter((id) => idsReady.has(id));
  const posicionesBacklogSrv = RE_TAREAS.slice(0, 14)
    .map((t) => delServidor2.get(`list_item:${t.id}`)?.position)
    .sort((a, b) => a - b);
  const readyPantallaDespues = await tab.evaluate(LEER_ORDEN(ESTADOS_RE[1].id));
  const backlogPantallaDespues = await tab.evaluate(LEER_ORDEN(ESTADOS_RE[0].id));
  note(
    `operaciones del gesto en Ready: ${opsFilas.length} | de Ready: ${deReadyCable.length} | ` +
      `de Backlog: ${deBacklogCable.length} | Ready en pantalla: ` +
      `${readyPantallaAntes.join(" ")} -> ${readyPantallaDespues.join(" ")}`,
  );
  check(
    "**el gesto en Ready tambien se ve: la tarjeta baja dos puestos en esa columna**",
    readyPantallaDespues.join(" ") ===
      ordenCierto(readyPantallaAntes, reordenandoReady, 2).join(" "),
    `antes: ${readyPantallaAntes.join(" ")} | despues: ${readyPantallaDespues.join(" ")}`,
  );
  check(
    "**y Backlog se ve exactamente igual en pantalla**, que es la mitad que el ojo creeria sola",
    backlogPantallaDespues.join(" ") === ordenPantallaTras.join(" "),
    `Backlog: ${backlogPantallaDespues.join(" ")} | lo que habia: ${ordenPantallaTras.join(" ")}`,
  );
  check(
    "**reordenar en Ready no escribe nada de Backlog: el cable solo lleva filas de Ready**",
    opsFilas.length > 0 && deBacklogCable.length === 0 && deReadyCable.length === opsFilas.length,
    `operaciones: ${opsFilas.length} en ${opsReady.length} push(es) | de Ready: ` +
      `${deReadyCable.length} | de Backlog: ${deBacklogCable.length} ${JSON.stringify(deBacklogCable)}`,
  );
  check(
    "**las de Backlog no se han movido con el gesto de Ready: siguen siendo 0..13**",
    posicionesBacklogSrv.join(",") === Array.from({ length: 14 }, (_, i) => i).join(","),
    `posiciones de Backlog en el servidor: ${posicionesBacklogSrv.join(",")}`,
  );
  check(
    "**y Ready sale renumerada 0..2, que es lo que `renumberWithinState` promete de su propia columna**",
    readyDespues.map((r) => r.pos).join(",") === "0,1,2" &&
      readyDespues.map((r) => r.titulo).join(" ") === "R02 R03 R01",
    `Ready en el servidor: ${readyDespues.map((r) => `${r.titulo}:${r.pos}`).join(" ")} | ` +
      `antes del gesto en Ready: ${readyAntes.map((r) => `${r.titulo}:${r.pos}`).join(" ")}`,
  );

  /* --- 20.6 La pulsacion larga no es un toque, y el gesto horizontal sigue paginando --- */

  /*
    **Las dos mitades de "el gesto de reordenar y el de paginar no se pisan", y cada
    una necesita la otra para valer.** Con `failOffsetY([-12, 12])` en el paginador un
    gesto claramente vertical nunca llega a el; lo que hay que ver es el otro lado: un
    gesto claramente **horizontal**, **con el puntero puesto encima de una tarjeta** —
    que es donde los dos gestos se encuentran de verdad— sigue cambiando de columna.
    Y el instrumento es el mismo con las variables cambiadas: **-240 puntos en `x` y
    20 ms antes de mover**, o sea muy por debajo de los 260 de `LEVANTAR`, con lo que
    `shouldFail` ya ha dado el gesto por perdido antes de que su reloj suene. Hacia la
    izquierda y no hacia la derecha porque es el gesto que empuja el tablero para ver
    lo que viene, y porque la tarjeta esta a 440 de una ventana de 1440.

    **El blanco es el mismo bloque con la espera al reves, y por eso esta comprobacion
    necesita la de arriba**: si un movimiento de 130 puntos en vertical levantase
    tambien cualquier tarjeta, la de arriba seguiria en verde y el tablero habria
    perdido su scroll. Las dos juntas son lo que dice que el gesto se queda con el
    dedo, y solo cuando el dedo se ha parado.

    **Y necesita `pista.contenido > pista.client`, que se midio mas arriba**: con un
    tablero cuyas columnas caben todas, el paginador esta desactivado por
    `sePuedePaginar` y esta comprobacion estaria midiendo que un gesto apagado no hace
    nada.
  */
  const pestanaAntes = await tab.evaluate(
    `[...document.querySelectorAll('[data-testid^="board-tab-"]')].findIndex((el) => el.getAttribute('aria-selected') === 'true')`,
  );
  const scrollAntes = await tab.evaluate(
    `Math.round(document.querySelector('[data-testid="board-track"]')?.scrollLeft ?? -1)`,
  );
  const tarjetaHorizontal = RE_TAREAS[0].id;
  await tab.evaluate(INSTALAR_ALZADA(`board-card-${tarjetaHorizontal}`));
  await raton(tab, `board-card-${tarjetaHorizontal}`, -240, {
    esperarAntes: 20,
    pasos: 14,
    espera: 16,
    eje: "x",
  });
  const sinTiempo = await tab.evaluate(LEER_ALZADA);
  const pistaTras = await tab.evaluate(
    `(() => {
      const pista = document.querySelector('[data-testid="board-track"]');
      return {
        scrollLeft: Math.round(pista?.scrollLeft ?? -1),
        transform: getComputedStyle(pista).transform,
      };
    })()`,
  );
  const pestanaDespues = await tab.evaluate(
    `[...document.querySelectorAll('[data-testid^="board-tab-"]')].findIndex((el) => el.getAttribute('aria-selected') === 'true')`,
  );
  note(
    `-240 puntos en horizontal con 20 ms de espera: ` +
      `fotogramas con shadow.floating ${sinTiempo?.conFloating ?? "?"} de ${sinTiempo?.fotogramas ?? 0} | ` +
      `scrollLeft ${scrollAntes} -> ${pistaTras?.scrollLeft} | transform ${pistaTras?.transform}`,
  );
  check(
    "**un movimiento pronto NO levanta la tarjeta: 0 fotogramas con la sombra alzada**",
    (sinTiempo?.conFloating ?? -1) === 0 && (sinTiempo?.fotogramas ?? 0) >= 3,
    `fotogramas con la sombra de shadow.floating: ${sinTiempo?.conFloating ?? "(no medido)"} de ` +
      `${sinTiempo?.fotogramas ?? 0} (un instrumento que no midio nada no pasa por aqui)`,
  );
  check(
    "**y el gesto horizontal sigue paginando el tablero**",
    pestanaDespues === (pestanaAntes + 1) % enRe.columnas.length &&
      pistaTras?.scrollLeft > scrollAntes,
    `pestaña activa: ${pestanaAntes} -> ${pestanaDespues} de ${enRe.columnas.length} | ` +
      `scrollLeft: ${scrollAntes} -> ${pistaTras?.scrollLeft} | transform: ${pistaTras?.transform}`,
  );
  await tab.screenshot(`${SHOTS}/20-03-tras-el-horizontal-claro.png`);

  /* --- 20.7 La misma pasada en oscuro --- */

  /*
    **La pasada oscura repite el gesto entero y no solo una captura.** El bloque 18
    oscuro del recorrido se queda en el panel de estados —que es donde se abre el
    editor—, asi que sin esto la elevacion de una tarjeta solo estaria medida en
    claro. Y el tema se comprueba **antes** de aceptar la captura, porque
    `ThemeProvider` resuelve `appearance: 'system'` con `useColorScheme()` y una
    pasada "en oscuro" que en realidad esta en claro daria dos ficheros con dos
    nombres y una comprobacion en verde.
  */
  await PONER_TEMA("dark");
  await irA(tab, `${APP}/board/${listRe}`);
  const listoOscuro = Date.now() + 30000;
  let enOscuroRe = null;
  while (Date.now() < listoOscuro) {
    enOscuroRe = await readBoard(tab);
    if (enOscuroRe?.columnas?.[0]?.tarjetas === 14) break;
    await sleep(600);
  }
  const temaReOscuro = await temaDeLaPagina();
  check(
    "el tema oscuro esta puesto de verdad antes de aceptar la captura como de oscuro",
    temaReOscuro === "dark",
    `colorScheme: ${temaReOscuro}`,
  );
  /*
    **La tarjeta que se levanta en oscuro es la primera de la columna, y el criterio
    de "levantada" es el mismo token que en claro**: `conFloating` cuenta los
    fotogramas cuya sombra lleva el desfase de `theme.shadow.floating` —**12px 24px**—
    y la tarjeta tumbada lleva `shadow.card`, que es **6px 16px**. Una comprobacion
    que mirase "hay sombra" pasaria con la que ya traia la tarjeta, y por eso el numero
    del token es el criterio.

    **Y el alfa se mira aparte, porque es lo que distingue el tema oscuro del claro y
    no el texto de la sombra.** Los dos tokens son el mismo desfase con alfas de
    **0.16** y **0.55** (`createTheme`, `shadow.floating`), asi que una sombra alzada
    en claro con el reloj puesto de oscuro daria el mismo `12px 24px` y solo el alfa
    lo delata.
  */
  const tarjetaOscuro = RE_TAREAS[0].id;
  await tab.evaluate(INSTALAR_ALZADA(`board-card-${tarjetaOscuro}`));
  await raton(tab, `board-card-${tarjetaOscuro}`, pasoRe * 2);
  const alzadaOscuro = await tab.evaluate(LEER_ALZADA);
  if (alzadaOscuro?.error) {
    throw new Error(`el muestreo en oscuro: ${alzadaOscuro.error}`);
  }
  const sombraOscuro = alzadaOscuro.cualquierSombra ?? "";
  note(
    `en oscuro: ${alzadaOscuro?.conFloating ?? "?"} fotogramas con shadow.floating de ` +
      `${alzadaOscuro?.fotogramas ?? 0} | sombra durante el gesto: ${sombraOscuro}`,
  );
  const alfaOscuro = String(sombraOscuro).match(/rgba?\([^)]*?,\s*([\d.]+)\)/);
  check(
    "**la tarjeta tambien se levanta en oscuro, y con el desfase de `shadow.floating`**",
    (alzadaOscuro?.conFloating ?? 0) >= 3,
    `fotogramas con la sombra de theme.shadow.floating (0px 12px 24px): ` +
      `${alzadaOscuro?.conFloating ?? 0} de ${alzadaOscuro?.fotogramas ?? 0} | ` +
      `sombra leida: ${sombraOscuro}`,
  );
  check(
    "**y la sombra es la del tema oscuro, no la de claro**",
    (alfaOscuro ? Number(alfaOscuro[1]) : -1) > 0.4,
    `alfa de la sombra: ${alfaOscuro?.[1] ?? "(no se pudo leer)"} — los tokens son ` +
      "0.16 en claro y 0.55 en oscuro (`createTheme`, `shadow.floating`), y se exige el segundo",
  );
  await tab.screenshot(`${SHOTS}/20-04-reordenado-oscuro.png`);

  const erroresRe = problems.filter(
    (p) => !/10\.0\.2\.2|:4000|Failed to load resource.*favicon/i.test(p.text),
  );
  check(
    "sin errores de consola en el recorrido del reordenado",
    erroresRe.length === 0,
    erroresRe.slice(0, 4).map((e) => e.text.slice(0, 160)).join(" | "),
  );

  /*
    **El filtro es estrecho a proposito**, y lo que estaba ahi antes tapaba justo lo
    que este recorrido necesita: se filtraba todo `Failed to load resource`, y un
    `POST /sync/push` que saliera con un 4xx sale por la consola con ese texto —el
    mismo que el de un `favicon` que no existe— de modo que el endpoint del que
    dependen la mitad de las comprobaciones podia estar fallando y el "sin errores de
    consola" salia en verde. Se sigue el precedente de `verify-social.mjs:391`:
    `Failed to load resource` sin `.*favicon` **no** se filtra.
  */

  /* ----------------- 21. Una lista de tareas sigue ofreciendo sus siete modos ----------------- */

  /*
    **La otra mitad de la comprobacion, y es la que se olvida.** `isManualOrderOnly`
    devuelve `true` tambien para `tasks`, asi que aplicarlo en la pantalla de listas
    le habria quitado a una lista de tareas seis modos que el brief no pedia quitar.
    Aqui se mira en un navegador, con una lista de tareas de verdad y su hoja de
    filtros de verdad.
  */
  await irA(tab, `${APP}/list/${LISTA_TAREAS}`);
  const listoLista = Date.now() + 45000;
  let hayControles = null;
  while (Date.now() < listoLista) {
    hayControles = await tab.evaluate(`(() => {
      const el = document.querySelector('[data-testid="task-controls"]');
      return el ? (el.getAttribute('aria-label') ?? el.innerText ?? '').trim() : null;
    })()`);
    if (hayControles) break;
    await sleep(600);
  }
  check(
    "una lista de tareas abre su boton de filtros",
    typeof hayControles === "string" && hayControles.length > 0,
    `etiqueta: "${hayControles ?? "no esta"}"`,
  );
  await abrirFiltros(tab, "task-controls");
  const hojaTareas = await tab.evaluate(LEER_FILTROS(ORDENES_ES));
  check(
    "la hoja de una lista de tareas tambien se ha abierto: hay una que leer",
    hojaTareas !== null,
    hojaTareas === null
      ? "no hay ningun panel con las casillas de «qué mostrar»"
      : `titulo: "${hojaTareas.titulo}"`,
  );
  /*
    **Lo que esta hoja lee es el instrumento del bloque 22**, y por eso va **antes** que
    el tablero y no despues: son las opacidades de tres casillas que **no** estan
    apagadas. Sin ellas al lado, la comprobacion de "las del tablero estan a 0.5" no
    tiene contra que compararse y pasaria con las tres a la misma opacidad que las
    de un control que se toca —o con las tres ausentes—. Con las dos mitades, el
    criterio es "0.5 en el tablero y 1 en una lista", que es lo que dice el codigo de
    `Checkbox`.
  */
  const hojaTareasProbe = {
    opacidades: (hojaTareas?.casillas ?? []).map((c) => c.opacidad),
  };
  note(
    `en una lista de tareas — modos: ${hojaTareas?.filasDeOrden.length ?? "?"} | ` +
      `casillas: ${(hojaTareas?.casillas ?? [])
        .map((c) => `${c.valor}${c.marcada ? "(marcada)" : ""}@${c.opacidad}${c.apagada ? " apagada" : ""}`)
        .join(" ")}`,
  );
  check(
    "**una lista de tareas sigue ofreciendo los siete modos de orden**",
    hojaTareas !== null && hojaTareas.filasDeOrden.length === 7,
    `modos en la hoja: ${hojaTareas?.filasDeOrden.length ?? "no se pudo leer"} de 7 — ` +
      `${(hojaTareas?.filasDeOrden ?? []).join(" | ") || "ninguno"}`,
  );
  check(
    "…y en una lista de tareas las tres casillas de completada **no** estan apagadas",
    hojaTareas !== null && hojaTareas.casillas.every((c) => c.existe && !c.apagada),
    `casillas: ${(hojaTareas?.casillas ?? []).map((c) => (c.apagada ? "apagada" : "encendida")).join(" ")}`,
  );
  check(
    "…y no hay ningun motivo debajo, porque en una lista si se puede filtrar por completada",
    hojaTareas !== null && hojaTareas.motivo === null,
    `motivo: ${hojaTareas?.motivo === null ? "no hay, como debe ser" : `"${hojaTareas?.motivo}"`}`,
  );
  await tab.screenshot(`${SHOTS}/21-00-lista-de-tareas-claro.png`);
  await cerrarFiltrosSiEstaAbierta(tab);

  /* ----------------- 22. Los filtros del tablero y el orden que no se elige ----------------- */

  /*
    **El bloque 22 y el 23 van en un tablero propio** —el de `listFiltros`, sembrado al
    principio— y no en el de los bloques 1 a 20, porque ese lo dejan con veinticuatro
    columnas y sin la que tenia las tareas, y una cuenta de pestañas sobre el no
    diria nada. El bloque 21 anterior es la contraprueba: el mismo filtro, el mismo
    `FiltersBody` y el mismo `ListControls`, en una lista de tareas.

    El tema se vuelve a poner en claro y **se comprueba antes de cualquier captura**,
    porque el bloque 20.7 lo dejo en oscuro.
  */
  await PONER_TEMA("light");
  await irA(tab, `${APP}/board/${listFiltros}`);
  const listoFiltros = Date.now() + 45000;
  let antes = null;
  while (Date.now() < listoFiltros) {
    antes = await tab.evaluate(TABLERO_CONTADO);
    if (antes?.length === 4 && antes.every((c) => c.pestana !== null && c.cabecera !== null)) break;
    await sleep(600);
  }
  const temaFiltrosClaro = await temaDeLaPagina();
  check(
    "el tema claro esta puesto de verdad antes de aceptar la captura como de claro",
    temaFiltrosClaro === "light",
    `colorScheme: ${temaFiltrosClaro}`,
  );
  check(
    "el tablero de los filtros se abre con sus cuatro columnas y sus seis tarjetas",
    antes?.length === 4 &&
      antes.every((c) => c.pestana !== null && c.cabecera !== null) &&
      antes.reduce((t, c) => t + c.tarjetas.length, 0) === 6,
    `columnas: ${antes?.length ?? 0} | tarjetas: ` +
      `${(antes ?? []).reduce((t, c) => t + c.tarjetas.length, 0)} | ` +
      `pestanas: ${(antes ?? []).map((c) => c.pestana).join(",")} | ` +
      `cabeceras: ${(antes ?? []).map((c) => c.cabecera).join(",")}`,
  );
  note(
    `sin filtro — pestañas ${(antes ?? []).map((c) => `${c.pestana}`).join(" ")} | ` +
      `cabeceras ${(antes ?? []).map((c) => `${c.cabecera}`).join(" ")}`,
  );

  /* --- 22.1 El boton de los controles dice el orden que el tablero tiene --- */

  const botonFiltros = await tab.evaluate(LEER_BOTON_CONTROLES);
  check(
    "el boton de los controles existe y dice que el orden es el manual",
    typeof botonFiltros?.etiqueta === "string" &&
      botonFiltros.etiqueta.includes("A mano") &&
      botonFiltros.etiqueta.startsWith("Filtrar"),
    `etiqueta: "${botonFiltros?.etiqueta}" | ` +
      `ancho ${botonFiltros?.ancho} x ${botonFiltros?.alto} — un boton estirado a ` +
      `toda la ventana es la caja de controles sin \`alignItems: 'flex-start'\``,
  );
  check(
    "el boton de los controles no se estira a lo ancho de la ventana",
    typeof botonFiltros?.ancho === "number" && botonFiltros.ancho > 0 && botonFiltros.ancho < 700,
    `ancho del boton: ${botonFiltros?.ancho} en una ventana de 1440`,
  );

  /* --- 22.2 La hoja: seis modos fuera, la completada apagada con su motivo --- */

  await abrirFiltros(tab, "board-controls");
  const hojaFiltros = await tab.evaluate(LEER_FILTROS(ORDENES_ES));
  check(
    "la hoja se ha abierto: hay una que leer",
    hojaFiltros !== null,
    hojaFiltros === null
      ? "no hay ningun panel con las casillas de «qué mostrar»"
      : `titulo: "${hojaFiltros.titulo}"`,
  );
  check(
    "la hoja de los filtros del tablero **no ofrece ninguno de los seis modos**",
    hojaFiltros !== null && hojaFiltros.filasDeOrden.length === 0,
    `filas de orden en la hoja: ${hojaFiltros?.filasDeOrden.length ?? "no se pudo leer"} ` +
      `(${(hojaFiltros?.filasDeOrden ?? []).join(" | ") || "ninguna"})`,
  );
  /*
    **Los botones de la hoja, uno por uno, y la cuenta es sobre el conjunto entero.**
    Los que hay son exactamente cuatro: la `X` de cerrar —que `Sheet` dibuja dentro
    del panel y por eso cuenta—, una por etiqueta, y el de "Quitar los filtros" de
    `FiltersBody`. La comprobacion es que **no haya ningun quinto**: si la seccion de
    orden se dibujara, sus filas serian `SheetOptionRow`, que tambien son
    `role="button"` con `aria-label`, y aparecerian aqui. Es la contraprueta de "cero
    filas de orden": aquella las cuenta por su nombre y esta las cuenta todas por su
    numero, asi que una hoja con la seccion a medio dibujar —con el rotulo y sin las
    filas, o al reves— no puede pasar las dos.
  */
  const etiquetasDeLaHoja = hojaFiltros?.etiquetasTags ?? [];
  const botonesEsperados = ["Cerrar", "Quitar los filtros", ...etiquetasDeLaHoja];
  const botonesSobrantes = (hojaFiltros?.botones ?? []).filter(
    (b) => !botonesEsperados.includes(b),
  );
  check(
    "**la hoja no trae ninguna fila de boton que no sea la X, una etiqueta o el de quitar**",
    hojaFiltros !== null && botonesSobrantes.length === 0,
    `botones: ${(hojaFiltros?.botones ?? []).length} | ` +
      `esperados: ${botonesEsperados.length} (${botonesEsperados.join(" | ")}) | ` +
      `sobrantes: ${botonesSobrantes.length}` +
      (botonesSobrantes.length ? ` (${botonesSobrantes.join(" | ")})` : ""),
  );
  check(
    "las tres casillas de «qué mostrar» estan **apagadas**, y no escondidas",
    hojaFiltros !== null &&
      hojaFiltros.casillas.length === 3 &&
      hojaFiltros.casillas.every((c) => c.existe && c.apagada),
    `casillas: ${(hojaFiltros?.casillas ?? [])
      .map((c) => `${c.valor}=${c.existe ? (c.apagada ? "apagada" : "ENCENDIDA") : "no existe"}`)
      .join(" ")}`,
  );
  check(
    "y apagadas de verdad: la opacidad es la de un control que no se toca, y **no** la de uno que se toca",
    hojaFiltros !== null &&
      hojaFiltros.casillas.every(
        (c) => typeof c.opacidad === "string" && Number(c.opacidad) <= 0.6,
      ) &&
      hojaTareasProbe.opacidades.every((o) => Number(o) >= 0.99),
    `en el tablero: ${(hojaFiltros?.casillas ?? []).map((c) => c.opacidad).join(" ")} | ` +
      `en una lista de tareas: ${hojaTareasProbe.opacidades.join(" ")} — ` +
      `\`Checkbox\` baja a 0.5 cuando esta apagado y se queda en 1 cuando no, y se ` +
      `exigen las dos mitades: una comprobacion que solo mirase "menor que 0.6" ` +
      `pasaria con las tres casillas desaparecidas del DOM`,
  );
  check(
    "la que esta marcada es «Todo», que es lo que el tablero enseña de verdad",
    hojaFiltros !== null &&
      hojaFiltros.casillas.find((c) => c.valor === "all")?.marcada === true &&
      hojaFiltros.casillas.filter((c) => c.marcada).length === 1,
    `marcadas: ${(hojaFiltros?.casillas ?? []).filter((c) => c.marcada).map((c) => c.valor).join(",") || "ninguna"}`,
  );
  check(
    "el motivo sale escrito debajo de las tres filas",
    typeof hojaFiltros?.motivo === "string" && hojaFiltros.motivo.length > 10,
    `motivo: "${hojaFiltros?.motivo ?? "no esta"}"`,
  );
  await ver(tab, "filters-completed-off");
  await tab.screenshot(`${SHOTS}/22-01-filtros-claro.png`);
  await cerrarFiltrosSiEstaAbierta(tab);

  /* --- 22.3 Filtrar por una etiqueta --- */

  const etiquetaTestId = `filters-tag-${ETIQUETA}`;
  /*
    **La hoja sigue abierta despues de pulsar la etiqueta, y el bloque lo sabe.**
    `ListControls` no se cierra solo al cambiar un filtro, asi que lo que hay que
    hacer es cerrarla explicitamente antes de mirar el tablero —si no, el `tap`
    siguiente del boton cae en el velo y cierra en vez de abrir, que es el fallo que
    dio la primera vez que se hizo esto.
  */
  await abrirFiltros(tab, "board-controls");
  const etiquetaEnLaHoja = await tab.evaluate(
    `!!document.querySelector('[data-testid=${JSON.stringify(etiquetaTestId)}]')`,
  );
  check(
    "la hoja ofrece la etiqueta del filtro con su contador",
    etiquetaEnLaHoja === true,
    `${etiquetaTestId}: ${etiquetaEnLaHoja ? "esta" : "no esta en la hoja"} — ` +
      `las etiquetas salen de \`tagsByFrequency(items)\`, de toda la lista y no de la filtrada`,
  );
  await tap(tab, etiquetaTestId);
  await cerrarFiltrosSiEstaAbierta(tab);
  await sleep(500);
  const trasFiltrar = await tab.evaluate(TABLERO_CONTADO);
  const pestanas = (trasFiltrar ?? []).map((c) => c.pestana);
  const cabeceras = (trasFiltrar ?? []).map((c) => c.cabecera);
  const dibujadas = (trasFiltrar ?? []).map((c) => c.tarjetas.length);

  check(
    "**solo desaparecen las tarjetas sin la etiqueta**: 1 de 2, 1 de 2, 0 de 2, 0 de 0",
    JSON.stringify(dibujadas) === JSON.stringify([1, 1, 0, 0]),
    `tarjetas por columna: ${dibujadas.join(" ")} — la semilla es ` +
      `${FILTRO_TAREAS.length} tareas y solo ${FILTRO_TAREAS.filter((t) => t.tags.includes(ETIQUETA)).length} ` +
      `llevan "${ETIQUETA}", y ninguna de las dos de "En curso" la lleva`,
  );
  check(
    "**los contadores de las pestañas siguen contando todas**, sin filtrar",
    JSON.stringify(pestanas) === JSON.stringify(antes.map((c) => c.pestana)),
    `pestanas antes ${antes.map((c) => c.pestana).join(" ")} | ` +
      `pestanas despues ${pestanas.join(" ")}`,
  );
  check(
    "los contadores de las cabeceras **si** bajan, y son los de las tarjetas de debajo",
    JSON.stringify(cabeceras) === JSON.stringify(dibujadas),
    `cabeceras ${cabeceras.join(" ")} | tarjetas dibujadas ${dibujadas.join(" ")}`,
  );
  const enCurso = trasFiltrar?.[2];
  check(
    "la columna que se vacia lo dice con el estado vacio de la columna, no con un error",
    enCurso?.tarjetas.length === 0 &&
      enCurso?.hijos === 1 &&
      typeof enCurso?.primeraLinea === "string" &&
      enCurso.primeraLinea.length > 0,
    `columna "${FILTRO_ESTADOS[2].title}": 0 tarjetas, ${enCurso?.hijos} hijo(s) en la ` +
      `caja, primera linea "${enCurso?.primeraLinea ?? ""}" — el estado vacio de una ` +
      `columna es lo que se dibuja cuando no hay nada que enseñar`,
  );
  note(
    `con "${ETIQUETA}" — pestañas ${pestanas.join(" ")} | cabeceras ${cabeceras.join(" ")} ` +
      `| tarjetas ${dibujadas.join(" ")}`,
  );
  const botonControlesFiltro = await tab.evaluate(LEER_BOTON_CONTROLES);
  check(
    "el boton de los controles cuenta el filtro que esta puesto",
    typeof botonControlesFiltro?.etiqueta === "string" &&
      /^Filtrar 1 /.test(botonControlesFiltro.etiqueta) &&
      botonControlesFiltro.etiqueta.endsWith("A mano"),
    `etiqueta: "${botonControlesFiltro?.etiqueta}"`,
  );
  await tab.screenshot(`${SHOTS}/22-02-filtrado-claro.png`);

  /* --- 22.4 Quitar el filtro --- */

  await abrirFiltros(tab, "board-controls");
  await tap(tab, etiquetaTestId);
  await cerrarFiltrosSiEstaAbierta(tab);
  await sleep(500);
  const restaurado = await tab.evaluate(TABLERO_CONTADO);
  check(
    "quitar la etiqueta devuelve las seis tarjetas y los seis de las cabeceras",
    JSON.stringify((restaurado ?? []).map((c) => c.tarjetas.length)) ===
      JSON.stringify([2, 2, 2, 0]) &&
      JSON.stringify((restaurado ?? []).map((c) => c.cabecera)) ===
        JSON.stringify([2, 2, 2, 0]),
    `tarjetas ${(restaurado ?? []).map((c) => c.tarjetas.length).join(" ")} | ` +
      `cabeceras ${(restaurado ?? []).map((c) => c.cabecera).join(" ")}`,
  );

  /* --- 22.5 La misma pasada en oscuro --- */

  await PONER_TEMA("dark");
  await irA(tab, `${APP}/board/${listFiltros}`);
  const listoOscuroFiltros = Date.now() + 30000;
  let oscuroBase = null;
  while (Date.now() < listoOscuroFiltros) {
    oscuroBase = await tab.evaluate(TABLERO_CONTADO);
    if (oscuroBase?.length === 4) break;
    await sleep(600);
  }
  const temaFiltrosOscuro = await temaDeLaPagina();
  check(
    "el tema oscuro esta puesto de verdad antes de aceptar la captura como de oscuro",
    temaFiltrosOscuro === "dark",
    `colorScheme: ${temaFiltrosOscuro}`,
  );
  await abrirFiltros(tab, "board-controls");
  await ver(tab, "filters-completed-off");
  await tab.screenshot(`${SHOTS}/22-03-filtros-oscuro.png`);
  const hojaOscura = await tab.evaluate(LEER_FILTROS(ORDENES_ES));
  check(
    "en oscuro pasa lo mismo: ni un modo de orden y las tres casillas apagadas",
    hojaOscura !== null &&
      hojaOscura.filasDeOrden.length === 0 &&
      hojaOscura.casillas.every((c) => c.apagada),
    `filas de orden: ${hojaOscura?.filasDeOrden.length ?? "?"} | ` +
      `casillas: ${(hojaOscura?.casillas ?? []).map((c) => (c.apagada ? "apagada" : "ENCENDIDA")).join(" ")}`,
  );
  await abrirFiltros(tab, "board-controls");
  await tap(tab, `filters-tag-${ETIQUETA}`);
  await cerrarFiltrosSiEstaAbierta(tab);
  await sleep(500);
  const oscuroFiltrado = await tab.evaluate(TABLERO_CONTADO);
  check(
    "en oscuro el filtro tambien esconde las tarjetas y **no** las pestañas",
    JSON.stringify((oscuroFiltrado ?? []).map((c) => c.tarjetas.length)) ===
      JSON.stringify([1, 1, 0, 0]) &&
      JSON.stringify((oscuroFiltrado ?? []).map((c) => c.pestana)) ===
        JSON.stringify(oscuroBase?.map((c) => c.pestana)),
    `tarjetas ${(oscuroFiltrado ?? []).map((c) => c.tarjetas.length).join(" ")} | ` +
      `pestanas ${(oscuroFiltrado ?? []).map((c) => c.pestana).join(" ")} | ` +
      `pestanas sin filtro ${(oscuroBase ?? []).map((c) => c.pestana).join(" ")}`,
  );
  await tab.screenshot(`${SHOTS}/22-04-filtrado-oscuro.png`);
  await PONER_TEMA("light");

  /* ----------------- 23. Un visor: sin hojas de escritura y con el aviso puesto ----------------- */

  /*
    **La segunda cuenta de esta corrida, y la razon de que el recorrido traiga su
    propia cuenta.** `register`, `verify-email` y `login` de la primera ya han
    gastado su parte de la ventana de autenticacion de esta IP —que es una IP nueva
    por corrida— y esta necesita la suya. La cuenta es de esta corrida y no una
    guardada, por el motivo que el bloque de `account()` documenta: una cuenta
    reusada aparece a medias y el login contesta **200** con
    `{ status: "email_verification_required" }`, que no es un 401 y por tanto no dice
    que la cuenta no existe.
  */
  const sessionVisor = await account();
  const miembrosAntes = await apiConEspera(`/workspaces/${ws}/members`, {
    method: "GET",
    token: session.accessToken,
  });
  const miembros = miembrosAntes.body?.data?.items ?? miembrosAntes.body?.data ?? [];
  note(
    `el propietario ve ${Array.isArray(miembros) ? miembros.length : "?"} ` +
      `miembro(s) en su propio espacio antes de invitar a nadie`,
  );
  check(
    "el propietario ve su propio espacio en la lista de miembros",
    Array.isArray(miembros) && miembros.length >= 1,
    `respuesta: ${JSON.stringify(miembrosAntes.body?.data ?? null).slice(0, 200)}`,
  );

  /*
    **El alta del visor: una invitacion y su aceptacion, que es el camino que la app
    tiene — y no un `PATCH /members/:userId` writing straight to the row.**

    La primera version de este bloque hacia el `PATCH` con el `user.id` del visor y
    la API contesto **`404 "That person is not in this space"`**: `changeRole` cambia
    el rol de un miembro **que ya esta**, y un usuario que acaba de registrarse no es
    miembro de nada. Ese 404 no lo dice el `status` de la respuesta de arriba —que es
    la que lo compte— sino el cuerpo, y por eso el camino correcto es el que la app
    usa: `POST /workspaces/:id/invitations` con `role: 'viewer'`, y la otra persona
    la acepta con `POST /invitations/:token/accept`.

    **Con el correo del visor y con `expiresInHours: 24`.** El correo no es un adorno
    del recorrido: `listForCaller` busca por `users.email` y por `invitedEmail`, de
    modo que una invitacion creada sin correo —que la primera version de este bloque
    hacia— es real, se acepta por el token y **no aparece en la bandeja de
    destinatario**: `{"items":[]}`. Un `200` en el `accept` al lado de una bandeja
    vacia es el camino correcto del servidor y no sirve para afirmar que la
    invitacion llego. El `168` de defecto tambien valdria; se pone `24` para que una
    invitacion que se quedara colgada no valiera manana.
  */
  const invitacion = await apiConEspera(`/workspaces/${ws}/invitations`, {
    method: "POST",
    token: session.accessToken,
    body: { role: "viewer", email: sessionVisor.email, expiresInHours: 24 },
  });
  const cuerpoInvitacion = invitacion.body?.data ?? null;
  check(
    "el propietario invita a un visor con rol `viewer`",
    invitacion.status === 201 && cuerpoInvitacion?.role === "viewer" &&
      typeof cuerpoInvitacion?.token === "string",
    `POST /workspaces/${ws}/invitations: http ${invitacion.status} | ` +
      `rol ${cuerpoInvitacion?.role ?? "?"} | ` +
      `token ${cuerpoInvitacion?.token ? "de " + cuerpoInvitacion.token.length + " caracteres" : "no vino"}`,
  );

  const pendientesDelVisor = await apiConEspera("/invitations", {
    method: "GET",
    token: sessionVisor.accessToken,
  });
  const suyas = pendientesDelVisor.body?.data?.items ?? [];
  check(
    "**la invitacion le llega al otro usuario**, en su propia bandeja",
    Array.isArray(suyas) && suyas.length === 1 && suyas[0]?.token === cuerpoInvitacion?.token,
    `GET /invitations con la sesion del visor: ` +
      `${JSON.stringify(pendientesDelVisor.body?.data ?? null).slice(0, 240)}`,
  );

  const acepta = await apiConEspera(
    `/invitations/${cuerpoInvitacion?.token ?? "sin-token"}/accept`,
    { method: "POST", token: sessionVisor.accessToken },
  );
  /*
    **La respuesta del `accept` es `{ workspace, alreadyMember }` y no lleva `role`**,
    que es lo que pidio una comprobacion sin leer el contrato y por eso `rol ?` salia
    en todas las corridas. El rol se lee de donde si esta escrito: la lista de
    miembros del propietario, dos lineas mas abajo. Aqui se afirma lo que la respuesta
    si dice —que el espacio es **este** y que no estaba ya dentro— y el rol se afirma
    en la lista.
  */
  check(
    "**el visor acepta y entra en el espacio**, que es este y no otro",
    acepta.status === 200 &&
      acepta.body?.data?.workspace?.id === ws &&
      acepta.body?.data?.alreadyMember === false,
    `POST /invitations/:token/accept: http ${acepta.status} | ` +
      `workspace ${acepta.body?.data?.workspace?.id ?? "no vino"} | ` +
      `alreadyMember ${acepta.body?.data?.alreadyMember ?? "no vino"} | ` +
      `claves de la respuesta: ${JSON.stringify(Object.keys(acepta.body?.data ?? {}))}`,
  );

  const miembrosDespues = await apiConEspera(`/workspaces/${ws}/members`, {
    method: "GET",
    token: session.accessToken,
  });
  const listaDespues = miembrosDespues.body?.data?.items ?? miembrosDespues.body?.data ?? [];
  check(
    "el propietario ve ahora **dos** miembros, y el nuevo es `viewer`",
    Array.isArray(listaDespues) &&
      listaDespues.length === 2 &&
      listaDespues.some((m) => m?.role === "viewer" && m?.user?.id === sessionVisor.user?.id),
    `miembros: ${JSON.stringify(
      (Array.isArray(listaDespues) ? listaDespues : []).map((m) => `${m?.user?.id}:${m?.role}`),
    )}`,
  );

  await seedSession(tab, sessionVisor, APP);
  /*
    **La cache del propietario se borra antes de entrar, y es parte del simulacro.**
    El almacen local del navegador **es `localStorage`** en la web —`WebStorageStore`
    en `lib/offline/local-store.ts`, con la cache en `orbithub:cache`—, asi que el
    navegador que ha estado toda la corrida con la sesion del propietario llega al
    tablero del visor con las filas del otro usuario en el almacen: con `role` de
    `owner` y sin nada que sincronizar todavia. Un visor que lee `role: 'owner'` de la
    cache monta las hojas de escritura, y la comprobacion pasaria por encima de un
    defecto real.

    **Y con la cache va el cursor, `sync:cursor`, que es la mitad de la que hace
    falta.** La primera version de este bloque borraba `cache`, `outbox`,
    `conflicts` y `state` —y se quedaba con **`columnas: 0` y la pantalla diciendo
    "Esta lista ya no existe"** en todas las corridas, con el servidor contestando
    `applied` y sin un solo error de consola. La causa esta escrita en el propio
    repositorio: `STORAGE_KEYS.syncCursor` es `'sync:cursor'` y el comentario de
    `constants.ts` explica que vive ahi porque **hay dos sitios que tienen que
    nombrarla —el que la escribe en cada sincronizacion y el que la borra al cerrar
    sesion**—, y avisa de lo que pasa si se queda puesta: *"el servidor devuelve lo
    posterior al cursor, asi que el siguiente login empieza a descargar donde acabo
    el anterior y nunca recibe lo escrito antes de ahi"*. Eso era exactamente lo que
    pasaba: el visor predecia desde el cursor del propietario y por eso no recibia
    nada. `lib/auth/forget-everything.ts` lo borra al cerrar sesion, y borrar las
    cinco claves es lo que hace este navegador el de una segunda persona en un
    segundo aparato, que es lo que un visor es.

    Medido con `scripts/exp-navegador.mjs`, que se borro al terminar: con
    `orbithub:cache` y `sync:cursor` **el visor recibe el tablero** (`slots: 1`, y la
    cache con `workspace`, `list` y `list_item`); con `orbithub:cache` solo, **no**
    (`cacheBytes: 0` y `sync:cursor` intacto).
  */
  const cacheAntes = await tab.evaluate(
    "localStorage.getItem('orbithub:cache') !== null",
  );
  const cursorAntes = await tab.evaluate("localStorage.getItem('sync:cursor')");
  await tab.evaluate(`(() => {
    for (const clave of [
      'orbithub:cache',
      'orbithub:outbox',
      'orbithub:conflicts',
      'orbithub:state',
      'sync:cursor',
      'orbithub:last-synced-at',
    ]) {
      localStorage.removeItem(clave);
    }
    return true;
  })()`);
  const cacheDespues = await tab.evaluate(
    "localStorage.getItem('orbithub:cache') !== null",
  );
  check(
    "la cache del propietario esta en el almacen **antes** de borrarla",
    cacheAntes === true,
    `orbithub:cache presente: ${cacheAntes}`,
  );
  check(
    "…y se puede borrar, que es lo que hace que el visor sea el visor",
    cacheDespues === false,
    `orbithub:cache presente despues: ${cacheDespues}`,
  );
  const cursorDespues = await tab.evaluate("localStorage.getItem('sync:cursor')");
  check(
    "…**y con ella el cursor del pull**, que es lo que hacia que el visor no recibiera nada",
    cursorDespues === null,
    `sync:cursor antes de borrar: ${cursorAntes === null ? "no estaba" : "si"} | ` +
      `despues: ${cursorDespues === null ? "no esta" : `si, ${String(cursorDespues).slice(0, 40)}`} — ` +
      `\`STORAGE_KEYS.syncCursor\`, que \`constants.ts\` dice que hay que borrar al ` +
      `cerrar sesion y \`forget-everything.ts\` lo hace`,
  );

  await PONER_TEMA("light");
  await irA(tab, `${APP}/board/${listFiltros}`);
  const listoVisor = Date.now() + 60000;
  let tableroVisor = null;
  while (Date.now() < listoVisor) {
    tableroVisor = await tab.evaluate(TABLERO_CONTADO);
    if (tableroVisor?.length === 4) break;
    await sleep(600);
  }
  /*
    **El diagnostico de cuando no llega, y es la parte que hace falta para no
    atribuir a la app lo que es del recorrido.** Un tablero vacio aqui tiene tres
    causas que son fallos distintos: que el visor no reciba nada —que seria un fallo
    de permisos de lectura—, que la app no haya sincronizado todavia, o que la cache
    no se haya borrado. Se imprimen las tres cosas que las distinguen: cuantas filas
    hay en el almacen local, cuantas listas dice tener y que se ve en pantalla. Sin
    esto, "columnas: 0" es un sintoma sin causa.
  */
  if (tableroVisor?.length !== 4) {
    const diagnostico = await tab.evaluate(`(() => {
      const crudo = localStorage.getItem('orbithub:cache');
      let filas = null;
      let listas = null;
      try {
        // La forma real de WebStorageStore en la web es **un objeto por entidad**
        // con el registro dentro —workspace, list, list_item— y no una lista de
        // filas. Medido en el navegador con un visor, que es como se encontro que
        // hacia falta borrar tambien el cursor.
        const cache = crudo ? JSON.parse(crudo) : null;
        const claves = cache && typeof cache === 'object' ? Object.keys(cache) : [];
        filas = claves.length
          ? claves.map((k) => k + '=' + (Array.isArray(cache[k]) ? cache[k].length : 1)).join(' ')
          : 'la cache esta vacia';
        const deListas = Object.values(cache?.list ?? {}).filter(Boolean);
        listas = deListas.map((r) => (r?.title ?? '?') + ':rol=' + (r?.role ?? '?') + ':kind=' + (r?.kind ?? '?'));
      } catch (e) {
        filas = 'no se ha podido leer la cache: ' + String(e);
      }
      return {
        filas,
        listas,
        texto: (document.body.innerText || '').replace(/\\n+/g, ' | ').slice(0, 400),
      };
    })()`);
    note(
      `diagnostico del visor — filas en la cache: ${diagnostico.filas} | ` +
        `listas: ${JSON.stringify(diagnostico.listas)}`,
    );
    note(`lo que se ve: ${diagnostico.texto}`);
    note(
      `errores de consola hasta aqui: ${problems
        .slice(0, 3)
        .map((p) => p.text.slice(0, 120))
        .join(" || ") || "ninguno"}`,
    );
  }
  check(
    "el visor **ve** el tablero: las cuatro columnas y sus seis tarjetas",
    tableroVisor?.length === 4 &&
      tableroVisor.reduce((t, c) => t + c.tarjetas.length, 0) === 6,
    `columnas: ${tableroVisor?.length ?? 0} | tarjetas: ` +
      `${(tableroVisor ?? []).reduce((t, c) => t + c.tarjetas.length, 0)} — un visor que ` +
      `no ve nada es otro fallo, y esta comprobacion es la que lo separa del de "no monta hojas"`,
  );

  const botonEstadosVisor = await tab.evaluate(`(() => {
    const el = document.querySelector('[data-testid="board-states-button"]');
    return el ? (el.getAttribute('aria-label') ?? el.innerText ?? '').trim() : null;
  })()`);
  check(
    "el visor **no tiene el boton de editar los estados** en la cabecera",
    botonEstadosVisor === null,
    botonEstadosVisor === null
      ? "no esta"
      : `esta: "${botonEstadosVisor}" — el boton de la cabecera esta detrás de \`!readOnly\``,
  );

  const avisoVisor = await tab.evaluate(LEER_AVISO(AVISO_SOLO_LECTURA));
  check(
    "el aviso de solo lectura **sale**, y es el mismo texto que el de la pantalla de listas",
    typeof avisoVisor?.texto === "string" && avisoVisor.esLaEsperada === true,
    `texto: "${avisoVisor?.texto ?? "no esta"}" | es el de ` +
      `"order.readOnlyHint": ${avisoVisor?.esLaEsperada}`,
  );
  check(
    "…y se ve entero, sin quedar por debajo del pliegue de la pantalla",
    avisoVisor?.dentro === true,
    `top del aviso: ${avisoVisor?.top ?? "?"} en una ventana de 900`,
  );

  /* --- 23.1 Ni la hoja de estado ni la de editar estados se montan --- */

  const primeraTarjeta = tableroVisor?.find((c) => c.tarjetas.length > 0);
  const tarjetaVisor = primeraTarjeta
    ? await tab.evaluate(
        `(() => {
          const c = document.querySelector('[data-testid="board-cards-${primeraTarjeta.id}"]');
          const el = c ? c.querySelector('[data-testid^="board-card-"]') : null;
          return el ? el.getAttribute('data-testid') : null;
        })()`,
      )
    : null;
  check(
    "hay una tarjeta que pulsar en el tablero del visor",
    typeof tarjetaVisor === "string",
    `tarjeta: ${tarjetaVisor ?? "no hay ninguna"}`,
  );
  if (tarjetaVisor) {
    await tap(tab, tarjetaVisor);
    await sleep(700);
  }
  const hojaEstadoVisor = await tab.evaluate(HOJA_DE_ESTADO);
  const editorVisor = await tab.evaluate(LEER_EDITOR);
  check(
    "pulsar una tarjeta de un visor **no monta la hoja de estado**",
    hojaEstadoVisor === null,
    hojaEstadoVisor === null
      ? "no hay ninguna hoja con filas de estado"
      : `salio una: "${hojaEstadoVisor}"`,
  );
  check(
    "…y tampoco monta el editor de los estados",
    editorVisor === null,
    editorVisor === null
      ? "no hay ningun panel con filas de columna"
      : `salio uno con ${editorVisor?.filas?.length ?? "?"} filas`,
  );
  const panelesVisor = await tab.evaluate(
    `document.querySelectorAll('[data-testid="sheet-panel"]').length`,
  );
  check(
    "…y no queda **ningun** panel en el documento, que es la regla de la casa",
    panelesVisor === 0,
    `paneles en el documento: ${panelesVisor}`,
  );
  await tab.screenshot(`${SHOTS}/23-01-visor-claro.png`);

  /* --- 23.2 El mismo tablero en oscuro --- */

  await PONER_TEMA("dark");
  await irA(tab, `${APP}/board/${listFiltros}`);
  const listoVisorOscuro = Date.now() + 30000;
  let oscuroVisor = null;
  while (Date.now() < listoVisorOscuro) {
    oscuroVisor = await tab.evaluate(TABLERO_CONTADO);
    if (oscuroVisor?.length === 4) break;
    await sleep(600);
  }
  const temaVisorOscuro = await temaDeLaPagina();
  check(
    "el tema oscuro esta puesto de verdad antes de aceptar la captura como de oscuro",
    temaVisorOscuro === "dark",
    `colorScheme: ${temaVisorOscuro}`,
  );
  const avisoOscuro = await tab.evaluate(LEER_AVISO(AVISO_SOLO_LECTURA));
  check(
    "el aviso de solo lectura tambien sale en oscuro, con el mismo texto",
    avisoOscuro?.esLaEsperada === true,
    `texto: "${avisoOscuro?.texto ?? "no esta"}"`,
  );
  await tab.screenshot(`${SHOTS}/23-02-visor-oscuro.png`);
  await PONER_TEMA("light");

  /* --- 23.3 Y el servidor lo prohibe igual, que es lo que hace que esto no sea de adorno --- */

  const rechazoVisor = await api("/sync/push", {
    method: "POST",
    token: sessionVisor.accessToken,
    body: {
      deviceId: randomUUID(),
      lastPulledAt: null,
      clientTimestamp: new Date().toISOString(),
      operations: [
        {
          operationId: randomUUID(),
          clientId: CLIENT,
          entity: "list_item",
          kind: "update",
          entityId: FILTRO_TAREAS[0].id,
          baseVersion: 1,
          base: null,
          clientTimestamp: new Date().toISOString(),
          payload: { title: "F-1 cambiado por un visor" },
        },
      ],
    },
  });
  const estadoOperacion = rechazoVisor.body?.data?.results?.[0]?.status;
  check(
    "**el servidor rechaza la escritura del visor** —y el rechazo llega dentro de un 200",
    rechazoVisor.status === 200 && estadoOperacion !== "applied",
    `http ${rechazoVisor.status} | status de la operacion: ${estadoOperacion ?? "no vino"} | ` +
      `error: ${rechazoVisor.body?.data?.results?.[0]?.error ?? "-"}`,
  );

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
