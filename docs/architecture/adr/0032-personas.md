# Personas: un directorio de con quien ya has tratado, y nunca una busqueda de cuentas

Estado: decidido. Sin implementacion.

## Que se queria

Compartir facil, y no por correo. Escribir la direccion de alguien que ya tienes en
la pantalla es el trabajo completo de compartir, y el trabajo no es escribir la
direccion: es encontrar a la persona. Compartir una nota con tu pareja, con tu
hermano o con el del despacho de al lado tiene que ser dos toques, no un formulario.

No se quiere chat. No se quiere actividad. No se quiere una red. Se quiere que el
selector de compartir sepa a quien ya conoces.

## Lo que ya habia, y por que esto es mas barato de lo que parece

El backend ya sabe compartir con una persona concreta. `createShareRequestSchema`
acepta `granteeUserId` junto a `granteeEmail` (`workspace.ts:801-809`), y
`resolveGrantee` ya resuelve por id (`routes/shares.ts:171-186`). Lo que no existe
es un UI que lo use: `ShareNodeForm` manda siempre `granteeEmail`.

O sea que la parte dificil del backend estaba hecha y sin usar. Esto no es una
feature nueva, es un selector que todavia no existe.

## Que es una persona aqui

Un **directorio**, no una amistad.

Una amistad necesita que alguien acepte, y aceptar necesita que alguien se entere.
Y en este repo **no hay notificaciones**: cero tablas, cero contratos, solo correo
(`grep` sobre `apps/api/src/db` y `packages/contracts/src` no devuelve nada). Una
solicitud de amistad sin bandeja dentro de la app es una solicitud que nadie ve, y
una solicitud que nadie ve es una solicitud muerta.

Un directorio no necesita que nadie acepte nada. Se deriva de relaciones que ya
existen, asi que no hay tabla nueva, no hay migracion, y no hay nada que se pueda
quedar a medias.

La decision no cierra la puerta a las amistades: el picker consume una lista
ordenada de candidatos, y hoy esa lista sale de `shares`. Cuando el dia que quiera
que las amistades existan, se anteponen a esa lista y el resto no cambia. Lo que se
decide aqui es que hoy no existen.

## El directorio no es una busqueda de cuentas

Esta es la parte que no es obvia y la que un dia alguien va a querer romper.

La lista sale de relaciones en las que ya estas:

1. `shares` donde eres `owner_user_id` — con quien compartiste.
2. `shares` donde eres `grantee_user_id` — quien te compartio.
3. `memberships` — quien comparte espacio contigo.
4. `people_follows` — a quien sigues.

Mostrar el nombre y el correo de esa gente **no filtra nada**, porque ya hiciste una
operacion con ellos. Si compartiste una lista con Marta ya sabes como se llama y
que correo tiene; volver a preguntarselo no revela nada nuevo.

Por lo mismo **no hay `GET /people/:id`**. A alguien con el que no tienes relacion
no se le consulta. Si puedes consultarle es porque ya tienes una relacion, y si la
tienes no necesitas consultarle.

## Se puede buscar en `users`, pero por una sola pregunta

`GET /people/search` **si** lee `users`. Esta seccion contradice el borrador de este
ADR y esta aqui para que se note.

El borrador decia que buscar globalmente rompe la proteccion razonada en
`routes/shares.ts`: el mismo 404 para "no existe" y "existe pero no es tuyo" es lo
que impide enumerar quien tiene cuenta. Ese argumento **esta a medias y era
incorrecto**: la proteccion no existe ahi. `resolveGrantee` (`shares.ts:171-199`)
devuelve `404 There is nobody with that address` para un correo sin cuenta y `201`
para uno con cuenta, y lleva asi desde antes de este ADR. Es decir: **compartir con
alguien por correo ya responde si esa persona tiene cuenta.** Buscar no introduce
una fuga que no estuviera antes, solo la vuelve comoda de usar y predecible.

Lo que si hace el buscador es lo que hay que seguir limitando:

- **Minimo tres letras.** Con una o dos se responde por montones de gente y la
  respuesta es "esta cuenta existe" para casi todas las letras de un alfabeto.
