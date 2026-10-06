#!/usr/bin/env node
/**
 * El recorrido del tablero en Android, que el spec de regresion exige para cada
 * pantalla nueva.
 *
 *   node scripts/verify-android-board.mjs
 *
 * ---
 *
 * **Por qué este fichero es un artefacto y no una carrera que se pueda citar.**
 *
 * `docs/superpowers/specs/2026-10-03-regresion-e2e-android-design.md` pide que cada
 * pantalla nueva llegue con su recorrido, y el tablero es una pantalla nueva. El
 * guion está escrito, con los mismos `testID` que el resto de los guiones, la misma
 * forma de sembrar y el mismo guardian de crasheo que `verify-android-screens.mjs`.
 *
 * **Y no se ha ejecutado, porque en esta maquina no hay ningun dispositivo.** Ni un
 * emulador arrancado ni un telefono: `adb devices` sale vacio. `AGENTS.md` dice que
 * no se afirme que algo funciona en Android sin haberlo corrido, y por eso este
 * fichero **no aporta ninguna evidencia sobre nativo** y su salida **no es un
 * verde**: sale con codigo 2 y con un texto que dice que no se ha corrido. Lo que
 * aporta es el recorrido escrito, con lo que mide y lo que no, para que quien tenga
 * un emulador lo corra y el resultado signifique algo.
 *
 * El guardian de crasheo y la comprobacion de "la pantalla ha cambiado" estan en
 * `verify-android-screens.mjs` con sus motivos escritos, y aqui se usan igual en vez
 * de reescribirlos: un boton que no hace nada y una app que se cierra se ven igual
 * desde fuera, asi que se mira el proceso **y** el hash de la pantalla. El segundo
 * es lo que hace que el primero signifique algo, y sin el el recorrido entero
 * puede pasar en verde con la app sin moverse de sitio.
 *
 * ---
 *
 * **Lo que este recorrido mide.**
 *
 * Que el tablero se abre con sus columnas, sus contadores y su primera pestaña
 * activa; que tocar una tarjeta abre la hoja de estado y que elegir otra columna la
 * mueve; que una pulsacion larga levanta una tarjeta y la suelta en otro sitio de su
 * columna; que un arrastre horizontal cambia de columna y que en el extremo no sale
 * de rango; que el editor de estados abre, anade una columna y cierra; que el filtro
 * por etiqueta vacia solo las tarjetas que no la llevan; y que **en ninguno de esos
 * pasos la app se cierra o relanza**, que es lo que un navegador no puede ver nunca.
 *
 * ---
 *
 * **Lo que NO mide, y que sale escrito en la salida y en el informe para que un
 * verde no lo insinúe.**
 *
 *   - **El asa de seleccion nativa.** La tarjeta tambien se levanta en la web —es el
 *     `shadow.floating` del tema—, asi que una elevacion medida en un navegador
 *     **no dice nada** del asa ni de su haptic. Medir "la tarjeta se eleva" es medir
 *     una sombra, y eso ya lo mide `verify-state-editor.mjs` en el navegador.
 *   - **El teclado del sistema** al escribir el nombre de un estado. `adb input text`
 *     escribe en un campo sin que el teclado aparezca nunca, de modo que un nombre
 *     escrito asi **no prueba que se pueda escribir con el dedo**: no mide el
 *     `returnKeyType`, ni el autofill, ni que el teclado tape el boton de anadir con
 *     el panel abierto. Ese es un hueco que solo se cierra con un dedo.
 *   - **La mitad del pulgar del gesto de reordenar.** `input swipe` teletransporta el
 *     puntero con un numero fijo de puntos y una duracion fija: mueve de A a B y no
 *     dice nada de como se siente. `Task 13` ya dejo escrito que **el pulgar no esta
 *     medido**, porque la distancia a la que una tarjeta "se recoge" depende de
 *     cuanto dedo haya en la pantalla y del `touch slop` del dispositivo. Lo que este
 *     recorrido afirma es que el gesto con teletransporte cambia el orden; lo que no
 *     puede es que una persona lo consiga con el dedo.
 *   - **El tiron para cerrar una hoja.** Lo anima el sistema operativo, no la app, y
 *     `input swipe` no lo dispara igual.
 *   - **El outbox en SQLite.** En nativo el almacenamiento local no es
 *     `localStorage` sino expo-sqlite, y el punto 4 del recorrido offline —que esta
 *     medido y en verde en `verify-board-offline.mjs`— es otro camino y otra base de
 *     datos. Nada de lo que dice ahi se aplica aqui sin volver a medirlo.
 *   - **Los inset del teclado y las barras del sistema.** `uiautomator` ve el arbol de
 *     accesibilidad, no los pixeles del inset.
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SHOTS = join(RAIZ, "capturas", "android", "tablero");
const INFORME = join(SHOTS, "informe.txt");
const ADB = process.env.ADB ?? join(process.env.HOME, "Library/Android/sdk/platform-tools/adb");
const PAQUETE = process.env.PAQUETE ?? "com.jrzlabs.orbithub";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const adb = (...args) =>
  execFileSync(ADB, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

function adbOk(...args) {
  try {
    return adb(...args);
  } catch {
    return "";
  }
}

/**
 * La semilla que el recorrido necesita, y **por que esta aqui y no sembrada por
 * el propio guion**.
 *
 * Una cuenta de la API sembrada por aqui no sirve: la app del dispositivo entra con
 * **su** sesion, y esa sesion no se pide con un `fetch` desde este proceso sin la
 * contrasena de una cuenta que ademas tendria que estar verificada. El spec de
 * regresion lo resuelve con `apps/mobile/e2e/seed/e2e-account.mjs`, que siembra la
 * cuenta y devuelve sus ids, y ese fichero **no existe todavia** —la fase 1 de ese
 * spec esta por implementar—. Asi que aqui se deja el hueco dicho y se escribe lo
 * que haria falta, en vez de inventar una sesion que no se puede tener.
 */
