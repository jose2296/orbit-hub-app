# Compartir un enlace desde otra app: la eleccion del destino y el texto que trae el servidor

Estado: por implementar.

Comparto un post de X, un video de YouTube o un articulo desde el navegador, elijo OrbitHub en
el share sheet de Android, y la app me pregunta donde lo quiero guardar. El enlace se guarda al
instante aunque no tenga red, y el texto del articulo aparece despues.

Lo que se pide son cinco cosas que se apoyan unas en otras: una entidad nueva, un extractor, un
share sheet nativo, una pantalla para leer, y un camino en la web para cuando la app no esta
instalada. Se pueden entregar por separado y este documento explica en que orden.

## Que se pide, exactamente

1. Un **share target nativo en Android**: OrbitHub aparece en el share sheet del sistema y abre
   una hoja pidiendo donde guardar el enlace.
2. **Colecciones**: un bookmark pertenece a lo sumo a una coleccion, y una coleccion vive en un
   workspace y, si se quiere, en una carpeta. Al guardar se elige una coleccion existente, se crea
   una en el momento, o se deja **sin clasificar**.
3. **Sin clasificar** es una seccion del menu principal con lo que falta categorize, para triage
   posterior.
4. **El texto del articulo**, extraido por el servidor y leible sin conexion. Un video de YouTube
   se guarda con su metadata y sin texto, y eso no es un fallo.
5. **Un camino en la web** para cuando la app no esta instalada, mediante Web Share Target en la
   PWA.

## Lo que ya existe y lo que no

Esto se verifico antes de proponer nada, y la respuesta define el tamano del trabajo.

**No existe nada de bookmarks.** No hay tabla de URL guardada, ni de read-later, en
`apps/api/src/db/content-schema.ts` ni en `apps/api/drizzle` ni en `packages/contracts/src`. Un
grep de `bookmark|read_later|saved_url|raindrop|pocket` sobre `apps/api/src` devuelve una sola
coincidencia y es un icono: `icon: 'bookmark-outline'` en
`apps/api/src/modules/notes/built-in-templates.ts:110`. El dominio es verde.

**Si existe todo lo demas**, y es lo que hace este trabajo barato:

- Workspaces (`content-schema.ts:33-62`), membresias con rol `owner|editor|viewer`
  (`content-schema.ts:65-83`, `db/constants.ts:29`).
- Un arbol de carpetas de verdad, con `folders.parentId` y su relacion
  `foldersRelations` (`content-schema.ts:131-152`, `:290-297`).
- El motor local-first completo: `apps/mobile/src/lib/offline/` con `local-store.ts`,
  `sync-service.ts`, `sync-engine.ts`, `coalesce.ts`. Escritura local y encolado en
  `sync-service.ts:478-514` (`localUpdate`), cola en `sync-service.ts:70-112`.
- Un bottom sheet propio: `components/ui/sheet.tsx`, Reanimated y `GestureDetector` dentro de un
  `Modal` de React Native. **No hay `react-native-paper` en el proyecto.**
- `WhereNoteSheet` (`components/notes/where-note-sheet.tsx`, 195 lineas), que ya pregunta
  workspace y carpeta con `useSpacesTree()`, `tree.spaces()` y `tree.foldersOf()`.
- El formato de documento: `packages/contracts/src/note-document.ts`, 551 lineas, una lista
  cerrada de tags validada por un parser escrito a mano que corre en la API, en Hermes y en el
  navegador desde el mismo archivo.
- `expo-sharing ~57.0.22` en `apps/mobile/package.json:38`, **ya instalado y ya en `plugins`**
  (`app.json:33-47`), hoy sin configurar.
- Export web estatico: `app.json:28-32` con `output: "static"`, servido por `nginx.conf` desde
  `apps/mobile/dist` (`Dockerfile.web:88-93`).

**No existe** el renderizador de solo lectura de documentos. Lo unico que dibuja un
`note-document` es `components/notes/note-editor.tsx`, que es `EnrichedTextInput`: un editor, con
cursor y con autosave. Servir un articulo ahi seria absurdo, y por eso el lector es trabajo nuevo.

**No existe** ninguna logica de extraccion. Un grep de `unfurl|opengraph|og:|oembed|cheerio|
link-preview` sobre `apps/api/src` y `packages/contracts/src` solo encuentra las etiquetas OG
propias de OrbitHub en `app/+html.tsx:107-118`. Lo mas cercano es `apps/api/src/routes/catalogs.ts`,
que consulta TMDB y Google Books para peliculas y libros, no para articulos.

