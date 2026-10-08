# Registro de acciones de menu: una sola puerta para las entidades

## Objetivo

Que un bookmark y una coleccion se puedan manejar como ya se maneja una lista: los
tres puntitos con las mismas opciones, el panel de acceso, y el icono. Y que esa
paridad no viva copiada en siete hojas.

## Problema

El pedido original era "que tengan las mismas opciones en los 3 puntitos en los
listados y en el header de las colecciones". Al mapearlo, **dos de las tres cosas
que el pedido da por existentes no existen**:

| Lo que se asumia | Realidad |
| --- | --- |
| "los 3 puntitos en los listados" de bookmarks | `bookmarks.tsx` importa un solo sheet, `BookmarkDeleteSheet` (`:8`). Cada fila tiene una papelera y nada mas. |
| "el header de las colecciones" | Una coleccion no tiene pantalla. `bookmarks.tsx:53` solo hace `useScreenTitle(nombre)`. Su unico menu es el de su fila en el listado, con dos acciones. |
| "exportar" en esas superficies | No hay endpoint. Solo `GET /account/export` (`apps/api/src/routes/account.ts:26`) y `GET /lists/:id/export` (`apps/api/src/routes/lists.ts:71`). |

Ademas hay **ocho** hojas de menu, no siete: `list`, `note`, `folder`, `workspace`,
`collection`, `column`, `media-actions` y `template`.

### Lo que ya duplican y no hace falta duplicar dos veces mas

- **Renombrar** esta escrito de cuatro formas distintas: fila propia en nota y
  carpeta, y escondido dentro de la pagina de renombrar en lista y espacio
  (`list-menu-sheet.tsx:552-573`, `workspace-menu-sheet.tsx:268-289`).
- **El panel de acceso** (`SharedBadge`) esta montado en 4 de las 8 hojas; faltan
  coleccion, columna y medios.
- **El icono** tiene tres puertas: fila propia en nota y carpeta, escondido en la
  pagina de renombrar en lista y espacio, y pagina propia en el editor de items.
  `icon-picker-sheet.tsx` ya exporta las dos formas (`IconPickerPanel` `:88`,
  `IconPickerSheet` `:95`) y cada consumidor elige una.
- **`CollectionMenuSheet` tiene dos acciones** (`collection-menu-sheet.tsx:60-78`)
  y **ni siquiera lee** `collection.shared` ni `collection.role`, que el contrato
  si trae (`packages/contracts/src/bookmarks.ts:86`).
- **`FolderMenuSheet` no usa paginas**: monta cinco `Sheet` hermanos
  (`folder-menu-sheet.tsx:203-296`), que es justo el panel-sobre-panel que la
  familia evita. `Sheet` es un `Modal`.

## Por que un registro y no "copiar las opciones"

Porque vamos a agregar **dos superficies de menu nuevas** (la pantalla de
coleccion y el menu de fila de bookmark). Sin un registro compartido, el menu de
bookmark seria la copia 8 y el de coleccion la 9, y la paridad que se pidio
seguiria teniendo que perseguirse tocandolos uno por uno.

## Alcance

**Dentro**: `list`, `note`, `folder`, `collection`, `bookmark`. Mas las dos
superficies nuevas.

**Fuera, a proposito**: `column` (maneja estados del tablero, no una entidad),
`media-actions` (maneja medios) y `template` (que ya justifica en su propio
archivo, `template-menu-sheet.tsx:24-35`, por que no comparte componente con
`note`). Forzarlos al mismo molde seria una mentira de unificacion.

**Adentro, con costo de backend**: compartir y exportar sobre coleccion y
bookmark. Ninguno de los dos es un boton que falta, y el detalle esta en
`Bloqueos`.

## Bloqueos que cambian el alcance

### Compartir no admite coleccion ni bookmark

`shareNodeTypeSchema` (`packages/contracts/src/workspace.ts:943`) es
`['workspace', 'folder', 'list', 'list_item', 'note']`. **No incluye `collection`
ni `bookmark`**, y `ShareNodeSheetProps.target.nodeType` esta atado a ese enum:
hasta que el contrato lo admita, la fila de compartir no se puede pintar.

