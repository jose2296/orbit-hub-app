# La tecla de atras de Android se queda con el comportamiento antiguo

Estado: decidido. Una linea en `apps/mobile/app.json`.

## Contexto

`01-onboarding` salia en rojo en el recorrido de humo: `privacy` y `terms` terminan
pulsando `back` y afirmando que se ha vuelto a `screen-welcome`, y la tecla de
atras de hardware **cerraba la aplicacion** en vez de desapilar. El boton de la
cabecera funcionaba, lo que hacia que el fallo pareciera del flujo y no del
sistema.

No era un defecto del codigo de la app, y la cadena se midio entera:

1. `apps/mobile/app.json` traia `android.predictiveBackGestureEnabled: true`, que
   `expo prebuild` convierte en `android:enableOnBackInvokedCallback="true"` en el
   manifiesto generado
   (`@expo/config-plugins/build/android/PredictiveBackGesture.js`).
2. React Native 0.86 registra su `OnBackPressedCallback` **solo** si
   `isAtLeastTargetSdk36(context)`, en `ReactActivity.java`: esa comprobacion es
   `Build.VERSION.SDK_INT >= 36 && targetSdkVersion >= 36`, en `AndroidVersion.kt`.
3. La app se instala con `targetSdk = 36` y el emulador de este repositorio es
   **API 35**. Las dos condiciones tienen que cumplirse y la del runtime no se
   cumple, asi que React Native no registra nada.
4. Con el flag del manifiesto puesto y sin nadie que consuma `KEYCODE_BACK`, el
   sistema la gestiona y termina la activity. En `logcat`:
   `sendCancelIfRunning: isInProgress=false`.

**Medido, no deducido.** Con el flag apagado se reconstruyo el APK, se reinstalo y
se midio: `back` desde `/privacy` mantiene la app viva y vuelve a `welcome`. Con el
flag encendido, la misma secuencia cierra la app. Una variable.

Y la medicion es sobre el APK **extraido del propio dispositivo**, no sobre el
manifesto en disco, que es lo que hace que valga: `aapt2 dump xmltree` del `base.apk`
instalado dio `targetSdkVersion(0x01010270)=36` y
`enableOnBackInvokedCallback(0x0101066c)=false`, y el `logcat` del dispatcher salio
igual con el flag a `true` y a `false` -`WindowOnBackDispatcher: sendCancelIfRunning:
isInProgress=false`-, o sea que esa linea no distingue los dos casos y no puede usarse
como prueba de nada.

> **Una medicion de este fallo se hizo mal y salio al reves.** A mitad de este trabajo
> se concluyo que el flag **no** arreglaba el back, y casi se descarta la decision. La
> medicion era correcta en lo que decia -el APK instalado tenia el flag apagado- y la
> conclusion era falsa, porque estaba hecha contra un bundle de JavaScript que no era
> de esta rama (ver el [ADR 0035](0035-dev-server-del-arnes.md)). Contra el bundle
> correcto, el flag apagado devuelve la app a `welcome`. Lo que se habia medido no era
> "el arreglo no funciona" sino "la app no estaba ejecutando este codigo". Se deja
> escrito porque volver a concluir lo contrario es el riesgo real al leer el ADR.

Y el alcance es mas ancho que este emulador: con `targetSdk = 36`, **cualquier**
dispositivo o emulador por debajo de API 36 cierra la app al pulsar atras. En
API 36 y superiores funciona, que es justo por que nadie lo habia visto.

## Decision

**`android.predictiveBackGestureEnabled: false`**, y `apps/mobile/android/` se deja
como esta: es directorio ignorado por git y lo regenera `expo run:android` desde
`app.json`. Editar el manifiesto a mano "arreglaria" la siguiente instalacion y no
esta en el diff.

Se acepta perder **la animacion de gesto predictivo** en dispositivos API 36 y
posteriores. El boton de la cabecera sigue funcionando, asi que la pantalla nunca
se queda sin una forma de volver.

## Consecuencias

- **La puerta que hay que volver a mirar.** React Native solo registra su
  `OnBackPressedCallback` con `SDK_INT >= 36 && targetSdkVersion >= 36`. Quien
  suba `targetSdkVersion`, o quien pruebe en un emulador nuevo, tiene que saber que
  esta decision tiene un precio y no fue un descuido. Con las dos condiciones
  cumplidas, el gesto predictivo vuelve a ser seguro y este flag puede volver a
  `true` - pero entonces hay que decidir otra vez, no reponerlo por inercia.
- **`app.json` no admite comentarios.** Es JSON y lo lee `JSON.parse`, asi que no
  hay forma de dejar la nota al lado del flag sin inventar un campo que nadie lee.
  Por eso el por que vive aqui y no en el fichero que se va a tocar.
- **La regresion esta cubierta, y por el flujo y no por una prueba unitaria.**
  `privacy.yaml` y `terms.yaml` afirman `screen-welcome` despues de `back`, y eso es
  exactamente lo que fallaba. El recorrido de humo es la prueba de esto, y por eso
  un cambio en `app.json` que toque el nativo se comprueba con
  `npm run e2e:android` y no solo con `npm run check`.
- **El fallo era de la configuracion, no de la app, y eso cambia quien lo
  arregla.** Con el mismo `targetSdk`, cualquier aplicacion React Native 0.86 de
  este repositorio habria cerrado igual. La nota que el informe de humo imprimia
  para este defecto -"conocido y sin arreglar"-, y la maquinaria que la calculaba,
  se retiraron al quedar la lista de fallos conocidos vacia; la regla para volver a
  traerla esta en el [ADR 0033](0033-regresion-e2e-android.md) y en el
  `JSDoc` de `renderReport`.