# El arnes le dice a la app de donde es su Metro, y deja de pedir el 8081

Estado: decidido. `apps/mobile/e2e/lib/android.ts` y `lib/stack.ts`.

## Contexto

`01-onboarding` daba tres de tres flujos en rojo con el mismo motivo, `id:
screen-welcome is visible`, y el arnes no decia nada mas. No era un fallo de la app
ni de los flujos: era que **la app no estaba ejecutando el codigo de esta rama**.

La medida que lo cierra es del bundle cacheado en el dispositivo, 13.4 MB, escrito un
minuto antes de mirarlo:

| `testID`                                                       | fuente | bundle |
| -------------------------------------------------------------- | ------ | ------ |
| `screen-welcome`, `screen-privacy`, `screen-terms`              | si     | **no** |
| `welcome-privacy`, `welcome-terms`                              | si     | **no** |
| los 58 `testID` que ya existian en `main` (`drawer-panel`, `content-filter-*`...) | si | si |

Es decir, el bundle era del codigo de otro checkout de este mismo repositorio. El
arnesReportaba flujos en rojo sin mencionar nada de esto, y durante horas seCastle
buscando en la app, en los `testID` y en el boton de atras.

## La causa, en tres pasos

1. **`adb reverse` no es lo que hace que la app llegue a Metro.** Es lo que se creyo
   durante semanas al reves, y esta escrito en el codigo. La app no pide el bundle por
   su loopback.
2. React Native lee la preferencia **`debug_http_host`** en
   `PackagerConnectionSettings.getDebugServerHost()`, y si esta vacia cae a
   `AndroidInfoHelpers.getServerHost()`, que en un emulador es **`10.0.2.2`**
   (`DevServerHelper.kt:54-57` lo dice en su propio comentario). `10.0.2.2` es la IP del
   host vista desde el emulador, asi que la peticion sale por ahi y no pasa por ningun
   reverse.
3. Medido en la conexion TCP de la app (`/proc/net/tcp6`): `10.0.2.2:1F91`, y `1F91`
   son 8081 en hexadecimal. Con el reverse del arnes puesto en otro sitio y el 8081 del
   host ocupado por el Metro de otro checkout -una sesion de opencode en un workspace
   vecino-, el bundle era de ahi.

Prueba de que es el reverse y no otra cosa: con el Metro del arnes parado del todo -
`curl` a su puerto devuelve `000`- la app **seguia** con
`isMetroRunning(): Async result = true` y `loadJSBundleFromMetro()`, o sea que nunca
llego a preguntar al Metro del arnes.

## Decision

Dos cosas, y las dos hacen falta: sin una el bundle sigue viniendo de donde sea.

**1. El arnes escribe la preferencia y dice de que puerto.** `apuntaMetro` deja
`debug_http_host = localhost:<puerto del arnes>` en las preferencias por defecto de la
app -`PreferenceManager.getDefaultSharedPreferences`, o sea
`<paquete>_preferences.xml`-, con `run-as`. Con `localhost` la peticion sale por el
loopback del emulador, que **si** honra `adb reverse`, y entonces llega al Metro de
esta carrera. Deja la app parada al terminar, porque el host se cachea en un
`_cachedOrOverrideHost` estatico que solo se limpia al construir
`PackagerConnectionSettings`, o sea al arrancar el proceso.

**2. El arnes elige un puerto libre en vez de tomar el 8081.** `eligePuerto` sube desde
el puerto pedido hasta encontrar uno libre. Sin esto, `ensureService` encuentra el 8081
con `/status` respondiendo, dice "ya estaba en pie" y **no arranca su Metro**: vuelve a
servir el bundle del otro checkout. No hay forma fiable de saber de quien es un puerto,
asique `puertoLibre` responde a lo unico que se puede responder sin adivinar -si se
puede coger- probando el bind de verdad.

Y un detalle que costara el mismo dia entero: **ningun bind unico ve a un servidor en
las tres direcciones posibles.** Medido en macOS:

