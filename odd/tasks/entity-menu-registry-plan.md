# Registro de acciones de menu — Plan de implementacion

> **Para ejecutores:** sub-skill REQUERIDO: `superpowers:subagent-driven-development`.
> Los pasos usan casillas (`- [ ]`) para seguir el avance.

**Objetivo:** que un bookmark y una coleccion se puedan manejar como ya se maneja una lista, con las mismas opciones de menu, y que esa paridad viva en un registro en vez de en ocho hojas.

**Arquitectura:** un registro PURO de descriptores de accion (`lib/menus/registry.tsx`) decide que opciones existen, cuales se muestran y en que orden, leyendo `role`, `shared` y las capacidades que le pasa el call site. Un solo `EntityMenuSheet` resuelve la hoja actual desde el registro, y las paginas (renombrar, icono, acceso, borrar, exportar, crear) son componentes compartidos. El registro no guarda funciones de borrado ni de compartir: eso lo pasa el call site.

**Stack:** Expo Router, React Native, TypeScript, Reanimated, vitest. Sin testing-library.

**Spec:** `odd/tasks/entity-menu-registry.md` — es la autoridad. Este plan es el argumento; donde discrepen, gana la spec.

## Restricciones globales

Valen para toda tarea, implicitas en cada paso:

1. **Comentarios, prosa y texto de UI en espanol SIN tildes.** Convencion firme del repo.
2. **Nunca agregar `Co-Authored-By` ni atribucion de IA.** Commits Conventional Commits en espanol.
3. **Este repo NO tiene renderer.** Ni `@testing-library/react-native`, ni `jsdom`. Nada renderiza. Tres patrones y solo tres:
   - **puro**: importar funciones de verdad y afirmar sobre el resultado;
   - **diccionario**: importar `dictionaries` y afirmar frases en `es` y `en`;
   - **texto fuente**: `readFileSync` del `.tsx` y `toMatch`.
4. **i18n:** agregar la clave a `es` Y a `en`. `es` es `as const` y `en` es `Record<TranslationKey, string>`, asi que olvidar `en` es error de compilacion.
5. **Los motivos van a `SheetOption.description`**, no a un campo nuevo: `SheetOption` no tiene campo de motivo y **no se toca `sheet.tsx`** en este trabajo.
6. **Contrato primero:** lo que cruza la red se define en `packages/contracts` (schema Zod + tipo inferido) y lo importan la app y la API.
7. **Escritura local-first:** se escribe local, se encola, se sincroniza. Un fallo de red no es fallo de la accion.
8. **Disparo por work unit:** un commit por tarea, en la rama de la feature.

## Review Focus

Cinco clases de fallo que la spec implica y que ningun test de esta lista ejercita:

1. **Una accion destructiva ofrecida a quien no es dueno.** `Compartido` pero no tuyo: borrar tiene que salir disabled con el motivo en `description`. Lo mas grave, porque `role` esta duplicado como union literal en varios archivos y un `role: string` la cuela.
2. **Una accion que lanza y cierra el menu en silencio.** Fallar al renombrar o al borrar tiene que dejar la hoja abierta con el error y reintento.
3. **Un kind nuevo con el menu vacio.** Si `ORDEN_POR_KIND` gana una entrada sin que `ACCIONES` la tenga, el menu se dibuja vacio y nadie se entera.
4. **Accion duplicada que desaparece en la migracion.** Al migrar `ListMenuSheet` (la mas completa) al registro, si el registro no declara una opcion que la hoja tenia, se pierde en silencio. Comparar el menu viejo contra el nuevo fila por fila.
5. **Copy de la accion que no existe en el idioma.** `labelKey` es funcion: si devuelve una clave que no esta en el diccionario, la fila sale con el `key` crudo.

---

### Task 1: El registro

**Archivos:**
- Crear: `apps/mobile/src/lib/menus/registry.tsx`
- Crear: `apps/mobile/test/menu-registry.test.ts`

