# Exportar el contenido: que sale, en que formato y quien lo construye

Estado: por implementar.

En `apps/mobile/src/app/(app)/settings.tsx` hay una fila que dice "Exportar mis
datos" desde antes de que existiera el boton. Su `onPress` esta vacio con un
comentario que dice que la exportacion llega con la API de la cuenta. Este
documento dice de que API habla y en que formato.

Hay dos cosas que se piden y que no son la misma: **una copia de todo lo tuyo**,
que vive en Ajustes, y **una lista concreta**, que vive en el menu de esa lista.
Las dos salen del mismo sitio y por eso no se pueden hacer en momentos distintos.

## Quien lo construye: el servidor

El servidor serializa y devuelve bytes. El cliente solo lo guarda.

La alternativa era serializar en el dispositivo desde la cache local de SQLite, y
es peor por una razon que no se ve hasta que pasa: **la cache no esta garantizada
completa**. El ADR 0003 dice que las escrituras son local-first, y eso quiere decir
que un movil que abrio la cuenta hace diez minutos puede tener solo una parte de
ella. Una copia de seguridad incompleta en silencio es peor que no tener copia,
porque parece que tienes una.

Aparte, `listItemsQuerySchema` limita a 200 items. Una lista de 300 que saliera
por la API paginada se truncaria sin avisar. La consulta de exportacion no
pagina, y eso es lo correcto.

La consecuencia practica es que **el servidor es el unico sitio donde "todos mis
contenidos" es verdad**, y por eso el export se construye alli.

Queda sobre la mesa la variante de hacerlo como trabajo en segundo plano con
enlace firmado, que es lo que pide `docs/roadmap.md` (Fase 9). Es la forma
correcta cuando el export incluya ficheros: un `.zip` con todas las imagenes de
las notas puede pesar cientos de megas y no cabe en una peticion sincrona. Aqui no
se hace, porque son unos pocos megas de texto, y porque la tabla de trabajos, el
sondeo, la pantalla de estado y la retencion son cuatro cosas que no se justifican
todas todavia. **El serializador queda aislado para que ese cambio sea de
transporte y no de logica.**

## Los endpoints

Dos, los dos con `require-auth` y los dos con descarga de fichero:

```
GET /account/export?format=json          -> todo lo tuyo
GET /lists/:listId/export?format=json|csv -> una lista y sus items
```

**Ninguno de los dos pasa por `sendData`.** Devuelven bytes con
`Content-Disposition`, no el sobre `{ data, meta }`. Es la primera respuesta de la
API que no lleva ese sobre, y `docs/architecture/api-conventions.md` afirma hoy
que "every 2xx response with a body goes through here". Hay que anadirle la
excepcion o el documento miente.

Cabeceras de la respuesta:

- `Content-Type`: `application/json; charset=utf-8` o `text/csv; charset=utf-8`.
- `Cache-Control: no-store`. Un export es una foto de un momento y no debe estar
  en ninguna cache.
- `Content-Disposition` con `filename` en ASCII y `filename*` con el nombre real
  en UTF-8 (RFC 5987), para que el fichero se llame bien en un movil y en un
  navegador a la vez.

El nombre del fichero es `orbit-hub-<slug>-<YYYY-MM-DD>.<ext>`, con el slug
sacado del titulo, limpio a 40 caracteres, y cayendo al id si el titulo no deja
nada. **El correo nunca va en el nombre**: un fichero que la gente se manda por
correo lleva la cuenta escrita en la etiqueta.

El servicio va en `apps/api/src/modules/export/export-service.ts`, siguiendo el
`modules/*/*-service.ts` que ya usan las rutas.

## El contrato

`packages/contracts/src/export.ts`, nuevo, exportado desde `index.ts`:

- `exportFormatSchema = z.enum(['json', 'csv'])`
- `accountExportQuerySchema` — **solo admite `format: 'json'`**. `?format=csv` en
  la cuenta devuelve 400. Ver "El CSV" para por que.
- `listExportQuerySchema` — admite los dos.
- `EXPORT_FORMAT_VERSION = 1`
- `accountExportSchema` y `listExportSchema`, con sus tipos inferidos.

El por que de que la cuenta solo admita JSON esta en la seccion del CSV, pero la
consecuencia de fondo es que la omision queda **explícita y comprobable** en vez
de ser un forgot: cuando el CSV de cuenta se quiera, el contrato se cambia a
proposito.

### El sobre JSON

