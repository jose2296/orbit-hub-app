import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { describeSchedule, scheduledDates } from "@orbit-hub/habit-core";
import type { HabitSchedule } from "@orbit-hub/contracts";
import {
  habitScheduleSchema,
  localDateSchema,
} from "@orbit-hub/contracts";

/**
 * El selector de horario de la creacion: siete presets que compilan a lo que
 * dicen, y un campo avanzado que acepta un RRULE crudo y lo valida.
 *
 * Dos mitades a proposito. La primera ejecuta los horarios compilados contra
 * el motor de verdad (`scheduledDates`, `describeSchedule`): si un preset
 * compilara a una regla que el motor no entiende, la pantalla mentiria y el
 * push la rechazaria al sincronizar. La segunda lee el codigo de la pantalla
 * como texto (el patron de `habits-list-wiring.test.ts`): `expo-router` no
 * carga en node, asi que un render es imposible y lo que se puede romper es
 * el cableado — el preset que compila a otra cosa, el selector de dias que
 * aparece donde no toca o el guardar que no valida antes.
 */

const ZONA = "Europe/Madrid";
const DIA: `${number}-${number}-${number}` & string = "2026-03-02";

/**
 * La misma puerta que el servidor (`assertScheduleUsable`) y que la
 * pantalla: la regla se prueba contra un dia antes de guardar. Lo que aqui
 * no pasa no se encola.
 */
function utilizable(schedule: HabitSchedule): boolean {
  try {
    scheduledDates(schedule, DIA, DIA, ZONA);
    return true;
  } catch {
    return false;
  }
}

/**
 * Los siete horarios compilados, escritos tal cual los produce la pantalla.
 * La segunda mitad ata cada literal a su sitio en `new.tsx`, asi que esta
 * tabla no puede irse por su cuenta sin que se note.
 */
