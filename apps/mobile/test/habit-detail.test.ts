import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  currentStreak,
  periodBounds,
  progressForPeriod,
  scheduledDates,
  type HabitEntry,
} from "@orbit-hub/habit-core";
import type { HabitSchedule, LocalDate } from "@orbit-hub/contracts";

/**
 * El detalle del habito: rejilla de dias para `rrule`, contador para
 * `quota`, racha y mas larga, edicion de fin, archivar y borrar.
 *
 * Dos mitades como en `habit-schedule-picker.test.ts`. La primera ejecuta
 * el motor de verdad (`scheduledDates`, `currentStreak`,
 * `progressForPeriod`): la pantalla no calcula nada propio. La segunda lee
 * el codigo de la pantalla como texto (`expo-router` no carga en node),
 * asi que lo que se puede romper es el cableado.
 */

const ZONA = "Europe/Madrid";
/** Lunes y miercoles: el jueves no toca, y eso es lo que se comprueba. */
const REGLA_LX: HabitSchedule = { kind: "rrule", rule: "FREQ=WEEKLY;BYDAY=MO,WE" };

const DIA_MS = 86_400_000;

function masDias(fecha: LocalDate, dias: number): LocalDate {
  const base = new Date(
    Date.UTC(
      Number(fecha.slice(0, 4)),
      Number(fecha.slice(5, 7)) - 1,
      Number(fecha.slice(8, 10)),
    ) + dias * DIA_MS,
  );
  const mes = String(base.getUTCMonth() + 1).padStart(2, "0");
  const dia = String(base.getUTCDate()).padStart(2, "0");
  return `${base.getUTCFullYear()}-${mes}-${dia}` as LocalDate;
}

/** El lunes de la semana en curso en la zona del habito. */
function lunesActual(): LocalDate {
  const ahora = new Date();
  const enZona = new Date(ahora.toLocaleString("en-US", { timeZone: ZONA }));
  // getDay: 0 es domingo, asi que el retroceso a lunes es (dia + 6) % 7.
  const retroceso = (enZona.getDay() + 6) % 7;
  const base = new Date(
    Date.UTC(enZona.getFullYear(), enZona.getMonth(), enZona.getDate()) -
      retroceso * DIA_MS,
  );
  const mes = String(base.getUTCMonth() + 1).padStart(2, "0");
  const dia = String(base.getUTCDate()).padStart(2, "0");
  return `${base.getUTCFullYear()}-${mes}-${dia}` as LocalDate;
}

function marca(
  habitId: string,
  date: LocalDate,
  status: "done" | "skipped",
): HabitEntry {
  return {
    id: `entrada-${date}`,
    habitId,
    date,
    status,
    amount: null,
    note: null,
    version: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
  } as HabitEntry;
}

function fuente(ruta: string[]): string {
  return readFileSync(join(process.cwd(), "src", ...ruta), "utf8");
}

function pantalla(): string {
  return fuente(["app", "(app)", "habit", "[habitId].tsx"]);
}