```
escucha      | bind ::  | bind 0.0.0.0 | bind 127.0.0.1
-------------|----------|---------------|---------------
127.0.0.1    | LIBRE    | LIBRE         | OCUPADO
::           | OCUPADO  | OCUPADO       | LIBRE
0.0.0.0      | LIBRE    | OCUPADO       | LIBRE
```

Asi que se prueban las tres y el puerto se da por ocupado en cuanto **una** falla.

**3. El `pm clear` lo hace el arnes y no el flujo, y antes de la preferencia.**
`clearState: true` de `welcome.yaml` es un `pm clear`, y borra todo el directorio de
datos de la app incluida la preferencia recien escrita. Medido de las dos formas con el
8081 ocupado por otro checkout: `pm clear` y luego la preferencia deja
`screen-welcome`, `welcome-privacy` y `welcome-terms` en el arbol de vistas; la
preferencia y luego `pm clear` deja la app en el panel, sin un solo `testID` de la
rama. El orden lo elige quien puede hacer las dos cosas, y ese es el arnes.

## Consecuencias

- **El puerto que aparece en `capturas/android/*.log` puede no ser el 8081, y eso ya
  no es un fallo.** Con otro Metro en el 8081 la carrera arranca en el 8082 o el que
  sea, lo dice en pantalla -`puertos: Metro 8083 (pedido 8081)`- y sigue siendo una
  carrera que mide lo que dice medir. `E2E_METRO_PORT` y `E2E_API_PORT` siguen
  mandando: son el primer puerto que se mira, no el unico.
- **Un area que limpia datos paga un arranque en frio de verdad, y eso cuesta tiempo.**
  Medido: `screen-welcome` aparece a los **51 s** con la descarga de los 13 MB del
  bundle y a los 3.7 s con el bundle ya en la cache. Los tres flujos de
  `01-onboarding` tienen por eso un tope de 180 s y no de 60, y con el tope anterior
  fallaban por nueve segundos (`duration: 60416`). Los tres, no solo `welcome`: con
  `continueOnFailure: true` cada uno corre aunque los anteriores fallen, y entonces
  hereda el arranque en frio.
- **Nadie vuelve a leer "los flujos en rojo" como "la app esta rota" sin mirar de
  quien es el bundle.** Un flujo en rojo con este arnes significa, primero, que la app
  no esta ejecutando lo que el arnes cree. El comando para verlo, y es el primer paso
  de cualquier diagnostico de este arnes:

  ```bash
  adb -s <serial> shell run-as com.jrzlabs.orbithub \
    cat files/BridgelessReactNativeDevBundle.js > /tmp/bundle.js
  grep -c 'screen-welcome' /tmp/bundle.js   # 0 = el bundle no es de esta rama
  ```

- **Este fallo tuvo un coste desproporcionado y no por ser raro, sino por ser
  silencioso.** Ni Metro ni la app ni el dispositivo dicen nada: la app arranca, pinta
  la pantalla, y lo que pinta es la de otra rama del mismo repo. Un fallo que se
  manifiesta como "la app va mal" y no como "la app va bien con el codigo
  equivocado" es el que mas caro sale, porque se investiga donde no es. Lo que lo
  habria resuelto antes y no se probo: leer el artefacto -el bundle- antes de tocar el
  codigo de la app.
- **Lo que casi se creyo, y por que importa.** A mitad de este trabajo se concluyo que
  el arreglo del boton de atras -el [ADR 0034](0034-back-de-android.md)- **no
  funcionaba**, y casi se descarta. La medicion era real -el APK instalado tenia
  `enableOnBackInvokedCallback=false`-, y la conclusion era falsa: estaba hecha contra
  este bundle equivocado. Contra el bundle correcto, el flag apagado devuelve la app a
  `welcome`. Un "el arreglo no funciona" medido contra un entorno que no es el suyo no
  dice que el arreglo falle: dice que la medida no midio lo que se creia. Por eso el
  comando de arriba es el primer paso y no el ultimo.