**Interfaces — produce:**
```ts
export type MenuKind = 'list' | 'note' | 'folder' | 'collection' | 'bookmark';
export type MenuPageId =
  | 'rename' | 'icon' | 'access' | 'delete' | 'export' | 'create' | 'share';
export type MenuCap = 'editStates' | 'saveAsTemplate' | 'createInside' | 'panel' | 'export';
/** Solo para acciones de tipo `hoja`. Compartir NO va aqui: es una pagina. */
export type MenuHandlerName =
  | 'borrar' | 'duplicar' | 'alternarPin'
  | 'editarEstados' | 'guardarComoPlantilla';

export interface MenuEntity {
  id: string;
  /** Normalizado: `Collection.name` y `Folder.name` llegan como `title`. */
  title: string;
  role: MembershipRole;
  shared: boolean;
}

export interface MenuContext {
  kind: MenuKind;
  entity: MenuEntity;
  caps: Partial<Record<MenuCap, boolean>>;
}

export interface MenuAccion {
  id: string;
  /** Funcion cuando el copy depende del tipo: el cuerpo de borrar ya difiere
   *  (`lists.deleteBody`, `note.deleteBody`, `bookmarks.deleteBody`,
   *  `collections.delete.body`). */
  labelKey: TranslationKey | ((ctx: MenuContext) => TranslationKey);
  icon: keyof typeof Ionicons.glyphMap;
  tone?: 'default' | 'danger' | 'accent';
  disponible?: (ctx: MenuContext) => boolean;
  /** El texto de por que no se puede. A `SheetOption.description`. */
  motivo?: (ctx: MenuContext) => string | null;
  destino:
    | { tipo: 'hoja'; handler: MenuHandlerName }
    | { tipo: 'pagina'; page: MenuPageId };
}

export const ACCIONES: Record<string, MenuAccion>;
export const ORDEN_POR_KIND: Record<MenuKind, string[]>;
export function accionesPara(ctx: MenuContext): MenuAccion[];
```

**Acciones que declara el registro**, y el id exacto de cada una (describir la lista, no el codigo):
`states`, `createHere`, `rename`, `icon`, `pin`, `unpin`, `duplicate`, `share`, `saveAsTemplate`, `access`, `export`, `delete`.

- [ ] **Paso 1: escribir los tests que fallan**

`test/menu-registry.test.ts`, seis tests:
- `accionesPara` devuelve el conjunto esperado para cada kind, con `caps` dados. Assert por kind explicito, no "los cinco devuelven lo mismo".
- **Review Focus #1**: con `shared: true` y `role: 'editor'`, la accion de borrar esta `disponible === false` y su `motivo` devuelve una cadena no vacia. Con `shared: false` si esta disponible. Con `role: 'viewer'` la de compartir tambien se apaga. Con `role: 'owner'` las dos estan.
- El orden de la salida es exactamente `ORDEN_POR_KIND[kind]`.
- Cada id de los cinco `ORDEN_POR_KIND` existe en `ACCIONES`. Falla si uno no.
- Ningun kind declara una lista vacia. Falla si alguno.
- **Review Focus #5**: para todo kind y toda accion, `labelKey` resuelto da una clave que existe en `dictionaries.es` Y en `dictionaries.en`. Resolver: si es funcion, llamar con un `MenuContext` de ese kind.

- [ ] **Paso 2: correr y ver que fallan**

```
cd apps/mobile && npx vitest run test/menu-registry.test.ts
```
Esperado: FAIL por modulo inexistente.

- [ ] **Paso 3: implementar `registry.tsx`**

Tipos exactos de arriba. `ACCIONES` con las doce acciones. `ORDEN_POR_KIND` con los cinco kinds.

Disponibilidad, con la regla unica que ya esta escrita a mano en tres hojas: compartir solo con `role === 'owner'`; borrar `disabled` con `shared`; `states` solo con `caps.editStates`; `saveAsTemplate` solo con `caps.saveAsTemplate`; `createHere` solo con `caps.createInside`; `export` solo con `caps.export`.

`esDuplicada` compara dos acciones por `labelKey` resuelto e `icon`, para que el test de paridad pueda decir "el menu nuevo tiene las mismas filas que el viejo".

El comentario de cabecera tiene que explicar **por que el registro no guarda funciones**: si guardara, cada call site tendria que inyectar quince handlers y volvemos al sopa de props que hay hoy. Y por que `labelKey` es funcion.

- [ ] **Paso 4: correr y ver que pasan**

```
cd apps/mobile && npx vitest run test/menu-registry.test.ts
npm run typecheck
```
Esperado: PASS los cinco tests, typecheck limpio en los cuatro workspaces.

- [ ] **Paso 5: commit**