**No existe** ningun worker ni cola de trabajos en `apps/api`. `src/` es `app.ts config db lib
middleware modules routes scripts`, y `index.ts` y `app.ts` no tienen `setInterval`, ni cola, ni
worker. Todo lo asincrono es dentro del request.

## El modelo: cuatro niveles

```
workspace  ->  carpeta  ->  coleccion  ->  bookmarks
```

Las carpetas y las colecciones no son lo mismo y por eso las dos estan. Una carpeta es **espacial**:
donde vive algo, en la jerarquia de espacios. Una coleccion es **semantica**: de que tema es esto,
y cruza carpetas. Sin colecciones, guardar un articulo de Rust y uno de cocina en el mismo sitio es
la unica opcion, y ese sitio termina siendo una carpeta llamada "Rust y cocina".

Y sin carpetas, las colecciones se vuelven el unico destino y se pierde la organizacion que ya
existe en la app.

### La regla del destino, que es una sola

> Si se elige una coleccion, el `workspaceId` y el `folderId` salen de la coleccion.
> Si se elige "sin clasificar", no hay coleccion, y los elige la persona.

Una decision. Cuando alguien saca un enlace de "sin clasificar" y lo mete en una coleccion, **se
mueve** al workspace y a la carpeta de esa coleccion. Eso es lo que hace util el inbox: lo que
estan sin clasificar tiene un destino pendiente, y categorization lo resuelve.

### `collections`, tabla nueva

Paralela a `lists`, con su forma:

| columna | nota |
| --- | --- |
| `id` | uuid, pk |
| `workspaceId` | FK a `workspaces`, cascade |
| `folderId` | FK a `folders`, cascade, nullable |
| `name` | varchar |
| `description` | texto libre |
| `emoji` | igual que en listas y carpetas |
| `position` | integer, default 0 |
| `version`, `createdAt`, `updatedAt`, `deletedAt` | igual que el resto del dominio |

Indices: `(workspaceId, updatedAt)`, `folderId`, `deletedAt`.

Las colecciones aparecen en el browser de carpeta junto a notas, listas y carpetas. No es
decoracion: el `position` de las cuatro cosas tiene que poder compararse entre si, que es
exactamente el motivo por el que esa columna existe en `notes` y en `lists` y esta escrito en el
comentario de la columna.

### Por que `collections` y no un `kind` nuevo en `lists`

`LIST_KINDS` es un enum cerrado (`db/constants.ts:57-63`): `tasks`, `movies`, `series`,
`movies_and_series`, `books`. El comentario de arriba dice que una lista es una de esas "for
good, and never two at once". Y `list_items.metadata` esta documentado como el bolsillo del
registro de TMDB o Google Books, para que una lista se dibuje sin volver a llamar al proveedor.

Meter articulos ahi obliga a que `list_items` cargue con una columna `document` de 512 KB que solo
usarian los bookmarks, a abrir un enum que el codigo declara cerrado a proposito, y a que cada
pantalla de listas bifurque por tipo. Dos entidades parecidas cuestan menos que una entity con dos
vocablos.

### `bookmarks`, tabla nueva

| columna | nota |
| --- | --- |
| `id` | uuid, pk, generado en el cliente |
| `workspaceId` | FK, cascade. **Siempre escrito**: ver la regla del destino |
| `folderId` | FK, cascade, nullable |
| `collectionId` | FK a `collections`, nullable. `NULL` es "sin clasificar" |
| `url` | text. Sin tope: hay URLs largas legitimas |
| `title` | varchar 300 |
| `siteName` | varchar 120. "YouTube", "X" |
| `description` | text, la de `og:description` |
| `imageUrl` | text, la de `og:image` |
| `document` | text. El articulo, en el formato de `note-document.ts` |
| `plainText` | text. Desnormalizado para busqueda, como en `notes` |
| `extractionState` | `pending` \| `ready` \| `metadata_only` \| `failed` |
| `extractionError` | varchar 200, el motivo corto que ve la persona |
| `tags` | jsonb `string[]`, default `[]` |
| `position` | integer, default 0 |
| `version`, `createdAt`, `updatedAt`, `deletedAt` | igual que el resto |

