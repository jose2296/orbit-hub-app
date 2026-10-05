# Habitos: un tracker con recurrencia real, recordatorios y tarjetas en el panel

Estado: por implementar. Bloqueado por el PR #36.

Continuacion de la fase "Eventos, recurrencia, recordatorios" del roadmap
(`docs/roadmap.md:280`), que hoy no existe de ninguna manera: no hay `weekday`, ni
`cron`, ni `due`, ni `reminder` en todo el repo, y `list_items` **no tiene ni una
columna de fecha**.

Este documento describe el sistema entero, pero **el plan de implementacion cubre
solo la fase 1**. Las fases 2 y 3 quedan disenadas a nivel de datos para que no
obliguen a migrar, y cada una lleva su propio spec y su propio plan cuando le
llegue el turno.

Lo que hay que construir desde cero, y lo que ya existe:

| Falta | Ya existe |
| --- | --- |
| Modelo de recurrencia | Panel de 4x6 con arrastre, resize, 8 paginas, persistido y con merge |
| Motor de fechas y rachas | Sincronizacion local-first con outbox y merge a tres vias |
| Avisos (push y email) | Transporte de correo por Resend, con plantillas y transporte `noop` para tests |
| Pantallas | Orden fraccional para reordenar, tokens de tema, diccionarios es/en |

Y una correccion de partida: `AGENTS.md` decia que no habia emulador en esta
maquina. Hay uno (`Medium_Phone_API_35`), asi que Android **si** se verifica a mano.
Ver la seccion "Como se comprueba".

---

## Que se pide, exactamente

Una persona abre Habitos, pulsa anadir, escribe "Ir al gim" y elige cuando:

- **Lunes, martes y miercoles.** Aparece una fila de siete puntos, con L, M y X
  encendidos y los otros cuatro apagados. Cada dia programado se pulsa y se pone
  verde. Puede saltar un dia ("hoy no aplica") sin que la racha se rompa.
- **Dos veces por semana.** No hay puntos: hay una cuenta, "1 de 2 esta semana".
  Puede marcar el martes o el jueves, lo que sea, y el mismo dia no cuenta dos
  veces.
- **Uno al mes.** "0 de 1 este mes".
- **Todos los dias**, **lunes a viernes**, **el primer lunes del mes**, **cada tres
  dias**, **un RRULE escrito a mano** en el campo avanzado.

Ademas puede poner un numero: "Beber agua", meta 8 vasos, y marcar cuanto se bebe.
Y puede dejar el habito en el panel, con tamano 2x1, 2x2, 4x2 o completo, y con un
recordatorio a las 08:00 que le llega al movil o al correo.

Y en el detalle, el progreso de la semana, del mes y del ano.

---

## 1. La recurrencia es una union, no un RRULE

### Lo que se pide y por que no alcanza con un RRULE

Se pidio RRULE completo. Se va a tener RRULE completo, pero **no puede ser lo
unico**, y el motivo es gramatical, no una preferencia.

RFC 5545 define una recurrencia como una `FREQ` base mas un conjunto de partes
`BY*` que acotan o saltan fechas. Todas. `BYDAY` (que dias), `BYMONTHDAY` (dia del
mes), `BYSETPOS` (el n-esimo de algo).

`BYSETPOS=2` sobre `FREQ=MONTHLY;BYDAY=MO` es **el segundo lunes del mes**. Eso es
*posicion*, no *cantidad*. Ningun operador de la gramatica dice "N de los M dias de
esta semana, los que yo elija". La gramatica no lo tiene.

Y lo que se pidio para "dos veces por semana" es exactamente eso:

> si pone 2 veces por semana da igual que dia lo marque, eso si tiene que marcar el
> habito 2 dias diferentes

Eso, por definicion, **no es un conjunto de fechas**. Es cardinalidad sobre un
conjunto abierto. Si se fuerza a RRULE, la aplicacion tiene que elegir dos dias por
la persona y mostrarlos como si los hubiera agendado: mentir en la pantalla donde
mas le importa.

