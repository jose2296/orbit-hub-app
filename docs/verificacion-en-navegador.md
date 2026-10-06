# Verificación en un navegador real

Ningún bloque se commitea sin conducir la app de verdad. El typecheck dice que el código
compila y los tests dicen que las funciones puras hacen lo que dicen; ninguno de los dos
ha mirado nunca una pantalla. Esta es la parte del trabajo que se hace con las manos y
que ha encontrado más bugs que todo lo demás junto.

## Por qué

Tres veces el typecheck estaba en verde, los 287 tests pasaban, y la app estaba rota de una
forma que sólo se ve mirando: una tarea escrita a mano tumbaba la lista, un libro abría un
error rojo, y el `push` del servidor tiraba en silencio tres campos que el validador
aceptaba. Un script que conduce el navegador las encuentra en un minuto.

## Cómo

Dos servidores y un script de Node que habla con Chrome por CDP:

```bash
make -C apps/api dev     # API en el 4000; lee el .env al arrancar
make web                 # Expo en el 8081
node <script>.mjs        # conduce el navegador y falla si algo no encaja
```

El script hace cuatro cosas, siempre:

1. **Siembra datos por la API**, no por la interfaz: una cuenta nueva, un espacio, una
   lista y sus elementos, empujados con `POST /sync/push`. Sembrar por la interfaz
   probaría el interfaz de creación cada vez que lo que se quiere probar es otra cosa.
2. **Recorre la pantalla** pulsando por nombre de botón, no por coordenadas, y leyendo el
   texto que sale. El nombre de un botón incluye el glifo del icono, que es invisible al
   imprimirlo y hay que quitar antes de comparar.
3. **Mira lo que la API tiene de verdad**, no lo que la pantalla enseña. Un cambio que se
   ve en pantalla y no llega al servidor es la mitad de un bug.
4. **Falla si hay un error de consola, una excepción o una respuesta 4xx/5xx** en todo lo
   que ha hecho. Un `console.error` es un bug aunque la pantalla se vea bien.

## Las ocho trampas del arnés

Cada una costó tiempo. Están en `cdp.mjs`, que es el único sitio donde se conduce el
navegador: cualquier script nuevo importa de ahí en vez de copiar el código.

| Trampa | Qué pasa | Cómo está resuelto |
| --- | --- | --- |
| El icono de un botón es un glifo en el área de uso privado dentro de su texto | Al comparar nombres, "Añadir" no cuadra con "Añadir" | Se filtran los puntos de código por encima de `U+E000` antes de comparar |
| Un `Sheet` es un `Modal`: está en el documento y funciona, pero su texto no sale en `body.innerText` | Un panel abierto y funcionando se lee como pantalla vacía | Se busca el texto en los nodos hoja, no en el cuerpo |
| Un clic a unas coordenadas fuera de la ventana no hace nada | La tercera tarjeta de un carrusel está siempre fuera | `scrollIntoView` con `inline: center` antes de medir |
| Dos controles con el mismo nombre en pantalla | El clic va al de detrás, o al backdrop del panel, y cierra lo que había abierto | `find` prueba los candidatos en orden y se queda con el primero que sea realmente el de arriba en su centro |
| Si el servidor se reinicia, Chrome se queda con la página de error | Todo `localStorage` posterior lanza `SecurityError` y parece un bug de la app | `go` espera a que cargue la app y no a un tiempo fijo |
| La petición lleva `authorization` y `content-type`, así que el navegador manda un `OPTIONS` antes | Un `204` del preflight cuenta como "el servidor recibió el cambio" | Se filtra por **método**, no por URL. Un `204` de un preflight y un `204` de un push aplicado se leen igual en `Network.responseReceived`, y sólo uno de los dos significa que el servidor tiene el cambio |
| `lsof` no arranca cuando la máquina no tiene procesos para forkear | `execSync` lanza, un `catch` lo traga, la ruta del log sale vacía y `readLog` devuelve `""`: el guion acaba diciendo que la API no mandó el correo de verificación | `logOfTheApi()` reintenta y, si no hay ruta, **lo dice y para**. Y `readLog` no tiene `catch` que lo degrade a `""` |
| `Network.emulateNetworkConditions offline: true` también corta el bundle de la web | Cerrar y abrir la app deja la página en `chrome-error://chromewebdata/`, con el cartel de Chrome | Son **dos capas**: emulación para lo que pasa con la app abierta, y `Network.setBlockedURLs` sobre la API para cerrar y abrir. Se dice en la salida cuál es cuál en cada línea |

## Los bugs que encontró