Indices: `(workspaceId, updatedAt)`, `folderId`, `collectionId`, `deletedAt`, **trigram sobre
`plainText`** y **GIN sobre `tags`**.

Los dos ultimos son los mismos que ya tiene `notes`, y estan escritos a mano en las migraciones
por una razon que sigue valiendo: un btree sobre una columna de frases no responde a "buscar esta
palabra dentro del texto". Con esto, buscar una palabra **dentro de un articulo guardado** es la
misma consulta que buscarla dentro de una nota, y sin busqueda nueva.

## La frontera de escritura, que es lo que hace el sistema coherente

> **El cliente escribe `url`, `title`, `collectionId`, `folderId`, `tags` y `position`.
> El servidor escribe todo lo demas.**

`SYNC_WRITABLE_FIELDS.bookmark` (`db/constants.ts:109+`) lista solo esos. `document`, `plainText`,
`extractionState`, `extractionError`, `description`, `imageUrl` y `siteName` quedan **fuera**.

Tres consecuencias, y las tres importan:

1. Un cliente viejo, o uno que no sabe nada de extraccion, **no pisa texto que el servidor ya
   escribio**. El `document` se escribe una vez y despues llega por `pull`.
2. Dos dispositivos no se pelean por el articulo. El que guarda tiene `pending`; el otro nunca
   escribio `document` y por lo tanto no genera conflicto sobre el.
3. Si alguien manipulase el cliente, no podria inyectar contenido en un documento: el validador de
   `note-document.ts` lo rechaza igual, pero el servidor ya no depende de que el cliente se porte
   bien.

`workspaceId` va en el payload del `create` y **nunca** en un `update`, y esto no es una excepcion
que uno invento: es literalmente lo que hace `lib/notes/actions.ts:38-41`, con el comentario de que
el servidor es dueno de ese campo, porque un cliente que pudiera mover una nota entre espacios
podria archivarla donde el dueno nunca la puso. Un bookmark tampoco se muda de workspace: se
copia o se borra.

Agregar un syncable es un cambio en **cuatro** lugares: tabla, `SYNC_ENTITIES`
(`db/constants.ts:36-43`), `SYNC_WRITABLE_FIELDS`, y el contrato. Que sean cuatro y no tres es un
dato, no una excepcion: el comentario de `db/constants.ts:110-115` documenta el fallo exacto de
omitir el cuarto, que es el servidor contestando `applied`, sumando `version`, y no escribiendo
nada.

Y hay dos defaults que son del servidor, porque no estan en la lista de campos escribibles y por
eso el cliente no podria mandarlos:

- `extractionState` nace en `pending` al crear la fila.
- `title` **solo se llena si esta vacio**. Si la persona escribio un titulo, el extractor no lo
  toca. Un titulo escrito a mano es mejor que cualquier `og:title`, y pisarlo seria perder
  informacion que alguien escribio a proposito.

## El share sheet: lo que habia supuesto mal

Aqui hay que ser exacto, porque la primera version de este documento daba el camino equivocado.

**No hace falta escribir el intent-filter a mano.** `expo-sharing ~57.0.22` ya esta instalado
(`apps/mobile/package.json:38`) y ya esta en `plugins` (`app.json:33-47`), hoy como string pelado,
sin configurar. En SDK 57 esa libreria **recibe** datos de otras apps, no solo envia, y su config
plugin **agrega el intent-filter al `AndroidManifest.xml`**. Se activa con:

```json
["expo-sharing", { "android": { "enabled": true, "singleShareMimeTypes": ["text/plain"] } }]
```

**El enrutado no es `Linking.getInitialURL()`.** El camino que sanciona Expo Router para esto es un
`+native-intent.ts` en la raiz de `apps/mobile/src/app`, con `redirectSystemPath`, que recibe el
path de entrada, ve que su hostname es `expo-sharing`, y devuelve la ruta propia. No existe
ningun `+native-intent.ts` hoy, asi que es archivo nuevo. Los payloads se leen con
`getSharedPayloads()`, que devuelve `value` (el texto o la URL), `mimeType` y `shareType`.

**No hace falta ninguna libreria de terceros.** Ni `react-native-share-intent` ni
`expo-share-intent`. Y `react-native-linking` no se toca: `expo-linking` ya es dependencia y sigue
sin usarse, y no hay por que empezar ahora.

