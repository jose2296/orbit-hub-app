# Bookmarks fase 5: el Web Share Target Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** La PWA instalada aparece en el share sheet de Android cuando la app nativa no esta instalada; compartir una URL abre la pagina que pregunta donde guardarla, con el mismo gesto que el nativo.

**Architecture:** Un miembro `share_target` en el manifest declara la ruta; un service worker escrito a mano intercepta el POST, lee `title`/`text`/`url` del `FormData` y responde 303 hacia `/share-target` con esos valores como query params (truncados a un techo); la pagina `app/share-target.tsx` los guarda en `localStorage`, limpia la URL, y sigue el flujo probado anonimo->sign-in-con-`next`->hoja (el mismo de `share/save.tsx`); la hoja es `ShareSaveSheet` reusado, y el guardado usa `createBookmarkAction` + `triggerExtract` como en nativo. Sin Workbox, sin dependencias, sin proxy `/api` (la web ya habla con el backend por `EXPO_PUBLIC_API_URL` absoluta + CORS).

**Tech Stack:** PWA manifest, service worker vanilla (`fetch` event, `FormData`, `Response.redirect`), Expo Router static export, `localStorage` (`orbithub:*`), nginx static.

**Spec:** `docs/superpowers/specs/2026-10-05-bookmarks-share-target-design.md` — seccion web ("cuando la app no esta instalada"). El plan razona desde ahi; los conflictos se resuelven contra el spec.

**Mapping (medido, no re-medir):** handoff de exploracion en sesion (manifest 28 lineas sin `share_target`, link en `+html.tsx:123`; SW inexistente con bootstrap en `+html.tsx:16-26` solo-prod y nginx devolviendo 404 por diseno en `:33-40` con `no-store` ya correcto; `try_files` plano en `nginx.conf:42-52` que resuelve `/share-target` sin cambios; `Dockerfile.web:88-93` copia todo `dist/`; `?next=` probado en `sign-in.tsx:24-25` y `share/save.tsx:85-88`; `localStorage` como patron (`secure-storage.ts:58-60`, `local-store.ts:512-533`); sin `.web.ts` forks; `ShareSaveSheet` probablemente reusable (`isWide()`, Reanimated ya en web); sin `share_target` en ningun lado salvo el spec `:467-486`).

## Global Constraints

- **Comentarios y prosa en espanol SIN tildes.** Strings nuevos dos veces en `dictionaries.ts`; reusar los de `share.save.*` y `place.*` donde ya existan.
- **Design tokens only**: `useTheme()`. La pagina nueva no inventa estilos.
- **La pagina vive fuera de `(app)`**, como `share/save.tsx`: el guard manda a anonymous al welcome y el payload se pierde.
- **El payload sobrevive en `localStorage` (`orbithub:pending-share-web`), no en la URL ni en memoria.** La URL se limpia al leer (un reload o un `?next=` intermedio no debe duplicar ni perder).
- **Sin dependencias nuevas** (ni Workbox: el SW son ~50 lineas a mano). `noUnusedLocals` activo.
- Commits Conventional Commits, espanol, sin tildes. **NUNCA `Co-Authored-By` ni atribucion de IA.**
- **No tocar** `apps/api`, `packages/contracts`, el share nativo (`+native-intent.ts`, `share/save.tsx` salvo el `TODO` si lo nombra), ni `og:url` de `+html.tsx:118`.
- **Alcance honesto de plataforma**: Web Share Target funciona en Android con la PWA **instalada**; en iOS Safari no existe la via. No es un bug pendiente, es la plataforma. Queda escrito en la pagina si hace falta (un texto de ayuda, no un error).

## Review Focus

