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
  MIN_LABEL_CONTRAST,
  contrastRatio,
  labelPillColors,
  mixHex,
  tagColorHex,
} from "@/lib/lists/tag-colors";
import { esHex, hslToHex } from "@/lib/workspace/hsl";

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
    // Hay dos validadores de hex en este repositorio y no pueden ser uno:
    // `esHex` esta en el movil porque el selector de espacios lo usa desde antes de
    // que existieran las etiquetas, y `normalizaColor` esta en el contrato porque
    // `packages/contracts` no puede importar de `apps/mobile` y es el servidor —no
    // el cliente— quien normaliza lo que se guarda.
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
 * Los seis tests de abajo son la regla de la pastilla, y el primero de todos es
 * el que explica por que este archivo no tiene una puerta de contraste.
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

  it("el texto llega a 4.5:1 contra su propio relleno", () => {
    // Los hex son de `ICON_COLORS`, la paleta de doce. **No** son los del tema:
    // `success` es #0E9F6E y `green` de la paleta es #16A34A, y con el valor
    // equivocado la pastilla se dibujaria de un color y se guardaria otro.
    for (const color of ["#16A34A", "#D97706", "#2563EB", "#9333EA", "#E11D48"]) {
      for (const scheme of ["light", "dark"] as const) {
        const surface = scheme === "light" ? "#FFFFFF" : "#111827";
        const { fill, text } = labelPillColors(color, surface, scheme);
        expect(contrastRatio(text, fill)).toBeGreaterThanOrEqual(MIN_LABEL_CONTRAST);
      }
    }
  });

  it("lee tambien cuando el color es casi el de la superficie", () => {
    // El peor caso: un color elegido tan parecido a la superficie que el relleno
    // sale casi igual que ella. El texto tiene que leerse contra ESE relleno.
    const surface = "#F0F2F8";
    const { fill, text } = labelPillColors("#EFF1F7", surface, "light");
    expect(contrastRatio(text, fill)).toBeGreaterThanOrEqual(MIN_LABEL_CONTRAST);
  });

  it("lee con un blanco puro y con un negro puro", () => {
    expect(contrastRatio(labelPillColors("#FFFFFF", "#FFFFFF", "light").text, labelPillColors("#FFFFFF", "#FFFFFF", "light").fill))
      .toBeGreaterThanOrEqual(MIN_LABEL_CONTRAST);
    expect(contrastRatio(labelPillColors("#000000", "#111827", "dark").text, labelPillColors("#000000", "#111827", "dark").fill))
      .toBeGreaterThanOrEqual(MIN_LABEL_CONTRAST);
  });

  it("un hex libre sale tal cual y un nombre viejo sale en su hex", () => {
    expect(tagColorHex("#3B5FDE")).toBe("#3B5FDE");
    expect(tagColorHex("green")).toBe("#16A34A");
  });

  // ---- los que el brief no pide y que este archivo necesita igual ----

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
    expect(contrastRatio("#FFFFFF", fill)).toBeLessThan(MIN_LABEL_CONTRAST);
    // Y lo segundo es lo que se hace con eso: oscurecer. 4.65:1 sobre el mismo
    // relleno, y un texto del lado del relleno y no del lado del blanco.
    expect(contrastRatio(text, fill)).toBeGreaterThanOrEqual(MIN_LABEL_CONTRAST);
    expect(text).not.toBe("#FFFFFF");
  });

  it("ningun color se queda sin leer, ni claro ni al reves", () => {
    // La promesa del archivo, comprobada sobre una rejilla y no sobre doce
    // valores: 6 tonos x 5 saturaciones x 11 luminosidades, en los dos esquemas,
    // son 660 pastillas y todas tienen que leerse contra su propio relleno.
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
              MIN_LABEL_CONTRAST,
            );
          }
        }
      }
    }
  });
});
