import { periodBounds, scheduledDates, todayIn } from '@orbit-hub/habit-core';
import type { HabitSchedule, LocalDate } from '@orbit-hub/contracts';

import { HttpError } from '../../lib/http-error.js';

/**
 * Lo minimo que una validacion de fecha necesita de un habito.
 *
 * `HabitRow` (drizzle) lo cumple tal cual y el sync lo construye desde la
 * fila almacenada: una sola forma de decir "dia valido", la usen la REST o
 * el motor de sync.
 */
export interface FechaContext {
  schedule: HabitSchedule;
  timezone: string;
  weekStart: 0 | 1;
  startDate: LocalDate;
  endDate: LocalDate | null;
}

/** Dias en cristiano y sin tildes, para el 422 que nombra el proximo dia. */
const DIAS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'] as const;

function diaSemana(fecha: LocalDate): string {
  const [anio, mes, dia] = fecha.split('-').map(Number);
  const nombre = DIAS[new Date(Date.UTC(anio as number, (mes as number) - 1, dia as number)).getUTCDay()];
  return nombre ?? fecha;
}

function diaMas(fecha: LocalDate, dias: number): LocalDate {
  const [anio, mes, dia] = fecha.split('-').map(Number);
  const base = new Date(Date.UTC(anio as number, (mes as number) - 1, dia as number));
  base.setUTCDate(base.getUTCDate() + dias);
  const mesTexto = String(base.getUTCMonth() + 1).padStart(2, '0');
  const diaTexto = String(base.getUTCDate()).padStart(2, '0');
  return `${base.getUTCFullYear()}-${mesTexto}-${diaTexto}`;
}

export function assertRango(startDate: LocalDate, endDate: LocalDate | null): void {
  if (endDate !== null && endDate < startDate) {
    throw HttpError.validation('El fin no puede ser anterior al inicio');
  }
}

/**
 * La zona y la regla tienen que valer antes de guardar.
 *
 * Una regla rota no puede esperar al primer check-in para reventar: ahi ya
 * seria un 500 en una ruta que promete 422, asi que se prueba aqui con la
 * misma funcion que luego valida las fechas.
 */
export function assertScheduleUsable(schedule: HabitSchedule, timezone: string): void {
  let hoy: LocalDate;
  try {
    hoy = todayIn(timezone);
  } catch {
    throw HttpError.validation('Esa zona horaria no existe');
  }
  if (schedule.kind === 'quota') return;
  try {
    scheduledDates(schedule, hoy, hoy, timezone);
  } catch {
    throw HttpError.validation('Esa regla de repeticion no se entiende');
  }
}

/**
 * El proximo dia programado despues de `fecha`, con la misma funcion que
 * decide si un dia vale. Sin ella el 422 seria un muro; con ella es una
 * cita: "el lunes te toca".
 */
function proximoProgramado(habit: FechaContext, fecha: LocalDate): LocalDate | null {
  if (habit.schedule.kind !== 'rrule') return null;
  const desde = diaMas(fecha, 1);
  const encontrados = scheduledDates(habit.schedule, desde, diaMas(desde, 365), habit.timezone);
  return encontrados[0] ?? null;
}

/**
 * La disciplina dura: esto es lo que hace que "disciplina dura" sea algo y
 * no un texto. La fecha se valida contra el horario local antes de insertar,
 * y cada rechazo es un 422 que dice por que.
 *
 * Vale para la REST y para el sync por igual: el push rechaza por operacion,
 * con motivo, sin bloquear el uso offline, igual que cualquier otra
 * validacion. Una fecha imposible no se guarda en silencio por venir sin
 * conexion.
 */
export function assertFechaValida(habit: FechaContext, fecha: LocalDate): void {
  const hoy = todayIn(habit.timezone);
  if (fecha > hoy) {
    throw HttpError.validation('No se puede registrar en el futuro');
  }
  if (fecha < habit.startDate) {
    throw HttpError.validation('Ese dia es anterior al inicio del habito');
  }
  if (habit.endDate !== null && fecha > habit.endDate) {
    throw HttpError.validation('Ese dia es posterior al fin del habito');
  }
  if (habit.schedule.kind === 'quota') {
    // En una cuota cualquier dia del periodo abierto vale: no hay dias
    // fijados, solo un contador por periodo.
    const periodo = periodBounds(habit.schedule.period, hoy, habit.weekStart, habit.timezone);
    if (fecha < periodo.start || fecha > periodo.end) {
      throw HttpError.validation('Ese dia no esta en el periodo en curso');
    }
    return;
  }
  if (scheduledDates(habit.schedule, fecha, fecha, habit.timezone).length === 0) {
    const proximo = proximoProgramado(habit, fecha);
    if (proximo === null) {
      throw HttpError.validation(
        `Este habito no esta programado el ${diaSemana(fecha)} ni ningun dia posterior`,
      );
    }
    throw HttpError.validation(
      `Este habito no esta programado el ${diaSemana(fecha)}. El proximo dia programado es el ${diaSemana(proximo)}`,
    );
  }
}