**No se registra el `VIEW` para `http`/`https`.** Registrarse como manejador de enlaces web
apareceria en **cada** toque de link del sistema, no solo cuando se comparte. Eso secuestra la
navegacion de todo el movil para resolver un caso que el usuario no pidio. Solo `SEND` con
`text/plain`.

**Si hace falta un build nativo nuevo**, eso no cambia. El intent-filter vive en el
`AndroidManifest.xml`, y `expo-dev-client` no esta en las dependencias: el build que hay en el
emulador es release-clase. Se compila.

### El share llega en frio, y a veces sin sesion

Abre la app una accion que no espero, y puede que la sesion no este. El precedente exacto ya esta
en el repo y por que se puso ahi esta escrito en `apps/mobile/src/app/invite/[token].tsx:23-27`:
una ruta atras del guard de auth manda a la pantalla de bienvenida y **pierde el enlace**.

Por eso `app/share/save.tsx` se registra **fuera** de todos los route groups, en
`app/_layout.tsx`, junto a `invite/[token]`, `privacy` y `terms`. El unico guard que redirige esta
en `(app)/_layout.tsx`.

Y cuando la persona no esta autenticada, el mismo truco que ya usa el alta: `?next=/share/save`, que
`sign-in.tsx:24-25` ya sabe leer y solo acepta si empieza por `/`. El link sobrevive al login.

### La hoja: una sola decision, dos taps

`ShareSaveSheet` compone, como `children` de `Sheet` con `scrollable={false}`:

- El **preview**: host, y la miniatura en `artwork` de `Sheet`, que ya existe y esta pensado
  justamente para "una hoja cuyo titulo solo no dice cual es" (`sheet.tsx:38-47`).
- El **titulo editable**, con un placeholder que dice que si se deja vacio se usa el del enlace.
- El **destino**, y aqui esta el segundo tap.
- El boton **Guardar**, fijo abajo.

El destino tiene tres salidas y hace falta mas de una pantalla para las tres:

1. Una coleccion existente de entre las de este workspace.
2. **Crear una coleccion en el momento**, sin salir de la hoja.
3. **Sin clasificar.**

Esas tres no entran en una lista. Por eso la hoja tiene dos paginas, y por eso `SheetProps.onBack`
existe: el comentario de `sheet.tsx` explica que **siete hojas de esta app tienen mas de una
pagina**, que cada una tenia su propio boton de "Volver" que en realidad hacia un paso atras y
saltaba, y que el boton de la izquierda es donde va una flecha de vuelta. Un `onBack` en el
compartido del share sheet es el patron de la casa, no una excepcion.

### `PlacePicker`, extraido y no duplicado

`WhereNoteSheet` ya sabe hacer esta eleccion. No se copia: se **extrae**.

```
PlacePicker { workspaceId, folderId, collectionId, onChange }   <- usa useSpacesTree()
    ^
WhereNoteSheet        (existente; pasa a ser un envoltorio de 20 lineas)
ShareSaveSheet        (nuevo)
```

Una sola fuente de verdad para "donde va esto". Si manana se cambia el orden en que se ofrecen las
carpetas, no hay que tocar dos hojas.

## El share sheet no espera a la extraccion

El `create` se encola en el outbox como cualquier otro, y el enlace queda guardado **ya**. Con
`extractionState: 'pending'`. Si no hay red, esa es la historia completa y esta bien: la persona
compartio, eligio donde, y quedo guardado. Volver a la app un rato despues no tiene que
preguntarle nada.

Despues, y solo si hay red, el cliente dispara `POST /api/bookmarks/:id/extract` como una llamada
aparte, best-effort, y descarta el resultado. El texto vuelve por el `pull` de siempre.

### Por que la extraccion NO va dentro del sync

Esta es la decision de la que mas me burro al escribirla, asi que vale la pena el porque.

El push de sync esta serializado, coalescido, y con un ledger de idempotencia
(`sync-service.ts:70-112`, `foldIntoCreate` en `:98-106`). Meter ahi un fetch saliente de hasta
ocho segundos rompe tres cosas a la vez: bloquea todo el lazo de push y pull, arriesga un timeout
de gateway, y ensucia la idempotencia, porque si el push se reintenta, ¿se vuelve a buscar el
articulo? Ademas el periodo de sync son 120 s (`sync-engine.ts:27`) con un debounce de 1,5 s
(`:82`), asi que un fetch lento no es una excepcion: es el caso normal de una pagina pesada.

