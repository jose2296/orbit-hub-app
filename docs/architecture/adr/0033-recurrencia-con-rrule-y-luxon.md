# ADR 0033 — La recurrencia de habitos: `rrule` + `luxon`, con el offset resuelto a mano

**Status:** Accepted

## Context

El tracker de habitos necesita recurrencia con zona horaria: "todos los lunes a
las 08:00 en `Europe/Madrid`" tiene que seguir siendo las 08:00 la semana que el
reloj salta de 02:00 a 03:00, y una hora local que no existe ese dia tiene que
decidir algo. La regla 7 del `AGENTS.md` exige que el calculo funcione sin
conexion, asi que la libreria tiene que correr en el telefono, no solo en el
servidor.

La decision de que libreria se usa condiciona todas las tareas siguientes, asi
que se midio antes de escribir el motor. El spike vivio en
`packages/habit-core/src/spike.ts` y se borra en la Task 2; **este ADR es lo que
sobrevive**, porque `.superpowers/` esta en `.gitignore` y un `git clean` se
lleva por delante el reporte, el plan y la revision.

## Decision

Usar **`rrule@2.8.1` + `luxon@3.7.2`** en `packages/habit-core`, con una regla que
no es opcional:

> Una ocurrencia de `rrule` con `tzid` es una **hora de pared local**, no un
> instante. Los componentes locales se leen con `getUTC*`, y el offset se resuelve
> explicitamente leyendo esos componentes como hora local de la zona.

Se descartaron `rrule-temporal` (plan B) y limitar la recurrencia al servidor
(plan C, que rompe la regla 7). No hizo falta recurrir a ninguno: los tres
entornos coinciden.

### Por que el import de `rrule` es raro

`rrule` llega en tres formas segun quien lo carga, y ninguna forma de import
sirve para las tres:

| Quien carga | Que resuelve | Que build | Exports nombrados |
| --- | --- | --- | --- |
| Node ESM | `main` (no hay `exports` map) | `dist/es5/rrule.js`, CommonJS | no detectables: `import { RRule } from 'rrule'` lanza `Named export 'RRule' not found` |
| Metro, web | `browser, module, main` | `dist/esm/index.js`, ESM | si, y **sin default** |
| Metro, nativo | `react-native, browser, main` | `dist/es5/rrule.js`, CommonJS | no detectables |

El shim que si funciona en los tres:

```ts
import * as rruleNamespace from 'rrule';

const rrule = (rruleNamespace as { default?: typeof rruleNamespace }).default ?? rruleNamespace;
const { RRule } = rrule;
```

luxon no tiene el problema: publica `exports` con un build ESM de verdad.

### Otras dos trampas, medidas

- **`rule.all()` sin `count` ni `until` no falla: cuelga.** En `rrule@2.8.1`,
  `IterResult.prototype.add` devuelve siempre `true`, asi que no hay forma de
  parar la iteracion. Toda regla que se vaya a materializar va acotada.
- **`DateTime.toISO()` devuelve la hora de la zona, no la de UTC.** Para el
  instante hay que pedir `.toUTC().toISO()`.

## La medicion de los tres entornos

El mismo modulo se ejecuto en Node, en el navegador y dentro de **Hermes** en el
emulador. Se compara la huella FNV-1a del JSON canonico, no el JSON a ojo.

| Entorno | Como | `engine` | Huella |
| --- | --- | --- | --- |
| Node 26.8.2 | `npm run test --workspace @orbit-hub/habit-core` | `node` | `2f6ae9c6` |
| Chromium (Playwright), `expo start --web` | consola del navegador | `browser` | `2f6ae9c6` |
| Hermes en Android 15 (API 35), `emulator-5554` | `adb logcat` | `hermes` | `2f6ae9c6` |

`engine` sale de `globalThis.HermesInternal != null`, asi que la lectura del
emulador es del motor de React Native y no de un atajo.

Lo que este ADR no puede hacer es **ejecutar** el navegador ni Hermes desde un
test: `packages/habit-core` corre en `environment: 'node'` y no hay forma de
arrancar un emulador desde vitest. Lo que si hace el test es afirmar que esta
corrida en Node coincide con el registro de los tres, y que los tres valores
registrados coinciden entre si. Si Node divergiera, el test falla; si el
navegador o Hermes divergieran, falla quien vuelva a medirlos y tenga que
actualizar el registro.

### Como reproducirlo