- **Diez resultados como mucho**, y nunca "todos los que coinciden".
- **Nunca lista a la gente completa.** Una ruta que devuelve el directorio entero no
  es un buscador, es un volcado.
- **Quien ya esta en tu directorio no sale**, porque buscar a Marta para volver a
  anadirla solo produce el mismo Marta de siempre.
- **Ni tu mismo, ni cuentas borradas o suspendidas.**

Y un limite que no es de privacidad sino de honestidad: **no se puede comprobar
que la cuenta exista y a la vez no poder comprobarlo.** Si el buscador calla ante
un correo sin cuenta, es indistinguishable de un fallo de red, y la app dira "no se
pudo anadir" a alguien que si existe. Se responde con lo que hay —solo 1 a 10
coincidencias— y el error se dice como error.

### Por que `people_follows` y no una amistad

Se llama seguir y se comporta como seguir a gente, a proposito. **No hay aceptacion**,
y no es un recorte: una solicitud de amistad es un mensaje que alguien tiene que
poder ver, y aqui no hay bandeja dentro de la app —el correo es el canal— asi que
una solicitud seria una peticion que nadie llega a leer. Un boton "amigo" que exige
un "aceptar" que no existe en ninguna parte de la interfaz es peor que no
tener boton.

La tabla es `people_follows (follower_user_id, followee_user_id)`, con indice unico
en la pareja y un CHECK de que no te sigues a ti mismo. **Seguir dos veces es la
misma cosa que seguir una** y devuelve `200`, no un error: un boton que ya dice
"dejar de seguir" no debería poder producir un `409`.

Y es de una sola direccion. Que alguien te siga a ti no cambia nada en tu pantalla
y no te dice nada.

## El texto libre se queda

El picker **no reemplaza** el campo de correo, lo precede. Si escribes algo y no
hay coincidencia, se manda `granteeEmail` exactamente como hoy.

Eso no es un detalle de compatibildad, es la salida. El directorio solo conoce a la
gente con la que ya has tratado; a un colega nuevo, a un vecino, a la persona que te
ha mandado el enlace por el grupo de la familia, se le sigue llegando por correo. Un
selector que solo ofrece conocidos y no ofrece escribir un correo es un selector
que no deja compartir con medio mundo.

## Quien puede compartir: solo la duena, y no era solo la duena

`canShare` (`apps/api/src/modules/shares/access.ts`) era `owner || editor`. **Ya no es
`editor`, y el motivo no es teoria.**

Las tablas de contenido —`workspaces`, `folders`, `lists`, `list_items`, `notes`— **no
tienen `owner_id`**. La pertenencia *es* la propiedad: todo lo que hay dentro de un
espacio es de quien lo posee. Un editor es miembro del espacio de otro.

Con `editor` dentro, esto pasaba y contestaba `201`:

1. Ana invita a Beto al espacio como `editor`. Es la manera normal de trabajar juntos.
2. Beto comparte **la nota de Ana** con Elena.
3. Elena ya lee la nota de Ana.
4. Ana —la autora y la duena del espacio— recibe `403` al revocarlo, porque
   `canRevoke` pregunta **quien lo compartio** y la respuesta es Beto.

