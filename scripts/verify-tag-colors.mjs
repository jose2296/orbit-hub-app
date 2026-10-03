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

/**
 * `rgb(r, g, b)` a `#RRGGBB`, que es lo que `luminanceDe` sabe leer — y que **no
 * devuelve nunca un color que la cuenta no entienda**.
 *
 * **Por qué existe.** El contraste del acento esmeralda se calcula sobre el color
 * que sale del DOM, y `getComputedStyle` devuelve `rgb(14, 159, 110)` mientras que
 * `luminanceDe` hace `parseInt("rg", 16)`. Ese camino dio **`NaN:1`**, que es la
 * forma que tiene un número malo de parecer un número. La primera versión de esta
 * función devolvía la entrada sin tocar cuando no la reconocía —`if (!partes)
 * return texto`— y su comentario decía que fallaba ruidosamente: **el comentario y
 * la función se contradecían dos líneas abajo**, y `"transparent"` seguía pasando
 * de largo hasta el `NaN`.
 *
 * **Ahora lanza, y el alfa no se tira callado.** `rgba(0, 0, 0, 0)` convertido a
 * `#000000` da 18.76:1, que es un número plausible y completamente falso: es
 * transparente. Un alfa menor de 1 se rechaza con el color, porque un color
 * semitransparente no tiene un contraste —depende de lo que haya debajo— y quien
 * pide medir un color translúcido tiene que decir con qué se compone.
 *
 * Y por qué la cuenta se queda como está: los otros dos sitios donde se usa
 * `contrastRatio` pasan constantes hex, y en la app `labelTextColor` sólo recibe
 * hex de la paleta y un relleno de tema. Arreglar `luminanceDe` para tolerar
 * `rgb()` sería hacer el doble de trabajo para un caso que no existe.
 */
