import { normalizaColor } from "@orbit-hub/contracts";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ICON_COLORS } from "@/theme/tokens";

/** The twelve in the light scheme: the stored hexes are the light ones. */
const TWELVE = Object.values(ICON_COLORS).map((entry) => entry.light);
import { dictionaries, formatTranslation } from "@/lib/i18n/dictionaries";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import {
  contrastRatio,
  hexDeHsv,
  normalizaHex,
  tintaDe,
} from "@/lib/lists/tag-colors";
import { hexToHsv, HUE_STRIP } from "@/lib/workspace/picker";
import { esHex } from "@/lib/workspace/hsl";

/**
 * The two things about a label's colour picker that a Node test can say anything
 * about: what the field accepts, and the arithmetic that turns a finger into a
 * colour. Everything else in the component — twelve swatches, hue strip, square,
 * recents — is checked in a browser, in Task 7.
 *
 * **The functions under test live in `@/lib/lists/tag-colors` and not in the
 * component.** `tag-color-picker.tsx` imports `@expo/vector-icons` and
 * `react-native-gesture-handler`, and neither can be loaded by `vitest run`: the
 * first fails with `Cannot find module .../createIconSet` and the second is Flow
 * (`SyntaxError: Unexpected token 'typeof'`), measured in this repo with a test
 * that imports `workspace-color-picker.tsx` and nothing else. The component
 * re-exports all three, so the picker still offers them where this file says it
 * does.
 */
describe("el campo de color", () => {
  it("normaliza un hex de seis digitos a mayusculas", () => {
    expect(normalizaHex("#aabbcc")).toBe("#AABBCC");
    expect(normalizaHex("aabbcc")).toBe("#AABBCC");
  });

  it("amplia un hex de tres digitos y no acepta los demas", () => {
    // `esHex` ya acepta tres y seis, y hay un comentario en `hsl.ts` que explica
    // que se dejo asi a proposito. Este selector no puede ser mas estrecho que el
    // de los espacios: el mismo usuario, el mismo campo, dos reglas distintas.
    expect(normalizaHex("#fff")).toBe("#FFFFFF");
    expect(normalizaHex("#ff")).toBeNull();
    expect(normalizaHex("#gggggg")).toBeNull();
    expect(normalizaHex("")).toBeNull();
  });

  it("el color del cuadro y el del campo son el mismo", () => {
    // `Hsv` es `{ h: 0-360 grados, s: 0-1, v: 0-1 }` — la s y la v van de 0 a 1,
    // no de 0 a 100. Es la forma que ya espera `puntoAHsv`.
    const hsv = hexToHsv("#3B5FDE");
    expect(hexDeHsv(hsv.h, hsv.s, hsv.v)).toBe("#3B5FDE");
  });

  it("y el cuadrado no mueve un color al ir y volver", () => {
    // El round trip es el que decide si el boton de "usar este color" guarda lo
    // que se esta viendo o un hex al lado. Los doce de la paleta y un blanco, un
    // negro y un gris, que son los tres casos donde el tono no existe.
    for (const hex of [...TWELVE, "#FFFFFF", "#000000", "#808080"]) {
      const hsv = hexToHsv(hex);
      expect(hexDeHsv(hsv.h, hsv.s, hsv.v)).toBe(hex.toUpperCase());
    }
  });

  /**
   * El campo, el mapa y el otro validador del movil tienen que aceptar lo mismo.
   *
   * **Tres puertas y una regla, y antes tres reglas.** `normalizaHex` —la puerta de
   * este campo— es literalmente `normalizaColor`; `esHex`, el validador de los
   * espacios, testea el `TAG_HEX` de al lado. O sea que los tres ya no pueden
   * separarse: lo que se compara aqui es que los tres digan lo mismo sobre lo que
   * la gente escribe, y no que tres copias de una regla sigan copiandose.
   *
   * Lo que ata a los tres es **esta** comparacion, y sigue siendo lo unico que la
   * ata: si `TAG_HEX` se estrecha o se ensancha un dia, los tres se mueven con ella,
   * y sin esta comparacion nadie se enteraria de que se movieron.
   *
   * La lista esta **generada, y no escrita**, porque una lista escrita solo pilla
   * el ensanchamiento que alguien se imaginó: la primera version de este test no
   * tenia `"#abcd"` y por eso un hex con alfa —el ensanchamiento mas probable que
   * existe, porque React Native y el CSS lo admiten— lo dejaba verde.
   */
  it("el campo y el mapa y el validador de los espacios aceptan lo mismo", () => {
    for (const candidato of candidatosHex()) {
      // El `as string` es por los que no son cadenas: el campo nunca entrega un
      // numero, pero `normalizaHex` se apoya en `normalizaColor(texto: unknown)` y
      // por eso responde `null` en vez de lanzar.
      const delCampo = normalizaHex(candidato as string) !== null;
      expect({ candidato, esHex: esHex(candidato) }).toEqual({
        candidato,
        esHex: delCampo,
      });
      expect(delCampo).toBe(normalizaColor(candidato) !== null);
    }
  });
});

