# Arnes E2E de Android

Recorre la app en un emulador real con Maestro, siembra datos de verdad y dice **por area** que fallo.
El diseno entero esta en [`docs/architecture/e2e-regression.md`](../../../docs/architecture/e2e-regression.md).

## Que hace falta

**Un** dispositivo android, la app instalada (`npx expo run:android`) y Maestro (`curl -Ls
"https://get.maestro.mobile.dev" | bash`). Con cero o con dos, el arnes se para y lo dice.

## Como se corre

```bash
npm run e2e:android                             # todo
npm run e2e:android -- --area 04-lists          # un area
npm run e2e:android -- --area 04-lists --flow item-menu.yaml
```

El `--` final del script de la raiz esta a proposito: sin el, npm se come las banderas. Un `--area`
mal escrito **falla** y lista los nombres validos, en vez de correr en verde sin haber probado nada.
El arnes levanta la API y Metro si no estan, hace `adb reverse` de los dos puertos -sin eso la app
muestra un recuadro rojo-, siembra una cuenta con sus datos, corre, y sale con codigo distinto de
cero si algo fallo. Todo queda en `capturas/android/`: `informe.txt`, una captura por area, los logs
de la carrera y sus credenciales.

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
`<Screen>`-, y `<area>-<que-hace>` para lo demas: `list-title`, `item-icon-sheet`, `people-search`.

**Por que `testID` y no texto:** la app es bilingue, y un selector de texto se rompe en cuanto se
retoca una palabra de un idioma. La unica cadena que un flujo puede afirmar es una del seed.

## Hoy hay una linea roja, y es de la app

`01-onboarding` sale en rojo: `privacy` y `terms` terminan pulsando `back` y afirmando que se ha
vuelto a `screen-welcome`, y la tecla de atras de Android **sale de la aplicacion** en vez de
desapilar; el boton de la cabecera si funciona. Es un defecto de la app, no del arnes: los flujos
estan escritos como deben y pasan solos cuando la app se arregle. El informe lo dice en su ultima
linea mientras eso siga siendo verdad.

Lo que el arnes **no** comprueba: que al guardar se guardara el texto correcto, ni logica, ni capturas comparadas entre carreras. Es humo, y se presenta como humo.