1. **Un POST que no es del share** (cualquier otro POST a `/share-target`, o `GET` directo). Lo esperable: la pagina muestra "nada que guardar" en vez de crash. El SW solo intercepta `POST` a esa ruta exacta; todo lo demas pasa. *Tareas 2 y 3.*
2. **Un texto compartido de 100 KB.** Los query params de una redireccion interna aguantan mucho mas que una URL de servidor, pero no infinito. Lo esperable: truncado a un techo documentado, nunca un redirect roto ni un `414`. *Tarea 2.*
3. **Recargar `/share-target` a mitad del flujo.** Lo esperable: si ya se guardo en `localStorage`, sigue ahi; si ya se guardo el bookmark, no se duplica. La URL limpia + guard de doble-guardado (fase 3) lo sostienen. *Tarea 3.*
4. **Abrir `/share-target` en dev (sin SW registrado).** El bootstrap de `+html.tsx:16` solo registra en produccion, asi que en dev no hay intercepcion. Lo esperable: la pagina funciona igual pegando una URL a mano (lee query params sin SW), y eso es ademas como se prueba sin instalar nada. *Tarea 3.*
5. **El SW viejo cacheado tras desplegar uno nuevo.** `no-store` en nginx ya lo cubre para el archivo; mas `skipWaiting`+`clientsClaim` con comentario de por que. *Tarea 2.*

## Estructura de archivos

**Crear**
| archivo | responsabilidad |
| --- | --- |
| `apps/mobile/public/service-worker.js` | `fetch` handler solo para `POST /share-target` -> `FormData` -> 303 con query truncada; `skipWaiting`+`clientsClaim` |
| `apps/mobile/src/app/share-target.tsx` | lee query -> guarda en `localStorage` -> limpia URL -> anonimo?sign-in con `next` -> `ShareSaveSheet` -> limpia y navega |
| `apps/mobile/test/web-share-target.test.ts` | manifest valido + logica del SW con globales mockeados + pagina con query |

**Modificar**
| archivo | que cambia |
| --- | --- |
| `apps/mobile/public/manifest.webmanifest` | miembro `share_target` (+ nada mas; los iconos 1024 satisfacen el umbral) |
| `nginx.conf:33-40` | de `return 404` a servir el archivo, manteniendo `no-store` |
| `apps/mobile/src/lib/i18n/dictionaries.ts` | solo strings que no existan ya |

---

### Task 1: El manifest (declarar el destino)

**Files:**
- Modify: `apps/mobile/public/manifest.webmanifest`
- Test: parte de `apps/mobile/test/web-share-target.test.ts` (se crea aqui, se amplia en Tasks 2-3)

**Interfaces:**
- Consumes: nada (JSON estatico).
- Produces: `share_target` valido. Tasks 2-3 lo dan por hecho.

- [ ] **Step 1: El miembro, copiado del spec**

```json
"share_target": {
  "action": "/share-target",
  "method": "POST",
  "enctype": "application/x-www-form-urlencoded",
  "params": { "title": "title", "text": "text", "url": "url" }
}
```

**Nada mas en el manifest.** Los iconos (unico 1024 `any`+`maskable`) satisfacen el umbral de 192/512 por escalado; si "Add to Home screen" no se ofrece, el primer fix son entradas 192/512 explicitas al mismo archivo, no de esta tarea. Sin `id` (defaultea a `start_url`, correcto).

- [ ] **Step 2: Write the failing test — el manifest declara el share**

`apps/mobile/test/web-share-target.test.ts`:

```ts
import manifest from '../public/manifest.webmanifest';

describe('el manifest declara el share target', () => {
  it('tiene action POST a /share-target con title, text y url', () => {
    expect(manifest.share_target.action).toBe('/share-target');
    expect(manifest.share_target.method).toBe('POST');
    expect(manifest.share_target.params).toEqual({ title: 'title', text: 'text', url: 'url' });
  });
  it('sigue siendo instalable: nombre, iconos, display y scope', () => {
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/');
    // ...iconos no vacios, theme_color presente
  });
});
```

Si el import JSON no compila en vitest, leerlo con `readFileSync` + `JSON.parse`: lo que se fija es el contenido, no la forma de importarlo.

