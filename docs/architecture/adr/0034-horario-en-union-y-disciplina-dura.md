# ADR 0034 — El horario es una union `rrule|quota`, y solo se registra lo programado

**Status:** Accepted

## Context

Se pidio RRULE completo para los habitos. Se tiene RRULE completo, pero no
puede ser lo unico, y el motivo es gramatical, no una preferencia.

RFC 5545 define una recurrencia como una `FREQ` base mas partes `BY*` que acotan
o saltan fechas. Todas: `BYDAY` (que dias), `BYMONTHDAY` (dia del mes),
`BYSETPOS` (el n-esimo de algo). `BYSETPOS=2` sobre `FREQ=MONTHLY;BYDAY=MO` es
el segundo lunes del mes: eso es *posicion*, no *cantidad*. Ningun operador de
la gramatica dice "N de los M dias de esta semana, los que yo elija".

Y lo que se pidio para "dos veces por semana" es exactamente eso: da igual que
dia se marque, con que sean dos dias distintos. Eso no es un conjunto de fechas,
es cardinalidad sobre un conjunto abierto. La gramatica no lo tiene.

Tampoco vale la salida contraria, todo-cuota, porque "cada tres dias" no es una
cuota y "el primer lunes del mes" tampoco.

## Decision

El horario es una union de dos kinds, declarada en `packages/habit-core` como
tipo puro y en `packages/contracts` como `z.discriminatedUnion`:

```ts
type HabitSchedule =
  | { kind: 'rrule'; rule: string }
  | { kind: 'quota'; count: number; period: 'week' | 'month' | 'year' };
```

Los presets compilan a una u otra: "todos los dias" es `FREQ=DAILY`, "lunes a
viernes" es `FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR`, "cada 3 dias" es
`FREQ=DAILY;INTERVAL=3`, y "2 veces por semana" es `quota { count: 2, period:
'week' }`. El campo avanzado expone el RRULE crudo y valida; `COUNT` se acepta
pero no sale en los presets, porque un habito que muere solo al llegar a N
ocurrencias es una sorpresa, no una funcion.

La doble declaracion es a proposito y no un descuido: `contracts` solo depende
de `zod`, y importar el motor meteria `rrule` y `luxon` en el grafo de
produccion de la API por un tipo que no usa. Un test de contrato compara las dos
formas para que no se separen.

Segunda parte de la decision, la disciplina dura: en un habito `rrule`, una
entrada solo existe en dia programado. Un jueves no programado no es un boton,
no hay nada que registrar, y el dia cuenta como fallado. `skipped` solo salta un
dia programado, nunca uno futuro. Para `quota` vale cualquier dia del periodo en
curso, que es justamente la razon de ser de las cuotas. La validacion vive en
`assertFechaValida` y vale para la REST y para el push por igual: una fecha
imposible se rechaza por operacion con motivo, nunca se guarda en silencio por
venir sin conexion.

## Consecuencias

- Los dos kinds no se pintan ni se rachean igual. `rrule` es fila de dias con
  si/no por dia, y la racha cuenta dias programados. `quota` es "3 de 5 esta
  semana", sin dias fallados: la racha cuenta periodos cerrados con cuota.
- Si "2 por semana" se hubiera forzado a RRULE, la app tendria que pintar una
  fila de siete puntos con dos encendidos que la persona nunca eligio, y rachear
  sobre dias que ella no programo. La union evita que eso sea un invento.
- `statusForDate` lanza a proposito en `quota`: un habito de cuota no tiene
  estado por dia, y el estado sale de `progressForPeriod`. La racha de cuota no
  lo llama nunca.
- La disciplina dura elimina de un plumazo el caso "lo hice fuera de horario",
  su columna derivada y su representacion: entrenar el jueves cuando toca lunes
  y miercoles es un fallo, no un tick verde con asterisco.