const SEMILLA = {
  estados: [
    { titulo: "Backlog", color: "neutral" },
    { titulo: "Ready", color: "blue" },
    { titulo: "WIP", color: "amber" },
    { titulo: "Done", color: "green" },
  ],
  tareasPorEstado: 3,
  /** La columna destino del movimiento del paso 3, y la que se borra en el 5. */
  moverA: "WIP",
  borrar: "Done",
};

/** Lo que un recorrido nativo no puede afirmar aunque salga entero en verde. */
const LO_QUE_NO_SE_COMPRUEBA = [
  "el asa de seleccion nativa: en web la tarjeta tambien se levanta (es el shadow del tema), asi que una elevacion medida ahi no dice nada del asa ni de su haptic",
  "el teclado del sistema: `adb input text` escribe sin que el teclado aparezca, de modo que no prueba que un nombre de estado se pueda escribir con el dedo, ni que el teclado tape el boton de anadir con el panel abierto",
  "la mitad del pulgar del gesto de reordenar: `input swipe` teletransporta el puntero, y Task 13 ya dejo dicho que la distancia a la que una tarjeta se recoge no esta medida con un dedo de verdad",
  "el tiron para cerrar una hoja: lo anima el sistema operativo y no la app",
  "el outbox en SQLite: en nativo el almacenamiento local no es localStorage, y el recorrido offline que si esta medido es de web",
  "los inset del teclado y las barras del sistema: `uiautomator` ve el arbol de accesibilidad, no los pixeles",
];