- [ ] **Step 3: Run y commit**

Run: el test + typecheck. Expected: PASS.

```bash
git add apps/mobile/public/manifest.webmanifest apps/mobile/test/web-share-target.test.ts
git commit -m "feat(web): el manifest declara el share target"
```

---

### Task 2: El service worker (a mano, ~50 lineas)

**Files:**
- Create: `apps/mobile/public/service-worker.js`
- Modify: `nginx.conf:33-40`
- Test: ampliar `apps/mobile/test/web-share-target.test.ts` (logica del SW con globales mockeados)

**Interfaces:**
- Consumes: nada (vanilla, sin imports: un SW no hace bundling aqui).
- Produces: intercepcion de `POST /share-target` + redireccion con query. Task 3 consume la query.

> **Por que a mano y sin Workbox.** Lo que el SW hace son tres cosas: un `if` sobre metodo+ruta, un `formData()`, y un `Response.redirect`. Workbox es una dependencia para no escribir un `if`. Y el SW **no pasa por el bundler**: es un archivo estatico que nginx sirve tal cual, asi que tiene que ser JS plano sin imports ni TypeScript.

- [ ] **Step 1: Write the failing tests — la decision por URL, sin red**

Los tests mockean `self` (`addEventListener` capturado), `Request`/`Response`/`URL` (los de Node 22 existen) y un `FormData` con `title`/`text`/`url`:

```ts
describe('el service worker del share', () => {
  it('un POST a /share-target con url redirige a la pagina con query', ...);
  it('un texto de 100 KB se trunca al techo y no rompe el redirect', ...);  // Review Focus #2
  it('un GET a /share-target pasa (no lo intercepta)', ...);
  it('un POST a otra ruta pasa', ...);                                       // Review Focus #1, lado SW
  it('sin url en el form, redirige igual con lo que haya', ...);            // el texto puede ser la URL
});
```

**Como se carga un SW en un test**: leer el archivo con `readFileSync` y ejecutarlo con `new Function('self', codigo)` (o `vm`) pasando un `self` mockeado. Sin fetch real, sin red, sin puertos.

- [ ] **Step 2: El SW**

```js
// Sin imports ni TypeScript: nginx lo sirve tal cual, no pasa por Metro.
const TECHO_TEXTO = 4096;

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'POST' || url.pathname !== '/share-target') return; // pasa
  event.respondWith((async () => {
    let title = '', text = '', link = '';
    try {
      const form = await event.request.formData();
      title = String(form.get('title') || '').slice(0, TECHO_TEXTO);
      text = String(form.get('text') || '').slice(0, TECHO_TEXTO);
      link = String(form.get('url') || '');
    } catch { /* form ilegible: redirige igual, la pagina dira "nada que guardar" */ }
    const destino = new URL('/share-target', self.location.origin);
    if (title) destino.searchParams.set('title', title);
    if (text) destino.searchParams.set('text', text);
    if (link) destino.searchParams.set('url', link);
    return Response.redirect(destino.toString(), 303);
  })());
});

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
```

Decisiones escritas en comentarios (porque cada una se va a cuestionar):

- **Por que query y no IndexedDB**: el SW no tiene `localStorage`, e IndexedDB desde un SW a mano son ~20 lineas de promesas para guardar tres strings. La redireccion interna no toca servidor, asi que el limite practico de longitud lo pone el navegador (decenas de KB), no un `414`. Con techo de 4 KB por campo no se acerca.
- **Por que 303 y no 302**: 303 convierte el POST en GET por definicion; 302 lo hace "casi siempre". La pagina resultante es un GET limpio.
- **Por que `skipWaiting`+`clientsClaim`**: sin ellos, un SW viejo intercepta con la logica vieja hasta cerrar todas las pestañas. Con `no-store` en nginx (ya esta) + esto, el despliegue llega.
- **`url` (el campo link) sin techo**: las URLs largas legitimas existen y el contrato acepta 2048; truncar el link romperia el guardado. El techo es para `title`/`text`, que son prosa.

