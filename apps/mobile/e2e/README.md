# Arnes E2E de Android

Recorre la app en un emulador real con Maestro, siembra datos de verdad y dice **por area** que fallo.
El diseno entero esta en [`docs/architecture/e2e-regression.md`](../../../docs/architecture/e2e-regression.md).

## Que hace falta

**Un** dispositivo android, la app instalada (`npx expo run:android`) y Maestro (`curl -Ls "https://get.maestro.mobile.dev" | bash`). Con cero o con dos, el arnes se para y lo dice.

## Como se corre

```bash
npm run e2e:android                             # todo
npm run e2e:android -- --area 01-onboarding     # un area
npm run e2e:android -- --area=01-onboarding     # lo mismo: vale con y sin `=`
npm run e2e:android -- --area 01-onboarding --flow privacy.yaml
```

Hoy `flows/` solo tiene `01-onboarding`: los otros nombres de area son del plan y aun no existen, asi
que copiarlos tal cual falla a proposito. El `--` final del script de la raiz tambien es a proposito
(sin el, npm se come las banderas), y tanto un `--area` mal escrito como una bandera que no existe
**fallan** en vez de correr en verde sin haber probado nada: el primero listando los nombres validos,
la segunda diciendo que lo unico que hay son `--area` y `--flow`. Con `--flow` la fila del informe
dice `1 flujo`, no los que tiene el area: el numero del informe es lo que se ha corrido.
El arnes levanta la API y Metro si no estan, hace `adb reverse` de los dos puertos -sin eso la app
muestra un recuadro rojo-, siembra una cuenta con sus datos, corre, y sale con codigo distinto de
cero si **alguna area sale en `FALLA`**. Un area sin flujos lleva `NADA` y no pone la carrera en rojo:
aun no hay nada que probar, y no es un fallo. Todo queda en `capturas/android/`: `informe.txt` con una fila por area y **el flujo que fallo con su motivo debajo**, mas una captura, los logs y las credenciales.

## Anadir un flujo

1. El fichero va en el area de la **pantalla** que toca: una hoja de `[listId].tsx` va a
   `04-lists/`, que es donde alguien la ira a buscar.
2. Anadelo al `flowsOrder` del `config.yaml` **de ese area**, sin la extension. Si no,
   `resolveAreas` lanza: un flujo sin declarar se corre igualmente, detras y en un hueco sin decidir.
3. Afirma sobre `testID` y termina volviendo a un marcador conocido, para no envenenar al siguiente.

```yaml
appId: com.jrzlabs.orbithub
tags: [smoke]
---
- tapOn: { id: welcome-privacy }
- assertVisible: { id: screen-privacy }
```

Los datos de la siembra llegan por variables (`${listTitle}`, `${email}`...), no escritos en el flujo: la cuenta es nueva en cada carrera y sus ids no se pueden escribir a mano.

## La convencion de `testID`

kebab-case con prefijo de area: `screen-<nombre>` para la raiz de la pantalla -lo que ya lleva
`<Screen>`-, y `<area>-<que-hace>` para lo demas: `item-menu-button`, `content-filter-note`, `done-tray-toggle`, `notes-create`. Todos existen hoy en `src/`.

**Por que `testID` y no texto:** la app es bilingue, y un selector de texto se rompe en cuanto se retoca una palabra de un idioma. La unica cadena que un flujo puede afirmar es una del seed.

## Lo que el guardian mira, y lo que todavia no

Ademas de lo que Maestro afirma, el arnes mira el proceso y el buffer de crash al cerrar cada area,
porque Maestro no lee `logcat` y no ve un relanzamiento en silencio.

**Tres senales vigilan hoy:** que no quede proceso, un `FATAL EXCEPTION` en el buffer, o un
`JavascriptException` -que es como muere una app Expo-. Una cuarta esta implementada y probada y
**no se puede ejecutar**: el pid que ha cambiado, que es el relanzamiento en silencio, porque el
runner para la app antes de cada area y la linea de base siempre es "no hay proceso". Se deja
cableada y se dice en los tres sitios donde se decide -`lib/guard.ts`, la pagina de
[arquitectura](../../../docs/architecture/e2e-regression.md) y el
[ADR 0033](../../../docs/architecture/adr/0033-regresion-e2e-android.md)- en vez de presentarla como
una comprobacion que vigila. El arreglo de verdad es que Maestro devuelva el pid que levanto la app.

## Hoy hay una linea roja, y es de la app

`01-onboarding` sale en rojo: `privacy` y `terms` terminan pulsando `back` y afirmando que se ha
vuelto a `screen-welcome`, y la tecla de atras de Android **sale de la aplicacion** en vez de
desapilar; el boton de la cabecera si funciona. Es un defecto de la app, no del arnes: los flujos
estan escritos como deben y pasan solos cuando la app se arregle. El informe lo dice en su ultima
linea, y solo mientras sean **esos dos flujos** los que fallen: si el area se pone roja por otra cosa, la nota no culpa a un fallo del que nadie sabe nada.

Lo que el arnes **no** comprueba: que al guardar se guardara el texto correcto, ni logica, ni capturas comparadas entre carreras. Es humo, y se presenta como humo.