Tampoco sirve la salida contraria, todo-cuota, porque "cada tres dias" no es una
cuota.

De ahi la union:

```ts
type HabitSchedule =
  | { kind: 'rrule'; rule: string }
  | { kind: 'quota'; count: number; period: 'week' | 'month' | 'year' };
```

### Los presets compilan a una u otra

| Lo que escribe la persona | Compila a |
| --- | --- |
| Todos los dias | `FREQ=DAILY` |
| Lunes a viernes | `FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR` |
| El primer lunes del mes | `FREQ=MONTHLY;BYDAY=1MO` |
| Cada 3 dias | `FREQ=DAILY;INTERVAL=3` |
| 2 veces por semana | `quota { count: 2, period: 'week' }` |
| 1 vez al mes | `quota { count: 1, period: 'month' }` |
| 5 al ano | `quota { count: 5, period: 'year' }` |

El campo "avanzado" expone el RRULE crudo y valida. `UNTIL` aparece en la interfaz
como "fecha de fin", que es un concepto real ("gim hasta marzo"). `COUNT` se acepta
en el campo avanzado pero no sale en los presets: un habito que muere solo al
llegar a N ocurrencias es una sorpresa, no una funcion.

### La consecuencia: los dos kinds no se ven ni se rachean igual

- **`rrule`** → fila de dias, cada dia programado es un si/no. La racha cuenta
  **dias programados**.
- **`quota`** → "3 de 5 esta semana". **No existen dias fallados**, existen periodos
  cerrados sin cuota. La racha cuenta **periodos**.

Esta es la parte que la union evita que sea un invento: si se hiciera entrar "2 por
semana" en RRULE, la app tendria que pintar una fila de siete puntos con dos
encendidos que la persona nunca eligio, y una racha sobre dias que ella no
programo.

---

## 2. El modelo de datos

Dos entidades.

### `habits`

| Columna | Notas |
| --- | --- |
| `id`, `user_id` | `user_id` cascade a `users`. **Personal, no de workspace.** |
| `name`, `description` | |
| `schedule` | `jsonb`, la union de arriba |
| `timezone` | IANA, **congelada al crear** |
| `week_start` | `0` lunes, `1` domingo. Defecto lunes (ISO). Va en el habito y no en el usuario: quien cuenta "dos veces por semana" pensando en domingo a sabado necesita otra semana, y obligar a elegir una sola para toda la cuenta obligaria a uno de los dos a mentir |
| `start_date`, `end_date` | `date`. `start_date` = dia de creacion |
| `target_value` | `int` nullable |
| `position` | Fractional order keys, como `lib/content-order.ts` |
| `archived_at` | No se borra un habito con historia |
| `version`, timestamps, `deleted_at` | Igual que el resto |

**Personal, y por que.** Todo el contenido de la aplicacion es de un workspace, pero
un habito no es de un equipo. Meterlo en `workspaces` obligaria a decidir que pasa
cuando alguien sale del espacio — ¿se borran sus habitos?— y a mantener permisos para
algo que nunca se comparte. Los habitos cuelgan de `users`.

**`target_value` es un entero nullable, y nada mas.** Con `NULL` es binario. Con `8`
es "8 vasos". Un `target_kind` sobraria: no hay ningun tercer caso.

**La zona horaria se congela al crear.** Si la persona muda de pais, el historico no
se reinterpreta con reglas nuevas. Es la unica forma de que la racha de hace seis
meses siga significando lo que significaba.

### `habit_entries`

| Columna | Notas |
| --- | --- |
| `id`, `habit_id` | cascade |
| `date` | **`date`, no `timestamptz`** |
| `status` | `done \| skipped` |
| `amount` | `int` nullable, para la meta |
| `note` | texto libre |
| `version`, timestamps, `deleted_at` | |