/**
 * Los 14 pasos **previstos** del recorrido, y **solo previstos**.
 *
 * La version anterior de este fichero imprimia `El recorrido tiene ${PASOS.length}
 * pasos` y el cuerpo tenia **cuatro** `await paso(...)`: tres eran precondiciones y
 * la cuarta solo miraba que no hubiera cero columnas. Un texto que anuncia 14 y un
 * cuerpo que ejecuta 1 es exactamente la clase de mentira que este guion existe para
 * no contar —un check que pasa sin medir es peor que no tener check—, asi que aqui
 * las dos cuentas van separadas y **la corrida sale en rojo mientras haya pasos sin
 * escribir** (`sinEscribir`, mas abajo). Que alguien con un emulador vea "13 SIN
 * ESCRIBIR" es la lectura correcta; un "4/4 PASA" no lo seria.
 *
 * Para escribir un paso de esta lista hace falta una sesion sembrada, y lo que falta
 * es `apps/mobile/e2e/seed/e2e-account.mjs` (ver `SEMILLA`). Los pasos que usen
 * `input swipe` **teletransportado** llevan eso en el nombre, porque `input swipe`
 * interpola un numero fijo de puntos entre dos coordenadas en un tiempo fijo: mueve
 * de A a B y no dice nada de como se siente el gesto, que es la mitad del pulgar que
 * `Task 13` dejo sin medir.
 *
 * **Los dos ayudantes que harian falta para escribirlos estaban aqui y se han
 * quitado** —`arrastre` con `input swipe` y `porTestId` con `input tap`—, porque no
 * los llamaba ningun paso y un ayudante sin ningun `paso()` que lo llame es codigo
 * que no llega a ejecutarse nunca. Vuelven cuando se escriban los pasos que los usan,
 * y no antes: dejarlos puestos hacia que un `grep` contara mas de lo que el fichero
 * hace.
 */
const PASOS_PREVISTOS = [
  "el tablero se abre con sus cuatro columnas",
  "la primera pestaña esta activa y los contadores son los de las tarjetas",
  "tocar una tarjeta abre la hoja de estado",
  "elegir otra columna la mueve y no la duplica",
  "una pulsacion larga levanta la tarjeta (teletransportada)",
  "soltarla en otro sitio cambia el orden de su columna",
  "la otra columna no se ha movido",
  "un arrastre horizontal cambia de columna (teletransportado)",
  "en la ultima columna un arrastre mas no sale de rango",
  "el editor de estados abre con una fila por columna",
  "anadir un estado lo crea y el tablero lo cuenta",
  "cerrar el editor no relanza la app",
  "filtrar por etiqueta vacia solo las tarjetas que no la llevan",
  "volver de la pantalla y entrar otra vez deja el tablero igual",
];

/**
 * Los tres pasos que el cuerpo **si** ejecuta y que **no** son ninguno de los 14
 * previstos: arrancar la app y mirar que existen los dos contenedores.
 *
 * Van aparte porque contarlos como pasos del recorrido es lo que hacia que cuatro
 * `await paso()` parecieran catorce pasos medidos.
 */
const PRECONDICIONES = [
  "arranque: se lanza la app y el guardian mira el pid y el buffer de crash",
  'la pantalla del tablero esta: aparece "board-screen"',
  'la tira de pestañas esta: aparece "board-tabs"',
];

/* ------------------------------------------------------------------ el guardian */

const pid = () => adbOk("shell", "pidof", PAQUETE).trim().split(/\s+/)[0] || null;

const crashes = () =>
  adbOk("logcat", "-d", "-b", "crash", "-v", "brief")
    .split("\n")
    .filter((l) => /FATAL EXCEPTION|JavascriptException/.test(l));

/**
 * El arbol de accesibilidad, y de el dos cosas: un hash para saber si la pantalla
 * **ha cambiado**, y el XML para buscar `testID` y `bounds`.
 *
 * El hash es la mitad de la comprobacion que hace que el proceso signifique algo.
 * `verify-android-screens.mjs` lo cuenta con sus palabras: un boton que no hace nada
 * y una app que se cierra se miran igual desde fuera, de modo que el proceso por si
 * solo no prueba nada. Seis pasos seguidos con el mismo hash **no han hecho nada**,
 * y eso es un fallo aunque no haya habido crasheo.
 */
function arbol() {
  try {
    adb("shell", "uiautomator", "dump", "/sdcard/_tablero.xml");
    const xml = adb("exec-out", "cat", "/sdcard/_tablero.xml");
    const textos = [...xml.matchAll(/text="([^"]{1,80})"/g)].map((m) => m[1]).filter(Boolean);
    const clases = [...xml.matchAll(/class="([^"]+)"/g)].map((m) => m[1]);
    return {
      xml,
      hash: createHash("sha1").update(textos.join("|") + clases.join("|")).digest("hex").slice(0, 8),
      nombre: textos.slice(0, 3).join(" · ") || "(sin texto)",
      total: textos.length,
    };
  } catch {
    return { xml: "", hash: "ilegible", nombre: "(ilegible)", total: 0 };
  }
}

