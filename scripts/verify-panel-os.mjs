import { launchChrome, openTab, seedSession } from "./cdp.mjs";
import { cuenta, sembrarPanel } from "./carry-session.mjs";

/**
 * Los dos gestos del escritorio que quedan fuera del recorrido largo.
 *
 *  - **Mantener pulsado el fondo** empieza a colocar, y tocarlo lo termina. Es el
 *    gesto que más gente tiene en los dedos y el único de los cuatro que aquí era
 *    solo el lápiz de la cabecera.
 *  - **Arrastrar más allá de la última pantalla la crea.** Apple's palabras: "si no
 *    hay puntos a la derecha del punto brillante, arrastrar una app a ese lado de la
 *    pantalla crea una página nueva".
 *
 * Van en su propio script y no al final del recorrido porque el recorrido largo
 * hace treinta llamadas de entrada al navegador y en este entorno alguna se queda
 * sin acuse a mitad —la página vive, se lo ha comprobado— y el caso que venía
 * después falla sin que su gesto tuviera nada que ver. Aislados, cada uno mide lo
 * suyo.
 */

const APP = process.env.APP_URL ?? "http://localhost:8081";
const NOMBRES = ["Primera", "Segunda", "Tercera", "Cuarta"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let dedo = 1;
const point = (x, y, id) => [{ x, y, id, radiusX: 12, radiusY: 12, force: 1 }];

let fallos = 0;
const check = (nombre, ok, detalle = "") => {
  if (!ok) fallos += 1;
  console.log(`${ok ? "ok    " : "FALLA "} ${nombre}${detalle ? ` — ${detalle}` : ""}`);
};
const note = (texto) => console.log(`      ${texto}`);

async function enviar(tab, params) {
  for (let intento = 1; intento <= 4; intento += 1) {
    try {
      return await tab.send("Input.dispatchTouchEvent", params, { ms: 15000 });
    } catch {
      if (intento === 1) note(`(el navegador no acuso un ${params.type}; se reintenta)`);
      await sleep(1500 * intento);
    }
  }
  throw new Error("el navegador ha dejado de responder a los toques");
}

async function gesto(tab, desde, hasta, { pasos = 14, mantener = 0, despues = 0 } = {}) {
  const mio = dedo++;
  await enviar(tab, { type: "touchStart", touchPoints: point(desde.x, desde.y, mio) });
  try {
    if (mantener) await sleep(mantener);
    for (let i = 1; i <= pasos; i += 1) {
      await enviar(tab, {
        type: "touchMove",
        touchPoints: point(
          desde.x + ((hasta.x - desde.x) * i) / pasos,
          desde.y + ((hasta.y - desde.y) * i) / pasos,
          mio,
        ),
      });
      await sleep(14);
    }
    if (despues) await sleep(despues);
  } finally {
    await tab.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }).catch(() => {});
    await tab.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] }).catch(() => {});
  }
}

/**
 * Un dedo que va pasando por varios sitios y **se para en cada uno**.
 *
 * `gesto` es un solo empujón con una espera delante, y hay gestos que son más de uno:
 * llevar una tarjeta al borde, soltar el pulso mientras la pantalla gira, y volver a
 * empujar. Con un solo `despues` no se puede expresar, y el caso acaba midiendo un
 * gesto que nadie hace.
 */
async function porTramos(tab, desde, puntos, { mantener = 520, pasos = 12 } = {}) {
  const mio = dedo++;
  await enviar(tab, { type: "touchStart", touchPoints: point(desde.x, desde.y, mio) });
  try {
    if (mantener) await sleep(mantener);
    let donde = desde;
    for (const tramo of puntos) {
      for (let i = 1; i <= pasos; i += 1) {
        await enviar(tab, {
          type: "touchMove",
          touchPoints: point(
            donde.x + ((tramo.x - donde.x) * i) / pasos,
            donde.y + ((tramo.y - donde.y) * i) / pasos,
            mio,
          ),
        });
        await sleep(14);
      }
      donde = tramo;
      if (tramo.espera) await sleep(tramo.espera);
    }
  } finally {
    await tab.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }).catch(() => {});
    await tab.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] }).catch(() => {});
  }
}