```json
{
  "format": "orbit-hub.export",
  "version": 1,
  "exportedAt": "2026-10-02T18:04:11.000Z",
  "account": { "id": "…", "email": "…", "displayName": "…" },
  "counts": { "workspaces": 3, "lists": 12, "items": 481, "notes": 27, "attachments": 9 },
  "workspaces": [ … ],
  "folders":    [ … ],
  "lists":      [ … ],
  "items":      [ … ],
  "notes":      [ … ],
  "attachments":[ … ]
}
```

Cinco decisiones, y las cinco estan por lo que se rompe al cambiarlas:

**Arrays planas, no anidadas.** Un workspace no contiene sus carpetas, que
contienen sus listas. Cada registro lleva su `workspaceId` / `folderId` /
`listId` y el arbol se reconstruye. Anidar hace que un fichero truncado sea
ilegible de principio a fin; plano, un export a medias todavia se puede importar.

**Cada registro es la forma del contrato, no un subconjunto pensado para
exportar.** `id`, `version`, `createdAt`, `updatedAt`, `deletedAt` y `role` van
dentro. Eso es lo que hace la copia sin perdida, y lo que hara que la
importacion del futuro funcione sin tocar el esquema.

**`deletedAt` se exporta.** Lo que borraste sigue siendo un dato. Sin el, un
restore devuelve basura que tu quitaste y no hay forma de saber que es basura.

**`metadata` se copia entero, sin aplanar.** Es `Record<string, unknown>` y
guarda el `imageUrl`, el `year`, el `releaseDate` y el `provider`. Aplanarlo es lo
que hacen las columnas del CSV, pero normalizarlo en el JSON perderia cualquier
campo que TMDB o Google Books anadan manana, y un backup que pierde campos que no
conoce todavia no es un backup.

**`counts` va arriba del todo.** Una copia de la que no sabes si esta entera es
una copia en la que no puedes confiar. Ademas es lo que permite detectar un
export a medias antes de confiar en el.

### El JSON de una lista

El mismo sobre, reducido a una lista, mas el sitio de donde viene para que el
fichero se lea suelto sin el resto de la cuenta al lado:

```json
{
  "format": "orbit-hub.export",
  "version": 1,
  "exportedAt": "2026-10-02T18:04:11.000Z",
  "account": { "id": "…", "email": "…" },
  "workspace": { "id": "…", "name": "…" },
  "folder": { "id": "…", "name": "…" },
  "list": { … la fila de `lists`, entera … },
  "items": [ … ],
  "counts": { "items": 481 }
}
```

`folder` es `null` cuando la lista cuelga directamente del espacio. `workspace` y
`folder` son solo `id` y `name`: es contexto para leer el fichero, no una copia
del espacio, y el mismo razonamiento que deja fuera las notas aplica aqui — una
lista no tiene notas, las notas cuelgan del espacio.

### Que entra y que no

Entra todo lo alcanzable desde los espacios donde el usuario es miembro, con
`role` intacto. Lo que le compartieron va marcado como compartido, y un
importador futuro no se adjudica la autoria de algo que no es suyo.

**Los adjuntos entran como metadatos, no como ficheros.** `exportedAttachmentSchema`
es `{ id, noteId, fileName, mimeType, sizeBytes, width, height, createdAt }` y
**no lleva `storageKey`**: es una clave interna del servidor, en una copia de
seguridad es ruido y en un fichero que la gente se manda por correo es una fuga.
Lo unico que un importador necesita de verdad es `fileName`, `mimeType` y
`sizeBytes` para comprobar que la vuelta cuadra; los bytes se vuelven a subir.

**Las plantillas de nota que creaste el usuario tambien entran.** Esta es la
decision menos obvia del documento y va escrita para poder tacharla: una tabla
mas, un array mas, y una copia de seguridad que pierde las plantillas que
alguien escribio a mano es un agujero. Si se decide que no, sale `templates` del
sobre, del contrato y de la consulta, y punto.

**No entra el directorio de personas** (los follows de `people_follows`). No es
contenido, es un grafo social, y volver a seguir a alguien que ya seguias es una
pulsacion.

## El CSV

**Un fichero por lista.** Una hoja de calculo es una tabla, y una tabla con
columnas de peliculas y de libros mezcladas es peor que dos ficheros.

