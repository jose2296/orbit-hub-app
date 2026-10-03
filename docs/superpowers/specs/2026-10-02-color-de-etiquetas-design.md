# El color de una etiqueta: uno por lista, y deducido cuando nadie lo elige

Estado: implementado. El bloque correspondiente de `docs/roadmap.md` es el que
dice como ha quedado de verdad.

Una etiqueta es texto libre que se escribe en una tarea: "Mercadona", "Alcampo",
"casa". Hoy son una sola cadena de texto bajo el nombre, todas iguales. Este
documento dice que **cada etiqueta tiene un color**, que ese color es **el mismo en
toda la lista** —Mercadona en verde en las seis tareas que la tienen— y que **nadie
tiene que elegirlo**.

## Que se pide, exactamente

Una persona abre el panel de etiquetas de una tarea, toca "Mercadona", elige verde.
Las seis tareas de la lista que tienen "Mercadona" la muestran en verde a partir de
entonces, sin haber tocado ninguna. Si mas tarde la pone azul, las seis pasan a azul.

Y una etiqueta que nadie ha configurado **tiene color de todos modos**: uno que la
app deduce de su nombre. Escribir "Alcampo" y no tocar ningun color produce una
etiqueta con color, no una etiqueta sin color: el color se calcula siempre y no
hay ningun estado en el que falte.

Lo que **no** es cierto es que ese color sea el que se ve. El texto de la pastilla
se escribe con el color de la etiqueta solo cuando ese color llega a 4.5:1 sobre
el relleno de la pastilla, y si no se escribe en `theme.colors.text`: tres de los
doce pasan el umbral en claro y tres **distintos** en oscuro, asi que **nueve de
los doce se escriben en el color del tema** en uno u otro esquema, y ninguno se ve
de su color en los dos. Este documento se escribio antes de esa puerta; el
`roadmap.md` lo dice con sus numeros. Lo que no existe es una etiqueta sin color
elegido, que es otra cosa, y lo que hay es una etiqueta cuyo texto es gris.

Ese segundo punto es el que hace el trabajo mas facil, y por eso va primero: **el
color es obligatorio, elegirlo es opcional.**

## Por que el color se deduce y no se elige siempre

Porque un color tiene que ser **estable**, y "estable" aqui significa tres cosas a la
vez:

1. El mismo nombre da el mismo color **siempre**. Un `Math.random()` en el render haria
   que "Mercadona" fuera verde al mirar la lista y azul un minuto despues, y una lista
   donde los colores cambian sola no es una lista, es una animacion.
2. El mismo nombre da el mismo color **en todos los dispositivos**. Si el color se
   deduce en el telefono, la deduccion tiene que ser una funcion pura del nombre: dos
   personas mirando la misma lista tienen que ver la misma etiqueta del mismo color.
3. El mismo nombre da el mismo color **dentro de cada lista**, y solo dentro de ella.
   El color pertenece a la lista, no a la cuenta (ver "Donde vive" mas abajo).

Un hash del nombre cumple las tres: `hash("Mercadona") % 12` sobre la paleta es
determinista, puro y sin estado, asi que el caso por defecto no tiene nada que
sincronizar.

**Y por eso no hace falta migrar nada.** Las etiquetas que ya existen en las listas de
la gente empiezan a tener color en el momento en que se instala esto, sin backfill, sin
tarea de mantenimiento, y no cambian solas nunca. Un color elegido es lo unico que se
guarda.

## Donde vive

En la **lista**, ni en la tarea ni en la cuenta.

Se descarto lo otro por razones que se pueden ver:

- **Por tarea** (`tagColors` en cada elemento): dos tareas con "Mercadona" pueden
  tenerla de colores distintos, y entonces el color ya no significa nada —buscar "las
  tareas de Mercadona" deja de ser una pregunta—. Ademas obliga a escribir en todas
  las tareas que tienen la etiqueta para cambiar una, que es justo lo que no se quiere.
- **Por cuenta**: obliga a elegir un color la primera vez que se usa una palabra, y no
  es una decision que la persona que compra el pan tenga que tomar. Ademas el color
  pasaria de una lista a otra sin que nadie lo pidiera.

En la lista, "Mercadona" es una cosa con un color, y todas las tareas que la llevan la
muestran igual. Que es lo que se pidio.

## Como se guarda

Un campo nuevo: **`tagColors` en la lista**, un `jsonb` que va de la etiqueta a su
color.

```json
{ "Mercadona": "green", "Alcampo": "red" }
```

Solo se guardan los **elegidos**. Los deducidos no se guardan nunca: se calculan al
pintar. Asi que el campo esta vacio en la mayor parte de las listas, y crece solo con
las decisiones que alguien ha tomado de verdad.

Se eligio un `jsonb` en la tabla `lists` y no una tabla `list_tags` con entidad nueva
del sync, por tres razones que este repositorio ya ha pagado:

- `lists` **ya tiene** un `tags jsonb` y un `orderMode` con sus valores. La forma no es
  nueva.
- `list` **ya es** una entidad del sync. Una entidad nueva es una entrada nueva en el
  contrato, en el allowlist, en el servicio de sync, en el de consulta, en la cache del
  movil y en las pruebas, todo para guardar un mapa pequeno.
- Las listas se sincronizan enteras. Con un `jsonb`, cambiar un color es cambiar un
  campo de la lista, que es una operacion que ya sabe hacer.

**El coste, y es real:** el mapa entero viaja en una sola operacion, asi que si dos
personas cambian colores de etiquetas **a la vez**, una de las dos versiones enteras
sobrevive y la otra se pierde. Con una tabla por etiqueta cada color se sincronizaria
por su cuenta y no se pisarian. Se elige el `jsonb` porque las listas se comparten con
poca gente a la vez y porque la alternativa cuesta una entidad entera; si algun dia
molesta, la migracion es mover el mapa a filas, no rehacer la feature.

## Donde se toca, y el sitio del que hay que acordarse

Este es el mapa. La mayoria son lineas que ya existen y hay que volver a nombrar:

| Donde | Que |
| --- | --- |
| `packages/contracts/src/workspace.ts` | `tagColors` en los payloads de crear y de actualizar lista; el tipo del color reutiliza la paleta de iconos |
| `packages/contracts/src/item-icons.ts` | la paleta, que ya esta ahi, y la funcion que deduce el color de un nombre, para que servidor y cliente digan lo mismo |
| `apps/api/src/db/content-schema.ts` | la columna `tag_colors` en `lists` |
| `apps/api/drizzle/` | la migracion y su snapshot |
| **`apps/api/src/db/constants.ts`** | **el allowlist de `list`** |
| `apps/api/src/modules/lists/content-query-service.ts` | los caminos de lectura que devuelven una lista |
| `apps/api/src/modules/sync/sync-service.ts` | el `insert` y el `update` de listas |
| `apps/mobile/src/lib/lists/item-record.ts` | la lectura de la lista: la de defaults y la que la construye |
| `apps/mobile/src/hooks/use-lists.ts` | el estado del cliente |
| `apps/mobile/src/lib/lists/duplicate.ts` | duplicar una lista copia los colores |
| `apps/mobile/src/components/lists/item-edit-sheet.tsx` | la pagina de etiquetas: el control de color |
| `apps/mobile/src/app/(app)/list/[listId].tsx` | la fila: una pastilla por etiqueta |

### La linea que no se puede saltar

**`apps/api/src/db/constants.ts`, la lista `list`.** El comentario de las lineas 105-110
de ese fichero explica por que: un campo que esta en la tabla y en el contrato pero no
en ese allowlist **se pierde en silencio**. El push responde `applied`, sube la version,
y parece que funciono. Ya paso cuatro veces —`wash` y `colorTo` entre ellas— y la
version que lo conto fue la que le anadio los iconos a las tareas.

Ningun typecheck lo ve, porque los dos tipos son correctos. Por eso la prueba de API de
este trabajo no es opcional: es la que hace el `push` con un `tagColors` y comprueba que
**vuelve**.

## La paleta

Los doce colores que la app ya tiene para los iconos: `neutral`, `accent`, `green`,
`olive`, `amber`, `orange`, `red`, `rose`, `purple`, `blue`, `teal`, `brown`.

No se inventan colores nuevos: se usan los que la app ya sabe pintar, que es ademas lo
que pide `AGENTS.md` —los tokens son del tema, no de la pantalla.

**Consecuencia que hay que decir en voz alta:** con doce colores y una lista con seis
etiquetas, dos etiquetas van a salir del mismo color. Es lo que pasa al repartir doce
etiquetas en doce cubos sin repetir. Se acepta porque el color es una pista y no un
identificador —la identidad la sigue dando el texto— y porque quien quiera distinguirlas
elige el color a mano. Un hash que las repartiera sin repetir no es posible en general:
la proxima etiqueta nueva volveria a chocar con otra.

**El aviso que queda no es el que este documento puso aqui.** Aqui decia que
`amber` y `red` se parecen a los colores de urgencia (`warning` y `danger`) de la
insignia de prioridad, y que una etiqueta ambar al lado de una insignia alta se
leen las dos como "urgente". Con la puerta de contraste esa confusion no llega a
darse: `red` no pasa el umbral en ninguno de los dos esquemas, asi que su pastilla
no llega a verse roja, y `amber` solo se pinta en el oscuro, donde el `warning` es
un amarillo claro y no el ambar quemado del claro. Se retira por eso, no porque de
verdad no importara.

La que si se ha medido es otra, y va en `roadmap.md`: **`amber` y `orange` son
identicos a la vista en claro** y se distinguen en oscuro. Con doce colores y una
pastilla de 12 px eso es un problema real —no se pueden leer dos etiquetas que
difieren en un matiz que el ojo no separa—, asi que quien tenga las dos en la misma
lista las distingue eligiendo el color a mano.

