# El tablero: estados configurables para las tareas

Estado: por implementar.

Una lista de tareas puede ser además un tablero. En el tablero cada tarea está en un
**estado**, los estados los configura quien usa la app —backlog, ready, wip, done es
solo un ejemplo— y las tareas van pasando de uno a otro siguiendo ese flujo. El
tablero tiene un orden claro de estados, en móvil se ve de uno en uno y se cambia de
estado deslizando en horizontal, y en web ancha se ven varios a la vez.

Lo que distingue una tarea de un tablero de una tarea de una lista normal es
exactamente una cosa: **que tiene estado**. Por lo demás es la misma tarea de siempre,
con su título, su descripción, su icono, su prioridad y sus etiquetas.

## Qué se pide, exactamente

Una persona crea un tablero, elige sus estados, y luego:

- ve las tareas del estado en el que está, con un contador por estado;
- desliza en horizontal y pasa al estado siguiente o al anterior, con un orden fijo;
- toca una tarea y la mueve a otro estado;
- reordena las tareas dentro de un estado arrastrándolas;
- filtra por etiqueta, prioridad y texto, igual que en el listado de tareas;
- crea, renombra, colorea, reordena y borra estados;
- al borrar un estado con tareas dentro, la app no pierde nada: pregunta a cuál van.

## Qué no se pide

- **Límites WIP.** Se descartaron al decidir el alcance y no hay nada de esto. "wip" es
  un nombre de estado, no una regla.
- **Arrastrar una tarjeta de una columna a otra.** El swipe horizontal está
  reservado para cambiar de estado, en todo el móvil y en web.
- **Más de una plantilla.** Solo la inicial, y los estados se editan a mano después.
- **Archivar estados.** Un estado se renombra o se borra.

## Las decisiones, y por qué

### Un tablero es un `kind` nuevo, no un modo de ver una lista

`kind: 'board'` junto a `tasks`, `movies`, `series`, `movies_and_series` y `books`. No
un interruptor lista/tablero sobre `kind: 'tasks'`.

La razón es que en un tablero **el flujo de la tarea es el estado**, y en una lista es
`completed`. Si las dos cosas vivieran en la misma lista habría que decidir cuál
manda, y la respuesta sería "depende": una tarea completada en Backlog no es ni una
cosa ni la otra. Con un `kind` nuevo no hay ambigüedad porque nunca coexisten, y
`completed` simplemente no se usa en un tablero.

La consecuencia buena es que **nada de lo que ya existe se toca**. Las listas de
tareas que ya hay siguen siendo listas de tareas, no hay migración de datos, y la
pantalla actual de listas no cambia ni una línea.

### El swipe solo cambia de estado

Hay dos gestos horizontales que se pelan el mismo sitio: pasar de columna y mover una
tarea de columna. Se resolvió dejando **un solo gesto horizontal, que siempre pagina**.
Mover una tarea se hace tocando la tarjeta y eligiendo estado en una hoja.

Esto elimina la colisión de raíz y deja el arrastre de reordenar para el eje vertical,
que es libre. El coste es que mover una tarea pasa a ser dos toques en vez de uno. Se
acepta.

### Una columna en móvil, varias en web ancha

Por debajo de un ancho umbral se ve un estado a pantalla completa. Por encima, el
ancho se reparte entre los estados que caben, con un mínimo por columna, y si no caben
todos aparece scroll horizontal con anclaje, que salta de columna en columna igual que
en el móvil.

Es **el mismo componente** en los tres targets: no hay dos pantallas ni dos rutas. Lo
que cambia es el reparto del ancho.

### Los estados son un campo de la lista

`lists.states` es un `jsonb` con un array ordenado, y `list_items.state_id` apunta a
uno de ellos. La alternativa era una tabla `list_states` con clave foránea de verdad.

La ventaja natural de la tabla sería que borrar un estado con siete tareas es una
operación. **Eso no es cierto en esta arquitectura.** No existe operación en bloque
(`SYNC_OPERATION_KINDS` es `create`, `update`, `delete`) y la regla local-primero lo
impide: para poder borrar sin red, el cliente tiene que encolar los siete cambios. En
los dos enfoques son ocho operaciones.