- [ ] **Step 3: nginx sirve el archivo (dos lineas)**

`nginx.conf:33-40` pasa de `return 404` a servirlo, **manteniendo `no-store`** (un SW cacheado es un SW viejo interceptando):

```nginx
location = /service-worker.js {
  add_header Cache-Control "no-store";
  # antes: return 404 ("Not built yet"). Fase 5 lo construye.
}
```

Sin el `return`, el `try_files` de abajo lo sirve de `dist/`. **Verificar que Metro copia `public/service-worker.js` a `dist/`**: correr `npx expo export --platform web` y mirar que `dist/service-worker.js` existe. Si Metro no copia `.js` de `public/`, el fallback es escribirlo desde `scripts/export-web.mjs` en el post-paso (una copia de archivo, no logica nueva). **No asumirlo: comprobarlo.**

- [ ] **Step 4: Run y commit**

Run: tests + typecheck + export web (por el Step 3). Expected: PASS y `dist/service-worker.js` existe.

```bash
git add apps/mobile/public/service-worker.js nginx.conf apps/mobile/test/web-share-target.test.ts
git commit -m "feat(web): el service worker intercepta el POST del share y redirige con query"
```

---

### Task 3: La pagina `/share-target` (leer, guardar, navegar)

**Files:**
- Create: `apps/mobile/src/app/share-target.tsx`
- Modify: `apps/mobile/src/lib/i18n/dictionaries.ts` (solo lo que no exista)
- Test: ampliar `web-share-target.test.ts` (parseo de query + `localStorage`, sin SW)

**Interfaces:**
- Consumes: `ShareSaveSheet` + `SharedPayload` (fase 3), `createBookmarkAction` via la hoja (no directo), `useSession` (estado `loading|authenticated|anonymous`), `localStorage` con clave `orbithub:pending-share-web`.
- Produces: el gesto web completo. Nada mas lo consume.

> **Esta pagina es `share/save.tsx` con otra entrada.** La forma (loading -> anonimo-con-`next` -> hoja), el `Sheet`, el `PlacePicker` y el guardado son los mismos. Lo unico nuevo es **de donde sale el payload**: de la query que dejo el SW (o pegada a mano en dev), guardada en `localStorage` antes de cualquier navegacion.

- [ ] **Step 1: Write the failing tests — query a payload, sin SW**

```ts
describe('la pagina share-target', () => {
  it('?url= sola da payload con titulo null', ...);
  it('?text= con URL adentro la extrae (reusa sacarUrlDelTexto)', ...);  // no reimplementar el parseo
  it('sin params da null y la pagina dice "nada que guardar"', ...);     // Review Focus #1, lado pagina
  it('tras leer, la URL queda limpia (replace sin query)', ...);          // Review Focus #3
});
```

El parseo texto->URL es `sacarUrlDelTexto` de fase 3 (`lib/bookmarks/share-intent.ts`): **importarlo, no copiarlo**. Dos copias de "¿donde esta la URL en este texto?" divergen en silencio.

- [ ] **Step 2: La pagina**

```tsx
// app/share-target.tsx — fuera de (app), como share/save.tsx
const params = useLocalSearchParams<{ title?: string; text?: string; url?: string }>();
// 1. al montar: si hay query, parsear con sacarUrlDelTexto, guardar en localStorage
//    (orbithub:pending-share-web), y router.replace('/share-target') sin query.
// 2. si no hay query: leer localStorage.
// 3. sin payload: vista "nada que guardar".
// 4. status loading/anonymous igual que share/save.tsx (redirect con next: '/share-target').
// 5. con sesion y payload: <ShareSaveSheet payload visible onClose onSaved />.
//    onSaved: borrar la clave + navegar al detalle. onClose sin guardar: no borra.
```