Con `UNIQUE (habit_id, date)`.

### Cuatro decisiones que despues se pagan caras si se toman mal

**1. `date` es un `date`, no un `timestamptz`.** "El lunes" es un concepto de
calendario local. Con un timestamp, viajar a Tokio cambia lo que fue "el lunes". Con
la fecha plana el registro viaja con la persona. No se puede corregir despues sin
migrar.

**2. `UNIQUE (habit_id, date)` ES la regla "un dia cuenta una sola vez".** A nivel de
datos, no de interfaz. Marcar cuando ya esta marcado es un `UPDATE`, nunca un
segundo `INSERT`. No se confia en que el boton se acuerde.

**3. La zona horaria congelada**, ya dite antes, por la misma razon: el historico
es un hecho, no un calculo que se vuelve a hacer.

**4. `archived_at`, no borrado.** Una racha de un habito que ya no se usa sigue
teniendo que poder leerse. Borrar el habito y con el su historia seria perder datos
que la persona Todavia quiere ver.

### Disciplina dura: solo se registra lo programado

En un habito `rrule`, **`habit_entries.date` siempre pertenece a las fechas
programadas**. Un jueves no programado no es un boton: no hay nada que registrar, y
el dia cuenta como fallado. Lo mismo para `skipped`: solo se salta un dia que estaba
programado, y nunca uno futuro.

Esto convierte una convencion de interfaz en una restriccion de tabla, y elimina de
un plumazo el caso "lo hice fuera de horario", su columna derivada y su
representacion. Una persona que entrena lunes y miercoles y va el jueves va tarde: lo
que se pinto en el panel es un fallo, no un.tick verde con asterisco.

Para un habito `quota` cualquier dia del periodo es registrable, que es justamente
la razon de ser de las cuotas.

### Donde vive el motor

El calculo de rachas, progreso y fechas programadas **tiene que ser el mismo codigo
en la API y en el movil**: la aplicacion recalcula al instante al marcar sin conexion,
y la API recalcula al proyectar el pull. Dos implementaciones divergen, y divergen
justo en el numero que la persona mira.

`packages/contracts` es el limite de la red (regla 4 de `AGENTS.md`); un motor de
fechas no cruza ese limite. De ahi un paquete nuevo:

```
packages/habit-core/     puro, sin I/O. deps: rrule + luxon
```

Mismo patron que `contracts` y `config`. Cuesta tocar `build:packages` en el
paquete raiz, que hoy solo construye los otros dos. Es el precio de no duplicar la
aritmetica.

### Libreria: `rrule` + `luxon`

El repositorio tiene **cero** librerias de fecha. La eleccion es nueva.

Verificado en la documentacion oficial de RRule.js: **`tzid` es de primera** y el
calculo corre dentro de esa zona con el cambio de hora resuelto. Eso es lo que hace
que "todos los lunes a las 08:00" siga siendo lunes a las 08:00 aunque cambie el
offset.

Un detalle documentado que sale mal si no se sabe: **RRule devuelve `Date` en UTC**,
asi que los componentes locales se leen con `getUTC*()` y **no** con `get*()`. Quien
use `getHours()` tiene un bug de una hora dos veces al ano.

Se descarto `@js-temporal/polyfill`: es mas correcto en la teoria, pero obliga a
implementar la expansion del RFC a mano, que es justo donde aparece el error de un
dia del ultimo domingo de octubre.

### La sincronizacion, y por que no es opcional

`AGENTS.md` (regla 7) dice que toda ruta de escritura tiene que funcionar sin
conexion. Marcar un habito en un avion no funciona si no entra al outbox.

`'habit'` y `'habit_entry'` se anaden a `syncEntitySchema`, con su bloque en el
`push`, en el `pull` y en el repositorio, y el `merge` dedicado en el movil.

