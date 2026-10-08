# ADR 0034 — Mención: un elemento de la app dentro de una nota, como chip

**Estado:** Propuesta

## Contexto

Una nota debe poder citar un elemento de la app (una lista de la compra, una carpeta, un espacio)
y que la cita sea un chip pulsable que lleva a ese elemento, como en Teams o Discord. El formato
de [ADR 0009](0009-one-native-editor.md) excluye `mention` a propósito: "nada en la app la
renderiza todavía". Esta decisión es el momento de cambiarlo.

`react-native-enriched-html` 1.1.1 trae soporte nativo, no solo web, y se verificó en el código
instalado:

- Disparadores configurables con `mentionIndicators`, eventos `onStartMention`,
  `onChangeMention`, `onEndMention`, y `startMention(indicator)` para abrir el flujo desde un botón.
- `setMention(indicator, text, attributes)` para cerrar la mención con un texto y atributos libres.
- `onMentionPress` en `EnrichedText` (lectura), con `{ text, indicator, attributes }`.
- Android (`EnrichedTextInputView.kt`, `EnrichedMentionSpan.kt`) e iOS (`MentionParams.mm`,
  `InputHtmlParser.mm`) la implementan.

La forma en que la librería **escribe** la mención en HTML es:

```html
<mention text="Lista de la compra" indicator="@" type="list" id="6f1c…">Lista de la compra</mention>
```

El texto visible es el contenido de la etiqueta; los atributos son los que se pasan a `setMention`.
Android **no escapa** las comillas en los atributos, así que el validador no puede fiarse de que
el texto de un atributo esté limpio.

## Decisión

`mention` entra en el formato con una forma cerrada:

- Atributos permitidos: `text`, `indicator`, `type`, `id`. Ningún otro.
- `indicator` solo `@`.
- `type` de un conjunto cerrado: `workspace`, `folder`, `list`, `note`, `bookmark`.
- `id` un UUID válido. El contenido es texto plano, sin etiquetas dentro.
- `text` opcional y como mucho 120 caracteres. El cliente quita las comillas del nombre antes de
  pasarlo a `setMention`, para que el documento que se guarda sea válido en el propio dispositivo.
- Una mención se valida como cualquier otro elemento: fuera del conjunto, se rechaza el documento
  entero. El validador sigue siendo la frontera de seguridad en móvil.

**El nombre que se ve no se guarda como verdad.** `text` es solo una copia para cuando no se puede
resolver el elemento. Al pintar, el chip busca `type` + `id` en la caché local y muestra el nombre
actual. Si el elemento no existe en la caché, o la persona no tiene acceso, el chip se pinta
apagado con "no disponible", y **no rompe la nota**. Un elemento que se renombra se ve con su
nombre nuevo en todas las notas que lo citan, sin reescribir ninguna.

**Disparadores.** Dos caminos que llegan al mismo selector:

1. Un botón `@` en la barra del editor, que llama a `startMention('@')`. Es el camino que funciona
   igual en Android, iOS y web, y el que se prueba primero.
2. Escribir `@`, que dispara `onStartMention`. Se activa solo si la prueba en el emulador confirma
   que el evento llega con el texto alrededor del cursor. Si no llega, el botón es el único camino
   y así queda documentado.

**Selector.** Un sheet con el buscador global filtrado a `workspace`, `folder`, `list`, `note` y
`bookmark`. Usa la búsqueda local, así que funciona sin conexión. Un tablero se cita como `list`,
porque es una lista con `kind: board`, y la ruta se resuelve con `routeForList`.

**Acción al pulsar.** `onMentionPress` navega con la misma función que ya usa la búsqueda global
(`rutaResultado`), para que una mención y un resultado de búsqueda lleven siempre al mismo sitio.

## Consecuencias

- El formato de notas cambia: un documento con `mention` es válido después de esta decisión y
  antes no lo era. Ningún documento existente contiene una mención, así que no hay migración de
  datos.
- Las notas con menciones necesitan un cliente que sepa pintarlas. Un cliente antiguo que
  recibe un `mention` lo ve como texto plano, sin perder el contenido.
- Mientras la caché no tiene un elemento (por ejemplo, un espacio que no se ha sincronizado todavía)
  el chip sale apagado en vez de desaparecer. Es una decisión a propósito: un enlace que no se ve
  es peor que uno que dice que no está disponible.
- Las menciones de una nota **no** crean vínculo de permiso: citar una lista no le da acceso a
  nadie. Quien no tiene acceso ve "no disponible".
- Colecciones quedan fuera. No hay pantalla de colección a la que enlazar. Entrarían como un tipo
  más cuando exista esa ruta.
