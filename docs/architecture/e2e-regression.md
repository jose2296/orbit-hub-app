# La regresion E2E de Android

Como esta montado el arnes de `apps/mobile/e2e/`, y por que el guardian de crasheo es una pieza
aparte y no una parte de los flujos. La especificacion esta en
[`docs/superpowers/specs/2026-10-03-regresion-e2e-android-design.md`](../superpowers/specs/2026-10-03-regresion-e2e-android-design.md),
la decision en el [ADR 0033](adr/0033-regresion-e2e-android.md) y el uso en el
[README del arnes](../../apps/mobile/e2e/README.md).

## Que es, y que no

Un recorrido de humo por areas de la app, en un emulador de verdad, con datos sembrados. Al cerrar
cada area pregunta al proceso y al buffer de crash, y al final deja una tabla por area en
`capturas/android/informe.txt`.

**Fase 1 cubre tres pantallas de veintinueve**: `welcome`, `privacy` y `terms`. Las otras
veintiseis, y las cuarenta hojas, son fase 2. Los diecisiete `verify-*.mjs` **no** se borran todavia:
borrarlos antes de que la suite cubra lo que cubren dejaria un hueco justo donde mas duele.

No es iOS. No es regresion visual. No es el nivel funcional: comprobar que al guardar se guardo el
texto correcto es otro nivel y mas caro, y esta fuera a proposito.

## Las piezas

| Fichero | Que hace |
| --- | --- |
| `run-android.ts` | El guion: dispositivo, servicios, seed, bucle de areas, informe |
| `lib/android.ts` | `adb` con `maxBuffer`, pid, lineas de crash, `forceStop`, capturas, `limpiaDatos` y `apuntaMetro` |
| `lib/areas.ts` | Las areas son los subdirectorios de `flows/`; flags y `flowsOrder` |
| `lib/maestro.ts` | La invocacion de Maestro, y las claves de config que ya no existen |
| `lib/guard.ts` | El veredicto: proceso y buffer de crash |
| `lib/stack.ts` | Levantar y parar API y Metro, no tocar lo que ya estaba en pie, y elegir puertos libres |
| `lib/report.ts` | La tabla del informe, y el parseo de los flujos que fallaron |
| `seed/e2e-account.ts` | Dos cuentas verificadas, con datos de verdad, y sus ids |

El runner es el unico que sabe el orden de todo. Y casi todas las piezas se prueban sin el
dispositivo -`report.ts` incluida-, que es lo que deja distinguir un fallo del arnes de un fallo de
la app: el segundo llega con su nombre en el informe y el primero con una foto.

## Como se ejecuta una carrera

1. **Un dispositivo, exactamente uno.** `requireOneDevice` falla con cero y con dos, nombrando los
   que ve.
2. **La API y Metro**, si no estan ya escuchando. `ensureService` mide el puerto, arranca lo que
   falta con su `PGLITE_DATA_DIR` y su `EMAIL_TRANSPORT=console` de la carrera, y al terminar
   para solo lo que arranco el.
3. **Los puertos libres, `adb reverse`, y decirle a la app de donde es su Metro.** Las tres cosas
   hacen falta y el orden es parte del contrato. `eligePuerto` sube desde el puerto pedido hasta
   encontrar uno libre: sin eso, `ensureService` encuentra el 8081 con `/status` respondiendo, dice
   "ya estaba en pie" y **no arranca su Metro**. `adb reverse` pone los dos puertos a disposicion de
   la app... y por si solo **no** sirve, que es lo que se creyo al reves durante semanas: React Native
   ignora el reverse en el emulador, lee la preferencia `debug_http_host` y, si no esta, cae a
   `10.0.2.2` -la IP del host vista desde el emulador-, que no pasa por ningun reverse. Por eso
   `apuntaMetro` escribe esa preferencia con `run-as`, y por eso el `pm clear` de `limpiaDatos` va
   **antes**: el orden inverso deja la app sin la preferencia y bajando el bundle de quien este en el
   8081 del host. Todo el detalle y las mediciones estan en el
   [ADR 0035](adr/0035-dev-server-del-arnes.md).

   Y esto tiene una consecuencia de diagnostico que es la parte cara: **un area en rojo no significa
   "la app esta rota".** El sintoma es identico cuando la app baja el bundle de otro checkout de este
   repositorio -los flujos no ven ningun `testID`- y ese caso no deja ninguna otra pista. Antes de
   mirar la app hay que mirar el bundle, y el comando esta en el
   [README del arnes](../../apps/mobile/e2e/README.md).