/**
 * Los doce de la paleta llevan encima una tilde, un icono o el anillo del
 * marcador, y esa tinta tiene que leerse **sobre el color elegido**.
 *
 * No es una regla de este archivo: es lo que hace `tintaDe`, y sin ella el
 * selector es un sitio donde doce colores y un blanco se dibujan encima los unos
 * de los otros sin que nadie lo note —que es justo lo que este selector no puede
 * ser, porque el texto de una pastilla ya no es el color que eligio nadie (ver
 * `labelPillColors`): aqui el color elegido se ve, y solo aqui.
 */
describe("la tinta que se lee encima de un color", () => {
  /** 3:1 es el minimo de WCAG para lo que no es texto; el contraste no textual. */
  const MINIMO_DE_UN_ICONO = 3;

  it("se lee sobre los doce de la paleta", () => {
    for (const hex of TWELVE) {
      expect({ hex, ratio: contrastRatio(tintaDe(hex), hex) >= MINIMO_DE_UN_ICONO }).toEqual({
        hex,
        ratio: true,
      });
    }
  });

  it("y sobre lo que escribe el campo, sea del color que sea", () => {
    for (const hex of ["#000000", "#010203", "#FEFEFE", "#7F7F80", "#3B5FDE"]) {
      expect(contrastRatio(tintaDe(hex), hex)).toBeGreaterThanOrEqual(MINIMO_DE_UN_ICONO);
    }
  });

  it("elige el extremo, y no un gris a medio camino", () => {
    // Un gris medio se leeria en los dos extremos y en ninguno del todo: la
    // respuesta tiene que ser uno de los dos o no es una respuesta.
    expect(tintaDe("#000000")).toBe("#FFFFFF");
    expect(tintaDe("#FFFFFF")).toBe("#000000");
    expect(["#000000", "#FFFFFF"]).toContain(tintaDe("#8A93A8"));
  });

  /**
   * El tercer bucle, y es el que cierra el defecto que Task 5 arrastraba.
   *
   * El anillo del marcador de la tira se pintaba con un `borderColor: "#FFFFFF"`
   * fijo, y la tira es el unico control que produce un color arbitrario. Medido
   * contra los seis tonos de `HUE_STRIP`: **1.07:1 sobre `#FFFF00`, 1.25 sobre
   * `#00FFFF` y 1.37 sobre `#00FF00`** — tres de seis por debajo de lo que se ve
   * como un pelo, en un anillo de tres puntos de ancho, invisible en justo la
   * mitad del circulo. En los otros tres si se veia, y eso es lo que lo escondia:
   * un marcador que esta la mitad del tiempo parece uno que falla.
   *
   * **El bucle va sobre `HUE_STRIP` y no sobre una lista escrita aqui**, porque la
   * tira es la que se dibuja con el y una copia de sus seis tonos en un test es una
   * segunda fuente que se queda vieja: se anade un tono al circulo y este test
   * sigue creyendo que son seis. `new Set` porque `HUE_STRIP` cierra el circulo
   * repitiendo el primero, y el primero ya esta una vez.
   */
  it("se lee sobre los seis tonos por los que pasa la tira", () => {
    for (const hex of new Set(HUE_STRIP)) {
      expect({ hex, ratio: contrastRatio(tintaDe(hex), hex) >= MINIMO_DE_UN_ICONO }).toEqual({
        hex,
        ratio: true,
      });
    }
  });

  /**
   * Y que el anillo de la tira **pida** esa tinta, y no la lleve puesta.
   *
   * El bucle de arriba verifica que `tintaDe` funciona sobre los seis tonos, y eso
   * no dice nada de si el componente la llama: `tintaDe` podia acertar durante meses
   * con un `#FFFFFF` fijo en `styles.marcadorTira` al lado, y todo este bloque
   * seguiria en verde. El defecto era del componente y el test tiene que poder
   * falsificar **al componente**, asi que lee el fuente —el mismo metodo que usa
   * `task-row-layout.test.ts`, y por el mismo motivo: aqui no se monta nada.
   *
   * Se comprueban las dos mitades y no una: que el estilo no traiga un color fijo
   * —el sintoma— y que el marcado lo pida con `tintaDe` sobre el color que hay
   * **debajo**, que es el otro error posible y el mas sutil: `marcador` ya lo hace
   * asi para el cuadrado, y este marcador esta en la tira, cuya superficie es
   * `HUE_STRIP` entera y no el color que el cuadrado este mostrando.
   */
  it("el anillo de la tira no lleva un color fijo y lo pide a la tinta", () => {
    const fuente = sinComentarios(
      readFileSync(
        join(import.meta.dirname, "..", "src", "components", "lists", "tag-color-picker.tsx"),
        "utf8",
      ),
    );
    const marcador = fuente.match(/marcadorTira:\s*\{([\s\S]*?)\n {2}\},/);
    expect(marcador).not.toBeNull();
    // El sintoma: un color escrito en el estilo, que es lo que no depende del tono.
    expect(marcador?.[1]).not.toMatch(/borderColor/);
    // Y el remedio: la tinta del color de la tira en ese punto, saturacion y
    // claridad a uno porque `HUE_STRIP` es exactamente eso.
    expect(fuente).toContain("borderColor: tintaDe(hexDeHsv(hsv.h, 1, 1))");
  });
});