```bash
git add apps/mobile/src/lib/menus/registry.tsx apps/mobile/test/menu-registry.test.ts
git commit -m "feat(menus): el registro de acciones, puro y testeable"
```

---

### Task 2: El sheet y las dos paginas que todo menu tiene

**Archivos:**
- Crear: `apps/mobile/src/components/menus/entity-menu-sheet.tsx`
- Crear: `apps/mobile/src/components/menus/pages/rename-page.tsx`
- Crear: `apps/mobile/src/components/menus/pages/delete-page.tsx`
- Modificar: `apps/mobile/src/components/collections/collection-menu-sheet.tsx` (migrar y **borrar** el archivo)
- Modificar: call sites — `apps/mobile/src/app/(app)/workspace/[workspaceId].tsx:302`, `apps/mobile/src/app/(app)/folder/[folderId].tsx:336`
- Test: `apps/mobile/test/entity-menu-sheet.test.ts` (texto fuente)

**Interfaces — consume:** todo de T1.
**Interfaces — produce:**
```tsx
export interface MenuHandlers {
  rename?: (title: string) => void | Promise<void>;
  icon?: (icon: IconRef | null) => void | Promise<void>;
  borrar?: () => void | Promise<void>;
  duplicar?: () => void | Promise<void>;
  alternarPin?: () => void | Promise<void>;
  editarEstados?: () => void | Promise<void>;
  guardarComoPlantilla?: () => void | Promise<void>;
}

export interface EntityMenuSheetProps {
  ctx: MenuContext | null;
  handlers: MenuHandlers;
  onClose: () => void;
}
```

**Firmas de las paginas (ratificadas en T2, corregidas aqui):**

```ts
// El borrador vive en la HOJA, no en la pagina: `Sheet` lee `sucio` y no puede
// leer el estado de una pagina que todavia no existe. Por eso `RenamePage` no
// recibe `ctx` ni `onClose`.
export interface RenamePageProps {
  nombre: string;              // `borrador ?? titulo`, resuelto por la hoja
  onChange: (nombre: string) => void;
  onRename: (nombre: string) => void | Promise<void>;
  trabajando: boolean;
}

export interface DeletePageProps {
  ctx: MenuContext;            // lo si necesita: SharedBadge y el cuerpo por kind
  onBorrar: () => void;
  trabajando: boolean;
  conteo?: number;             // solo lista; lo resuelve T6
}
```

El borrador del plan decia `{ ctx, onClose }` para las dos. `onClose` en este arbol
significa "cerrar la hoja entera", y una pagina que lo recibe cierra el menu entero
desde adentro. La version implementada esta mejor: el estado que la pagina necesita
se lo pasa la hoja.

- [ ] **Paso 1: test de texto fuente que falla**

`test/entity-menu-sheet.test.ts`: leer `entity-menu-sheet.tsx` y afirmar que pasa `step` y `onBack` al `Sheet`, y que no monta `Sheet` hermanos (el `folder-menu-sheet` monta seis). Esto es el patron texto fuente, y es lo que **si** se puede afirmar sin renderer.

- [ ] **Paso 2: correr y ver que falla**

```
cd apps/mobile && npx vitest run test/entity-menu-sheet.test.ts
```

- [ ] **Paso 3: implementar `EntityMenuSheet` + las dos paginas**

Un `Sheet` con `step` + `onBack`, `scrollable={false}` como hace `list-menu-sheet.tsx:493`, y la pila de paginas en estado local. Cada accion de `destino.tipo === 'pagina'` empuja su `page`; `onBack` vuelve a `options`. Las de `tipo === 'hoja'` llaman `handlers[destino.handler]` y cierran.

**Regla de error, y es la Review Focus #2**: un handler que lanza o rechaza **no cierra el menu**. Se muestra el error en la hoja con `common.retry`. `handlers.borrar` ausente con la accion disponible es un fallo de desarrollo, no un caso de usuario.

`DeletePage` monta `SharedBadge` con `shared` y `role` del `ctx`, y el motivo del disabled en `description` de la fila.

- [ ] **Paso 4: migrar `CollectionMenuSheet` y borrarlo**

Su props actual son `{ collection, onClose }` y solo tiene `rename` y `delete`
(`collection-menu-sheet.tsx:60-78`). Migrarla es la prueba de que el patron
anda: si reproduce la hoja mas chica, el registro alcanza. Actualizar los dos
call sites. **Borrar el archivo viejo** — si queda, hay dos menus de coleccion.