```bash
# 1. Node
npm run build --workspace @orbit-hub/habit-core
node --input-type=module -e "
import { spikeFingerprint, spikeEnv } from './packages/habit-core/dist/spike.js';
console.log('SPIKE_FINGERPRINT', spikeFingerprint());
console.log('SPIKE_ENV', JSON.stringify(spikeEnv()));
"

# 2. Navegador. Con un `console.log` de esas dos llamadas a nivel de modulo en
#    `apps/mobile/src/app/_layout.tsx` (temporal, se revierte), y la consola
#    abierta en http://localhost:<puerto>.
cd apps/mobile && npx expo start --web --port <puerto>

# 3. Hermes. El mismo `console.log` en el mismo fichero, con el bundle nativo
#    servido por Metro, y la lectura en el logcat del emulador.
adb -s emulator-5554 reverse tcp:8081 tcp:8081
adb -s emulator-5554 logcat -c
adb -s emulator-5554 shell am start -n com.jrzlabs.orbithub/.MainActivity
adb -s emulator-5554 logcat -d | grep SPIKE_
```

El paso 2 y el 3 necesitan tocar `apps/mobile/src/app/_layout.tsx`, porque el
`app root` de expo-router sale del config (`extra.router.root`) y no hay forma de
redirigirlo por entorno. Ese cambio **no** se comitea.

## El hueco horario: lo que dice el spec y lo que pasa

El ruling del spec es: *una hora local que no existe no se pierde, cae en el
primer instante valido despues del hueco*. **Medido el 2026-10-05**, con
`Europe/Madrid` y las 02:30 de los domingos:

| Que se pregunta | Domingo normal, 2026-03-22 | Dentro del hueco, 2026-03-29 | Semana despues, 2026-04-05 |
| --- | --- | --- | --- |
| Que devuelve `rrule` con `tzid` | `2026-03-22T02:30:00.000Z` | `2026-03-29T02:30:00.000Z` | `2026-04-05T02:30:00.000Z` |
| Leido como instante (`fromJSDate`) | 03:30 local (+01:00) | **04:30** local (+02:00) | 04:30 local (+02:00) |
| Leido como hora de pared (`fromObject`) | 02:30 local (+01:00) | **03:30** local (+02:00) | 02:30 local (+02:00) |

Cuatro cosas que cambian como se implementa el motor:

1. **`rrule` no resuelve el hueco, y ni lo intenta.** Devuelve `02:30` del 29, una
   hora que en Madrid no existe. No la comprueba, no la mueve, no marca nada.
   El ruling **no** esta satisfecho por `rrule`.
2. **La serie no se rompe y la ocurrencia no se desplaza de dia.** Esto si se
   cumple, y se cumple *porque* `rrule` no convierte nada: se limita a devolver la
   hora de pared que le pidieron. Las tres ocurrencias son 22, 29 y 5 de abril.
3. **La resolucion hay que hacerla a mano, y hay dos lecturas y solo una es
   buena.** Leer el `Date` como instante (`fromJSDate`) trata las 02:30 como si
   fueran UTC, y el resultado cae un offset entero mas tarde: **04:30** el dia
   del hueco, y tambien 03:30 el domingo normal de antes. No es un fallo de un
   dia al ano, es un fallo en cada ocurrencia, de una hora en invierno y dos en
   verano. La lectura correcta es tomar los componentes UTC como hora local de la
   zona (`fromObject`).
4. **La frase del spec no es literal.** El primer instante valido despues del
   hueco son las `03:00`; luxon devuelve `03:30`, porque conserva los minutos y
   desplaza lo que mide el salto. `03:30` es la respuesta sensata y la que hay que
   documentar, pero no es lo que dice la frase. **El spec necesita esa correccion**
   y la decision es de quien lo escribe.

## Consecuencias

- El motor de la Task 2 tiene que exponer la conversion a instante como una
  funcion propia, y ningun sitio puede convertir una ocurrencia con `fromJSDate`.
- Un recordatorio de las 02:30 en `Europe/Madrid` suena a las 03:30 el domingo
  del cambio y a las 02:30 el resto del ano. Es el comportamiento buscado.
- Los tests del motor tienen que fijar `TZ` para afirmar nada sobre `getHours()`:
  con `TZ=Europe/Madrid` da 10 donde `getUTCHours()` da 8, y con `TZ=UTC` los dos
  dan 8. La diferencia es la zona del dispositivo, no la ocurrencia.
- La API es `"type": "module"` y llama a este paquete, asi que el shim de import
  no es opcional ahi.

## Registro legible por maquina

Lo lee `packages/habit-core/src/spike.test.ts`. Si el bloque falta o no parsea, el
test lo dice en el mensaje en vez de compararse con `undefined`.

