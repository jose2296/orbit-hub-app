# Color libre en las etiquetas, y la fila que se abre desde la pastilla

Estado: por implementar.

 continuacion de `2026-10-02-color-de-etiquetas-design.md`, que ya esta
implementado. Este documento **cambia dos cosas** de lo que ese decidio y anade dos
mas:

1. El color de una etiqueta deja de ser uno de **doce** y pasa a ser **cualquier
   hex**. El contrato deja de ser un enum.
2. La pastilla deja de rendirse cuando el color no llega a 4.5:1 y **deriva** el
   texto para que siempre se lea. Con eso desaparece el "nueve de los doce se
   escriben en el color del tema" que era el precio de la version anterior.
3. En el formulario de etiqueta nueva hay un selector de color **debajo del input**,
   con los doce de atajo y color libre. El mismo selector edita el color de una
   etiqueta ya creada.
4. Pulsar la insignia de prioridad o una pastilla de la fila **abre la hoja de la
   tarea**, como el nombre.

## Que se pide, exactamente

Una persona escribe "Alcampo" en el campo de etiqueta nueva, baja, elige un color
libre de la tira —uno que no es ninguno de los doce— y pulsa anadir. La etiqueta
aparece en la tarea con ese color de fondo y con el texto en el mismo tono, y todas
las tareas de la lista que ya tuvieran "Alcampo" lo repintan al instante.

Y una persona que solo escribe el nombre y no toca ningun color obtiene una
etiqueta con color igual que antes, deducido del nombre. **Seguir sin elegir color
sigue siendo lo normal y no cuesta nada.**

## 1. El color pasa a ser un hex

### Lo que cambia

`packages/contracts/src/tag-colors.ts`:

- `tagColorSchema` deja de ser `z.enum(ITEM_ICON_COLORS)` y pasa a validar `#RRGGBB`.
- `sanitiseTagColors` sigue **descartando** lo que no cumple, y sigue sin fallar:
  el cambio es *que* descarta, no *si* descarta. Antes descartaba un color que no
  era de la paleta; ahora descarta uno que no es un hex. Un `tagColors` con
  `"no-es-un-color": "xyz"` se queda en `{}` en vez de dar 422.
- `derivedTagColor(nombre)` **no cambia**. Sigue siendo un FNV-1a del nombre dentro
  los doce, porque deducir y elegir son cosas distintas: lo deducido sale de la
  paleta porque es un color que la app escoge sola, y lo elegido sale de donde
  quiera la persona.

El **tipo** del color de etiqueta se separa del de los iconos del item. Hoy los dos
son `ItemIconColor` y a partir de aqui no pueden serlo: el icono sigue siendo uno de
doce, la etiqueta es un hex. `ItemIconColor` se queda como esta para los iconos y
aparece un `TagColor = string` para las etiquetas.

### Lo que no cambia

- La columna `lists.tagColors` es `jsonb` y sigue guardando un mapa
  `etiqueta -> hex`. Ni la migracion ni el tipo de la columna se tocan.
- La sanitizacion **sigue siendo en el servidor**, porque el cliente no es una
  frontera de seguridad. Un `tagColors` con basura sigue llegando limpio al resto
  de la app.
- La allowlist de `SYNC_WRITABLE_FIELDS` ya incluye `tagColors`.
- El mapa entero viaja en cada sync. **El coste sigue siendo el de antes**: dos
  personas que cambien colores de etiquetas a la vez, gana una. La spec anterior lo
  nombra como el precio de no anadir una entidad de sync, y esta decision no lo
  cambia.

## 2. La pastilla deriva el texto en vez de rendirse

### El problema que se resuelve

La version anterior hacia una puerta: si el color de la etiqueta llegaba a 4.5:1
sobre el relleno de la pastilla, el texto iba en ese color; si no, en
`theme.colors.text`. Medido: **nueve de los doce colores se escribian en el color
del tema** en uno u otro esquema, y ninguno se veia de su color en los dos. El
resultado era una lista de etiquetas donde casi todo era gris, y la insignia de
prioridad —que si tiene dos colores— decia que eso no era lo que se buscaba.

### Lo que se hace

`labelPillColors(hex, esquema)` en `apps/mobile/src/lib/lists/tag-colors.ts`
devuelve `{ relleno, texto }`:

- **relleno**: el color mezclado con la superficie al 12-15%. Un tinte, como
  `accentSoft`.
- **texto**: el mismo tono **oscurecido en claro y aclarado en oscuro**, en pasos
  pequenos, hasta que llega a 4.5:1 contra ese relleno.

