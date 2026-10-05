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
    // **Que digan lo mismo, y no una lista de donde se diferenciaban.** Este test
    // antes enumeraba las divergencias —"las otras cinco aceptan solo seis, y ni
    // siquiera se parecen entre si"— y las enumeraba **bien**: cada una de las siete
    // reglas existia de verdad. Ese era el problema de la lista: es documentacion, y
    // la documentacion no rompe un build. Escribirse aqui que dos ficheros no
    // coinciden es el aviso de que se arreglen hoy; no es nada que las ate manana.
    //
    // **Lo que ata de verdad esta en el `it` de abajo**, que lee el fuente de los
    // ficheros que delegan y falla si vuelve a aparecer un regex de hex. Una
    // enumeracion es una lista de las siete reglas; el tripwire es el **clavo**, y
    // el clavo es el que no se olvida reescribir cuando la lista queda vieja.
    //
    // Esta comparacion sigue, porque es la que **dice en voz alta que hay una regla**:
    // si alguien estrecha `TAG_HEX` un dia, el movil tiene que estrecharse con ella
    // y no se veria en ningun sitio si lo que se mira es solo que los dos usan la
    // misma constante —eso lo dice el import— sino que digan lo mismo sobre lo que
    // la gente escribe.
    //
    // `"  #abc  "` esta aqui por el `trim`: los dos recortan, y sin esta entrada un
    // `trim` que se quitara de uno de los dos pasaria desapercibido. Y `"#abcd"` esta
    // por el ensanchamiento mas probable que puede llegar: un hex con alfa. Los dos
    // dicen que no hoy; el dia que lo digan, tienen que decirlo los dos, que es lo
    // que esta comparacion obliga.
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

/**
 * **La raiz del monorepo, y por que este bloque la necesita.**
 *
 * Los cuatro ficheros del movil estan a tres `..` y el del API esta en el mismo
 * monorepo, asi que el tripwire **no puede vivir solo en el movil**: el `ES_HEX` del
 * servidor es uno de los que se van, y un clavo que no cubre el sitio donde el
 * fallo mas caro ocurre no esta clavado.
 */
const REPO = join(import.meta.dirname, "..", "..", "..");

/** Los seis sitios que decidian por su cuenta, con el nombre de la regla que havia. */
const FICHEROS_QUE_DELEGAN = [
  ["packages/contracts/src/workspace.ts", "workspaceColorHexSchema"],
  ["apps/mobile/src/lib/workspace/hsl.ts", "esHex"],
  ["apps/mobile/src/lib/workspace/color.ts", "normaliseCustom"],
  ["apps/mobile/src/lib/workspace/recent-colors.ts", "los recientes"],
  ["apps/mobile/src/components/workspace/workspace-color-picker.tsx", "el selector de espacios"],
  ["apps/api/src/modules/sync/sync-service.ts", "color y colorTo del servidor"],
] as const;

/**
 * La huella de un regex de hex escrito a mano: **una clase de caracteres con `0-9` y
 * con una letra de `a` a `f`, y un `{3}` o un `{6}` justo detras**. Las cuatro
 * formas que hubo en los seis sitios cumplen eso —`[0-9A-Fa-f]{3}`,
 * `[0-9A-Fa-f]{6}`, `[0-9A-F]{6}` y `[0-9a-fA-F]{6}`— sin importar el orden de las
 * letras ni si el `#` va antes, despues o en su propia clase.
 *
 * **Por que `0-9` y una letra de hex, y no solo `0-9`.** Medido: con `0-9` a secas
 * el patron se dispara solo en `sync-service.ts`, que tiene el patron de un **uuid**,
 * y lo dispara por un `[1-8][0-9a-fA-F]{3}` a media cadena. O sea que un tripwire que
 * pita por un uuid **no es un tripwire**: es ruido, y en cuanto pita por algo que no
 * es lo suyo todo el mundo aprende a passarlo por alto. Las dos mitades juntas son lo
 * que distingue "esto es una forma de color" de "esto es un tope de longitud".
 *
 * **Lo que este patron no busca, y por que.** No busca la palabra `ES_HEX` —que es
 * un nombre y se renombra—, ni `normalizaColor`, que es justo lo que si tiene que
 * aparecer.
 */
const REGEX_DE_HEX =
  /\[[^\]\n]*(?:0-9[^\]\n]*[a-f]|[a-f][^\]\n]*0-9)[^\]\n]*\]\s*\{[36]\}/i;

