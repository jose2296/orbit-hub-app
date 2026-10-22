import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const leer = (ruta: string) => readFileSync(resolve(__dirname, "..", ruta), "utf8");
const drawer = leer("src/components/layout/drawer.tsx");
const cabecera = leer("src/components/ui/app-header.tsx");

describe("el drawer se desplaza cuando hay muchos espacios", () => {
  it("el contenido del menu va en un ScrollView acotado, con indicador visible", () => {
    const scroll = drawer.slice(drawer.indexOf('testID="drawer-scroll"') - 200, drawer.indexOf('testID="drawer-scroll"') + 400);
    expect(scroll).toContain("<ScrollView");
    expect(scroll).toContain("style={{ flex: 1 }}");
    expect(scroll).toContain("nestedScrollEnabled");
    expect(scroll).toContain("showsVerticalScrollIndicator\n");
    expect(scroll).not.toContain("showsVerticalScrollIndicator={false}");
  });
});

describe("la accion de la derecha de la cabecera llega siempre al mismo sitio", () => {
  it("va en un envoltorio que se ajusta al contenido y se alinea a la derecha", () => {
    // Un `Button` lleva `alignSelf: flex-start` y ganaba a la alineacion de la caja de ancho
    // fijo: lista, espacio y carpeta quedaban 40 puntos antes del borde y nota o diario no.
    expect(cabecera).toContain("<View style={styles.accionAjustada}>{slotAccion()}</View>");
    expect(cabecera).toMatch(/accionAjustada: \{\s*alignSelf: 'flex-end',/);
  });
});