**La copia de cuenta completa no se ofrece en CSV.** El boton de Ajustes exporta
JSON y punto. Un CSV de cuenta seria una tabla union con `kind` como discriminante,
y en Sheets eso es peor que las tres hojas separadas que salen de un `.zip` — y
el `.zip` no se esta haciendo. Por eso `accountExportQuerySchema` no admite csv:
para que la decision sea del contrato y no un descuido del que se acuerde al
topear el fichero.

Columnas: `id`, `titulo`, `tipo`, `completado`, `prioridad`, `tags`, `posicion`,
`anotacion`, `year`, `release_date`, `image_url`, `provider`, `external_id`,
`created_at`, `updated_at`.

`year`, `release_date`, `image_url` y `provider` salen de `metadata`, que **no
esta tipado**: se leen comprobando el tipo y si no estan, la celda va vacia. Una
celda vacia es un dato honesto; la cadena `undefined` en un CSV no lo es.

Detalles que deciden si el fichero sirve:

- **Delimitador `;`, no `,`.** Excel en espanol abre un CSV con comas y mete la
  fila entera en una columna. Con `;` funciona en los dos. Por eso las etiquetas
  dentro de una celda van unidas con `|`.
- **UTF-8 con BOM.** Sin BOM, Excel abre `El nino` como `El niÃ±o`.
- **CRLF y comillas siempre**, segun RFC 4180. La `anotacion` es texto libre y
  puede traer saltos de linea; con comillas y CRLF eso viaja bien.

El JSON y el CSV salen de **los mismos registros**: un constructor, dos
escritores. Un fallo en el JSON se ve en el CSV, y no hay dos definiciones de que
es una lista que se puedan desincronizar.

## Sacar bytes de la API en el cliente

`apiRequest` acaba siempre en `JSON.parse` (`apps/mobile/src/lib/api/client.ts`,
la linea que castea el payload), asi que un CSV no puede pasar por ahi. Se anade
**`apiRaw(path, options) → Promise<Response>`** en ese mismo fichero.

No es un cliente nuevo: **es el mismo con otra forma de terminar.** Se saca la
parte comun —la URL, la cabecera `Authorization`, el timeout, el refresh de 401
con reintento— a un nucleo del que los dos caminos dependen, para que ese
comportamiento no pueda separarse en dos versiones que seportan distinto.

La peticion de export va con `timeoutMs` explicito y mayor que
`DEFAULT_TIMEOUT_MS`, porque la respuesta puede ser de varios megas y el valor por
defecto esta puesto para JSON pequeno.

## Entregar el fichero en las tres plataformas

**Web**: `response.blob()` → `URL.createObjectURL` → `<a download>` →
`revokeObjectURL`. Es lo que ya hace `apps/mobile/src/lib/notes/image-store.ts`.
Lo que **si** es nuevo es el `revokeObjectURL`: `image-store` guarda las URLs en
un mapa porque las reutiliza para pintar imagenes, pero una descarga se usa una
vez, y sin liberarla se fuga una por cada export que se haga.

**Nativo**: `expo-file-system` con `File.downloadFileAsync` al directorio de
cache, y de ahi `expo-sharing` a la hoja de compartir del sistema (Archivos,
Drive, AirDrop, correo).

### Por que se anade `expo-sharing`

No esta instalado y hay que anadirlo, y AGENTS.md pide una razon documentada.

**Es el unico camino que existe para que el fichero llegue a un sitio del
usuario.** Sin el, lo unico que se puede hacer con `expo-file-system` es escribir
en el sandbox de la app, donde el usuario no llega; y `Linking.openURL('file://')`
en iOS abre una vista previa del fichero, no un "guardar en". No hay alternativa
de API a las dos cosas: guardar en Archivos es compartirlo.

No es una libreria de una sola plataforma —es un modulo de Expo—, asi que no choca
con la regla de la app universal. El **fallback web** es el `blob` de arriba, y la
comprobacion `Platform.OS === 'web'` va **antes** de tocar nada nativo, igual que
en `image-store.ts`: en web, `expo-sharing` no se importa ni se menciona.

`expo-print` no hace falta, y `writeAsStringAsync` tampoco: el fichero llega
descargado, no se escribe a mano.

## Donde se toca

**Ajustes** (`apps/mobile/src/app/(app)/settings.tsx`): el `onPress` vacio deja de
estarlo. Pulsar exporta la cuenta entera. **No hay hoja de eleccion de formato**,
porque el formato ya esta decidido, **ni confirmacion**, porque el subtitulo de
la fila ya dice "Descarga una copia de todo tu contenido". La fila muestra estado
de trabajo mientras corre y, al terminar, una hoja con los `counts` y donde ha
caido el fichero. Eso ultimo es lo que hace que el numero de cosas exportadas sea
algo comprobable y no una promesa.