/**
 * Los dos montajes del selector en la hoja, y el_guard_ que comparten.
 *
 * **Un componente, dos montajes, y lo unico que cambia es cuando escribe.** El que
 * cuelga de una pastilla escribe por `onTagColor` en el momento —la etiqueta ya
 * existe y hay un mapa al que escribirle— y el que esta bajo el campo de "nueva
 * etiqueta" escribe en `pendiente`, que es estado local del panel, porque todavia no
 * hay etiqueta a la que ese color pertenezca. Elegir el color de "Mercadona" y
 * elegir el de "Alcampo" se hacen delante de lo mismo, que es el motivo de que este
 * bloque exista: si un dia divergen, son dos selectores otra vez.
 *
 * Aqui no se monta nada —el mismo limite que el bloque de arriba— asi que se lee el
 * fuente de la hoja. Lo que se comprueba es lo que **no se ve en una captura** y es
 * justo lo que se puede equivocar sin que nadie lo note: quantas veces se monta, con
 * que valor, por donde escribe cada uno, y si los dos caminos de escritura pasan por
 * el mismo guard. Un boton que aprieta y no escribe se ve en el navegador; una
 * segunda escritura que se salta el guard no se ve en ninguna parte hasta que se
 * pierde el color de otra etiqueta.
 */