## La pagina de etiquetas del panel

Hoy cada etiqueta de la tarea es una pastilla con una "x" que la quita, y debajo estan
las etiquetas que ya se usan en la lista con cuantas tareas las usan.

Cada etiqueta pasa a ser **una pastilla con su color**, con un boton de color al lado.
Tocar ese boton abre la tira de doce muestras —la misma que usa el selector de iconos—
debajo de esa etiqueta. Se elige una muestra y se escribe.

- **Una sola escritura, y es en la lista.** Un color de etiqueta no se escribe en la
  tarea: se escribe en `tagColors` de la lista. Por eso todas las tareas que la llevan
  cambian a la vez, y por eso la escritura es una en vez de una por tarea.
- **Las etiquetas de "usadas en esta lista"** llevan color tambien, y el mismo control.
  Es el unico sitio desde donde se configura una etiqueta sin tener esa tarea delante.
- **Una etiqueta nueva** se escribe y sale con su color deducido. Elegir el color es
  opcional y no bloquea nada: se puede anadir "Alcampo" y dejarla como ha salido.
- **La tira de muestras lleva una opcion de volver al deducido**, junto a las doce, y
  es lo unico que hace eso: quitar lo que elegiste y que la etiqueta vuelva al color que
  le toca por su nombre. No es "sin color", porque no hay estado sin color.

## La fila

Una pastilla por etiqueta, con su color, detras de la insignia de prioridad.

- **La insignia no se encoge ni se parte.** Es por lo que se puede ordenar una lista, y
  es lo primero de esa linea. Va delante y se queda entera.
- **Las pastillas se reparten en varias lineas** en vez de cortarse. El `roadmap.md` ya
  lo dice de otra forma: una etiqueta al lado del nombre es una etiqueta cortada por la
  mitad. Una pastilla a la mitad es peor que una linea mas.
- Las etiquetas se leen en el orden en que estan escritas, que es el orden en que las
  puso la persona.

## Lo que no se toca

- **Las etiquetas de las notas.** Las notas tienen etiquetas (`notes.tags`) y este
  trabajo no las cambia. Se piden para las tareas.
- **Las etiquetas de la propia lista** (`lists.tags`), que son otra cosa: son de la
  lista, no de sus tareas.
- **La exportacion.** Si el bundle acaba sacando los colores necesita la misma
  deduccion, y por eso la funcion va en `packages/contracts` y no en el movil. Que el
  export los saque o no es cosa de la feature de exportacion.

## Las pruebas

| Prueba | Que protege |
| --- | --- |
| el hash: misma entrada, misma salida | que "Mercadona" no cambie de color entre dos renders |
| el hash: solo devuelve colores de la paleta | que nadie pueda escribir un color que no existe |
| un color elegido gana al deducido, y la opcion de volver devuelve al deducido | las dos reglas de la seccion del principio |
| la lectura de la lista: defaults y parseo del campo nuevo | las dos funciones que tienen que estar de acuerdo |
| **API: un `push` con `tagColors` se aplica y se vuelve a leer** | **la perdida silenciosa del allowlist** |
| API: un color que no esta en la paleta **no se guarda**, y la etiqueta vuelve a su color deducido | que un mapa entero no se cae por una clave mala |
| navegador: las pastillas salen con su color | lo que se ve |
| navegador: cambiar un color cambia todas las filas que tienen la etiqueta | la promesse del principio |
| navegador: una lista no pinta los colores de otra | que el color es de la lista |

**Un color que no esta en la paleta no es un 422, se descarta.** El `push` valida
el sobre y no el contenido de cada operacion: los campos de una entidad los
`sanitisePayload` y ya. Un icono que la app no sabe dibujar no se rechaza tampoco, se
guarda como `null` —que es lo que hizo `apps/api/test/sync.test.ts`—. Aqui lo
equivalente es **dejar fuera la clave**: la etiqueta se queda sin color elegido, que es
exactamente el estado de "no hay color guardado", y por lo tanto vuelve al deducido. Un
`422` haria que una lista entera no se guardara por una clave mala, que es un castigo
que no le toca a nadie mas que a quien la escribio.

La del navegador no es un adorno: el typecheck y las pruebas unitarias pasan igual sobre
una lista que no pinta ninguna pastilla, porque un componente que devuelve `null` es un
componente correcto.

## Lo que no se ha comprobado

- **Nada en un telefono ni en un emulador.** En Android el ancho de una pastilla con
  texto y color no es el mismo que en el navegador, y el reparto en varias lineas es
  justo lo que mas depende del ancho. Se mira en el navegador y se dice que en nativo
  no.
- **El reparto del hash.** Que los doce colores sirvan para distinguir etiquetas depende
  de como se repartan en las listas de la gente, y no se ha medido con datos reales. Se
  ha mirado con las de las pruebas.