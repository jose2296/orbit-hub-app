import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect } from "vitest";

/**
 * ------------------------------------------------------------------
 * POR QUE ESTE ARCHIVO EXISTE
 * ------------------------------------------------------------------
 *
 * Porque `icon-page.test.ts` copio de `entity-menu-sheet.test.ts` la raiz, el
 * lector de fuente, `hojasMontadas` y `paginasMontadas` —cuerpo identico, regex
 * incluido— y eso es la misma duplicacion que el registro vino a matar, puesta
 * en los tests: dos copias que se pueden desincronizar y que nadie va a notar
 * cuando pase. T4 va a necesitar la mitad de esto otra vez, asi que la tercera
 * copia no se escribe.
 *
 * Lo que vive aca es lo **compartido y derivado**: leer un archivo, contar
 * hojas, y las dos listas de paginas —la que la hoja declara y la que hay en el
 * directorio—. Los paths y las constantes de un solo test siguen en su test: un
 * helper que sabe de `icon-page.test.ts` no es un helper, es el test movido de
 * lugar.
 *
 * ------------------------------------------------------------------
 * POR QUE ESTO DERIVA Y NO LISTA
 * ------------------------------------------------------------------
 *
 * Porque un guard que copia la fuente se desincroniza en silencio: en T2 el guard
 * de iconos listaba once y se le olvido el duodecimo, y paso en verde; en la
 * misma T3, "ninguna pagina monta su propia hoja" iteraba `[RENOMBRAR, BORRAR]`
 * a mano y con `icon-page.tsx` en el directorio seguia diciendo "ninguna" sin
 * mirarla. Las dos listas de abajo se leen del archivo y del disco, asi que
 * crecen solas cuando llega la pagina siguiente.
 */

/** La raiz de `apps/mobile`, para leer fuente sin dependen del `cwd`. */
export const RAIZ = join(import.meta.dirname, "..");

/** El fuente de un archivo de la app, relativo a la raiz del paquete. */
export const src = (ruta: string): string => readFileSync(join(RAIZ, ruta), "utf8");

/** Donde viven las paginas compartidas del menu. */
export const PAGINAS = "src/components/menus/pages";

/** La hoja unica: el archivo del que sale todo lo demas. */
export const HOJA = "src/components/menus/entity-menu-sheet.tsx";

/** El fuente de la hoja, leido una vez porque todos lo usan. */
export const hoja = src(HOJA);

/**
 * Cuantas `<Sheet ...>` monta un archivo. `<SheetOptions` no cuenta.
 *
 * Una hoja encima de otra son dos fondos sobre una pantalla y un toque que llega
 * a la de arriba cerrando la de abajo: `Sheet` es un `Modal`.
 */
export function hojasMontadas(fuente: string): number {
  return (fuente.match(/<Sheet[\s/>]/g) ?? []).length;
}

/**
 * Los ids de `PAGINAS_MONTADAS`, leidos del fuente.
 *
 * Es una lista en el `.tsx` y no un `Record` de componentes porque lo que
 * importa poder leer sin renderizar es **cuales son**, no que se pinten: es la
 * lista de las paginas que existen hoy, y la que T8 y T9 van haciendo crecer.
 */
export function paginasMontadas(): string[] {
  const declarada = hoja.match(/PAGINAS_MONTADAS[^=]*=\s*\[([^\]]*)\]/);
  expect(declarada, "la hoja tiene que declarar que paginas monta").not.toBeNull();
  return [...(declarada![1] ?? "").matchAll(/"([a-zA-Z]+)"/g)].map((m) => m[1]!);
}

/**
 * Las paginas que hay, del directorio.
 *
 * Del disco y no de una lista: una lista escrita aca se queda sin mirar cuando
 * llega una pagina nueva, que es exactamente lo que le paso a este guard en la
 * T3. Los dos guards que comparan el directorio con `PAGINAS_MONTADAS` salen de
 * aca.
 */
export function paginasEnElDirectorio(): string[] {
  return readdirSync(join(RAIZ, PAGINAS))
    .filter((nombre) => nombre.endsWith(".tsx"))
    .map((nombre) => nombre.replace(/-page\.tsx$/, ""));
}

/**
 * El fuente de un archivo **sin sus comentarios**.
 *
 * Existe por una sola razon, y es una que se paga cada vez que un guard afirma
 * que un nombre **no** aparece: un archivo suele explicar en un comentario por
 * que se fue algo, y asi el `not.toContain` que viene a comprobar que se fue se
 * encuentra con su propia prosa y falla. Lo que uno quiere afirmar es que esta
 * hoja ya no monta `BookmarkDeleteSheet`, no que la palabra no este en el archivo.
 *
 * Vive aca y no en cada test porque `task-row-layout.test.ts` ya tenia una copia
 * identica —la misma razon por la que este archivo existe— y porque el patron de
 * un guard que afirma una ausencia es justo el que se desincroniza en silencio:
 * el que se rompe es el que nadie prueba.
 */
export const sinComentarios = (texto: string): string =>
  texto.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** Todos los `.tsx` de la app, como rutas relativas a `src`. */
export function tsxDeLaApp(): string[] {
  return readdirSync(join(RAIZ, "src"), { recursive: true, encoding: "utf8" }).filter((nombre) =>
    nombre.endsWith(".tsx"),
  );
}
