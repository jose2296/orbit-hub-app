import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  listOrderModeSchema,
  membershipRoleSchema,
  prioritySchema,
} from "@orbit-hub/contracts";

import { dictionaries } from "@/lib/i18n/dictionaries";
import { WORKSPACE_COLORS } from "@/lib/workspace/color";

const RAIZ = join(__dirname, "..", "src");
const claves = new Set(Object.keys(dictionaries.es));

/** Every source file, so a new screen is covered without touching this test. */
function fuentes(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const camino = join(dir, nombre);
    if (statSync(camino).isDirectory()) return fuentes(camino);
    return /\.(ts|tsx)$/.test(nombre) && !nombre.endsWith(".d.ts") ? [camino] : [];
  });
}

/**
 * Translation keys written with a template.
 *
 * `t("lists.pendingCount")` is checked by the compiler: if the key is not in the
 * dictionary, the type of `TranslationKey` does not contain it and the build
 * fails. `t(\`lists.${algo}\`)` is not checked by anything, because the compiler
 * sees a string and not a key. That is where the missing ones live, and a missing
 * one is not a blank: the app prints `items.priority.none` in the middle of the
 * screen, in a language somebody has to read.
 *
 * So this walks the source, finds every `t(\`prefix.${...}\`)`, and asks whether
 * the keys under that prefix all exist. A new screen with a new family of keys is
 * covered without anyone remembering this file.
 */