**Menu de lista** (`apps/mobile/src/components/lists/list-menu-sheet.tsx`): una
pagina nueva, `export`, en el `type Page` de siempre, **antes de `delete`** —que va
ultimo por la regla que el propio comentario de cabecera del fichero enuncia—, que
ofrece CSV y JSON. Es una **sub-pagina de la misma hoja**, no una hoja encima, por
lo que ese comentario ya explica: dos fondos superpuestos son un tap que cierra lo
que hay debajo en vez de lo que se pidio.

Los dos sitios usan `Sheet` de `components/ui/sheet.tsx`, que ya tiene el
`useLastValue` que evita que la hoja desaparezca en el frame de la Dismiss.

## Permisos y errores

La autorizacion es del servidor. AGENTS.md regla 8: el cliente no es una frontera
de seguridad.

- Los dos endpoints llevan `require-auth`.
- El de lista **comprueba la pertenencia al espacio de esa lista antes de
  serializar**. Nunca se confia en un `listId` solo porque viene en la URL.

| Situacion | Respuesta |
| --------- | --------- |
| `format` que no existe | 400, `invalid_format` |
| No eres miembro del espacio de la lista | 403 |
| La lista no existe | 404 |
| Token caducado | 401 y el refresh con reintento que ya hace el cliente |
| Red o timeout | Los `ApiError` de siempre, marcados como reintentables en la hoja |

## Las pruebas

Los dos Vitest que ya hay, sin harness nuevo.

**`apps/api/test/export.test.ts`**

- La forma del sobre: `format`, `version`, `account`, y `counts` cuadrando con la
  longitud de cada array.
- Que `deletedAt` sobreviva en un registro borrado suavemente.
- Que `metadata` salga intacto, con un valor que no es de los conocidos.
- Que `storageKey` **no** aparezca en ningun adjunto. Es la unica asercion que
  protege una fuga.
- CSV de una lista de tareas y CSV de una de peliculas: cabecera, y el `year`
  saliendo de `metadata`; con `metadata` vacio la celda va vacia, no `undefined`.
- `?format=csv` contra la cuenta devuelve 400.
- Otro usuario contra una lista que no es suya recibe 403.

**`apps/mobile/test/export-file.test.ts`**

- El nombre del fichero: acentos, un titulo que se limpia a nada cae al id, y el
  tope de 40 caracteres.

Los controladores no llevan prueba porque el harness de movil es solo `.ts`, sin
pruebas de componentes (`apps/mobile/vitest.config.ts`). Es un hueco que ya
existe y que aqui no se abre.

Las claves de traduccion nuevas van en los dos diccionarios y `translations.test.ts`
ya comprueba que es y en tienen exactamente las mismas, asi que la paridad sale
gratis.

## Antes de darlo por bueno

AGENTS.md: una interfaz se abre en un navegador y se recorre en claro y en oscuro.
Web es el unico objetivo que se comprueba a mano aqui.

El editor de notas es el ejemplo de por que. Rechazo todas las imagenes, le paso
referencias sin resolver al editor y dibujo un `+` que se iba al hacer scroll, y
las tres cosas se encontraron en un navegador en el tiempo que habria tardado en
arrancar un emulador.

Lo que un navegador **no** puede decir es un selector nativo o un teclado del
sistema, y la hoja de compartir de iOS es justo eso. Esa parte se queda sin
verificar hasta que alguien la ejecute en un dispositivo, y el spec lo dice en vez
de dejar que se suppose.

## Lo que no se decide aqui

- **La importacion.** Es el siguiente paso y este sobre esta disenado para ella:
  plano, sin perdida, versionado. Los ids se conservan tal cual, y decidir si la
  importacion **fusiona por id** (mismo id, se actualiza) o **crea ids nuevos**
  (todo se duplica) es una pregunta de producto que no tiene respuesta correcta
  para todo el mundo y por tanto necesita su propia conversacion.
- **El `.zip` con los ficheros de los adjuntos**, y con el el trabajo en segundo
  plano. El serializador ya queda aislado para que sea un cambio de transporte.
- **El CSV de la cuenta completa**, que necesita un contenedor con varias hojas.
  El contrato lo rechaza hoy a proposito en vez de por olvido.
- **Exportar desde el centro de sincronizacion** o programarlo. No se ha pedido.