4. **La siembra**, por HTTP contra la API real, y el token de verificacion **leido del log de la
   API**, que es de donde sale con `EMAIL_TRANSPORT=console`.
5. **El bucle de areas.** Por area: `forceStop`, `logcat -c`, `pm clear` y la preferencia del dev
   server -en ese orden-, la linea de base, Maestro con el directorio entero -o con un solo flujo si
   viene `--flow`-, el veredicto y una captura.

   El `pm clear` va aqui y no en el flujo porque es lo que garantiza el arranque sin sesion que
   `welcome.yaml` necesita, y porque **borra la preferencia** que el paso anterior acaba de escribir:
   medido, con la preferencia antes del `pm clear` la app arranca en el panel sin un solo `testID` de
   la rama, y al reves llega a `screen-welcome`. `welcome.yaml` por eso va con un `launchApp` pelado.

   Y el precio de limpiar por area es un arranque en frio de verdad: el `pm clear` borra tambien la
   cache del bundle, o sea que el primer flujo de cada area descarga los 13 MB otra vez. Medido,
   `screen-welcome` aparece a los **51 s** en frio y a los 3.7 s con la cache. Los tres flujos de
   `01-onboarding` llevan por eso un tope de 180 s, y no solo `welcome`: con `continueOnFailure: true`
   cada uno corre aunque los anteriores fallen, y entonces hereda el arranque en frio. Con el tope de
   60 s que habia antes fallaban los tres por nueve segundos.
6. **El informe**, y el `exitCode` segun si alguna area fallo. Las banderas aceptan las dos formas,
   `--area x` y `--area=x`, y un `--...` que no sea de las dos lanza: un flag mal escrito que se pasa
   sin quejarse es una carrera entera en verde sin haber corrido lo que se le pidio.

Todo lleva marca de carrera en el nombre -el log, los datos, las credenciales-: un `seed.env` de
nombre fijo sobrevive a la carrera siguiente y sus credenciales apuntan a una base de datos que ya
no existe, que es un fallo que se lee como "la siembra no funciona".

## Por que el guardian va aparte de los flujos

Maestro no dice *por que* fallo. No lee `logcat` y no ve un relanzamiento en silencio.

Eso no es un detalle, porque este repositorio ya lo pago dos veces: `8b75b37` dejo al usuario en la
pantalla del callback del login, y `513bbbb` cerro la app al volver del login de Google. En los dos
casos la app **parecia sana**: un proceso nativo que muere relanza la activity sin decir nada, y
"esta en pie" no quiere decir "sigue en la pantalla que deberia".

La leccion mas cara vino de `verify-android-screens.mjs`: seis pasos dieron verde con la app sin
moverse de sitio, porque mirar el proceso solo no dice si un toque ha dado en algo.

Asi que hay dos cosas que mirar y **cada una ve una que la otra no**:

| Pieza | Pregunta |
| --- | --- |
| Maestro | Llego y se ve |
| `lib/guard.ts` | La app sigue viva y no ha petado por debajo |

El veredicto se comprueba en un orden y para en el primero: un proceso muerto suele traer tambien
su linea de crash en el buffer, y reportar las dos cosas mete dos fallos en el informe para uno.

### Tres senales vivas, y una cableada para mas adelante

Las tres vivas: **no hay proceso**, hay un **`FATAL EXCEPTION`** en el buffer de crash, o hay un
**`JavascriptException`** -que es como muere una app Expo-. Eso es lo que corre hoy.

La cuarta senal del diseno -**el pid que cambia**, que es el relanzamiento en silencio- **esta
implementada y probada, y no se puede ejecutar**. `run-android.ts` hace `forceStop` antes de cada
area, asi que la linea de base siempre es `null` y la comprobacion no llega a correr. Quitarel
`forceStop` arreglaria la rama y traeria un problema peor: el pid del area siguiente seria el de un
estado que nadie ha comprobado, una hoja abierta o un proceso a medio morir. El arreglo de verdad es
que Maestro devuelva el pid que levanto la app. El motivo esta escrito en los dos sitios donde se
toma la decision: el `forceStop` del runner y la funcion de `verdict`.