| Bug | Síntoma | Por qué no lo veía el typecheck |
| --- | --- | --- |
| `dashboard` con el id literal `"dashboard"` | 422 en todo el push, el outbox no vaciaba y no se sincronizaba nada | El id es un `string` en el tipo |
| La validación del lote | Un solo elemento inválido tumbaba el push entero | — |
| `series` cayendo a `tasks` en el saneador del servidor | Una lista de series se convertía en lista de tareas | Dos listas de tipos en dos ficheros |
| `varchar(16)` para `movies_and_series` | Postgres se negaba en silencio a guardar la lista | La columna parecía bastante |
| `item.tags` de undefined | Escribir una tarea a mano tumbaba la lista | La fila se escribía a mano, sin el campo |
| El `create` del servidor tirando `icon`, `tags` y `orderMode` | Aceptados por el validador, descartados por el `insert` | Los campos se escribían uno a uno |
| Un libro sin ficha abriendo "Algo ha ido mal" | Un libro escrito a mano no se podía abrir | El detalle pedía el proveedor de la lista |
| Google Books puntuando sobre 5 como si fuera sobre 10 | Un libro con un 3 saliendo como "3.0/10" | La escala venía asumida |
| `<button>` dentro de `<button>` en la tarjeta del carrusel | HTML inválido | Válido para React, no para el navegador |
| Hooks detrás de un `return` temprano | "Rendered more hooks than during the previous render" | El typecheck lo acepta |
| El menú de una lista solo con pulsación larga | En web no hay forma de abrirlo | — |
| El icono de una fila y la fila con el mismo nombre | Dos controles iguales; el clic iba al equivocado | — |
| Una pantalla nueva sin `ListMenuSheet` | Un tablero no tenía **ninguna** puerta de exportar: 18 controles visibles y ninguno de exportación. El CSV era correcto y había que salir del tablero a pedirlo | La puerta de una acción vive en el componente que la monta, y el tablero no lo montaba. `list/[listId].tsx` redirige los tableros a `/board/:id`, así que en `/list/:id` el menú nunca se ve para uno |

## Lo que un script NO puede mirar

- Si las frases suenan bien. Eso es tuyo.
- Contraste y orden de tabulación con lector de pantalla de verdad.
- Con 300 elementos de verdad, con portadas que fallan al cargar.
- Dos personas editando la misma fila a la vez en dos navegadores.
- Un móvil de verdad. Todo se verifica a 430×932 en web, y el typecheck cubre nativo, pero
  nadie ha ejecutado un `expo run:ios` todavía.

Y dos cosas más que esta tarea se encontró, porque un guion se los pasó por alto:

- **Que el almacenamiento local sobreviva a cerrar la app de verdad.** En web "cerrar y abrir" es
  recargar la página y el almacenamiento es `localStorage`; en nativo es SQLite. Un recorrido que
  comprueba "el cambio sobrevive a recargar" no ha comprobado lo mismo que uno que lo comprueba en
  un teléfono.
- **Lo que un `204` significa.** Ni un empujón sin conexión ni una escritura aplicada se distinguen
  por el código, y sólo una de las dos significa que el servidor tiene el cambio. Un guion que
  cuente respuestas sin mirar el método se puede pasar por alto un preflight de CORS.

## Lo que el recorrido del tablero NO midió

Un guion de navegador que recorre una pantalla nueva deja huecos, y el peor no es el que no se
midió: es el que alguien da por medido porque el recorrido pasó en verde. Estos son los del
recorrido del tablero de la Task 15, con lo que hay y lo que no.

**1. El swipe corto y el extremo del carril.** El punto 2 del brief pedía tres cosas — swipe corto
no cambia, swipe largo cambia **una** columna, y en la última un swipe más no sale de rango. Lo
que hay:

- `apps/mobile/test/board-paging.test.ts`, **44 pruebas** de las que **19** son de `nextPageFor`, y
  las tres primeras del fichero (`it` de `:27`, `:33` y `:40`) son exactamente los tres casos del
  brief. La función pura está probada.
- `verify-state-editor.mjs` §20.6 (`:3557` el arrastre, `:3587-3593` la comprobación), **un** arrastre
  horizontal de −240 puntos, que comprueba que la pestaña avanza **una**:
  `pestanaDespues === (pestanaAntes + 1) % columnas.length`.

Lo que no hay, y por qué no se puede escribir todavía:

- **El swipe corto en el navegador.** El gesto pasa por `Gesture.Pan()` con `activeOffsetX([-14, 14])`,
  y **el `activeOffsetX` ya se ha comido 14 de los 20 puntos** antes de que `nextPageFor` vea nada.
  Que la función pura diga `nextPageFor(-20, -60, 4, 1) === 1` no dice que un arrastre de 20 puntos
  llegue a ser uno de 20.
- **El extremo.** Que `nextPageFor` recorte a la última es una prueba de una función. Que el scroller
  y `scrollTargetFor` no dejen la pista colgando **en el navegador, en el último estado** es otra
  cosa, y el comentario de `settle` (`board/[listId].tsx:1151-1182`) dice que ahí el navegador
  **recorta el `scrollTo` y no dispara evento**, con lo que `onScroll` no lo corrige.

