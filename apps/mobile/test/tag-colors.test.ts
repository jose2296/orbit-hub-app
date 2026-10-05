import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  ITEM_ICON_COLORS,
  derivedTagColor,
  listSchema,
  normalizaColor,
  sanitiseTagColors,
  tagColorSchema,
} from "@orbit-hub/contracts";
import { describe, expect, it } from "vitest";

import { iconColor } from "@/lib/lists/item-icons";
import {
  contrastRatio,
  labelPillColors,
  mixHex,
  planTagColorChange,
  tagColorHex,
} from "@/lib/lists/tag-colors";
import { esHex, hslToHex } from "@/lib/workspace/hsl";

describe("cambiar el color de una etiqueta", () => {
  it("guarda el color que se ha elegido", () => {
    expect(planTagColorChange({}, "Mercadona", "green")).toEqual({
      Mercadona: "green",
    });
  });

  it("no toca los colores de las demas etiquetas", () => {
    // El mapa entero viaja en una sola operacion del sync, asi que una
    // escritura que pierde un color ajeno pierde el de otra persona sin que
    // ninguna de las dos se entere.
    expect(
      planTagColorChange({ Alcampo: "red", casa: "blue" }, "Mercadona", "green"),
    ).toEqual({ Alcampo: "red", casa: "blue", Mercadona: "green" });
  });

  it("cambia el color de una etiqueta que ya tenia uno", () => {
    expect(planTagColorChange({ Mercadona: "red" }, "Mercadona", "green")).toEqual({
      Mercadona: "green",
    });
  });

  it("quitar el color devuelve la etiqueta al que se deduce de su nombre", () => {
    // No es "sin color": es el estado de "no hay color guardado", que es el que
    // hace que la etiqueta vuelva al deducido. Por eso la opcion se llama
    // "volver al deducido" y no "quitar".
    expect(planTagColorChange({ Mercadona: "green", Alcampo: "red" }, "Mercadona", null)).toEqual({
      Alcampo: "red",
    });
  });

  it("quitar el color de una etiqueta que no tenia ninguno no cambia nada", () => {
    expect(planTagColorChange({ Alcampo: "red" }, "Mercadona", null)).toEqual({
      Alcampo: "red",
    });
  });

  it("no muta el mapa que le pasan", () => {
    const original = { Mercadona: "red" as const };
    planTagColorChange(original, "Mercadona", "green");
    expect(original).toEqual({ Mercadona: "red" });
  });

  it("tampoco lo muta al quitar el color", () => {
    // El caso espejo del de arriba, y el que un `delete` ingenuo rompe sin que
    // se note: quitar el color es media funcion, asi que una copia solo en el
    // camino de elegir un color deja el otro sin cubrir.
    //
    // Y aqui el mapa que le pasan no es una copia de nada: es el mismo objeto
    // que la lista tiene guardado. Un `delete current[tag]` lo vacia en sitio, y
    // como el estado ya apunta a el, nadie repinta y nadie se entera: la lista se
    // queda mostrando un color que ya no esta en el mapa que se acaba de enviar.
    const original = { Mercadona: "green" as const, Alcampo: "red" as const };
    expect(planTagColorChange(original, "Mercadona", null)).toEqual({
      Alcampo: "red",
    });
    expect(original).toEqual({ Mercadona: "green", Alcampo: "red" });
  });
});

/**
 * La cuenta, y no la regla.
 *
 * `contrastRatio` es el metodo de los asserts de contraste de mas abajo —cada uno
 * compara un texto contra su relleno con ella—, asi que sus tres propiedades van
 * aqui: **que sea 1 consigo mismo, que sea 21 en los dos sentidos y que no dependa
 * del orden de quien mire primero**. Sin esto, siete asserts que usan la cuenta
 * estarian en verde con una cuenta equivocada.
 *
 * El componente no se puede pintar en un test de este repo —`vitest.config.ts` solo
 * recoge los de la carpeta `test`, con `environment: 'node'` y React Native
 * sustituido—, asi que lo que se comprueba aqui es la regla, que es pura y por eso
 * si se puede.
 */
describe("el contraste", () => {
  it("de un color consigo mismo es 1", () => {
    // Un color de laboratorio y no uno de los tokens: aqui se comprueba la
    // cuenta, y un token en el argumento haria dudar de que color se esta midiendo.
    expect(contrastRatio("#3A7BD5", "#3A7BD5")).toBeCloseTo(1, 6);
  });

  it("es 21 en los dos sentidos entre blanco y negro", () => {
    // Los dos 21, y no 21 y 1/21: el contraste se define como la parte clara
    // partida por la oscura, para que el numero signifique algo sin depender del
    // orden de los argumentos. "Blanco sobre negro" son 21:1 — el 1/21 es la misma
    // medicion leida al reves, no un segundo resultado.
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 6);
    expect(contrastRatio("#FFFFFF", "#000000")).toBeCloseTo(21, 6);
  });

  it("no depende del orden de los argumentos", () => {
    expect(contrastRatio("#3A7BD5", "#E8EAF2")).toBeCloseTo(
      contrastRatio("#E8EAF2", "#3A7BD5"),
      10,
    );
  });
});