/**
 * Un nodo por su `testID`, leyendo tres sitios y no uno.
 *
 * React Native escribe los `testID` como `resource-id` en la vista nativa y como
 * `content-desc` en el nodo accesible, y los dos se miran porque hay controles que
 * solo aparecen en uno: un boton con etiqueta y sin texto —el del menu, el de cerrar—
 * no se encuentra **nunca** leyendo solo `text`. Es la misma leccion que esta escrita
 * en `donde()` de `verify-android-screens.mjs`.
 */
function nodo(testId) {
  const { xml } = arbol();
  if (!xml) return null;
  const patrones = [
    `resource-id="[^"]*${testId}"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`,
    `content-desc="[^"]*${testId}[^"]*"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`,
    `text="[^"]*${testId}[^"]*"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`,
  ];
  for (const patron of patrones) {
    for (const m of xml.matchAll(new RegExp(patron))) {
      const [, x1, y1, x2, y2] = m.map(Number);
      if (x2 <= x1 || y2 <= y1) continue;
      return { x: Math.round((x1 + x2) / 2), y: Math.round((y1 + y2) / 2), w: x2 - x1, h: y2 - y1 };
    }
  }
  return null;
}

/** Cuantos nodos hay con un `testID` que empieza por un prefijo. */
const cuantos = (prefijo) => {
  const { xml } = arbol();
  const patron = new RegExp(`(?:resource-id|content-desc)="[^"]*${prefijo}[^"]*"`, "g");
  return [...xml.matchAll(patron)].length;
};

/**
 * Los numeros de las cuatro columnas: **las del contador de la cabecera y las de las
 * tarjetas de debajo**, leidos del XML y no de la cuenta de columnas.
 *
 * Antes de esto, el paso se llamaba "hay una tarjeta por columna y sus contadores" y
 * **no leia ningun contador**: la accion era `cuantos("board-slot-") === 0` y el
 * nombre prometia dos cosas que no se median. Aqui se leen de verdad, por el sufijo
 * del `testID` —`board-count-<stateId>`, `board-card-<itemId>`— y se comparan con la
 * cuenta de la semilla, que es la unica referencia disponible sin conocer los ids:
 * `SEMILLA.estados.length` columnas y `SEMILLA.tareasPorEstado` tarjetas en cada una.
 *
 * `esperarCambio: false` en este paso **no es "no comprobar"**: es comprobar lo
 * contrario, que la pantalla no se ha movido sola. Y el hash de antes y despues lo
 * dice si se movio.
 */