Solo Beto podia deshacerlo, y Beto se puede ir. La regla estaba escrita en el propio
`access.ts` ("un invitado puede editar una lista con cincuenta cosas y no puede
decidir que un sexto la vea") y **no se cumplia para el editor**, solo para el
invitado. El cliente tampoco ayudaba: los tres menus —nota, carpeta y lista— ofrecían
"Con quién" con `role === "owner" || role === "editor"`, y el de la lista tenía el
comentario correcto pegado encima del codigo que hacia justo lo contrario.

**El permiso para pasar algo adelante es el permiso para decir quien mas lo ve, y ese
es del dueño de la cosa.** Editar va de las cosas.

El coste, dicho porque es real: un editor que escribe **su propia** nota dentro del
espacio de otro ya no puede compartirla. Cerrarlo bien pide un `owner_id` en esas
cuatro tablas —una migracion y un cambio en la proyeccion de sync— y hasta entonces
esto es un agujero cerrado a cambio de un caso que no se soporta. El agujero era mas
caro de los dos.

### El mensaje de error tambien se divide

Antes los dos casos —no ser miembro, y ser miembro sin ser dueno— recibian la misma
frase, "You cannot share something from a space you do not belong to", que le decia a
un editor que no pertenecia a un espacio al que acababa de ser invitado. Ahora cada
uno dice lo suyo, y el segundo menciona al dueno.

## Donde se guarda lo recibido: solo en un espacio que sea tuyo

`placeShare` pregunta si eres **miembro** del espacio, y dice que no con
*"You can only file it in one of your own spaces"*. Correcto. Lo que estaba mal era
**quien le ofrecia los espacios**.

El panel de "donde lo pongo" listaba `spaces()` del arbol de espacios, que es la cache
de sync — y la cache tambien trae los espacios que ves **porque te compartieron algo
dentro**, que no son tuyos. Asi que ofrecia filas que solo podia fallar.

Y para quien recibe su **primera** cosa, fallaba siempre: no tiene ningun espacio
propio, la cache tiene exactamente uno, el del que te compartio, y es la unica fila
del selector. Una opcion, nunca funcionaba, y nada de lo que se veia decia por que.

La regla es `shared === false`, no el rol: un `viewer` **invitado** a un espacio y un
`viewer` al que le **dieron una lista** dentro son el mismo rol y no lo mismo, y solo el
segundo es `shared`. El menu lateral ya dibuja con esa bandera, asi que es una regla
usada dos veces y no dos reglas.

Esta en `apps/mobile/src/lib/shares/fileable-spaces.ts`, **fuera** de la hoja, y no por
orden: es lo unico de la hoja que se puede comprobar sin renderizar React Native, y
renderizar React Native no pasa en el entorno de pruebas. La regla estuvo mal una vez y
estuvo mal de una forma que un test habria cogido.

### Y cuando no tienes ningun espacio propio

El panel no puede quedarse mudo con una lista vacia y un boton que no se enciende.
Dice lo que pasa y ofrece el camino: crear un espacio.

Ese boton va a la pantalla que ya tiene el `+`, y **no** abre otra hoja encima. Dos
hojas apiladas son de las cosas que funcionan en un navegador y se portan de otra
manera en un movil, y aqui —AGENTS.md lo dice— lo unico que se comprueba a mano es la
web. El salto cuesta un toque; el fallo en nativo, no se sabe.

### La comprobacion tambien importa

El primer check leia la pagina entera y buscaba "Casa". El menu lateral **sigue abierto
detras** del panel y tambien lista espacios, el del que compartio incluido. Asi que
encontraba "Casa" con el panel bien o mal, y dio tres fallos contra un panel que ya
estaba correcto.

Un check que no puede fallar no es un check. Por eso la lista lleva
`testID="place-spaces"`: el check mira la lista, no la pantalla.

## Compartir un espacio entero es un tropezo mayor

Compartir una **lista** es una concession pequeña. Compartir un **espacio** es otra
cosa, y cuatro partes del sistema solo sabian de listas. Las cuatro salieron al
compartir un espacio y mirar lo que le quedaba a la otra persona. Dos eran de datos.

### 1. El espacio llegaba VACÍO

La sincronizacion entregaba la **fila** del espacio y nada de dentro. Las cuatro
consultas —carpetas, listas, items y notas— preguntan "¿eres miembro del espacio, o se
compartio **este** nodo?". Un share del espacio no es ninguna de las dos cosas.

Asi que el menu lateral listaba el espacio, lo marcaba como compartido, y estaba
**vacio**. Eso se lee como "el compartir no funciono", no como "funciono la mitad".
Reportado como *"el workspace ya no le sale compartido"*.

La solucion son los espacios concedidos: los `nodeType === 'workspace'` de `cadenas`,
en las cuatro consultas. Y es una lista **aparte** a proposito, porque `cadenas` tambien
lleva el espacio contenedor de cualquier otro share: filterarla sin mirar el tipo le
regalaba el espacio entero a quien recibia una lista. Entregar de mas es una brecha, no
una molestia — y hay un test que lo comprueba en la otra direccion.

Un share de espacio **si** trae las notas. Un share de lista no, y un share de carpeta
solo lo que hay dentro. Son tres decisiones y estan escritas donde se toman.

### 2. Se podia compartir dos veces lo mismo

Compartir el espacio, y luego compartir con la misma persona una lista **de dentro**.
La lista no le da nada — ya la tiene — pero se queda en su "compartido conmigo" como
algo que colocar que no puede colocar: el nodo esta en un espacio del que no es miembro,
y `placeShare` pregunta exactamente eso. Un share de espacio producia **dos** cosas
que colocar y ninguna colocable.

El selector ya la ponia en gris, desde `whoHas`. Pero el selector no es la frontera: una
regla que solo vive en el cliente es una regla que la API no tiene. Escribir el correo
a mano y la duplicada entraba sola. Ahora `createShare` lo rechaza con un `409` que
distingue los dos casos: *"ya lo compartiste"* y *"ya lo tiene por otra cosa"*.

### 3. Un espacio no se coloca

Un espacio **no** esta en la bandeja de "compartido conmigo". Llega entero, con sus
carpetas, listas y notas, y ya esta en tu lista de espacios marcado como compartido: no
hay nada que colocar ni donde colocarlo que signifique algo.

Estaba, y producia lo peor de los tres: un "Compartido conmigo · 2", un panel que
ofrecia meter un espacio dentro de otro, y un `403` que era cierto y no servia de nada,
porque el problema nunca fue el espacio que se eligiera.

### 4. "Eliminar" en lo que te compartieron BORRABA lo del otro

Este no es de palabras. **Un delete de sync es global**, y la puerta era
`assertCanWrite`, que deja pasar a cualquiera cuyo acceso sea `edit`.

Asi que a una persona a la que le prestaron una nota como `editor` — un rol que el
menu ofrece y que la insignia llama "Puedes editarlo" — le aparecía **Eliminar**, lo
pulsaba, y la nota **desaparecia de la nota de su dueña**, en todos sus espacios y en
todos sus dispositivos. Verificado antes de arreglarlo: `status: "applied"` y el
registro de la dueña volvio con `deletedAt`.

Editar la nota de otro es lo que significa el rol y sigue permitido. **Borrarla es otro
poder y nadie lo concedio.** Por eso el borrado pide **propiedad** del espacio
(`assertCanDelete`) y editar sigue pidiendo `assertCanWrite`.

Por el camino se vio que un test de este caso **pasaba con el arreglo quitado**: un
grantee normal lo para un paso antes, en la rama de `view` de `assertCanWrite`, y nunca
llega a la puerta que el test vigila. El caso que reproduce es **editor del espacio**,
que es justo lo que produce "compartimos el workspace". Un test que pasa porque la
cadena se rompe antes de donde mira no vigila nada.

### Lo que el menu dice ahora

Los cuatro menus —nota, lista, carpeta y espacio— ponen **"No lo puedes eliminar"**, en
gris y sin hacer nada, con la razon debajo: *"Te lo compartieron. Editarlo si puedes;
borrarlo, solo quien lo creo."*

Lo que **no** hay todavia es la accion que el usuario pidio al principio — "eliminar
link compartido", quitarte el enlace sin tocar el original. Seria un `unplace`: quitar
tu montaje, no mandar un delete. **No existe** y no se ha inventado aqui; se ha
preferido decir la verdad y no pulsar nada a ofrecer un boton que no se sabe que hace.

## Avisar que te ha llegado algo

Compartir no avisaba. La bandeja existia y el menu listaba "Compartido conmigo · 2",
pero **no habia nada** que dijera que algo nuevo habia llegado: cero elementos con
"badge" en el menu, comprobado en el navegador con dos cuentas.

### Lo que cuenta y donde vive

Un punto en la hamburguesa (con el menu cerrado, que es cuando sirve) y un numero junto
a la lista. **Dos numeros, y no uno, porque son dos preguntas**: "cuanto hay sin
colocar" no cambia hasta que haces algo, y "cuanto es nuevo" se va cuando lo miras.

La cuenta es `createdAt > lastSeenAt`, con **una** marca de tiempo, por cuenta y en
este dispositivo (`lib/shares/last-seen.ts`). Sin columna y sin migracion.

- **Una marca y no una bandera por cosa.** Compartir dos veces lo mismo, o algo que ya
  colocaste, no tendria que marcarse dos veces, y una bandera por elemento es una
  segunda lista que puede no cuadrar con la bandeja. "Mas nuevo que la ultima vez que
  mire" no puede no cuadrar con nada: es una comparacion, no un registro.
- **Por cuenta.** Una sola clave significaba que abrir el menu como Ana tapaba el punto
  de Beto, y lo siguiente que llegaba era invisible.
- **En este dispositivo.** Es una notificacion, no un acuse de lectura. Es lo que hace
  un punto, y no cuesta ninguna columna.

Sin nada guardado se cuenta **todo**: la alternativa —dar por visto lo que ya estaba
ahi— esconde en silencio lo que llego mientras no estabas, que es justo para lo que
sirve un punto.

### Se limpia al CERRAR, y no al abrir

La primera version lo marcaba al **abrir**. Eso hacia una parte de la feature
**inalcanzable**: el numero esta dentro del menu, asi que en el instante en que se ve
el menu la cuenta ya es cero, y el numero no lo leia nadie. Una notificacion que no se
puede ver no es una notificacion.

Cerrar es el acuse, que es tambien como lo lee una persona: lo miraste y te vas. Y es
lo que hace que los dos numeros signifiquen cosas distintas. Solo despues de que se
haya abierto alguna vez, con un `ref`: marcar en el primer render cerrado taparia el
punto de quien **aun no ha abierto el menu**, que es el unico caso para el que existe.

### `incoming` y `inbox` son dos listas, y por que

Un **espacio** compartido no es algo que se coloca, asi que no esta en la bandeja. Si el
punto se contara sobre la bandeja, compartir un espacio entero seria **el unico tipo de
compartir que no dice nada** — y los tres tipos estan pedidos. Si la bandeja volviera a
incluir los espacios, se reintroducia el "colgar un espacio dentro de otro".

De ahi `GET /shares/incoming`: todo lo que ha llegado, espacios incluidos, con su fecha.
Incluye lo ya colocado a proposito —"te ha llegado" no deja de ser cierto por haberlo
archivado— y se limpia al cerrar el menu, asi que no engorda una lista que nadie mira.

### Tres cosas que esta feature rompio y que no parecian suyas

Ninguna era del conteo, y las tres salieron de lo mismo: un numero mostrado en dos sitios
que son **dos copias**.

1. **`useShares` guarda estado por llamada.** El boton del menu y el panel del cajon
   tenian cada uno su copia. El panel se marcaba como visto; el boton, leyendo **su**
   copia, no se enteraba, y su punto no se apagaba. Dos copias de un numero es el mismo
   error que dos copias de un mensaje, y de las dos se cree la segunda. Ahora hay un
   almacen modulo (`lib/shares/incoming-store.ts`) con `useSyncExternalStore`.
2. **`useUnseen` devuelto como funcion y llamado despues de un `return null`.** Es un
   hook, asi que React contaba un hook menos en esos renders y **`Rendered more hooks
   than during the previous render`** tiraba la pantalla entera. Con cache limpia y sin
   hot reload: no era un fantasma. Por eso `useShares` **no expone** `unseen`, y quien
   lo quiere importa el hook, donde se ve que es un hook y que va arriba del todo.
3. **`open` sin importar.** `DrawerPanel` no tiene ningun `open` suyo, asi que un `open`
   a secas compilo limpio contra **`window.open`** — una funcion, siempre verdadera.
   `if (!open) return` no cortaba nunca y marcaba "visto" con el menu cerrado. Una guarda
   que no puede fallar no es una guarda.

## La insignia vive solo en el menu de opciones

Estaba arriba de la pantalla del espacio, de la lista y de la nota, y se ha quitado de
las tres. **Una copia en la cabecera es una copia que puede estar equivocada** —al
revocar un share, al meter a alguien en un espacio— durante el tiempo que nadie abra el
menu para compararla. Y ademas es donde se pregunta de verdad: abres el menu para saber
que puedes hacer con una cosa, y la respuesta es lo primero que hay dentro.

La variante compacta (`detailed`) queda sin usar y se borro. Un componente con una
rama que nadie llama es el sitio donde se apelmaza el codigo muerto.

## Que se puede compartir con una persona

De los seis tipos de `shareNodeTypeSchema`, **solo las listas se pueden compartir
con alguien**: el unico menu con pagina de compartir es el de la lista
(`list-menu-sheet.tsx:130`). El resto del contrato promete cosas que no tienen puerta.

| tipo | `resolveTarget` | menu para compartir |
| --- | --- | --- |
| `workspace` | si | no — `share-panel.tsx` es invitacion de membresia, otra cosa |
| `folder` | si | no |
| `list` | si | si |
| `list_item` | si | no — `item-edit-sheet.tsx`: edit / icon / tags |
| `note` | **no, es un bug** | no |
| `note_template` | no | no aplica, ver abajo |

### El bug de la nota

`resolveTarget` (`share-service.ts:66-111`) tiene una rama por tipo y **no tiene la
de `note`**, asi que todo lo que no es workspace, folder o list cae en la consulta de
`list_items`. Las consecuencias son tres y todas son el caso de uso que motiva esto:

- `POST /shares` con una nota da 404.
- Quien recibe una nota compartida **no puede editarla**: el `assertCanWrite` de sync
  llama al mismo `resolveTarget`, recibe el throw, y cae al 404 de "workspace not
  found".
- `tocaElNodo` (`share-service.ts:380-393`) tiene la misma falta, asi que una nota
  compartida bumpearia `list_items.updated_at` en vez de `notes.updated_at` y el
  cursor de pull se moveria sobre la tabla equivocada.

`tocaElNodo` importa mas de lo que parece: sin el bump, el grantee no ve que le ha
llegado una cosa nueva.

O sea: compartir una nota con un amigo, que es justo para lo que esto existe, hoy no
funciona. Por eso el arreglo va **antes** que el picker, no con el.

### `note_template` se queda fuera

Esta en `shareNodeTypeSchema` y en el CHECK de la base de datos, y no se puede
compartir con nadie. No es un olvido: `toEntityName` (`sync-repository.ts:38-45`)
devuelve `null` para el, asi que una revocacion de una plantilla **no genera lapida**
y el dispositivo que la tiene cacheada seguiria mostrandola. Ese es el fallo.

Y las plantillas ya tienen **otro mecanismo**: `scope` (`personal` / `workspace` /
`publico`) con su propio `share()`, que solo deja compartir a un espacio y nunca a
una persona. Dos mecanismos para lo mismo es uno de sobra.

Compartir una plantilla a una persona ademas necesita responder a una pregunta que no
tiene respuesta hoy: **donde la monta quien la recibe**. Una nota tiene sitio porque
tiene espacio y carpeta; una plantilla no esta en ningun arbol.

Se saca `note_template` de `shareNodeTypeSchema` y del CHECK. Es un cambio que
rompe el contrato, y por eso se hace explicito y no de paso. Si el dia hace falta, es
otro ADR y con su lapida y su sitio.

**Hecho.** Migracion `0018_note_template_not_shareable.sql`, que ademas borra las
filas que hubiera: no eran compartibles de nada, porque `resolveTarget` no tenia
rama para ellas y devolvia 404, asi que no se podia crear ninguna por la via
normal. Compartir una plantilla por `scope` sigue funcionando, y hay un test que lo
comprueba justamente para que nadie lea esto como "las plantillas ya no se
comparten".

## Que no es

- **No es chat.** No hay mensajes, ni presencia, ni nada que haya que mantener
  conectado.
- **No es actividad.** No hay "Marta te compartio una nota hace dos dias" en ningun
  sitio. Lo que llega a la otra persona es lo que ya llega: la bandeja "Compartido
  conmigo" del drawer (`drawer.tsx:460-501`), que existe y funciona.
- ~~**No es seguir a nadie.**~~ **Ahora si, y es de una sola direccion.** La primera
  version de este ADR lo descarto y estaba equivocado: el seguimiento no es para
  compartir —compartir no necesita que nadie te siga— sino para **tener a alguien en
  la lista de "con quien"**. Sin el, compartir con alguien con quien no tienes nada
  en comun obliga a acordarse de su correo. Ver "Se puede buscar en `users`".
- ~~**No es buscar a nadie en toda la app.**~~ **Ahora si, con tres letras de suelo y
  diez de techo.** Ver arriba. Lo que no es es *volcar* el directorio entero.
- **No es una red social.** No hay publicacion, no hay followers, no hay actividad,
  y el ningun sitio se puede seguir a alguien que no tienes a mano.

## Como se implementa

Cinco fases. La primera va antes que las demas y no es de la feature.

**0. Arreglar la nota.** Rama de `note` en `resolveTarget` y en `tocaElNodo`. El
test va **por HTTP**, no contra el servicio: el comentario de `routes/shares.ts:39-42`
ya pago el precio de un test que llamaba al servicio directamente y no vio un 401 en
toda la ruta.

**1. `GET /people`.** Contrato en `packages/contracts/src/people.ts`. Servicio que
deriva de `shares` y `memberships`. Montado en el nivel superior en `routes/index.ts`
junto a `/shares`, con el mismo razonamiento: un acto entre dos personas, no
contenido que alguien edita sin conexion. Cero tablas nuevas, cero migraciones.

**2. El picker.** Un componente, `components/people/person-picker.tsx`, dos
consumidores:

- `ShareNodeForm` (`share-node-sheet.tsx:93-103`) — sustituye el `TextField`, con el
  texto libre debajo como salida.
- La pagina `invite` de `share-panel.tsx` — aqui `createInvitationRequestSchema` solo
  acepta `email` (`workspace.ts:577-583`), asi que el picker resuelve la persona a su
  correo y llama al mismo `invite({ role, email })`. Sin tocar el contrato de
  invitaciones.

Las filas de quien ya tiene el nodo salen atenuadas, reusando `useShareReach`.

**3. Las entradas que faltan.** Anadir la pagina `share` a `note-menu-sheet`,
`folder-menu-sheet`, `workspace-menu-sheet` e `item-edit-sheet`. Es copiar el patron
de `list-menu-sheet.tsx:52` (`type Page = "options" | "share" | ...`), incluida la
advertencia de alcance al borrar, que ya esta resuelta y es reutilizable.

En `workspace-menu-sheet` hay que tener cuidado con el nombre: `share-panel.tsx` ya se
llama "compartir" y es una invitacion de membresia. Son dos actos distintos y la
palabra no puede ser la misma para los dos.

**4. La pantalla.** `app/(app)/people.tsx`, una entrada en `DESTINATIONS`
(`drawer.tsx:61-95`) y un `Stack.Screen`. Verificar en el navegador, claro y oscuro,
que es la unica plataforma que se mira a mano.

## Consecuencias

- El picker es un componente con dos consumidores y el segundo no necesita contrato
  nuevo. Es la parte que sale gratis.
- `GET /people` no escala a "toda la gente de la app" y no debe intentarlo. El
  conjunto esta acotado por tus propias relaciones, no por la tabla de usuarios.
- El numero de tipos compartibles pasa de uno a cinco, y eso son cinco menus que
  compilar y revisar en el navegador. Es la parte de esta feature que mas superficie
  anade, y por eso va la ultima y no la primera.
- Si el correo llega tarde, `sharedWithYouEmail` sigue siendo la unica via de aviso
  (`routes/shares.ts:93-110`, a proposito sin `await`). Un directorio sin avisos no
  es un problema: no hay nada que aceptar, asi que no hay nada que se pueda perder.