function comoHex(color) {
  const texto = String(color).trim();
  // `#abc` y `#aabbcc` no son `#RRGGBB`; se normalizan aquí y no en la cuenta.
  if (/^#[0-9a-f]{3}$/i.test(texto)) {
    return `#${texto[1]}${texto[1]}${texto[2]}${texto[2]}${texto[3]}${texto[3]}`.toLowerCase();
  }
  if (/^#[0-9a-f]{6}$/i.test(texto)) return texto.toLowerCase();
  const partes = texto.match(
    /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)\s*(?:[,/]\s*([\d.%]+)\s*)?\)$/i,
  );
  if (!partes) {
    throw new Error(
      `comoHex no sabe leer "${texto}": un contraste necesita #RRGGBB o rgb(r, g, b)`,
    );
  }
  if (partes[4] !== undefined && Number.parseFloat(partes[4]) < 1) {
    throw new Error(
      `comoHex no va a medir "${texto}": un alfa de ${partes[4]} no tiene un contraste propio, depende de lo que haya detrás`,
    );
  }
  const canal = (n) =>
    Math.max(0, Math.min(255, Math.round(Number(n))))
      .toString(16)
      .padStart(2, "0");
  return `#${canal(partes[1])}${canal(partes[2])}${canal(partes[3])}`;
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
        /**
         * Los bordes de la fila, en coordenadas de pantalla, y no un ancho y una x
         * pelados. Un ancho es una longitud y rightmost era una posición
         * absoluta, y compararlos como si fueran la misma magnitud sólo
         * funcionaba porque la fila está en x ≈ 0 —va de 32 a 358—: con un
         * margen, un padding de pantalla o cualquier cambio de layout, la
         * comparación empezaría a comparar dos cosas distintas. rightEdge es
         * donde acaba la fila de verdad y sobra es la diferencia entre el borde
         * de la fila y lo que llega más a la derecha, que es la pregunta que se
         * quiere hacer.
         *
         * El ancho de la fila está en row.width y **no** suelto por encima: la
         * versión anterior tenía las dos cosas en el mismo objeto y rowWidth se
         * quedó sin usarse en cuanto las comparaciones pasaron a usar rightEdge.
         * Dos rutas al mismo número y una sin usar es una que algún día se
         * desincroniza de la otra sin que nada se entere.
         */
        row: { left: r.left, right: r.right, width: r.width },
        rightEdge: r.right,
        rightmost: Math.max(...todas.map((c) => c.getBoundingClientRect().right)),
        sobra: Math.max(...todas.map((c) => c.getBoundingClientRect().right)) - r.right,
        insignia: ri
          ? { left: ri.left, right: ri.right, entera: ri.right <= r.right + 1 && ri.left >= r.left - 1, texto: limpio(insignia.textContent) }
          : null,
      };
    })()
  `);

/**
 * El icono, el nombre y la segunda línea de una fila, con sus cajas de verdad.
 *
 * Lo que se mide, y por qué cada cosa con la caja que la envuelve:
 *
 *  - **el icono** por su `testID`, que es el `Pressable` entero —24 pt de ancho y
 *    el alto que le dé el glifo— y no el glifo de dentro. El `Pressable` es lo que
 *    se centra en la línea del título, así que es lo que tiene que salir centrado.
 *  - **el nombre** por su `aria-label`, que es el `Pressable` del nombre, y de ahí
 *    a la hoja de texto de dentro: el `Pressable` es una columna que se estira al
 *    alto de la línea, y lo que debe coincidir con el icono es el texto.
 *  - **la segunda línea** subiendo desde la primera pastilla hasta su padre, que es
 *    la `View` de `styles.meta`. Subir **un** nivel y no dos a propósito: el padre
 *    de la pastilla es la línea de las pastillas y el abuelo es la columna, y medir
 *    la columna daría siempre la misma caja para las dos filas que se comparan.
 *  - **la línea del título** por su `testID`, `item-title-line-<id>`, y **no** por
 *    `nombre.parentElement`, que era lo que había. El nombre padre es la línea
 *    ahora, pero en el árbol de antes la línea del título no existía y el padre del
 *    nombre **era** la columna: las dos dan la misma caja en el layout viejo y la
 *    misma caja en el nuevo, así que medir contra lo que salía por ahí no distinguía
 *    un mundo del otro. Está medido —11,5 pt contra 0— y está en la 10b.
 *
 * Y se devuelve el **borde del contenido** de la fila, no su borde: la caja de la
 * fila lleva el `padding` de `theme.spacing.lg` alrededor, así que comparar una y
 * otra caja por su `top` sin quitar ese `padding` compararía la distancia al borde
 * de la pantalla con la distancia al texto.
 *
 * Los `testID` se buscan **recorriendo los `[data-testid]` y comparando el
 * atributo**, que es lo que hace `pressTestIdRaw` desde `2bbcba8`: un `testID` con
 * texto de usuario puesto dentro de las comillas de un selector rompe la consulta
 * entera en lugar de no encontrar nada, y un id que hoy es un UUID puede no serlo
 * mañana.
 */
const rowBoxes = (tab, itemId, title) =>
  tab.evaluate(`
    (() => {
      const porTestId = (raiz, id) =>
        [...raiz.querySelectorAll("[data-testid]")].find(
          (d) => d.getAttribute("data-testid") === id,
        );
      const fila = porTestId(document, ${JSON.stringify(`item-row-${itemId}`)});
      if (!fila) return null;
      const limpio = (s) => (s || "").replace(/[\\uE000-\\uF8FF]/g, "").trim();
      const r = fila.getBoundingClientRect();
      const cs = getComputedStyle(fila);
      const borde = {
        top: r.top + parseFloat(cs.paddingTop) + parseFloat(cs.borderTopWidth),
        left: r.left + parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth),
        right: r.right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth),
      };
      const caja = (el) => {
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return {
          x: Math.round(b.x * 10) / 10,
          y: Math.round(b.y * 10) / 10,
          width: Math.round(b.width * 10) / 10,
          height: Math.round(b.height * 10) / 10,
          right: Math.round(b.right * 10) / 10,
          bottom: Math.round(b.bottom * 10) / 10,
          centroY: Math.round((b.top + b.height / 2) * 10) / 10,
        };
      };

      const icono = porTestId(fila, "item-icon-" + ${JSON.stringify(itemId)});

      // Por atributo y no por selector: el nombre es texto de usuario y puede
      // traer comillas y espacios, y un selector con eso dentro no falla del
      // modo que avisa — falla sin encontrar nada.
      const nombre = [...fila.querySelectorAll("[aria-label]")]
        .find((el) => el.getAttribute("aria-label") === ${JSON.stringify(title)});
      const hoja = nombre
        ? [...nombre.querySelectorAll("div,span,p")].find(
            (el) => el.children.length === 0 && limpio(el.textContent) === ${JSON.stringify(title)},
          )
        : null;
      const csTexto = hoja ? getComputedStyle(hoja) : null;

      // La primera pastilla por texto, y no "la primera caja de radio 999": la
      // insignia de urgencia también lo es, y el padre de la insignia y el de la
      // pastilla son el mismo nodo, así que esto aguanta las dos. La insignia se
      // busca aparte para poder decir cuál de las dos cosas había.
      const todas = [...fila.querySelectorAll("div")].filter((el) => {
        const s = getComputedStyle(el);
        return (
          s.borderTopLeftRadius === "999px" &&
          s.backgroundColor !== "rgba(0, 0, 0, 0)" &&
          el.getBoundingClientRect().width > 0
        );
      });
      const primera = todas[0] ?? null;
      const meta = primera ? primera.parentElement : null;

      return {
        fila: { ...caja(fila), borde },
        icono: caja(icono),
        titulo: caja(hoja),
        cajaNombre: caja(nombre),
        // La linea del titulo, por su testID y no por ser el padre del nombre: sin
        // ella no se puede decir si el nombre empieza en el sitio o 24 pt mas
        // adentro, porque el hueco del icono se mide contra esa linea y no contra
        // el borde de la fila, que esta a 42 pt mas a la izquierda por la casilla y
        // el hueco de la fila.
        lineaTitulo: caja(porTestId(fila, "item-title-line-" + ${JSON.stringify(itemId)})),
        /**
         * Y si el icono es **hijo** de esa linea, que es la comprobacion que puede
         * fallar: el arbol de antes lo tenia de hermano de la columna, y medido
         * sobre las mismas tres filas da "hijo: no" ahi y "hijo: si" aqui.
         *
         * Va en la misma lectura porque decidirlo desde node exigiria traer el
         * arbol entero, y la pregunta es de una linea.
         */
        iconoEsHijoDeLaLinea:
          !!icono && !!nombre && icono.parentElement === porTestId(fila, "item-title-line-" + ${JSON.stringify(itemId)}),
        // La casilla. Ahora vive **dentro** de la linea del titulo, asi que
        // styles.titulo la centra contra esa linea y no contra la fila entera:
        // se mide para comprobarlo, y se comprueba mas abajo. Antes se centraba
        // contra la fila entera y por eso quedaba 12 pt por debajo en las filas de
        // dos lineas; entonces esto era una nota y no una comprobación.
        casilla: caja(fila.querySelector('[role="checkbox"]')),
        lineas: hoja
          ? Math.max(
              1,
              Math.round(
                hoja.getBoundingClientRect().height /
                  (parseFloat(csTexto.lineHeight) || parseFloat(csTexto.fontSize) * 1.2),
              ),
            )
          : null,
        meta: caja(meta),
        primeraCaja: todas.length > 0 ? limpio(todas[0].textContent) : null,
        /**
         * Cuántas líneas de texto ocupa **todo** el nombre, y no cuántas ocupa el
         * nodo de texto: con "Aceite de oliva virgen extra para la cena del
         * viernes" el AppText lleva numberOfLines={2} y es el Pressable del nombre
         * el que se estira a las dos líneas, porque es una columna con
         * alignItems: stretch.
         */
        altoNombre: nombre
          ? Math.round(nombre.getBoundingClientRect().height * 10) / 10
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

/**
 * El color que la hoja cree que tiene ahora una etiqueta, por su `aria-label`.
 *
 * Y el `testID` se busca **por atributo**, como en `pressTestIdRaw` y no como en la
 * primera versión de esta función. Aquí el texto **es de la persona**: una etiqueta
 * con un espacio, unas comillas o un corchete produce un `testID` que, puesto dentro
 * de las comillas de un selector, no da "no se encuentra" sino que rompe la
 * consulta entera —que es el modo de fallo que no avisa—. Comparando el atributo
 * como la cadena que es, el nombre puede llevar lo que lleve.
 */
const resolvedColor = (tab, tag) =>
  tab.evaluate(`
    (() => {
      const el = [...document.querySelectorAll("[data-testid]")].find(
        (d) => d.getAttribute("data-testid") === "tag-color-button-" + ${JSON.stringify(tag)},
      );
      if (!el) return null;
      const label = el.getAttribute("aria-label") || "";
      const m = label.match(/ahora ([^,]+)$/);
      return { label, nombre: m ? m[1] : null };
    })()
  `);

/**
 * Un `testID` con texto de usuario dentro, comparado **por atributo**.
 *
 * Nunca `querySelector('[data-testid="..."]')` con el texto puesto dentro de las
 * comillas del selector: un `testID` como `tag-color-Mercadona urgente-red` lleva
 * un espacio y otro signo, y un selector con eso dentro rompe la consulta entera en
 * lugar de no encontrar nada. Esto recorre los `[data-testid]` y compara el
 * atributo como lo que es: una cadena. El nombre tiene comillas, espacios y
 * acentos, y aquí no importa.
 */
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
 * Una captura, **con las fuentes cargadas**, y por eso no es `tab.screenshot`.
 *
 * Las capturas son para mirar, y una captura sin las fuentes no se puede mirar:
 * los iconos de las filas son glifos de uso privado de la fuente `ionicons`, y
 * **mientras esa fuente no está cargada el navegador no dibuja nada en su lugar** —
 * ni el glifo, ni un cuadrado de sustitución. Las dieciséis capturas de este archivo
 * se llevaron las seis de la lista sin un solo icono, con el hueco reservado y el
 * nombre corrido a la derecha, que es exactamente la disposición que este trabajo
 * cambia: la imagen enseña a medias lo contrario de lo que dice.
 *
 * `waitForRows` espera a que haya filas, y las filas llegan antes que la fuente. Se
 * pregunta a `document.fonts` y se pregunta por la fuente **concreta**, y no por el
 * estado: `document.fonts.status === "loaded"` es cierto de momento a momento, antes
 * de que expo-inyecte el `@font-face` de los iconos, así que una espera por el
 * estado no espera nada y deja pasar exactamente el caso que viene a evitar. Lo que
 * dice si la fuente está es `document.fonts.check("18px ionicons")`, que es falso
 * mientras no haya una fuente cargada que cubra esa familia.
 *
 * Y no se espera `document.fonts.ready`, que con `awaitPromise` de CDP se quedó sin
 * responder —60 s de reloj por comando, uno por captura— porque en una página con el
 * servidor de desarrollo detrás esa promesa no acaba de asentarse nunca.
 *
 * **El alto de la caja del glifo depende de esto, y medido**: con la fuente
 * bloqueada por CDP la caja mide **22 pt** y `check()` da falso; con la fuente
 * cargada mide **20 pt** y `check()` da cierto. Son dos números para la misma fila
 * en la misma pantalla, y por eso la 10b espera a la fuente antes de medir en vez
 * de escribir un número que depende de si el navegador llegó a tiempo.
 *
 * Y una espera que puede fallar **no puede terminar en silencio**: una captura sin
 * la fuente se sigue escribiendo —para que haya una imagen que mirar y se vea que
 * le falta el glifo— pero se cuenta, y se comprueba al final junto al resto.
 */
let capturasSinFuente = 0;
async function esperarIconos(tab) {
  return until(
    "la fuente de los iconos",
    () => tab.evaluate(`document.fonts.check("18px ionicons")`),
    (v) => v === true,
    { timeout: 20000, every: 400 },
  );
}
async function shot(tab, path) {
  const fuente = await esperarIconos(tab);
  if (!fuente.ok) {
    capturasSinFuente += 1;
    note(`la fuente de los iconos no ha llegado a tiempo; ${path} va sin glifos`);
  }
  await tab.screenshot(path);
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
    tomates: randomUUID(),
    aceite: randomUUID(),
    mermelada: randomUUID(),
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
          // Las tres filas que ya estaban pasan al final porque las tres nuevas
          // ocupan el 0, el 1 y el 2, y dos filas con la misma posición no tienen un
          // orden que dos ejecuciones lean igual.
          position: 3,
          icon: "pan",
          iconStyle: "outline",
          iconColor: "amber",
          tags: ETIQUETAS_PAN,
        }),
        op("list_item", itemA.leche, { listId: listaA, title: "Leche", position: 4, tags: [] }),
        op("list_item", itemA.huevos, {
          listId: listaA,
          title: "Huevos",
          position: 5,
          priority: "high",
          tags: ETIQUETAS_HUEVOS,
        }),
        /*
         * Las tres filas que esta comprobación no tenía, y que son la mitad de lo
         * que ahora mide.
         *
         * **El agujero era este**: en la semilla de antes "Pan" tenía icono pero no
         * urgencia, y "Huevos" y "Nevera" tenían urgencia pero no icono. Así que
         * **ninguna de las dieciséis capturas llegó a poner un icono sobre una fila
         * con algo debajo**: la fila con icono se veía bien porque no tenía nada
         * debajo, y la que tenía insignia no tenía icono que se le descadrase. Un
         * paso de verificación que no pone nunca en pantalla el caso que motiva la
         * tarea verifica que no se ha roto lo de antes.
         *
         * "Tomates" es esa fila — **icono, insignia y etiquetas a la vez** — y las
         * tres van las primeras para que salir en las capturas no dependa de que la
         * sexta quepa en una pantalla de 844.
         */
        op("list_item", itemA.tomates, {
          listId: listaA,
          title: "Tomates",
          position: 0,
          icon: "verdura",
          iconStyle: "outline",
          iconColor: "red",
          priority: "medium",
          tags: ["Mercadona", "perejil"],
        }),
        /*
         * Y "Aceite de oliva" es el otro extremo: **icono y nada debajo**. Sin
         * insignia ni etiquetas la fila es una sola línea, y con un nombre de una
         * línea es **comparable con "Tomates" punto por punto**, que es lo que hace
         * falta para que "a la misma altura" signifique algo: el icono va centrado en
         * la línea del título, así que un título de dos líneas lo baja medio bloque
         * a propósito y comparar los dos sería medir dos títulos distintos.
         */
        op("list_item", itemA.aceite, {
          listId: listaA,
          title: "Aceite de oliva",
          position: 1,
          icon: "aceite",
          iconStyle: "fill",
          iconColor: "olive",
          tags: [],
        }),
        /*
         * Y "Mermelada" es el tercer dato: **icono, nada debajo y dos líneas de
         * nombre**. Al meter el icono en la línea del título el nombre pasó de ser un
         * hijo de una columna —donde su caja se estiraba al ancho de la columna— a
         * ser un hijo de una fila, y en una fila el ancho lo decide la caja:
         * react-native-web escribe flexShrink: 0 en todas sus View. Esta fila es la
         * que se sale de la pantalla si eso no está mirado, y la que dice que el
         * icono se centra también en un bloque de dos líneas.
         */
        op("list_item", itemA.mermelada, {
          listId: listaA,
          title: "Mermelada de frutales de temporada para el desayuno",
          position: 2,
          icon: "dulces",
          iconStyle: "fill",
          iconColor: "purple",
          tags: [],
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

  /**
   * Los errores de consola empiezan a contar **aquí**, antes de la primera
   * navegación.
   *
   * `collectProblems` se puede llamar en cuanto existe la pestaña —lo único que
   * necesita es el objeto con su `on`—, y `openTab` no navega a ningún sitio: deja
   * un `about:blank` y enciende los dominios de CDP. Espera: lo único que necesita
   * es un objeto al que subscribirse, y ese existe en cuanto `openTab` ha
   * devuelto, que es justo antes de que este archivo haya hecho nada.
   *
   * **La primera versión de esto contaba desde después de `seedSession`,** y eso
   * hacía dos cosas malas a la vez: la comprobación de la sección 1 tomaba el
   * índice en la línea de justo antes y lo comparaba en la de justo después, con
   * `collectProblems` escribiendo en un array vivo —una ventana de microsegundos
   * que no puede fallar—; y el comprobar de verdad, al final, reutilizaba ese
   * mismo índice, así que **los errores del arranque de la app y del primer
   * dibujado de la lista no se miraban nunca**. `docs/verificacion-en-navegador.md`
   * dice que un error de consola es un fallo "en todo lo que ha hecho"; esto lo
   * cumple ahora, y la ejecución después del cambio dirá si el arranque —incluido
   * el de `seedSession`, que hasta aquí no se miraba— produce algo.
   */
  problems = collectProblems(tab);
  // Siempre cero, y está bien que lo sea: el array se acaba de nacer vacío. Se
  // deja escrito para que quede claro que **no** es un índice que oculte algo, sino
  // el principio de una ventana que empieza aquí y no se mueve.
  const problemasDesdeElPrincipio = problems.length;
  if (problemasDesdeElPrincipio !== 0) {
    throw new Error("el array de problemas no empieza vacío: la ventana no sería desde el principio");
  }

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

  /*
   * **Aquí ya no se vuelve a llamar a `collectProblems`, y es lo importante.**
   *
   * Llamada dos veces no es "empezar a contar dos veces": `collectProblems`
   * devuelve un array **nuevo** y devuelve *oídos* nuevos que empujan en él. La
   * segunda llamada **tiraba el primer array**, y con él todo lo que `seedSession`
   * hubiera producido —que son hasta tres intentos por dos arrancos completos de
   * la app cada uno, y el primero arranca **anónimo a propósito**, que es la
   * navegación que más falla de todo el guion—. Los oyentes del primer array
   * seguían empujando en un array que nadie leía, así que además la primera
   * llamada era código muerto y `problemasDesdeElPrincipio` era decorativo:
   * valía siempre `0` porque el array nuevo está vacío al nacer.
   *
   * Una comprobación con el índice bien puesto contra el array equivocado informa
   * verde, que es lo mismo que no comprobar pero con más confianza.
   */

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

  // Y esto ya es de verdad una comprobación: la ventana va desde **antes de la
  // primera navegación**, no desde la línea de arriba. La versión anterior tomaba
  // el índice aquí y lo comparaba en la línea siguiente, con `collectProblems`
  // escribiendo en el mismo array: cero microsegundos de ventana, una comprobación
  // que no podía fallar, y además el comprobar de verdad se saltaba el arranque.
  await goToList(listaA, 6);
  check(
    "nada ha fallado en la consola desde que se abrió la pestaña",
    problems.length === problemasDesdeElPrincipio,
    problems
      .slice(problemasDesdeElPrincipio)
      .map((p) => `${p.kind}: ${p.text.slice(0, 120)}`)
      .join(" | ") || "0 problemas",
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
    `la fila de cobertura lleva los ${SEED_LABELS.cobertura.length} deducidos repartidos, con ambar junto a naranja`,
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
      await shot(tab, `${SHOTS}/${nombre}-${esquema === "light" ? "claro" : "oscuro"}.png`);
      if (listId === listaA) {
        repartoDeColores(await pillsOfRow(tab, itemA.huevos, ETIQUETAS_HUEVOS), `${nombre} Huevos ${esquema}`);
      } else {
        repartoDeColores(await pillsOfRow(tab, itemB.nevera, SEED_LABELS.cobertura), `${nombre} Nevera ${esquema}`);
      }
    }
  };

  await capturas(listaA, 6, "etiquetas-01-lista-compra");
  await capturas(listaB, 4, "etiquetas-02-lista-semana");

  for (const esquema of ["light", "dark"]) {
    await tab.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-color-scheme", value: esquema }],
    });
    await openLabels(listaA, itemA.huevos, "Huevos");
    await pressTestIdRaw(tab, `tag-color-button-urgente`);
    await sleep(900);
    await shot(
      tab,
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
    await goToList(listaA, 6);
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
  //
  // **Y el `if` no es opcional.** `JSON.stringify(null)` es el texto `"null"`, así
  // que sin esta comprobación una pastilla que no se encuentra en las dos lecturas
  // —porque la lista no está, o porque el texto no es el que se busca— firmaba dos
  // veces lo mismo y la comparación pasaba. Y es **justamente** esta comprobación
  // la que tiene que detectar un mapa a nivel de módulo indexado por el nombre de
  // la etiqueta: ese fallo pasa todas las pruebas unitarias de este bloque y
  // falla aquí, en este `===`, y no en ningún otro sitio. Una comprobación que
  // pasa con dos nulos no vigila nada.
  await goToList(listaB, 4);
  const pastillaBAntes = await pillOf(tab, "Mercadona", `[data-testid="item-row-${itemB.pan}"]`);
  if (!pastillaBAntes) {
    throw new Error(
      "la pastilla de Mercadona de la lista B no se ha encontrado, y sin ella no se puede comprobar que no se mueva",
    );
  }
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

  await goToList(listaA, 6);
  const enHuevos = await pillOf(tab, "Mercadona", `[data-testid="item-row-${itemA.huevos}"]`);
  const esperadoHuevos = toRgb(expectedTextColor("red", "light"));
  check(
    "una fila que la escritura ni menciona se repinta igual",
    enHuevos?.textColor === esperadoHuevos,
    `la pastilla de Mercadona en Huevos es ${enHuevos?.textColor}, y la de Pan ${pastillaAAtras?.textColor}`,
  );

  /*
   * **La misma etiqueta en dos filas de la misma lista, y el mismo color en las dos.**
   *
   * Esto viene de una pregunta que **la vista no puede contestar**: mirando la
   * captura, la pastilla de "Mercadona" parecía más gris en "Pan" que en "Huevos", y
   * a ojo no hay manera de saber si es un fallo o si son el mismo color en dos
   * vecindarios distintos. La respuesta es que las dos pintan lo mismo —las dos caen
   * al texto del tema— y lo que cambia es el contraste local de cada una con lo que
   * tiene alrededor.
   *
   * Y la respuesta estaba **contestada por leer el código**: que las dos filas
   * reciben el mismo objeto de `list?.tagColors ?? {}`, que `TagChip` es una función
   * pura de `(tag, mapa, tema)` y que el `style` de su `AppText` va el último del
   * arreglo, con lo que el `tone` de la fila no puede modularlo. Tres cosas que hay
   * que leer, y que se pueden leer mal.
   *
   * Con la semilla nueva "Mercadona" está en **tres** filas de la lista A —Pan,
   * Tomates y Huevos— así que la comparación tiene tres lados y no dos: si una fila
   * se llegara a pintar con un mapa que no es el de la lista, esto lo dice con
   * números y no con una impresión.
   *
   * Se comparan las dos propiedades de las que sale el color que se ve: el texto y el
   * relleno. No el ancho, ni la posición, ni el borde: dos pastillas del mismo texto
   * en filas distintas tienen cajas distintas por la letra de al lado.
   */
  const mercadonaEnLasTres = [
    ["Pan", await pillOf(tab, "Mercadona", `[data-testid="item-row-${itemA.pan}"]`)],
    ["Tomates", await pillOf(tab, "Mercadona", `[data-testid="item-row-${itemA.tomates}"]`)],
    ["Huevos", await pillOf(tab, "Mercadona", `[data-testid="item-row-${itemA.huevos}"]`)],
  ];
  const primera = mercadonaEnLasTres[0][1];
  note(
    mercadonaEnLasTres
      .map(([k, p]) => `${k}: texto ${p?.textColor}, relleno ${p?.fill}`)
      .join(" | "),
  );
  check(
    "la misma etiqueta se pinta igual en todas las filas de la lista que la llevan",
    primera !== null &&
      primera !== undefined &&
      mercadonaEnLasTres.every(
        ([, p]) => p !== null && p?.textColor === primera.textColor && p?.fill === primera.fill,
      ),
    `Pan, Tomates y Huevos llevan "Mercadona" y las tres la pintan con el texto ${primera?.textColor} sobre ${primera?.fill}: ${
      primera?.textColor === esperadoHuevos ? "el del tema, que es lo que la regla de contraste manda para el rojo en claro" : "lo que sea, y está en las tres"
    }`,
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

  await goToList(listaA, 6);
  const urgenteReload = await pillOf(tab, "urgente", `[data-testid="item-row-${itemA.huevos}"]`);
  check(
    "el color deducido es el mismo en una segunda carga",
    urgenteReload?.textColor === urgenteAntes?.textColor,
    `${urgenteAntes?.textColor} antes y ${urgenteReload?.textColor} después de recargar`,
  );

  /* ----------------------------------------------------------------- 6 ------ */
  section("6. Un color elegido sin conexión se repinta y llega al servidor al volver");

  await openLabels(listaA, itemA.huevos, "Huevos");

  /**
   * Los errores que este guion **se causa a sí mismo**, marcados como tales.
   *
   * Cortar la red con `Network.emulateNetworkConditions` hace que la aplicación
   * receives... bueno, que **no** reciba nada, y eso produce errores de consola y
   * peticiones fallidas que no son un fallo de la aplicación sino del estado que
   * este archivo ha creado. Hasta aquí no se trataban de ninguna manera: sólo se
   * contaban con un `note()`, así queaban sin comprobar y **acaban dentro del
   * filtro de la comprobación final**, que los descartaba por ser 401 o por no
   * serlo según el día.
   *
   * Ahora son un tramo de índices —del que había al restaurar la red— y el filtro
   * final quita **exactamente** ese tramo y nada más. Todo lo que no esté en él
   * sigue teniendo que pasar la comprobación, incluido un error que ocurra durante
   * el corte por una razón que no sea la red: el corte explica por qué fallan las
   * peticiones, no por qué falla una excepción.
   */
  const problemasPorCortar = new Set();
  const marcarPorCortar = (desde, hasta) => {
    for (let i = desde; i < hasta; i += 1) problemasPorCortar.add(i);
  };

  const indiceAntesDeCortar = problems.length;
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
  const erroresPorCortar = problems.length - indiceAntesDeCortar;
  note(
    `${erroresPorCortar} entradas de consola durante el corte de red, que este guion ha causado y no son un fallo de la aplicación`,
  );

  await tab.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
  marcarPorCortar(indiceAntesDeCortar, problems.length);

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
    // **El contraste se calcula sobre los colores que se han medido**, no sobre los
    // que el archivo de tokens dice que deberían ser. La primera versión escribía
    // `contrastRatio("#0E9F6E", SCHEME.light.fill)` con el `borderColor` leído del
    // DOM **en una variable al lado**, y eso no es una medición del botón: es una
    // afirmación sobre dos literales que pasaría igual con el borde en 1:1.
    //
    // El mínimo de WCAG para un borde que dibuja una interfaz es 3:1, y lo que sale
    // de leer el botón de verdad son 3.02:1 — pasa por dos centésimas. Los números
    // de los otros acentos salen del cálculo sobre el token, no del DOM, y por eso
    // van como `note` y no como `check`: son una comparación, no una medición.
    const rBorde = contrastRatio(
      comoHex(esmeralda.color.borderColor),
      comoHex(esmeralda.pillFill),
    );
    const rFondo = contrastRatio(
      comoHex(esmeralda.color.backgroundColor),
      comoHex(esmeralda.pillFill),
    );
    note(`borde abierto: ${esmeralda.color.borderWidth} ${esmeralda.color.borderColor} sobre ${esmeralda.pillFill}`);
    check(
      "el borde del boton de color abierto llega a 3:1 en el acento esmeralda",
      esmeralda.color.borderWidth === "2px" && rBorde >= 3,
      `${esmeralda.color.borderWidth} ${esmeralda.color.borderColor} sobre ${esmeralda.pillFill} = ${rBorde.toFixed(2)}:1, leído del DOM`,
    );
    check(
      "el boton de color abierto se pinta con el borde del acento, no con su fondo",
      esmeralda.color.borderColor !== esmeralda.color.backgroundColor,
      `borde ${esmeralda.color.borderColor} y fondo ${esmeralda.color.backgroundColor}, los dos medidos: el fondo da ${rFondo.toFixed(3)}:1 sobre el relleno ${esmeralda.pillFill}${rFondo < 1.05 ? ", por debajo de lo que se distingue de un color plano" : ""}, y el borde ${rBorde.toFixed(2)}:1`,
    );
    // Y los otros acentos, como comparación y no como comprobación: salen del token,
    // no de un botón medido, y el orden se calcula aquí con la misma cuenta.
    const acentoEnToken = (hex) => contrastRatio(hex, SCHEME.light.fill);
    const otros = {
      orbit: acentoEnToken("#3B63E0"),
      violet: acentoEnToken("#7C3AED"),
      amber: acentoEnToken("#C2740A"),
      rose: acentoEnToken("#D42D5C"),
    };
    /*
     * Cuál de los cinco es el más flojo **sale de compararlos**, no de escribirlo:
     * una frase que dice "el esmeralda es el más flojo" junto a cuatro números que
     * tiene al lado es una afirmación que se queda vieja en cuanto uno de los
     * cuatro se mueve, y aquí no hay nadie mirando. El `reduce` va con `<`, así que
     * un empate se queda con el que va primero en la lista —que es el esmeralda, y
     * solo por el orden en que se han escrito—; con estos cuatro tokens no hay
     * empate, y si lo hubiera el texto lo delataría, porque el número que sale es
     * el de los dos.
     */
    const flojo = [
      ["esmeralda, medido del DOM", rBorde],
      ...Object.entries(otros),
    ].reduce((a, b) => (b[1] < a[1] ? b : a));
    note(
      `los otros acentos salen del token, no del DOM, calculados aquí con la misma cuenta sobre ${SCHEME.light.fill}: ${Object.entries(otros).map(([k, v]) => `${k} ${v.toFixed(2)}:1`).join(", ")}. El más flojo de los cinco sale de comparar esos cuatro con el esmeralda medido a ${rBorde.toFixed(2)}:1, y es ${flojo[0]} a ${flojo[1].toFixed(2)}:1`,
    );
  }
  await shot(tab, `${SHOTS}/etiquetas-04-acento-esmeralda-claro.png`);
  // El mismo boton abierto con el acento por defecto al lado, que es la
  // comparacion que hace falta: 3.02:1 del esmeralda contra 4.64:1 del orbit se
  // ven en dos ficheros, no en dos numeros.
  await tab.evaluate(
    `(() => { localStorage.setItem("orbithub:appearance", JSON.stringify({ appearance: "light", accent: "orbit" })); return true; })()`,
  );
  await openLabels(listaA, itemA.huevos, "Huevos");
  await pressTestIdRaw(tab, `tag-color-button-Mercadona`);
  await sleep(800);
  await shot(tab, `${SHOTS}/etiquetas-04b-acento-orbit-claro.png`);
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
      `${k}: ${v.pillCount} pastillas en ${v.lines} líneas, alto de la fila ${Math.round(v.rowHeight)} pt, la fila va de ${Math.round(v.row.left)} a ${Math.round(v.row.right)} y lo de más a la derecha llega a ${Math.round(v.rightmost)} (sobran ${Math.round(v.sobra)} pt)` +
        (v.insignia ? `, insignia "${v.insignia.texto}" de ${Math.round(v.insignia.left)} a ${Math.round(v.insignia.right)}` : ", sin insignia"),
    );
  }
  // Comparado contra `rightEdge`, que es donde acaba la fila en coordenadas de
  // pantalla, y no contra el ancho de la fila. Ver el comentario de
  // `linesOfRow`: sólo coincidían porque la fila está en x ≈ 0.
  check(
    "una pastilla mas ancha que la fila se parte por dentro y no se corta",
    geo.larga.sobra <= 1,
    `lo de más a la derecha llega a ${Math.round(geo.larga.rightmost)} y la fila acaba en ${Math.round(geo.larga.rightEdge)}: ${Math.round(geo.larga.sobra)} pt de diferencia`,
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
      largaTexto.rect.right <= geo.larga.rightEdge + 1 &&
      largaTexto.rect.width > 0,
    `${SEED_LABELS.larga.length} caracteres en ${largaTexto?.lines} línea(s), ancho ${Math.round(largaTexto?.rect.width ?? 0)} pt, llega a ${Math.round(largaTexto?.rect.right ?? 0)} y la fila acaba en ${Math.round(geo.larga.rightEdge)}`,
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
      ? `"${geo.ocho.insignia.texto}" va de ${Math.round(geo.ocho.insignia.left)} a ${Math.round(geo.ocho.insignia.right)} y la fila acaba en ${Math.round(geo.ocho.rightEdge)}`
      : "no se encontró ninguna insignia en la fila de ocho etiquetas",
  );
  check(
    "una pastilla, tres y ocho caben en la misma pantalla sin empujar nada",
    [geo.una, geo.tres, geo.ocho].every((g) => g.sobra <= 1 && g.rowHeight <= 200),
    // Imprime **las dos cosas que se comprueban**: el alto y el holgura a la
    // derecha. Antes sólo salía el alto, que es la mitad de lo que dice el `every`:
    // un mensaje que enseña una de las dos condiciones deja en silencio a la otra,
    // y es la que más difícil de ver es la que más cerca está de romperse.
    Object.entries(geo)
      .map(([k, v]) => {
        // El mapa cuenta etiquetas; `larga` es una de 40 caracteres, no cuarenta.
        const n = { una: 1, tres: 3, ocho: 8, larga: 1 }[k] ?? v.pillCount;
        const cuantas = `${n} etiqueta${n === 1 ? "" : "s"}`;
        return `${cuantas}${k === "larga" ? " de 40 caracteres" : ""} en ${v.lines} línea${v.lines === 1 ? "" : "s"}, fila de ${Math.round(v.rowHeight)} pt y ${Math.round(-v.sobra)} pt de holgura a la derecha`;
      })
      .join("; "),
  );

  /* ---------------------------------------------------------------- 10b ------ */
  section("10b. El icono y el nombre en su propia línea");