- [ ] **Paso 5: correr todo**

```
cd apps/mobile && npx vitest run
npm run typecheck
```

- [ ] **Paso 6: commit**

```bash
git add apps/mobile/src/components/menus apps/mobile/src/app apps/mobile/test
git commit -m "feat(menus): un solo EntityMenuSheet, con la coleccion migrada"
```

---

### Task 3: La pagina de icono, y sacar `BotonMenu` de su archivo

**Archivos:**
- Crear: `apps/mobile/src/components/menus/pages/icon-page.tsx`
- Crear: `apps/mobile/src/components/ui/menu-button.tsx` (movido desde `content-list.tsx:427`)
- Modificar: `apps/mobile/src/components/content/content-list.tsx` (importar, borrar la local)
- Test: `apps/mobile/test/icon-page.test.ts` (texto fuente)

**Interfaces — produce:**
```tsx
export function MenuButton({ label, onPress }: { label: string; onPress: () => void }): JSX.Element;
```

- [ ] **Paso 1: test que falla** — `icon-page.tsx` no existe.
- [ ] **Paso 2: correr y ver que falla**
- [ ] **Paso 3: `IconPage`** que monta `IconPickerPanel` (no `IconPickerSheet`: la pagina ya ES un panel, y `IconPickerPanel` es `Pick<IconPickerSheetProps, 'current' | 'onSelect'>` en `icon-picker-sheet.tsx:88`). Anotar en comentario por que la pagina del menu usa la puerta sin `Sheet`.
- [ ] **Paso 4: extraer `MenuButton`** tal cual desde `content-list.tsx:427`, con su `accessibilityRole`, `accessibilityLabel={t('rowActions.menuOf', { name: label })}` y `hitSlop={8}`. Dejar `content-list.tsx` importandolo.
- [ ] **Paso 5: correr y commit**

```bash
git add apps/mobile/src/components
git commit -m "feat(menus): la pagina de icono y el boton de menu compartido"
```

---

### Task 4: El menu de fila de bookmark

**Archivos:**
- Modificar: `apps/mobile/src/app/(app)/bookmarks.tsx`
- Modificar: `apps/mobile/src/app/(app)/unclassified.tsx`
- Modificar: `apps/mobile/src/components/bookmarks/delete-sheet.tsx` (absorber o borrar)
- Test: `apps/mobile/test/bookmark-menu.test.ts` (texto fuente)

**Interfaces — consume:** `EntityMenuSheet`, `MenuHandlers` de T2, `MenuButton` de T3.

- [ ] **Paso 1: test de texto fuente que falla** — afirmar que `bookmarks.tsx` importa `EntityMenuSheet` y `MenuButton`, y que **ya no** importa `BookmarkDeleteSheet`.
- [ ] **Paso 2: correr y ver que falla**
- [ ] **Paso 3: implementar.** Cada fila pasa de la `Pressable` con `trash-outline` (linea ~144) a un `MenuButton` que abre el menu. Borrar queda como la accion destructiva del menu, con `deleteBookmarkAction` de `lib/bookmarks/actions.ts` como handler. `title` del `ctx.entity` es `bookmark.title`.
- [ ] **Paso 4: `unclassified.tsx` igual**, con el mismo patron.
- [ ] **Paso 5: correr, commit.** `BookmarkDeleteSheet` se borra si nadie mas lo usa.

```bash
git commit -m "feat(bookmarks): menu de fila con las mismas opciones que una lista"
```

---

### Task 5: La pantalla de coleccion

**Archivos:**
- Crear: `apps/mobile/src/app/(app)/collection/[collectionId].tsx`
- Test: `apps/mobile/test/collection-screen.test.ts` (texto fuente)

**Interfaces — consume:** `EntityMenuSheet` de T2.

- [ ] **Paso 1: test que falla** — la ruta no existe.
- [ ] **Paso 2: correr y ver que falla**
- [ ] **Paso 3: implementar** con el mismo esqueleto que una lista: `Screen`, `useScreenTitle`, y el header con tres puntitos que abre `EntityMenuSheet kind="collection"`. Listar los bookmarks de la coleccion con el menu de fila de T4. `entity.title` es `collection.name` — **esa es la normalizacion**.
- [ ] **Paso 4: correr, y verificar en web** en claro y oscuro segun `AGENTS.md`.
- [ ] **Paso 5: commit**