El numero de mezcla y el paso los sale de la aritmetica, no de un ojo: el relleno
tiene que ser tal que el color oscurecido lo alcance, y el paso es lo mas fino que
no recorre el tinte entero para nada.

### Por que esto siempre converge

Oscurecer un tono acaba en negro y aclararlo acaba en blanco, y **negro sobre un
relleno claro siempre pasa y blanco sobre un relleno oscuro tambien**. No hay color
que se quede sin legible en ningun esquema. Ese es el motivo de que la puerta
desaparezca en vez de moverse: no hay caso al que volver.

### Lo que se ve

Un paso mas oscuro del color elegido, no el hex exacto. Es lo que hacen las
insignias de prioridad —`accentSoft` con `accentSoftText`, donde `softText` es
`#0E9F6E` hecho `#0A6B4C`— y es lo que se ha pedido: que la pastilla se lea como
una insignia. **El texto de la pastilla ya nunca sale en el color del tema**, que
era el final de la version anterior.

### La etiqueta deducida tambien pasa por aqui

Una etiqueta sin color elegido se dibuja con `derivedTagColor(nombre)`, y esa
pastilla **tambien** se deriva. No hay dos tipos de pastilla.

## 3. El selector de color

### Donde: dos montajes del mismo componente

**Un solo componente**, montado en dos sitios de la pagina de etiquetas:

1. **Debajo del input de etiqueta nueva**, siempre visible. Aqui todavia no hay
   etiqueta —no hay nombre, no hay nada en `tagColors`—, asi que el selector guarda
   un color **pendiente** en estado local y no escribe nada hasta que se pulsa
   anadir. Si se borra el nombre, el color pendiente se olvida con el: no hay
   etiqueta a la que pertenece.
2. **Donde esta hoy el `TagColorStrip`**, debajo de la pastilla de una etiqueta que
   la tarea ya lleva, abierto con el mismo boton de siempre. Aqui la etiqueta ya
   existe y el selector **escribe al momento**, como hoy.

Que sean el mismo componente es el punto: editar el color de "Mercadona" y elegir el
color de "Alcampo" se hacen **con lo mismo delante**, no con dos cosas parecidas que
se comportan distinto. Lo que cambia entre los dos montajes es solo cuando se
escribe, y por eso es una prop y no dos componentes.

### Que tiene

La forma del selector de color de un espacio, con un solo color:

- Los **doce** como atajos, con su nombre y el estado de "elegido" marcado.
- Tira de tono.
- Cuadro de saturacion.
- Campo para escribir un hex.
- Recientes.

La matematica sale de `apps/mobile/src/lib/workspace/picker.ts` —`HUE_STRIP`,
`hexToHsv`, `hsvToHex`, `puntoAHsv`, `puntoAHue`—, que ya esta suelta del selector
de espacios y es lo unico que se reutiliza tal cual. Lo nuevo es interfaz.

El hex se valida antes de aceptarse: seis digitos, con `#` o sin el. Un hex mal
escrito se rechaza en el campo y no se guarda, porque un color que no existe en
`tagColors` es un color que el servidor se come en silencio.

### Lo que se queda

El "volver al color deducido" se queda, y sigue significando lo mismo: quitar el
color elegido de una etiqueta y dejar que la app lo deduzca del nombre. Es la unica
manera de deshacer una eleccion sin saber el hex que habia.

### La escritura, y por que son dos

Elegir un color **y** anadir la etiqueta son **dos escrituras en dos entidades
distintas**, y por eso no se pisan:

- el nombre va en la **tarea** (`tags`), por la via que ya usa `save`;
- el color va en la **lista** (`tagColors`), por `setTagColor`.

`setTagColor` planifica desde el `list` que la hoja tiene en ese momento, y
`planTagColorChange` **copia** el mapa en vez de mutarlo, asi que escribir el color
no toca el `tags` de la tarea ni al reves. Es el mismo reparto que ya usa el resto
de la hoja, que escribe el item en un sitio y la lista en otro.

El color es **opcional** al anadir: si no se ha tocado el selector, la etiqueta sale
deducida y no se escribe nada en `tagColors`.

## 4. La fila se abre desde la pastilla y desde la insignia

### Que

Pulsar la insignia de prioridad o una pastilla de etiqueta **abre la hoja de la
tarea**, igual que pulsar el nombre. Un solo toque y las dos cosas que hay en la
fila llevan al mismo sitio.

### Como, y por que no con un envoltorio

Ni `TagChip` ni `Badge` se envuelven en un `Pressable`. Un envoltorio **cambia el
flex**: la pastilla se encoge (`flexShrink: 1`) y la insignia no (`flexShrink: 0`), y
las dos propiedades estan en el elemento que se envuelve, no en el envoltorio. Una
linea que se reparte en varias lineas de pastillas se romperia al meter un `View`
encima, y el reparto es justo lo que hay que conservar.