Separado, el sync queda puro: escribe lo que la persona escribio, y poco mas. La extraccion es un
endpoint del servidor con la escritura en manos del servidor, que se puede reintentar sin tocar el
outbox.

Y esto es lo que cumple de verdad la regla 7 de `AGENTS.md`: **un bookmark nunca falla por estar
sin conexion o porque el sitio este caido**.

## El extractor

En `apps/api`, que es Express 5 sobre Node con `pg`, `drizzle-orm` y `zod`. **No tiene ninguna
libreria de HTML**: ni cheerio, ni jsdom, ni linkedom, ni Readability. Esto es dependencia nueva, y
la regla 1 de `AGENTS.md` pide un motivo escrito, asi que va escrito.

### `@mozilla/readability` mas `jsdom`

Readability es el algoritmo que usa el modo lector de Firefox, y es la forma en que Pocket e
Instapaper hacen lo mismo. No es una preferencia: lo que se quiere es leer un articulo sin la
pagina de ads alrededor, y eso es literalmente el problema que Readability resuelve. Necesita un
DOM, y jsdom es el que espera.

Los **OG tags se leen a mano**. Son `<meta property="og:title">` y compania: un punado de regex,
cero dependencia. Readability ademas devuelve `siteName` y `excerpt`, asi que hay solapamiento y
se fusiona por precedencia:

- `title`: lo que escribio la persona > titulo de Readability > `og:title` > hostname
- `description`: `og:description` > excerpt de Readability
- `imageUrl`: `og:image` > imagen principal de Readability
- `siteName`: `og:site_name` > hostname

**YouTube tiene caso propio.** `youtube.com/oembed?url=...&format=json` no pide API key y devuelve
titulo, autor y thumbnail. Quince lineas. Y hay que ser honesto con lo que significa: **un video no
es un articulo**. Readability sobre una watch de YouTube devuelve basura o nada. Por eso existe
`metadata_only`, que no es un fallo sino la respuesta correcta.

### La normalizacion, que es la parte que no es opcional

Readability devuelve HTML con `div`, `span`, `section`, `figure`, `table`. Eso **no** puede
guardarse. `note-document.ts` acepta un conjunto cerrado: en linea `b i u s code a`, de parrafo
`h1`-`h6`, `blockquote`, `codeblock`, de lista `ul ol`, y sin cierre `img br`. De `img` solo
`width` y `height`.

Asi que el HTML de Readability se **reduce** a ese conjunto y despues pasa por el validador que ya
existe. Ese validador no se esta reusando por comodidad: su propio comentario lo dice, *"this
check is the security boundary on mobile, not a nicety"*, porque el editor **no sanea HTML** en
iOS ni en Android. Es la misma frontera que protege las notas, y guardar un articulo de internet la
atraviesa de verdad.

Si el `document` resultante no pasa el validador, la fila se guarda igual y el estado es
`metadata_only`. Un articulo que no entra es un enlace guardado, no una perdida.

**Lo que el spike de viabilidad midio, y que cambia como se reduce.** Readability falla el
validador en **5 de 5 paginas reales**: en Wikipedia, **1 203 de 2 093 elementos** (el 57,5 %) son
tags que el conjunto cerrado no acepta, y aparecieron tags que este documento no preveia:
`sup` (121 ocurrencias), `source`/`svg`/`path`, y `gu-island` de The Guardian.

La sorpresa buena: al reducir **desenvolviendo** cada tag no permitido en vez de descartarlo —
conservando sus hijos y su texto — **sobrevive el 99,8 % del texto** y quedan **0 problemas del
validador**. La prosa no se pierde: `<sup>[1]</sup>`, `<cite>` y `<dd>` quedan como texto plano.
Lo que si se infla es el marcado: 93 `<p>` de entrada salen 418, y hay 344 enlaces salientes.

**Por eso la reduccion es *unwrap*, no descartar.** Descartar el tag entero tiraria texto real de
un articulo, que es justo lo que el usuario guardo. Desenvolverlo conserva el contenido y
normalmente ademas lo hace mejor, porque un `<div>` anidado pierde su sentido de bloque.

### El piso de palabras, y por que existe

Un articulo con nueve palabras no es un articulo, es un recorte de la pagina.