describe("el color que deduce el nombre de una etiqueta", () => {
  it("es el mismo siempre para el mismo nombre", () => {
    // El que no puede fallar: un `Math.random()` en el render daria un color
    // distinto en cada paints, y una lista donde los colores cambian sola es una
    // animacion, no una lista.
    const primera = derivedTagColor("Mercadona");
    for (let i = 0; i < 100; i += 1) {
      expect(derivedTagColor("Mercadona")).toBe(primera);
    }
  });

  it("es exactamente el que siempre ha sido, y no solo uno estable", () => {
    // El valor clavado, y es lo mas importante del archivo: lo que sostiene es la
    // promesa de "el mismo nombre lleva el mismo color en mi movil, en el del otro
    // y en el servidor", y eso no lo puede comprobar nadie mirando una pantalla.
    // Las pruebas de arriba pasan igual con una funcion que devuelve siempre el
    // mismo color, asi que un cambio en el multiplicador, en el modulo, o un
    // `codePointAt` en lugar de un `charCodeAt` recolorearia TODAS las etiquetas
    // de todas las personas que ya las tienen, sin error y sin nota que lo diga.
    //
    // El emoji va a proposito: `🛒` son dos unidades UTF-16 y un solo code point,
    // asi que este valor fija tambien que el hash lee unidades y no caracteres,
    // que es la parte de la promesa que un nombre sin emoji no distinguiria.
    // `Mercadona 🛒` sale `green`: hash 2648977598, indice 2 de los doce.
    expect(derivedTagColor("Mercadona 🛒")).toBe("green");
  });

  it("solo devuelve colores que la app sabe pintar", () => {
    const nombres = ["Mercadona", "Alcampo", "casa", "urgente", "", "Ñandú", "🛒"];
    for (const nombre of nombres) {
      expect(ITEM_ICON_COLORS).toContain(derivedTagColor(nombre));
    }
  });

  it("no junta las etiquetas que solo se parecen en como se escriben", () => {
    // `Pañales` y `panales` son dos etiquetas distintas en toda la app —el
    // `includes` es exacto— asi que aqui tambien, y por eso el hash no pliega
    // mayusculas ni acentos: si los plegara, dos etiquetas distintas tendrian el
    // mismo color y elegirse una cambiaria la otra de color sin avisar.
    expect(derivedTagColor("Pañales")).not.toBe(derivedTagColor("panales"));
  });
});