function columnasYContadores() {
  const { xml } = arbol();
  if (!xml) return { ok: false, detalle: "el volcado de accesibilidad esta vacio" };

  /**
   * Los `testID` que empiezan por un prefijo, devueltos **sin el prefijo** y sin
   * repetir: el sufijo es el id del estado o del elemento, que es lo unico por lo
   * que se puede emparejar una columna con su contador.
   */
  const conPrefijo = (prefijo) => {
    const vistos = new Set();
    for (const m of xml.matchAll(new RegExp(`(?:resource-id|content-desc)="([^"]*${prefijo}[^"]*)"`, "g"))) {
      vistos.add(m[1].slice(m[1].indexOf(prefijo) + prefijo.length));
    }
    return [...vistos];
  };

  const estados = conPrefijo("board-slot-");
  const columnasEsperadas = SEMILLA.estados.length;
  if (estados.length !== columnasEsperadas) {
    return {
      ok: false,
      detalle:
        `columnas: ${estados.length} | las que pide la semilla: ${columnasEsperadas} — ` +
        "con la app sin sembrar esta es la lectura correcta, no un tablero roto",
    };
  }

  /**
   * El numero de `board-count-<stateId>`, leido del atributo `text` del nodo.
   *
   * Sale `null` y **no `0`** cuando no hay un unico nodo o su texto no es un numero:
   * un `0` aqui seria un contador que nadie ha mirado, leido como una columna vacia.
   */
  const numeroDeCabecera = (estado) => {
    const nodos = [...xml.matchAll(new RegExp(`<node[^>]*board-count-${estado}[^>]*>`, "g"))];
    if (nodos.length !== 1) return null;
    const texto = nodos[0][0].match(/\stext="([^"]*)"/)?.[1] ?? "";
    return /^\d+$/.test(texto) ? Number(texto) : null;
  };

  const porEstado = estados.map((estado) => ({ estado, pintado: numeroDeCabecera(estado) }));
  const ilegibles = porEstado.filter((c) => c.pintado === null);
  if (ilegibles.length) {
    return {
      ok: false,
      detalle:
        "columnas sin un contador legible, y sale como fallo y no como 0: " +
        ilegibles.map((c) => c.estado.slice(0, 8)).join(", "),
    };
  }

  /*
    **Las tarjetas de todo el tablero, y por suma y no por columna.** El `testID` es
    `board-card-<itemId>` y **no lleva el estado**, asi que no hay forma de repartir
    las tarjetas por columna desde el arbol de accesibilidad: lo que si se puede
    comparar es que los cuatro contadores sumen lo mismo que las tarjetas que hay
    debajo, que es lo que significa "los contadores cuadran".
  */
  const tarjetas = conPrefijo("board-card-").length;
  const pintados = porEstado.reduce((suma, c) => suma + c.pintado, 0);
  const tarjetasEsperadas = columnasEsperadas * SEMILLA.tareasPorEstado;

  return {
    ok: pintados === tarjetas && tarjetas === tarjetasEsperadas,
    detalle:
      `columnas: ${estados.length} | contadores de cabecera: ${porEstado.map((c) => c.pintado).join("/")} ` +
      `= ${pintados} | tarjetas en el tablero: ${tarjetas} | sembradas por la semilla: ${tarjetasEsperadas}`,
  };
}

/**
 * Un paso del recorrido con el guardian alrededor.
 *
 * `esperarCambio: false` **no significa "no comprobar"**: significa comprobar lo
 * contrario, que la pantalla se queda como estaba. Ese es el caso de abrir y cerrar
 * una hoja sin tocar nada, donde un hash distinto seria el fallo.
 */
async function paso(nombre, accion, { esperarCambio = true, medir = null } = {}) {
  adb("logcat", "-c");
  const pidAntes = pid();
  const antes = arbol();

  let falloAccion = null;
  try {
    await accion();
  } catch (error) {
    falloAccion = error.message;
  }

  await sleep(3200);
  const pidDespues = pid();
  const crasheo = crashes();
  const despues = arbol();

  const problemas = [];
  if (falloAccion) problemas.push(`la accion no se pudo hacer: ${falloAccion}`);
  if (!pidDespues) problemas.push("la app se cerro — no hay proceso");
  else if (pidAntes && pidDespues !== pidAntes) {
    problemas.push(
      `el proceso cambio (${pidAntes} -> ${pidDespues}): relanzo en silencio, que en nativo casi siempre es un crash`,
    );
  }
  if (crasheo.length) problemas.push(crasheo[0].slice(0, 150));
  if (!falloAccion) {
    if (esperarCambio && despues.hash === antes.hash) {
      problemas.push("la pantalla NO ha cambiado: el paso no hizo nada");
    }
    if (!esperarCambio && despues.hash !== antes.hash) {
      problemas.push(`la pantalla cambio y no deberia: ${antes.hash} -> ${despues.hash}`);
    }
  }

  /**
   * La medicion propia del paso, **despues del guardian y no antes**.
   *
   * Primero el guardian porque un `FALLA` de uno y un `FALLA` de la medicion no son
   * lo mismo: si la app se relanzo en silencio, lo que hay en pantalla ahora es la
   * pantalla del relanzamiento, y medir ahi y presentarlo como la de este paso seria
   * mirar otra cosa. Y `!problemas.length` porque una medicion sobre una pantalla en
   * la que el guardian ya ha encontrado un fallo no anade informacion: sale en rojo
   * igualmente, y la razon que lo pone en rojo es la del guardian.
   */
  let detalle = "";
  if (!problemas.length && medir) {
    const leido = medir();
    if (!leido.ok) problemas.push(`la comprobacion propia del paso fallo: ${leido.detalle}`);
    else detalle = leido.detalle;
  }

  const foto = join(SHOTS, `${String(resultados.length + 1).padStart(2, "0")}-${nombre.replace(/[^a-z0-9]+/gi, "-").slice(0, 40)}.png`);
  try {
    execFileSync("sh", ["-c", `"${ADB}" exec-out screencap -p > "${foto}"`]);
  } catch {
    /* la foto es un extra, no un requisito */
  }

  if (problemas.length) fallos += 1;
  resultados.push({
    nombre,
    pantalla: despues.nombre,
    ok: problemas.length === 0,
    detalle: problemas.join(" | ") || detalle || `ok (${despues.total} textos, ${despues.hash})`,
  });
  console.log(
    `  [${problemas.length ? "FALLA" : " ok  "}] ${nombre.padEnd(44)} ${(problemas.length ? problemas.join(" | ") : detalle || despues.nombre).slice(0, 100)}`,
  );
}