En vez de eso los dos aceptan un `onPress` **opcional** y se hacen pulsables por
dentro. Sin `onPress` no cambian ni un pixel, asi que los otros dieciseis sitios que
usan `Badge` —cabeceras, contadores, bandejas— no se enteran.

El `onPress` que se les pasa es el mismo `onEdit` que ya lleva el nombre.

### Lo que cambia de opinion

El comentario de la fila que dice que **la insignia aqui no es pulsable** queda
invertido, y por que lo decia: que el nombre de arriba abre la hoja y la hoja ya
trae la urgencia a la vista, y que una segunda puerta a lo mismo son dos maneras de
no estar de acuerdo sobre el valor. La razon sigue valiendo para el caso raro de
querer cambiar la urgencia desde la fila —que no se puede— y **no** para el caso de
abrir la tarea, que es lo que se ha pedido. La distincion es entre cambiar el valor
y mirar el valor.

## Que hay que actualizar al terminar

`docs/roadmap.md` dice hoy, con sus numeros, que **nueve de los doce** colores de
etiqueta se escriben en el color del tema por el contraste, y que el color elegido
es uno de doce. Este documento convierte las dos cosas. Su seccion de colores queda
**falsa** si no se reescribe, y el `roadmap.md` de este repo es la fuente de lo que
se dice que ha pasado de verdad, asi que actualizarla **es parte del trabajo**, no
una nota al pie. Tambien el `2026-10-02-color-de-etiquetas-design.md`, que sigue
describiendo la puerta de contraste: no se borra —es el historia de como se hizo—
pero necesita una linea al principio que diga que este documento lo cambia.

## Lo que no se pide

- **Que el color de una etiqueta cambie al de un icono.** Son paletas distintas y no
  se mezclan.
- **Un selector por etiqueta para varios colores a la vez.** Se elige uno.
- **Que la insignia de prioridad se pueda cambiar desde la fila.** Se abre la hoja.
- **Que el color elegido se pueda poner por tarea.** Es de la lista, y lo sigue siendo.

## Como se comprueba

`scripts/verify-tag-colors.mjs` crece, no se sustituye: sus 55 comprobaciones siguen
siendo 55. Se anaden las de este documento:

- **El texto de la pastilla nunca sale en el color del tema.** Medido sobre el DOM
  en claro y en oscuro, para al menos un color de cada uno de los doce deducidos y
  para al menos tres hex libres. Con el texto al del color del tema, esto falla.
- **El texto llega a 4.5:1 contra su relleno.** La misma cuenta, por pastilla. Si el
  color elegido es casi blanco en claro y casi negro en oscuro, y aun asi pasa, es
  porque la derivacion funciona y no porque no se miraba.
- **Un hex libre se guarda y sale.** Elegido en el selector, aparece en la pastilla
  de **todas** las tareas de la lista que tengan esa etiqueta, y sale de la base al
  recargar. Con el enum de doce, un hex libre se descartaba en el servidor y esto
  no podia pasar.
- **La pastilla y la insignia abren la hoja.** Un toque en cada una, y el titulo de
  la hoja es el de la tarea.
- **El servidor descarta lo que no es un color, y no falla.** `tagColors` con una
  clave y un valor que no son un hex sale de la sanitizacion como mapa vacio.
- **`derivedTagColor` no se ha movido.** El valor golden sigue siendo el mismo. Un
  cambio aqui seria otro cambio, no este.

Y en la suite, sin navegador:

- El hex mas largo del contrato entra y uno con cinco digitos no.
- `sanitiseTagColors` con un hex libre, con un enum viejo y con basura: tres casos.
- La derivacion converge para los doce deducidos en los dos esquemas, y para un
  blanco puro y un negro puro.

## El riesgo que se admite

La pagina de etiquetas de la hoja **va a crecer bastante**: las pastillas de la
tarea, el input, el selector completo y el boton de anadir. En un movil eso se sale
de la pantalla y la hoja es una `Modal` con scroll.

Lo mas probable es que funcione y quede apretado. **No se sabe hasta mirarlo**, y
por eso la primera vez que se abra la hoja con el selector desplegado hay que
mirarla en claro y en oscuro y decir si se puede leer. La palanca, si no se puede,
es que el selector salga en su propia pantalla en vez de debajo del input; el
cambio es pequeno y se hace despues de mirarlo, no antes.

Nada de esto se ha comprobado en un telefono ni en un emulador. Todas las medidas
que da este documento son de **web a 390x844**, y eso incluye la decision de donde
cabe el selector.