```json
{
  "measuredOn": "2026-10-05",
  "spike": "packages/habit-core/src/spike.ts",
  "fingerprint": "FNV-1a over JSON.stringify(spikeResult())",
  "rrule": "2.8.1",
  "luxon": "3.7.2",
  "timezone": "Europe/Madrid",
  "environments": {
    "node": {
      "engine": "node",
      "runtime": "node 26.8.2, vitest 5.0.2, native ESM loader",
      "fingerprint": null,
      "command": "npm run test --workspace @orbit-hub/habit-core"
    },
    "browser": {
      "engine": "browser",
      "runtime": null,
      "fingerprint": null,
      "command": "cd apps/mobile && npx expo start --web --port <puerto>"
    },
    "hermes": {
      "engine": "hermes",
      "runtime": null,
      "fingerprint": null,
      "command": "adb -s emulator-5554 logcat -d | grep SPIKE_   (bundle nativo servido por Metro)"
    }
  },
  "result": {
    "probe1_mondaysAtEight": {
      "iso": [
        "2026-03-23T08:00:00.000Z",
        "2026-03-30T08:00:00.000Z",
        "2026-04-06T08:00:00.000Z"
      ],
      "dates": [
        "2026-03-23",
        "2026-03-30",
        "2026-04-06"
      ],
      "utcHours": [
        8,
        8,
        8
      ]
    },
    "probe2_sundaysInTheGap": {
      "iso": [
        "2026-03-22T02:30:00.000Z",
        "2026-03-29T02:30:00.000Z",
        "2026-04-05T02:30:00.000Z"
      ],
      "dates": [
        "2026-03-22",
        "2026-03-29",
        "2026-04-05"
      ],
      "utcHours": [
        2,
        2,
        2
      ],
      "controlDay": {
        "rruleOccurrence": "2026-03-22T02:30:00.000Z",
        "readAsInstant": "2026-03-22T03:30:00.000+01:00",
        "readAsInstantLocal": "2026-03-22T03:30",
        "readAsWallClock": "2026-03-22T02:30:00.000+01:00",
        "readAsWallClockLocal": "2026-03-22T02:30",
        "readAsWallClockOffsetMinutes": 60
      },
      "gapDay": {
        "rruleOccurrence": "2026-03-29T02:30:00.000Z",
        "readAsInstant": "2026-03-29T04:30:00.000+02:00",
        "readAsInstantLocal": "2026-03-29T04:30",
        "readAsWallClock": "2026-03-29T03:30:00.000+02:00",
        "readAsWallClockLocal": "2026-03-29T03:30",
        "readAsWallClockOffsetMinutes": 120
      },
      "weekAfterGap": {
        "rruleOccurrence": "2026-04-05T02:30:00.000Z",
        "readAsInstant": "2026-04-05T04:30:00.000+02:00",
        "readAsInstantLocal": "2026-04-05T04:30",
        "readAsWallClock": "2026-04-05T02:30:00.000+02:00",
        "readAsWallClockLocal": "2026-04-05T02:30",
        "readAsWallClockOffsetMinutes": 120
      }
    },
    "probe3_mondayAfterTheChange": {
      "rruleOccurrence": "2026-03-30T08:00:00.000Z",
      "readAsInstant": "2026-03-30T10:00:00.000+02:00",
      "readAsInstantLocal": "2026-03-30T10:00",
      "readAsWallClock": "2026-03-30T08:00:00.000+02:00",
      "readAsWallClockLocal": "2026-03-30T08:00",
      "readAsWallClockOffsetMinutes": 120,
      "utcYear": 2026,
      "utcMonth": 3,
      "utcDate": 30,
      "utcHour": 8
    }
  },
  "gap": {
    "iso": [
      "2026-03-22T02:30:00.000Z",
      "2026-03-29T02:30:00.000Z",
      "2026-04-05T02:30:00.000Z"
    ],
    "dates": [
      "2026-03-22",
      "2026-03-29",
      "2026-04-05"
    ],
    "utcHours": [
      2,
      2,
      2
    ],
    "controlDay": {
      "rruleOccurrence": "2026-03-22T02:30:00.000Z",
      "readAsInstant": "2026-03-22T03:30:00.000+01:00",
      "readAsInstantLocal": "2026-03-22T03:30",
      "readAsWallClock": "2026-03-22T02:30:00.000+01:00",
      "readAsWallClockLocal": "2026-03-22T02:30",
      "readAsWallClockOffsetMinutes": 60
    },
    "gapDay": {
      "rruleOccurrence": "2026-03-29T02:30:00.000Z",
      "readAsInstant": "2026-03-29T04:30:00.000+02:00",
      "readAsInstantLocal": "2026-03-29T04:30",
      "readAsWallClock": "2026-03-29T03:30:00.000+02:00",
      "readAsWallClockLocal": "2026-03-29T03:30",
      "readAsWallClockOffsetMinutes": 120
    },
    "weekAfterGap": {
      "rruleOccurrence": "2026-04-05T02:30:00.000Z",
      "readAsInstant": "2026-04-05T04:30:00.000+02:00",
      "readAsInstantLocal": "2026-04-05T04:30",
      "readAsWallClock": "2026-04-05T02:30:00.000+02:00",
      "readAsWallClockLocal": "2026-04-05T02:30",
      "readAsWallClockOffsetMinutes": 120
    }
  }
}
```
