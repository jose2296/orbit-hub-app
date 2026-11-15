import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/** Every source file under `src/components` that calls `guard.press(`, relative to the app. */
export function fdFiles(): string[] {
  const raiz = resolve(__dirname, "..");
  const salida: string[] = [];
  const recorrer = (dir: string) => {
    for (const nombre of readdirSync(dir)) {
      const ruta = join(dir, nombre);
      if (statSync(ruta).isDirectory()) recorrer(ruta);
      else if (/\.tsx$/.test(nombre) && readFileSync(ruta, "utf8").includes("guard.press(")) {
        salida.push(relative(raiz, ruta));
      }
    }
  };
  recorrer(join(raiz, "src", "components"));
  return salida.filter((ruta) => !ruta.endsWith("swipe-row.tsx"));
}
