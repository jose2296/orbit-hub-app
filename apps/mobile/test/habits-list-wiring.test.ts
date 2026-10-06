import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * La lista de habitos, cableada y no escrita a mano.
 *
 * Como en `drawer.test.ts`: el fallo aqui es estructural y se lee en el
 * codigo fuente. Un render probaria react-native; lo que se puede romper es
 * que el titulo salga del layout, que el estado lleve su color y que la cuota
 * no se pinte como un dia fijo.
 */

const RAIZ = join(process.cwd(), "src");

function fuente(ruta: string[]): string {
  return readFileSync(join(RAIZ, ...ruta), "utf8");
}

function pantalla(): string {
  return fuente(["app", "(app)", "habits.tsx"]);
}

describe("la lista de habitos", () => {
  it("la pantalla dice su titulo y no lo escribe a mano", () => {
    const layout = fuente(["app", "(app)", "_layout.tsx"]);
    // El titulo sale del mapeo de nombres de ruta del layout, como en notes.
    expect(layout).toContain('name="habits"');
    expect(layout).toContain('t("habits.title")');
    // Y la pantalla no publica el suyo: el layout ya lo dice.
    expect(pantalla()).not.toContain("useScreenTitle");
  });

  it("la fila muestra el estado de hoy con su color", () => {
    const codigo = pantalla();
    // Cumplido en emerald, fallado en rose, pendiente hoy en amber: los tres
    // existen en el tema y no se inventa ningun token.
    expect(codigo).toContain("theme.colors.success");
    expect(codigo).toContain("theme.colors.danger");
    expect(codigo).toContain("theme.colors.warning");
    // El texto sale del diccionario, por familia y no por clave suelta.
    expect(codigo).toContain("habits.status.");
    // El estado de un dia fijo sale del motor, no de un if local.
    expect(codigo).toContain("statusForDate");
  });

  it("sale en el cajon, con su fila y sin literales", () => {
    const cajon = fuente(["components", "layout", "drawer.tsx"]);
    expect(cajon).toContain("/(app)/habits");
    expect(cajon).toContain("habits.title");
  });

  it("la cuota no se pinta como un dia fijo", () => {
    const codigo = pantalla();
    // Dos filas distintas porque no son el mismo dato: puntos contra N de M.
    expect(codigo).toContain("RruleHabitRow");
    expect(codigo).toContain("QuotaHabitRow");
    // La cuota cuenta marcas del periodo en curso, con la misma funcion que
    // la API, y el par sale del diccionario para que el ingles no lea "de".
    expect(codigo).toContain("progressForPeriod");
    expect(codigo).toContain('t("habits.quota.progress"');
  });

  it("el horario generico no pinta una fila vacia", () => {
    const codigo = pantalla();
    // weeklyDays con days [] es el generico de unknownSchedule: sin reserva
    // se pintaria "Los " vacio. La reserva usa una clave que ya existe.
    expect(codigo).toContain("days.length");
    expect(codigo).toContain('t("habits.advanced")');
  });

  it("el ordinal 1MO sigue como esta", () => {
    const codigo = pantalla();
    // El positivo no cambia: numero y dia con su clave de siempre.
    expect(codigo).toContain('t("habits.schedule.monthlyOrdinal"');
    expect(codigo).toContain("String(description.ordinal)");
  });

  it("el ordinal -1MO da ultimo y no un numero con signo", () => {
    const codigo = pantalla();
    // -1MO es "el ultimo lunes" en RFC 5545, y el motor lo admite: la
    // pantalla lo nombra con su clave en vez de pintar "El -1 lunes".
    expect(codigo).toContain("description.ordinal === -1");
    expect(codigo).toContain('t("habits.schedule.monthlyLast"');
  });

  it("el ordinal -2MO cae en la reserva generica", () => {
    const codigo = pantalla();
    // -2 y -3 son raros y no tienen frase: generico, no texto inventado.
    expect(codigo).toContain("description.ordinal < 0");
    const rama = codigo.slice(codigo.indexOf("monthlyOrdinal"));
    expect(rama).toContain('t("habits.advanced")');
  });

  it("va sobre el molde de notes y el hook de habitos", () => {
    const codigo = pantalla();
    for (const pieza of [
      "useHabits",
      "describeSchedule",
      "useHeaderAction",
      "<Screen",
      "<ListRow",
      "<EmptyState",
      't("habits.add")',
    ]) {
      expect(codigo).toContain(pieza);
    }
  });
});