**El orden 1-2 es lo que hace que el reload no duplique ni pierda** (Review Focus #3): la query se consume una sola vez al guardarla; despues manda `localStorage`. Y el paso 4 reusa el patron probado en vez de inventar otro login.

**`ShareSaveSheet` se reusa tal cual en el primer intento.** El mapeo dice que es probablemente compatible (`isWide()`, Reanimated ya en web, sin forks `.web`). **Smoke-test en web antes de decidir un fork**: si la hoja se rompe en web, el fallo se ve en el export local, no en un test. Si se rompe y no hay arreglo chico, el fallback es una version web minima (titulo + destino + guardar) y se declara.

- [ ] **Step 3: Strings solo si faltan**

La pagina reusa `share.save.*` y `place.*` donde existen. Solo lo genuinamente nuevo (p. ej. ayuda "instala la PWA para compartir") va a `dictionaries.ts` en los dos idiomas.

- [ ] **Step 4: Run y commit**

Run: tests + typecheck + export web (la ruta tiene que salir en `dist/`).

```bash
git add apps/mobile/src/app/share-target.tsx apps/mobile/src/lib/i18n/dictionaries.ts apps/mobile/test/web-share-target.test.ts
git commit -m "feat(web): /share-target guarda el payload y abre la misma hoja"
```

---

### Task 4: Verificacion (export, manifest, gesto)

**Files:** ninguno (es verificacion, no codigo). Si algo falla, vuelve a su tarea.

- [ ] **Step 1: El export incluye todo**

Run: `npx expo export --platform web` (o `scripts/export-web.mjs`), y verificar:
- `dist/service-worker.js` existe y es el archivo de Task 2 (no un placeholder).
- `dist/share-target.html` (o la forma que el export use) existe.
- `dist/manifest.webmanifest` tiene `share_target`.

- [ ] **Step 2: El gesto en Android con la PWA instalada (manual, unico que vale)**

Con la PWA instalada desde la URL desplegada:

1. Compartir URL desde otra app -> el navegador -> la pagina con el destino. (camino feliz)
2. Compartir texto con URL adentro -> misma pagina, titulo sugerido.
3. Sin sesion -> login -> la hoja sigue con el enlace (por sign-in **y** sign-up).
4. Recargar a mitad -> no duplica, no pierde.
5. Doble tap en Guardar -> un bookmark.

**Si no hay dispositivo o despliegue, esta tarea queda en `partial` y se dice.** Igual que la fase 3: afirmar un gesto que nadie hizo es la deuda que la fase 1 vino a evitar.

- [ ] **Step 3: Anotar el resultado en el ledger (no es commit)**

El resultado del Step 1 (verde) y del Step 2 (verde o `partial` con el motivo) van al `progress.md` de este plan como ultima linea. Si el Step 2 es `partial`, la fase cierra igual con el `partial` declarado: el codigo esta probado, el gesto espera dispositivo.

---

## Fuera de esta fase

- **Cache offline del app shell** (el SW solo intercepta el share; sin shell cacheado, compartir sin red abre la PWA solo si el navegador la tiene). Follow-up declarado, no de esta fase.
- **Entradas 192/512 explicitas en el manifest** si "Add to Home screen" no se ofrece (mismo archivo, otro trabajo).
- **iOS**: no hay via web (Safari no soporta Web Share Target). Limitacion documentada, no bug.
- **Duplicados, `linkedom`, backoff**: fuera de toda la spec.
- **Verificacion manual del share nativo** (fase 3, `partial`): sigue pendiente de build nativo y no lo cubre esta fase.

## Decisiones reversibles

**Query params en vez de IndexedDB para el handoff SW->pagina** (Task 2). Si un texto compartido supera en la practica lo que un redirect interno aguanta, cambiar es guardar en IndexedDB en el SW y leerlo en la pagina. Lo que **no** es reversible barato es un SW que escribe en `localStorage` (no existe ahi) o que responde el POST con HTML (rompe el contrato del share target).
