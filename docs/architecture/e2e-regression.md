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
| `lib/android.ts` | `adb` con `maxBuffer`, pid, lineas de crash, `forceStop`, capturas |
| `lib/areas.ts` | Las areas son los subdirectorios de `flows/`; flags y `flowsOrder` |
| `lib/maestro.ts` | La invocacion de Maestro, y las claves de config que ya no existen |
| `lib/guard.ts` | El veredicto: proceso y buffer de crash |
| `lib/stack.ts` | Levantar y parar API y Metro, y no tocar lo que ya estaba en pie |
| `lib/report.ts` | La tabla del informe, y solo la tabla |
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
3. **`adb reverse` de los dos puertos.** Y no es un adorno: la app corre DENTRO del emulador y pide
   `127.0.0.1` al host, asi que sin el reverse el bundle no baja y lo que se ve es un recuadro rojo
   que se lee como "la app esta rota".
4. **La siembra**, por HTTP contra la API real, y el token de verificacion **leido del log de la
   API**, que es de donde sale con `EMAIL_TRANSPORT=console`.
5. **El bucle de areas.** Por area: `forceStop`, `logcat -c`, la linea de base, Maestro con el
   directorio entero, el veredicto y una captura.
6. **El informe**, y el `exitCode` segun si alguna area fallo.

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

Cuando `01-onboarding` este en rojo, el informe lo dice en su ultima linea. La linea roja actual -
la tecla de atras de Android sale de la aplicacion en vez de desapilar - es un defecto **de la app**,
no del arnes, y no se ha tapado: los flujos estan escritos como deben. Esa nota se imprime solo
mientras el area siga en rojo, asi que se retira sola el dia que la app se arregle.