# El icono es un objeto, y es el mismo en todas las entidades

Estado: aprobado, sin implementar.

Hoy el icono existe en tres formatos distintos según la entidad que lo guarda. Un
espacio, una carpeta y una lista guardan `emoji varchar(16)`, que es texto plano. Un
elemento de tarea guarda **tres columnas**: `icon`, `iconStyle` e `iconColor`. Una
plantilla de nota guarda `icon varchar(40)`, texto libre y sin validar. Una nota
**no tiene columna de icono**. Nadie elige ninguno de ellos desde la app: no hay
selector de emoji en ninguna parte, y las columnas que existen se leen y se dibujan
pero no las escribe ninguna pantalla.

Ese es el problema que este documento arregla, y no es que falten campos: es que el
icono está **descompuesto en tres o cuatro columnas sueltas por entidad**, y por eso
cada cosa que lo consume —el renderer, el selector, el sanitizador del servidor, la
exportación— tiene que reconstruir el concepto a mano. Un `emoji` no es un icono, y
`iconStyle` no es una propiedad de un icono, es una propiedad de *una de* las
columnas en las que el icono está partido.

## Que se pide, exactamente

Una persona elige un icono para cualquier cosa que se pueda nombrar: un espacio, una
carpeta, una lista, una tarea, una nota. Y ese icono se ve igual en las tres
plataformas —navegador, Android, iOS—, se puede dibujar con color propio, y no depende
de en qué entidad esté puesto.

Son **cinco** entidades, no seis: las plantillas quedan fuera y el documento explica
por qué.

El catálogo tiene que ser grande. Los emojis son los del sistema operativo, los que
se ven en WhatsApp, no una lista de veinte; los iconos de línea y relleno son los de
Ionicons, que ya está instalado. Los dos se eligen en el mismo sitio, con pestañas.

Y lo que **no** se pide: que el trazo se pueda engrosar. Un icono de fuente tiene el
grosor horneado, y este documento no lo cambia.

## Las tres decisiones que el dueño tomó

Estas no son propuestas: son decisiones, y el plan las implementa como están.

### 1. Una columna `jsonb`, no cinco columnas