describe("los dos montajes del selector en la hoja", () => {
  const fuenteDeLaHoja = readFileSync(
    join(import.meta.dirname, "..", "src", "components", "lists", "item-edit-sheet.tsx"),
    "utf8",
  );
  const hoja = sinComentarios(fuenteDeLaHoja);

  /**
   * Los `<TagColorPicker …/>` de la hoja, con lo que llevan dentro.
   *
   * **El `/>` del final es el del elemento y no el primero que aparezca**, y esa
   * distincion es la diferencia entre contar montajes y contar comillas: un
   * `<TagColorPicker` seguido de `[\s\S]*?` se come todo lo que haya hasta el
   * primer cierre de otra cosa de mas abajo —un `Button`, un `Ionicons`— y cuenta
   * tres con dos montajes en la hoja. De ahi el `[^/]` con la excepcion del `/>`:
   * una `/` dentro de las props es un cierre de elemento, no otra cosa.
   */
  const montajes = [...hoja.matchAll(/<TagColorPicker(?:[^/]|\/(?!>))*\/>/g)].map((m) => m[0]);

  it("la hoja monta el selector tres veces, y la tira se ha ido", () => {
    // **Tres, y el numero va escrito porque no es el evidente.** Dos son las dos
    // filas de etiquetas —las que lleva esta tarea y las que la lista ya tiene— y
    // cada una monta el suyo detras de `colorDe === tag`, que es una condicion por
    // fila, no una condicion global: por eso son dos y no uno. La tercera es el de
    // "nueva etiqueta", que no depende de nada. Un cuarto seria un `TagColorStrip`
    // vivo, que es otro camino para elegir un color con trece opciones en lugar de
    // con el selector.
    expect(montajes).toHaveLength(3);
    expect(hoja).not.toContain("TagColorStrip");
    // Y las dos de pastilla detras de la misma condicion, que es lo que hacia que las
    // dos filas compartieran un solo selector abierto. Con la llave de apertura en el
    // patron y no solo el `colorDe === tag`: los botones de la pastilla llevan la
    // misma comparacion en su `open` y en su `onPress`, asi que sin ella el numero
    // que sale es cuatro y no dos.
    expect([...hoja.matchAll(/\{colorDe === tag \? \(/g)]).toHaveLength(2);
  });

  it("el de una etiqueta que ya existe lee del borrador mezclado", () => {
    // `?? null` y no el valor a secas: `coloresVistos[tag]` es `string |
    // undefined`, y `undefined` para `value: string | null` seria "sin color"
    // por la puerta de atras en lugar de por la de adelante.
    //
    // **`coloresVistos` y no `tagColors`: el selector enseña lo que se va a
    // guardar.** `coloresVistos` es el mapa de la lista con el borrador
    // (`colores`) aplicado —el color se pinta en el toque y sale por Guardar—,
    // y un `null` en el borrador ("volver al deducido") borra la clave para que
    // se pinte el deducido y no el color viejo.
    const deLaPastilla = montajes.filter((m) =>
      m.includes("value={coloresVistos[tag] ?? null}"),
    );
    expect(deLaPastilla).toHaveLength(2);
    for (const montaje of deLaPastilla) {
      expect(montaje).toContain("onChange={(hex) => void pickColor(tag, hex)}");
      expect(montaje).toContain("onClose={() => setColorDe(null)}");
    }
  });

  it("las dos pastillas de la hoja se pintan con el borrador mas el arrastre y no con lo guardado", () => {
    // Este es el pin del fallo real: las dos `TagChip` de la hoja leian
    // `colors={tagColors}` y ni el borrador ni el arrastre les llegaban por
    // ningun camino. Si alguien las vuelve a lo guardado, elegir un color y ver
    // el viejo hasta pulsar Guardar es un panel que miente sobre lo que va a
    // guardar.
    const pastillas = [...hoja.matchAll(/<TagChip tag=\{tag\} colors=\{[^}]+\}/g)].map((m) => m[0]);
    expect(pastillas).toHaveLength(2);
    for (const pastilla of pastillas) {
      expect(pastilla).toContain("colors={coloresPintados}");
    }
  });

  it("los dos selectores de pastilla avisan del arrastre y el de la etiqueta nueva no", () => {
    // Arrastrar el cuadrado o la tira solo mueve el estado local del selector
    // hasta que algo se pulsa: sin este aviso la pastilla mantiene el color viejo
    // mientras el color nuevo ya esta en pantalla bajo el dedo. Los dos
    // selectores de pastilla lo pasan (`vistaPrevia`, que la hoja mezcla al
    // pintar pero nunca al `value` —devolver el borrador al `value` haria que el
    // efecto del selector llevase el cuadrado de vuelta en mitad del arrastre—)
    // y el de la etiqueta nueva no, porque no hay pastilla que pintar.
    const deLaPastilla = montajes.filter((m) =>
      m.includes("onChange={(hex) => void pickColor(tag, hex)}"),
    );
    expect(deLaPastilla).toHaveLength(2);
    for (const montaje of deLaPastilla) {
      expect(montaje).toContain("onPreviewChange=");
    }
    const deLaEtiquetaNueva = montajes.filter((m) => m.includes("value={pendiente}"));
    expect(deLaEtiquetaNueva).toHaveLength(1);
    expect(deLaEtiquetaNueva[0]).not.toContain("onPreviewChange");
  });

  it("el de la etiqueta nueva escribe en estado local y no escribe nada todavia", () => {
    const deLaEtiquetaNueva = montajes.filter((m) => m.includes("value={pendiente}"));
    expect(deLaEtiquetaNueva).toHaveLength(1);
    expect(deLaEtiquetaNueva[0]).toContain("onChange={setPendiente}");
    // `nombreNuevo || undefined` y no `newTag`: el picker deriva sus trece colores
    // del nombre, y un nombre con espacios rodeando es el mismo nombre. Con un
    // `tag` de `""` el panel dibujaria el color deducido de una etiqueta vacia.
    expect(deLaEtiquetaNueva[0]).toContain("tag={nombreNuevo || undefined}");
    // Y sin `onClose`: este no se cierra nunca solo, porque no hay nada que
    // escribir todavia. Un boton de cerrar aqui seria la unica manera de vaciar el
    // color pendiente, y esa regla es del nombre.
    expect(deLaEtiquetaNueva[0]).not.toContain("onClose");
  });

  it("el alta de una etiqueta con color va al borrador, y no a la lista", () => {
    /*
      Antes pasaba por el mismo guard async que elegir un color, porque eran dos
      escrituras seguidas que partian del mismo mapa. Ahora no hay escrituras
      seguidas: el alta deja el color en `colores` y sale todo junto al confirmar,
      en serie, que es lo unico que impide que dos escrituras partan del mismo mapa.
    */
    const addTag = hoja.match(/const addTag = \(\) => \{([\s\S]*?)\n  \};/);
    expect(addTag).not.toBeNull();
    const cuerpo = addTag?.[1] ?? "";
    expect(cuerpo).toContain("setColores((previos) => ({ ...previos, [trimmed]: color }))");
    expect(cuerpo, "el alta ya no escribe").not.toContain("onTagColor");
    expect(cuerpo, "y ya no es async").not.toContain("await");
    // Y por la prop y no por el hook: la hoja recibe `listId` y `tagColors`, no la
    // lista, y la escritura vive en quien la tiene.
    expect(hoja).not.toContain("setTagColor");
  });

  it("elegir un color no cierra el selector: solo lo cierra un cierre", () => {
    // Cerrar al elegir revelaba el formulario de etiqueta nueva y leer eso era
    // salir de edicion para entrar en creacion. Ahora elegir es probar: la
    // pastilla sigue cada toque desde el borrador y el selector se queda, y solo
    // el lapiz o "cerrar" lo quitan. Si `pickColor` volviera a llamar a
    // `setColorDe`, el arreglo entero se iria con el.
    const pick = hoja.match(/const pickColor = \([^)]*\) => \{([\s\S]*?)\n  \};/);
    expect(pick).not.toBeNull();
    const cuerpoPick = pick?.[1] ?? "";
    expect(cuerpoPick).toContain("setColores(");
    expect(cuerpoPick).not.toContain("setColorDe");
    expect(cuerpoPick).not.toContain("onTagColor");
    expect(cuerpoPick).not.toContain("await");
  });

  /**
   * **La comprobacion de duplicado va antes de los dos `set`, y eso es lo que
   * cuesta el perder color.**
   *
   * Con la comprobacion despues de limpiar, un toque para un nombre que ya esta
   * en la tarea deja la etiqueta puesta sin color, tira el color pendiente con
   * el nombre, y no queda nada de donde recuperarlo: `pendiente` nunca estuvo en
   * `tagColors`. La perdida de datos era **una consecuencia del orden**, asi que
   * lo que se fija es el orden, por la posicion y no por la presencia.
   */
  it("la comprobacion de duplicado va antes de limpiar nada", () => {
    const cuerpo = hoja.match(/const addTag = \(\) => \{([\s\S]*?)\n  \};/)?.[1] ?? "";
    const duplicado = cuerpo.indexOf("if (shown.tags.includes(trimmed)) return;");
    const limpiaNombre = cuerpo.indexOf('setNewTag("")');
    const limpiaColor = cuerpo.indexOf("setPendiente(null)");
    expect([duplicado, limpiaNombre, limpiaColor].every((i) => i >= 0)).toBe(true);
    expect({
      duplicadoAntesDeLimpiar: duplicado < limpiaNombre && duplicado < limpiaColor,
      limpiaDespuesDeLeerElColor: cuerpo.indexOf("const color = pendiente;") < limpiaColor,
    }).toEqual({
      duplicadoAntesDeLimpiar: true,
      limpiaDespuesDeLeerElColor: true,
    });
  });

  /**
   * **El volcado es en serie, y eso es lo que impide que una escritura se coma a
   * la otra.**
   *
   * `onTagColor` planifica desde la lista que su llamante capturo, asi que dos
   * escrituras a la vez parten del mismo mapa y la segunda se come a la primera sin
   * que ninguna se entere. Antes lo impedia el flag `guardando`, que ya no existe
   * porque ya no hay escrituras concurrentes que impedir — el volcado es la unica,
   * y va de una en una con `await` dentro de un `for`.
   *
   * Un test que solo buscara "hay un await" seguiria en verde con un
   * `Promise.all`, que es justo el arrangement que perderia el color.
   */
  it("los colores salen de uno en uno al confirmar", () => {
    const volcado = hoja.match(/const volcarColores = async \(\) => \{([\s\S]*?)\n  \};/)?.[1] ?? '';
    expect(volcado, "existe el volcado").not.toBe('');
    expect(volcado, "un bucle y no un Promise.all").toMatch(/for \(const .* of Object\.entries\(colores\)\)/);
    expect(volcado, "con await dentro").toContain("await onTagColor(etiqueta, color);");
    expect(volcado, "y sin Promise.all").not.toContain("Promise.all");
    // Y el que no ha cambiado no sale: escribir lo mismo es una operacion en la
    // cola de sincronizacion por nada.
    expect(volcado, "salta lo que no cambio").toContain(
      "if ((tagColors[etiqueta] ?? null) === color) continue;",
    );
  });

  it("el color pendiente se vacia con el nombre, y en los dos caminos que lo vacian", () => {
    // Sin nombre no hay etiqueta a la que un color pertenezca, y un color colgando
    // de un nombre que ya no existe es un color que nadie puede volver a leer.
    expect(hoja).toContain('if (nombreNuevo === "") setPendiente(null);');
    // Y tambien al reabrir: `setNewTag("")` sobre un campo ya vacio no cambia nada,
    // React lo descarta y el efecto de arriba no llega a dispararse nunca. Por eso
    // los dos reinicios del panel lo dicen por su cuenta — **cuatro** en total, y el
    // numero va aqui porque subirlo es cambiar la regla y bajarlo es dejar un hueco
    // por donde un color pendiente sobrevive a un nombre que ya no existe.
    expect([...hoja.matchAll(/setPendiente\(null\);/g)]).toHaveLength(4);
  });
});