Quedando anulada esa diferencia, la tabla cuesta una entidad de sync nueva
(`SYNC_ENTITIES`, la proyección del pull, `assertSupportedEntity`, el ciclo de
versiones) y un JOIN o un segundo viaje para abrir un tablero. El `jsonb` cuesta dos
columnas, ninguna con índice, y tiene un precedente inmediato en `lists.tag_colors`,
que es exactamente esta forma y entró en la migración 0020 con una sola línea de SQL.

Un regalo del `jsonb`: **editar los estados es una sola operación**. Renombrar,
colorear, reordenar y añadir viajan los cuatro como un array entero. Con una tabla,
reordenar serían N actualizaciones de `position`.

### Borrar un estado con tareas: bloquear y ofrecer a dónde van

Dos caminos:

- estado vacío → se borra, sin confirmar, porque solo se pierde un nombre y un color;
- estado con N tareas → una hoja dice cuántas hay y **pregunta a cuál de los demás
  estados van**, cada uno con su contador. Solo al confirmar se encolan las N
  operaciones y la del array.

Bloquear sin más obligaba a vaciar el estado tarea por tarea, y moverlas a mano no es lo
mismo que decidir a dónde va un bloque entero.

## Los datos

### La forma

`lists.states`, `jsonb NOT NULL DEFAULT '[]'`:

```ts
boardStateSchema = z.object({
  id:    z.string().min(1).max(36),   // estable, nunca se muestra al usuario
  title: z.string().trim().min(1).max(40),
  color: itemIconColorSchema,        // los doce colores que ya existen
});
states: z.array(boardStateSchema).max(24).default([]);
```

El orden del array **es** el orden de las columnas. No hay `position` por estado, y por
eso reordenar estados es una operación y no N.

`list_items.state_id`, `varchar(36)`, nullable, sin default. **`NULL` significa el
primer estado.**

Que sea nullable es deliberado: **crear una tarea en un tablero es exactamente el
mismo código que crearla en una lista**, `ItemEditSheet` no necesita saber que los
estados existen, y una tarea creada sin estado aterriza en la primera columna en vez de
quedar en un limbo que ninguna pantalla sabe pintar.

### Un id, no el título

Es la operación más frecuente del editor. Si la tarea guardara el título, renombrar
"Backlog" a "Ideas" dejaría cuarenta tareas apuntando a un estado que ya no existe. El
id se genera en el cliente con `crypto.randomUUID()` y el servidor nunca lo acuña ni lo
reescribe: llega en el push, como los ids que ya manda hoy.

### El invariante

> El `state_id` de una tarea es `NULL`, o uno de los `id` del array `states` de su
> lista.

El servidor lo comprueba al validar cada escritura de `list_item`, y **le sale gratis**:
`workspaceOfListItem` ya hace `findEntity('list', listId)` para traducir la lista a su
workspace, así que el array ya está en la fila que trae. Si no cuadra, la operación se
rechaza con un error claro.

Es exactamente lo contrario del modo de fallo que documenta el propio
`SYNC_WRITABLE_FIELDS`: *"se descarta en silencio y el push responde `applied`"*. Aquí
el rechazo dice la verdad.

### Un detalle que parece menor y no lo es

Como `state_id` nulo significa "el primero", **el recuento de "tareas en este estado"
tiene que incluir las que tienen `state_id` nulo cuando el estado cuenta es el
primero**.

Si no, se borra Backlog con tres tareas sin querer y esas tres saltan solas a Ready
porque el primero ha cambiado. Contando las nulas como las del primero, al borrar se
las mueve explícitamente y nunca queda nada colgando.

### La migración

Una, con la forma exacta de la 0020:

```sql
ALTER TABLE "lists"      ADD COLUMN "states"   jsonb DEFAULT '[]'::jsonb NOT NULL;
ALTER TABLE "list_items" ADD COLUMN "state_id" varchar(36);
```

Sin índices: el filtro por estado es de cliente, igual que hoy el de `completed` y el
de etiquetas.

`kind` **no necesita migración**. Es un `varchar(24)` —la 0001 lo creó como
`varchar(16)` y la 0002 lo amplió—, no un enum de Postgres, así que añadir `'board'`
es tocar una constante de TypeScript y ya.

### El orden dentro de una columna

`position` sigue siendo un único entero por lista y **no se toca**. Ordenar dentro de
una columna renumera `0..n-1` entre las tareas de ese estado. El índice
`list_items_list_position_idx` sobre `(list_id, position)` sigue sirviendo, y la
lectura del tablero es la de hoy: traer todo y filtrar en cliente.