**No hace falta migracion de base.** La tabla `shares` es generica:
`node_type varchar(16)` + `node_id`, con indice unico sobre los dos
(`apps/api/src/db/content-schema.ts:736`). Lo que hace falta es:

- dos valores mas en el enum del contrato;
- dos ramas en `share-service.ts:67 resolveTarget`, que hoy tiene una por tipo y
  termina en `note` (`:115`);
- los "que pueden hacer con esto" de `share-service.ts:220` y `:235`.

El `varchar(16)` entra holgado: `collection` son 10 caracteres, `bookmark` 8.

### Exportar no existe para colecciones

`apps/api/src/routes/collections.ts` tiene exactamente tres rutas: `GET /`,
`GET /:id`, `DELETE /:id`. No hay `GET /:id/export`, `exportService` no tiene
`collectionJson` ni `collectionCsv`, y **`Collection` no esta en ningun sobre de
export** (`accountExportSchema` y `listExportSchema` en
`packages/contracts/src/export.ts` no lo incluyen). El sobre hay que disenarlo.

Nota sobre la forma: `GET /lists/:id/export` (`lists.ts:71`) **no devuelve el
sobre `{ data, meta }`**, devuelve bytes crudos via `sendFile`. Un endpoint de
colecciones que sea consistente con ese devuelve bytes, no envelope.

## Diseno

### La tension que resuelve

Hoy cada sheet recibe handlers por props: `onEditStates`, `onSaveAsTemplate`,
`onTogglePin`, `onCreateInside`, `onFindTitle`, `onPanel`, `listCount`,
`workspaceId`. Si el registro guarda funciones, cada call site tiene que inyectar
quince handlers y volvemos al sopa de props.

Si el registro guarda **descriptores puros**, el call site sigue pasando los
handlers, pero **la decision de que opciones existen, cuales se muestran y en que
orden deja de estar duplicada**. Eso es exactamente lo que hay que unificar: la
lista, no la mecanica.

### `lib/menus/registry.tsx`

Descriptores sin efectos:

```ts
type MenuKind = 'list' | 'note' | 'folder' | 'collection' | 'bookmark';

/** Lo que un call site concreto puede hacer, y por lo tanto ofrece como opcion. */
type Cap =
  | 'editStates'      // solo listas: editar los estados del tablero
  | 'saveAsTemplate'  // solo notas: guardar como plantilla
  | 'createInside'    // solo carpetas: crear una lista dentro
  | 'panel'           // solo lo que se puede pinear al panel
  | 'export';         // requiere el endpoint de T9

/** Paginas que `EntityMenuSheet` sabe montar. */
type PageId = 'rename' | 'icon' | 'access' | 'delete' | 'export';

interface MenuContext {
  kind: MenuKind;
  entity: { id: string; name: string; role: string; shared: boolean; /* ... */ };
  caps: Partial<Record<Cap, boolean>>;   // lo que este call site si puede hacer
}

interface Accion {
  id: string;
  labelKey: TranslationKey;
  icon: IconName;
  danger?: boolean;
  disponible?: (ctx: MenuContext) => boolean;   // lee role, shared y caps
  motivo?: (ctx: MenuContext) => string | null; // por que sale gris
  destino:
    | { tipo: 'hoja'; run: (ctx: MenuContext) => void | Promise<void> }
    | { tipo: 'pagina'; page: PageId };
}

const ACCIONES: Record<string, Accion>;
const ORDEN_POR_KIND: Record<MenuKind, Accion['id'][]>;
```

`ORDEN_POR_KIND` es el unico lugar donde vive el orden canonico. Anadir una
opcion a las cinco entidades es agregar una entrada al registro y una al orden de
cada kind, no editar cinco hojas.

### `components/menus/entity-menu-sheet.tsx`

Un `Sheet` con paginas que resuelve la hoja actual desde el registro. Reemplaza
los cuatro sheets de entidad y los dos nuevos.

### `components/menus/pages/`

Paginas compartidas, replacing las copias:

| Pagina | Reemplaza a |
| --- | --- |
| `RenamePage` | tres de las cuatro implementaciones distintas |
| `IconPage` | la fila escondida de lista y espacio, y la fila propia de nota y carpeta |
| `AccessPage` | `SharedBadge` suelto, mas `useShareReach` |
| `DeletePage` | `BookmarkDeleteSheet` y las paginas de borrar por hoja |
| `ExportPage` | la pagina de export de `ListMenuSheet` |

`AccessPage` sube el "con quien mas lo tenes" de la pagina de borrar
(`list-menu-sheet.tsx:631-661`) a una pagina propia. Hoy ese dato solo se ve
justo antes de borrar, que es el peor momento para enterarse de que alguien mas
tiene tu coleccion.

### Las dos superficies nuevas

**Pantalla de coleccion**: ruta `app/(app)/collection/[collectionId].tsx`, mismo
esqueleto que una lista (`Screen`, `useScreenTitle`, tres puntitos). Monta
`EntityMenuSheet kind="collection"`.

**Menu de fila de bookmark**: en `bookmarks.tsx`, cada fila pasa de una papelera
suelta a un `BotonMenu` que abre `EntityMenuSheet kind="bookmark"`, con borrar
como accion destructiva dentro. `BookmarkDeleteSheet` se disuelve en
`DeletePage`.

### Flujo de datos

El call site arma el `MenuContext` desde la entidad y lo que puede hacer. El sheet
filtra `ACCIONES` por `disponible(ctx)`, las ordena por `ORDEN_POR_KIND[kind]`, y
cada una va a su `destino`. Una hoja ejecuta su `run` y cierra; una pagina
empuja a la pila local de paginas. Ninguna pagina escribe en el store: escriben
los handlers que les pasa el call site, que es lo que ya pasa hoy.

## Manejo de errores

Un handler puede lanzar o ser asincrono, y eso no puede cerrar la app. Es
especialmente ridículo cerrar este corte con un bug de worklet recien arreglado,
pero la regla se sostiene igual: **una accion que falla deja la hoja abierta y
muestra el error en la hoja**, con un reintento. Borrar y compartir no cierran en
silencio.

Las escrituras siguen la regla local-first del repo (`AGENTS.md` regla 7): se
escribe local, se encola, se sincroniza. Un fallo de red no es un fallo de la
accion y no debe mostrarse como tal.

## Supuestos asumidos

1. **Exportar tiene sentido a nivel coleccion, no a nivel bookmark suelto.** Un
   enlace suelto ya esta en el Clipboard y en el share sheet. La API se agrega
   como `GET /collections/:id/export` con su forma en
   `packages/contracts/src`. Si se queria otra cosa, el corte de T9 se rehace.
2. **"Sin clasificar" recibe el menu de fila pero no pantalla propia.** Es un
   bucket, no una coleccion creada por la persona.
3. **`ColumnMenuSheet`, `MediaActionsSheet` y `TemplateMenuSheet` no se tocan.**

## Decisiones que el registro tiene que tomar

No son detalles: son las tres divergencias que hacen que "un solo menu" no sea
copiar y pegar.

### Paginas: un `Sheet` con `step`, no paneles hermanos