const COMPILADOS = {
  daily: { kind: "rrule", rule: "FREQ=DAILY" },
  weekdays: { kind: "rrule", rule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR" },
  "first-monday": { kind: "rrule", rule: "FREQ=MONTHLY;BYDAY=1MO" },
  "every-3-days": { kind: "rrule", rule: "FREQ=DAILY;INTERVAL=3" },
  "twice-week": { kind: "quota", count: 2, period: "week" },
  "once-month": { kind: "quota", count: 1, period: "month" },
  "five-year": { kind: "quota", count: 5, period: "year" },
} as const;

function fuente(ruta: string[]): string {
  return readFileSync(join(process.cwd(), "src", ...ruta), "utf8");
}

function pantalla(): string {
  return fuente(["app", "(app)", "habit", "new.tsx"]);
}

describe("los presets compilan a lo que dicen", () => {
  it("daily es todos los dias", () => {
    const schedule: HabitSchedule = { ...COMPILADOS.daily };
    expect(habitScheduleSchema.safeParse(schedule).success).toBe(true);
    expect(describeSchedule(schedule)).toEqual({ key: "daily" });
    expect(utilizable(schedule)).toBe(true);
  });

  it("weekdays son cinco dias con su BYDAY", () => {
    expect(COMPILADOS.weekdays.rule).toContain("BYDAY=MO,TU,WE,TH,FR");
    const schedule: HabitSchedule = { ...COMPILADOS.weekdays };
    expect(describeSchedule(schedule)).toEqual({
      key: "weeklyDays",
      days: ["mon", "tue", "wed", "thu", "fri"],
    });
    expect(utilizable(schedule)).toBe(true);
  });

  it("first-monday es el primer lunes con su ordinal", () => {
    expect(COMPILADOS["first-monday"].rule).toContain("BYDAY=1MO");
    const schedule: HabitSchedule = { ...COMPILADOS["first-monday"] };
    expect(describeSchedule(schedule)).toEqual({
      key: "monthlyOrdinal",
      ordinal: 1,
      weekday: "mon",
    });
    expect(utilizable(schedule)).toBe(true);
  });

  it("every-3-days lleva su intervalo", () => {
    expect(COMPILADOS["every-3-days"].rule).toContain("INTERVAL=3");
    const schedule: HabitSchedule = { ...COMPILADOS["every-3-days"] };
    expect(describeSchedule(schedule)).toEqual({
      key: "intervalDays",
      interval: 3,
    });
    expect(utilizable(schedule)).toBe(true);
  });

  it("las tres cuotas son contar por periodo, sin dias", () => {
    const cuotas = [
      COMPILADOS["twice-week"],
      COMPILADOS["once-month"],
      COMPILADOS["five-year"],
    ] as unknown as HabitSchedule[];
    expect(cuotas).toEqual([
      { kind: "quota", count: 2, period: "week" },
      { kind: "quota", count: 1, period: "month" },
      { kind: "quota", count: 5, period: "year" },
    ]);
    for (const schedule of cuotas) {
      expect(habitScheduleSchema.safeParse(schedule).success).toBe(true);
      const descripcion = describeSchedule(schedule);
      expect(descripcion.key).toBe("timesPerPeriod");
      // Una cuota no tiene fechas: el motor devuelve vacio sin lanzar.
      expect(scheduledDates(schedule, DIA, DIA, ZONA)).toEqual([]);
    }
  });
});

describe("el campo avanzado", () => {
  it("acepta un RRULE crudo que el motor entiende", () => {
    const schedule: HabitSchedule = {
      kind: "rrule",
      rule: "FREQ=WEEKLY;BYDAY=MO,WE",
    };
    expect(utilizable(schedule)).toBe(true);
    expect(describeSchedule(schedule)).toEqual({
      key: "weeklyDays",
      days: ["mon", "wed"],
    });
  });

  it("un RRULE invalido en el campo avanzado se rechaza antes de guardar", () => {
    // La pantalla valida con la misma puerta de arriba: lo que no compila
    // no llega al outbox. El codigo que lo impide se pinnea abajo.
    //
    // La cadena vacia no esta aqui a proposito: `fromString("")` no lanza,
    // devuelve los defectos (un YEARLY). Por eso la pantalla la trata como
    // "aun no hay horario" (`null`, sin guardar) en vez de preguntarle al
    // motor si vale.
    for (const rule of ["NOT_A_RULE", "FREQ=XXX"]) {
      expect(utilizable({ kind: "rrule", rule })).toBe(false);
    }
    const codigo = pantalla();
    // El mensaje sale del diccionario y el guardar esta detras de validar.
    expect(codigo).toContain('t("habits.error.invalidRule")');
    expect(codigo).toMatch(/if\s*\(\s*!.*[Vv]alid.*\)\s*return/);
  });

  it("la fecha de fin es un dia de calendario, no un texto cualquiera", () => {
    expect(localDateSchema.safeParse("2026-12-31").success).toBe(true);
    expect(localDateSchema.safeParse("2026-02-30").success).toBe(false);
    expect(localDateSchema.safeParse("manana").success).toBe(false);
    expect(pantalla()).toContain('t("habits.error.invalidDate")');
  });
});

describe("el cableado de la pantalla", () => {
  it("cada preset compila en su sitio y no en otro", () => {
    const codigo = pantalla();
    expect(codigo).toContain("FREQ=DAILY");
    // El semanal se arma con los dias marcados: los cinco por defecto dan
    // el BYDAY del preset, y el test de motor pinnea ese valor compilado.
    expect(codigo).toContain('"mon", "tue", "wed", "thu", "fri"');
    expect(codigo).toContain("FREQ=WEEKLY;BYDAY=${");
    // El mensual se arma con el dia elegido (`1MO` por defecto): el valor
    // compilado lo pinnea el test de motor, aqui el mecanismo.
    expect(codigo).toContain("FREQ=MONTHLY;BYDAY=1${");
    expect(codigo).toContain("INTERVAL=3");
    expect(codigo).toContain("count: 2");
    expect(codigo).toContain("count: 1");
    expect(codigo).toContain("count: 5");
  });

  it("el selector de dia solo aparece en los presets que lo necesitan", () => {
    const codigo = pantalla();
    // La puerta es una lista y no un "todo menos cuota": anadir un preset
    // nuevo no abre el selector por descuido.
    const puerta = codigo.match(/DAY_SELECTOR_PRESETS[^;]*;/);
    expect(puerta).not.toBeNull();
    expect(puerta?.[0]).toContain("weekdays");
    expect(puerta?.[0]).toContain("first-monday");
    expect(puerta?.[0]).not.toContain("twice-week");
    expect(puerta?.[0]).not.toContain("daily");
    // Esconderlo en "2 veces por semana" es lo que impide que alguien piense
    // que el lunes y el martes estan elegidos cuando no lo estan: una cuota
    // no tiene dias y el selector pintaria una mentira.
    expect(codigo).toMatch(/DAY_SELECTOR_PRESETS\.includes\(preset\)/);
  });

  it("la cuota se edita con cantidad y periodo, no con dias", () => {
    const codigo = pantalla();
    expect(codigo).toContain('t("habits.quota.count")');
    expect(codigo).toContain('t("habits.week")');
    expect(codigo).toContain('t("habits.month")');
    expect(codigo).toContain('t("habits.year")');
  });

  it("la vista previa sale del motor y del diccionario", () => {
    const codigo = pantalla();
    expect(codigo).toContain("describeSchedule");
    expect(codigo).toContain("habits.schedule.");
  });

  it("el titulo lo pone el layout y guardar va por el hook", () => {
    const layout = fuente(["app", "(app)", "_layout.tsx"]);
    expect(layout).toContain('name="habit/new"');
    expect(layout).toContain('t("habits.add")');
    // La pantalla no publica el suyo: el layout ya lo dice.
    expect(pantalla()).not.toContain("useScreenTitle");
    // Las mutaciones viven en `use-habits`: la pantalla consume `create`
    // del hook y no guarda por su cuenta.
    const codigo = pantalla();
    expect(codigo).toContain("useHabits");
    expect(codigo).toMatch(/const \{\s*create\s*\} = useHabits\(\)/);
    expect(codigo).toContain("await create({");
    expect(codigo).not.toContain("createHabitAction");
    expect(codigo).not.toContain('entity: "habit"');
  });

  it("el avanzado con UNTIL adopta la fecha de fin al salir del campo", () => {
    const codigo = pantalla();
    // endDate es la unica fuente de verdad: al salir del campo con un UNTIL
    // valido, el formulario lo adopta para que el guardar no sorprenda
    // reescribiendolo por detras.
    expect(codigo).toContain("extractUntilDate");
    expect(codigo).toContain("onBlur");
    expect(codigo).toContain("setEndText");
  });
});