describe("el mapa de colores que se guarda", () => {
  it("un nombre viejo sale en su hex y lo demas se cae", () => {
    // El caso que hace que esto no sea un filtro: `"green"` es lo que hay escrito
    // en la base de datos de quien uso la app antes de que el color fuera libre, y
    // lo que se guarda es `#16A34A`, el verde con el que siempre se pinto. Lo que
    // no es un color —ni hex ni nombre— se cae igualmente: no hay a que convertirlo.
    expect(sanitiseTagColors({ Mercadona: "green", Alcampo: "ultralight" })).toEqual({
      Mercadona: "#16A34A",
    });
  });

  it("descarta lo que no es un mapa", () => {
    // Una sola tabla porque es la misma regla para todos: esto se llama con lo que
    // llega por el cable, y lo que llega por el cable no es un mapa.
    //
    // El array esta aqui al lado de los demas, y no en un test aparte, porque es el
    // caso que de verdad muerde: `Object.entries(["green"])` es `[["0", "green"]]`,
    // o sea un mapa con una clave "0" que `tagColorSchema` acepta sin quejarse.
    // Sin el `Array.isArray` de la funcion, un array que llega donde se declaro un
    // mapa se convierte en colores que nadie eligio, y la etiqueta que de verdad
    // se llamara "0" los heredaria sin haberlos pedido nunca. Es el fallo que no
    // aparece en ninguna pantalla, y por eso se comprueba con nombre y todo.
    const noMapas: [string, unknown][] = [
      ["nada", undefined],
      ["nulo", null],
      ["una cadena", "Mercadona"],
      ["un numero", 42],
      ["un booleano", true],
      ["un array de colores", ["green"]],
      ["un array de etiquetas", ["Mercadona"]],
    ];

    for (const [nombre, valor] of noMapas) {
      expect(sanitiseTagColors(valor), nombre).toEqual({});
    }
  });

  it("descarta las claves que no son una etiqueta", () => {
    // Los dos lados del 40, porque un `>` puesto donde va un `>=` deja fuera la
    // etiqueta mas larga que la app admite —que es justo la que alguien ha escrito
    // a proposito— y no se ve en ninguna pantalla: sencillamente no tiene color.
    const larga = "M".repeat(41);
    const justa = "M".repeat(40);
    expect(
      sanitiseTagColors({ "   ": "green", [larga]: "green", [justa]: "red" }),
    ).toEqual({ [justa]: "#DC2626" });
  });

  it("guarda la clave ya recortada", () => {
    // Lo que se guarda es la clave sin los bordes, no la que venia: una etiqueta
    // es `trim().min(1).max(40)` en todas partes, asi que se va a buscar recortada
    // y un mapa con `" Mercadona "` no se encontraria nunca. Ademas `tagColorSchema`
    // recorta tambien, asi que los dos medios dicen lo mismo y no hay dos mapas.
    expect(sanitiseTagColors({ "  Mercadona  ": "green" })).toEqual({
      Mercadona: "#16A34A",
    });
  });

  it("acepta un hex libre", () => {
    expect(sanitiseTagColors({ Mercadona: "#3B5FDE" })).toEqual({
      Mercadona: "#3B5FDE",
    });
  });

  it("convierte un nombre viejo de la paleta en su hex", () => {
    // Un build anterior guardaba "green". No se puede descartar: es un color que
    // alguien eligió, y perderlo en silencio es peor que perder el formato.
    expect(sanitiseTagColors({ Mercadona: "green" })).toEqual({
      Mercadona: "#16A34A",
    });
  });

  it("descarta lo que no es un color y conserva lo demas", () => {
    expect(sanitiseTagColors({ Mercadona: "#3B5FDE", Alcampo: "no-es-un-color" })).toEqual({
      Mercadona: "#3B5FDE",
    });
  });

  it("amplia un hex de tres digitos a seis", () => {
    // `esHex` ya acepta los dos anchos y hay un motivo escrito: estrecharlo
    // convertio en el color de reserva un camino que funcionaba. `#fff` es blanco
    // sin ambiguedad, y el mapa guarda una sola forma de cada color.
    expect(sanitiseTagColors({ Mercadona: "#fff" })).toEqual({
      Mercadona: "#FFFFFF",
    });
    expect(sanitiseTagColors({ Mercadona: "#AbC" })).toEqual({
      Mercadona: "#AABBCC",
    });
  });

  it("descarta lo que no tiene tres ni seis digitos", () => {
    expect(sanitiseTagColors({ Mercadona: "#ff" })).toEqual({});
    expect(sanitiseTagColors({ Mercadona: "#fffffff" })).toEqual({});
  });

  it("no puede lanzar, con ningun hex que llegue", () => {
    for (const malo of ["", "#", "#12", "#1234567", "  ", "rgb(1,2,3)", null, 7, {}]) {
      expect(() => sanitiseTagColors({ Mercadona: malo })).not.toThrow();
    }
  });

  it("el validador del movil y el del contrato aceptan lo mismo", () => {
    // **Hay siete reglas de hex en este repositorio y no pueden ser una.** Las dos
    // que este test ata son `esHex` —en el movil, porque el selector de espacios lo
    // usa desde antes de que existieran las etiquetas— y `normalizaColor` —en el
    // contrato, porque `packages/contracts` no puede importar de `apps/mobile` y es
    // el servidor —no el cliente— quien normaliza lo que se guarda. Las dos aceptan
    // tres o seis digitos.
    //
    // **Las otras cinco aceptan solo seis, y el mismo `#fff` que el selector de
    // etiquetas acepta y el contrato guarda, el selector de espacios lo rechaza**:
    // `ES_HEX` en `workspace-color-picker.tsx`, `ES_HEX` en
    // `lib/workspace/recent-colors.ts`, la regla de `color`/`colorTo` de
    // `sync-service.ts` —un solo regex en dos sitios—, `workspaceColorHexSchema` en
    // `packages/contracts/src/workspace.ts`, y `normaliseCustom` en
    // `lib/workspace/color.ts`. Ni siquiera se parecen entre si: la de los recientes y la
    // del esquema del espacio exigen `#` **y mayusculas**, las de `sync-service.ts` y
    // `normaliseCustom` exigen `#` y aceptan cualquier caso, y la del selector de
    // espacios no exige `#`. `normaliseCustom` es la contraparte de
    // `workspaceColorHexSchema` —el comentario de la primera dice que escribe la misma
    // forma que acepta el contrato, a proposito—.
    //
    // **Eso es preexistente y esta fuera de este plan**, asi que este comentario lo
    // nombra y no lo arregla: `workspace-color-picker.tsx` no es de esta rama, y la
    // regla que mas se le acerca es `esHex`. Lo que este test ata son **las dos
    // primeras y nada mas** —cambiar las otras cinco no lo rompe, y hacerlas iguales
    // tampoco es trabajo suyo—.
    //
    // Lo que los ata es esta lista, y solo esta lista. Si un dia uno se estrecha o
    // el otro se ensancha, el campo de un selector acepta un color que el mapa no
    // guarda, y el color desaparece en silencio al pasar por el servidor, que es
    // justo el fallo invisible que `normalizaColor` se carga con trim y con tres
    // digitos para evitar. Son dos reglas y solo una puede tener razon.
    //
    // `"  #abc  "` esta aqui por el `trim`: los dos recortan hoy, y sin esta
    // entrada un `trim` que se quittara de uno de los dos pasaria desapercibido.
    // Y `"#abcd"` esta por el ensanchamiento mas probable que puede llegar: un hex
    // con alfa. Los dos dicen que no hoy, y el que lo quiera tendra que mover los
    // dos el mismo dia —que es lo que esta lista obliga.
    for (const candidato of [
      "#fff",
      "fff",
      "#FFFFFF",
      "aabbcc",
      "#AbC",
      "#ff",
      "#abcd",
      "#gggggg",
      "",
      "  #abc  ",
      7,
      null,
      undefined,
    ]) {
      expect(esHex(candidato)).toBe(normalizaColor(candidato) !== null);
    }
  });

  it("convierte cada nombre de la paleta en el hex que la app lo dibuja", () => {
    // La tabla de nombres a hex esta copiada a mano en el contrato, porque
    // `packages/contracts` no puede importar de `apps/mobile`. Este test es lo que
    // ata las dos copias: si un dia `ICON_COLORS` cambia de valor y el contrato no,
    // una etiqueta que alguien eligio en verde se guardaria en el verde viejo y
    // nadie veria el cambio en ninguna pantalla.
    for (const nombre of ITEM_ICON_COLORS) {
      expect(sanitiseTagColors({ Mercadona: nombre })).toEqual({
        Mercadona: iconColor(nombre),
      });
    }
  });
});

