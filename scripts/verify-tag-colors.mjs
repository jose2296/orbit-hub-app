import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { execSync } from "node:child_process";
import { launchChrome, openTab, seedSession, collectProblems } from "./cdp.mjs";

/**
 * Los colores de las etiquetas, mirados en un navegador.
 *
 * Tasks 1 a 7 de este bloque están verdes en una pantalla que no pinta nada: un
 * componente que devuelve `null` es un componente correcto, y el typecheck y las
 * pruebas los dos cumplen con uno. Esto es lo único que puede verlo.
 *
 * **Y hay un fallo que este archivo existe para que no vuelva a pasar.** El hash
 * de `derivedTagColor` cae en el mismo color para nombres distintos, y la semilla
 * del plan usaba dos nombres que caen los dos en `rose`: la comprobación entera
 * pasaba sin haber puesto nunca dos colores deducidos uno al lado del otro, que es
 * justo lo que una persona tiene que mirar. Por eso la semilla **se escoge** aquí
 * (`SEED_LABELS`), y por eso hay una comprobación que falla ruidosamente si los
 * colores deducidos de esa semilla sedegeneran otra vez. La comprobación es el
 * contrato; la lista de nombres es un accidents que se puede volver a elegir mal.
 *
 * Tres reglas de la casa que esta comprobación respeta porque las otras las
 * rompieron:
 *
 *  1. **La semilla va por `POST /sync/push`** y se mira el resultado de cada
 *     operación. Un push cuyas operaciones están todas rechazadas sigue siendo un
 *     200, y una comprobación que solo lee el código informa de una semilla que
 *     funcionó y luego se pregunta por qué el panel está vacío.
 *  2. **Un color se lee después de esperar, no una vez.** `tagColors` no cambia
 *     hasta que la escritura local vuelve de la caché (`localUpdate` → `load()` →
 *     `setLists`, y `load()` vuelve a leer la tabla `list` entera), así que leerlo
 *     una vez mide la pantalla que había antes del toque.
 *  3. **Los `testID` interpolan texto crudo del usuario.** Una etiqueta con un
 *     espacio da `tag-color-Mercadona urgente-red`, así que se localizan con
 *     selectores de atributo y nunca de clase.
 */

const APP = process.env.APP_URL ?? "http://localhost:8081";
const API = process.env.API_URL ?? "http://localhost:4000/api/v1";
const SESSION_FILE = process.env.SESSION_FILE ?? "/private/tmp/orbit-tag-colors-session.json";
const SHOTS = process.env.SHOTS_DIR ?? "capturas";

/**
 * La API tiene que arrancar con `EMAIL_TRANSPORT=console` **en la shell**.
 * El `.env` local dice `resend` y Resend rechaza `@example.com`, así que el enlace
 * de verificación nunca sale en el log que este archivo lee; y
 * `dotenv.config()` no pisa una variable que ya está en el entorno. El `.env` no
 * se toca.
 */
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
const EMAIL_LOG = process.env.EMAIL_LOG ?? logOfTheApi();
const readLog = async () => {
  try {
    return await readFile(EMAIL_LOG, "utf8");
  } catch {
    return "";
  }
};

/**
 * El token con el que este archivo habla con la API, **leído del navegador y no
 * del fichero de sesión**.
 *
 * El token de acceso vive quince minutos, y esta comprobación se ha medido en 118
 * s con la sesión buena y en más de cinco minutos cuando algo se tuerce, así que
 * hay ejecuciones que se pasan de los quince. Y el token de refresco **rota**:
 * cada vez que la aplicación refresca —que lo hace sola en cuanto un 401 le
 * llega— el anterior queda muerto. Así que el par guardado en disco deja de valer
 * a mitad de una ejecución, `GET /lists/:id` contesta 401 y el archivo informa de
 * un fallo de sincronización que no existe. Pasó en la ejecución en la que se
 * escribió esto, y es el fallo más caro de tener aquí porque parece de la
 * aplicación y no lo es.
 *
 * Leyendo `localStorage` en cada llamada, lo que se usa es siempre el token que la
 * aplicación acaba de renovar.
 *
 * **La caducidad se lee del propio token y no se pregunta a la API.** La primera
 * versión de esto validaba con `GET /auth/me` en cada llamada, y la API tiene
 * limitador de treinta peticiones por minuto en `auth/`: en una ejecución con
 * catorce lecturas se lo comía entero y a partir de ahí contestaba 429 a
 * `/auth/me`, que es exactamente el mismo síntoma con otra causa. Un `exp` es un
 * número dentro del token; no hace falta una red para saber si todavía vale.
 */
let tab;

/** Los milisegundos que le quedan a un JWT, o cero si no se puede leer. */
function leQueda(token) {
  try {
    const cuerpo = String(token).split(".")[1];
    const datos = JSON.parse(Buffer.from(cuerpo, "base64url").toString("utf8"));
    return (datos.exp ?? 0) * 1000 - Date.now();
  } catch {
    return 0;
  }
}

const tokenDeLaApi = async () => {
  for (let intento = 0; intento < 5; intento += 1) {
    const delNavegador = await tab
      ?.evaluate(`localStorage.getItem("orbithub:access-token")`)
      .catch(() => null);
    const token = delNavegador ?? sesion.accessToken;
    if (leQueda(token) > 60000) return token;
    // Caduca o ya caducó: la aplicación refresca en el 401, no antes, así que se
    // le deja un momento y se vuelve a leer.
    await sleep(800);
  }
  note("el token de la sesión guardada no se ha podido renovar; se sigue con ella");
  return sesion.accessToken;
};

async function api(path, { method = "GET", body, token } = {}) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const t = await r.text();
  return { status: r.status, body: t ? JSON.parse(t) : null };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Cuántas tiras de color hay abiertas, para los mensajes. */
const tirasAbiertas = (estado) => estado?.tiras ?? "?";

let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures += 1;
  console.log(`${ok ? "ok    " : "FALLA "} ${name}${detail ? ` — ${detail}` : ""}`);
};
const note = (text) => console.log(`      ${text}`);
const section = (text) => console.log(`\n--- ${text}`);

/* ------------------------------------------------ la paleta, en una sola -- */

/** Copia de `ITEM_ICON_COLORS` de `packages/contracts/src/item-icons.ts`. */
const ICON_COLORS = [
  "neutral",
  "accent",
  "green",
  "olive",
  "amber",
  "orange",
  "red",
  "rose",
  "purple",
  "blue",
  "teal",
  "brown",
];

/** Copia de `ICON_COLORS` de `apps/mobile/src/lib/lists/item-icons.ts`. */
const ICON_HEX = {
  neutral: "#8A93A8",
  accent: "#6366F1",
  green: "#16A34A",
  olive: "#4D7C0F",
  amber: "#D97706",
  orange: "#EA580C",
  red: "#DC2626",
  rose: "#E11D48",
  purple: "#9333EA",
  blue: "#2563EB",
  teal: "#0D9488",
  brown: "#92400E",
};

/** Los nombres con los que la app llama a los doce, en español. */
const COLOR_NAME = {
  neutral: "Neutro",
  accent: "Acento",
  green: "Verde",
  olive: "Oliva",
  amber: "Ámbar",
  orange: "Naranja",
  red: "Rojo",
  rose: "Rosa",
  purple: "Púrpura",
  blue: "Azul",
  teal: "Verde azulado",
  brown: "Marrón",
};
const COLOR_BY_NAME = Object.fromEntries(
  Object.entries(COLOR_NAME).map(([key, name]) => [name, key]),
);

/**
 * El color que deduce el nombre de una etiqueta.
 *
 * Las ocho líneas de `derivedTagColor` de `packages/contracts/src/tag-colors.ts`,
 * repetidas aquí porque este archivo corre en node sin compilar el contrato. Y
 * **repetidas a propósito, y comprobadas contra el valor clavado** del test de la
 * app (`Mercadona 🛒` → `green`, hash 2648977598): si el hash del contrato cambia,
 * esta copia se queda atrás y el `check` de abajo salta, en vez de que las dos
 * copias digan cosas distintas en silencio.
 */
function derivedTagColor(tag) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < tag.length; index += 1) {
    hash ^= tag.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return ICON_COLORS[hash % ICON_COLORS.length];
}

