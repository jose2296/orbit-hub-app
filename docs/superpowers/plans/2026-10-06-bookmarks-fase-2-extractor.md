# Bookmarks fase 2: el extractor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un endpoint que, dado un bookmark, busca su URL, extrae el texto del articulo, lo reduce al formato de documento del repo y lo guarda — con un guard de SSRF que no se pueda esquivar por redirect.

**Architecture:** El fetch y el parseo ocurren **fuera** del sync, en un endpoint propio `POST /bookmarks/:id/extract` con la escritura en manos del servidor. El pipeline es: validar la URL con el predicado que ya existe, buscar el HTML con un `fetch` que revalida la IP resuelta en cada redirect, sacar metadata OG a mano, correr Readability, reducir su HTML **desenvolviendo** los tags no permitidos, y validar con el `noteDocumentSchema` que ya protege las notas. Si cualquier paso falla, el bookmark sigue existiendo con su URL: lo unico que cambia es `extractionState`.

**Tech Stack:** Express 5 sobre Node con `fetch` nativo, `jsdom` + `@mozilla/readability` (versionadas en la Task 1), Zod v4, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-05-bookmarks-share-target-design.md` — seccion **"El extractor"**, que ya tiene los numeros del spike. El plan razona desde ahi; los conflictos se resuelven contra el spec.

**Ledger del spike (medido, no re-medir):** `.superpowers/sdd/2026-10-05-bookmarks-share-target-design/progress.md`

## Global Constraints

- **Comentarios y prosa en espanol SIN tildes.** Strings de UI con tildes, en espanol e ingles; esta fase casi no toca UI.
- **La autorizacion es del servidor (AGENTS.md regla 8).** El endpoint no es una excepcion: quien pide extraer tiene que poder escribir en el espacio del bookmark.
- **Un bookmark nunca se pierde por culpa de un tercero.** Si el sitio esta caido, paywalled o es una SPA, la fila vive igual y lo unico que cambia es `extractionState` con un motivo corto.
- **Sin dependencias fuera de las dos de la Task 1** (`jsdom`, `@mozilla/readability`). Si hace falta una tercera, se para y se pregunta.
- Commits Conventional Commits, espanol, sin tildes. **NUNCA `Co-Authored-By` ni atribucion de IA.**
- Rutas en `apps/api/src/routes/*.ts`, servicios en `apps/api/src/modules/bookmarks/`, tests en `apps/api/test/`.
- `tsconfig.base.json` tiene `noUnusedLocals`: sin imports muertos.

## Review Focus

Cinco entradas que la spec promete y que son las que mas van a morder. Cada linea tiene su test en la tarea duena del codigo.

1. **Una URL que resuelve a `169.254.169.254` o a `127.0.0.1`.** Es el ataque: compartir un enlace a un sitio controlado, y el servidor entra a la red en la que la persona no puede. Lo esperable es rechazarlo **sin hacer el request**. *Tarea 2.*
2. **Un redirect de un sitio publico a `http://127.0.0.1/x`.** El `Location` es el lugar clasico donde se mete una IP interna, y revalidar solo la URL inicial no alcanza. *Tarea 2.*
3. **Una pagina que devuelve 500 MB o se cuelga.** El fetch tiene que tener tope de bytes y timeout **duros**, y abortar leyendo, no despues. *Tarea 2.*
4. **Un articulo con `<script>` adentro.** Es lo mas comun en HTML real, y si llega al DOM su contenido puede entrar en el texto del documento. *Tarea 3.*
5. **Un video de YouTube.** Lo esperable es `metadata_only` con metadata buena, **nunca** `ready` con nueve palabras. *Tarea 4.*

## Estructura de archivos

**Crear**
| archivo | responsabilidad |
| --- | --- |
| `apps/api/src/lib/ssrf.ts` | el guard: esquemas, rangos privados, redirecciones, tope de bytes, timeout |
| `apps/api/src/modules/bookmarks/extract-metadata.ts` | los OG tags a mano y el `oembed` de YouTube |
| `apps/api/src/modules/bookmarks/extract-content.ts` | Readability + la reduccion a `noteDocumentSchema` |
| `apps/api/src/modules/bookmarks/extract-service.ts` | orquesta, decide `extractionState`, y es lo unico que escribe |
| `apps/api/test/ssrf.test.ts` | el guard, con fixtures de IPs de loopback/privada/link-local |
| `apps/api/test/bookmarks-extract.test.ts` | el pipeline con HTML real en un fixture |

**Modificar**
| archivo | que cambia |
| --- | --- |
| `apps/api/src/modules/bookmarks/bookmark-service.ts` | exposicion de lo que el extractor necesita (fila + permiso) |
| `apps/api/src/routes/bookmarks.ts` | `POST /:id/extract` |
| `apps/api/package.json` | las dos dependencias, **ya fijadas por la Task 1 de este plan** |

---

### Task 1: Las dependencias, medidas antes de instalar

**Files:**
- Modify: `apps/api/package.json`

**Interfaces:**
- Consumes: nada.
- Produces: `jsdom` y `@mozilla/readability` importables desde `apps/api`, con version fijada.

> **Por que esta tarea va primera y es solo un install.** El spike los midio en un entorno temporal y los desinstalo. La razon de fijarlos **antes** de escribir una linea de codigo es que si uno de los dos no instala limpio, hay que saberlo con el arbol intacto, no con seis archivos de extractor a medio escribir encima.

- [ ] **Step 1: Fijar las versiones que midio el spike**

El spike dio `jsdom@30.1.2` y `@mozilla/readability@0.6.0`, con 45 paquetes y 47,6 MB. Anotalas en `apps/api/package.json` bajo `dependencies`, en orden alfabetico dentro del bloque. **No las instales todavia**: el Step 3 es el que instala, y este paso solo las deja escritas.

- [ ] **Step 2: Verificar que las dos lineas quedaron donde corresponde**

Run: `grep -n "jsdom\|readability" apps/api/package.json`
Expected: dos lineas, en `dependencies`, no en `devDependencies`. `jsdom` es de **produccion**: el extractor corre en el servidor, no en un test.

- [ ] **Step 3: Instalar y confirmar que no se rompio nada**

Run: `npm install && npm run api:test`
Expected: PASS. El numero de tests tiene que ser el mismo que antes de instalar (los de las fases 1 y 2 de la spec), ni uno mas ni uno menos: instalar no puede cambiar la conducta de nada.

- [ ] **Step 4: Confirmar que los dos se importan desde el codigo de produccion**

Run: `cd apps/api && node -e "const {JSDOM}=require('jsdom');const {Readability}=require('@mozilla/readability');console.log('ok', typeof JSDOM, typeof Readability)"` (desde la raiz del repo, con el `node_modules` ya resueltos)
Expected: `ok function function`.

Si alguno falla aqui, **para y reportalo**: significa que el paquete instala pero no carga, y eso es una decision antes de escribir el extractor.

- [ ] **Step 5: Commit**

```bash
git add apps/api/package.json package-lock.json
git commit -m "build(api): jsdom y readability, con las versiones que midio el spike"
```

---

### Task 2: El guard de SSRF

**Files:**
- Create: `apps/api/src/lib/ssrf.ts`
- Test: `apps/api/test/ssrf.test.ts`

**Interfaces:**
- Consumes: `esUrlQueSePuedePedir` de `apps/api/src/modules/sync/sync-service.ts:156` (ya existe y ya esta testeado; **importalo, no lo reescribas**).
- Produces:
  ```ts
  export interface OpcionesDeBusqueda {
    timeoutMs?: number;   // default 8000
    maxBytes?: number;    // default 2_000_000
    maxRedirects?: number; // default 3
  }
  export type ResultadoDeBusqueda =
    | { ok: true; html: string; finalUrl: string; bytes: number }
    | { ok: false; motivo: string };
  export async function traerHtmlSeguro(
    rawUrl: string,
    opciones?: OpcionesDeBusqueda,
  ): Promise<ResultadoDeBusqueda>;
  ```
  La Tarea 3 consume `traerHtmlSeguro`. El motivo de fallo es una **cadena corta en ingles** que va directo a `extractionError`, asi que tiene que ser corta y util ("dns resolves to a private address", no "Error 2").

> **El problema mas importante de esta fase, y el unico que no es negociable.** Una URL compartida es **input no confiable**, y el servidor la va a fetchear. Sin el guard, un atacante que logre que la app busque una URL que controla esta pidiendo al servidor que entre a una red en la que la persona no puede entrar. Cada linea de este archivo tiene que justificarse por eso.

- [ ] **Step 1: Write the failing test — el rango que hay que rechazar**

`apps/api/test/ssrf.test.ts`. Los fixtures son **URLs**, no IPs sueltas: lo que se valida es lo que devuelve el DNS, asi que los casos Interesting son los que el DNS de un atacante puede hacer.

```ts
import { describe, expect, it } from 'vitest';

import { traerHtmlSeguro } from '../src/lib/ssrf.js';

describe('el guard de SSRF', () => {
  it('rechaza los esquemas que no son http ni https, sin hacer el request', async () => {
    for (const url of [
      'file:///etc/passwd',
      'data:text/html,hola',
      'gopher://127.0.0.1:11211/',
      'ftp://example.com/x',
    ]) {
      const r = await traerHtmlSeguro(url);
      expect(r.ok, url).toBe(false);
    }
  });

  it('rechaza una URL que resuelve a loopback', async () => {
    const r = await traerHtmlSeguro('http://127.0.0.1:9/');
    expect(r).toMatchObject({ ok: false });
  });

  it('rechaza el rango de metadatos de la nube, que es el ataque clasico', async () => {
    // 169.254.169.254 es donde la nube expone los credenciales del servidor.
    const r = await traerHtmlSeguro('http://169.254.169.254/latest/meta-data/');
    expect(r).toMatchObject({ ok: false });
  });

  it('acepta una pagina publica y devuelve su HTML', async () => {
    const r = await traerHtmlSeguro('https://example.com');
    expect(r.ok).toBe(true);
  });
});
```

Los tres primeros son Review Focus #1. El ultimo prueba que el guard **no** es una puerta cerrada: un guard que rechaza todo no protege, rompe.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run api:test -- ssrf`
Expected: FAIL, porque `../src/lib/ssrf.js` no existe.

- [ ] **Step 3: `esUrlQueSePuedePedir` primero, y el porque esta aca**


- [ ] **Step 4: Resolver y rechazar los rangos privados, y fijar la IP**

El nucleo del archivo. Node trae `dns.promises.lookup` con `{ all: true, verbatim: true }`, que devuelve **todas** las direcciones de un nombre, y `fetch` acepta un `dispatcher` de `undici` para fijar a donde se conecta.

El procedimiento, en este orden:

1. `dns.lookup(hostname, { all: true, verbatim: true })`.
2. **Si alguna** direccion devuelta cae en un rango prohibido, rechazar entero. No basta con mirar la primera: un nombre puede tener una A publica y una AAAA privada, y el `fetch` podria elegir la que quiera.
3. Fijar la conexion a una direccion **publica** concreta, para que un DNS que cambia entre la validacion y la conexion no se cuele. En `undici` eso es `new Agent({ connect: { lookup: (host, opts, cb) => cb(null, ip fija, family) } })`.

Los rangos a rechazar, y **por que cada uno**:

| rango | por que |
| --- | --- |
| `127.0.0.0/8` | loopback: el propio servidor |
| `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` | red privada de una oficina o de una VPC |
| `169.254.0.0/16` | **metadatos de la nube**: el ataque clasico, y devuelve credenciales |
| `::1`, `fc00::/7`, `fe80::/10` | loopback y link-local en IPv6 |
| `0.0.0.0/8` | "any", que en algunas plataformas enruta a loopback |

Escribi el chequeo de IPv4 en bits, no con rangos de `startsWith`: `172.16` y `172.32` comparten prefijo de texto y no comparten nada mas. Para IPv6, expande a bytes y compara prefijo.

**El test de esto tiene que usar un nombre, no una IP literal**, porque una IP literal se puede rechazar por el parseo y no por el rango. Si el guard rechaza `http://127.0.0.1/` pero acepta un nombre publico que resuelve a `127.0.0.1`, el guard no existe. Un nombre que resuelve a loopback de forma estable y publica es `localtest.me`; si no resuelve en tu entorno, **usa `localhost` y dilo** en el reporte, pero entonces el test tiene que aclarar que cubre menos.

- [ ] **Step 5: Los redirects, revalidando en cada salto**

Review Focus #2. Con `redirect: 'manual'`, `fetch` devuelve la respuesta sin seguir el salto y con la cabecera `location`. El bucle:

1. Buscar con `redirect: 'manual'`.
2. Si el estado es 301/302/303/307/308: leer `location`, resolverla contra la URL actual, y **empezar de nuevo desde el paso 1** — o sea, volver a pasar por `esUrlQueSePuedePedir`, por el chequeo de rangos y por el fijado de IP.
3. Si se pasaron `maxRedirects`, cortar con `too many redirects`.
4. Si no es un redireccion, es la respuesta final.

**El error clasico, y el motivo de que el bucle sea completo**: validar la URL inicial y despues dejar que `fetch` siga los redirects por su cuenta manda el segundo request a donde un atacante quiera. Con `manual`, cada salto se revalida.

- [ ] **Step 6: Tope de bytes y timeout duros**

Review Focus #3.

- El **timeout** es un `AbortController` con `AbortSignal.timeout(timeoutMs)`, y se limpia en un `finally` para no dejar un timer colgado. Es por request, no por el total: con 3 redirects, 8 s cada uno son 24 s, y el timeout total se lleva aparte si lo quieres. **Decide una cosa y escribela**: el default es 8 s por request, y el endpoint (Task 4) impose el suyo.
- El **tope de bytes** no se puede hacer con `content-length` solo, porque el servidor puede mentir o no mandarlo. Hay que **leer el cuerpo por trozos y abortar en cuanto se pasa el tope**. El `fetch` nativo expone `res.body` como un stream; acumular chunks y tirar cuando `total > maxBytes` es lo unico que funciona contra una respuesta infinita.

- [ ] **Step 7: Un test mas, para el tope de bytes**


**Elige (b)**: fabricar un `Response` con un `ReadableStream` que emite chunks endless y comprobar que la funcion corta al pasar `maxBytes`. Es un test unitario, sin red y sin puertos, y prueba exactamente la logica que importa: que el corte ocurre **mientras se lee**.

Si eliges (a), el guard necesita un punto de inyeccion para la IP, y eso es una superficie nueva. Preferi (b).

- [ ] **Step 8: Run test to verify it passes**

Run: `npm run api:test -- ssrf`
Expected: PASS en los cinco.

**Verifica que los tests muerden**: cambia un rango a otro (por ejemplo, saca `169.254.0.0/16` de la lista) y confirma que el test del ataque clasico se pone rojo. Y pon `redirect: 'follow'` en el Step 5 y confirma que el test de redirects —si lo tienes— falla. Revertir todo despues.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/lib/ssrf.ts apps/api/test/ssrf.test.ts
git commit -m "feat(api): el guard de SSRF, con la IP fijada y cada redirect revalidado"
```

---

### Task 3: El contenido

**Files:**
- Create: `apps/api/src/modules/bookmarks/extract-content.ts`
- Test: `apps/api/test/bookmarks-extract.test.ts`

**Interfaces:**
- Consumes: `traerHtmlSeguro` (Task 2), `noteDocumentSchema` y `noteDocumentToPlainText` de `@orbit-hub/contracts` (`note-document.ts:450` y `:485`), `JSDOM`, `Readability`.
- Produces:
  ```ts
  export interface ContenidoExtraido {
    document: string;      // ya validado con noteDocumentSchema
    plainText: string;     // ya derivado
    titulo: string | null; // de Readability, si hay
    texto: string;         // el texto plano, para medir el piso de palabras
  }
  export type ResultadoDeContenido =
    | { ok: true; contenido: ContenidoExtraido }
    | { ok: false; motivo: string };  // "not an article", "too short", "unreadable"
  export async function extraerContenido(
    html: string,
    url: string,
  ): Promise<ResultadoDeContenido>;
  ```

> **La regla que el spike cobro cara: reducir es desenvolver, no descartar.** Readability fallo el validador en 5 de 5 paginas, y el 57,5 % de los elementos de Wikipedia son tags que el conjunto cerrado no acepta. Al desenvolver cada tag conservando hijos y texto, sobrevive el 99,8 % del texto. Si descartas el tag entero, tiras prosa que el usuario guardo a proposito.

- [ ] **Step 1: Guardar el fixture antes de escribir el codigo**

Los tests de esta tarea **no bajan nada de internet**: usan HTML guardado. Es lo que los hace deterministas, y ademas es lo unico que funciona en un pipeline de CI.

Guarda en `apps/api/test/fixtures/` al menos tres HTML reales, guardados con la forma que los uso en los tests: **uno de articulo largo** (con `div`, `span`, `figure`, `sup`, `table`), **uno de watch de YouTube** (que no es articulo), y **uno corto**.

**Guardalos con la forma que produce Readability, no con el HTML crudo de la pagina.** La diferencia importa: Readability ya limpio la pagina, y un test con el HTML crudo estaria probando otra cosa. Si no podes generarlos con Readability en este repo todavia, usa el HTML crudo **y dilo en un comentario del test**, porque entonces el test tiene una limitacion que hay que conocer.

- [ ] **Step 2: Write the failing test — la reduccion conserva el texto**

```ts
import { describe, expect, it } from 'vitest';

import { extraerContenido } from '../src/modules/bookmarks/extract-content.js';
import { notaDocumentSchema } from '@orbit-hub/contracts';
```

Los tres tests que importan:

```ts
it('el texto del articulo sobrevive a la reduccion', () => {
  // el fixture de articulo largo
  expect(r.ok).toBe(true);
  const palabrasAntes = contarPalabras(textoCrudoDelFixture);
  const palabrasDespues = contarPalabras(r.contenido.plainText);
  // El spike midio 99,8 % en Wikipedia. Un 95 % es el piso razonable y
  // sigue siendo la prueba de que desenvolver no tira prosa.
  expect(palabrasDespues).toBeGreaterThan(palabrasAntes * 0.95);
});

it('lo que sale pasa el validador que protege las notas', () => {
  expect(() => notaDocumentSchema.parse(r.contenido.document)).not.toThrow();
});

it('un script nunca llega al documento', () => {
  // Review Focus #4
  expect(r.contenido.document).not.toContain('alert(');
  expect(r.contenido.plainText).not.toContain('function');
});
```

`contarPalabras` es un helper local del test: `text.split(/\s+/).filter(Boolean).length`.

El segundo test es el importante: **es el mismo validador que protege las notas**, y por eso el extractor no necesita una frontera de seguridad nueva.

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run api:test -- bookmarks-extract`
Expected: FAIL, porque `extract-content.ts` no existe.

- [ ] **Step 4: JSDOM con los scripts fuera, antes de pagar el DOM**

Review Focus #4, y ademas es la optimizacion mas grande que midio el spike: **limpiar `<script>` antes de construir el DOM da 7x**.

Se hace con `JSDOM` + `runScripts: 'outside-only'` (nunca `dangerously`, que ejecutaria el JavaScript de una pagina que no es nuestra), y un **`removeScript`-antes** que borra `<script>` y `<noscript>` del HTML crudo **con una regex**, antes de pasar la cadena al parser.

**Por que antes y no despues**: borrar `<script>` con una regex sobre el crudo es barato y evita construir el DOM entero. Despues, con el DOM ya construido, el trabajo ya esta pago.

El riesgo de la regex es que una pagina puede tener `<script>` dentro de un atributo o de un comentario. Como el objetivo aqui es **reducir trabajo, no ser la frontera de seguridad** —la frontera es el validador del Task 3 Step 6— una regex razonable alcanza. **Decilo en un comentario**, para que nadie la tome por la defensa.

- [ ] **Step 5: Readability, y el piso de palabras**

`new Readability(new JSDOM(html, { url }).window.document).parse()` devuelve el articulo, o `null` si no cree que haya articulo.

**El piso de palabras va aca, y es Review Focus #5.** El spike midio que sin scripts YouTube da `null`, y con scripts da nueve palabras. Con la limpieza de la Task 3 Step 4 aplicada antes, el `null` vuelve — pero **no hay que confiar en eso**: el piso es la garantia explicita.

Sin numero fijo: se mide. El spike dio 947 palabras para el articulo mas corto que funciono, asi que un piso de **50 palabras** separa con holgura un articulo real de un recorte. Si el texto extraido tiene menos de 50 palabras, el resultado es `{ ok: false, motivo: 'too short' }` y el estado sera `metadata_only` (Task 4).

**Escribe el numero en el codigo como constante con el porque**, porque alguien va a querer bajarlo.

- [ ] **Step 6: La reduccion, y donde el validador decide**

**Lee `packages/contracts/src/note-document.ts:157-185` antes de escribir esta parte.** El tokenizador es **estricto y sin DOM**, y su comentario dice lo que cambia el algoritmo: *"A tag it cannot read is reported as a `close`, which the walk below then fails on, so an unreadable input is rejected rather than silently skipped."*

La consecuencia es que **desarrollar un tag no suffitia**: si `<sup>[1]</sup>` se desarrolla a `[1]` suelto, ese texto queda **fuera de todo tag permitido** y el validador lo rechaza, porque el formato no tiene un nodo de texto en la raiz. **El texto tiene que acabar dentro de un tag permitido**, casi siempre `<p>`.

El algoritmo, con el orden importa:

1. Parsear el `content` de Readability con `JSDOM`, con `url` como base para que las imagenes relativas resuelvan.
2. **Recorrer en profundidad y desenvolver** cada elemento cuyo tag no este en el conjunto cerrado, **envolviendo su contenido suelto en `<p>`**. Es decir: desenvolver no es borrar el tag y dejar los hijos donde estaban; es substitute el tag por sus hijos, y si un hijo queda como nodo de texto sin tag padre, envolverlo en `<p>`.
   Los `script`, `style` y `noscript` si se **borran** enteros, sin envoltura: su contenido no es prosa.
3. Para los tags que si estan en el conjunto pero **no admiten atributos** (la lista `ATTRIBUTE_FREE` de `note-document.ts:64`), quitar los que tengan. El `a` si los admite, pero solo los que el formato define; el `img` solo `width` y `height`, con `MAX_IMAGE_EDGE` como tope.
4. Colapsar `<p>` anidados: el algoritmo infla 93 `<p>` de entrada a 418 (medido en el spike), y `<p>` dentro de `<p>` tampoco esta permitido.
5. **Validar con `noteDocumentSchema.parse(...)`.** Si tira, el resultado es `{ ok: false, motivo: 'unreadable' }`.

**El paso 5 es el que decide y es el que no se negocia.** La reduccion es un intento; el validador es la frontera. Si lo que salio no pasa, **no se guarda**: se guarda la metadata y nada mas. Es preferible un enlace sin texto a un documento invalido, porque el documento invalido es el que el editor movil no sanea.

**Y el paso 2 es donde el spike cobra su valor.** Al desenvolver **envolviendo**, el 99,8 % de supervivencia que midio el spike se mantiene; al desenvolver **soltando**, el validador rechaza el documento entero. Son dos algoritmos que se parecen en el papel y dan resultados opuestos, asi que el test de supervivencia de palabras del Step 2 es el que distingue uno del otro. Si ese test falla, el error **no** es de Readability: es del paso 2.

- [ ] **Step 7: `plainText`, derivado y no reimplementado**

`plainText` sale de `noteDocumentToPlainText(document)`, la misma funcion que usan las notas. **No la reimplementes**: es el indice trigram de `bookmarks.plain_text` (migracion `0022`) que se construye sobre ese texto, y dos implementaciones divergen en la busqueda sin que nadie lo note.

- [ ] **Step 8: Los tres tests con el fixture de video**

Con el fixture de YouTube: `{ ok: false, motivo: 'too short' }` o `'not an article'`. **No** un `ok: true` con nueve palabras. Ese es exactamente el fallo que el piso evita.

Y agrega **un test de contenido insuficiente explicito**: un HTML con un solo parrafo de cinco palabras tiene que dar `too short`. Asi el piso esta probado por su regla y no solo por el caso de YouTube.

- [ ] **Step 9: Run test to verify it passes**

Run: `npm run api:test -- bookmarks-extract`
Expected: PASS.

**Verifica la mordida**: en el Step 6, cambiar el_absDeveloping_ por borrar el elemento entero y mira si el test de supervivencia de palabras se pone rojo. Esa es la prueba de que el test mide lo que dice medir. **Sin scripts** tambien tiene que hacer rojo el test #4. Revertir todo.

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/modules/bookmarks/extract-content.ts apps/api/test/bookmarks-extract.test.ts apps/api/test/fixtures/
git commit -m "feat(api): el contenido del articulo, reducido con desenvolver y validado con el del editor"
```

---

### Task 4: La metadata

**Files:**
- Create: `apps/api/src/modules/bookmarks/extract-metadata.ts`
- Test: en `apps/api/test/bookmarks-extract.test.ts`

**Interfaces:**
- Consumes: `traerHtmlSeguro` (Task 2), `JSDOM`.
- Produces:
  ```ts
  export interface MetadataDePagina {
    title: string | null;
    siteName: string | null;
    description: string | null;
    imageUrl: string | null;
  }
  export function sacarmetadata(html: string, url: string): MetadataDePagina;
  export async function metadataDeYoutube(url: string): Promise<MetadataDePagina | null>;
  ```

> **Los OG tags se leen a mano a proposito.** Son `<meta property="og:title">` y compania: un puñado de consultas sobre el DOM que ya se construyo, **cero dependencias**. Readability ademas devuelve `siteName` y `excerpt`, asi que hay solapamiento y se fusiona por precedencia, que es la parte que hay que dejar escrita.

- [ ] **Step 1: Write the failing test — la precedencia de la spec**

```ts
describe('la metadata de una pagina', () => {
  it('usa el titulo de la pagina antes que el de Open Graph si Readability no dio ninguno', ...);
  it('el titulo que la persona escribio no lo pisa nadie', ...);   // <- en el servicio, Task 5
  it('trae la imagen de og:image cuando la hay', ...);
  it('no se rompe con una pagina que no tiene ninguno', ...);       // todo null
});
```

La precedencia es la de la spec y hay que tenerla en un solo lugar: **`title`: lo que escribio la persona > titulo de Readability > `og:title` > hostname**. `description`: `og:description` > excerpt de Readability. `imageUrl`: `og:image` > imagen principal. `siteName`: `og:site_name` > hostname sin `www`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run api:test -- bookmarks-extract`
Expected: FAIL.

- [ ] **Step 3: Los OG tags, a mano**

- `og:title`, `og:description`, `og:image`, `og:site_name`
- los equivalentes de Twitter cuando no haya `og:` (`twitter:title` y compania), que es lo que hacen muchas paginas
- `<title>` del documento, y el `<meta name="description">` como ultimo recurso

**Todas las URLs que vienen de la pagina son no confiables**, tambien para esto: un `og:image` puede ser `javascript:...` o una IP interna. Se validan con `esUrlQueSePuedePedir` (que ya existe, Task 2 Step 3) **y** con el chequeo de rangos, o el `imageUrl` guardado es un vector que el cliente va a pedir sin guard. Si no pasa, `imageUrl` queda en `null`.

Ese punto no estaba en el plan y es un hallazgo: **`og:image` es un fetch diferido del cliente**, y sin validarlo se convierte en un SSRF desde el movil.

- [ ] **Step 4: YouTube por `oembed`, sin API key**

Review Focus #5, la otra mitad. `https://www.youtube.com/oembed?url=<url>&format=json` no pide credencial y devuelve titulo, autor y thumbnail. Son quince lineas y cubre el caso que el usuario menciono de entrada.

Si la respuesta no es un JSON con `title`, se devuelve `null` y la metadata del video se arma con lo que haya en los OG tags del HTML, que YouTube tambien los trae.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run api:test -- bookmarks-extract`
Expected: PASS.

Los tests de metadata **no bajan nada**: usan HTML de fixture. El `oembed` si es una llamada real, y va en su propio `it` marcado como el unico que depende de internet.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/bookmarks/extract-metadata.ts apps/api/test/bookmarks-extract.test.ts
git commit -m "feat(api): la metadata de Open Graph a mano, y el oembed de YouTube sin llave"
```

---

### Task 5: El servicio y el endpoint

**Files:**
- Create: `apps/api/src/modules/bookmarks/extract-service.ts`
- Modify: `apps/api/src/modules/bookmarks/bookmark-service.ts`
- Modify: `apps/api/src/routes/bookmarks.ts`
- Test: `apps/api/test/bookmarks-extract.test.ts`

**Interfaces:**
- Consumes: `traerHtmlSeguro` (Task 2), `extraerContenido` (Task 3), `sacarmetadata`/`metadataDeYoutube` (Task 4), `esUrlQueSePuedePedir`, `noteDocumentToPlainText`, `sendData`, `requireAuth`.
- Produces: `POST /api/v1/bookmarks/:id/extract` (204), y escribe `document`, `plainText`, `title` (si estaba vacio), `siteName`, `description`, `imageUrl`, `extractionState`, `extractionError`, y **suma `version` y `updatedAt`** para que el pull del proximo ciclo lo traiga.

> **`assertCanWrite` NO se puede reusar**: es `private` en `sync-service.ts:553`, y sacarlo a un modulo compartido es un cambio mas grande que esta fase y toca el motor de sync. Lo que este servicio necesita es comprobar la **pertenencia con rango** al espacio del bookmark, y eso ya existe como `MEMBERSHIP_ROLE_RANK` en `apps/api/src/db/constants.ts`. Reusa **esa** comparacion, o el helper publico de `collection-service.ts` si hay uno, y **no** edites `sync-service.ts` para esto.

> **Este es el unico lugar que escribe los siete campos del servidor, y por diseno.** La frontera de escritura de la fase 1 los saca del allow-list para que ningun cliente pueda mandarlos; aqui es donde el servidor los produce. Si aparece una segunda ruta que escriba `document`, es un defecto.

- [ ] **Step 1: Write the failing test — el recorrido y los cuatro estados**

```ts
describe('extraer un bookmark', () => {
  it('un bookmark pending con una pagina que se puede leer queda ready', ...);
  it('un video queda metadata_only, con metadata y sin documento', ...);  // Review Focus #5
  it('una URL que el guard rechaza queda failed, con el motivo', ...);     // Review Focus #1
  it('nunca tira: un sitio caido deja el bookmark vivo y failed', ...);
  it('el que no puede escribir en el espacio recibe 404 y no extrae', ...);  // regla 8
});
```

El cuarto es el que mas importa de los cinco: **`extraer` no puede ser una excepcion a que el servidor manda**. Si un viewer pide extraer, el bookmark no cambia.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run api:test -- bookmarks-extract`
Expected: FAIL, no hay endpoint.

- [ ] **Step 3: El servicio, y el orden de las decisiones**

El cuerpo es una cadena de decisiones, y el orden importa porque cada una puede terminar el proceso:

1. Cargar el bookmark por id. Si no existe o la persona no es miembro, `HttpError.notFound` (**404**, no 403: no confirmar que existe).
2. Comprobar el **rango** en el espacio del bookmark con `MEMBERSHIP_ROLE_RANK` (ver la nota de Interfaces: `assertCanWrite` es `private` y no se reusa). Si no llega a editor, 403. **Este es el chequeo que no puede faltar**: sin el, un viewer dispara extracciones y gasta el ancho de banda del servidor a voluntad.
3. Si `extractionState` ya es `ready`, responder 204 sin hacer nada: reextraer un articulo que ya esta bien es trabajo tirado.
4. `traerHtmlSeguro(bookmark.url)`. Si falla, `failed` con el motivo y **se corta aqui**.
5. `sacarmetadata` (y `metadataDeYoutube` si la URL es de YouTube).
6. `extraerContenido`. Si falla: **se guarda la metadata igual** y el estado es `metadata_only` o `failed` segun el motivo. Un articulo del que no se pudo sacar el texto **igual tiene titulo, sitio e imagen**, y eso ya es el `metadata_only` del spec.
7. Si el contenido entra: `document`, `plainText`, y `title` **solo si el actual estaba vacio**.
8. Sumar `version` y poner `updatedAt`, que es lo que hace que el `pull` del proximo ciclo lo traiga.

**El paso 6 es el que hace que `metadata_only` sea una respuesta y no un fallo.** Y el paso 7 es la regla del spec: un titulo escrito a mano es mejor que cualquier `og:title`.

- [ ] **Step 4: El endpoint**

`apps/api/src/routes/bookmarks.ts`, con la misma forma que el resto del archivo (`bookmarksRouter.use(requireAuth)`, `caller(req)`, `sendData`):

```ts
bookmarksRouter.post('/:id/extract', async (req, res) => {
  const { id } = bookmarkParams.parse(req.params);
  await extractBookmark(caller(req), id);
  sendData(res, 204, null);
});
```

`204` porque no devuelve nada: el resultado **viaja por el sync**, no por la respuesta. El cliente dispara esto best-effort y el texto llega en el proximo pull, que es la arquitectura de la spec.

- [ ] **Step 5: El trigger desde el cliente, best-effort y sin bloquear**

No es una tarea de esta fase (el share sheet es la 3 de la spec), pero el endpoint **no tiene consumidor** si nadie lo llama, asi que hay que dejar el camino. Lo mas chico que funciona y que se puede probar:

- El cliente, despues de `createBookmarkAction`, dispara el extract **en segundo plano, sin await**, y descarta el resultado. Si no hay red, no pasa nada: el bookmark queda `pending` y la proxima vez que haya red vuelve a intentar.
- La reintento cuando el estado sigue en `pending` y hay red, con un tope, para que no sea un bucle.

**Si esto se pasa de alcance, reducilo al endpoint y dejalo escrito.** Un endpoint sin consumidor es incompleto, pero un cliente que reintenta en bucle es peor.

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run api:test -- bookmarks-extract && npm run api:test && npm run typecheck`
Expected: PASS en los tres.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/bookmarks/ apps/api/src/routes/bookmarks.ts apps/api/test/
git commit -m "feat(api): POST /bookmarks/:id/extract, con metadata aunque el texto no entre"
```

---

## Fuera de esta fase

- **UI, share sheet, lector, inbox "sin clasificar"**: fases 3 y 4 de la spec.
- **Reintento con backoff y cola de trabajos**: si `extractionState` acaba siendo una tabla de trabajos, el esquema ya lo soporta. Nada de eso hace falta hoy.
- **Deteccion de duplicados y busqueda semantica**: fuera de toda la spec.
- **`linkedom` en vez de `jsdom`**: medido y viable (3,7 MB, 2-16x mas rapido, mismas palabras). No entra porque no es un DOM completo y la sanitizacion necesita uno. **Queda como decision abierta**, y es la unica que puede hacer este plan mas barato.

## Decisiones reversibles

**La eleccion entre `jsdom` y `linkedom`** (Task 1). El spike los midio y los dos funcionan; `linkedom` pesa 13x menos. Si el tamano del deploy molesta, cambiar es cambiar el import de la Task 3 y volver a correr sus tests. Lo que **no** es reversible barato es sanitizar con un DOM incompleto, asi que mientras no se sepa que `linkedom` cubre lo que necesita el validador, `jsdom` se queda.