El icono se guarda como un objeto en una sola columna en cada entidad, en vez de
`icon_type` + `icon_value` + `icon_library` + `icon_style` + `icon_color`. Cinco
columnas por cinco entidades son veinticinco columnas, cinco backfills, y **el concepto
sigue descompuesto**: es el problema de hoy multiplicado por cinco. La única razón de
peso para hacerlo así sería poder consultar por icono ("todas las listas con icono de
libro"), y esa consulta no existe ni se pidió.

El precedente ya está en el repo: `tagColors` y `metadata` son `jsonb` con un
`sanitisePayload` escrito clave por clave.

### 2. El color es del icono, y es un token

Cada icono lleva su color, elegido por la persona, no heredado del espacio. Esto
compite visualmente con el sistema de color de los espacios, y es una tensión
consciente: un icono rojo dentro de un espacio azul se ve raro, y el dueño lo
prefiere así.

Lo que **no** es negociable es cómo se guarda. El color se guarda **como nombre de
token**, nunca como hex. Un `"#FF6B6B"` en la base de datos no tiene modo oscuro: se
dibuja igual de rojo sobre una superficie oscura y no hay forma de arreglarlo sin
migración. Se guarda `"rose"` y el renderer lo resuelve contra el tema en el momento
de pintar. Por eso los doce colores que hoy viven en
`apps/mobile/src/lib/lists/item-icons.ts` se mudan al tema en vez de quedarse donde
están.

El valor por defecto es `auto`, que hereda el color de la entidad. Elegir color es
opcional aunque el icono lo tenga.

### 3. Se migran los datos y se dropean las columnas viejas

Una migración convierte cada fila existente al formato nuevo y las columnas antiguas
se borran. No conviven los dos modelos, ni un día.

Esto es irreversible. Se acepta porque el modo alternativo —columna nueva y vieja en
paralelo— deja el modelo partido instalado en el schema para siempre, que es
exactamente lo que se vino a arreglar.

## La forma del objeto

```ts
const emojiIconSchema = z.object({
  type: z.literal("emoji"),
  value: z.string().min(1).max(12),   // "🍎"
  color: iconColorSchema.default("auto"),
});

const vectorIconSchema = z.object({
  type: z.literal("vector"),
  value: z.string().min(1).max(48),   // "heart"
  library: z.enum(["ionicons"]),
  style: z.enum(["outline", "fill"]).default("outline"),
  color: iconColorSchema.default("auto"),
});

export const iconSchema = z.discriminatedUnion("type", [emojiIconSchema, vectorIconSchema]);
```

**Unión discriminada, no objeto plano.** No es una cuestión de estilo: con un objeto
plano es perfectamente válido escribir `{ type: "emoji", library: "ionicons" }`, y
ningún consumidor sabe qué hacer con eso. Con la unión discriminada, `library` y
`style` **no existen** en un icono emoji porque no están en su forma. Es una clase
entera de bugs que no llega a existir.

La columna es nullable con default `null`. `null` significa "nadie eligió icono" y es
distinto de `{type: "vector", value: "folder-outline"}`: el primero se dibuja con el
respaldo que el consumidor pase, el segundo se dibuja.

## Dónde vive cada catálogo, y por qué no en el mismo sitio

| Dato | Dónde | Quién lo lee |
| --- | --- | --- |
| `IconRef` (el schema) | `packages/contracts/src/icons.ts` | API y móvil |
| `VECTOR_ICON_CATALOG` | `packages/contracts/src/icons.ts` | API valida, móvil dibuja |
| `EMOJI_CATALOG` | `apps/mobile/src/lib/icons/emoji-catalog.generated.ts` | solo móvil |

El índice de emojis sale de **`emojilib@4.0.3`**, no de `unicode-emoji-json`. Se comprobó
que `unicode-emoji-json@0.9.0` publica 1914 entradas con `name`, `slug`, `group`,
`emoji_version`, `unicode_version` y `skin_tone_support`, y **sin una sola palabra
clave**: un buscador sobre eso solo encuentra por nombre exacto, que es lo mismo que
no tener buscador. `emojilib` publica los mismos 1914 con 15412 palabras clave en
inglés, y además trae `😀` como clave en vez de `1f600`, que es lo que hace que el
catálogo generado sea legible.

El catálogo de vectores **sí** va en el paquete compartido porque el servidor tiene que
rechazar un `value` que no existe. Es el patrón de `ITEM_ICONS` —que hoy tiene 123
claves verificadas en diez grupos, no las 131 que dice el `roadmap.md`— extendido a un
catálogo de unos seiscientos.

El catálogo de emojis **no** va ahí. Es dato de presentación, no de dominio: son unos
1900 con nombre y palabras clave que el buscador necesita y que el servidor no usa
para nada. Mandarlo al proceso del API sería obligarlo a cargar algo que no lee. El
servidor solo valida que `value` sea texto plausible: entre uno y ocho puntos de
código, sin espacios.

## El catálogo de vectores: seiscientos de siete mil

Ionicons trae unos siete mil glifos y el plan expone unos **seiscientos**, curados y
agrupados. Seiscientos es un número que se eligió mirando la pregunta, no la
biblioteca, y es el número del que hay que dudar primero: si se quiere todo Ionicons,
el buscador pasa a ser obligatorio en vez de opcional y el catálogo pesa unos 120 KB
en el bundle de web. Añadir iconos después es escribir entradas en un array.

Cada entrada es clave, categoría y etiqueta. La clave es **la palabra que se escribe**
("pan", "pilas", "pastilla"), y no el nombre del glifo, porque el buscador tiene que
encontrar lo que se busca sin traducirlo a otro idioma. Esa decisión ya está tomada y
probada en los iconos de los elementos.

## Lo que NO se toca: los iconos del sistema

Hay 35 nombres de glifo escritos como `"document-text-outline"` en cinco sitios del
código. **No son iconos de usuario y este documento no los convierte en `IconRef`.**

Son el sistema de iconos de la propia app: el tipo de nota, el tipo de widget del
panel, el icono de la carpeta de destino, el botón de borrar. Meterlos en el mismo
modelo que un icono que alguien eligió es meter en el mismo campo dos cosas que no
son lo mismo, y daría permiso de elegir icono donde el nombre del tipo ya *es* el
icono.

Consecuencia que hay que decir: **`note_templates` no recibe icono de usuario.** Una
plantilla es un tipo, y el tipo ya tiene su glifo. Si algún día hace falta que alguien
le ponga icono a una plantilla, es otro documento.

Los 35, para que el plan los conozca y no los toque por accidente:

```
add-circle-outline   albums-outline         apps-outline          bookmark-outline
chatbox-outline      checkbox-outline       checkmark-circle      checkmark
code-slash-outline   code-slash             copy-outline          create-outline
document-outline     document-text-outline  documents-outline     download-outline
folder-open-outline  grid-outline           home                  image-outline
information-circle-outline                   list-outline          list
people-outline       person-outline         remove-outline        reorder-two-outline
search-outline       search                 settings              strikethrough-variant
text-outline         text                   trash-outline         tv-outline
```

Los sitios donde están escritos:

- `apps/api/src/modules/notes/built-in-templates.ts` (241 líneas)
- `apps/mobile/src/app/(app)/notes.tsx:95,102,142`
- `apps/mobile/src/components/dashboard/pin-picker.tsx:413`
- `apps/mobile/src/components/dashboard/panel-grid.tsx:1383,1390`
- `apps/mobile/src/components/folders/create-sheet.tsx:99-129`

## El renderer

Un componente, `apps/mobile/src/components/ui/app-icon.tsx`:

```tsx
<AppIcon icon={list.icon} size={18} />
```

Un emoji es `<AppText>` con el carácter. Funciona en las tres plataformas sin ninguna
dependencia, que es lo que hace que "los emojis del sistema" sea una función gratis y
no una librería. Un vector resuelve el set y el glifo.

`null` devuelve lo que el consumidor pase como respaldo, y **se respeta la decisión ya
tomada** de que un espacio sin emoji propio se dibuja con `folder-outline` y no con el
emoji `📁` (`roadmap.md:902`), y de que el emoji propio de una persona se conserva
porque es de la persona (`roadmap.md:1508`).

El color se resuelve **dentro** del renderer y nunca antes. `auto` toma el de la
entidad por prop; un token se busca en el tema contra el esquema activo.

## El selector

Un componente, `apps/mobile/src/components/ui/icon-picker-sheet.tsx`, usado por todas
las entidades. Pestañas `Emoji | Iconos`.

- **Emoji**: buscador con rebote sobre el índice precomputado, categorías,
  recientes. El buscador normaliza acentos y consulta una tabla de alias
  español→inglés; sin eso solo funciona en inglés.
- **Iconos**: buscador por clave, chips de categoría, cuadrícula, conmutador
  contorno/relleno y muestras de color.

`FlatList` en las dos pestañas. Las tres plataformas.

**No se usa `rn-expo-emoji-picker`.** La librería que se propuso al principio es solo
New Architecture y su motor por defecto es FlashList v2, que no tiene web. Este repo
tiene web como objetivo de primera clase y la app se usa en el navegador. Se descartó
por eso, no por calidad: su índice de emojis es bueno —esta fase toma los mismos datos
de `emojilib`, que es la fuente que esa librería usa— y lo que se descarta es el motor
de lista, que es justo la parte que rompe en web.

**Cero dependencias nuevas.** Los emojis ya se sabían dibujar con `Text`; lo que faltaba
era el índice para elegir, y eso no necesita un módulo nativo.

## Las cuatro fases

| Fase | Qué entra | Por qué en ese orden |
| --- | --- | --- |
| 1. Contrato y migración | `IconRef`, catálogos, columna `jsonb` en las cinco tablas, backfill, `SYNC_WRITABLE_FIELDS`, sanitizador | Sin esto nada más puede aterrizar. El backfill es el riesgo real |
| 2. `list_items` de punta a punta | `AppIcon` y el selector nuevo reemplazando el viejo | Única entidad que ya tiene selector: valida el selector y el renderer con reacción real antes de tocar cuatro más |
| 3. Las otras cuatro | espacios, carpetas, listas, notas | Incluye los flujos de emoji que hoy no existen |
| 4. Limpieza | columnas viejas, `item-icons.ts`, `ITEM_ICONS`, el `isItemIcon` duplicado de `item-presentation.ts:6-9` | El código muerto se borra con el código muerto |

Las tablas son `workspaces`, `folders`, `lists`, `list_items` y `notes`.
`note_templates` **no** entra: su `icon varchar(40)` sigue siendo el glifo del tipo,
como texto libre, sin cambio.

## La fase 1 es la que puede romper producción

El backfill tiene que convertir, en las cinco tablas:

- `workspaces` / `folders` / `lists`: `emoji` con contenido →
  `{ type: "emoji", value: "<lo que había>", color: "auto" }`
- `list_items`: `icon` + `iconStyle` + `iconColor` →
  `{ type: "vector", library: "ionicons", value: "<clave>", style: "<lo que había>", color: "<lo que había>" }`
- `null` o vacío → `null`

Si alguna fila no mapea, el sanitizador la tira y esa persona pierde su icono sin
aviso. Por eso la fase va sola, con pruebas, y la migración se escribe para que el
backfill se pueda correr en seco y contar cuántas filas quedan sin mapear **antes** de
aplicarla.

## Las tres trampas que ya pagaste una vez

El `roadmap.md` las tiene escritas, y las tres las vuelve a abrir este trabajo.

1. **Elegir un icono y después un color borraba el icono.** El selector mandaba el
   icono entero en cada cambio, y mandaba lo que creía que tenía la fila. Cada control
   tiene que mandar solo lo que cambia, y la pantalla guarda el **id** de la fila
   abierta, nunca una copia.
2. **El servidor rechazar la clave.** El proceso del API estaba en pie desde antes del
   contrato y rechazaba `icon: "pan"`; un `pull` borraba lo elegido. Mientras se toquen
   los contratos, el API necesita `watch`.
3. **Un campo que nadie copió a una lista.** `SYNC_WRITABLE_FIELDS`
   (`apps/api/src/db/constants.ts:109-150`) **descarta en silencio** lo que no esté en
   la lista blanca, y hay al menos cuatro sitios en el API donde un campo tiene que
   estar nombrado: `SYNC_WRITABLE_FIELDS`, el `sanitisePayload`, los campos del `create`
   y el `insert`. Un icono nuevo que no aparezca en los cuatro no existe, y no da error.

## Lo que este documento no dice

- **Las plantillas no llevan icono de usuario.** Ver arriba. Los cinco sitios donde hay
  nombres de glifo escritos siguen igual.
- **No hay lista de entidades visuales.** Espacios, carpetas, listas, notas y tareas
  llevan icono. Las personas, los dispositivos, los ajustes, el catálogo de películas y
  los tipos de widget **no**, y no porque no se pueda sino porque un icono elegido a
  mano sobre una fila de sistema confunde: el usuario lo toma por parte del sistema.
- **Películas, series y libros no son entidades.** No hay dominio multimedia y no lo
  añade este documento. Son `lists.kind` y sus elementos son elementos de lista con
  `metadata` del catálogo. El icono de una lista de películas es el icono de esa lista.
- **No hay color libre.** Doce tokens y `auto`. Cualquier hex es un tema aparte, con su
  puerta de contraste, y ya se entendió que ese es un problema de otro tamaño.
- **No hay grosor de trazo variable.** Ver arriba.
- **No hay iconos guardados como SVG.** Un SVG por icono es un componente, y un
  componente es un catálogo que hay que mantener a mano.
- **Las palabras clave de los emojis vienen en inglés.** `emojilib` las trae en
  inglés y no hay versión en español: buscar `book` devuelve 📖, buscar `libro` no
  devuelve nada. Por eso el buscador de la fase 1 hace **dos cosas** y las dos están
  decididas: normaliza acentos antes de comparar, para que `cafe` encuentre ☕, y lleva
  un **tabla de alias español→inglés** para las palabras del dominio —`libro`,
  `casa`, `corazón`, `perro`, `trabajo`, `estudio`, `música`, `cámara`, `auto`…—.
  Sin las dos, el buscador está en inglés dentro de una app que está en español, y
  eso es un fallo aunque no se note en una demostración.

  La tabla de alias es una decisión con fecha de revisión: es un archivo corto y
  escrito a mano, y las palabras que falten se descubren cuando alguien busca en
  español y no encuentra nada. No es un diccionario, y no se va a hacer uno.