describe("el campo de la lista", () => {
  it("viene vacio cuando nadie ha elegido nada", () => {
    const lista = listSchema.parse({
      id: crypto.randomUUID(),
      workspaceId: crypto.randomUUID(),
      kind: "tasks",
      title: "Compra",
      position: 0,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      role: "owner",
      shared: false,
    });
    expect(lista.tagColors).toEqual({});
  });

  it("conserva lo que se le mando", () => {
    const lista = listSchema.parse({
      id: crypto.randomUUID(),
      workspaceId: crypto.randomUUID(),
      kind: "tasks",
      title: "Compra",
      position: 0,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      role: "owner",
      shared: false,
      tagColors: { Mercadona: "#3B5FDE" },
    });
    expect(lista.tagColors).toEqual({ Mercadona: "#3B5FDE" });
  });

  it("rechaza un valor que no es ni texto", () => {
    // Lo que el contrato comprueba del color ya no es la paleta —no la tiene— sino
    // que sea un string. El sitio que sabe si es un color es `sanitiseTagColors`, y
    // antes esto rechazaba `"ultralight"` porque el color era una de doce.
    expect(() =>
      listSchema.parse({
        id: crypto.randomUUID(),
        workspaceId: crypto.randomUUID(),
        kind: "tasks",
        title: "Compra",
        position: 0,
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        role: "owner",
        shared: false,
        tagColors: { Mercadona: 7 },
      }),
    ).toThrow();
  });
});

describe("el mapa que sale saneado lo acepta el contrato", () => {
  it("no puede lanzar, con ningun valor que llegue", () => {
    // Esto es lo que sostiene el `422`: el API sanea la carga y no contesta con
    // un error por una etiqueta que nadie escribio mal a proposito. Si esto se
    // rompiera, un push entero se rechazaria por una clave en blanco o por un
    // color que no existe, y el que lo paga es quien NO lo escribio.
    //
    // Lo unico que se mira es que el contrato lo acepte. Que una entrada se pierda
    // es lo correcto —significa "sin color elegido"— y por eso la lista sigue
    // llenandose de basura a proposito: si un dia `sanitiseTagColors` empieza a
    // devolver algo que `tagColorSchema` rechaza, este test es el que lo dice.
    const entradas: unknown[] = [
      undefined,
      null,
      42,
      true,
      "Mercadona",
      [],
      ["green"],
      {},
      { "   ": "green" },
      { ["M".repeat(41)]: "green" },
      { Mercadona: "ultralight" },
      { Mercadona: null },
      { Mercadona: 7 },
      { Mercadona: {} },
      { Mercadona: "green", Alcampo: "ultralight" },
      { "  Mercadona  ": "green" },
      // Un `__proto__` propio no es una etiqueta ni un color, pero es lo que un
      // copiador ingenuo dejaria subir al prototipo de toda la app: lo que importa
      // aqui es que se pierde y que el objeto que sale sigue siendo un objeto
      // normal, sin envenenar `Object.prototype` para el resto de la aplicacion.
      { ["__proto__"]: "green", Mercadona: "blue" },
      // Y ahora del otro lado: un **valor** que se parece a una clave del
      // prototipo. La tabla de nombres a hex es un objeto literal, asi que
      // `PALETA_A_HEX["constructor"]` es la funcion `Object`, y sin perguntar antes
      // a `ITEM_ICON_COLORS` un color escrito con la palabra "constructor" se
      // guardaba como una funcion —y el mapa que sale deja de ser uno que
      // `tagColorSchema` acepta, que es la unica promesa de esta funcion.
      { Mercadona: "constructor" },
      { Mercadona: "toString" },
      { Mercadona: "hasOwnProperty" },
      { Mercadona: "__proto__" },
      // Y el caso de verdad: que se convierta el nombre viejo y no se guarde la
      // palabra, que es justo lo que se perdia antes de que existiera `PALETA_A_HEX`.
      { Mercadona: "green" },
    ];

    for (const entrada of entradas) {
      const saneado = sanitiseTagColors(entrada);
      expect(Object.getPrototypeOf(saneado)).toBe(Object.prototype);
      expect(() => tagColorSchema.parse(saneado)).not.toThrow();
    }
  });
});