Un detalle que sale al implementarlo y que conviene no asumir: `cached_entities`
(`apps/mobile/src/lib/offline/local-store.ts:137`) es **una tabla generica con
`PRIMARY KEY (entity, entity_id)`**, no una tabla por entidad, y las dos
implementaciones (SQLite y Web Storage) guardan lo mismo con esa clave. Asi que un
hábito nuevo **no necesita tabla de cache en ninguna de las dos**: necesita el
indice por padre si se consulta por `habit_id`, que es el patron de `listCachedItems`.

Y un hueco de forma que hay que cerrar a proposito: **hoy todo lo que se sincroniza
es de un workspace** y pasa por `assertCanWrite` / `assertCanDelete`. Un hábito
personal es una forma nueva en este esquema, asi que la rama personal de esas
comprobaciones se escribe explicita, no siguiendo el molde de `list`.

El merge merece regla propia y no la generica de "gana el servidor": marcar un
habito el martes desde el telefono y desde la tablet **no es un conflicto**, es que
lo hizo. Precedencia:

```
done  >  skipped  >  borrado
```

Determinista, sin tormentas de conflicto, y aplica a la operacion mas concurrente
que va a existir en la aplicacion: tocar un checkbox en dos dispositivos. La regla
generica de `docs/architecture/offline-sync.md` habria abierto un conflicto en cada
doble toque.

En el movil el merge no va en `lib/offline/merge/` porque **ese directorio no
existe**: la logica por entidad son archivos sueltos en `apps/mobile/src/lib/offline/`
(`dashboard-row.ts`, `apply-panel.ts`, `coalesce.ts`). El de habitos va junto a ellos,
`habit-row.ts`.

---

## 3. El motor, y las cuatro reglas de la racha

Funciones puras en `packages/habit-core`:

| Funcion | Que hace |
| --- | --- |
| `scheduledDates(schedule, from, to, tz)` | Fechas programadas, **ventana acotada** |
| `periodBounds(period, date, weekStart, tz)` | Limites de semana, mes y ano |
| `statusForDate(habit, date, entries)` | Solo para `rrule`: `due \| done \| skipped \| missed \| not_due`. Un habito `quota` **no tiene estado por dia** — no existen dias fallados — asi que para ese kind esta funcion no aplica y el estado sale de `progressForPeriod` |
| `progressForPeriod(habit, period, entries)` | El "3 de 5" |
| `currentStreak(habit, entries, today)` | La dificil |
| `longestStreak(habit, entries)` | Para la tarjeta del panel |
| `completionRate(habit, entries, range)` | Porcentaje de un rango |

`scheduledDates` **nunca** expande sin limite. Recibe `from` y `to` y devuelve como
mucho lo que cae entre los dos. Un `FREQ=YEARLY` sin `UNTIL` pedido sobre un rango
abierto es un bucle infinito esperando happen.

Las cuatro reglas, y que bug tapa cada una:

**1. El dia de hoy no rompe la racha.** Si hoy esta programado y todavia no esta
marcado, la racha sigue. El recorrido hacia atras arranca en ayer mientras hoy este
pendiente. Sin esta regla la aplicacion dice "racha rota" a las nueve de la manana,
que es exactamente cuando la gente mira.

**2. `skipped` es neutro.** No rompe y no suma. Es "hoy no aplica": ni premio ni
castigo. Si sumara, saltar todos los dias dari una racha infinita con cero dias
hechos. Si rompiera, seria un castigo por algo que la persona decidio
conscientemente.

**3. Para `rrule` la racha cuenta dias programados.** El recorrido termina en
`start_date`, nunca antes. Los dias previos a que el habito existiera no son fallos
de nadie.

**4. Para `quota` la racha cuenta periodos**, no dias. El periodo en curso cuenta
desde que se cumple; mientras este abierto y sin cuota, no rompe. Cerrado sin cuota,
si.

---

## 4. API y la ruta de escritura sin conexion