/**
 * El fuente sin sus comentarios, y sin el patron del uuid del servidor.
 *
 * **Por que se quitan los comentarios.** Una afirmacion negativa sobre el texto
 * entero —*"no dice `normalizaColor`"*— se pondria verde con un comentario que lo
 * explica, y **este bloque explica precisamente eso**: los docblocks de `hsl.ts`,
 * `color.ts` y `workspace.ts` nombran los regex que se quitaron. Sin esto el tripwire
 * se dispara el solo. Primero los comentarios de linea, que pueden cadear un bloque,
 * y despues los de bloque.
 *
 * **Y el `UUID_PATTERN` se quita por su nombre, y hay que decir por que.** El patron
 * de un uuid del servidor es
 * `/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/`,
 * y ese `[0-9a-fA-F]{3}` **es el mismo texto** que el `[0-9a-fA-F]{3}` que era la
 * regla de color de este fichero: una clase hexadecimal con un `{3}` pegado. Por su
 * forma **no se pueden distinguir**, y un tripwire que no puede distinguir "esto no es
 * lo que busco" de "esto si" se gasta la credibilidad en la primera falsa alarma.
 * Se quita por su nombre porque un identificador tiene nombre, y porque la lista de
 * lo que se excluye y por que queda escrita en el sitio donde se va a notar cuando
 * algo nuevo entre en esa categoria.
 */
function sinComentarios(fuente: string): string {
  return fuente
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*const UUID_PATTERN = [^\n]*$/gm, "");
}

/**
 * **La octava regla no puede aparecer sin que algo se ponga rojo.**
 *
 * El test de arriba, el de los candidatos, ya no enumera nada: **comprueba que haya
 * acuerdo**. Eso ata dos funciones, y es justo lo que estaba mal—una comparacion
 * entre dos cosas que alguien eligio, y solo ata lo que ya estaba atado. Este bloque
 * hace otra cosa: **lee el fuente de los seis ficheros** y falla si vuelve a aparecer
 * un regex de hex escrito a mano, que es la forma que toma un duplicado.
 *
 * **Enumerar donde se diferenciaban era documentacion; el tripwire es una regla.** Y
 * la diferencia se paga: el comentario de la enumeracion se queda viejo en silencio y
 * nadie lo relee al abrir un fichero a anadir un `ES_HEX`, mientras que el tripwire se
 * queda viejo con el build en rojo. Ese es el unico motivo por el que este bloque
 * existe al lado del otro.
 *
 * **El fallo que se impide es concreto y ya ha pasado en esta app.** Un valor que un
 * campo acepta, el mapa lo guarda y el servidor lo devuelve convertido en `slate`,
 * **sin un error en ninguna parte**: el selector parece funcionar y el espacio sale
 * de otro color en cada sincronizacion. Ese fallo no se ve en la pantalla en la que
 * se escribe, se ve en la de la otra persona, mas tarde, y no dice por que. Siete
 * reglas fueron suficientes para que pasara.
 */