```bash
git commit -m "feat(collections): pantalla propia con header y menu completo"
```

---

> **CORRECCION (T5 la puso en T6 y era T7, o nadie)**: el bug de `useSheetSucio`
> no es de una hoja, es de **nueve**. `SheetSucioContexto.Provider` vive en
> `sheet.tsx:630`, adentro del `<Modal>`, asi que el componente que pinta el
> `<Sheet>` esta **fuera** del Provider y su `setSucio` es `() => {}`.
>
> Las nueve con la forma rota: `rename-sheet.tsx:43`, `note-menu-sheet.tsx:97`
> (ademas con la variante que desarma al salir de la pagina), `template-menu-sheet.tsx:102`,
> `save-template-sheet.tsx:95`, `where-note-sheet.tsx:33`, `item-edit-sheet.tsx:495`,
> `create-sheet.tsx:195`, `workspace-create-sheet.tsx:62` y `share-save-sheet.tsx:94`.
>
> Y **cinco de ellas estan fijadas por guards de fuente que afirman la forma rota
> existe**: `task-row-layout.test.ts:1236,1315,1426,1855,1908`. T6 no tiene que
> arreglar solo lo suyo: tiene que **dar vuelta la senal de esos cinco guards**.
> Deuda previa, no regresion de este plan.
>
> **Y aqui me equivoque DOS veces, y lo comprobé con las definiciones:**
>
> 1. Lo puse como prerrequisito de T6. No lo es: `ListMenuSheet` **no usa
>    `useSheetSucio`** — por eso su renombrar usa un `Button` propio.
> 2. Dije que T7 tiene que dar vuelta "la señal de su guard". **Falso.** Los cinco
>    guards apuntan a `rename-sheet.tsx`, `item-edit-sheet.tsx` (dos),
>    `workspace-create-sheet.tsx` y `save-template-sheet.tsx`, y **ninguno a
>    `note-menu-sheet.tsx`**. Verificado sobre las definiciones de las variables, no
>    sobre el numero de linea.
>
> O sea: **T7 arregla el de nota libre**, sin tocar ninguna senal. Los otros ocho de
> las nueve hojas estan fuera de este plan, y cuatro de ellas tienen un guard que
> **afirma la forma rota**: ahi hay que dar vuelta la señal, y es un corte propio.

### Task 11: `SharePage` — la regresion que T6 abrio

**Archivos:**
- Crear: `apps/mobile/src/components/menus/pages/share-page.tsx`
- Test: `apps/mobile/test/share-page.test.ts`

**Interfaces — produce:** `SharePage({ ctx, onClose }: SharePageProps)`.

**Va en el PR 3, con T6 y T7. No es opcional.**

`MenuPageId` declara `"share"` y `ACCIONES.share` declara `destino: { tipo: "pagina",
page: "share" }`, pero **ninguna de las diez tareas escribia el componente que la
monte**. `PAGINAS_MONTADAS` es `["rename", "icon", "delete"]`, asi que el filtro saca
la fila y **compartir una lista deja de existir**. No es una omision: la hoja vieja lo
tenia funcionando, con `ShareNodeForm` montado en `page === "share"`. T6 lo perdio, y
T7 va a perder el de nota y el de carpeta.

`ShareNodeForm` (`components/shares/share-node-sheet.tsx:59`) **ya existe y anda**. Lo
que falta es la pagina que lo monte dentro del `Sheet` de la hoja, y el `onSave` con su
`saveDisabledReason`, leyendo `ShareFormPublicado` como hacen las hojas viejas.