## El orden de cada area, y por que cada area lleva el suyo

Cada area lleva su `config.yaml` con su `flowsOrder`. Measured: Maestro descubre solo el
`config.yaml` del directorio que se le pasa, asi que uno por area es lo unico que fija el orden sin
acoplar las areas entre si. Y sin orden, Maestro corre en el que devuelve el sistema de ficheros:
en una prueba salio `bbb, aaa, ccc`.

Declarar el flujo nuevo **no es opcional**, y por eso `resolveAreas` lanza si las dos listas no
dicen lo mismo: un flujo sin declarar se corre igualmente, detras y en un hueco sin decidir, y el
area sigue en verde sin tener orden. Anadir un flujo y anadirlo a `flowsOrder` son el mismo trabajo.

## El informe cuenta areas, no flujos

`informe.txt` dice `0/1 areas sin fallo`, no `2/3 flujos`. Una carrera con cuarenta flujos y un
area rota es un fallo, no un 39/40: el total de flujos depende de cuantos flujos se hayan escrito, y
eso es decision de quien los escribe, no estado de la app.

Y el recuento no es decorativo: el runner sale con codigo distinto de cero si alguna area falla, que
es lo que hace que esto se pueda mirar en un script sin leer el fichero.

**Lo que hay debajo de cada fila es lo que hace que el fichero se basta solo.** Una fila dice que
area fallo y cuantos flujos, y debajo estan los que fallaron con el motivo tal cual lo imprimio
Maestro -`fallosDeMaestro` los saca de la misma salida que el runner tira al salir-. Un informe que
solo dice `Maestro fallo` dice que herramienta fallo, no por que, y obliga a tener la consola delante.
Cuando el parseo no encuentra nada se dice que no se ha podido leer, en vez de inventar un motivo: un
motivo a medias es peor que ninguno, porque parece un motivo.

Un area **sin flujos** lleva `NADA` y no cuenta como sana. No fallo y no se probo, y un `1/1 areas
sin fallo` debajo de una fila que dice "no he probado nada" son dos frases que se contradicen en el
mismo fichero.

Y la carrera sale con codigo 0 al montar un area nueva. **No es una promesa del documento: es que la
fila, el recuento de sanas y el codigo de salida salen de la misma funcion**, `veredictoArea`, y el
rojo lo decide `saleEnRojo`, que cuenta areas en `FALLA` y solo eso. Antes cada uno tenia su propia
condicion y el runner llevaba un `fallos += 1` sin comprobar: un area vacia salia en rojo por el
guardian -que responde `la app se cerro` porque `forceStop` para la app y sin un flujo no hay nada
que la levante-, mientras el informe de la misma carrera decia `NADA`. Un area **con** flujos que se
queda sin proceso sigue siendo un fallo, y por el mismo camino: ahi si se ha probado algo y no
estaba.

**Y que un area en rojo pueda ser un defecto de la app, con su motivo escrito en el informe.** Hubo
uno: la tecla de atras de Android salia de la aplicacion en vez de desapilar. No se tapo -tapar
seria cambiar el flujo para que la suite no lo encontrara-, se arreglo
(`android.predictiveBackGestureEnabled` a `false`, con el motivo y el precio en el
[ADR 0034](adr/0034-back-de-android.md)), y la nota del informe **se retiro sola**, que es lo que se
escribio para que hiciera. `01-onboarding` esta en verde.

La regla que queda de ese intento, y que es la parte cara, es como se decide imprimir la nota: **si
y solo si los flujos que nombra son los que Maestro ha dicho que fallaron**, el guardian no tiene
nada que decir y el area no ha salido en verde. Apoyada en el area sola prometeria un arreglo que no
tocaria ese fallo, que es peor que no decir nada. Con la lista de conocidos vacia la tabla y su
filtro se borraron -codigo que no puede fallar no se mantiene-, y el sitio donde se busca cuando
haga falta es el `JSDoc` de `renderReport` y el [ADR 0033](adr/0033-regresion-e2e-android.md).

Lo que el informe **no** puede prometer nunca: que un area en verde signifique que la app esta bien
mas alla de lo que afirman sus flujos. Es humo, y por eso lo dice en la leyenda que cierra el
fichero.