describe("la regla del color es una sola", () => {
  it("y ningun fichero que delega vuelve a escribir un regex de hex", () => {
    // **Todos los culpables en una lista y no en el primer fallo.** Un `expect` por
    // fichero dentro del bucle para en el primero, y un tripwire que para en el
    // primero obliga a correr la suite seis veces —una por fichero— para descubrir
    // que se han roto seis. La lista dice las seis de golpe y el mensaje lleva el
    // regex, que es lo que hay que ir a buscar.
    const culpables = FICHEROS_QUE_DELEGAN.flatMap(([ruta, quien]) => {
      const codigo = sinComentarios(readFileSync(join(REPO, ruta), "utf8"));
      const encontrado = codigo.match(REGEX_DE_HEX);
      return encontrado ? [`${ruta} (${quien}) vuelve a decidir que es un color: ${encontrado[0]}`] : [];
    });
    expect(culpables).toEqual([]);
  });

  it("y los seis estaban delegando de verdad, no solo sin regex", () => {
    // **La otra mitad del clavo, y sin ella el de arriba es decorativo.** Que no haya
    // un regex no dice que la pregunta se la haga el dueno: tambien la puede hacer
    // nadie, o una copia de la forma con `split` y `parseInt`, o un
    // `v.trim().length === 7`. Esto exige que cada uno de los seis **llame** al dueno.
    //
    // **Una llamada y no un nombre, por una razon medida.** Buscando `normalizaColor`
    // a secas lo hacia pasar un `import` sin usar —probado: sustituir las dos
    // llamadas por un `trim().length === 7` deja el import en su sitio y este test
    // en verde—. Se busca `normalizaColor(` o `TAG_HEX.`, que es donde la pregunta
    // se hace de verdad. El `import` sin usar tampoco se escapa del `typecheck`, que
    // tiene `noUnusedLocals`, pero eso es otra red y esta no depende de ella.
    const sinDueno = FICHEROS_QUE_DELEGAN.flatMap(([ruta, quien]) =>
      sinComentarios(readFileSync(join(REPO, ruta), "utf8")).match(/normalizaColor\s*\(|TAG_HEX\s*\./)
        ? []
        : [`${ruta} (${quien}) no llama ni a normalizaColor ni a TAG_HEX`],
    );
    expect(sinDueno).toEqual([]);
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
 * **El 3 va escrito a mano en todos ellos y no se lee de
 * `MIN_LABEL_CONTRAST`, y es a proposito**: el comentario de la constante —en
 * `tag-colors.ts`— dice que el test la escribe para que bajarla produzca un test
 * rojo, y leerla haria que las dos cosas bajaran a la vez y el suite entero
 * siguiera en verde. Aqui es donde vive ese 3 a mano —los tests que lo tenian en
 * `tag-color-plan.test.ts` se fueron con la puerta que mediaban—, asi que si
 * alguna vez se afloja el umbral, que sea este bloque el que se ponga rojo y no una
 * pantalla.
 *
 * **Bajo de 4.5 a 3 con la decision a la vista, y el 3.0 de aqui es el de las
 * insignias, no un numero saluido de la cuenta.** Los cuatro tonos de prioridad dan
 * 3.00 (`success`), 3.25 (`warning`), 4.15 (`danger`) y 4.44 (`info`) sobre su
 * lavado, y el mas flojo de los cuatro es 3.00. Una pastilla que se parece a una
 * insignia no puede traer un liston que las insignias no tienen. **Lo que se acepta
 * a cambio:** el texto de una pastilla queda entre 3 y 4.5, y en el peor tono se
 * queda en 3.01. Es el mismo margen que arrastra `success` desde antes de que
 * existiera este fichero.
 */
describe("la pastilla deriva relleno y texto", () => {
  it("el relleno es el color mezclado con la superficie", () => {
    // La composicion se afirma con `mixHex` y no con un hex escrito a mano: el
    // redondeo del ultimo canal es lo unico que haria fallar un numero fijo, y eso
    // no es lo que este test comprueba.
    expect(labelPillColors("#16A34A", "#FFFFFF", "light").fill).toBe(
      mixHex("#16A34A", "#FFFFFF", 0.06),
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
    // y el retorno era `#NANNANNAN`. Eso no es un color invalido cualquiera: son
    // diez caracteres —nueve cifras donde un `#RRGGBB` tiene seis, y ninguna
    // hexadecimal—, asi que el parser de CSS **rechaza** la declaracion entera y el
    // fallo es **una pastilla que se queda con el color de antes**, no una pantalla
    // roja. Medido antes del arreglo.
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

  it("el texto llega a 3:1 contra su propio relleno", () => {
    // Los hex son de `ICON_COLORS`, la paleta de doce. **No** son los del tema:
    // `success` es #0E9F6E y `green` de la paleta es #16A34A, y con el valor
    // equivocado la pastilla se dibujaria de un color y se guardaria otro.
    for (const color of ["#16A34A", "#D97706", "#2563EB", "#9333EA", "#E11D48"]) {
      for (const scheme of ["light", "dark"] as const) {
        const surface = scheme === "light" ? "#FFFFFF" : "#111827";
        const { fill, text } = labelPillColors(color, surface, scheme);
        expect(contrastRatio(text, fill)).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("lee tambien cuando el color es casi el de la superficie", () => {
    // El peor caso: un color elegido tan parecido a la superficie que el relleno
    // sale casi igual que ella. El texto tiene que leerse contra ESE relleno.
    const surface = "#F0F2F8";
    const { fill, text } = labelPillColors("#EFF1F7", surface, "light");
    expect(contrastRatio(text, fill)).toBeGreaterThanOrEqual(3);
  });

  it("lee con un blanco puro y con un negro puro", () => {
    expect(contrastRatio(labelPillColors("#FFFFFF", "#FFFFFF", "light").text, labelPillColors("#FFFFFF", "#FFFFFF", "light").fill))
      .toBeGreaterThanOrEqual(3);
    expect(contrastRatio(labelPillColors("#000000", "#111827", "dark").text, labelPillColors("#000000", "#111827", "dark").fill))
      .toBeGreaterThanOrEqual(3);
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
    // llega a 3:1, pero eso lo cumpliria tambien una cuenta que landing en otro
    // sitio; lo que esta tabla fija es **que color sale**, y es lo que hace que los
    // numeros que hay escritos en los comentarios de `tag-colors.ts` sean
    // comprobables: si el paso, el porcentaje de mezcla o el corte del extremo se
    // mueven, esta tabla se pone roja y los comentarios quedan mintiendo solos.
    //
    // Superficies **las del tema**, `#F0F2F8` y `#1B2231`, y no las del brief
    // (`#FFFFFF` y `#111827`), que son de otro tema. Nombre, texto de claro, relleno
    // de claro, contraste, texto de oscuro, relleno de oscuro, contraste.
    //
    // **Estos valores se miden, no se escriben: se sacan de `labelPillColors` con
    // las dos constantes ya puestas y se pegan aqui.** El contraste se pega con dos
    // decimales, que es lo que la funcion promete y lo que hace que el `toBeCloseTo`
    // de abajo sea una comprobacion y no un adorno.
    //
    // **Lo que ahora se ve, y no se ve antes:** con el relleno al 6% y liston 3,
    // **ninguno de los doce sale por debajo de luminancia 0.036** —no hay ningun
    // texto que sea indistinguible de negro— y ninguno se va al extremo blanco. Al
    // 14% con liston 4.5 once de los doce caian por debajo de 0.036 y `teal` en
    // oscuro salia en `#FDFFFF`. Los textos de esta tabla son oscuros, pero son
    // **del tono elegido**: `#0B5225` es verde, `#06403A` es verde azulado, `#3A0A65`
    // es violeta.
    const esperado = [
      ["neutral", "#414858", "#9099AD", 3.2, "#F3F4F6", "#838CA1", 3.06],
      ["accent", "#0F12A2", "#6B6EF1", 3.15, "#CACBFA", "#5F62E5", 3.08],
      ["green", "#0B5225", "#23A854", 3.03, "#C1F7D5", "#169B49", 3.01],
      ["olive", "#203306", "#57831D", 3.04, "#8BE01B", "#4A7711", 3.24],
      ["amber", "#6C3B03", "#DA7E15", 3.08, "#FEF0E0", "#CE7209", 3.11],
      ["orange", "#6C2906", "#EA611A", 3.18, "#FDDFD0", "#DE550E", 3.08],
      ["red", "#5A0F0F", "#DD3233", 3.03, "#F4BBBB", "#D02627", 3.18],
      ["rose", "#590C1D", "#E22A53", 3.14, "#F6B6C4", "#D51D47", 3.03],
      ["purple", "#3A0A65", "#993EEB", 3.01, "#D3ABF6", "#8C32DF", 3.0],
      ["blue", "#092564", "#316CEC", 3.07, "#A8C1F7", "#245FE0", 3.07],
      ["teal", "#06403A", "#1B9A8F", 3.37, "#70F2E7", "#0E8D83", 3.01],
      ["brown", "#190B02", "#984B1C", 3.08, "#EF8F55", "#8B3E10", 3.12],
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
    // **El caso que hace falta la segunda vuelta: un negro puesto a mano en tema
    // claro.** No es un color de la paleta —los doce nunca lo necesitan al 6%— es el
    // primero que escribe cualquiera en el selector de hex, y por eso lo afirma un
    // test y no un comentario.
    //
    // Y el numero que lo hace pasar por aqui es **la mezcla**: `mixHex(hex, surface,
    // t)` interpola de `hex` hacia `surface`, asi que `t = 0.06` deja el relleno pegado
    // al color elegido. Con `#000000` sobre la superficie clara del tema, el relleno
    // al 14% era `#222223` y al **6% es `#0E0F0F`** —mas negro todavia—. El negro
    // sobre eso da **1.09:1**, que no pasa ni de lejos, y el blanco da 19.20:1.
    // Sin la vuelta ese texto se dibuja ilegible en un color que **parece** el que
    // eligio la persona, que es peor que el gris de antes.
    const { fill, text } = labelPillColors("#000000", "#F0F2F8", "light");
    //
    // Lo primero es el **motivo** de la vuelta, afirmado y no en un comentario: el
    // negro no llega al liston sobre ese relleno. Si algun dia cambia la mezcla y el
    // negro si llega, este test se pone rojo y avisa de que la justificacion de la
    // segunda vuelta ya no es la de antes.
    expect(contrastRatio("#000000", fill)).toBeLessThan(3);
    // Y lo segundo es lo que se hace con eso: aclarar. 19.20:1 sobre el mismo
    // relleno, y un texto del lado del blanco y no del lado del negro. Se mira el
    // color y no solo la cifra, porque un texto que llegara a 3:1 siendo negro seria un
    // fallo aqui —el negro es justamente el que no pasa—.
    expect(contrastRatio(text, fill)).toBeGreaterThanOrEqual(3);
    expect(text).not.toBe("#000000");
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
              3,
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