`apps/api/src/routes/habits.ts`, montado en `apps/api/src/routes/index.ts`, con las
convenciones que ya usa el repositorio: `requireAuth` a nivel de router,
`HttpError` sin `try/catch`, `sendData`, re-validar el contrato en el borde, y **200
y no 201** en las acciones.

```
GET    /habits?include=archived          lista + proyeccion de resumen
POST   /habits
PATCH  /habits/:habitId
POST   /habits/:habitId/archive   ·  /unarchive
DELETE /habits/:habitId                  borrado logico
GET    /habits/:habitId/entries?from&to  ventana acotada
POST   /habits/:habitId/entries
PATCH  /habits/:habitId/entries/:date
DELETE /habits/:habitId/entries/:date    desmarcar
```

Los 422 que hacen que la disciplina sea real y no una sugerencia:

| Situacion | Respuesta |
| --- | --- |
| Fecha no programada en un habito `rrule` | *"Este habito no esta programado el jueves. El proximo dia programado es el lunes."* |
| Fecha futura | 422 |
| Fecha anterior a `start_date` | 422 |
| `amount` fuera de rango, `quota.count` en 0 o mayor a 31 por semana | 422 |

El mensaje de la primera importa: decir *que* dia sigue es la diferencia entre
"no puedes" y "el lunes te toca". Sin eso parece un bug.

### La escritura sin conexion

Un check-in sigue la ruta que ya usa el resto de la aplicacion:

1. Validar contra `habitEntrySchema`.
2. **Validar contra el horario local**, en el cliente, sin red. El habito esta
   cargado, asique el "¿este dia estaba programado?" se responde en memoria. Sin
   esto, alguien en un avion marca un jueves imposible, lo encola, y se entera al
   sincronizar, cuando ya no puede hacer nada.
3. Escribir en local (optimista).
4. Encolar la operacion con `operationId`, `baseVersion` y `base`.
5. Pintar, y dejar que el debounce de 1.5s del motor de sync la descargue.

---

## 5. La interfaz

Tres pantallas nuevas:

| Ruta | Que hace |
| --- | --- |
| `app/(app)/habits.tsx` | Lista: nombre, horario en lenguaje natural, estado de hoy, racha |
| `app/(app)/habit/new.tsx` | Crear |
| `app/(app)/habit/[habitId].tsx` | Detalle: semana / mes / ano, historial, editar, archivar |

Mas una fila en `components/layout/drawer.tsx` y un `Stack.Screen` en
`(app)/_layout.tsx`. El panel **no** se declara en el `Stack` a proposito, y el
propio archivo lo explica en un comentario que empieza en "*The panel is not
declared here, and that is deliberate*": un `Stack.Screen` con `options` reaplica y
pisa la cabecera de la pantalla. Habitos si se declara, porque es una pantalla normal
con su titulo.

### El resumen del horario se escribe en este repositorio, no con `toText()`

RRule trae `toText()`, y **solo devuelve ingles**. Volcar `Every Monday and Wednesday`
en una aplicacion con diccionarios es/en es exactamente el tipo de cosa que se
cuela sin que nadie la mire.

Asique `habit-core` devuelve un **descriptor estructurado** y la capa de
aplicacion lo formatea con claves del diccionario:

```ts
describeSchedule(schedule): { kind: 'weekly_days'; days: ['mo', 'we'] }
```

El i18n se queda en la aplicacion, que es donde lo quiere `AGENTS.md`, y el patron
de "la clave va detras de la plantilla" que ya se uso en las etiquetas.

### Los recordatorios no son un boton muerto

La seccion de recordatorios **no aparece** mientras `FEATURES.pushNotifications` sea
`false`, que es su valor actual. Cuando la fase 3 la encienda, aparece sola. Un
boton visible que no hace nada es peor que un boton que no existe.

### Ni un token de tema nuevo

`emerald` para lo cumplido, `rose` para lo fallado, `amber` para lo pendiente de
hoy. Los tres son acentos que ya existen en `apps/mobile/src/theme/tokens.ts` (la
constante `ACCENT` cubre `orbit`, `violet`, `emerald`, `amber` y `rose`). La regla 6
se respeta sin tocar el design system.