/*
   * Lo que nunca se había mirado, y la razón de que esta sección exista.
   *
   * El icono era **hermano de la columna del nombre** y `styles.item` lleva
   * `alignItems: "center"`, así que se centraba contra el nombre *más lo que hubiera
   * debajo*. En una tarea con insignia el icono bajaba y en una sin ella quedaba
   * centrado, y dos tareas parecidas tenían el icono a dos alturas sin motivo. Y
   * ninguna de las dieciséis capturas de este archivo lo llegó a poner en
   * pantalla, porque la semilla no tenía **ninguna fila con icono y algo debajo a
   * la vez**: "Pan" tenía icono y nada más, y "Huevos" y "Nevera" tenían insignia
   * y ningún icono.
   *
   * Aquí hay tres filas y dos preguntas, y son distintas porque se parecen:
   *
   *  - **dentro de una fila**: el icono y el nombre están centrados el uno en el
   *    otro. Da igual cuántas líneas haya debajo, porque ya no son parte de la misma
   *    caja.
   *  - **entre dos filas**: el icono está a la misma distancia del borde de la fila
   *    con segunda línea que sin ella. Y aquí sí hacen falta dos filas **con el
   *    mismo número de líneas de nombre**, porque el icono va centrado en la línea
   *    del título: con un nombre de dos líneas baja medio bloque a propósito, y
   *    comparar eso con un nombre de una línea sería medir dos títulos distintos.
   *
   * La tercera fila, la del nombre de 51 caracteres, es el otro extremo: dos
   * líneas de nombre y nada debajo, que es donde se ve si el nombre se sale —al
   * pasar de ser hijo de una columna a hijo de una fila— y si el icono se sigue
   * centrando en un bloque más alto que él.
   */
  await goToList(listaA, 6);

  // Media posición de píxel es lo que queda de un reparto en dos mitades, así que
  // el margen es de 1 pt y no de 0: el fallo que hay que cazar aquí es de **decenas**
  // de puntos, no de décimas, y un margen de 0 sólo daría falsos fallos.
  const TOLERANCIA = 1;

  /*
   * Y **antes** de leer las cajas de abajo, la fuente de los iconos. Va antes y no
   * después por una razón concreta que costó una ejecución: primero iba después, así
   * que las cajas ya estaban leídas cuando la fuente llegaba —o no— y el `note` de
   * al lado decía "sí estaba" sobre una medición hecha sin ella. Una espera que no
   * gobierna lo que viene detrás no es una espera.
   *
   * Y mueve el número, y hay que decirlo: la caja del glifo mide **22 pt antes de
   * que la fuente esté y 20 pt con ella**, y no es una carrera que se queda como
   * salga —medido en dos cargas seguidas, las cajas pasan de 22 a 20 en el mismo
   * segundo en que `document.fonts.check` pasa a verdadero—. El descentrado del
   * icono dentro de su línea es la mitad de esa diferencia, o sea 1 pt: el mismo en
   * las tres filas, y por eso **ninguna de las diferencias que se comprueban aquí
   * cambia**. Lo que cambia es el alto de una caja de la que no depende ninguna
   * comprobación, y que sin la fuente es la caja de una letra que no está.
   */
  const fuenteParaMedir = await esperarIconos(tab);
  note(
    `la fuente de los iconos ${fuenteParaMedir.ok ? "sí estaba" : `no ha llegado (${Math.round(fuenteParaMedir.waited / 1000)} s de espera)`} antes de leer las cajas`,
  );
  const filas = {
    conDebajo: await rowBoxes(tab, itemA.tomates, "Tomates"),
    sinDebajo: await rowBoxes(tab, itemA.aceite, "Aceite de oliva"),
    nombreLargo: await rowBoxes(
      tab,
      itemA.mermelada,
      "Mermelada de frutales de temporada para el desayuno",
    ),
  };

  for (const [k, v] of Object.entries(filas)) {
    if (!v) continue;
    note(
      `${k}: fila de ${Math.round(v.fila.width)}×${Math.round(v.fila.height)} pt, contenido desde x=${Math.round(v.fila.borde.left)}; ` +
        `línea del título en x=${v.lineaTitulo?.x}, y=${v.lineaTitulo?.y}, alto ${v.lineaTitulo?.height}; ` +
        `icono ${v.icono ? `${Math.round(v.icono.width)}×${Math.round(v.icono.height)} en x=${v.icono.x}, y=${v.icono.y}, centro ${v.icono.centroY}` : "sin icono"}; ` +
        `nombre ${v.lineas} línea(s), x=${v.titulo?.x}, y=${v.titulo?.y}, centro ${v.titulo?.centroY}, caja de alto ${v.altoNombre}; ` +
        `segunda línea ${v.meta ? `en y=${v.meta.y}, alto ${v.meta.height}` : "no dibujada"} (primera pastilla: "${v.primeraCaja ?? "—"}")`,
    );
  }

  /*
   * Y el hueco **entre** las dos líneas, que es `spacing.md`: 12 puntos.
   *
   * Antes eran 2, y 2 no es una separación sino un interlineado: la línea de las
   * etiquetas se quedaba pegada al título y se leía como parte del mismo párrafo,
   * que es lo único que una segunda línea de metadatos no puede hacer.
   *
   * **Puede fallar**: la cuenta es la distancia entre el borde inferior de la línea
   * del título y el borde superior de la de las etiquetas, y con el `gap: 2` de
   * antes da 2. Si alguien lo baja otra vez, esto se pone rojo. Y solo se mira la
   * fila que tiene segunda línea, porque en las que no la tienen no hay nada que
   * separar y la cuenta daría el ruido del redondeo.
   */
  const conSegunda = Object.entries(filas).filter(([, v]) => v?.meta && v?.lineaTitulo);
  const huecosVerticales = conSegunda.map(([k, v]) => [
    k,
    v.meta.y - (v.lineaTitulo.y + v.lineaTitulo.height),
  ]);
  check(
    "las dos líneas de la fila están separadas por spacing.md, y no pegadas",
    conSegunda.length > 0 &&
      huecosVerticales.every(([, g]) => Math.abs(g - 12) <= TOLERANCIA),
    huecosVerticales.length === 0
      ? "ninguna fila con segunda línea, y el script no ha medido nada"
      : huecosVerticales
          .map(([k, g]) => `${k}: ${Math.round(g)} pt entre el título y sus etiquetas`)
          .join(" | "),
  );

  // **Dentro de la fila**: el icono y el nombre comparten el centro. Ésta es la
  // comprobación que antes fallaba —sin nada debajo el icono se centraba contra el
  // nombre entero y con algo debajo contra el nombre más la segunda línea— y por eso
  // se escribe para las tres filas y no sólo para una.
  //
  // **Y es comprobable: medido contra el árbol de antes, esta misma cuenta da 11,5 pt
  // en la fila con insignia y etiquetas y 0 en las otras dos.** El nombre "antes"
  // no es retórico, es el otro árbol de este mismo repositorio, con la misma semilla
  // y en el mismo navegador.
  const descuadres = Object.entries(filas)
    .filter(([, v]) => v?.icono && v?.titulo)
    .map(([k, v]) => [k, Math.abs(v.icono.centroY - v.titulo.centroY)]);
  check(
    "el icono y el nombre están a la misma altura dentro de la fila, haya o no haya segunda línea",
    descuadres.length === 3 && descuadres.every(([, d]) => d <= TOLERANCIA),
    descuadres.map(([k, d]) => `${k}: ${d} pt de diferencia de centro`).join("; "),
  );

  /**
   * **Que el icono sea hijo de la línea del título**, que es el arreglo dicho en
   * palabras, y la comprobación que de verdad puede fallar.
   *
   * Antes esta comprobación era una distancia —el centro del icono contra el centro
   * de la línea— y **no podía fallar**: medido en los dos árboles da 0 en los dos,
   * porque en el árbol viejo `styles.item` centraba el icono contra la columna, que
   * es justo lo que el padre del nombre devolvía, así que la distancia era cero
   * justamente en el mundo donde estaba mal. Una comprobación que da 0 en las dos
   * versiones no vigila nada, y este bloque ya lleva dos.
   *
   * La distancia contra la línea se queda como `note`, que es lo que es: el número
   * que produce la pertenencia, no una prueba por sí mismo. La que prueba es si el
   * icono **es hijo** de la línea, y eso en el árbol viejo da "no" en las tres filas
   * y aquí da "sí".
   */
  const hijos = Object.entries(filas).map(([k, v]) => [k, v?.iconoEsHijoDeLaLinea === true]);
  const contraLinea = Object.entries(filas)
    .filter(([, v]) => v?.icono && v?.lineaTitulo)
    .map(([k, v]) => [k, Math.abs(v.icono.centroY - v.lineaTitulo.centroY)]);
  note(
    `distancia del icono al centro de su línea (lo que produce la pertenencia, no una prueba): ${contraLinea
      .map(([k, d]) => `${k} ${d} pt`)
      .join("; ")}`,
  );
  check(
    "el icono es hijo de la línea del título, y no hermano de su columna",
    hijos.length === 3 && hijos.every(([, esHijo]) => esHijo),
    hijos
      .map(([k, esHijo]) => `${k}: el nodo item-icon-${esHijo ? " está dentro de" : " NO está dentro de"} la línea del título`)
      .join("; "),
  );

  // **Entre filas**: la pregunta que la persona ha hecho, y la que hace falta con
  // dos filas del mismo número de líneas. El nombre arranca en el borde del
  // contenido y el icono a la misma distancia de ese borde haya o no haya una
  // segunda línea debajo.
  const desdeElBorde = (v, caja) =>
    v && caja ? Math.round((caja.y - v.fila.borde.top) * 10) / 10 : null;
  const losDos = Object.entries(filas)
    .filter(([k]) => k !== "nombreLargo")
    .map(([k, v]) => [
      k,
      {
        lineas: v?.lineas,
        nombre: desdeElBorde(v, v?.titulo),
        icono: desdeElBorde(v, v?.icono),
      },
    ]);
  note(
    losDos
      .map(
        ([k, v]) =>
          `${k}: nombre a ${v.nombre} pt del borde del contenido, icono a ${v.icono} pt, nombre de ${v.lineas} línea(s)`,
      )
      .join(" | "),
  );
  check(
    "el icono y el nombre arrancan a la misma altura con segunda línea y sin ella",
    losDos.length === 2 &&
      losDos[0][1].lineas === losDos[1][1].lineas &&
      Math.abs((losDos[0][1].icono ?? Infinity) - (losDos[1][1].icono ?? Infinity)) <= TOLERANCIA &&
      Math.abs((losDos[0][1].nombre ?? Infinity) - (losDos[1][1].nombre ?? Infinity)) <= TOLERANCIA,
    losDos
      .map(
        ([k, v]) =>
          `${k} (${v.lineas} línea(s) de nombre): icono a ${v.icono} pt, nombre a ${v.nombre} pt del borde de la fila`,
      )
      .join("; "),
  );

  // La segunda línea **solo si hay algo**. Se mira que no exista ninguna caja de
  // pastilla en la fila que no tiene ni insignia ni etiquetas, y no que "no se vea
  // ninguna": que el `View` no llegue al DOM es lo que se quiere, porque un hueco
  // vacío en la columna es justo lo que se pidió que no hubiera.
  check(
    "una tarea sin insignia ni etiquetas no dibuja la segunda línea",
    filas.sinDebajo?.meta === null &&
      filas.nombreLargo?.meta === null &&
      filas.conDebajo?.meta !== null,
    `la de una sola línea tiene ${filas.sinDebajo?.meta === null ? "ninguna caja de pastilla" : "una caja de pastilla"} y la otra tiene la segunda línea en y=${filas.conDebajo?.meta?.y ?? "—"}`,
  );

  // Y nada se sale. El nombre de "Mermelada" son 51 caracteres en una fila de 390:
  // es el caso en el que el nombre pasó de ser un hijo de una columna —donde su caja
  // se estiraba al ancho de la columna— a ser un hijo de una fila, y en una fila el
  // ancho lo decide la caja, que en react-native-web nace con flexShrink: 0.
  const anchoUtil = filas.nombreLargo?.fila
    ? filas.nombreLargo.fila.borde.right - filas.nombreLargo.fila.borde.left
    : null;
  // Solo se comparan las cajas que existen: un `-Infinity` dentro del `Math.max`
  // daría una comprobación que no puede fallar, que es justo lo que se vino aquí a
  // arreglar.
  const desborde = Object.entries(filas)
    .filter(([, v]) => v?.fila && v?.titulo)
    .map(([k, v]) => {
      const cajas = [v.titulo, v.cajaNombre, v.meta].filter(Boolean).map((c) => c.right);
      return [k, Math.max(...cajas) - v.fila.borde.right];
    });
  check(
    "un nombre de 51 caracteres no se sale de su fila, y tampoco la segunda línea",
    desborde.length === 3 && desborde.every(([, d]) => d <= TOLERANCIA),
    `${Math.round(anchoUtil ?? 0)} pt de ancho útil; ` +
      desborde
        .map(([k, d]) => `${k}: ${Math.round(d)} pt ${d > 0 ? "por fuera" : "de holgura"}`)
        .join(", "),
  );
  check(
    "el nombre largo ocupa dos líneas y no se corta en una",
    filas.nombreLargo?.lineas === 2,
    `"Mermelada de frutales de temporada para el desayuno" en ${filas.nombreLargo?.lineas} línea(s), ${Math.round(filas.nombreLargo?.titulo?.width ?? 0)} pt de ancho de un total de ${Math.round(anchoUtil ?? 0)}`,
  );

  // Y **sin hueco reservado** cuando no hay icono. La referencia es la **línea del
  // título**, y desde que la casilla está dentro de ella el borde izquierdo de esa
  // línea **es** el de la casilla —antes el borde de la fila era el que quedaba 42 pt
  // más a la izquierda por la casilla y el hueco de la fila, y comparar el nombre
  // contra ese borde medía la casilla y no el hueco del icono—.
  //
  // El número esperado sale de **medir la casilla**, no de escribirlo: sin icono el
  // nombre está al ancho de la casilla más un hueco, y si alguien volviera a
  // reservar el sitio del icono esto daría 24 pt más y fallaría, que es justo lo que
  // tiene que pillar.
  const sinIcono = await rowBoxes(tab, itemA.leche, "Leche");
  const anchoCasilla = sinIcono?.casilla?.width ?? null;
  const huecos = {
    sinIcono: sinIcono?.titulo?.x - sinIcono?.lineaTitulo?.x,
    conIcono: filas.conDebajo?.titulo?.x - (filas.conDebajo?.icono?.x + filas.conDebajo?.icono?.width),
  };
  note(
    `hueco entre el borde de la línea del título y el nombre: ${huecos.sinIcono} pt en la fila sin icono —la casilla mide ${anchoCasilla} pt— y ${huecos.conIcono} pt en la que lo tiene, y el nombre ocupa ${Math.round(sinIcono?.titulo?.width ?? 0)} pt de un total de ${Math.round(sinIcono?.lineaTitulo?.width ?? 0)}`,
  );
  check(
    "una fila sin icono no deja hueco: el nombre va detrás de la casilla y no de un sitio reservado",
    sinIcono?.icono === null &&
      huecos.sinIcono !== null &&
      huecos.conIcono !== null &&
      anchoCasilla !== null &&
      // Sin icono el nombre arranca justo detrás de la casilla: su ancho más **un**
      // hueco. La mitad con icono sigue yendo a `spacing.md`, y acotada por los dos
      // lados, porque con un `Math.abs(...) <= 13` también pasaría un 0 —el icono
      // pegado al nombre— y un 24 —el hueco del doble—, y son dos maneras de no
      // fallar. Los dos números salen del `spacing.md` de la fila, que es 12.
      Math.abs(huecos.sinIcono - (anchoCasilla + 12)) <= TOLERANCIA &&
      huecos.conIcono >= 12 - TOLERANCIA &&
      huecos.conIcono <= 12 + TOLERANCIA,
    `sin icono el nombre está a ${huecos.sinIcono} pt del borde de la línea, que son los ${anchoCasilla} de la casilla más un hueco de 12, y no hay ningún nodo con el testID del icono; con icono está a ${huecos.conIcono} pt, que es el hueco de spacing.md que hay entre el icono y el nombre`,
  );

  /*
   * Y la casilla, que antes se centraba contra **la fila entera** y por eso quedaba
   * 12 pt por debajo del centro de la línea del título en las filas de dos líneas.
   * Eso era una nota y no una comprobación porque era un precio aceptado; ahora que
   * la casilla vive dentro de la línea del título es una consecuencia, y una
   * consecuencia que se puede volver a romper sin querer.
   *
   * Esta comprobación **puede fallar**: en el árbol de antes, la casilla era hermano
   * de la columna y `styles.item` con `alignItems: "center"`, daba 12 pt en las filas
   * con segunda línea y 0 en las que no la tienen. Si alguien la saca otra vez de la
   * línea del título, los 12 pt vuelven y esto se pone rojo.
   */
  const desviacionCasilla = Object.entries(filas).map(([k, v]) => [
    k,
    v?.casilla && v?.lineaTitulo
      ? v.casilla.centroY - v.lineaTitulo.centroY
      : null,
  ]);
  check(
    "la casilla se centra en la línea del título, y no en la fila entera",
    desviacionCasilla.every(([, d]) => d !== null && Math.abs(d) <= TOLERANCIA),
    desviacionCasilla
      .map(
        ([k, d]) =>
          `${k}: la casilla está a ${d === null ? "—" : Math.round(d)} pt del centro de la línea del título`,
      )
      .join(" | "),
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

  await capturas(listaA, 6, "etiquetas-05-compra-despues");
  await capturas(listaB, 4, "etiquetas-06-semana-despues");

  for (const esquema of ["light", "dark"]) {
    await tab.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-color-scheme", value: esquema }],
    });
    await openLabels(listaA, itemA.huevos, "Huevos");
    await pressTestIdRaw(tab, `tag-color-button-urgente`);
    await sleep(800);
    await shot(
      tab,
      `${SHOTS}/etiquetas-07-hoja-etiquetas-despues-${esquema === "light" ? "claro" : "oscuro"}.png`,
    );
    await pressLabel(tab, "Cerrar", { exact: true }).catch(() => false);
    await sleep(600);
    // Y una tarea **sin** etiquetas, que es la unica que tiene los dos "+": el de
    // poner una etiqueta que la lista ya tiene y el de escribir una nueva. Los
    // dos se necesitan en una imagen para juzgarlos; medidos solos son dos
    // numeros, y a 130 pt de separacion no se pueden comparar de memoria.
    await openLabels(listaA, itemA.leche, "Leche");
    await shot(
      tab,
      `${SHOTS}/etiquetas-08-los-dos-mas-${esquema === "light" ? "claro" : "oscuro"}.png`,
    );
    await pressLabel(tab, "Cerrar", { exact: true }).catch(() => false);
    await sleep(600);
  }

  /* ----------------------------------------------------------------- 13 ----- */
  section("13. La consola, al final de todo");

  /*
   * Las capturas sin la fuente de los iconos se cuentan aquí y no en el `shot()`.
   *
   * `shot()` no puede fallar la ejecución desde dentro —no está dentro de nada que
   * devuelva un código de salida— y una espera que falla en silencio deja el mismo
   * fichero en disco que una espera que va bien, que es justo el modo de fallo que
   * la primera versión tenía: dieciséis imágenes sin un solo glifo que nadie miró
   * porque el guion iba en verde.
   *
   * La imagen **se escribe igual** en el caso de fallo, a propósito: para que haya
   * algo que mirar y se vea que le falta el glifo. Lo que no puede pasar es que eso
   * salga en verde.
   */
  check(
    "ninguna captura se tomó sin la fuente de los iconos",
    capturasSinFuente === 0,
    capturasSinFuente === 0
      ? "las siete capturas esperando a document.fonts.check(\"18px ionicons\")"
      : `${capturasSinFuente} de las capturas se tomaron sin la fuente de los iconos: están en el disco y son las que hay que mirar antes de creerse nada de ellas`,
  );

  /**
   * Lo que esta comprobación quita, y por qué, y sólo por qué.
   *
   * **Dos conjuntos, y ninguno de los dos se deduce del texto del error.**
   *
   *  1. `problemasPorCortar`: los índices que Produceron mientras no había red,
   *     que este guion ha cortada a propósito. La regla 4 de
   *     `docs/verificacion-en-navegador.md` —un error de consola es un fallo— sigue
   *     valiendo para todo lo demás: un filtro por texto habría dejado pasar
   *     cualquier otra cosa que pasara en ese rato.
   *  2. `ruidoDeSesion`: un **401 en `sync/`**. El token de acceso vive quince
   *     minutos, la aplicación refresca sola en cuanto un 401 le llega y la
   *     siguiente llamada va con el bueno. Es la machinery de la sesión haciendo su
   *     trabajo. Es lo más estrecho que se puede hacer sin dejar de mirar: sólo
   *     `401` y sólo `sync/pull` o `sync/push`, nunca un `500` ni un `404` ni un
   *     error de consola, que es donde vive un fallo de verdad.
   *
   * Y lo que se quita **se cuenta y se escribe**, porque un filtro que se come
   * cosas en silencio es un filtro que un día se come la comprobación entera.
   */
  const ruidoDeSesion = (p) =>
    p.kind === "http" && / 401 /.test(p.text) && /\/sync\/(pull|push)/.test(p.text);
  const todo = problems
    .map((p, i) => ({ ...p, i }))
    .slice(problemasDesdeElPrincipio);
  const comidosPorCorte = todo.filter((p) => problemasPorCortar.has(p.i));
  const comidosPorSesion = todo.filter((p) => !problemasPorCortar.has(p.i) && ruidoDeSesion(p));
  const reales = todo.filter((p) => !problemasPorCortar.has(p.i) && !ruidoDeSesion(p));
  check(
    "nada ha fallado en la consola en ninguna pantalla, ni durante el arranque",
    reales.length === 0,
    reales.map((p) => `${p.kind}: ${p.text.slice(0, 140)}`).join(" | ") || "0 problemas",
  );
  if (comidosPorCorte.length > 0) {
    note(
      `${comidosPorCorte.length} entradas de consola con la red cortada por este guion (${[...new Set(comidosPorCorte.map((p) => p.kind))].join(", ")}): no se cuentan ni se miran, y su ventana está acotada a los índices del corte`,
    );
  }
  if (comidosPorSesion.length > 0) {
    note(
      `descartados ${comidosPorSesion.length} 401 de sync por sesión (el token de acceso caduca a los 15 min y la comprobación dura más): ${[...new Set(comidosPorSesion.map((p) => p.text))].join(", ")}`,
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