/**
 * La regla de la pastilla. El primero de los tests de aqui es el que explica por
 * que este archivo no tiene una puerta de contraste.
 *
 * **El 4.5 va escrito a mano en todos ellos y no se lee de
 * `MIN_LABEL_CONTRAST`, y es a proposito**: el comentario de la constante —en
 * `tag-colors.ts`— dice que el test la escribe para que bajarla produzca un test
 * rojo, y leerla haria que las dos cosas bajaran a la vez y el suite entero
 * siguiera en verde. Aqui es donde vive ese 4.5 a mano —los tests que lo tenian en
 * `tag-color-plan.test.ts` se fueron con la puerta que mediaban—, asi que si
 * alguna vez se afloja el umbral, que sea este bloque el que se ponga rojo y no una
 * pantalla.
 */
describe("la pastilla deriva relleno y texto", () => {
  it("el relleno es el color mezclado con la superficie", () => {
    // La composicion se afirma con `mixHex` y no con un hex escrito a mano: el
    // redondeo del ultimo canal es lo unico que haria fallar un numero fijo, y eso
    // no es lo que este test comprueba.
    expect(labelPillColors("#16A34A", "#FFFFFF", "light").fill).toBe(
      mixHex("#16A34A", "#FFFFFF", 0.14),
    );
  });

  it("mixHex interpola y redondea", () => {
    // 127.5 rounds to 128: el unico valor de la mezcla que no admite dos respuestas.
    expect(mixHex("#000000", "#FFFFFF", 0.5)).toBe("#808080");
    expect(mixHex("#16A34A", "#FFFFFF", 0)).toBe("#16A34A");
    expect(mixHex("#16A34A", "#FFFFFF", 1)).toBe("#FFFFFF");
  });

  it("mixHex no saca nunca un color que no se pueda dibujar", () => {
    // El comentario de `mixHex` promete que una entrada mala sale como un color
    // real, y **`clamp01` no cumplia eso con un `NaN`**: `clamp01` es
    // `Math.min(Math.max(valor, 0), 1)` y las tres devuelven `NaN` cuando una
    // entrada es `NaN`, asi que `Math.round(NaN).toString(16)` es la cadena `"NaN"`
    // y el retorno era `#NANNANNAN`. Eso no es un color invalido cualquiera: tiene
    // la forma de un `#RRGGBB`, en mayusculas, y el parser de CSS se lo traga sin
    // decir nada, de modo que el fallo es **una pastilla invisible** y no una
    // pantalla roja. Medido antes del arreglo.
    const malos: [string, string, number][] = [
      ["#000000", "#FFFFFF", Number.NaN],
      ["#000000", "#FFFFFF", Number.POSITIVE_INFINITY],
      ["#000000", "#FFFFFF", Number.NEGATIVE_INFINITY],
      ["#000000", "#FFFFFF", 2],
      ["#000000", "#FFFFFF", -2],
      ["nada", "#FFFFFF", 0.5],
      ["#000000", "tampoco", 0.5],
      ["#000000", "#FFFFFF", 0.5],
    ];
    for (const [a, b, t] of malos) {
      const salida = mixHex(a, b, t);
      // `esHex` es el validador del movil, que es el que tendria que avisar.
      expect(esHex(salida), `${a} + ${b} al ${t} salio ${salida}`).toBe(true);
      expect(salida, `${a} + ${b} al ${t}`).not.toMatch(/[^0-9A-F#]/);
    }
  });

  it("el texto llega a 4.5:1 contra su propio relleno", () => {
    // Los hex son de `ICON_COLORS`, la paleta de doce. **No** son los del tema:
    // `success` es #0E9F6E y `green` de la paleta es #16A34A, y con el valor
    // equivocado la pastilla se dibujaria de un color y se guardaria otro.
    for (const color of ["#16A34A", "#D97706", "#2563EB", "#9333EA", "#E11D48"]) {
      for (const scheme of ["light", "dark"] as const) {
        const surface = scheme === "light" ? "#FFFFFF" : "#111827";
        const { fill, text } = labelPillColors(color, surface, scheme);
        expect(contrastRatio(text, fill)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("lee tambien cuando el color es casi el de la superficie", () => {
    // El peor caso: un color elegido tan parecido a la superficie que el relleno
    // sale casi igual que ella. El texto tiene que leerse contra ESE relleno.
    const surface = "#F0F2F8";
    const { fill, text } = labelPillColors("#EFF1F7", surface, "light");
    expect(contrastRatio(text, fill)).toBeGreaterThanOrEqual(4.5);
  });

  it("lee con un blanco puro y con un negro puro", () => {
    expect(contrastRatio(labelPillColors("#FFFFFF", "#FFFFFF", "light").text, labelPillColors("#FFFFFF", "#FFFFFF", "light").fill))
      .toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(labelPillColors("#000000", "#111827", "dark").text, labelPillColors("#000000", "#111827", "dark").fill))
      .toBeGreaterThanOrEqual(4.5);
  });

  it("el texto de la pastilla no sale nunca en el color del tema", () => {
    // El texto del tema no es un color que haya elegido nadie, y es lo que devolvia
    // la puerta cuando el color de la etiqueta no se leia encima: una etiqueta con
    // color se pintaba como una etiqueta sin el. La pastilla deriva el suyo hasta que
    // se lee, y esa salida ya no existe —asi que ningun color de la paleta la
    // vuelve a abrir.
    const tema = { surface: "#F0F2F8", text: "#0E1220", scheme: "light" as const };
    for (const color of ITEM_ICON_COLORS) {
      const { text } = labelPillColors(iconColor(color), tema.surface, tema.scheme);
      expect(text).not.toBe(tema.text);
    }
  });

  it("un hex libre sale tal cual y un nombre viejo sale en su hex", () => {
    expect(tagColorHex("#3B5FDE")).toBe("#3B5FDE");
    expect(tagColorHex("green")).toBe("#16A34A");
  });

  it("un hex sale normalizado, que no es lo mismo que tal cual", () => {
    // El brief decia "tal cual" y aqui sale normalizado, y la diferencia es el
    // motivo del test: `#3b5fde` y `#3B5FDE` son el mismo azul pero **dos cadenas
    // distintas**, y un mapa de colores en el que las dos existen es un mapa en el
    // que una etiqueta tiene dos colores y solo uno esta en pantalla. El contrato
    // ya normaliza lo que se guarda —`sanitiseTagColors`— asi que si la pastilla no
    // normalizara, **se dibujaria una cadena y se guardaria otra del mismo color**,
    // y el fallo no aparece en ningun sitio.
    expect(tagColorHex("#3b5fde")).toBe("#3B5FDE");
    expect(tagColorHex("#AbC")).toBe("#AABBCC");
    expect(tagColorHex("  #3b5fde  ")).toBe("#3B5FDE");
    expect(tagColorHex("3b5fde")).toBe("#3B5FDE");
    // Y el nombre tambien se recorta, por lo mismo que la clave en el mapa.
    expect(tagColorHex(" green ")).toBe("#16A34A");
  });

  // ---- los que el brief no pide y que este archivo necesita igual ----

  it("los doce colores de la paleta salen exactamente en estos hex", () => {
    // **La tabla entera, no el umbral.** La rejilla de abajo comprueba que todo
    // llega a 4.5:1, pero eso lo cumpliria tambien una cuenta que landing en otro
    // sitio; lo que esta tabla fija es **que color sale**, y es lo que hace que los
    // numeros que hay escritos en los comentarios de `tag-colors.ts` sean
    // comprobables: si el paso, el porcentaje de mezcla o el corte del extremo se
    // mueven, esta tabla se pone roja y los comentarios quedan mintiendo solos.
    //
    // Superficies **las del tema**, `#F0F2F8` y `#1B2231`, y no las del brief
    // (`#FFFFFF` y `#111827`), que son de otro tema. Nombre, texto de claro, relleno
    // de claro, contraste, texto de oscuro, relleno de oscuro, contraste.
    const esperado = [
      ["neutral", "#303540", "#98A0B3", 4.69, "#16181D", "#7A8397", 4.67],
      ["accent", "#0A0C6A", "#777AF2", 4.59, "#EFF0FE", "#595CD6", 4.73],
      ["green", "#073719", "#35AE62", 4.7, "#031309", "#179147", 4.7],
      ["olive", "#0F1803", "#648D30", 4.68, "#C2F085", "#466F14", 4.54],
      ["amber", "#4E2B02", "#DC8828", 4.55, "#1C1001", "#BE6B0C", 4.71],
      ["orange", "#451A04", "#EB6E2D", 4.85, "#0B0401", "#CD5011", 4.6],
      ["red", "#260606", "#DF4343", 4.52, "#FADEDE", "#C12528", 4.65],
      ["rose", "#23050B", "#E33B61", 4.61, "#FBE3E8", "#C51E45", 4.73],
      ["purple", "#10031B", "#A04EEC", 4.56, "#EBD9FB", "#8231D0", 4.8],
      ["blue", "#04102C", "#4177ED", 4.56, "#D7E2FB", "#245AD1", 4.67],
      ["teal", "#042D29", "#2DA198", 4.72, "#FDFFFF", "#0F847C", 4.54],
      ["brown", "#FCEBE0", "#9F592F", 4.59, "#F4B48C", "#813C13", 4.54],
    ] as const;

    for (const [nombre, textoClaro, rellenoClaro, contrasteClaro, textoOscuro, rellenoOscuro, contrasteOscuro] of esperado) {
      const hex = iconColor(nombre);
      const claro = labelPillColors(hex, "#F0F2F8", "light");
      expect(claro.text, `${nombre} en claro`).toBe(textoClaro);
      expect(claro.fill, `${nombre} en claro`).toBe(rellenoClaro);
      expect(contrastRatio(claro.text, claro.fill), `${nombre} en claro`).toBeCloseTo(contrasteClaro, 2);

      const oscuro = labelPillColors(hex, "#1B2231", "dark");
      expect(oscuro.text, `${nombre} en oscuro`).toBe(textoOscuro);
      expect(oscuro.fill, `${nombre} en oscuro`).toBe(rellenoOscuro);
      expect(contrastRatio(oscuro.text, oscuro.fill), `${nombre} en oscuro`).toBeCloseTo(contrasteOscuro, 2);
    }
  });

  it("los doce nombres salen por el mismo camino que los dibuja la app", () => {
    // `tagColorHex` existe **por no ser** `iconColor`: aquella devuelve el neutro
    // para lo que no conoce, asi que un hex libre volveria gris. Esa diferencia es
    // el motivo de que sea una funcion nueva, y por eso este test ata las dos
    // mitades —el hex que pasa entero y el nombre que se traduce— al mismo
    // `iconColor`, que es quien tiene los doce valores. Si un dia alguien
    // "simplifica" `tagColorHex` a `iconColor(colour)`, el hex libre deja de
    // pintarse y esto se pone rojo.
    for (const nombre of ITEM_ICON_COLORS) {
      expect(tagColorHex(nombre)).toBe(iconColor(nombre));
    }
  });

  it("lo que no es ni hex ni nombre sale en el neutro, y no en el prototipo", () => {
    // La puerta es `ICON_COLOR_KEYS.includes` antes de mirar la tabla, y no por
    // gusto: `ICON_COLORS` es un objeto literal, asi que `ICON_COLORS["toString"]`
    // es una **funcion**. Sin la puerta, una etiqueta cuyo color fuese la palabra
    // "toString" —o un `__proto__` colado en el mapa— devolveria una funcion donde
    // tiene que haber un hex, y de ahi sale un `#NANNAN` que el parser de CSS
    // rechaza en silencio: la pastilla se queda con el color de antes y nadie ve
    // un error. El neutro es la respuesta de siempre para lo que no se sabe.
    for (const raro of [
      "toString",
      "constructor",
      "__proto__",
      "hasOwnProperty",
      "no-existe",
      "",
      "  ",
    ]) {
      expect(tagColorHex(raro)).toBe(iconColor("neutral"));
    }
  });

  it("la pastilla se da la vuelta cuando aclarar no basta", () => {
    // El caso que hace falta la segunda vuelta, y no es un color raro: es ambar
    // de la paleta, sobre su propio tinte en la superficie oscura.
    const { fill, text } = labelPillColors("#D97706", "#111827", "dark");
    //
    // Lo primero es el **motivo** de la vuelta, y por eso se afirma en vez de
    // quedar solo en un comentario: el blanco no llega a 4.5:1 sobre ese relleno,
    // que sale ya tan oscuro que no hay ningun aclarado que lo salve. Si algun dia
    // cambia el tinte y el blanco si llega, este test se pone rojo y avisa de que
    // la justificacion de la segunda vuelta ya no es la de antes.
    expect(contrastRatio("#FFFFFF", fill)).toBeLessThan(4.5);
    // Y lo segundo es lo que se hace con eso: oscurecer. 4.65:1 sobre el mismo
    // relleno, y un texto del lado del relleno y no del lado del blanco.
    expect(contrastRatio(text, fill)).toBeGreaterThanOrEqual(4.5);
    expect(text).not.toBe("#FFFFFF");
  });

  it("ningun color se queda sin leer, ni claro ni al reves", () => {
    // La promesa del archivo, comprobada sobre una rejilla y no sobre doce
    // valores: 6 tonos x 5 saturaciones x 11 luminosidades en los dos esquemas, son
    // 660 llamadas a `labelPillColors` sobre **227 colores distintos** —las filas de
    // luminosidad baja son el mismo gris sea cual sea el tono— y todas tienen que
    // leerse contra su propio relleno.
    //
    // Una rejilla y no la paleta porque la paleta son doce colores que la app
    // eligió hace años, y **el color de una etiqueta ya no son doce**: es
    // cualquier hex que alguien pueda elegir en un selector. Un fallo aqui es un
    // fallo en el primer color raro que alguien elija, no en una constante que
    // alguien pueda revisar.
    for (const h of [0, 60, 120, 180, 240, 300]) {
      for (const s of [0, 0.25, 0.5, 0.75, 1]) {
        for (let l = 0; l <= 1.0001; l += 0.1) {
          const hex = hslToHex(h, s, l);
          for (const scheme of ["light", "dark"] as const) {
            const surface = scheme === "light" ? "#FFFFFF" : "#111827";
            const { fill, text } = labelPillColors(hex, surface, scheme);
            expect(contrastRatio(text, fill), `${hex} sobre ${surface}`).toBeGreaterThanOrEqual(
              4.5,
            );
          }
        }
      }
    }
  });
});

/**
 * La otra mitad de la regla: **la pastilla que se pinta de verdad.**
 *
 * Este archivo comprueba `labelPillColors` hasta la ultima celda y no comprueba
 * nada de lo que la dibuja, y esa fue la distancia por la que la funcion vivia
 * **probada, con sus doce hex clavados**, al lado de un componente que seguia
 * pintando el relleno del tema y el texto en `theme.colors.text`. Una funcion
 * correcta que nadie llama no arregla nada, asi que esto lee el **fuente** de
 * `TagChip` —como hace `task-row-layout.test.ts`— y afirma lo que tiene que
 * aparecer ahi: la llamada, y la ausencia de las dos salidas por las que se
 * llegaba a la pastilla gris.
 *
 * **Sin comentarios, y por que:** el componente tiene que poder nombrar por que
 * pinte lo que pinta, y una afirmacion negativa sobre el texto entero —
*"no dice `labelTextColor`"*— la haria caer en verde un comentario que lo explica.
 * Se afirma sobre el codigo sin comentarios.
 */
const RAIZ = join(import.meta.dirname, "..");
const tagChip = readFileSync(join(RAIZ, "src/components/lists/tag-chip.tsx"), "utf8");
const codigoDelChip = tagChip.replace(/\/\*[\s\S]*?\*\//g, "");

describe("la pastilla que se pinta", () => {
  it("deriva relleno y texto de una sola llamada, contra la superficie del tema", () => {
    // La superficie es la del tema y no un hex escrito aqui: la pastilla esta
    // **encima** de algo, y el contraste se mide contra esa cosa. Y el esquema va
    // con ella, porque la cuenta empieza en una direccion o en la otra segun el
    // tema —y "la que toque" no es una regla que se pueda leer de un parametro
    // adivinado.
    expect(codigoDelChip).toContain("labelPillColors(");
    expect(codigoDelChip).toContain("theme.colors.surfaceMuted");
    expect(codigoDelChip).toContain("theme.scheme");
    // Y **no queda la puerta**: los dos colores salen de ahi y no de dos sitios, y
    // una pastilla con el relleno del tema y el texto de otro lado no es una
    // pastilla, es dos mitades que no se hablan — ademas de que el texto del tema
    // es un color que no eligio nadie.
    expect(codigoDelChip).not.toContain("labelTextColor");
    // **Y el texto del tema no puede volver a aparecer en este fichero**, que es el
    // agujero que los tres `toContain` de arriba dejan abierto: una pastilla que se
    // guarde la llamada muerta y pinte el texto del tema los pasa todos. El prefijo
    // tapa tambien `textMuted` y `textSubtle`, y es lo que se quiere — cualquier
    // token de texto del tema dentro de la pastilla es el mismo error.
    expect(codigoDelChip).not.toContain("theme.colors.text");
  });

  it("no busca el color de una etiqueta en la paleta de iconos", () => {
    // **Un guard hacia delante, y no una reproduccion del fallo.** El hex elegido
    // llegaba a la pastilla como su equivalente en gris —`iconColor("#16A34A")` no
    // conoce ese hex y contesta `#8A93A8`—, pero ese `iconColor` vivia **dentro de
    // `labelTextColor`**, a un modulo de aqui: el componente no lo llamaba y este
    // test, contra el componente de antes, pasa en verde. Lo que ata es que el
    // camino del color no vuelva a ser el de la paleta de iconos, que es la
    // reserva que se lo comia.
    expect(codigoDelChip).not.toMatch(/\biconColor\(/);
  });
});