### `SYNC_WRITABLE_FIELDS`: el punto de no retorno

`'states'` en `list`, `'stateId'` en `list_item`. Este es el primer sitio donde mirar
al escribir el código, y el repo tiene la cicatriz: el commit `2bbcba8` y el comentario
de ese archivo cuentan cuatro reconstrucciones en las que el campo parecía guardarse
y no cambiaba nada.

## Los contratos

- `listKindSchema` += `'board'`.
- `boardStateSchema`, nuevo y exportado.
- `listSchema.states`, con el default `[]`.
- `listItemSchema.stateId`, nullable.
- `LIST_EXPORT_CSV_COLUMNS` deja de ser una `const` fija y pasa a derivarse del `kind`.

Los mapas exhaustivos que avisan por tipos al añadir `'board'`, y que hay que arreglar
en el mismo commit porque el compilador los señala uno a uno:

- `LIST_KIND_ICON`, `LIST_KIND_LABEL` y `LIST_KIND_ORDER` en `lib/lists/kind.ts`
- `lists.kind.board` en los dos diccionarios de `lib/i18n/dictionaries.ts`
- `allowedCatalogKinds` y `hasCatalog` en `lib/lists/catalog-kinds.ts` ya caen en su
  `default` y devuelven `[]`, que es lo correcto: un tablero no tiene catalogo
- `isMediaList` en `lib/lists/media-card.ts` no incluye `'board'`, que es lo correcto

## La pantalla

Una pantalla nueva, `app/(app)/board/[listId].tsx`, **registrada en el
`(app)/_layout.tsx`** —que si no se queda sin título—, con la misma forma que la
pantalla de listas.

De arriba abajo:

1. **Cabecera.** Título del tablero y rótulo de tipo, como hoy.
2. **Tira de pestañas.** `Backlog 4 · Ready 2 · WIP 1 · Done 7`, cada una con su punto
   de color y su contador. Es un `ScrollView` horizontal con `scrollTo` al cambiar de
   estado, para que con más estados que caben siga funcionando.
3. **La pista.** `FlatList` horizontal con `pagingEnabled`, un elemento por estado a
   ancho completo. En móvil se ve uno; en web ancha, varios, y la pista se comporta
   como un carril con scroll-snap.
4. **La columna.** Cabecera con punto, nombre y contador; debajo las tarjetas; si no hay
   ninguna, un hueco punteado con un texto.

### El swipe

No es un gesto nuevo. Es el de `components/dashboard/panel-grid.tsx`, que ya funciona
en los tres targets: `Gesture.Pan` con `activeOffsetX([-14, 14])` y
`failOffsetY([-12, 12])`, un `trackX` compartido, `runOnJS(turnPage)(objetivo)` al
soltar y `withTiming` para asentar.

El `failOffsetY` es lo que reserva el arrastre vertical para reordenar tareas: un gesto
claramente vertical nunca pagina.

### El paralaje de las pestañas

La tira de pestañas se desplaza a una fracción de la velocidad de la pista, así se ve
por dónde vas antes de llegar. Es la misma idea que ya usa `components/ui/media-carousel.tsx`.

### Enlace a la pantalla correcta

Hoy varios sitios construyen la ruta de una lista a mano. Añadir un `kind` más obliga a
que todos acierten. Se mete un helper pequeño, `routeForList(list)` en
`lib/lists/`, que devuelve `/board/:id` o `/list/:id`, y todo lo que enlaza a una lista
pasa por ahí, incluida la entrada por búsqueda, el cajón y un enlace compartido.

`/list/[listId]` **redirige** a `/board/[listId]` si la lista es un tablero, para que un
enlace viejo o escrito a mano no enseñe la pantalla equivocada.

## Las tareas

**La tarjeta es la `TaskRow` que ya existe, menos la casilla de completada.** Mismo
icono, mismo título, misma insignia de prioridad, mismas etiquetas. Se le añade el filo
de color del estado a la izquierda.

**El nombre del estado no se escribe en la tarjeta.** En móvil ya sabes en qué columna
estás, y en web cada columna lleva su nombre en su cabecera. Ponerlo en la tarjeta
sería ocupar sitio para decir algo que la pantalla ya dice.