describe("el detalle del habito", () => {
  it("la vista de semana muestra una fila por dia programado", () => {
    const lunes = lunesActual();
    const semana = periodBounds("week", lunes, 0, ZONA);
    const dias = scheduledDates(REGLA_LX, semana.start, semana.end, ZONA);
    // Lunes y miercoles, y nada mas: dos filas, no siete.
    expect(dias).toHaveLength(2);
    expect(dias[0]).toBe(lunes);
    expect(dias[1]).toBe(masDias(lunes, 2));
    // Y la pantalla pinta sus filas desde esa misma funcion, con una fila
    // por dia programado.
    expect(pantalla()).toContain("scheduledDates");
    expect(pantalla()).toContain("habit-day-");
  });

  it("un dia no programado no es pulsable", () => {
    const lunes = lunesActual();
    const jueves = masDias(lunes, 3);
    const semana = periodBounds("week", lunes, 0, ZONA);
    const dias = scheduledDates(REGLA_LX, semana.start, semana.end, ZONA);
    // El jueves en un habito L/X: sin feedback, sin haptic, sin nada.
    expect(dias).not.toContain(jueves);
    // La pantalla solo pinta dias programados (salen de `scheduledDates`),
    // asi que un dia que no toca ni siquiera tiene fila que pulsar. Y lo
    // futuro va deshabilitado: `disabled` en la misma fila.
    expect(pantalla()).toContain("scheduledDates");
    expect(pantalla()).toContain("disabled");
  });

  it("el dia de hoy se puede saltar sin romper la racha", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    const registro = {
      id,
      name: "Leer",
      schedule: { kind: "rrule", rule: "FREQ=DAILY" } as HabitSchedule,
      timezone: ZONA,
      weekStart: 0 as const,
      startDate: "2026-01-01" as LocalDate,
      endDate: null,
      targetValue: null,
    };
    // Ayer y anteayer hechos: racha de dos.
    const base = [
      marca(id, masDias("2026-10-05" as LocalDate, -1), "done"),
      marca(id, masDias("2026-10-05" as LocalDate, -2), "done"),
    ];
    const dia = "2026-10-05" as LocalDate;
    const antes = currentStreak(registro, base, dia);
    // Saltar hoy no suma ni rompe: la racha queda igual.
    const despues = currentStreak(
      registro,
      [...base, marca(id, dia, "skipped")],
      dia,
    );
    expect(antes).toBe(2);
    expect(despues).toBe(2);
    // Y la pantalla ofrece el salto: llama a `skip`.
    expect(pantalla()).toContain("skip(");
  });

  it("un habito de cuota no muestra una fila de dias", () => {
    const id = "00000000-0000-4000-8000-000000000002";
    const horario: HabitSchedule = { kind: "quota", count: 2, period: "week" };
    const registro = {
      id,
      name: "Correr",
      schedule: horario,
      timezone: ZONA,
      weekStart: 0 as const,
      startDate: "2026-01-01" as LocalDate,
      endDate: null,
      targetValue: null,
    };
    const lunes = lunesActual();
    const progreso = progressForPeriod(
      registro,
      "week",
      masDias(lunes, 1),
      [marca(id, lunes, "done"), marca(id, masDias(lunes, 1), "done")],
    );
    // Muestra el progreso del periodo. Esta es la consecuencia de la union.
    expect(progreso).toEqual({ done: 2, target: 2, open: expect.any(Boolean) });
    const codigo = pantalla();
    expect(codigo).toContain("progressForPeriod");
    expect(codigo).toContain('t("habits.quota.progress"');
    // La rejilla de dias vive solo en la rama `rrule` (la pantalla
    // discrimina por `schedule.kind`); la cuota tiene su propia rama y su
    // propio contador.
    expect(codigo).toContain("schedule.kind");
    expect(codigo).toContain('"rrule"');
    expect(codigo).toContain('"quota"');
  });

  it("cambiar de semana a mes a ano cambia el periodo", () => {
    const lunes = lunesActual();
    const semana = periodBounds("week", lunes, 0, ZONA);
    const mes = periodBounds("month", lunes, 0, ZONA);
    const ano = periodBounds("year", lunes, 0, ZONA);
    // Tres periodos distintos que contienen al dia: el selector cambia de
    // verdad lo que se mira.
    expect(semana.start >= mes.start).toBe(true);
    expect(mes.start >= ano.start).toBe(true);
    expect(semana.end <= ano.end).toBe(true);
    expect(
      semana.start !== mes.start ||
        semana.end !== mes.end ||
        mes.start !== ano.start,
    ).toBe(true);
    const codigo = pantalla();
    // El selector ofrece los tres (una plantilla sobre la familia
    // `habits.*`, que el test de traducciones cubre) y el periodo alimenta
    // los limites.
    for (const pieza of [
      "periodBounds",
      "PERIOD_ORDER",
      "habits.${option}",
    ]) {
      expect(codigo).toContain(pieza);
    }
  });

  it("la seccion de recordatorios no aparece", () => {
    // FEATURES.pushNotifications es false. Un boton muerto es peor que nada.
    const codigo = pantalla();
    expect(codigo).not.toMatch(/remind/i);
    expect(codigo).not.toMatch(/notification/i);
  });

  it("pone su titulo desde los datos y no desde el layout", () => {
    const layout = fuente(["app", "(app)", "_layout.tsx"]);
    // El layout pone el vacio, como en list/[listId] y note/[noteId].
    expect(layout).toContain('name="habit/[habitId]"');
    expect(layout).toMatch(/name="habit\/\[habitId\]"[^>]*title: ""/);
    // La pantalla lo llena con el nombre del habito.
    expect(pantalla()).toContain("useScreenTitle");
  });

  it("lee y escribe por useHabit, sin llamadas propias", () => {
    const codigo = pantalla();
    for (const pieza of [
      "useHabit",
      "describeSchedule",
      "currentStreak",
      "longestStreak",
      "habits.streak",
      "habits.longestStreak",
      "update({",
      "archive()",
      "unarchive()",
      "remove()",
      't("habits.endDate")',
    ]) {
      expect(codigo).toContain(pieza);
    }
  });
});
