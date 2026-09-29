import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * El botón de añadir, y lo que devuelve a quien lo dibuja.
 *
 * `useAddMenu` devolvía `abrir` y `cerrar` como funciones escritas dentro del
 * objeto que retorna, así que eran nuevas en cada render. Una pantalla que
 * coloca ese botón en la cabecera con `useHeaderAction` tenía entonces un
 * callback nuevo en cada render, que redibujaba la cabecera, que volvía a
 * renderizar el layout, y así hasta que React se negaba: `Maximum update depth
 * exceeded`.
 *
 * La pantalla de notas no se podía abrir — nadie llegaba a ella — así que el
 * bucle llevaba ahí desde que se escribió, y salió el día que se puso una fila
 * en el menú lateral que sí lleva a `/notes`.
 *
 * Esto lee el archivo porque lo que hay que comprobar es la **identidad** de lo
 * que devuelve el hook entre renders, y eso no se observa sin renderizar React
 * Native, que no corre en este entorno. Es el mismo recurso que usa
 * `drawer-push.test.ts` y por el mismo motivo.
 */
const addMenu = readFileSync(
  fileURLToPath(new URL("../src/components/ui/add-menu.tsx", import.meta.url)),
  "utf8",
);

describe("useAddMenu", () => {
  it("devuelve abrir y cerrar con useCallback", () => {
    // Una flecha en el literal del return es nueva en cada render, y eso es
    // exactamente el bucle.
    expect(addMenu).toMatch(/const abrir = useCallback\(\(\) => setAbierto\(true\)/);
    expect(addMenu).toMatch(/const cerrar = useCallback\(\(\) => setAbierto\(false\)/);
  });

  it("no escribe flechas sueltas en lo que devuelve", () => {
    const returned = addMenu.slice(addMenu.indexOf("return {", addMenu.indexOf("export function useAddMenu")));
    expect(returned).not.toMatch(/abrir:\s*\(\)\s*=>/);
    expect(returned).not.toMatch(/cerrar:\s*\(\)\s*=>/);
    // Y se devuelven las dos por su nombre, que es lo que las hace estables.
    expect(returned).toMatch(/^\s*abrir,$/m);
    expect(returned).toMatch(/^\s*cerrar,$/m);
  });
});