---

## 6. Fase 2: las tarjetas en el panel

Fuera del plan de esta fase, pero el modelo de datos ya esta preparado para que no
haya migracion. Es lo que se decide aqui, para que la fase 3 no lo herede:

- Se anaden `habit` y `habits_overview` al enum `kind` de `dashboardWidgetSchema`, en
  `packages/contracts/src/workspace.ts` (hoy sus miembros son `recent_lists`,
  `recent_notes`, `folder`, `tasks`, `quick_actions`, `calendar` y `stats`). Hay que
  tocar tambien `lib/dashboard/card-kind.ts`, `lib/dashboard/pin.ts` y el merge de
  `lib/offline/dashboard-row.ts`.
- `habit` es una tarjeta de un habito. `habits_overview` es un resumen de todos.
- **Los presets de tamano son sobre la rejilla de 4 columnas, no de 12.** La rejilla
  del panel es `PANEL_COLUMNS = 4` x `PANEL_ROWS = 6` (`lib/dashboard/panel.ts:43,52`).
  Los presets son `2x1` (compacto), `2x2` (mini), `4x2` (tarjeta) y `4x6` (completo).
- Un "3x1" sobre una rejilla de 4 columnas deja un resto de una columna, asi que el
  ancho no se parte en dos mitades y el arrastre se ve raro. Por eso no es preset.

El panel ya trae todo lo demas: arrastre, resize con `clampSize`, paginas, y merge
entre dispositivos.

---

## 7. Fase 3: los recordatorios

Fuera del plan de esta fase. Lo que ya se sabe del terreno:

- **No hay push.** Ni `expo-notifications`, ni `expo-device`, ni tabla de tokens, ni
  ruta. Habria que anadir las dependencias, la tabla de tokens por dispositivo, y el
  registro en el arranque.
- **No hay worker ni cron.** Hoy cada envio de correo es sincrono dentro de un
  request (`apps/api/src/modules/email/email.ts`). Un recordatorio es trabajo
  programado, asi que hace falta un proceso aparte y su despliegue programado.
- `PUSH_DEFAULTS` ya existe en `packages/config/src/index.ts:42-46` con
  `digestHour: 9` y `maxPerDay: 20`, **y no lo referencia nadie**. Es una constante
  muerta que la fase 3 rescata.
- Correo: ya esta. Resend con plantillas y con `EMAIL_TRANSPORT=noop` para tests, asi
  que los tests de la fase 3 no mandan correo de verdad.
- El aviso llega aunque la app este cerrada, que es el motivo de hacerlo en el
  servidor y no en el dispositivo.
- **En web no hay push.** Queda como limitacion declarada, no como sorpresa.

---

## Que hay que actualizar al terminar

| Archivo | Que |
| --- | --- |
| `docs/roadmap.md` | La linea 280 de la fase 7 |
| `docs/architecture/data-model.md` | Las dos tablas y por que `date` es `date` |
| `docs/architecture/offline-sync.md` | Las dos entidades y el merge `done > skipped > borrado` |
| `docs/architecture/adr/` | ADR nuevo: por que `schedule` es una union y no RRULE puro. El numero siguiente libre; hoy la serie salta de 0009 a 0032 |
| `packages/config/src/index.ts` | Nada: `FEATURES` no cambia en la fase 1 |
| `AGENTS.md` | Ya corregido en el PR #36 |

## Lo que no se pide

- **Compartir habitos.** Ni por workspace, ni entre personas. Es personal y punto.
- **Niveles, puntuaciones, seguidores, realising streaks.** Nada social.
- **Migrar RRULEs existentes.** No hay ninguno: la entidad es nueva.
- **Historial hacia atras desde antes de `start_date`.** Empieza hoy; despues se puede
  marcar hacia atras, desde el inicio y no antes.