**El protocolo de tres pasos** está escrito en `irA` (`board/[listId].tsx:910-925`), con sus números:
arrastrar la pista hasta que `scrollLeft` sea `maxScroll`; pulsar la pestaña del último estado; y
arrastrar veinte puntos. Medido en el navegador a 1440×900 con cinco estados: `offsets`
`[0, 283, 566, 849, 1132]` y `maxScroll` 283; cinco repeticiones dieron `scrollPrevio` escrito **283**
con el recorte y **1132** sin él, el rebase **0** contra **−849**, y `trackX` cargado **−1.5** contra
**−850.5**. **Empezando desde la primera columna el protocolo no ve nada con el bug vivo**, porque el
`scrollTo` de esa pestaña sí mueve el scroller y dispara 12 a 15 eventos antes de que llegue el dedo:
el orden de los tres pasos es el todo. Ese caso solo se midió a mano en la Task 9 y no se convirtió
en guion. Montarlo es trabajo de una tarea, no de una nota: hace falta una pista con `contenido >
cliente` **y** un tablero ya anclado en su extremo, y `verify-state-editor.mjs` solo monta la primera
—§20.2 lo comprueba y lo dice, `la pista tiene una columna fuera de pantalla` (`:3111-3114`), pero el
tablero abre en la primera columna y de ahi no se llega al estado en el que el bug se ve—.

**2. El punto de color de la pestaña y el filo de la tarjeta, en ningún tema.** El punto de la
pestaña lo pinta `board-tabs.tsx:323` (`iconColor(state.color)`) sobre el fondo del tema que escribe
la pastilla elegida (`:371-373`; el `:398` es el color del **texto** de esa pastilla, que es el del
fondo del tema, no el del relleno). **Ningún guion lee ese color**, ni en claro ni en oscuro: de una
pestaña solo se lee el número (`verify-state-editor.mjs:712`) y el `aria-selected`
(`verify-board-offline.mjs:372`), y el `aria-selected` es el estado, no el color.

El filo es el otro de los dos que el brief nombra, y tampoco lo lee nadie: `board-column.tsx:803` pasa
`edgeColor={iconColor(state.color)}` y `task-row.tsx:150-151` lo pinta como `borderLeftColor`, y
`borderLeftColor` **no aparece en ningún fichero de `scripts/`** —comprobado con grep sobre todo el
directorio—. Lo que se mide de la tarjeta en oscuro es la **elevación**
(`verify-state-editor.mjs:3649-3656`, los fotogramas con `shadow.floating`), que es otra cosa.

Es el detalle que el brief señalaba como el que más cambia en oscuro, y son los dos que nadie ha
mirado.

**3. El punto 1 en oscuro.** Que la primera pestaña esté activa y que los contadores cuadren con las
tarjetas de debajo está afirmado en `verify-board-offline.mjs:719-756`, **en claro** (`:709` afirma
`colorScheme: light` antes de aceptar nada). Lo que sí se repite en oscuro, con el tema afirmado, es
la **elevación** de la tarjeta (`verify-state-editor.mjs:3649-3656`, los fotogramas con
`shadow.floating`; **el filo de color no**, y por eso va en el punto 2 de arriba), el editor entero y
la pregunta del borrado.

**Lo que sí está medido en oscuro** es lo de `verify-state-editor.mjs` y `verify-state-picker.mjs`
(puntos 3 a 7), y lo de `verify-board-offline.mjs` y `verify-board-export.mjs` es de tema neutro por
diseño — un outbox, un `Content-Type` y una cabecera de CSV.

## Y lo que un guion NO puede decir de Android

Cualquier recorrido nativo que se escriba para una pantalla nueva deja estos huecos, y **conviene
escribirlos en el propio guion y en su salida**, porque un verde sin ellos insinúa más de lo que
mide:

- **El asa de selección nativa.** La tarjeta se levanta también en la web —es el `shadow` del tema—,
  así que una elevación medida en un navegador no dice nada del asa.
- **El teclado del sistema.** `adb input text` escribe sin que el teclado aparezca nunca, y no mide
  ni el `returnKeyType` ni el autofill ni que el teclado tape un botón con el panel abierto.
- **La mitad del pulgar de un gesto.** `input swipe` teletransporta el puntero con un número fijo de
  puntos y una duración fija: mueve de A a B y nada más.
- **El tirón para cerrar una hoja.** Lo anima el sistema operativo, no la app.
- **El outbox en SQLite**, que no es `localStorage` y que un recorrido offline en web no mide.

`scripts/verify-android-board.mjs` es un ejemplo de cómo dejarlo escrito: sale con **código 2** si
no hay dispositivo, con el texto de que no se ha ejecutado, y con la lista de lo que mediría y de lo
que no.