/** La luminancia relativa de WCAG, la misma cuenta que `luminanceDe`. */
function luminanceDe(hex) {
  const c = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/** El contraste, de 1 a 21. */
function contrastRatio(a, b) {
  const clara = Math.max(luminanceDe(a), luminanceDe(b));
  const oscura = Math.min(luminanceDe(a), luminanceDe(b));
  return (clara + 0.05) / (oscura + 0.05);
}

/** Los fondos y el texto de cada esquema, de `apps/mobile/src/theme/tokens.ts`. */
const SCHEME = {
  light: { fill: "#F0F2F8", text: "#0E1220" },
  dark: { fill: "#1B2231", text: "#F3F6FC" },
};

/**
 * De qué color se escribe una pastilla, según la regla de
 * `apps/mobile/src/lib/lists/tag-colors.ts`: el suyo si llega a 4.5:1 sobre el
 * relleno de la pastilla, y el del tema si no.
 *
 * Se reimplementa aquí porque es lo que hace falta para **predecir** el color
 * exacto que se va a leer en el DOM: nueve de los doce no se pintan de su color
 * ni en claro ni en oscuro, así que "la pastilla está en rojo" no es una frase que
 * se pueda comprobar leyendo el estilo de la pastilla en un tema donde el rojo no
 * pasa la puerta.
 */
function expectedTextColor(colorKey, scheme) {
  const { fill, text } = SCHEME[scheme];
  return contrastRatio(ICON_HEX[colorKey], fill) >= 4.5 ? ICON_HEX[colorKey] : text;
}

/** `#RRGGBB` a `rgb(r, g, b)`, que es lo que devuelve `getComputedStyle`. */
function toRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgb(${r}, ${g}, ${b})`;
}

/** El nombre del esquema en el que está la pastilla, deducido de su relleno. */
const schemeOfFill = (rgb) =>
  Object.entries(SCHEME).find(([, s]) => toRgb(s.fill) === rgb)?.[0] ?? "light";

/* ----------------------------------------------------- lo que hay en DOM -- */

/**
 * Una pastilla, por el nombre que lleva escrito.
 *
 * `TagChip` no tiene `testID` — y no se le puede poner uno que valga, porque el
 * nombre de la etiqueta es texto de usuario y un `testID` con texto de usuario es
 * un `testID` que nadie puede escribir a mano. Así que se busca **el texto** y se
 * sube por sus ancestros hasta la primera caja con radio de pastilla y fondo: ese
 * es el `View` que pinta `TagChip`, y su primer hijo sin hijos es el `AppText` con
 * el nombre, que es de donde sale el color del texto.
 */
const PILL = `
  (rootSelector, tag) => {
    const root = rootSelector ? document.querySelector(rootSelector) : document.body;
    if (!root) return null;
    const limpio = (s) => (s || "").replace(/[\\uE000-\\uF8FF]/g, "").trim();
    const hojas = [...root.querySelectorAll("div,span,p")]
      .filter((el) => el.children.length === 0 && limpio(el.textContent) === tag);
    const hoja = hojas[0];
    if (!hoja) return null;
    let caja = hoja.parentElement;
    while (caja && caja !== document.body) {
      const cs = getComputedStyle(caja);
      const pastilla =
        cs.borderTopLeftRadius === "999px" && cs.backgroundColor !== "rgba(0, 0, 0, 0)";
      if (pastilla) {
        const r = caja.getBoundingClientRect();
        const rt = hoja.getBoundingClientRect();
        const csTexto = getComputedStyle(hoja);
        return {
          tag: limpio(hoja.textContent),
          text: limpio(hoja.textContent),
          textColor: csTexto.color,
          fill: cs.backgroundColor,
          fontSize: parseFloat(csTexto.fontSize),
          lineHeight: parseFloat(csTexto.lineHeight) || parseFloat(csTexto.fontSize) * 1.2,
          lines: Math.max(1, Math.round(rt.height / (parseFloat(csTexto.lineHeight) || parseFloat(csTexto.fontSize) * 1.2))),
          rect: { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom },
        };
      }
      caja = caja.parentElement;
    }
    return null;
  }
`;

const pillOf = (tab, tag, root = null) =>
  tab.evaluate(`(${PILL})(${JSON.stringify(root)}, ${JSON.stringify(tag)})`);

/**
 * Todas las pastillas de una fila, por su nombre y su caja.
 *
 * Se filtran por **los nombres de la lista**: la insignia de urgencia es también
 * una caja de radio de pastilla con fondo, y sin este filtro la comprobación de
 * "cada pastilla es un color de la paleta" lee el color de la insignia de "Alta"
 * y falla culpando a las etiquetas. Los nombres los pasa quien llama, que es quien
 * sabe cuáles son.
 */
const pillsOfRow = (tab, itemId, tags) =>
  tab.evaluate(`
    (() => {
      const fila = document.querySelector('[data-testid=${JSON.stringify(`item-row-${itemId}`)}]');
      if (!fila) return null;
      const limpio = (s) => (s || "").replace(/[\\uE000-\\uF8FF]/g, "").trim();
      const esperadas = ${JSON.stringify(tags)};
      const cajas = [...fila.querySelectorAll("div")]
        .filter((el) => {
          const cs = getComputedStyle(el);
          return (
            cs.borderTopLeftRadius === "999px" &&
            cs.backgroundColor !== "rgba(0, 0, 0, 0)" &&
            el.getBoundingClientRect().width > 0
          );
        })
        .filter((caja) => esperadas.includes(limpio(caja.textContent)));
      return cajas.map((caja) => {
        const texto = [...caja.querySelectorAll("div,span")]
          .find((el) => el.children.length === 0 && limpio(el.textContent).length > 0);
        const r = caja.getBoundingClientRect();
        const cs = getComputedStyle(caja);
        const csTexto = texto ? getComputedStyle(texto) : null;
        return {
          tag: texto ? limpio(texto.textContent) : "",
          textColor: csTexto?.color ?? "",
          fill: cs.backgroundColor,
          radius: cs.borderTopLeftRadius,
          rect: { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom },
        };
      });
    })()
  `);

/**
 * Cuántas líneas de pastillas tiene una fila, y si la insignia se sale.
 *
 * Las líneas se cuentan sobre las pastillas y no sobre todas las cajas de radio,
 * porque la insignia de urgencia va en la misma línea que ellas y contarla daría
 * una línea de más en cuanto el nombre no cabe. Lo que sí se mide sobre todas es
 * hasta dónde llega la cosa de más a la derecha, porque lo que no puede pasar es
 * que eso se salga de la fila.
 */
const linesOfRow = (tab, itemId, tags) =>
  tab.evaluate(`
    (() => {
      const fila = document.querySelector('[data-testid=${JSON.stringify(`item-row-${itemId}`)}]');
      if (!fila) return null;
      const limpio = (s) => (s || "").replace(/[\\uE000-\\uF8FF]/g, "").trim();
      const esperadas = ${JSON.stringify(tags)};
      const todas = [...fila.querySelectorAll("div")].filter((el) => {
        const cs = getComputedStyle(el);
        return cs.borderTopLeftRadius === "999px" && cs.backgroundColor !== "rgba(0, 0, 0, 0)";
      });
      const pastillas = todas.filter((c) => esperadas.includes(limpio(c.textContent)));
      const insignia = todas.find((c) => ! esperadas.includes(limpio(c.textContent)));
      const tops = [...new Set(pastillas.map((c) => Math.round(c.getBoundingClientRect().top)))].sort((a, b) => a - b);
      const r = fila.getBoundingClientRect();
      const ri = insignia ? insignia.getBoundingClientRect() : null;
      const altoPastilla = pastillas.length
        ? Math.max(...pastillas.map((c) => c.getBoundingClientRect().height))
        : 0;
      return {
        lines: tops.length,
        tops,
        pillCount: pastillas.length,
        pillHeight: altoPastilla,
        rowHeight: r.height,
        rowWidth: r.width,
        rightmost: Math.max(...todas.map((c) => c.getBoundingClientRect().right)),
        insignia: ri
          ? { left: ri.left, right: ri.right, entera: ri.right <= r.right + 1 && ri.left >= r.left - 1, texto: limpio(insignia.textContent) }
          : null,
      };
    })()
  `);

/**
 * En qué página está la hoja y qué tiras de color hay abiertas.
 *
 * "La hoja sigue en la página de etiquetas" se lee de si existe algún botón de
 * color —`tag-color-button-<etiqueta>` sólo se pinta en esa página— y "la tira
 * está abierta" de si existe su primer punto, `tag-color-<etiqueta>-derived`,
 * que tampoco se pinta en ningún otro sitio.
 */
const sheetState = (tab) =>
  tab.evaluate(`
    (() => {
      const testids = [...document.querySelectorAll("[data-testid]")].map((d) => d.getAttribute("data-testid"));
      const botones = testids.filter((t) => t.startsWith("tag-color-button-"));
      // Una tira abierta es un solo punto —el que devuelve la etiqueta al color
      // deducido— más sus doce colores, así que se cuentan los "-derived": los
      // trece testID de una tira son trece, y "tiras abiertas: 13" no dice nada.
      const tiras = testids.filter((t) => /-derived$/.test(t));
      const campoNombre = testids.includes("item-name");
      return {
        pagina: campoNombre ? "edit" : botones.length > 0 ? "tags" : "otra",
        botones: botones.length,
        tiras: tiras.length,
        hayHoja: !!document.querySelector('[data-testid="sheet-panel"]'),
      };
    })()
  `);

/**
 * Los dos botones de dentro de una pastilla, con las cajas que tienen de verdad.
 *
 * **Se busca dentro del panel de la hoja y no en el documento entero**, y por un
 * motivo que costó una ejecución: la lista de detrás también tiene una pastilla
 * "Mercadona" y en el orden del documento va **primero**, así que una búsqueda
 * global mide la pastilla de la fila —que no tiene botones dentro— y dice que los
 * botones no existen. Un `Modal` de React Native vive en el mismo documento que
 * lo que tapa, y lo tapa sin ninguna marca en el orden.
 */
const SHEET = '[data-testid="sheet-panel"]';

const chipActions = (tab, tag) =>
  tab.evaluate(`
    (() => {
      const panel = document.querySelector('[data-testid="sheet-panel"]');
      if (!panel) return { sinPanel: true, botones: [] };
      const limpio = (s) => (s || "").replace(/[\\uE000-\\uF8FF]/g, "").trim();
      const hoja = [...panel.querySelectorAll("div,span,p")]
        .filter((el) => el.children.length === 0 && limpio(el.textContent) === ${JSON.stringify(tag)})
        .find((el) => {
          let caja = el.parentElement;
          while (caja && caja !== document.body) {
            const cs = getComputedStyle(caja);
            if (cs.borderTopLeftRadius === "999px" && cs.backgroundColor !== "rgba(0, 0, 0, 0)") return true;
            caja = caja.parentElement;
          }
          return false;
        });
      if (!hoja) return null;
      let pill = hoja.parentElement;
      while (pill) {
        const cs = getComputedStyle(pill);
        if (cs.borderTopLeftRadius === "999px" && cs.backgroundColor !== "rgba(0, 0, 0, 0)") break;
        pill = pill.parentElement;
      }
      if (!pill) return null;
      // Por el atributo y no por el rol: en web un Pressable escribe las dos
      // cosas, pero la que la app escribe siempre es el aria-label, y una
      // comprobación que se apoya en la otra se queda sin medir un día que RNW la
      // deje de escribir.
      const botones = [...pill.querySelectorAll("[aria-label]")];
      const quitar = botones.find((b) => (b.getAttribute("aria-label") || "").includes("Quitar la etiqueta"));
      const color = botones.find((b) => (b.getAttribute("aria-label") || "").includes("el color de"));
      if (!quitar || !color) {
        return {
          quitar: null,
          color: null,
          hay: botones.map((b) => (b.getAttribute("aria-label") || "").slice(0, 60)),
        };
      }
      const rq = quitar.getBoundingClientRect();
      const rc = color.getBoundingClientRect();
      const pillRect = pill.getBoundingClientRect();
      // Un punto a un pixel del borde del boton, por fuera: si el hitSlop llegara
      // al DOM, ese punto seria del boton. Si no, es de la pastilla.
      const fuera = (r, dx) => {
        const x = r.left + r.width / 2 + dx;
        const y = r.top + r.height / 2;
        const el = document.elementFromPoint(x, y);
        // Con el nombre del elemento: el texto de un glifo es un caracter de uso
        // privado y sale en blanco en la terminal, asi que un informe que dice
        // "hay '' ahi" no dice donde esta el dedo.
        const nombre = (n) =>
          !n
            ? "nada"
            : [
                n.tagName.toLowerCase(),
                n.getAttribute("aria-label"),
                (n.textContent || "").replace(/[\uE000-\uF8FF]/g, "").trim(),
                n.getAttribute("data-testid"),
              ]
                .filter(Boolean)
                .slice(0, 3)
                .join(" ");
        return {
          x: Math.round(x),
          y: Math.round(y),
          quien: el ? nombre(el).slice(0, 70) : "nada",
          sobreEl: el ? el.closest("[aria-label]")?.getAttribute("aria-label")?.slice(0, 40) ?? null : null,
          esElBoton: el === (dx < 0 ? quitar : color),
        };
      };
      const csColor = getComputedStyle(color);
      return {
        quitar: {
          rect: { x: rq.x, y: rq.y, width: rq.width, height: rq.height, right: rq.right },
          area: Math.round(rq.width * rq.height),
          hitSlopEnElDom: quitar.getAttribute("hitslop") ?? null,
          estiloHitSlop: csColor.getPropertyValue("hit-slop") || null,
          aLaIzquierda: fuera(rq, -1.5),
          aLaDerecha: fuera(rq, +1.5),
        },
        color: {
          rect: { x: rc.x, y: rc.y, width: rc.width, height: rc.height, right: rc.right },
          area: Math.round(rc.width * rc.height),
          borderColor: csColor.borderTopColor,
          borderWidth: csColor.borderTopWidth,
          backgroundColor: csColor.backgroundColor,
          aLaIzquierda: fuera(rc, -1.5),
          aLaDerecha: fuera(rc, +1.5),
        },
        hueco: Math.round((rc.left - rq.right) * 10) / 10,
        pillRect: { x: pillRect.x, y: pillRect.y, width: pillRect.width, height: pillRect.height, right: pillRect.right },
        pillFill: getComputedStyle(pill).backgroundColor,
      };
    })()
  `);

/** El color que la hoja cree que tiene ahora una etiqueta, por su `aria-label`. */
const resolvedColor = (tab, tag) =>
  tab.evaluate(`
    (() => {
      const el = document.querySelector('[data-testid=' + JSON.stringify("tag-color-button-" + ${JSON.stringify(tag)}) + ']');
      if (!el) return null;
      const label = el.getAttribute("aria-label") || "";
      const m = label.match(/ahora ([^,]+)$/);
      return { label, nombre: m ? m[1] : null };
    })()
  `);

const pressTestId = (tab, id) =>
  tab.evaluate(`
    (() => {
      const el = document.querySelector('[data-testid=' + ${JSON.stringify(id)} + ']');
      if (!el) return false;
      const b = el.getBoundingClientRect();
      if (b.width === 0 || b.height === 0) return false;
      el.click();
      return true;
    })()
  `);

/** Un atributo `testID` con texto de usuario dentro: nunca un selector de clase. */
const pressTestIdRaw = (tab, id) =>
  tab.evaluate(`
    (() => {
      const el = [...document.querySelectorAll("[data-testid]")]
        .find((d) => d.getAttribute("data-testid") === ${JSON.stringify(id)});
      if (!el) return false;
      const b = el.getBoundingClientRect();
      if (b.width === 0 || b.height === 0) return false;
      el.click();
      return true;
    })()
  `);

/** Un botón por su etiqueta accesible, dentro de un `root` si se dice. */
const pressLabel = (tab, needle, { exact = false, root = null } = {}) =>
  tab.evaluate(`
    (() => {
      const raiz = ${root ? `document.querySelector(${JSON.stringify(root)})` : "document"};
      if (!raiz) return false;
      const limpio = (s) => (s || "").replace(/[\\uE000-\\uF8FF]/g, "").trim();
      const want = limpio(${JSON.stringify(needle)}).toLowerCase();
      const el = [...raiz.querySelectorAll('[role="button"],[aria-label]')]
        .filter((e) => e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height > 0)
        .find((e) => {
          const label = limpio(e.getAttribute("aria-label") || "").toLowerCase();
          return ${exact ? "label === want" : "label.includes(want)"};
        });
      if (!el) return false;
      el.click();
      return true;
    })()
  `);

/** La lista de la URL: si la app está en otra pantalla, no se mide nada. */
const whereAmI = (tab) =>
  tab.evaluate(`(() => ({ path: location.pathname, rows: document.querySelectorAll('[data-testid^="item-row-"]').length }))()`);

/** Espera a que la lista esté pintada, y no un tiempo fijo. */
async function waitForRows(tab, { expect = 1, timeout = 45000 } = {}) {
  const deadline = Date.now() + timeout;
  let last = null;
  while (Date.now() < deadline) {
    await sleep(400);
    last = await whereAmI(tab).catch(() => null);
    if (last && last.rows >= expect) {
      await sleep(900);
      return last;
    }
  }
  const diag = await tab
    .evaluate(
      `(() => ({ path: location.pathname, textos: (document.body.innerText || "").replace(/\\s+/g, " ").slice(0, 200) }))()`,
    )
    .catch(() => null);
  throw new Error(`la lista no se quedo quieta: ${JSON.stringify(last)} — en pantalla: ${JSON.stringify(diag)}`);
}

/**
 * Espera a que algo llegue a ser un valor, en vez de leerlo una vez.
 *
 * `tagColors` no se mueve hasta que la escritura local vuelve de la caché, y la
 * caché se reescribe entera; un `await sleep(500)` después de un toque mide la
 * pantalla de antes del toque y la comprobación pasa o falla por casualidad.
 */
async function until(label, read, ok, { timeout = 20000, every = 350 } = {}) {
  const deadline = Date.now() + timeout;
  let value = null;
  while (Date.now() < deadline) {
    value = await read().catch(() => null);
    if (ok(value)) return { ok: true, value, waited: 0 };
    await sleep(every);
  }
  return { ok: false, value, waited: timeout };
}

/* ------------------------------------------------------------- la semilla -- */

/**
 * Las etiquetas de la semilla y el color que **cada una deduce**.
 *
 * El error que hizo falta corregir: "Mercadona" y "urgente" caen las dos en
 * `rose`, así que la semilla del plan no llegó nunca a poner dos colores deducidos
 * uno al lado del otro. Estas de aquí están elegidas para que en la fila de
 * "Huevos" se vean tres deducidos distintos —`rose`, `teal` y `blue`— y para que
 * en la fila de ocho etiquetas de la lista B haya `amber` justo al lado de
 * `orange`, que es la pareja que una persona no podría distinguir si fueran el
 * mismo color.
 */
const SEED_LABELS = {
  derivada: ["urgente", "perejil", "descuento"],
  /** La fila de ocho: cobertura, no realism. Sirve para medir y para mirar. */
  cobertura: ["Panadería", "obra", "casa", "farmacia", "verdura", "perejil", "limpieza", "descuento"],
  /** El máximo del contrato, una sola palabra, y por eso tiene que entrar entera. */
  larga: "suministrosdeferreteriaparaelbanodelbano",
};

check(
  "el hash de este archivo es el del contrato",
  derivedTagColor("Mercadona 🛒") === "green",
  `"Mercadona 🛒" → ${derivedTagColor("Mercadona 🛒")} (el test de la app clava "green")`,
);

/**
 * La semilla no sedegenera: al menos dos colores deducidos distintos entre las
 * etiquetas que van a verse juntas en una fila.
 *
 * Esta es la comprobación que hace que la anterior no vuelva a colarse. Si alguien
 * añade una etiqueta a la semilla y cae en el mismo color que las otras, falla
 * aquí y no en un par de semanas, cuando somebody mire dos capturas y no sepa lo
 * que está mirando.
 */
const deducidas = new Set(SEED_LABELS.derivada.map(derivedTagColor));
check(
  "la semilla lleva al menos dos colores deducidos distintos",
  deducidas.size >= 2,
  SEED_LABELS.derivada.map((t) => `${t} → ${derivedTagColor(t)}`).join(", "),
);
check(
  "la semilla lleva una etiqueta del máximo del contrato, de 40 caracteres",
  SEED_LABELS.larga.length === 40 && ICON_COLORS.includes(derivedTagColor(SEED_LABELS.larga)),
  `${SEED_LABELS.larga.length} caracteres, deduce ${derivedTagColor(SEED_LABELS.larga)}`,
);

/** La sesión viva. Vive fuera porque el token se renueva durante la ejecución. */
let sesion = null;

async function account() {
  try {
    const saved = JSON.parse(await readFile(SESSION_FILE, "utf8"));
    if ((await api("/auth/me", { token: saved.accessToken })).status === 200) return saved;
  } catch {
    /* ninguna todavia */
  }
  const email = `tags-${Date.now().toString(36)}@example.com`;
  const password = "a-very-long-password";
  const before = await readLog();
  await api("/auth/register", {
    method: "POST",
    body: {
      email,
      password,
      displayName: "Etiquetas",
      locale: "es",
      acceptedTermsAt: new Date().toISOString(),
      device: { label: "tags", platform: "web" },
    },
  });
  const deadline = Date.now() + 20000;
  let after = before;
  while (Date.now() < deadline && !/verify-email\?token=/.test(after.slice(before.length))) {
    await sleep(400);
    after = await readLog();
  }
  const link = after.slice(before.length).match(/verify-email\?token=([A-Za-z0-9_-]+)/);
  if (!link?.[1]) throw new Error("el correo de verificacion no salio en el log");
  await api("/auth/verify-email", { method: "POST", body: { token: link[1] } });
  const session = (
    await api("/auth/login", {
      method: "POST",
      body: { email, password, device: { label: "tags", platform: "web" } },
    })
  ).body.data.session;
  await writeFile(SESSION_FILE, JSON.stringify(session, null, 2));
  return session;
}

/* ----------------------------------------------------------- los resultados -- */

let problems = [];
const chrome = await launchChrome();
const arrancada = Date.now();
try {
  const session = await account();
  sesion = session;
  const CLIENT = "verify-tags";
  const ws = randomUUID();
  const listaA = randomUUID();
  const listaB = randomUUID();
  const at = new Date().toISOString();

  const itemA = {
    pan: randomUUID(),
    leche: randomUUID(),
    huevos: randomUUID(),
  };
  const itemB = {
    pan: randomUUID(),
    colada: randomUUID(),
    nevera: randomUUID(),
    ferreteria: randomUUID(),
  };

  const op = (entity, entityId, payload, extra = {}) => ({
    operationId: randomUUID(),
    clientId: CLIENT,
    entity,
    kind: "create",
    entityId,
    baseVersion: 0,
    base: null,
    clientTimestamp: at,
    payload,
    ...extra,
  });

  const ETIQUETAS_PAN = ["Mercadona"];
  const ETIQUETAS_HUEVOS = ["Mercadona", ...SEED_LABELS.derivada];

  const pushed = await api("/sync/push", {
    method: "POST",
    token: await tokenDeLaApi(),
    body: {
      deviceId: randomUUID(),
      lastPulledAt: null,
      operations: [
        op("workspace", ws, { name: "Colores", color: "teal" }),
        // La lista A arranca con un color **elegido** para "Mercadona" y la B sin
        // elegir ninguno: ese par es la comprobación de que dos listas no se
        // comparten un color. Sin él, las dos pintarían la misma pastilla y el
        // archivo entero pasaría sin comprobar nada.
        op("list", listaA, {
          workspaceId: ws,
          folderId: null,
          title: "Compra",
          kind: "tasks",
          tagColors: { Mercadona: "green" },
        }),
        op("list", listaB, { workspaceId: ws, folderId: null, title: "Semana", kind: "tasks", tagColors: {} }),
        op("list_item", itemA.pan, {
          listId: listaA,
          title: "Pan",
          position: 0,
          icon: "pan",
          iconStyle: "outline",
          iconColor: "amber",
          tags: ETIQUETAS_PAN,
        }),
        op("list_item", itemA.leche, { listId: listaA, title: "Leche", position: 1, tags: [] }),
        op("list_item", itemA.huevos, {
          listId: listaA,
          title: "Huevos",
          position: 2,
          priority: "high",
          tags: ETIQUETAS_HUEVOS,
        }),
        op("list_item", itemB.pan, { listId: listaB, title: "Pan", position: 0, tags: ETIQUETAS_PAN }),
        op("list_item", itemB.colada, {
          listId: listaB,
          title: "Colada",
          position: 1,
          tags: ["verdura", "perejil", "obra"],
        }),
        op("list_item", itemB.nevera, {
          listId: listaB,
          title: "Nevera",
          position: 2,
          // Con urgencia a propósito: la pregunta que hace la fila de ocho
          // etiquetas es si la insignia que estaba en el borde derecho se sale
          // cuando ya no cabe, y para que se salga tiene que haber una.
          priority: "high",
          tags: SEED_LABELS.cobertura,
        }),
        op("list_item", itemB.ferreteria, {
          listId: listaB,
          title: "Barato",
          position: 3,
          tags: [SEED_LABELS.larga],
        }),
        {
          operationId: randomUUID(),
          clientId: CLIENT,
          entity: "dashboard",
          kind: "update",
          entityId: "d5a0d1f2-4b3c-4a7e-9c2f-1b6d8e5a4f30",
          baseVersion: 0,
          base: null,
          clientTimestamp: at,
          payload: {
            layout: [
              {
                id: `list:${listaA}`,
                kind: "recent_lists",
                x: 0,
                y: 0,
                w: 1,
                h: 1,
                page: 0,
                pinned: true,
                settings: { listId: listaA, title: "Compra", kind: "tasks" },
              },
              {
                id: `list:${listaB}`,
                kind: "recent_lists",
                x: 1,
                y: 0,
                w: 1,
                h: 1,
                page: 0,
                pinned: true,
                settings: { listId: listaB, title: "Semana", kind: "tasks" },
              },
            ],
          },
        },
      ],
    },
  });

  const results = pushed.body?.data?.results ?? [];
  const rejected = results.filter((r) => r.status !== "applied");
  check(
    "la siembra se aplica, no solo se acepta",
    pushed.status === 200 && results.length > 0 && rejected.length === 0,
    `${results.length} operaciones${rejected.length ? `, ${rejected.length} RECHAZADAS: ${JSON.stringify(rejected[0])}` : ""}`,
  );

  tab = await openTab(chrome.port);
  await seedSession(tab, session, APP);
  await tab.send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: false,
  });
  // El SO se fija para que el `body` y la app digan lo mismo, y una discrepancia
  // signifique que uno de los dos miente.
  await tab.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-color-scheme", value: "light" }],
  });
  await tab.evaluate(
    `(() => { localStorage.setItem("orbithub:appearance", JSON.stringify({ appearance: "system", accent: "orbit" })); return true; })()`,
  );

  problems = collectProblems(tab);

  /** Va a una lista, espera a que se pinte, y devuelve las pastillas que hay. */
  const goToList = async (listId, expectRows) => {
    await tab.goto(`${APP}/list/${listId}`);
    await waitForRows(tab, { expect: expectRows });
  };

  /** Abre la hoja de etiquetas de una tarea. */
  const openLabels = async (listId, itemId, title) => {
    await goToList(listId, 1);
    const clicked = await pressLabel(tab, title, { exact: true, root: `[data-testid="item-row-${itemId}"]` });
    if (!clicked) throw new Error(`no se abrio la hoja de ${title}`);
    await sleep(700);
    const onTags = await pressLabel(tab, "Etiquetas", { exact: true });
    if (!onTags) throw new Error(`no se abrio la pagina de etiquetas de ${title}`);
    await sleep(700);
  };

  /* ----------------------------------------------------------------- 1 ------ */
  section("1. La consola y la lista");

  await goToList(listaA, 3);
  const problemasAntes = problems.length;
  check(
    "la lista de la compra se dibuja sin errores de consola",
    problems.length === problemasAntes,
    problems.slice(problemasAntes).map((p) => `${p.kind}: ${p.text.slice(0, 120)}`).join(" | ") || "0 problemas",
  );

  /* ----------------------------------------------------------------- 2 ------ */
  section("2. Cada pastilla es un color de la paleta, o el texto del tema");

  // El color que la pastilla lleva **decidido** se lee de la hoja, del `aria-label`
  // del botón de color, que es donde la app dice en palabras de qué color cree
  // que está la etiqueta. Es el único sitio donde los doce se ven en cualquier
  // esquema, y de donde sale la lista de nombres de arriba.
  await openLabels(listaA, itemA.pan, "Pan");
  const resueltos = {};
  for (const etiqueta of ["Mercadona", ...SEED_LABELS.derivada]) {
    resueltos[etiqueta] = await resolvedColor(tab, etiqueta);
  }
  const nombres = Object.values(resueltos).map((r) => r?.nombre ?? null);
  const claves = nombres.map((n) => (n ? (COLOR_BY_NAME[n] ?? null) : null));
  check(
    "cada etiqueta resuelve a uno de los doce colores de la paleta",
    claves.length > 0 && claves.every((c) => c && ICON_COLORS.includes(c)),
    Object.entries(resueltos)
      .map(([t, r]) => `${t} → ${r?.nombre ?? "sin boton"}`)
      .join(", "),
  );
  await pressLabel(tab, "Volver", { exact: true });
  await sleep(500);
  await pressLabel(tab, "Cerrar", { exact: true });
  await sleep(700);

  // Y lo que se ve en la fila: el texto de la pastilla o el color de la paleta o el
  // texto del tema. Nunca un color que no sea de este grupo, que es lo que
  // significaría una etiqueta sin color.
  const pastillasA = await pillsOfRow(tab, itemA.huevos, ETIQUETAS_HUEVOS);
  const pastillasPan = await pillsOfRow(tab, itemA.pan, ETIQUETAS_PAN);
  const todasA = [...(pastillasPan ?? []), ...(pastillasA ?? [])];
  const temaDeA = schemeOfFill(todasA[0]?.fill ?? toRgb(SCHEME.light.fill));
  const permitidos = new Set([
    ...Object.values(ICON_HEX).map(toRgb),
    toRgb(SCHEME[temaDeA].text),
  ]);
  const fueraDePaleta = todasA.filter((p) => !permitidos.has(p.textColor));
  check(
    "el texto de cada pastilla es un color de la paleta o el del tema",
    todasA.length >= 4 && fueraDePaleta.length === 0,
    `${todasA.length} pastillas en ${temaDeA}, fuera de la paleta: ${fueraDePaleta.map((p) => `${p.tag} ${p.textColor}`).join(", ") || "ninguna"}`,
  );

  // La grey de la paleta (neutral) solo puede salir si neutral es el color
  // deducido o el elegido. Un gris que aparece sin haberlo pedido sería el "sin
  // color" que el contrato dice que no existe.
  const grises = todasA.filter((p) => p.textColor === toRgb(ICON_HEX.neutral));
  check(
    "ninguna pastilla cae en gris por defecto",
    grises.every((p) => derivedTagColor(p.tag) === "neutral" || resueltos[p.tag]?.nombre === "Neutro"),
    grises.length === 0 ? "ninguna" : grises.map((p) => p.tag).join(", "),
  );

  /* ------------------------------------------------------------- 2b -------- */
  section("2b. La semilla enseña dos colores deducidos distintos, y eso se comprueba");

  // El mismo razonamiento de antes, pero sobre lo que hay en pantalla y no sobre
  // lo que dice la semilla: si las etiquetas deducidas de esta fila se pintaran
  // todas en el mismo color, la comprobación entera habría pasado sin que nadie
  // hubiera visto dos colores deducidos juntos.
  const deducidasEnPantalla = SEED_LABELS.derivada.map(
    (t) => ({ tag: t, key: derivedTagColor(t), pintado: pastillasA.find((p) => p.tag === t)?.textColor }),
  );
  const clavesEnPantalla = new Set(deducidasEnPantalla.map((d) => d.key));
  check(
    "en la fila de Huevos hay al menos dos colores deducidos distintos",
    clavesEnPantalla.size >= 2,
    deducidasEnPantalla
      .map((d) => `${d.tag} → ${d.key} (pintado ${d.pintado})`)
      .join(", "),
  );
  const pintados = new Set(deducidasEnPantalla.map((d) => d.pintado));
  note(
    `de esos ${clavesEnPantalla.size} deducidos, en claro se pintan ${pintados.size} colores distintos: ${[...pintados].join(", ")}`,
  );
  check(
    "la fila de cobertura lleva los doce deducidos repartidos, con ambar junto a naranja",
    new Set(SEED_LABELS.cobertura.map(derivedTagColor)).size >= 5,
    SEED_LABELS.cobertura.map((t) => `${t}→${derivedTagColor(t)}`).join(", "),
  );

  /* ------------------------------------------------------- las capturas ------ */
  section("2c. Las capturas del estado sembrado, en los dos esquemas");

  // **Antes de tocar nada.** Las capturas del final ya están después de que este
  // archivo haya cambiado cuatro colores, y una captura de "después" no dice cómo
  // se ve la lista que alguien se encuentra al abrirla por primera vez. Las dos
  // series se guardan: la de aquí es el diseño y la del final es la consecuencia.
  //
  // Y por cada fila cuenta cuántas pastillas llevan su propio color, que es el
  // número que hace falta para mirar la captura y saber qué se está mirando.
  const repartoDeColores = (pastillas, esquema) => {
    const enSuColor = pastillas.filter((p) =>
      Object.values(ICON_HEX)
        .map(toRgb)
        .includes(p.textColor),
    );
    const enElTema = pastillas.length - enSuColor.length;
    const pintados = [...new Set(pastillas.map((p) => p.textColor))];
    note(
      `${esquema}: ${pastillas.length} pastillas, ${enSuColor.length} en su propio color (${enSuColor.map((p) => p.tag).join(", ") || "ninguna"}), ${enElTema} en el texto del tema, y ${pintados.length} colores distintos pintados: ${pintados.join(" / ")}`,
    );
    return { enSuColor: enSuColor.length, enElTema, distintos: pintados.length };
  };

  const capturas = async (listId, expectRows, nombre) => {
    for (const esquema of ["light", "dark"]) {
      await tab.send("Emulation.setEmulatedMedia", {
        features: [{ name: "prefers-color-scheme", value: esquema }],
      });
      await tab.goto(`${APP}/list/${listId}`);
      await waitForRows(tab, { expect: expectRows });
      const leido = await pillOf(
        tab,
        "Mercadona",
        `[data-testid="item-row-${listId === listaA ? itemA.pan : itemB.pan}"]`,
      );
      if (!leido) {
        note(`${nombre}-${esquema}: no se encontró la pastilla de Mercadona`);
        continue;
      }
      note(
        `${nombre}-${esquema}: relleno ${leido.fill} (${schemeOfFill(leido.fill)}), texto ${leido.textColor}`,
      );
      await tab.screenshot(`${SHOTS}/${nombre}-${esquema === "light" ? "claro" : "oscuro"}.png`);
      if (listId === listaA) {
        repartoDeColores(await pillsOfRow(tab, itemA.huevos, ETIQUETAS_HUEVOS), `${nombre} Huevos ${esquema}`);
      } else {
        repartoDeColores(await pillsOfRow(tab, itemB.nevera, SEED_LABELS.cobertura), `${nombre} Nevera ${esquema}`);
      }
    }
  };

  await capturas(listaA, 3, "etiquetas-01-lista-compra");
  await capturas(listaB, 4, "etiquetas-02-lista-semana");

  for (const esquema of ["light", "dark"]) {
    await tab.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-color-scheme", value: esquema }],
    });
    await openLabels(listaA, itemA.huevos, "Huevos");
    await pressTestIdRaw(tab, `tag-color-button-urgente`);
    await sleep(900);
    await tab.screenshot(
      `${SHOTS}/etiquetas-03-hoja-etiquetas-${esquema === "light" ? "claro" : "oscuro"}.png`,
    );
    await pressLabel(tab, "Cerrar", { exact: true }).catch(() => false);
    await sleep(600);
  }
  await tab.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-color-scheme", value: "light" }],
  });

  // La fila de ocho etiquetas es la que una persona juzga de un vistazo, así que
  // lo que hay que asegurar es que en ella se ven al menos dos colores de verdad y
  // no ocho pastillas iguales: si no, las capturas no sirven para mirar nada.
  const filaOcho = {};
  for (const esquema of ["light", "dark"]) {
    await tab.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-color-scheme", value: esquema }],
    });
    await goToList(listaB, 4);
    filaOcho[esquema] = repartoDeColores(
      await pillsOfRow(tab, itemB.nevera, SEED_LABELS.cobertura),
      `fila de ocho, ${esquema}`,
    );
  }
  await tab.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-color-scheme", value: "light" }],
  });
  check(
    "una fila de ocho etiquetas muestra al menos dos colores de verdad, y no ocho pastillas iguales",
    filaOcho.light.distintos >= 2 && filaOcho.dark.distintos >= 2,
    `claro: ${filaOcho.light.enSuColor}/8 en su color, ${filaOcho.light.distintos} colores pintados; oscuro: ${filaOcho.dark.enSuColor}/8, ${filaOcho.dark.distintos} pintados`,
  );

  /* ----------------------------------------------------------------- 3 ------ */
  section("3. Dos listas, la misma etiqueta, dos colores");

  // La etiqueta compartida, leída en las dos listas y en los dos esquemas.
  //
  // **Y aquí está la primera cosa que la comprobación tenía mal.** Se iba a
  // comprobar que la misma pastilla se ve distinta en la lista A y en la B
  // leyendo el color del texto, pero el color del texto **no es el color de la
  // etiqueta**: `labelTextColor` lo cambia por el del tema cuando el suyo no llega
  // a 4.5:1 sobre el relleno de la pastilla, y el verde y el rosa no llegan
  // ninguno de los dos en claro. Las dos pastillas de "Mercadona" se ven
  // idénticas píxel a píxel en el tema claro, y no porque compartan color.
  //
  // Así que la comprobación va por donde la app dice el color de verdad —el
  // `aria-label` del botón de su hoja, que nombra los doce en cualquier esquema—,
  // y **además** se mide y se dice qué pasa en pantalla, que es el dato que hace
  // falta para juzgar la fila de pastillas, no sólo para que el archivo pase.
  const colorResueltoDe = async (listId, itemId, title, etiqueta) => {
    await openLabels(listId, itemId, title);
    const r = await resolvedColor(tab, etiqueta);
    await pressLabel(tab, "Volver", { exact: true }).catch(() => false);
    await sleep(350);
    await pressLabel(tab, "Cerrar", { exact: true }).catch(() => false);
    await sleep(700);
    return COLOR_BY_NAME[r?.nombre ?? ""] ?? null;
  };

  const claveAAntes = await colorResueltoDe(listaA, itemA.pan, "Pan", "Mercadona");
  const claveBAntes = await colorResueltoDe(listaB, itemB.pan, "Pan", "Mercadona");
  check(
    "antes de tocar nada, la misma etiqueta es de un color en cada lista",
    claveAAntes === "green" && claveBAntes === derivedTagColor("Mercadona"),
    `A tiene ${claveAAntes} (elegido en la semilla) y B deduce ${claveBAntes} de su nombre, sin que nadie lo haya elegido`,
  );
  check(
    "las dos listas no comparten el color de la etiqueta, que es de lo que trata la comprobación",
    claveAAntes !== claveBAntes,
    `A ${claveAAntes}, B ${claveBAntes}`,
  );

  // Y qué se ve de eso, esquema por esquema, que es el número que hace falta para
  // mirar las capturas y saber qué se está mirando.
  const enPantalla = {};
  for (const esquema of ["light", "dark"]) {
    await tab.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-color-scheme", value: esquema }],
    });
    await goToList(listaA, 3);
    const a = await pillOf(tab, "Mercadona", `[data-testid="item-row-${itemA.pan}"]`);
    await goToList(listaB, 4);
    const b = await pillOf(tab, "Mercadona", `[data-testid="item-row-${itemB.pan}"]`);
    enPantalla[esquema] = { a: a?.textColor, b: b?.textColor, distinto: a?.textColor !== b?.textColor };
    note(
      `en ${esquema}: A pinta ${a?.textColor} y B pinta ${b?.textColor} — ${a?.textColor === b?.textColor ? "la misma pastilla" : "distintas"}`,
    );
  }
  await tab.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-color-scheme", value: "light" }],
  });
  check(
    "la etiqueta compartida se ve distinta en al menos uno de los dos esquemas",
    Object.values(enPantalla).some((v) => v.distinto),
    `claro: ${enPantalla.light.distinto ? "distintas" : "idénticas píxel a píxel"}; oscuro: ${enPantalla.dark.distinto ? "distintas" : "idénticas píxel a píxel"}`,
  );
  note(
    `es la regla de contraste la que lo decide: verde sobre la pastilla da ${contrastRatio(ICON_HEX.green, SCHEME.light.fill).toFixed(2)}:1 en claro y ${contrastRatio(ICON_HEX.green, SCHEME.dark.fill).toFixed(2)}:1 en oscuro; rosa da ${contrastRatio(ICON_HEX.rose, SCHEME.light.fill).toFixed(2)} y ${contrastRatio(ICON_HEX.rose, SCHEME.dark.fill).toFixed(2)}`,
  );

  // Lo que hay que quedarse para el final: la pastilla de B tal y como estaba,
  // para poder decir que no se movió.
  await goToList(listaB, 4);
  const pastillaBAntes = await pillOf(tab, "Mercadona", `[data-testid="item-row-${itemB.pan}"]`);
  const bAntesFirmado = JSON.stringify(pastillaBAntes);

  // Y el color elegido de A es el que dice el botón de su hoja.
  await openLabels(listaA, itemA.pan, "Pan");
  const nombreEnA = await resolvedColor(tab, "Mercadona");
  check(
    "la lista A tiene el color que se le eligió a Mercadona",
    COLOR_BY_NAME[nombreEnA?.nombre ?? ""] === "green",
    `${nombreEnA?.label ?? "sin boton"}`,
  );

  const abierto = await pressTestIdRaw(tab, `tag-color-button-Mercadona`);
  check("el botón de color de la etiqueta abre su tira", abierto, "abierto");
  await sleep(600);
  const tiraAbierta = await sheetState(tab);
  check(
    "abrir la tira no saca la hoja de la página de etiquetas",
    tiraAbierta.pagina === "tags" && tiraAbierta.tiras > 0,
    `página "${tiraAbierta.pagina}", tiras abiertas ${tiraAbierta.tiras}`,
  );
  const pressedRed = await pressTestIdRaw(tab, `tag-color-Mercadona-red`);
  check("el color se elige desde la tira de la etiqueta", pressedRed, "rojo");
  const puestoEnRojo = await until(
    "el color de la etiqueta",
    async () => ({ color: await resolvedColor(tab, "Mercadona"), hoja: await sheetState(tab) }),
    (v) => COLOR_BY_NAME[v?.color?.nombre ?? ""] === "red",
  );
  // **El fallo que encontró este archivo.** Elegir un color devuelve la hoja a la
  // página de edición. La escritura local relee la caché y devuelve objetos
  // nuevos, así que el `useEffect` que reinicia la hoja al abrirse volvía a poner
  // la página en `startOn` —que para quien llega por el nombre de la tarea es
  // "edit"— con cada cambio. Elegir dos colores era pulsar dos veces "Etiquetas".
  check(
    "elegir un color deja la hoja en la página de etiquetas, con la tira cerrada",
    puestoEnRojo.ok && puestoEnRojo.value?.hoja?.pagina === "tags" && puestoEnRojo.value?.hoja?.tiras === 0,
    `la hoja quedó en "${puestoEnRojo.value?.hoja?.pagina}" con ${puestoEnRojo.value?.hoja?.tiras} tiras abiertas`,
  );
  await sleep(900);

  const enAAhora = await resolvedColor(tab, "Mercadona");
  const pastillaAAtras = await pillOf(tab, "Mercadona", `[data-testid="item-row-${itemA.pan}"]`);
  const esperadoEnA = toRgb(expectedTextColor("red", "light"));
  check(
    "la etiqueta de A pasa a rojo, y se ve el color que la regla de contraste manda",
    COLOR_BY_NAME[enAAhora?.nombre ?? ""] === "red" && pastillaAAtras?.textColor === esperadoEnA,
    `la hoja dice ${enAAhora?.nombre}, la pastilla pinta ${pastillaAAtras?.textColor}, y para rojo en claro la regla da ${esperadoEnA} (rojo puro ${toRgb(ICON_HEX.red)} da ${contrastRatio(ICON_HEX.red, SCHEME.light.fill).toFixed(2)}:1, o sea no llega a 4.5)`,
  );

  await pressLabel(tab, "Volver", { exact: true });
  await sleep(400);
  await pressLabel(tab, "Cerrar", { exact: true });
  await sleep(900);

  // **La comprobación que el plan pide y que ningún test unitario puede hacer.**
  // La pastilla de "Mercadona" en la lista B, byte a byte, antes y después de
  // cambiar el color de la lista A. Un mapa a nivel de módulo, indexado por el
  // nombre de la etiqueta, pasa todas las pruebas de `docs/` y falla exactamente
  // aquí: escribes rojo en una lista y la otra cambia sola, sin que nadie lo
  // pidiera y sin que ninguna operación de sincronización lo mencione.
  await goToList(listaB, 4);
  const pastillaBDespues = await pillOf(tab, "Mercadona", `[data-testid="item-row-${itemB.pan}"]`);
  check(
    "la etiqueta compartida en la OTRA lista no se ha movido ni un byte",
    JSON.stringify(pastillaBDespues) === bAntesFirmado,
    `antes ${pastillaBAntes?.textColor}, después ${pastillaBDespues?.textColor} — y no se comprueba contra un valor fijo sino contra lo que tenía hace un momento`,
  );

  /* ----------------------------------------------------------------- 4 ------ */
  section("4. Cambiar un color cambia todas las filas que llevan la etiqueta");

  await goToList(listaA, 3);
  const enHuevos = await pillOf(tab, "Mercadona", `[data-testid="item-row-${itemA.huevos}"]`);
  const esperadoHuevos = toRgb(expectedTextColor("red", "light"));
  check(
    "una fila que la escritura ni menciona se repinta igual",
    enHuevos?.textColor === esperadoHuevos,
    `la pastilla de Mercadona en Huevos es ${enHuevos?.textColor}, y la de Pan ${pastillaAAtras?.textColor}`,
  );

  /* ----------------------------------------------------------------- 5 ------ */
  section("5. Una etiqueta sin color elegido pinta el deducido, y el mismo en la segunda carga");

  const urgenteAntes = await pillOf(tab, "urgente", `[data-testid="item-row-${itemA.huevos}"]`);
  const urgenteDeducedido = derivedTagColor("urgente");
  const esperadoUrgente = toRgb(expectedTextColor(urgenteDeducedido, "light"));
  check(
    "una etiqueta sin color elegido se pinta con el color que deduce su nombre",
    urgenteAntes?.textColor === esperadoUrgente,
    `urgente deduce ${urgenteDeducedido} y en claro la pastilla pinta ${urgenteAntes?.textColor}`,
  );

  await goToList(listaA, 3);
  const urgenteReload = await pillOf(tab, "urgente", `[data-testid="item-row-${itemA.huevos}"]`);
  check(
    "el color deducido es el mismo en una segunda carga",
    urgenteReload?.textColor === urgenteAntes?.textColor,
    `${urgenteAntes?.textColor} antes y ${urgenteReload?.textColor} después de recargar`,
  );

  /* ----------------------------------------------------------------- 6 ------ */
  section("6. Un color elegido sin conexión se repinta y llega al servidor al volver");

  await openLabels(listaA, itemA.huevos, "Huevos");
  const problemaAntesDeCortar = problems.length;
  await tab.send("Network.emulateNetworkConditions", {
    offline: true,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
  await sleep(600);

  await pressTestIdRaw(tab, `tag-color-button-urgente`);
  await sleep(600);
  const offlineTira = await pressTestIdRaw(tab, `tag-color-urgente-blue`);
  check("sin conexión se puede elegir un color", offlineTira, "azul");
  const repintada = await until(
    "el color sin conexión",
    async () => ({
      color: await resolvedColor(tab, "urgente"),
      pastilla: await pillOf(tab, "urgente"),
      hoja: await sheetState(tab),
    }),
    (v) => COLOR_BY_NAME[v?.color?.nombre ?? ""] === "blue",
    { timeout: 20000 },
  );
  check(
    "el color se repinta sin recargar, y el que se pinta es el de la regla de contraste",
    repintada.ok && repintada.value?.pastilla?.textColor === toRgb(expectedTextColor("blue", "light")),
    `la hoja dice ${repintada.value?.color?.nombre} y la pastilla ${repintada.value?.pastilla?.textColor} (azul puro en claro da ${contrastRatio(ICON_HEX.blue, SCHEME.light.fill).toFixed(2)}:1)`,
  );
  check(
    "sin conexión tampoco se pierde la página de etiquetas",
    repintada.value?.hoja?.pagina === "tags" && repintada.value?.hoja?.tiras === 0,
    `la hoja quedó en "${repintada.value?.hoja?.pagina}" con ${repintada.value?.hoja?.tiras} tiras abiertas`,
  );

  // Y que estaba de verdad sin conexión, no "todavía no había llegado": el servidor
  // no lo tiene.
  const servidorDurante = (await api(`/lists/${listaA}`, { token: await tokenDeLaApi() })).body?.data?.tagColors;
  check(
    "mientras no hay conexión el servidor no lo tiene",
    servidorDurante?.urgente !== "blue",
    `el servidor dice ${JSON.stringify(servidorDurante)}`,
  );
  const erroresPorCortar = problems.length - problemaAntesDeCortar;
  note(`${erroresPorCortar} errores de consola durante el corte (red rota, no aplicación)`);

  await tab.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });

  section("7. Dos listas, dos mapas de colores, en la API");
  const began = Date.now();
  const drenado = await until(
    "el vaciado",
    async () => {
      const leido = (await api(`/lists/${listaA}`, { token: await tokenDeLaApi() })).body?.data?.tagColors;
      return leido;
    },
    (m) => m?.urgente === "blue",
    // El motor de sincronización se dispara con una escritura local, al
    // autenticarse, al volver la conexión y cada 120 s. Volver la conexión en el
    // navegador **no** es un evento que NetInfo vea (`navigator.onLine` sigue
    // siendo `true` con `Network.emulateNetworkConditions`), así que el vaciado
    // normal aquí es el temporizador de 120 s. El plazo es ese más un margen.
    { timeout: 150000, every: 2000 },
  );
  note(`el vaciado tardó ${Math.round((Date.now() - began) / 1000)} s desde que volvio la conexion`);
  check(
    "al volver la conexion el color llega al servidor",
    drenado.ok,
    drenado.ok ? `azul en el servidor` : `el servidor sigue con ${JSON.stringify(drenado.value)}`,
  );

  const listaAApi = (await api(`/lists/${listaA}`, { token: await tokenDeLaApi() })).body?.data;
  const listaBApi = (await api(`/lists/${listaB}`, { token: await tokenDeLaApi() })).body?.data;
  check(
    "la lista A guardo su mapa entero",
    listaAApi?.tagColors?.Mercadona === "red" &&
      listaAApi?.tagColors?.urgente === "blue" &&
      Object.keys(listaAApi?.tagColors ?? {}).length === 2,
    JSON.stringify(listaAApi?.tagColors),
  );
  check(
    "la lista B no guardo nada, ni el color de A ni el de la etiqueta compartida",
    Object.keys(listaBApi?.tagColors ?? {}).length === 0,
    `B tiene ${JSON.stringify(listaBApi?.tagColors)}`,
  );

  await pressLabel(tab, "Volver", { exact: true }).catch(() => false);
  await sleep(300);
  await pressLabel(tab, "Cerrar", { exact: true }).catch(() => false);
  await sleep(700);

  /* ------------------------------------------------------ las mediciones ----- */
  section("8. Los objetivos de pulsación, medidos");

  await openLabels(listaA, itemA.huevos, "Huevos");
  await pressTestIdRaw(tab, `tag-color-button-Mercadona`);
  await sleep(600);
  const medidas = await chipActions(tab, "Mercadona");
  if (!medidas || !medidas.quitar || !medidas.color) {
    check(
      "los dos botones de dentro de la pastilla se pueden medir",
      false,
      `en la pastilla hay: ${JSON.stringify(medidas?.hay ?? medidas)}`,
    );
  } else {
    note(`quitar  ${JSON.stringify(medidas.quitar.rect)}  area ${medidas.quitar.area} pt²`);
    note(`color   ${JSON.stringify(medidas.color.rect)}  area ${medidas.color.area} pt²`);
    note(`hueco entre los dos: ${medidas.hueco} pt`);
    check(
      "los dos botones de dentro de la pastilla miden 24×24",
      medidas.quitar.rect.width === 24 && medidas.quitar.rect.height === 24 &&
        medidas.color.rect.width === 24 && medidas.color.rect.height === 24,
      `quitar ${medidas.quitar.rect.width}×${medidas.quitar.rect.height}, color ${medidas.color.rect.width}×${medidas.color.rect.height}`,
    );
    // El `hitSlop={8}` de los dos. En `react-native-web@0.21.2` `hitSlop` solo
    // aparece en `exports/Touchable`, y `Pressable` no lo pasa a `createDOMProps`,
    // así que en el navegador no llega a ser nada. Esto no lo da por supuesto: un
    // punto a 1,5 pt por fuera del borde del botón, que es lo que un dedo que
    // falla por tres píxeles toca de verdad.
    check(
      "hitSlop={8} no llega al DOM en web: fallar por 1,5 pt no es el boton",
      medidas.quitar.aLaDerecha.esElBoton === false &&
        medidas.color.aLaDerecha.esElBoton === false &&
        medidas.quitar.aLaIzquierda.esElBoton === false &&
        medidas.color.aLaIzquierda.esElBoton === false,
      `elementFromPoint a 1,5 pt por fuera del boton de quitar devuelve "${medidas.quitar.aLaDerecha.quien}", y a 1,5 pt del boton de color "${medidas.color.aLaDerecha.quien}": el hitSlop de 8 pt no llega ni al DOM ni al punto de golpeo, y los cuatro intentos a 1,5 pt dan el mismo booleano`,
    );
    note(
      `1,5 pt a la izquierda del boton de quitar: "${medidas.quitar.aLaIzquierda.quien}" (el boton mas cercano: ${medidas.quitar.aLaIzquierda.sobreEl ?? "ninguno"})`,
    );
    note(
      `1,5 pt a la derecha del boton de quitar, que es el hueco de los 2 pt: "${medidas.quitar.aLaDerecha.quien}" (el boton mas cercano: ${medidas.quitar.aLaDerecha.sobreEl ?? "ninguno"})`,
    );
    check(
      "los dos botones no se pisan, y el hueco entre ellos es el que hay",
      medidas.hueco > 0 && medidas.quitar.rect.right <= medidas.color.rect.x,
      `hueco medido ${medidas.hueco} pt entre un botón que acaba en ${Math.round(medidas.quitar.rect.right)} y otro que empieza en ${Math.round(medidas.color.rect.x)}`,
    );
    note(
      `borde del boton de color abierto: ${medidas.color.borderWidth} ${medidas.color.borderColor} sobre ${medidas.pillFill}`,
    );
  }
  await pressTestIdRaw(tab, `tag-color-Mercadona-derived`).catch(() => false);
  await sleep(600);

  section("9. El acento esmeralda en claro");
  await pressLabel(tab, "Cerrar", { exact: true }).catch(() => false);
  await sleep(500);
  await tab.evaluate(
    `(() => { localStorage.setItem("orbithub:appearance", JSON.stringify({ appearance: "light", accent: "emerald" })); return true; })()`,
  );
  await openLabels(listaA, itemA.huevos, "Huevos");
  await pressTestIdRaw(tab, `tag-color-button-Mercadona`);
  await sleep(800);
  const esmeralda = await chipActions(tab, "Mercadona");
  if (!esmeralda || !esmeralda.color) {
    check(
      "el boton de color abierto con acento esmeralda se puede medir",
      false,
      `en la pastilla hay: ${JSON.stringify(esmeralda?.hay ?? esmeralda)}`,
    );
  } else {
    // `#0E9F6E` (el esmeralda de claro) sobre `#F0F2F8` (el relleno de la pastilla).
    // El minimum de WCAG para un borde que dibuja una interfaz es 3:1, y esto es
    // 3.02:1: pasa por dos centésimas. Con `orbit` son 4.64:1 y con `violet` 5.09:1.
    const r = contrastRatio("#0E9F6E", SCHEME.light.fill);
    note(`borde abierto: ${esmeralda.color.borderWidth} ${esmeralda.color.borderColor} sobre ${esmeralda.pillFill}`);
    check(
      "el borde del boton de color abierto llega a 3:1 en el acento esmeralda",
      esmeralda.color.borderWidth === "2px" && r >= 3,
      `${esmeralda.color.borderWidth} ${esmeralda.color.borderColor} sobre ${esmeralda.pillFill} = ${r.toFixed(2)}:1 (orbit 4.64, violet 5.09)`,
    );
    check(
      "el fondo del boton abierto no es lo que dice que esta abierto",
      contrastRatio("#E1F6EE", SCHEME.light.fill) < 1.05,
      `accentSoft de esmeralda sobre la pastilla = ${contrastRatio("#E1F6EE", SCHEME.light.fill).toFixed(3)}:1, y el borde es lo unico que lo dice`,
    );
  }
  await tab.screenshot(`${SHOTS}/etiquetas-04-acento-esmeralda-claro.png`);
  // El mismo boton abierto con el acento por defecto al lado, que es la
  // comparacion que hace falta: 3.02:1 del esmeralda contra 4.64:1 del orbit se
  // ven en dos ficheros, no en dos numeros.
  await tab.evaluate(
    `(() => { localStorage.setItem("orbithub:appearance", JSON.stringify({ appearance: "light", accent: "orbit" })); return true; })()`,
  );
  await openLabels(listaA, itemA.huevos, "Huevos");
  await pressTestIdRaw(tab, `tag-color-button-Mercadona`);
  await sleep(800);
  await tab.screenshot(`${SHOTS}/etiquetas-04b-acento-orbit-claro.png`);
  await tab.evaluate(
    `(() => { localStorage.setItem("orbithub:appearance", JSON.stringify({ appearance: "system", accent: "orbit" })); return true; })()`,
  );

  /* ------------------------------------------------------- la geometría ------ */
  section("10. Las lineas de pastillas y la etiqueta de 40 caracteres");

  await goToList(listaB, 4);
  const geo = {};
  geo.una = await linesOfRow(tab, itemB.pan, ETIQUETAS_PAN);
  geo.tres = await linesOfRow(tab, itemB.colada, ["verdura", "perejil", "obra"]);
  geo.ocho = await linesOfRow(tab, itemB.nevera, SEED_LABELS.cobertura);
  geo.larga = await linesOfRow(tab, itemB.ferreteria, [SEED_LABELS.larga]);
  for (const [k, v] of Object.entries(geo)) {
    note(
      `${k}: ${v.pillCount} pastillas en ${v.lines} líneas, alto de la fila ${Math.round(v.rowHeight)} pt, la fila mide ${Math.round(v.rowWidth)} y lo de más a la derecha llega a ${Math.round(v.rightmost)}` +
        (v.insignia ? `, insignia "${v.insignia.texto}" de ${Math.round(v.insignia.left)} a ${Math.round(v.insignia.right)}` : ", sin insignia"),
    );
  }
  check(
    "una pastilla mas ancha que la fila se parte por dentro y no se corta",
    geo.larga.rightmost <= geo.larga.rowWidth + 1,
    `la pastilla llega a ${Math.round(geo.larga.rightmost)} y la fila mide ${Math.round(geo.larga.rowWidth)}`,
  );
  const largaTexto = await pillOf(tab, SEED_LABELS.larga, `[data-testid="item-row-${itemB.ferreteria}"]`);
  // Se comprueba que **cabe**, no que se parte: a 390 de ancho una etiqueta de
  // 40 caracteres en minúscula ocupa unos 224 pt y la línea de la fila da para
  // unos 236, así que entra entera en una línea y no hay nada que partir. La
  // primera versión de esta comprobación pedía dos líneas y fallaba por una
  // Medición mal hecha, no por un fallo del producto.
  //
  // Lo que sí importa, y lo que se mide, es que la pastilla **no se salga**: ni
  // por la derecha ni por un `overflow` que la corte en dos. Y que llegue al
  // máximo del contrato sin recortarse, porque un nombre de 40 caracteres es lo
  // que `tagColorSchema` admite y lo que alguien puede haber escrito.
  check(
    "la etiqueta mas larga del contrato entra entera, sin salirse ni cortarse",
    largaTexto !== null &&
      largaTexto.lines >= 1 &&
      largaTexto.rect.right <= geo.larga.rowWidth + 1 &&
      largaTexto.rect.width > 0,
    `${SEED_LABELS.larga.length} caracteres en ${largaTexto?.lines} línea(s), ancho ${Math.round(largaTexto?.rect.width ?? 0)} pt, llega a ${Math.round(largaTexto?.rect.right ?? 0)} de una fila de ${Math.round(geo.larga.rowWidth)}`,
  );
  check(
    "el texto de la pastilla larga se ve entero, no cortado con puntos suspensivos",
    largaTexto !== null && (largaTexto.text ?? "").length === SEED_LABELS.larga.length,
    `la pastilla dice "${largaTexto?.text}"`,
  );
  check(
    "las ocho etiquetas de una fila se reparten en lineas",
    geo.ocho.lines >= 2,
    `${geo.ocho.lines} lineas para ${geo.ocho.pillCount} etiquetas, alto de la fila ${Math.round(geo.ocho.rowHeight)} pt, y ${Math.round(geo.ocho.pillHeight ?? 0)} pt por linea de pastillas`,
  );
  check(
    "la insignia de urgencia sigue entera al lado de ocho etiquetas",
    geo.ocho.insignia?.entera === true,
    geo.ocho.insignia
      ? `"${geo.ocho.insignia.texto}" va de ${Math.round(geo.ocho.insignia.left)} a ${Math.round(geo.ocho.insignia.right)} y la fila acaba en ${Math.round(geo.ocho.rowWidth)}`
      : "no se encontró ninguna insignia en la fila de ocho etiquetas",
  );
  check(
    "una pastilla, tres y ocho caben en la misma pantalla sin empujar nada",
    [geo.una, geo.tres, geo.ocho].every((g) => g.rightmost <= g.rowWidth + 1 && g.rowHeight <= 200),
    `altos: 1 etiqueta ${Math.round(geo.una.rowHeight)} pt, 3 ${Math.round(geo.tres.rowHeight)} pt, 8 ${Math.round(geo.ocho.rowHeight)} pt`,
  );

  section("11. Los dos '+' de la hoja de etiquetas");
  // "Leche" y no "Huevos", y por un motivo que la primera ejecución destapó: la
  // fila de "ya usadas en esta lista" **filtra las etiquetas que la tarea ya
  // lleva** —no puede ofrecer poner lo que ya está puesto—, así que en una tarea
  // con todas las etiquetas de la lista no hay ningún "+" de poner y el otro "+"
  // no se puede comparar con nadie. Una tarea sin etiquetas es la única que
  // tiene los dos.
  await openLabels(listaA, itemA.leche, "Leche");
  const signos = await tab.evaluate(`
    (() => {
      const limp = (s) => (s || "").replace(/[\\uE000-\\uF8FF]/g, "").trim();
      // Dentro del panel y no en el documento: la lista de detrás también tiene
      // botones con esos nombres, y va primero en el orden del documento.
      const panel = document.querySelector('[data-testid="sheet-panel"]');
      const raiz = panel ?? document;
      const poner = [...raiz.querySelectorAll("[aria-label]")].find((b) => (b.getAttribute("aria-label") || "").startsWith("Poner la etiqueta"));
      const anadir = [...raiz.querySelectorAll("[aria-label],button")].find((b) => limp(b.innerText) === "Añadir etiqueta");
      if (!poner || !anadir) {
        return {
          sinPoner: !poner,
          sinAnadir: !anadir,
          hay: [...raiz.querySelectorAll("[aria-label],button")]
            .map((b) => (b.getAttribute("aria-label") || b.innerText || "").trim())
            .filter(Boolean)
            .slice(0, 24),
        };
      }
      const rp = poner.getBoundingClientRect();
      const ra = anadir.getBoundingClientRect();
      const glifo = (el) => {
        const g = [...el.querySelectorAll("div,span")].find((n) => n.children.length === 0 && /^[\\uE000-\\uF8FF]/.test(n.textContent || ""));
        if (!g) return null;
        const cs = getComputedStyle(g);
        const r = g.getBoundingClientRect();
        // El punto de codigo y no el glifo: en la salida de la terminal es un
        // caracter de uso privado y no se ve, y un informe con un caracter
        // invisible no dice nada.
        const ch = (g.textContent || "").trim().charCodeAt(0);
        return {
          fontSize: parseFloat(cs.fontSize),
          alto: r.height,
          punto: ch ? "U+" + ch.toString(16).toUpperCase().padStart(4, "0") : null,
        };
      };
      return {
        poner: { rect: { x: rp.x, y: rp.y, width: rp.width, height: rp.height }, glifo: glifo(poner), label: poner.getAttribute("aria-label") },
        anadir: { rect: { x: ra.x, y: ra.y, width: ra.width, height: ra.height }, glifo: glifo(anadir), label: limp(anadir.innerText) },
        separacion: Math.round(ra.top - rp.bottom),
      };
    })()
  `);
  if (!signos || !signos.poner || !signos.anadir) {
    check(
      "los dos signos + de la hoja se pueden medir",
      false,
      `faltan: ${JSON.stringify({ sinPoner: signos?.sinPoner, sinAnadir: signos?.sinAnadir })} — en el panel hay: ${JSON.stringify(signos?.hay ?? null)}`,
    );
  } else {
    note(`"poner la etiqueta": ${JSON.stringify(signos.poner.rect)} glifo ${JSON.stringify(signos.poner.glifo)}`);
    note(`"añadir etiqueta":    ${JSON.stringify(signos.anadir.rect)} glifo ${JSON.stringify(signos.anadir.glifo)}`);
    note(`separacion vertical entre los dos: ${signos.separacion} pt`);
    check(
      "los dos + son el mismo dibujo con dos significados distintos",
      signos.poner.glifo?.punto !== null &&
        signos.poner.glifo?.punto === signos.anadir.glifo?.punto &&
        signos.poner.glifo?.fontSize !== signos.anadir.glifo?.fontSize,
      `los dos son ${signos.poner.glifo?.punto} — el de "poner" a ${signos.poner.glifo?.fontSize} px dentro de un objetivo de ${signos.poner.rect.width}×${signos.poner.rect.height} pt (${Math.round(signos.poner.rect.width * signos.poner.rect.height)} pt²), y el de "añadir" a ${signos.anadir.glifo?.fontSize} px en un botón de ${Math.round(signos.anadir.rect.width)}×${Math.round(signos.anadir.rect.height)} pt (${Math.round(signos.anadir.rect.width * signos.anadir.rect.height)} pt²)`,
    );
  }
  await pressLabel(tab, "Cerrar", { exact: true }).catch(() => false);
  await sleep(700);

  /* ------------------------------------------------------- las capturas ------ */
  section("12. Lo que queda en pantalla después de todos los cambios");

  await capturas(listaA, 3, "etiquetas-05-compra-despues");
  await capturas(listaB, 4, "etiquetas-06-semana-despues");

  for (const esquema of ["light", "dark"]) {
    await tab.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-color-scheme", value: esquema }],
    });
    await openLabels(listaA, itemA.huevos, "Huevos");
    await pressTestIdRaw(tab, `tag-color-button-urgente`);
    await sleep(800);
    await tab.screenshot(
      `${SHOTS}/etiquetas-07-hoja-etiquetas-despues-${esquema === "light" ? "claro" : "oscuro"}.png`,
    );
    await pressLabel(tab, "Cerrar", { exact: true }).catch(() => false);
    await sleep(600);
    // Y una tarea **sin** etiquetas, que es la unica que tiene los dos "+": el de
    // poner una etiqueta que la lista ya tiene y el de escribir una nueva. Los
    // dos se necesitan en una imagen para juzgarlos; medidos solos son dos
    // numeros, y a 130 pt de separacion no se pueden comparar de memoria.
    await openLabels(listaA, itemA.leche, "Leche");
    await tab.screenshot(
      `${SHOTS}/etiquetas-08-los-dos-mas-${esquema === "light" ? "claro" : "oscuro"}.png`,
    );
    await pressLabel(tab, "Cerrar", { exact: true }).catch(() => false);
    await sleep(600);
  }

  /* ----------------------------------------------------------------- 13 ----- */
  section("13. La consola, al final de todo");

  /**
   * Un 401 en una llamada de sincronización no es un error de la aplicación.
   *
   * El token de acceso vive quince minutos y esta comprobación tarda más, así que
   * llega un 401 de `sync/pull`, la aplicación refresca el token y la siguiente
   * llamada va con el bueno. Es la machinery de la sesión haciendo su trabajo, y
   * contarlo como fallo haría que esta comprobación dejara de ser creíble el día
   * que tardara un minuto más.
   *
   * Y el filtro **cuenta lo que se queda fuera y lo dice**, porque un filtro que
   * se come cosas en silencio es un filtro que un día se come la comprobación
   * entera. Sólo se come 401 de `sync/` y de `auth/refresh`, que son los dos
   * sitios donde renovar el token es lo esperado.
   */
  const ruidoDeSesion = (p) =>
    p.kind === "http" && /\b401\b/.test(p.text) && /\/sync\/(pull|push)/.test(p.text);
  const comidos = problems.slice(problemasAntes).filter(ruidoDeSesion);
  const reales = problems.slice(problemasAntes).filter((p) => !ruidoDeSesion(p));
  check(
    "nada ha fallado en la consola en ninguna pantalla",
    reales.length === 0,
    reales.map((p) => `${p.kind}: ${p.text.slice(0, 140)}`).join(" | ") || "0 problemas",
  );
  if (comidos.length > 0) {
    note(
      `descartados ${comidos.length} 401 de sync por sesión (el token de acceso caduca a los 15 min y la comprobación dura más): ${[...new Set(comidos.map((p) => p.text))].join(", ")}`,
    );
  }
  note(`tiempo total de la comprobación: ${Math.round((Date.now() - arrancada) / 1000)} s`);

  console.log(failures === 0 ? "\nTODO OK" : `\n${failures} COMPROBACIONES FALLIDAS`);
} catch (error) {
  console.log("fallo:", error.message);
  console.log(error.stack?.split("\n").slice(1, 4).join("\n") ?? "");
  failures += 1;
} finally {
  tab?.close();
  await chrome.kill();
}

process.exit(failures === 0 ? 0 : 1);