Se midio tambien el rendimiento: **limpiar `<script>` antes de construir el DOM da 7x** (el DOM no
se paga por scripts que nadie va a leer). Pero tiene un efecto secundario que obliga a un minimo:
sin scripts, **una watch de YouTube deja de dar `null` y da nueve palabras**. Sin un piso, un video
caeria en `ready` con nueve palabras y una portada, que es peor que `metadata_only` porque
**parece** que se leyo el articulo y no se leyo nada.

Por eso hay un **minimo de palabras** por debajo del cual el estado es `metadata_only` y no
`ready`. El numero exacto lo fija la fase 2, no este documento.

### Lo que el spike dejo abierto

`linkedom@0.18.13` con Readability dio **las mismas palabras en 5 de 5 paginas**, entre 2 y 16
veces mas rapido, con **15 paquetes y 3,7 MB** en vez de 45 paquetes y 47,6 MB. No se eligio
porque `linkedom` no es un DOM completo y la sanitizacion necesita uno. Queda como decision abierta
si el tamano pesa en el deploy.

Dos cosas mas que el spike **no** pudo medir y que la fase 2 tiene que vigilar: ninguna SPA se
probaron (devuelven HTML vacio), y los paywalls de verdad —New York Times, WSJ, FT— respondieron
403/401 y quedaron sin medir. Los que se midieron (The Guardian) **traen el texto en el HTML
crudo**: un muro de pago no salta por tecnica.

### El guard de SSRF, que es la parte que no se negocia

Compartir una URL es **input no confiable**, y el servidor la va a fetchear. Ese es el vector
clasico de SSRF y es la superficie de seguridad mas grande de toda la feature. Un atacante que
logre que la app busque una URL controlled por el esta pidiendo al servidor que entre a una red en
la que la persona no puede entrar.

El guard, todo o nada:

- Solo `http` y `https`. `file:`, `ftp:`, `data:`, `gopher:` y companyia se rechazan.
- Resolver DNS y **rechazar** las IPs resultantes de loopback, privadas, link-local y multicast:
  `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `::1`,
  `fc00::/7`. El `169.254.0.0/16` es el de los metadatos de la nube, y es el que se gana un
  [`SSRF contra el proveedor`](https://owasp.org/www-community/attacks/Server_Side_Request_Forgery).
- **Fijar la IP resuelta** para el connection y **revalidar en cada redirect**, porque el
  primer `Location:` es el lugar clasico donde se mete una IP interna.
- Maximo 3 redirects.
- Tope de bytes leidos, y corte en cuanto se pasa. Un `Content-Length` enorme se rechaza antes de
  descargar.
- Timeout duro por request y en total.
- `Content-Type` tiene que ser `text/html`. Un PDF o un zip no es un articulo.

Si el sitio esta paywalled, bloquea, o tarda: `extractionState: 'failed'` con un motivo corto, y
el bookmark sigue existiendo con su URL y su titulo. **Nunca se pierde un guardado por culpa de un
tercero.**

### Los cuatro estados, que significan cosas distintas

| estado | que ve la persona |
| --- | --- |
| `pending` | skeleton y "trayendo el texto". El enlace ya esta guardado. |
| `ready` | el articulo, formateado para leer |
| `metadata_only` | portada y metadata, y "abrir original". **Asi se ve un video.** |
| `failed` | el enlace, y un boton "reintentar" |

La distincion entre `metadata_only` y `failed` importa. `metadata_only` es una respuesta correcta
a un sitio que no es un articulo, y se muestra sin disculpa. `failed` es un sitio que no se pudo
leer, y ofrece reintentar. Mezclarlos hace que compartir un video parezca un error, y eso
desensibiliza a la persona de los errores de verdad.

## Sin clasificar es una vista, no un sitio

`WHERE collection_id IS NULL`. No es una carpeta ni un workspace: es un inbox que **cruza todos los
espacios**, agrupado por workspace. Por eso puede contener bookmarks de espacios distintos sin
contradecirse, y por eso vive en el menu principal y no en el browser de carpeta.

La entrada va en `components/layout/drawer.tsx`, junto a `personas` y `ajustes`, con el contador de
pendientes. Desde ahi se elige coleccion, o se crea una.

**Borrar una coleccion no borra sus bookmarks.** Los deja en sin clasificar. Es la unica decision
segura aqui, y es la que hace que el inbox sea real en vez de decorativo: si borrar una coleccion
con 200 enlaces te los borrara, no la ibas a usar nunca. Y por el mismo motivo el borrado es
logico (`deletedAt`), no fisico.

## La interfaz

### La lista

`app/(app)/bookmarks.tsx`, con el mismo shape que `notes.tsx`: `useHeaderAction`, filas con
portada, titulo, host y tags.

El orden por defecto es **`updatedAt desc`**: lo ultimo guardado arriba. Para "leer despues" eso es
lo correcto, y es distinto del `createdAt` de las notas. El `position` manual queda igual que en
listas y carpetas para cuando alguien ordene a mano.

Un filtro por coleccion, y un filtro de "sin collection" desde el drawer. La busqueda cubre los
articulos enteros, por el trigram de `plainText`.

### El lector

`components/bookmarks/document-view.tsx` es trabajo nuevo: renderiza el conjunto cerrado de doce
tags, sin `contenteditable`, sin cursor, sin autosave. Es acotado, y es exactamente el motivo por el
que el bookmark no puede ser una nota.

`app/(app)/bookmark/[bookmarkId].tsx` muestra portada, titulo, host, fecha y estado, y los cuatro
estados de la tabla de arriba. "Abrir original" siempre, porque a veces el sitio tiene mas.

## Web: cuando la app no esta instalada

### Android

Un miembro `share_target` en `apps/mobile/public/manifest.webmanifest`, que hoy tiene 28 lineas:

```json
"share_target": {
  "action": "/share-target",
  "method": "POST",
  "enctype": "application/x-www-form-urlencoded",
  "params": { "title": "title", "text": "text", "url": "url" }
}
```

El service worker intercepta ese POST antes de que llegue al servidor, y `app/share-target.tsx`
lo resuelve. El paso que no se puede omitir, y que es la trampa clasica de todos los share
targets: **el POST se copia a `sessionStorage` y se navega al home**, porque un POST no sobrevive
a un reload y esta pagina recarga. Despues se lee el payload guardado, se hace login si hace falta
con el mismo `?next=` de siempre, y se abre el mismo `ShareSaveSheet`.

Dos cosas del camino existente: el service worker **solo se registra en produccion**
(`app/+html.tsx:16-21`), asi que hay que decidir si esto funciona tambien en dev o solo en el build
de release; y `nginx.conf` sirve un export plano, asi que `/share-target` tiene que ser una ruta
real del export y nginx tiene que dejarla pasar, no devolver el `index.html` antes de tiempo.

### Lo que esto no es

En **Android funciona, pero exige que la PWA este instalada** (Add to Home Screen). No es "si no
tenes la app te lo resuelvo": es "si no tenes nada, instala la web y apareces igual". Y solo aplica
a las apps que disparen `ACTION_SEND` o un intent de texto o URL.

En **iOS no existe esta via**: Safari no soporta Web Share Target. No es una tarea pendiente, es
que la plataforma no lo ofrece.

## Las cinco fases, y por que en este orden

| fase | que trae | como se verifica |
| --- | --- | --- |
| 1 | dominio: `collections`, `bookmarks`, contratos, API, sync | `npm run typecheck` y tests de API |
| 2 | extractor: guard SSRF, Readability, OG, oEmbed, normalizacion | tests contra HTML real, guard incluido |
| 3 | share sheet: `PlacePicker`, `ShareSaveSheet`, ruta fuera del guard | build nativo en el emulador, share sheet de verdad |
| 4 | lector, lista e inbox "sin clasificar" | emulador y web |
| 5 | web share target: manifest, service worker, pagina | web, con la PWA instalada |

**El orden importa y no por dificultad.** La fase 1 es la mas aburrida y la que mas parece
trabajo mecanico, y va primera porque **las cuatro sin ella no tienen nada que mostrar**: sin las
tablas no hay un bookmark que guardar, sin el sync no hay nada que guardar en el dispositivo, y sin
el sync no hay nada que extraer.

La fase 3 es la que da el gesto completo que se pidio, y va antes que el lector a proposito: desde
la 3 se puede compartir un enlace, elegir donde, y verlo guardado con su metadata, aunque la
extraccion todavia no funcione. El texto llega despues. Al reves, el lector se construye antes de
que exista algo que leer, y no se puede probar a mano.

### Este documento no es un plan

Cinco subsistemas no entran en un solo plan de implementacion, y este documento los describe a
todos para que las decisiones se puedan revisar antes de que exista codigo.

El plan se escribe **por fase**, empezando por la 1, y cada fase se cierra con su propia
verificacion antes de que empiece la siguiente. Las fases 3, 4 y 5 dependen de la 1. La 2 se puede
desarrollar en paralelo con la 3, porque el endpoint de extraccion se prueba con `curl` sin que
exista todavia la hoja.

## Lo que esto no es

- **No hay deteccion de duplicados.** Compartir dos veces el mismo link crea dos bookmarks. Se
  normaliza la URL para que sea barato agregarlo despues, pero no hay UI ni aviso.
- **No hay busqueda semantica ni embeddings.** La busqueda es trigram, la misma de las notas.
- **No hay CAPTCHA ni cola de trabajos.** La extraccion es en el request, con tope de tiempo. Si
  algun dia hace falta reintento con backoff, es una tabla de trabajos, y `extractionState` ya
  esta para soportarla sin cambiar el esquema.
- **No hay iOS Share Extension.** Ver "decisiones revisables".
- **No se registran adjuntos.** Una imagen de un articulo se referencia por URL, no se sube. Los
  `attachments` estan hoy deliberadamente fuera del outbox (`content-schema.ts:488-492`), asi que
  subirlos seria otro trabajo.

## Decisiones revisables

**La de iOS.** Cuando se acordono esto, el motivo para descartar la Share Extension nativa era que
era un modulo nativo completo y otro proyecto. **Ese motivo era falso**: `expo-sharing` ya trae
una, en el mismo paquete que ya esta instalado. La decision se mantiene, pero por otro: Safari no
soporta Web Share Target, asi que el camino web no existe en iOS de todas formas. Si algun dia se
quiere compartir desde iOS, el camino barato es `expo-sharing`, no el web. El share sheet de
compartir **entra** igual en la app en iOS, porque `expo-sharing` lo soporta; lo que no se agrega
es ninguna pieza nueva.

**Readability.** Verificado por spike, con numeros: **sirve**. Un articulo de Wikipedia dio 7 781
palabras, The Guardian 947, The New Yorker 7 817. Una watch de YouTube dio `null`, que es
exactamente la respuesta correcta para un video. La reduccion al conjunto cerrado deja pasar
**99,8 % del texto** y el validador queda limpio. Las cifras de tamano, rendimiento y el detalle de
los paywalls estan en la seccion "El extractor" y en el ledger del spike.

Lo que queda abierto del spike: **ninguna SPA se probaron** (devuelven HTML vacio) y los paywalls
que si lo hacen de verdad respondieron 403/401. La eleccion entre `jsdom` y `linkedom` tambien esta
abierta con numeros a la vista.

## Como se verifica

Ademas de lo de cada fase:

- `npm run typecheck` sobre todos los workspaces.
- `npm run test`, que son los tests de la API. El guard de SSRF necesita los suyos, con IPs de
  loopback, privada y link-local en los fixtures: un guard que nunca se ha visto fallar no se sabe
  que funciona.
- **Share sheet de verdad en el emulador**, porque un share intent no se puede simular bien:
  `adb -s emulator-5554 shell am start -a android.intent.action.SEND -t text/plain --es
  android.intent.extra.TEXT "https://..."`. El share sheet del sistema es la unica forma de
  comprobar que OrbitHub aparece.
- Un caso que la web no tiene y que solo aparece en frio: **compartir con la app cerrada**, y
  **compartir con la app ya abierta**. Son dos entradas distintas y las dos tienen que abrir la
  hoja con el enlace.
- Un caso de sesion: **compartir sin estar autenticado**, y comprobar que el enlace sobrevive al
  login.
- Web, en claro y en oscuro, como manda `AGENTS.md`.

## Consecuencias

- La API gana una dependencia de parseo de HTML que no tenia. El motivo queda escrito arriba, que
  es lo que pide la regla 1 de `AGENTS.md`.
- El servidor ahora **busca URLs que le manda un cliente**. Eso es una responsabilidad permanente:
  el guard de SSRF va a necesitar mantenimiento cuando cambien los rangos que hay que rechazar, y
  va a necesitar un test cuando se agregue un redirect nuevo en el codigo.
- `bookmarks` y `collections` son dos entidades syncables mas en un motor que ya sincroniza seis.
  Los tres clientes --los de ahora y la web-- tienen que aprender a indexarlas.
- Los cuatro estados de extraccion son visibles para la persona, y esa es una decision de producto:
  la app va a decir "no pude leer esto" a veces. Es preferible a no decirlo nunca y a que un video
  parezca un fallo de la app.