- **La Fase 2 y la Fase 3.** Diseñadas, no implementadas.

## Como se comprueba

**A mano, en claro y oscuro.** Es la comprobacion que `AGENTS.md` exige y la que mas
bugs encuentra, porque es la rapida.

**Y en el emulador de Android.** `Medium_Phone_API_35`, visible como `emulator-5554`.
Correccion de `AGENTS.md` incluida en el PR #36.

Los casos que hay que probar a mano, no solo en test: la fila de dias con L/M/X
encendidos, el "1 de 2" de una cuota, el dia saltado que no rompe la racha, y el
cambio de semana a mes a ano en el detalle.

## Como se comprueba en automatico

`packages/habit-core` es la parte mas testeable del proyecto: funciones puras, sin
I/O. Ahi van los casos que matan habit trackers:

- Habito a las 08:00 en `Europe/Madrid` cruzando **los dos** cambios de hora del ano.
- **El ultimo domingo de marzo a las 02:30**: en Madrid esa hora local **no existe**,
  el reloj salta de 02:00 a 03:00. **La ocurrencia no se pierde: se mueve al primer
  instante valido despues del hueco**, las 03:00 de ese mismo dia. Se decide asi y no
  saltandola porque el dia estaba programado y la persona no lo salto: descartarla
  fabricaria un fallo que nadie cometio. Y para un recordatorio, disparar a las 03:00
  es tarde; a las 00:00 del dia siguiente seria tarde de otra manera.
- `BYMONTHDAY=31` en febrero: se salta, no rompe.
- `FREQ=YEARLY` sin `UNTIL` con la ventana acotada: no se cuelga.
- **El error de uno de la racha**: hoy sin marcar, ayer cumplido, la racha sigue viva.
- `skipped` neutro: ni suma ni rompe, y saltar todo un mes da racha 0.
- El recorrido termina en `start_date`.
- Un dia cuenta una sola vez: marcar, desmarcar y remarcar no acumula.
- Cuota: 2 dias distintos, si; el mismo dia dos veces, no.

En la API, con PGlite:
- La `UNIQUE (habit_id, date)` de verdad, con dos inserts.
- Cada 422 de la tabla de arriba.
- **Que el usuario A no pueda leer el habito del usuario B.** La autorizacion es del
  servidor; el cliente no es una frontera de seguridad (regla 8).

En el movil, tests de modulo puro como el resto:
- La forma de la operacion que entra al outbox.
- La precedencia del merge.
- La salida de `describeSchedule` para cada preset.
- La validacion local de una fecha no programada, que es la que hace que la disciplina
  funcione sin conexion.

## El riesgo que se admite

**RRule resuelve `tzid` con `Intl.DateTimeFormat`, y Hermes necesita ICU completo
para honrar una zona IANA.** Si Hermes en Android viene sin eso, `tzid` falla en el
movil y funciona en web, que es el peor tipo de bug: verde en el navegador, roto en
el dispositivo, y el navegador es justo donde se mira primero.

Por eso **la primera tarea de la fase 1 es una prueba de concepto**, antes de
escribir el motor: correr `rrule + luxon` con `tzid` **en el emulador y en web**, y
comprobar los dos cambios de hora mas la hora local que no existe.

Si falla, el plan B es `rrule-temporal`, que existe y usa `Temporal.PlainDate`. El
plan C es peor y por eso queda anotado: expandir la recurrencia **solo en el
servidor**. Funciona, pero convierte cada marcado en una ida y vuelta, y rompe la
regla 7 en el momento en que no hay conexion.

## El bloqueo

Esta fase no se puede empezar hasta que se mergee el **PR #36**, que arregla
`apps/api/src/db/client.ts` y devuelve 508 tests de la API a verde. Los tests de
habitos corren sobre PGlite, y escribirlos encima de una suite roja hace que no se
pueda distinguir un fallo propio de uno heredado.