Hoy conviven tres arquitecturas. `list` y `collection` usan `step` + `onBack` en
**un** `Sheet. `note` hace `return` temprano y monta un `Sheet` distinto por
pagina (`note-menu-sheet.tsx:195`, `:328`, `:353`). `folder` no usa `step` en
absoluto: monta **seis** paneles siblings conmutados por `visible` mas el flag
`inside` (`folder-menu-sheet.tsx:111`, `:203-296`).

Se elige **`step` + `onBack` en un `Sheet`**, por dos razones concretas: es lo que
hace la hoja mas completa, y `Sheet` ya monta `SheetStep` por su cuenta
(`sheet.tsx:174`), asi que el multi-pagina ya esta resuelto en la base. Los seis
paneles de carpeta son justo el panel-sobre-panel que la familia evita, porque
`Sheet` es un `Modal`.

### El motivo de un disabled va en `description`

`SheetOption` no tiene campo de "por que no se puede": `disabled?: boolean` a
secas (`sheet.tsx:1098`), y solo se lee cuando hay `onPress`. **No se toca la
base**: el motivo va en `description`, que es la convencion que las cuatro hojas
ya usan para el caso "no es tuyo" (`description` condicional junto a
`tone: "danger"`).

Ojo con lo que `disabled` hace: con `onPress` baja `opacity` a `0.4` y **el
accessibilityLabel no cambia**, asi que el lector de pantalla no anuncia que esta
deshabilitado. El motivo en `description` es la unica via.

### El borrar no lo decide el registro

Hay cuatro mecanismos distintos para la misma cosa: `deleteList` y `deleteFolder`
son `useCallback` dentro de hooks, y `deleteNoteAction` y
`deleteCollectionAction` son `async function` en `lib/**` (esta ultima pone
`collectionId: null` en cada bookmark vivo antes de escribir el tombstone).
El registro **no unifica el borrado**: el call site pasa su handler de borrar, y
cada superficie sigue usando el suyo. Unificar el mecanismo es otro corte.

### `BotonMenu` hay que sacarlo de `content-list.tsx`

Es una funcion **local y no exportada** (`content-list.tsx:427`), con una sola
referencia en el repo. El menu de bookmark la necesita, asi que se extrae a un
componente compartido y se exporta.

### `role` esta duplicado en unions literales

`SharedBadgeProps.role` (`shared-badge.tsx:19`) y `FolderMenuSheetProps.folder.role`
(`folder-menu-sheet.tsx:25`) son `"owner" | "editor" | "viewer"` escritos a mano,
**no** `MembershipRole` del contrato. Y el predicado `role === "owner"` esta
copiado en tres hojas con tres comentarios distintos. El registro lo centraliza
con `MembershipRole` del contrato; los dos unions quedan como lo que son.

## Verificacion

**Este repo no tiene renderer.** Ni `@testing-library/react-native`, ni `jsdom`:
`apps/mobile/package.json` solo declara `vitest` y `@types/react`, y dos archivos
del propio codigo lo dicen en prosa ("no test in this repo renders a component,
so the testable part lives where it can be asked", `icon-picker-sheet.tsx:48`).
Verificar un menu unificado se hace leyendo el fuente y el diccionario.

Tres patrones, y cada cosa va en el que le corresponde:

| Que hay que probar | Patron | Como |
| --- | --- | --- |
| Filtrado y orden del registro, y la paridad entre kinds | **Puro** | Importa `ACCIONES` y `ORDEN_POR_KIND` de verdad y afirma sobre el resultado. El registro es puro justamente para que esto sea posible. |
| Las frases nuevas, en los dos idiomas | **Diccionario** | Importa `dictionaries` y afirma sobre `es` y `en`, como `shared-badge-copy.test.ts`. Agregar una clave a `es` sin `en` ya es error de compilacion. |
| Que un menu monta lo que el registro dice | **Texto fuente** | `readFileSync` del `.tsx` y `toMatch`, como `sheet-back.test.ts`. |

Lo que **no** se puede hacer, y no se va a prometer: renderizar
`EntityMenuSheet` y afirmar que aparecen cinco filas. No hay donde.

El test de paridad que importa: para cada `MenuKind`, el conjunto de ids que
devuelve el registro no es vacio, y todo id de `ORDEN_POR_KIND` existe en
`ACCIONES`. Un kind nuevo sin acciones es un fallo, no un menu en silencio.

Y ademas de los tests:

- **Visual**: la pantalla de coleccion y el menu de bookmark se miran en **web,
  claro y oscuro**, segun `AGENTS.md`.
- **Nativo**: el emulador. Un `Sheet` con paginas es exactamente la superficie
  donde `FolderMenuSheet` ya se sabe que se rompe (`Modal` sobre `Modal`).

Cada una es un work unit y cierra con su commit.

- [x] **T1** `lib/menus/registry.tsx`: `MenuKind`, `Accion`, `ACCIONES`,
  `ORDEN_POR_KIND`, y los tests puros de filtrado, orden y paridad. Sin UI.
- [x] **T2** `EntityMenuSheet` (un `Sheet` con `step` + `onBack`) + `RenamePage` +
  `DeletePage`, y migrar `CollectionMenuSheet` a esa version. La migracion es la
  prueba de que el patron anda: si reproduce la hoja mas chica, el registro
  alcanza.
- [x] **T3** `IconPage`, y extraer `BotonMenu` de `content-list.tsx` a un
  componente compartido exportado.
- [x] **T4** Menu de fila de bookmark. **Esto es lo primero que se ve.**
- [x] **T5** Pantalla de coleccion.
- [x] **T6** Migrar `ListMenuSheet`. Es la hoja mas completa: si el registro la
  reproduce entera, el registro alcanza.
- [ ] **T7** Migrar `NoteMenuSheet` y `FolderMenuSheet`. El de carpeta ademas
  pierde los seis paneles hermanos.
- [ ] **T8** `AccessPage`: `SharedBadge` en todas las superficies por defecto, y
  `useShareReach` subido de la pagina de borrar a una pagina propia. Ojo:
  `useShareReach` devuelve `null` cuando falla el request, y un fallo nunca
  puede pintar "nadie mas lo tiene".
- [ ] **T9** Exportar coleccion: el sobre en `packages/contracts/src/export.ts`,
  `collectionJson` / `collectionCsv` en `exportService`,
  `GET /collections/:id/export` por `sendFile` (bytes, no envelope), y
  `ExportPage`.
- [x] **T11** `SharePage`: la pagina que faltaba y hacia falta. Comparte con
      lista, nota y carpeta. **En el PR 3.**
- [ ] **T10** Compartir coleccion y bookmark: los dos valores del enum, las ramas
  de `resolveTarget`, y los permisos de `:220` y `:235`. Sin migracion de base.

## Criterios de aceptacion

- Los cinco kinds declaran el mismo conjunto base de acciones; las diferencias
  son declaradas en el registro, no por sheets distintos.
- Un bookmark tiene menu con las mismas opciones que una lista, y su borrar esta
  dentro del menu.
- Una coleccion tiene pantalla propia con header y tres puntitos.
- Renombrar e icono quedan en **una** pagina dentro del alcance, pero no en una
  sola de la app: `WorkspaceMenuSheet` queda afuera y conserva su propia pagina de
  renombrar con el icono escondido. Asi que renombrar pasa de cuatro copias a
  tres, y las puertas del icono de cinco a cuatro. Reducirlo del todo exige meter
  el espacio en el alcance, y el espacio trae su propio `SharePanel`, selector de
  color y gestion de miembros: es otro corte, no una fila de este.
- El test de paridad falla si un kind nuevo queda sin acciones.
- Web en claro y oscuro, y emulador.

## Checks

```
npm run typecheck
npm run test                  # api
cd apps/mobile && npx vitest run
cd apps/mobile && npm run config:check
```

## Ruta y evidencia de disparo

Delegado, un escritor por work unit. Disparo por la regla de escritura: cada tarea
toca varios archivos no triviales, y T2/T3/T7 exigen leer la implementacion previa
antes de tocarla.

## Presupuesto y entrega

El forecast es de unas **1500 a 2500 lineas**, muy por encima de las ~400 que
aguantan una revision. Va encadenado, en este orden, y cada PR se abre cuando el
anterior esta verde:

1. **PR 1 — fundacion**: T1 + T2 + T3. Nada visible todavia, pero sin esto no hay
   paridad posible.
2. **PR 2 — lo que pediste**: T4 + T5. Menu de bookmark y pantalla de coleccion.
3. **PR 3 — paridad de las hojas que ya existen**: T6 + T7.
4. **PR 4 — acceso**: T8. `SharedBadge` en todas partes y la pagina de "con
   quien mas lo tenes".
5. **PR 5 — contrato**: T9 + T10. Es el unico PR que toca `apps/api` y
   `packages/contracts`, y va ultimo a proposito: que los menus no queden
   esperando a que el backend este.

## Progreso

Sin empezar.