/** El punto con más sitio alrededor, entre las tarjetas. */
const HUECO = `
  (() => {
    const ventana = window.innerWidth;
    let nodo = document.querySelector('[data-testid="panel-grid"]');
    let r = nodo.getBoundingClientRect();
    while (Math.abs(r.width - ventana) > ventana * 0.2 && nodo.parentElement) {
      nodo = nodo.parentElement;
      r = nodo.getBoundingClientRect();
    }
    const tarjetas = [...document.querySelectorAll('[aria-label]')]
      .map(e => e.getBoundingClientRect())
      .filter(c => c.width > 0 && c.height > 0 && c.top >= r.top - 4 && c.bottom <= r.bottom + 4);
    const distancia = (x, y) => {
      let mejor = Number.MAX_VALUE;
      for (const c of tarjetas) {
        const dx = Math.max(c.left - x, 0, x - c.right);
        const dy = Math.max(c.top - y, 0, y - c.bottom);
        mejor = Math.min(mejor, Math.hypot(dx, dy));
      }
      return mejor;
    };
    let elegido = null;
    for (let fy = 0.15; fy <= 0.9; fy += 0.05) {
      for (let fx = 0.1; fx <= 0.95; fx += 0.05) {
        const x = Math.round(r.left + r.width * fx);
        const y = Math.round(r.top + r.height * fy);
        const e = document.elementFromPoint(x, y);
        if (!e || !e.closest('[data-testid="panel-background"]')) continue;
        const d = distancia(x, y);
        if (!elegido || d > elegido.d) elegido = { x, y, d: Math.round(d) };
      }
    }
    return elegido;
  })()
`;