Lo que la tarjeta **no** muestra, igual que en las listas, es la descripción: esa vive
en la hoja de edición. Aquí la descripción de una tarea es el campo `annotation`, que
la migración 0011 renombró desde `notes` y que el ADR 0008 separó de la entidad nota.

### Mover de estado

Tocar la tarjeta abre la hoja de estado: el estado actual marcado y con su contador, los
demás con el suyo, y abajo un «+ Nuevo estado…» que crea el estado y mueve la tarea a
él sin salir del tablero. Desde ahí se entra al editor completo.

### Reordenar dentro de un estado

Pulsación larga y arrastre vertical, sobre el mismo `failOffsetY` que antes. Al soltar
se renumera `position` entre las tareas de ese estado.

El tablero fija `orderMode: 'manual'` y no ofrece los otros seis modos que existen:
ninguno de ellos significa nada repartido en columnas.

### La casilla de completada desaparece

En un tablero, "hecho" es un estado, no una casilla. Tener las dos cosas invita a tener
una tarea completada en Backlog, que es justo lo que se decidió evitar.

### Los filtros

`filterItems` ya es una función pura de cliente que acepta etiquetas, completada,
prioridad y texto. Al tablero le llega `completed` apagado —en un tablero no existe— y
el resto igual. Sale el mismo `ListControls` que ya envuelve la hoja de filtros.

## El editor de estados

Una hoja más, del mismo tipo que las que ya hay (`ListMenuSheet`, `ReorderSheet`). Fila
por estado: **asa de arrastrar, punto de color, nombre, contador, papelera.** Tocar el
nombre o el punto abre el editor de ese estado, que es el mismo sitio donde ya se edita
una tarea —título y color— y ahí se guarda.

Se abre desde dos sitios: la hoja de estado de una tarea, y los controles del tablero
como entrada propia.

### Añadir

El «+ Añadir» crea un estado nuevo al final. El id lo genera el cliente. Se puede
crear desde la hoja de mover una tarea, y la tarea va directa a ese estado.

### Reordenar

Por el asa de arrastrar, con la fila resaltada mientras se mueve. Es lo rápido y lo que
la gente espera; el asa se acepta sabiendo que ocupa sitio en todas las filas y que en
web hay que acertarla.

Los dos gestos de arrastre de la app —este para estados y el de las tareas dentro de
una columna— no se pisan: la hoja tapa el tablero, y solo hay uno en pantalla.

### Borrar

- Estado vacío: se borra, sin confirmar.
- Estado con N tareas: una hoja dice cuántas y pregunta a cuál de los demás van, cada
  uno con su contador. Solo al confirmar se encolan las N operaciones y la del array.
- **El último estado no se puede borrar**, y el motivo se muestra. Sin ese bloqueo un
  tablero puede quedarse sin estados y todas sus tareas apuntando a algo que no existe.

## Detalles que este documento cierra para que no se inventen luego

- **Dos estados pueden llamarse igual.** Los títulos no son únicos ni tienen que serlo:
  lo que identifica un estado es su `id`. Si dos se llaman "Listo" la app los dibuja
  los dos, con el mismo nombre y su propio color, porque el color es lo que los
  distingue.
- **El tope son 24 estados.** Al llegar ahí el «+ Añadir» se apaga con un texto que lo
  diga, en lugar de dejar crear un estado que luego no se puede guardar.
- **Un tablero siempre tiene entre 1 y 24 estados.** El mínimo sale del borrado del
  último estado, que está bloqueado; el máximo, del tope y del `max(24)` del contrato.
- **Un tablero en solo lectura no ofrece la hoja de estado.** Cuando el rol es
  `viewer`, ni la hoja de mover ni la de editar estados se montan, y sale el mismo
  aviso de solo lectura que ya tiene la pantalla de listas. El servidor lo impide
  igual —`assertCanWrite` exige `editor`— pero el cliente no enseña un botón que no
  va a funcionar.
- **En la búsqueda, una tarea de un tablero aparece sin completada.** `completed` es
  `false` en todas las tareas de un tablero, así que el resultado se dibuja como no
  completada. Es lo correcto y no se toca.
- **La descripción de una tarea es `annotation`.** Si "descripción" aparece en una
  petición, es ese campo: la migración 0011 lo renombró desde `notes` y el ADR 0008
  separó la entidad nota de la anotación de una fila.