Tambien hay que **recuperar el copy**: la lista decia `share.title` ("Compartir
{name}") y el registro usa `share.pickSomeone`. La lista era la unica que se
diferenciaba; nota y carpeta decian `share.pickSomeone` y no cambia nada para ellas.

Ojo con `onClose`: la hoja vieja, al compartir, **no cerraba el menu**.

> **CERRADA (T11).**
>
> **Dos premisas de arriba estaban mal**, verificadas sobre `caf0027^`:
>
> - **`onClose`**: la hoja vieja **si** cerraba, con `onDone={() => onClose()}`
>   (`list-menu-sheet.tsx:611`). El codigo es el que corria.
> - **"la hoja vieja lo tenia funcionando"**: montaba el formulario, pero **no**
>   pasaba `onSave` al `Sheet` ni montaba `ShareFormContexto.Provider`, y
>   `ShareNodeForm` no tiene ningun boton desde antes de T6. O sea que **en la hoja de
>   lista no habia forma de enviar** —solo el `onSubmitEditing` del teclado—. El
>   "Guardar" del pie es una cosa que T11 escribio, no que se copio de alla.
>
> Y el `onSave` por pagina: **el `Sheet` de `EntityMenuSheet` no tenia ninguno** antes
> de T11, asi que la colision a evitar no es con `RenamePage` —que no usa el pie a
> proposito, `rename-page.tsx:54-63`— sino con la pagina que llegue en T8 o T9. Se
> resuelve con un corte `pagina === "share"` en la hoja, no con un `??` encadenado.

---

### Task 6: Migrar `ListMenuSheet`

**Archivos:**
- Modificar y borrar: `apps/mobile/src/components/lists/list-menu-sheet.tsx`
- Modificar: call sites `app/(app)/list/[listId].tsx:1000`, `app/(app)/board/[listId].tsx:2159`, `app/(app)/workspace/[workspaceId].tsx:323`, `app/(app)/media/media-list-screen.tsx:373`
- Test: `apps/mobile/test/list-menu-parity.test.ts`

- [ ] **Paso 1: test de paridad que falla.** Es la Review Focus #4: un test que extraiga los ids de accion del `list-menu-sheet.tsx` viejo (con `readFileSync` + regex sobre las claves de i18n que usa) y afirme que el registro declara **todas**. Con el archivo viejo en el repo, el test falla; recien cuando se borra pasa. La lista exacta a preservar: `board.editStates`, `common.rename`, `lists.pinToDashboard`/`lists.unpinFromDashboard`, `lists.duplicate`, `share.title`, `export.list.title`, y el delete.
- [ ] **Paso 2: correr y ver que falla**
- [ ] **Paso 3: migrar.** `ListMenuSheetProps` era `{ list, folder, onClose, onDeleted?, onEditStates? }` (`list-menu-sheet.tsx:31`). El registro no unifica el borrar: el call site pasa `deleteList` de `useLists` (`use-lists.ts:315`) como `handlers.borrar`, y `duplicateList` (`use-lists.ts:436-438`) como `handlers.duplicar`. El `folder` se sigue usando para el `subtitle`.
- [ ] **Paso 4: correr, y comparar fila por fila** con el menu viejo antes de borrar el archivo. Es el paso que no se saltea.
- [ ] **Paso 5: commit**

```bash
git commit -m "refactor(menus): ListMenuSheet pasa al registro, sin perder una fila"
```

---

### Task 7: Migrar nota y carpeta

**Archivos:**
- Modificar y borrar: `apps/mobile/src/components/notes/note-menu-sheet.tsx`
- Modificar y borrar: `apps/mobile/src/components/folders/folder-menu-sheet.tsx`
- Test: `apps/mobile/test/note-folder-menu-parity.test.ts`

- [ ] **Paso 1: test de paridad que falle**, con las claves de cada hoja vieja: nota tiene `note.rename`, `icons.title`, `share.pickSomeone`, `note.templates.saveCurrent`, `note.delete`; carpeta tiene `lists.createHere`, pin/unpin, `common.rename`, `icons.title`, `share.pickSomeone`, delete.
- [ ] **Paso 2: correr y ver que falla**
- [ ] **Paso 3: nota.** `NoteMenuSheetProps` era `{ note, onClose, onSaveAsTemplate?, onDeleted?, onChanged? }` (`note-menu-sheet.tsx:35`). Pasa a `handlers.guardarComoPlantilla` y `handlers.borrar` con `deleteNoteAction` de `lib/notes/actions.ts:103`. Ojo: hoy se importa **dinamicamente** (`note-menu-sheet.tsx:170`); el registro no cambia eso.
- [ ] **Paso 4: carpeta.** `FolderMenuSheetProps.folder` es un **tipo estructural inline** (`folder-menu-sheet.tsx:18`), no el `Folder` del contrato: normalizar a `MenuEntity`. Esta hoja **deja de montar seis paneles hermanos** y pasa a `step` + `onBack`, que es el punto de la migracion. `createHere` usa la pagina `create`.
- [ ] **Paso 5: correr, commit**

```bash
git commit -m "refactor(menus): nota y carpeta al registro, y carpeta pierde seis paneles hermanos"
```

---

### Task 8: `AccessPage`

**Archivos:**
- Crear: `apps/mobile/src/components/menus/pages/access-page.tsx`
- Modificar: `apps/mobile/src/hooks/use-shares.ts` (solo si hace falta)
- Test: `apps/mobile/test/access-page.test.ts` (texto fuente + diccionario)

**Interfaces — produce:** `AccessPage` con `{ ctx, onClose }`.

- [ ] **Paso 1: test que falla**
- [ ] **Paso 2: correr y ver que falla**
- [ ] **Paso 3: implementar.** `SharedBadge` con `shared` y `role` del `ctx`, y encima `useShareReach` con `nodeType` y `nodeId`. **Regla dura**: `useShareReach` devuelve `null` cuando el request falla, y `null` **nunca** puede pintarse como "nadie mas lo tiene" — hay que distinguir fallo de vacio, y en fallo mostrar `common.retry`, no un "no hay nadie".
- [ ] **Paso 4: subir `useShareReach` fuera de la pagina de borrar** de `list-menu-sheet.tsx:631-661`, donde hoy solo se ve justo antes de borrar.
- [ ] **Paso 5: test de diccionario** para las frases nuevas en `es` y `en`, como `shared-badge-copy.test.ts`.
- [ ] **Paso 6: commit**

```bash
git commit -m "feat(menus): la pagina de acceso, con quien mas lo tenes"
```

---

### Task 9: Exportar coleccion

**Archivos:**
- Modificar: `packages/contracts/src/export.ts` (el sobre)
- Modificar: `apps/api/src/modules/**/export-service` (`collectionJson`, `collectionCsv`)
- Modificar: `apps/api/src/routes/collections.ts` (`GET /:id/export`)
- Crear: `apps/mobile/src/components/menus/pages/export-page.tsx`
- Test: `apps/api/test/**` y `apps/mobile/test/export-collection.test.ts`

- [ ] **Paso 1: test de API que falla.** `GET /collections/:id/export` no existe.
- [ ] **Paso 2: correr y ver que falla**
- [ ] **Paso 3: el sobre** en `packages/contracts/src/export.ts`. `Collection` no esta en ningun sobre hoy. **Consistencia con `GET /lists/:id/export`**: ese devuelve **bytes crudos** por `sendFile`, no el envelope `{ data, meta }` (`lists.ts:71-81`, `respond.ts:25-39`). El endpoint de colecciones devuelve bytes tambien.
- [ ] **Paso 4: el servicio y la ruta.** Query: `format` con default `'json'`, igual que `listExportQuerySchema` (`export.ts:37-40`).
- [ ] **Paso 5: `ExportPage`** con los dos formatos, y `ExportResultSheet` como hoja hermana como hace `list-menu-sheet.tsx:698`.
- [ ] **Paso 6: correr API y mobile, commit**

```bash
git commit -m "feat(export): exportar una coleccion, con su sobre en el contrato"
```

---

### Task 10: Compartir coleccion y bookmark

**Archivos:**
- Modificar: `packages/contracts/src/workspace.ts:943` (el enum)
- Modificar: `apps/api/src/modules/shares/share-service.ts:67`, `:220`, `:235`
- Test: `apps/api/test/shares*.test.ts`

- [ ] **Paso 1: test de API que falla**: compartir una coleccion responde 400 porque `collection` no es un `nodeType`.
- [ ] **Paso 2: correr y ver que falla**
- [ ] **Paso 3: el enum** gana `'collection'` y `'bookmark'`. **`varchar(16)` entra holgado**: `collection` son 10, `bookmark` 8. **Sin migracion de base**: la tabla `shares` es generica (`node_type` + `node_id`, `content-schema.ts:736`).
- [ ] **Paso 4: `resolveTarget`** gana dos ramas, con el mismo contrato de las existentes (`{ nodeType, nodeId, title, workspaceId }`).
- [ ] **Paso 5: los permisos** de `:220` y `:235` ganan los casos nuevos. Ojo: `shareRoleSchema` es `['editor','viewer']`, **sin `owner`** (`workspace.ts:959-960`), porque el dueno del espacio no se reparte.
- [ ] **Paso 6: correr API completa, commit**

```bash
git commit -m "feat(shares): compartir colecciones y bookmarks"
```