const resultados = [];
let fallos = 0;

/**
 * Cuantos pasos ejecuta el cuerpo de este fichero, **contados en el fuente y no
 * declarados a mano**.
 *
 * Es la cuenta que faltaba: la version anterior imprimia `PASOS.length` —los 14
 * previstos— al lado de un cuerpo con cuatro `await paso(`, y por eso decia "el
 * recorrido tiene 14 pasos" con cuatro. Aqui la cuenta de lo escrito sale de
 * `await paso(` en el propio fichero, asi que las dos mitades no pueden separarse:
 * un paso nuevo aparece en las dos, y un paso borrado desaparece de las dos.
 */
const pasosEjecutados = () => {
  const fuente = readFileSync(fileURLToPath(import.meta.url), "utf8");
  const n = [...fuente.matchAll(/^\s*await paso\(/gm)].length;
  if (n === 0) throw new Error("el cuerpo no tiene ningun `await paso(`: el recuento no seria cierto");
  return n;
};

const EJECUTADOS = pasosEjecutados();

/* ------------------------------------------------------------------ sin dispositivo */

const dispositivos = adbOk("devices").split("\n").slice(1).filter((l) => l.trim().length > 0);

if (dispositivos.length === 0) {
  const texto = [
    `El recorrido del tablero en Android — ${PAQUETE}`,
    "",
    "SIN DISPOSITIVO. `adb devices` no lista ninguno.",
    "",
    "Esto NO es un resultado del recorrido: **no se ha ejecutado**. No hay ninguna",
    "afirmacion sobre nativo en este fichero, ni en su salida, ni en el informe que",
    "escribe. Sale con codigo 2 a proposito, para que un `&&` no lo tome por un verde.",
    "",
    "Para correrlo:",
    "  1. arranca un emulador:   emulator -avd Medium_Phone_API_35 &",
    "  2. instala la app de este checkout (build nativo, no el bundle de la web)",
    "  3. node scripts/verify-android-board.mjs",
    "",
    `El recorrido tiene ${PASOS_PREVISTOS.length} pasos PREVISTOS y ${EJECUTADOS} escritos.`,
    "Lo previsto son los 14 que el spec pide para una pantalla nueva; lo escrito es lo",
    "que el cuerpo de este fichero ejecuta hoy. Las dos cuentas no son la misma y por eso",
    "van separadas: un recorrido con un paso previsto sin escribir sale con codigo 1, no",
    "con un verde. El informe queda en:",
    "  capturas/android/tablero/informe.txt",
    "",
    "Pasos PREVISTOS y como estan:",
    ...PASOS_PREVISTOS.map((p, i) => `  ${i + 1}. ${p}`),
    "",
    `Lo que el cuerpo ejecuta HOY son ${EJECUTADOS}, y son estos:`,
    ...PRECONDICIONES.map((p) => `  - ${p}`),
    `  - ${PASOS_PREVISTOS[0]} (el unico previsto con cuerpo: mira que hay una columna por estado)`,
    "",
    `Los otros ${PASOS_PREVISTOS.length - 1} previstos NO estan escritos. Cada uno necesita la`,
    "semilla de mas abajo, y el guardian mide el pid y el buffer de crash en cada paso",
    "para que un boton que no hace nada y una app que se cierra no se vean igual.",
    "",
    "Lo que NO se comprobaria aunque saliera entero en verde:",
    ...LO_QUE_NO_SE_COMPRUEBA.map((h) => `  - ${h}`),
    "",
    "Y un hueco mas, que es de este repo y no del recorrido:",
    "  - la semilla. Este guion necesita una cuenta verificada con un tablero de cuatro",
    "    columnas, sembrada por la API, y la cuenta con la que entra el dispositivo no",
    "    se puede sembrar desde aqui sin su contrasena. El spec de regresion lo resuelve",
    "    con `apps/mobile/e2e/seed/e2e-account.mjs`, que no existe todavia (la fase 1 de",
    "    ese spec esta por implementar). Con la app sin sembrar, los pasos que necesitan",
    "    tablero fallan, y esa es la lectura correcta: no es que el tablero este roto.",
    "",
    `Semilla que usaria: ${JSON.stringify(SEMILLA)}`,
    "",
  ].join("\n");

  mkdirSync(SHOTS, { recursive: true });
  writeFileSync(INFORME, texto, "utf8");
  console.log(texto);
  console.log(`Guion e informe: ${INFORME}\n`);
  process.exit(2);
}

/* ------------------------------------------------------------------ con dispositivo */

mkdirSync(SHOTS, { recursive: true });
console.log(`\nRecorrido del tablero en Android — ${PAQUETE}`);
console.log(`dispositivos: ${dispositivos.map((d) => d.split("\t")[0]).join(", ")}\n`);

await paso("arranque", async () => {
  adb("shell", "monkey", "-p", PAQUETE, "-c", "android.intent.category.LAUNCHER", "1");
  await sleep(9000);
});

/*
  **Los dos `await paso()` siguientes son PRECONDICIONES, no pasos del recorrido**, y
  por eso van aparte de `PASOS_PREVISTOS`: arrancar la app y mirar que existen
  `board-screen` y `board-tabs` es mirar que el recorrido tiene donde empezar. Contarlos
  como pasos fue lo que hizo que cuatro `await paso()` parecieran los catorce de
  `PASOS`, y de ahi la linea de "el recorrido tiene 14 pasos".

  **Los trece pasos siguientes a `PASOS_PREVISTOS[0]` no estan escritos, y el final de
  este fichero lo dice y sale con codigo 1 por eso.** La version anterior de este
  comentario afirmaba que "con `SEMILLA` presente, los trece pasos siguientes son los de
  `PASOS`", y no los habia: contarlos era el unico trabajo que faltaba y no se hizo.

  Cada uno se escribira contra los ids reales —`board-tab-<uuid>`,
  `state-picker-row-<uuid>`, `board-card-<uuid>`— y no por el texto traducido, porque un
  recorrido que nombra las cosas por una palabra del diccionario se rompe en cuanto se
  retoca, y ese es el error que el propio spec de regresion dice querer evitar ("Los
  flujos no afirman sobre texto traducido"). Los ids vienen de `SEMILLA`, que es lo que
  los hace deterministas.

  Sin `e2e-account.mjs` —que el spec resuelve y no existe todavia— no hay sesion que
  sembrar, y sin sesion no hay paso: cada uno fallaria con "no aparece el testID ...", que
  es la lectura correcta y no un tablero roto.
*/
await paso("la pantalla del tablero esta", async () => {
  if (!nodo("board-screen")) throw new Error('no aparece "board-screen": la ruta /board/<id> no se ha abierto');
}, { esperarCambio: false });

await paso("la tira de pestañas esta", async () => {
  if (!nodo("board-tabs")) throw new Error('no aparece "board-tabs"');
}, { esperarCambio: false });

/**
 * El unico de los 14 previstos que tiene cuerpo, y **mide lo que el nombre dice**.
 *
 * Antes se llamaba "hay una tarjeta por columna y sus contadores" y su accion era
 * `cuantos("board-slot-") === 0`: dos cosas en el nombre y **ningun contador leido**.
 * Ahora el nombre es el del paso previsto y la medicion es `columnasYContadores()`,
 * que lee los cuatro `board-count-<stateId>` de verdad y sale con `null` —y por lo
 * tanto con `FALLA`— cuando un contador no se puede leer, en vez de salir con un
 * `ok` por no haber mirado.
 *
 * **Lo que este paso NO mide, y por eso el resto de los previstos sigue sin
 * escribir:** que la primera pestaña este activa. `board-tab-<stateId>` existe
 * (`board-tabs.tsx`), pero en nativo el estado elegido se lee de
 * `accessibilityState.selected`, y ningun guion de este repo ha leido un atributo
 * `selected` de un volcado de `uiautomator` —en web el mismo estado se lee por
 * `aria-selected`, que es otra cosa—. Sin ese dato medido una vez, escribir el paso
 * seria escribirlo sin saber si se puede leer.
 */
await paso(PASOS_PREVISTOS[0], async () => {
  const columnas = cuantos("board-slot-");
  if (columnas === 0) throw new Error('no hay ningun "board-slot-<id>": el tablero esta vacio o sin sembrar');
}, { esperarCambio: false, medir: columnasYContadores });

console.log("\n");
const linea = (r) =>
  `${r.ok ? "PASA" : "FALLA"}  ${r.nombre.padEnd(44)} ${r.pantalla.slice(0, 28).padEnd(30)} ${r.detalle}`;

/**
 * Los pasos **previstos que no tienen cuerpo**, y que ponen la corrida en rojo.
 *
 * Sin esto, un recorrido con un paso escrito de catorce sale con `4/4 PASA` y codigo 0,
 * y ese verde afirma una cobertura que no existe: el mismo defecto que hacia que la
 * salida dijera "el recorrido tiene 14 pasos" con cuatro en el cuerpo, ahora en la otra
 * punta —la cuenta de resultados—. Un recorrido incompleto **no es un recorrido que
 * falle**: sale con 1 y con la lista de lo que falta, que es una informacion distinta
 * de la de un fallo de la app, y por eso el motivo va escrito y no se cuenta como un
 * `FALLA` mas de los otros.
 */
const escritos = resultados.filter((r) => PASOS_PREVISTOS.includes(r.nombre));
const SIN_ESCRIBIR = PASOS_PREVISTOS.filter((p) => !escritos.some((r) => r.nombre === p));

const seccionIncompleto = SIN_ESCRIBIR.length
  ? [
      "",
      `${PASOS_PREVISTOS.length} pasos previstos | ${escritos.length} escritos | ${SIN_ESCRIBIR.length} SIN ESCRIBIR:`,
      ...SIN_ESCRIBIR.map((p) => `  - ${p}`),
      "",
      "Los que faltan no fallan: no estan escritos. Cada uno necesita una sesion sembrada y",
      "el hueco es `apps/mobile/e2e/seed/e2e-account.mjs`, que no existe todavia (ver el",
      "bloque SEMILLA y la salida sin dispositivo). Por eso la corrida sale con codigo 1 y",
      "no con un verde de los pasos que si hay.",
    ]
  : [];

if (SIN_ESCRIBIR.length) fallos += 1;

writeFileSync(
  INFORME,
  [
    `Recorrido del tablero en Android — ${PAQUETE}`,
    `dispositivos: ${dispositivos.map((d) => d.split("\t")[0]).join(", ")}`,
    "",
    ...resultados.map(linea),
    "",
    `${resultados.length - fallos}/${resultados.length} pasos sin fallo`,
    ...seccionIncompleto,
    "",
    "Lo que este recorrido no comprueba aunque salga entero en verde:",
    ...LO_QUE_NO_SE_COMPRUEBA.map((h) => `  - ${h}`),
    "",
  ].join("\n"),
  "utf8",
);
for (const r of resultados) console.log(`  ${linea(r)}`);
console.log(seccionIncompleto.join("\n"));
console.log(`\n${resultados.length - fallos}/${resultados.length} pasos sin fallo`);
console.log(`capturas e informe: ${SHOTS}\n`);
process.exit(fallos > 0 ? 1 : 0);