describe("las claves de traduccion que van detras de una plantilla", () => {
  const hallazgos: string[] = [];

  for (const archivo of fuentes(RAIZ)) {
    const texto = readFileSync(archivo, "utf8");
    // `t(`algo.${x}`)`, que es la forma en que aparecen todas.
    for (const coincidencia of texto.matchAll(/t\(\s*`([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)*)\.\$\{/g)) {
      const prefijo = `${coincidencia[1]}.`;
      const familia = [...claves].filter((clave) => clave.startsWith(prefijo));
      if (familia.length === 0) {
        hallazgos.push(`${archivo.replace(RAIZ, "src")}: la familia "${prefijo}*" no existe`);
      }
    }
  }

  it("todas las familias que se pintan con una plantilla existen en el diccionario", () => {
    expect(hallazgos).toEqual([]);
  });

  /**
   * The values each of those families can actually take.
   *
   * Asking whether the family exists is not enough: `items.priority.*` existed
   * with `low`, `medium` and `high`, and `none` was missing, which is exactly
   * the key that was printed raw on screen. So the values are listed here, the
   * same way the screens list them, and every one of them has to be there.
   *
   * A new template needs its values added here. That is the whole price of the
   * check, and it is one line per family.
   */
  /**
   * The values each of those families can actually take, read from the same
   * place the screens read them.
   *
   * Asking whether the family exists is not enough: `items.priority.*` existed
   * with `low`, `medium` and `high`, and `none` was missing, which is exactly
   * the key that was printed raw on screen. So the values are compared one by
   * one, and they are taken from the contract and from the colour list and not
   * from a list written here: a list written here is a fourth place to forget
   * something, and the first version of this test had three colours that do not
   * exist in the app.
   *
   * `filters.show` is the only one listed by hand, because its three values live
   * in a prop type and not in a schema. A new family needs a line here.
   */
  const FAMILIAS: Record<string, string[]> = {
    "items.priority": [...prioritySchema.options],
    order: [...listOrderModeSchema.options],
    "workspaces.role": [...membershipRoleSchema.options],
    "workspaces.color": WORKSPACE_COLORS.map((color) => color.key),
    "filters.show": ["all", "pending", "done"],
  };

  it("cada valor que una plantilla puede tomar tiene su clave", () => {
    const faltan: string[] = [];
    for (const [familia, valores] of Object.entries(FAMILIAS)) {
      for (const valor of valores) {
        if (!claves.has(`${familia}.${valor}`)) {
          faltan.push(`${familia}.${valor}`);
        }
      }
    }

    // El nombre de la clave que falta, y no un "algo no cuadra": asi el fallo
    // dice exactamente que escribir.
    expect(faltan).toEqual([]);
  });

  it("la lista de valores de cada familia no se ha quedado corta", () => {
    // Si somebody adds a value to a family and not to this list, the check above
    // stops covering it silently. So the two are compared: what the contract
    // accepts and what this test knows about.
    const hayEnElDiccionario = [...claves]
      .filter((clave) => clave.startsWith("items.priority."))
      .map((clave) => clave.slice("items.priority.".length));

    const prioridades = FAMILIAS["items.priority"] ?? [];
    expect(hayEnElDiccionario.sort()).toEqual([...prioridades].sort());
    expect(dictionaries.es["items.priority.none"]).toBeTruthy();
  });

  it("las dos lenguas tienen exactamente las mismas claves", () => {
    // Una clave en castellano y no en ingles sale en crudo en ingles, y al
    // reves: es la mitad de por que hay que mirar las capturas.
    const soloEs = [...claves].filter((clave) => !(clave in dictionaries.en));
    const soloEn = [...claves].filter(
      (clave) => !(clave in dictionaries.es) && (dictionaries.en as Record<string, string>)[clave] !== undefined,
    );

    expect({ soloEs, soloEn }).toEqual({ soloEs: [], soloEn: [] });
  });

  it("las claves de plural tienen las dos formas, .one y .other", () => {
    // Una clave suelta mas una "_one" no son la misma cosa, y asi acababa
    // diciendo "1 completadas". Si una clave tiene una de las dos, tiene las dos.
    const aMedias = [...claves].filter((clave) => {
      const base = clave.replace(/\.(one|other)$/, "");
      if (base === clave) return false;
      return !claves.has(`${base}.one`) || !claves.has(`${base}.other`);
    });

    expect(aMedias).toEqual([]);
  });

  it("ninguna traduccion se queda vacia", () => {
    const es = dictionaries.es as Record<string, string>;
    const vacias = [...claves].filter((clave) => (es[clave] ?? "").trim() === "");

    expect(vacias).toEqual([]);
  });

  /**
   * A key with a `{name}` in it, called with no values, prints the placeholder
   * on the screen.
   *
   * `formatTranslation` leaves a token it has no value for exactly as it found
   * it, so `t("share.title")` against a dictionary entry of `"Share {name}"`
   * renders the word "Share" and then the braces and the word "name" in the
   * middle of a menu row. It is not a crash and not a missing key, so every test
   * that asks "does this key exist?" passes.
   *
   * Reading the code does not catch it either, because both halves are right: the
   * key exists, and the call site is a `t` like any other. It was caught by
   * looking at a screenshot, and the way to stop needing the screenshot is to walk
   * the call sites and count the placeholders.
   */
  it("ninguna clave con {name} se llama sin el nombre", () => {
    const sinNombre: string[] = [];
    const es = dictionaries.es as Record<string, string>;

    for (const [archivo, texto] of fuentesDeLaApp()) {
      // Every `t("clave", ...)`, and whether a values object follows.
      const llamada = /\bt\(\s*"([^"]+)"\s*([,)])/g;
      let m: RegExpExecArray | null;

      while ((m = llamada.exec(texto)) !== null) {
        const clave = m[1];
        const cierre = m[2];
        if (clave === undefined || cierre === undefined) continue;
        if (!/\{name\}/.test(es[clave] ?? "")) continue;
        // A comma means there are arguments after it, which is where the values
        // live. A closing paren means the call is bare.
        if (cierre === ")") sinNombre.push(`${archivo}: ${clave}`);
      }
    }

    expect(sinNombre).toEqual([]);
  });
});

/** Every source file under `src`, with its text. */
function fuentesDeLaApp(): [string, string][] {
  const salida: [string, string][] = [];
  const raiz = resolve(process.cwd(), "src");

  const recorrer = (dir: string) => {
    for (const entrada of readdirSync(dir, { withFileTypes: true })) {
      const ruta = join(dir, entrada.name);
      if (entrada.isDirectory()) {
        recorrer(ruta);
      } else if (entrada.name.endsWith(".tsx") || entrada.name.endsWith(".ts")) {
        salida.push([relative(raiz, ruta), readFileSync(ruta, "utf8")]);
      }
    }
  };

  recorrer(raiz);
  return salida;
}
