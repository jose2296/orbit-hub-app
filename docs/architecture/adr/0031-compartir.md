# Compartir: un vinculo, y el sitio lo elige quien lo recibe

Estado: decidido. Sin implementacion completa.

## Que se comparte

Un espacio entero, una carpeta con todo lo que tiene dentro, una lista, un elemento
suelto o una nota. Todo lo que cuelga de un nodo, cuelga de el: compartir una
carpeta comparte sus listas y sus subcarpetas, porque dejar fuera la mitad de lo que
alguien ha puesto en una carpeta es peor que compartir de mas.

## Que pasa cuando se comparte

**Es un vinculo, no una copia.** Las dos personas ven el mismo elemento y los
cambios se ven al momento. Una copia son dos listas, y una lista que hay que
mantener dos veces es una lista que se desincroniza el primer dia.

La consecuencia honesta: **sin conexion no se puede editar lo compartido**, y la app
tiene que decirlo en vez de dejar que guardes cambios que luego no llegan. Es el
precio de la decision, y es el precio correcto: lo que alguien comparte esperando
que lo vean al momento no es lo mismo que lo que alguien comparte para consultarlo
en un tren.

## Si el dueno borra

**Se borra para los dos**, avisando antes a quien la tiene. Es lo coherente con un
vinculo: si la borro, se borro. Lo que no se hace es dejar una lista medio
congelada, que es un estado que no existe en ningun otro sitio de la app y del que
nadie sabe que salir.

El aviso previo es obligatorio y dice cuantas personas mas la tienen.

## Quien recibe, que puede

- **Puede editar.** Tachar, anadir, reordenar, cambiar el icono, las etiquetas y la
  urgencia.
- **No puede compartir.** Ni volver a compartirlo, ni cambiar quien lo tiene. Un
  circulo de gente que ve una lista sin un dueño claro es un problema de
  permisos, y los problemas de permisos se evitan no dejando abrir el circulo.
- **Puede mirar** (`viewer`) cuando quien comparte quiere solo eso.

## Donde vive

Aqui esta la parte que no es obvia, y es la que resuelve lo de meterlo dentro
de cualquier otro espacio o carpeta.

**El elemento compartido no cambia de sitio.** Se queda en el arbol de quien lo
compartio, con su espacio y su carpeta de origen. Es el mismo objeto, y moverlo de
sitio en el arbol del dueno lo moveria para el otro tambien.

**Quien lo recibe elige donde lo coloca.** En su arbol, en el espacio y la carpeta
que quiera. Eso es un montaje: una referencia al nodo de otra persona, guardada en tu
lado, con su sitio y su orden.

De ahi se siguen dos cosas:

- **«Compartido conmigo» es un espacio virtual**, no una pantalla con una lista
  rara: se comporta como un espacio, se puede meter en el, y lo que no has
  colocado todavia esta en el. En cuanto eliges donde va, sale de ahi.
- **Un espacio compartido es un espacio mas**, con un simbolo al lado que dice que
  no es tuyo. No se monta en ningun sitio: accedes a el, y todo lo que tiene se ve
  con los permisos que te dieron.

Que el que lo recibe elija el sitio y no el que lo envia es lo que evita que compartir
una lista sea tambien compartir tu organizacion entera. Y mover una lista
compartida al sitio que el otro decidio no le enseña al dueno nada del arbol del que
la recibio.

## Que se avisa

**Correo y aviso dentro de la app.** El correo es el que llega si no abres la app en
dias, que es el caso normal de una lista compartida. El aviso dentro es para cuando
estas usando la app y lo ves a tiempo.

## Como se implementa

Tres cosas, y la tercera es la gorda:

1. **`shares`** — la concesion. `owner_id`, `node_type`, `node_id`, `grantee_id`,
   `role`, `revoked_at`. Una fila por persona y nodo.
2. **`share_mounts`** — donde lo ha colocado quien lo recibio. `user_id`, `share_id`,
   `workspace_id`, `folder_id`, `position`. Una fila por persona y concesion.
3. **El sync tiene que incluir lo compartido.** Ahora mismo un `pull` trae lo que
   pertenece a los espacios donde eres miembro. Con una concesion tambien son tuyos,
   asi que el pull tiene que traerlos, y el push tiene que aceptar escribir en un
   nodo donde no eres miembro pero si tienes concesion. Es el cambio de verdad: sin
   el, la tabla es decorativa.

Y una regla que hay que escribir en el sitio, no solo en el ADR: **el permiso de un
nodo es el maximo entre el de su espacio y el de la concesion que lo partage**, con
la concesion gana cuando es mas fuerte. Un elemento en una carpeta compartida dentro
de un espacio tuyo no puede estar mas protegido que su carpeta.

## Lo que no se decide aqui

- Si compartir puede ser publico por enlace sin cuenta. Ahora mismo las
  invitaciones son por correo y por token: un enlace publico es otra conversacion y
  tiene su propio bloque.
- Si puede haberJagadas anidadas (alguien que recibio una lista la vuelve a
  compartir con otro). Hoy no: quien recibe no puede compartir, y asi se acaba.