/**
 * El fuente de un componente **sin sus comentarios**, y por que hace falta quitarlo.
 *
 * Este archivo lee el fuente porque aqui no se monta nada, y un componente de este
 * repositorio explica en prosa justo lo que sus comprobaciones preguntan: el
 * `marcadorTira` de `tag-color-picker.tsx` dice "**No `borderColor` here**" para
 * explicar que se ha ido, y la hoja dice "`onTagColor` y no `setTagColor`" al
 * hablar de la prop. Sin quitarlos, una comprobacion que busca `borderColor` da
 * verde porque lo nombra un comentario y una que busca `setTagColor` da verde
 * porque el codigo no lo usa: **las dos darian el resultado contrario del que
 * miden, sin fallar nunca**.
 *
 * El `[^:]` del final es para no comerse el `//` de un `http://`: sin el, un
 * import de una URL se partiria por la mitad. Los comentarios de bloque de estos
 * archivos no se anidan, que es lo unico que haria falta para que esto no fuera
 * una regexp honesta.
 */
function sinComentarios(texto: string): string {
  return texto
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * Los dos selectores de la hoja **no se pueden confundir de nombre**, y esto es
 * nuevo con el segundo montaje.
 *
 * En la pagina de etiquetas hay dos instancias de este panel a la vez —la de una
 * pastilla, que escribe enseguida, y la del campo de "nueva etiqueta", que escribe en
 * un estado pendiente— asi que hay dos de cada control, y un lector de pantalla anuncia
 * uno cada vez sin acordarse de donde estaba. Dos botones "Usar este color" y dos
 * "Guardar" y dos "Tono del color", **cada uno compromising un color distinto**, es un
 * panel donde el nombre no dice de quien es nada.
 *
 * Se comprueba en las dos mitades, porque las dos se pueden romper por separado:
 * que el componente **pase** el nombre, y que el diccionario **haga que las dos
 * instancias digan cosas distintas**. Con el diccionario roto —las dos plantillas
 * iguales— el componente sigue pasando `nombreDe` y el panel sigue siendo ilegible;
 * con el componente roto el diccionario esta bien y no se nota.
 */
describe("los dos selectores de la hoja no se confunden de nombre", () => {
  const fuente = sinComentarios(
    readFileSync(
      join(import.meta.dirname, "..", "src", "components", "lists", "tag-color-picker.tsx"),
      "utf8",
    ),
  );

  /**
   * Las ocho claves del panel, y la razon de que sean **ocho y no una**: cada
   * control necesita la suya porque cada control se nombra por separado y "de
   * quien" se primero. Una clave con un parametro y un nombre generico no sirve:
   * el nombre generico es justo lo que hay que quitar.
   *
   * **`tags.recentColorOf` esta porque la fila de recientes vive en las dos
   * instancias.** Antes no estaba, y no era un olvido: la fila solo se pinta
   * cuando tiene algo, y en una instancia que se cerraba al escribir no tenia
   * nunca nada —asi que solo habia una que la nombrara y el nombre sin
   * calificar no era ambiguo—. Desde que el selector se queda abierto, la fila
   * acumula tambien ahi, y "usar el color" sin decir para quien son las mismas
   * palabras para dos etiquetas distintas.
   *
   * **Y `tags.colorUseOf` tampoco esta, y tampoco es un olvido**: era el nombre del
   * boton de "usar este color", y el boton se fue —ahora escribe el dedo al
   * levantarse. Una clave en esta lista que ya no esta en el componente rompe el
   * test de abajo, que es exactamente lo que tiene que pasar cuando un control
   * muere: la lista lo entierra con el.
   */
  const CALIFICADAS = [
    "tags.colorOf",
    "tags.colorSwatchOf",
    "tags.colorHueOf",
    "tags.colorSquareOf",
    "tags.colorCustomOf",
    "tags.colorSaveOf",
    "tags.colorCloseOf",
    "tags.recentColorOf",
  ] as const satisfies readonly TranslationKey[];

  it("cada nombre accesible del selector lleva el nombre de quien es", () => {
    // **La lista de excepciones esta escrita aqui y no metida en el filtro**, para
    // que anadir una excepcion sea tocar una linea de esta lista y relajar la
    // regla lo sea para todos los nombres a la vez. Hoy esta vacia: hasta los
    // recientes dicen para quien son, desde que la fila vive tambien en los
    // selectores que ya no se cierran.
    const SIN_NOMBRE_POR_RAZON: string[] = [];
    const sinNomear = etiquetasAccesibles(fuente)
      .filter((expr) => expr.includes('t("tags.'))
      .filter((expr) => !expr.includes("nombreDe"))
      .map((expr) => /t\("([^"]+)"/.exec(expr)?.[1] ?? expr);
    // Y **la lista entera, no la lista menos las excusas**: asi una excepcion que
    // desaparece del componente tambien sale, en vez de volverse un hueco silencioso.
    expect(sinNomear).toEqual(SIN_NOMBRE_POR_RAZON);
    // Y las ocho estan de verdad en el componente: una lista de ocho aqui y seis en
    // el fichero pasaria este test sin decir nada.
    for (const clave of CALIFICADAS) {
      expect(fuente).toContain(`t("${clave}"`);
    }
  });

  it("y las dos instancias del mismo control dicen dos cosas distintas", () => {
    // El caso que de verdad duele: las dos plantillas existen, ambas llevan `{name}`, y
    // alguien las deja iguales. Aqui sale, porque se comparan las dos cadenas.
    for (const clave of CALIFICADAS) {
      const plantilla = dictionaries.es[clave];
      const conEtiqueta = formatTranslation(plantilla, { name: "Mercadona" });
      const conPendiente = formatTranslation(plantilla, {
        name: dictionaries.es["tags.pendingLabel"],
      });
      expect({ clave, distintos: conEtiqueta !== conPendiente && !conEtiqueta.includes("{name}") }).toEqual({
        clave,
        distintos: true,
      });
    }
  });
});

/**
 * Todas las expresiones `accessibilityLabel={…}` de un fuente, con las llaves
 * emparejadas.
 *
 * Con una regexp que acaba en `[^}]*}` no vale: el valor de una de ellas es
 * `t("tags.colorSwatchOf", { color: …, name: … })`, que tiene llaves dentro, y el
 * patron cortaría por la primera y leería media etiqueta.
 */
function etiquetasAccesibles(fuente: string): string[] {
  const salida: string[] = [];
  const marca = "accessibilityLabel={";
  let desde = 0;
  for (;;) {
    const inicio = fuente.indexOf(marca, desde);
    if (inicio < 0) return salida;
    let i = inicio + marca.length;
    let profundidad = 1;
    while (i < fuente.length && profundidad > 0) {
      if (fuente[i] === "{") profundidad += 1;
      if (fuente[i] === "}") profundidad -= 1;
      i += 1;
    }
    salida.push(fuente.slice(inicio + marca.length, i - 1));
    desde = i;
  }
}

/**
 * Todo lo que un validador de hex podria aceptar o dejar de aceptar.
 *
 * La primera mitad son los casos que tienen nombre —el `trim`, la `#` que si y la
 * que no, el hexadecimal de funcion— y la segunda son **todas las longitudes de 0
 * a 9**, con y sin almohadilla. Lo segundo es lo que ata de verdad: hoy se aceptan
 * tres y seis, y cualquier otro largo es un `null` en los tres validadores a la
 * vez. Un solo cambio de cualquiera de los dos lados rompe esta lista en la
 * longitud que ese cambio tocase, y no solo si alguien se acordo de escribir el
 * caso.
 */
function candidatosHex(): unknown[] {
  const lista: unknown[] = [
    // Los que se aceptan hoy.
    "#fff",
    "fff",
    "#FFFFFF",
    "aabbcc",
    "#AbC",
    "#abc",
    // Los que no, y por una razon distinta cada uno.
    "#ff",
    "#f",
    "#fffffff",
    "#gggggg",
    "#GGG",
    "#aabbccdd",
    "#aabbccd",
    "rgb(1,2,3)",
    "0xFFFFFF",
    "",
    "   ",
    "#",
    "  #abc  ",
    "\t#aabbcc\n",
    // Y lo que no es una cadena.
    7,
    null,
    undefined,
    {},
    [],
    true,
  ];

  for (let largo = 0; largo <= 9; largo += 1) {
    const cuerpo = "a1b2c3d4e".slice(0, largo);
    lista.push(cuerpo, `#${cuerpo}`);
  }

  return lista;
}