## Crear un tablero

`kind: 'board'` aparece en el selector del formulario de lista nueva, con su icono y su
etiqueta. Al crearlo nace con **Backlog / Ready / WIP / Done**, en gris, azul, ámbar y
verde. Los ids se generan en el cliente.

A partir de ahí los estados se editan a mano: se renombran, se colorean, se reordenan y
se borran.

## Offline

Todo va por el mismo outbox, y sale casi gratis:

- Mover una tarea es un `update` de `list_item.state_id`, más la renumeración de
  `position` si toca.
- **Editar los estados es una sola operación de `list`**, porque los estados son un
  campo. Renombrar, colorear, reordenar y añadir viajan los cuatro como un array
  entero.
- En la caché local los estados van dentro del payload de la lista. Ni columna nueva,
  ni índice nuevo en `cached_entities`, ni mano a la lista de `SYNC_ENTITIES`.
  `localUpdate('list', id, { states })` funciona sin tocar el `sync-service`.

### Un límite que se dice en voz alta

Los estados son un campo único, así que **si dos personas editan el mismo tablero a la
vez gana la última, entera**. No hay fusión estado a estado.

El servidor lo detecta —`base_version` y `sync_conflicts` ya existen— pero no lo
resuelve por dentro. Comprar fusión estado a estado cuesta una entidad de sync
entera, que es justo lo que se decidió no pagar.

Va escrito en los límites conocidos de `docs/architecture/offline-sync.md`.

## Exportación

`LIST_EXPORT_CSV_COLUMNS` trae hoy `completado`, que en un tablero no significa nada. La
regla:

- el CSV de un tablero lleva `estado` y no lleva `completado`;
- el CSV de cualquier otra lista lleva `completado` y no lleva `estado`.

Un CSV con columnas distintas según el tipo es más honesto que uno con una columna
siempre vacía. El JSON no cambia: `listSchema` e `listItemSchema` ya llevan los campos
nuevos.

## Verificación

### API

`lists.test.ts` contra PGlite, con la migración ya aplicada:

- un tablero se crea con sus estados y se lee con ellos;
- una escritura de `list_item` con un `state_id` que no está en la lista **se rechaza**;
- **el test que vigila la cicatriz**: un push con `stateId` que no esté en
  `SYNC_WRITABLE_FIELDS` tiene que **fallar la prueba**, no responder `applied`;
- mover una tarea entre estados y comprobar que el orden sobrevive al pull;
- el CSV de un tablero trae `estado` y el de una lista de tareas trae `completado`.

### Móvil

La lógica del tablero va a **funciones puras** en `lib/lists/`, que es como se prueba
hoy de verdad: `statesOf`, `tasksInState`, `moveTaskToState`, `renumberWithinState`,
`canDeleteState`, `defaultStates`, `routeForList`. Cada una con sus casos, incluido el
detalle de las `state_id` nulas y el del borrado del primer estado.

### La pantalla

**En navegador, en claro y en oscuro**, según `docs/verificacion-en-navegador.md`, y con
el recorrido e2e que pide `2026-10-03-regresion-e2e-android-design.md`.

**En este repo no hay tests de componentes** y no se va a fingir lo contrario: el
tablero se comprueba abriéndolo en un navegador, escribiendo en el terminal lo que se
ve y qué se rompió.

Los tests de aserción sobre el texto fuente existen y se usan para lo que el Yoga no
deja ver. Si el tablero necesita esa clase de guardia, se escriben en esa forma y con
esa intención, no como sustituto de mirar la pantalla.

## Documentos

- `docs/roadmap.md`: su Fase 3 es la de listas, y el roadmap dice cómo ha quedado de
  verdad.
- `docs/architecture/data-model.md` (**en inglés**, como está ese documento): las dos
  columnas nuevas.
- `docs/product/scope.md` (**en inglés**): el tablero en la tabla de contenido del MVP.
- `docs/architecture/offline-sync.md` (**en inglés**): el límite de la última escritura.

## Fuera de alcance, dicho para que no vuelva

Límites WIP. Arrastrar tarjetas entre columnas. Vistas de tabla y calendario del
tablero. Automatizaciones al entrar en un estado. Reglas de bloqueo de una columna.
Historial de cambios de estado. Estados de más de un workspace. Más de una plantilla.
Archivado de estados.