const chrome = await launchChrome();
let tab;
try {
  const session = await cuenta();
  /*
    Tres pantallas con una tarjeta en cada una menos la primera, y dos en la primera.

    El reparto es lo que hace posibles los gestos que se prueban aquí: "arrastrar más
    allá de la **última** la crea" necesita una tarjeta en la última —con una pantalla
    vacía detrás el dedo no sale del panel y no hay nada que crear— y "se puede pegar
    a un lado **sin que gire**" necesita pantallas a los dos lados, porque si no girar
    hacia un extremo no es una opción y el caso no mide nada.
  */
  console.log(
    "cuenta:",
    (await sembrarPanel(session, NOMBRES, { pantallas: 3, repartir: [0, 0, 1, 2] })).status,
  );
  tab = await openTab(chrome.port);
  await seedSession(tab, session, APP);
  await tab.send("Emulation.setDeviceMetricsOverride", {
    width: 390, height: 844, deviceScaleFactor: 2, mobile: false,
  });
  await tab.goto(APP);
  await sleep(9000);

  /**
   * A entrar en modo colocar, o a quedarse si ya estaba.
   *
   * El lápiz sólo existe **fuera** del modo —dentro hay un botón de Guardar— y
   * reventar con "cannot read property click of undefined" no dice "el panel ya
   * estaba colocando", que es lo que había pasado.
   */
  async function enterEdit() {
    const que = await tab.evaluate(`
      (() => {
        if (document.querySelector('[data-testid="panel-done"]')) return 'ya-estaba';
        const el = [...document.querySelectorAll('[aria-label],[role=button]')]
          .find(e => (e.getAttribute('aria-label') || '').includes('Colocar las tarjetas'));
        if (!el) return 'no-hay-lapiz';
        el.click();
        return 'entrado';
      })()
    `);
    if (que === 'no-hay-lapiz') throw new Error("no hay lápiz de colocar y el panel no está colocando");
    await sleep(800);
    return que;
  }

  /** El centro de una tarjeta por su nombre, si se está viendo. */
  const cardBox = (titulo) =>
    tab.evaluate(`
      (() => {
        const nodo = [...document.querySelectorAll('div')]
          .filter(e => e.children.length === 0 && (e.textContent || '').trim() === ${JSON.stringify(titulo)})
          .map(e => e.getBoundingClientRect())
          .find(r => r.left > -1 && r.right < window.innerWidth + 1 && r.width > 0);
        return nodo ? { x: nodo.left + nodo.width / 2, y: nodo.top + nodo.height / 2 } : null;
      })()
    `);

  /** Ir a una pantalla con un punto, para que el caso empiece donde dice. */
  /**
   * Ir a una pantalla, y **comprobar que se ha llegado**.
   *
   * Un clic a un punto que todavía no está no hace nada y no lo dice: el caso
   * continúa sobre una pantalla que no es la que pedía y el fallo aparece en el gesto
   * siguiente, que es de otra cosa. Así que aquí se espera a estar en la pantalla
   * pedida y se dice si no se llega.
   */
  async function goTo(indice) {
    await tab.evaluate(`
      (() => {
        const todos = [...document.querySelectorAll('[data-testid^="panel-page-"]')];
        const b = ${indice} < 0 ? todos[todos.length - 1] : todos.find(e => e.dataset.testid === 'panel-page-${indice}');
        b && b.click();
        return true;
      })()
    `);
    const wanted = indice < 0 ? -2 : indice;
    const hasta = Date.now() + 8000;
    while (Date.now() < hasta) {
      const dot = (await puntos()).dot;
      if (dot === wanted || (wanted === -2 && dot >= 0)) break;
      await sleep(300);
    }
    await sleep(700);
  }

  /**
   * Espera a que el panel se dibuje y se quede quieto.
   *
   * Un `sleep` fijo después de cargar no es esperar a nada: esta página tarda en
   * empaquetarse y el primer `sleep` se acababa antes de que hubiera panel, y el
   * fallo era "nodo nulo" muy lejos del sitio donde estaba el problema.
   */
  async function panelListo(cuantas = null) {
    const hasta = Date.now() + 40000;
    while (Date.now() < hasta) {
      const puntos = await tab
        .evaluate(`document.querySelectorAll('[data-testid^="panel-page-"]').length`)
        .catch(() => 0);
      const panel = await tab
        .evaluate(`!!document.querySelector('[data-testid="panel-grid"]')`)
        .catch(() => false);
      if (panel && puntos > 0 && (cuantas === null || puntos === cuantas)) {
        await sleep(1200);
        return puntos;
      }
      await sleep(400);
    }
    throw new Error(`el panel no se quedó con ${cuantas ?? 'sus'} pantallas`);
  }

  const editando = () =>
    tab.evaluate(`!!document.querySelector('[data-testid="panel-done"]')`).catch(() => null);
  const puntos = () =>
    tab.evaluate(`
      (() => {
        const ps = [...document.querySelectorAll('[data-testid^="panel-page-"]')];
        return { cuantas: ps.length, dot: ps.indexOf(document.querySelector('[data-testid="panel-page-current"]')) };
      })()
    `);

  await panelListo(3);
  const tablero = await tab.evaluate(`
    (() => {
      const ventana = window.innerWidth;
      let nodo = document.querySelector('[data-testid="panel-grid"]');
      let r = nodo.getBoundingClientRect();
      while (Math.abs(r.width - ventana) > ventana * 0.2 && nodo.parentElement) {
        nodo = nodo.parentElement; r = nodo.getBoundingClientRect();
      }
      return {
        izquierda: Math.round(r.left), derecha: Math.round(r.right),
        arriba: Math.round(r.top), abajo: Math.round(r.bottom),
      };
    })()
  `);

  /* ------------------------------------------------------- mantener y tocar -- */

  const hueco = await tab.evaluate(HUECO);
  if (!hueco) throw new Error("el panel no tiene sitio libre para el dedo");
  note(`sitio: ${hueco.x},${hueco.y}, a ${hueco.d} px de la tarjeta más cercana`);

  await gesto(tab, hueco, hueco, { pasos: 1, mantener: 750, despues: 150 });
  check("mantener pulsado el fondo empieza a colocar", (await editando()) === true);

  await gesto(tab, hueco, hueco, { pasos: 1 });
  check("y tocar el fondo lo termina", (await editando()) === false);

  await tab.evaluate(`
    (() => {
      const el = [...document.querySelectorAll('[aria-label],[role=button]')]
        .find(e => (e.getAttribute('aria-label') || '').includes('Colocar las tarjetas'));
      el.click(); return true;
    })()
  `);
  await sleep(800);
  const antes = (await puntos()).dot;
  await gesto(
    tab,
    { x: tablero.derecha - 40, y: Math.round((tablero.arriba + tablero.abajo) / 2) },
    { x: tablero.izquierda + 40, y: Math.round((tablero.arriba + tablero.abajo) / 2) },
  );
  check(
    "y un swipe en el hueco cambia de pantalla también colocando",
    (await puntos()).dot === antes + 1,
    `pantalla ${antes} → ${(await puntos()).dot}`,
  );

  await tab.evaluate(`[...document.querySelectorAll('[data-testid="panel-done"]')][0]?.click()`);
  await sleep(900);

  /* --------------------------------------- se puede pegar a un lado sin girar -- */

  /*
    Una tarjeta pegada al borde, sin que la pantalla gire.
  */
  {
    /*
      El margen, dicho como una cosa que se puede perder.

      El giro se medía por la celda: en cuanto la tarjeta llegaba a la última columna
      la pantalla cambiaba. Y como la tarjeta no puede pasar de ahí —no hay celda al
      otro lado— la última columna era un sitio de paso y no un sitio donde dejar
      nada. No había manera de colocar una tarjeta pegada a la izquierda o a la
      derecha, que son de las dos posiciones a las que llega una mano primero.

      Ahora el giro pregunta por el **dedo**: la tarjeta se para en la última columna
      y el dedo sigue, y de ese camino que sobra se decide. Aquí se arrastra hasta
      tres cuartos del camino al borde del panel —la tarjeta ya está en la última
      columna— y se suelta. Sin margen, la pantalla habría girado.
    */

    /** Los píxeles que le sobran a una tarjeta hasta el borde del panel, de un lado. */
    /*
      Y el umbral es una fracción del ancho y no cero.

      El panel deja unos trece píxeles de aire en cada lado, así que una tarjeta en
      la última columna **nunca** acaba a cero del borde del panel: eso medía el
      relleno del panel y no la colocación de la tarjeta. Una quinta parte del ancho
      —unos setenta píxeles— separa de sobra "en la última columna" de "una columna
      más adentro", que serían unos noventa.
    */
    const pegado = Math.round((tablero.derecha - tablero.izquierda) / 5);

    const hastaElBorde = (titulo, lado) =>
      tab.evaluate(
        `
        (() => {
          const ventana = window.innerWidth;
          let nodo = document.querySelector('[data-testid="panel-grid"]');
          let r = nodo.getBoundingClientRect();
          while (Math.abs(r.width - ventana) > ventana * 0.2 && nodo.parentElement) {
            nodo = nodo.parentElement;
            r = nodo.getBoundingClientRect();
          }
          const carta = [...document.querySelectorAll('div')]
            .filter(e => e.children.length === 0 && (e.textContent || '').trim() === ${JSON.stringify(titulo)})
            .map(e => e.getBoundingClientRect())
            .find(b => b.left > -1 && b.right < ventana + 1 && b.width > 0);
          if (!carta) return null;
          return Math.round(
            ${JSON.stringify(lado)} === 'derecha' ? r.right - carta.right : carta.left - r.left
          );
        })()
      `,
      );

    await enterEdit();
    await goTo(1);
    const antes = (await puntos()).cuantas;

    // A la derecha, parando antes del borde del panel.
    const caja = await cardBox("Tercera");
    if (!caja) throw new Error("no encuentro la tarjeta del medio");
    const hastaDerecha = Math.round(caja.x + (tablero.derecha - caja.x) * 0.75);
    await gesto(tab, caja, { x: hastaDerecha, y: caja.y }, { mantener: 520, despues: 700 });
    await sleep(1100);
    const trasDerecha = await puntos();
    const huecoDerecha = await hastaElBorde("Tercera", "derecha");
    note(`a ${hastaDerecha}, borde en ${tablero.derecha}: le sobran ${huecoDerecha ?? "?"}px`);
    check("la tarjeta llega pegada a la derecha", huecoDerecha !== null && huecoDerecha <= pegado, `${huecoDerecha}px de hueco, tolerados ${pegado}`);
    check("y la pantalla no gira por ello", trasDerecha.dot === 1, `pantalla ${trasDerecha.dot}`);

    // Y a la izquierda, que es el otro lado y tiene otra pantalla detrás.
    const caja2 = await cardBox("Tercera");
    const hastaIzquierda = Math.round(caja2.x - (caja2.x - tablero.izquierda) * 0.75);
    await gesto(tab, caja2, { x: hastaIzquierda, y: caja2.y }, { mantener: 520, despues: 700 });
    await sleep(1100);
    const trasIzquierda = await puntos();
    const huecoIzquierda = await hastaElBorde("Tercera", "izquierda");
    note(`a ${hastaIzquierda}, borde en ${tablero.izquierda}: le sobran ${huecoIzquierda ?? "?"}px`);
    check("y también pegada a la izquierda", huecoIzquierda !== null && huecoIzquierda <= pegado, `${huecoIzquierda}px de hueco, tolerados ${pegado}`);
    check("y ahí tampoco gira", trasIzquierda.dot === 1, `pantalla ${trasIzquierda.dot}`);
    check("y no se ha creado ninguna pantalla de más", (await puntos()).cuantas === antes, `${antes} pantallas`);
    await tab.screenshot("verify/carry-pegada-al-borde.png");
    await tab.evaluate(`[...document.querySelectorAll('[data-testid="panel-done"]')][0]?.click()`);
    await sleep(900);
  }

  /* ------------------------------------ de la primera a la tercera sin soltar -- */

  {
    /*
      De la pantalla 1 a la 3 sin levantar el dedo, que es lo que se pedía y lo que
      no se podía.

      El empuje se medía con el recorrido total del dedo desde que tocó la tarjeta,
      pero `pushBase` se vuelve a asentar en cada giro. O sea que el panel reiniciaba
      uno de los dos números del cálculo y no el otro, y a partir del primer giro la
      medida decía "estás en el borde" para siempre: la tarjeta llegaba a la pantalla
      2 y el gesto se quedaba gastado. De la 1 a la 3 no había manera, y es algo que
      cualquier teléfono hace desde que un teléfono tuvo dos pantallas.

      Ahora el empuje se mide desde el último giro y la celda de referencia es la de
      la pantalla nueva, así que el segundo giro es un viaje nuevo desde aquí.
    */
    await enterEdit();
    await goTo(0);
    const caja = await cardBox("Primera");
    if (!caja) throw new Error("no encuentro la tarjeta de la primera pantalla");

    /*
      Un solo dedo, un solo viaje hacia la derecha, **sin soltar en ningún momento**.

      Que es lo que se intentaba: no "suelta, vuelve a cogerla y arrastra otra vez",
      sino arrastrar y que siga arrastrando. El primer giro se dispara a mitad del
      camino —el panel espera 230 ms quieto en el borde antes de girar, y para entonces
      el dedo ha seguido moviéndose— así que al terminar el primer giro todavía queda
      recorrido delante, y es ese recorrido el que lleva a la tercera pantalla.

      Antes no había recorrido: el empuje se medía con el recorrido total del dedo
      desde que tocó la tarjeta, `pushBase` se volvía a asentar en cada giro, y el
      cálculo se quedaba diciendo "estás en el borde" para siempre. La tarjeta llegaba
      a la segunda y el gesto se quedaba gastado. De la 1 a la 3 no había manera, y es
      una de las dos cosas más básicas que hace un teléfono con más de una pantalla.
    */
    /*
      Dos tramos hacia la derecha y una parada en el primero.

      El primer giro necesita el dedo en el margen del borde, y el panel espera 230 ms
      quieto antes de girar; si el dedo sigue moviéndose, para cuando gira se ha ido
      hasta el final de la pantalla y ya no queda sitio para un segundo empujón. Por
      eso el primer tramo **para** en cuanto ha disparado el giro, y el segundo sigue
      hacia delante desde ahí.

      Y por eso el caso es un `porTramos` y no un `gesto`: "arrastrar y seguir
      arrastrando" no se expresa con un solo empujón y una espera.
    */
    const segundoTramo = Math.round(caja.x + 275);
    const primerTramo = Math.round(caja.x + 215);

    await porTramos(tab, caja, [
      { x: primerTramo, y: caja.y, espera: 900 },
      { x: segundoTramo, y: caja.y, espera: 1000 },
    ]);
    await sleep(1400);
    const estado = await puntos();
    check(
      "de la pantalla 1 a la 3 sin soltar el dedo",
      estado.dot === 2,
      `pantalla ${estado.dot} de ${estado.cuantas}`,
    );
    const sigue = await cardBox("Primera");
    const dondeEstan = await tab.evaluate(`
      (() => {
        const salida = [];
        for (const nombre of ${JSON.stringify(NOMBRES)}) {
          const texto = [...document.querySelectorAll('div')]
            .filter(e => e.children.length === 0 && (e.textContent || '').trim() === nombre)[0];
          const tarjeta = texto && texto.closest('[data-testid^="panel-screen-"]');
          salida.push(nombre + '=' + (tarjeta ? tarjeta.dataset.testid : 'no-visible'));
        }
        return salida.join(' ');
      })()
    `);
    note(`donde esta cada una: ${dondeEstan}`);
    check("y la tarjeta ha llegado con ella", sigue !== null, dondeEstan);
    await tab.screenshot("verify/carry-uno-a-tres.png");
    await tab.evaluate(`[...document.querySelectorAll('[data-testid="panel-done"]')][0]?.click()`);
    await sleep(900);
  }

  /* ------------------------------------------- arrastrar crea la pantalla -- */

  const cuantas = (await puntos()).cuantas;
  await goTo(-1);
  const ultima = (await puntos()).dot;
  note(`${cuantas} pantallas, en la última (${ultima})`);

  const caja = await tab.evaluate(`
    (() => {
      const n = [...document.querySelectorAll('div')]
        .filter(e => e.children.length === 0 && (e.textContent || '').trim() === 'Cuarta')
        .map(e => e.getBoundingClientRect())
        .find(r => r.left > -1 && r.right < window.innerWidth + 1 && r.width > 0);
      if (!n) return null;
      return { x: Math.round(n.left + n.width / 2), y: Math.round(n.top + n.height / 2) };
    })()
  `);
  if (!caja) throw new Error("no encuentro la tarjeta de la última pantalla");

  await tab.evaluate(`
    (() => {
      const el = [...document.querySelectorAll('[aria-label],[role=button]')]
        .find(e => (e.getAttribute('aria-label') || '').includes('Colocar las tarjetas'));
      el.click(); return true;
    })()
  `);
  await sleep(800);

  await gesto(tab, caja, { x: tablero.derecha, y: caja.y }, { mantener: 520, despues: 700 });
  await sleep(1200);
  const despues = await puntos();
  check("arrastrar más allá de la última pantalla la crea", despues.cuantas === cuantas + 1, `${cuantas} → ${despues.cuantas} pantallas`);
  check("y te deja en ella", despues.dot === ultima + 1, `pantalla ${despues.dot}`);

  const visibles = await tab.evaluate(`
    (() => [...document.querySelectorAll('div')]
       .filter(e => e.children.length === 0 && (e.textContent||'').trim() === 'Cuarta')
       .map(e => e.getBoundingClientRect())
       .some(r => r.left > -1 && r.right < window.innerWidth + 1 && r.width > 0))()
  `);
  check("con la tarjeta encima, que para eso se ha creado", visibles === true);
  await tab.screenshot("verify/carry-pantalla-nueva.png");

  /* --------------------------------------------------- y el `+` hace lo mismo -- */

  const antesDelMas = (await puntos()).cuantas;
  await tab.evaluate(`[...document.querySelectorAll('[data-testid="panel-done"]')][0]?.click()`);
  await sleep(900);
  await tab.evaluate(`
    (() => {
      const el = [...document.querySelectorAll('[aria-label],[role=button]')]
        .find(e => (e.getAttribute('aria-label') || '').includes('Colocar las tarjetas'));
      el.click(); return true;
    })()
  `);
  await sleep(900);
  const dondeEstaba = (await puntos()).dot;
  await tab.evaluate(`
    (() => {
      /*
        El `+` por su nombre exacto y no "algo que hable de pantallas".

        Buscando la primera etiqueta que contuviera "pantalla" salía una flecha: el
        botón de antes y el de después la tienen, y el `+` va el último. El caso
        pulsaba una flecha y luego culpaba al `+` de no añadir nada.
      */
      const mas = [...document.querySelectorAll('[aria-label],[role=button]')]
        .find(e => (e.getAttribute('aria-label') || '') === 'Añadir una pantalla');
      if (!mas) {
        // Lo que sí había, porque un botón que no aparece es un problema distinto
        // de un botón que aparece y no hace nada.
        globalThis.__botones = [...document.querySelectorAll('[aria-label],[role=button]')]
          .map(e => e.getAttribute('aria-label') || '')
          .filter(Boolean);
        return false;
      }
      mas.click();
      return true;
    })()
  `);
  await sleep(1200);
  const botones = await tab.evaluate("globalThis.__botones ?? null");
  if (botones) note(`no estaba el +, y sí: ${JSON.stringify(botones)}`);
  const despuesDelMas = await puntos();
  check(
    "el `+` añade una pantalla",
    despuesDelMas.cuantas === antesDelMas + 1,
    `${antesDelMas} → ${despuesDelMas.cuantas} pantallas`,
  );
  check(
    "y te lleva a ella, que una pantalla que no se ve no está puesta",
    despuesDelMas.dot === despuesDelMas.cuantas - 1,
    `de la ${dondeEstaba} a la ${despuesDelMas.dot}`,
  );
  await tab.screenshot("verify/carry-mas.png");
} finally {
  tab?.close();
  chrome.kill();
}

console.log(fallos === 0 ? "\ntodas las comprobaciones pasan" : `\n${fallos} comprobaciones fallan`);
process.exit(fallos === 0 ? 0 : 1);
