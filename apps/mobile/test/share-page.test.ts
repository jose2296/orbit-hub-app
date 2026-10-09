import { describe, expect, it } from "vitest";

import { shareNodeTypeSchema } from "@orbit-hub/contracts";

import { PAGINAS_MONTADAS, puedeOfrecerse } from "@/lib/menus/paginas";
import { ACCIONES, ORDEN_POR_KIND, accionesPara, nodeTypeDe } from "@/lib/menus/registry";
import type { MenuContext, MenuKind } from "@/lib/menus/registry";

import {
  RAIZ,
  archivosDe,
  hojasMontadas,
  hoja,
  paginasMontadas,
  sinComentarios,
  src,
} from "./menus-test-helpers";

/**
 * `SharePage`, por el registro y por fuente.
 *
 * ------------------------------------------------------------------
 * POR QUE NO MONTA NADA
 * ------------------------------------------------------------------
 *
 * Por lo que ya dice `entity-menu-sheet.test.ts`: no hay `@testing-library` ni
 * `jsdom` en este repo, y `ShareNodeForm` llega a `PersonPicker`, a los hooks de
 * shares y de offline, y a `@expo/vector-icons` —que en Node ni se puede parsear—.
 * O sea que lo unico que se puede afirmar aca es **la costura**: que la pagina
 * monta el formulario que ya existe, que no monta una hoja encima, que el
 * `nodeType` sale del `ctx` y es uno que el contrato admite, y que al enviar bien
 * se cierra el menu.
 *
 * Lo que no se puede comprobar y no se va a prometer: que al escribir un correo y
 * apretar Compartir llegue el grant. Eso se mira en la pantalla.
 *
 * ------------------------------------------------------------------
 * POR QUE EL `nodeType` SE APRUEBA CONTRA EL CONTRATO Y NO CONTRA UNA LISTA
 * ------------------------------------------------------------------
 *
 * Porque el valor sale de una tabla escrita a mano en la pagina, y una tabla escrita
 * a mano se desincroniza: si el enum del contrato cambia —y va a cambiar, la T10
 * amplia `shareNodeTypeSchema`— nadie se entera hasta que un POST manda un tipo que
 * el servidor no conoce. `shareNodeTypeSchema.options` es la **fuente de verdad del
 * otro lado** de esa comparacion, y sale del paquete, no de una constante escrita
 * en el test.
 */

const PAGINA = "src/components/menus/pages/share-page.tsx";

/*
  ------------------------------------------------------------------
  POR QUE ACA NO SE PARSEA UNA TABLA DEL FUENTE
  ------------------------------------------------------------------

  Antes este archivo parseaba `NODE_TYPE_POR_KIND` del fuente de la pagina con una
  expression regular, porque el mapa existia y un guard tiene que mirar el valor
  real. **Ahora no hay mapa**, y esa es la razon de que estas pruebas sean distintas
  y no mas cortas: la pregunta "¿que `nodeType` manda esta pagina?" ya no tiene una
  tabla que leer, tiene una funcion que se llama, y a una funcion se le pregunta
  ejecutandola.

  Un guard que parsea el fuente obliga a que el fuente tenga la forma que el guard
  espera —que es una forma escrita a mano, o sea una cuarta cosa que mantener—. Y
  el dia que el `nodeType` dejo de estar en una tabla, el parseo dejo de encontrar
  nada y el `throw` empezo a saltar en un archivo donde antes pasaban veinte
  aserciones. Un guard que no puede fallar en silencio tambien se rompe ruidoso, y
  eso no es mejor: es peor, porque el ruido no dice que se rompio.

  Lo que queda es lo que si importa: la funcion se deriva del enum del contrato, y
  los tres que la usan —el registro, la pagina y `AccessPage`— devuelven lo mismo.
*/

/**
 * Los `nodeType` que el contrato admite, **del paquete y no de una lista del test**.
 *
 * Leido de `shareNodeTypeSchema.options`, que es el enum que el servidor valida: la
 * T10 lo amplia y este guard se entera solo. Con una constante escrita aca —`["list",
 * "note", "folder"]`— el guard aprobaria cualquier valor que alguien se invente
 * mientras el enum no cambie, que es justo cuando el valor inventado pasa a ser el
 * equivocado.
 */
const TIPOS_DEL_CONTRATO: readonly string[] = shareNodeTypeSchema.options;

/** El `ctx` minimo de un kind, con lo unico que la fila de compartir mira: el rol. */
const ctxDe = (kind: MenuKind): MenuContext => ({
  kind,
  entity: { id: `${kind}-1`, title: "Peliculas", role: "owner", shared: false },
  caps: {},
});

/** Los kinds a los que el registro **ofrece** la fila de compartir, y no solo la declara. */
const kindsQueComparten = (): MenuKind[] =>
  (Object.keys(ORDEN_POR_KIND) as MenuKind[]).filter((kind) =>
    accionesPara(ctxDe(kind)).filter(puedeOfrecerse).some((accion) => accion.id === "share"),
  );

describe("la fila de compartir vuelve a existir, y con la pagina que la monta", () => {
  it("`share` esta entre las paginas montadas", () => {
    /*
      Esta es la regresion entera en una linea. `ACCIONES.share` declara su destino
      como una pagina desde la T1 y `ORDEN_POR_KIND` la lista para lista, nota y
      carpeta; sin esta entrada `puedeOfrecerse` saca la fila y **compartir deja de
      estar en el menu**. No hay ningun error ni ningun test rojo en el camino: una
      opcion que no esta y una opcion que todavia no se escribio se ven igual.
    */
    expect(paginasMontadas()).toContain("share");
    expect(PAGINAS_MONTADAS).toContain("share");
  });

  it("y el filtro deja de sacarla, que es el otro lado de lo mismo", () => {
    // El filtro y la lista son la misma regla desde dos lados, asi que se miran los
    // dos: que la lista la tenga y que `puedeOfrecerse` la deje pasar.
    for (const kind of kindsQueComparten()) {
      expect(
        accionesPara(ctxDe(kind)).filter(puedeOfrecerse).map((accion) => accion.id),
        `la fila de compartir no se ofrece para "${kind}"`,
      ).toContain("share");
    }
  });

  it("los cinco kinds reciben la fila, que es lo que la T10 abre", () => {
    /*
      El otro lado del guard que sigue, y el que hace que este no sea un `for` con
      un `continue`: **los cinco**. Antes eran tres, y la prueba de al lado probaba
      que `collection` y `bookmark` NO recibieran la fila — una prueba que solo
      servia mientras `if (enElContrato) continue` la hacia pasar sin mirar nada—.

      Ahora el bucle no tiene `continue` porque no hay kind que quedarse fuera. Si
      manana el enum pierde un valor, esta falla nombrando el kind, y la siguiente
      falla por el otro lado.
    */
    for (const kind of Object.keys(ORDEN_POR_KIND) as MenuKind[]) {
      expect(
        accionesPara(ctxDe(kind)).filter(puedeOfrecerse).map((accion) => accion.id),
        `"${kind}" deberia recibir la fila de compartir`,
      ).toContain("share");
    }
  });

  it("y un kind que el contrato no admite no la recibe, por si vuelve a pasar", () => {
    /*
      El `continue` se fue y el `for` se queda. Es el mismo bucle y la misma regla en
      los dos sentidos: **la fila se ofrece si y solo si el contrato admite el
      `nodeType` de ese kind**. Una regla que solo se afirma en el sentido que hoy es
      cierto no es una regla, es una fotografia.
    */
    for (const kind of Object.keys(ORDEN_POR_KIND) as MenuKind[]) {
      if (TIPOS_DEL_CONTRATO.includes(kind)) continue;

      expect(
        accionesPara(ctxDe(kind)).filter(puedeOfrecerse).map((accion) => accion.id),
        `"${kind}" no esta en shareNodeTypeSchema y no puede recibir la fila`,
      ).not.toContain("share");
    }
  });
});

describe("nodeTypeDe: una sola decision para tres lectores", () => {
  it("devuelve el kind cuando el contrato lo admite, y null cuando no", () => {
    // No es una tabla: es una comprobacion contra `shareNodeTypeSchema.options`. La
    // identidad se puede comprobar kind por kind sin copiar una lista.
    for (const kind of Object.keys(ORDEN_POR_KIND) as MenuKind[]) {
      const esperado = TIPOS_DEL_CONTRATO.includes(kind) ? kind : null;
      expect(nodeTypeDe(kind), `"${kind}"`).toBe(esperado);
    }

    // Y con un kind que el enum no tiene de ninguna manera. El tipo del parametro no
    // lo deja pasar sin un cast, que es lo que pasa cuando la respuesta es "no".
    expect(nodeTypeDe("galaxia" as MenuKind)).toBeNull();
  });

  it("el registro, la pagina y AccessPage leen la misma funcion", () => {
    /*
      El punto entero de la tarea. Antes habia **tres** copias del enum —
      `COMPARTIBLE` en el registro, `NODE_TYPE_POR_KIND` en la pagina y `NODE_TYPE`
      en `AccessPage`— y tres mecanismos distintos para decir lo mismo: la primera
      era una lista, la segunda un `Record` con `null` y la tercera un `Partial`, que
      no puede ni distinguir "no aplica nunca" de "no se".

      Y ninguna se comparaba con las otras. Se desactualizaron las tres a la vez y no
      se rompio nada, porque un `null` en el `Partial` y una lista de tres producen
      el mismo menu que ayer. Eso es justo lo que un guard escrito a mano no agarra:
      dos tablas pueden coincidir durante meses sin que nadie las mire.

      Ahora hay una funcion. El guard ya no necesita decir "los dos lados coinciden"
      —no hay dos lados— y lo que comprueba es lo unico que queda: que cada lector
      llame a la misma.
    */
    for (const pagina of [PAGINA, "src/components/menus/pages/access-page.tsx"]) {
      expect(sinComentarios(src(pagina)), `${pagina} no lee nodeTypeDe`).toContain(
        "nodeTypeDe(ctx.kind)",
      );
      // Y que no tenga su propio mapa: un `Record<...MenuKind...>` en cualquiera de
      // las dos pantallas seria una copia nueva, y la copia nueva es el problema.
      expect(sinComentarios(src(pagina)), `${pagina} declara su propio mapa`).not.toMatch(
        /Record<[^>]*MenuKind/,
      );
    }

    // El registro tampoco.
    const registro = sinComentarios(src("src/lib/menus/registry.tsx"));
    expect(registro, "el registro todavia tiene la lista COMPARTIBLE").not.toMatch(/COMPARTIBLE/);
    expect(registro, "el registro no define la funcion que las tres pantallas usan").toMatch(
      /nodeTypeDe/,
    );
  });

  it("y no queda ninguna copia del enum escrita a mano en la app", () => {
    /*
      El guard que de verdad se lleva el problema, y el mas burdo de los tres a
      proposito.

      Se recorre **`src/**` entero** buscando el nombre del enum del contrato
      escrito al lado de una lista de kinds. La lista de `shareNodeTypeSchema` es
      larga y distinta en cada archivo —con `|`, con comas, con el enum entero—, asi
      que la busqueda es por el **nombre del tipo** y no por sus valores: un archivo
      que declara `ShareNodeType` y una lista de kinds al lado es una tabla, diga lo
      que diga la lista. Un guard que buscase los valores tendria que mantener su
      propia copia de como se escribe el enum, que es una cuarta cosa que
      desincronizarse.

      Y el rango es todo `src` y no las dos pantallas, porque una copia nueva puede
      aparecer en cualquier archivo —una hoja, un hook— y un guard que solo mira dos
      no la ve. Se prefiere un falso positivo a una tabla limpia que nadie nota. Por
      eso el unico archivo excluido es el que **declara** la funcion.
    */
    const conTabla = archivosDe("src")
      .filter((ruta) => !ruta.endsWith("lib/menus/registry.tsx"))
      .filter((ruta) => {
        // `archivosDe` devuelve rutas relativas a `src` y `src` las resuelve desde la
        // raiz del paquete. Es el mismo prefijo que las de mas de este archivo.
        const codigo = sinComentarios(src(`src/${ruta}`));
        return (
          /ShareNodeType|Share\["nodeType"\]/.test(codigo) &&
          /MenuKind/.test(codigo) &&
          /=\s*\{[^}]*:\s*"[a-z_]+"/.test(codigo)
        );
      });

    expect(conTabla, `copias del enum escritas a mano: ${conTabla.join(", ")}`).toEqual([]);
  });
});

describe("el nodeType sale del ctx y es uno que el contrato admite", () => {
  it("todo kind del registro tiene respuesta, y es la del contrato", () => {
    /*
      Antes esta prueba comparaba las claves de la tabla del fuente contra las de
      `ORDEN_POR_KIND`: que la tabla no se hubiera quedado sin un kind. Sin tabla, lo
      que se comprueba es lo mismo de otra manera —que `nodeTypeDe` responde para
      todos— y la garantia real cambio de sitio: ya no hay una tabla que quedarse
      corta, hay una funcion que lee el enum.
    */
    for (const kind of Object.keys(ORDEN_POR_KIND) as MenuKind[]) {
      expect(nodeTypeDe(kind), `"${kind}"`).toBe(
        TIPOS_DEL_CONTRATO.includes(kind) ? kind : null,
      );
    }
  });

  it("cada valor que sale es un nodeType del contrato, por construccion", () => {
    /*
      Esta prueba antes recorria la tabla y comparaba cada valor. Ahora mira lo mismo
      y solo puede fallar si `nodeTypeDe` devuelve algo que no es el kind —o sea, si
      alguien le agrega un `switch` con una renombra—.

      Y ese es el punto: **la garantia cambio de sitio**. Con la tabla, "el valor es
      del contrato" era un hecho que alguien podia volver a romper escribiendo `"list"`
      donde tocaba `"folder"`, y el test lo cazaba porque comparaba contra una lista
      escrita en el test. Sin tabla, el valor **es** el kind y el enum lo admite: no
      hay codigo donde meter la renombra.
    */
    for (const kind of Object.keys(ORDEN_POR_KIND) as MenuKind[]) {
      const nodeType = nodeTypeDe(kind);
      if (nodeType === null) continue;
      expect(TIPOS_DEL_CONTRATO, nodeType).toContain(nodeType);
      expect(nodeType, `"${kind}" se renombro a si mismo`).toBe(kind);
    }
  });

  it("un kind que el contrato admite con su propio nombre no se renombra solo", () => {
    /*
      El fallo que este guard atrapa, y que sigue siendo real: mandar `"folder"` para
      una nota es un valor **valido** del enum, asi que pasa cualquier comprobacion de
      "el contrato lo admite" y mandaria el grant al tipo equivocado — que es el
      fallo que no se ve, porque nada falla: se comparte otra cosa.

      Con la tabla eso se comparaba contra una copia del enum escrita en el test. Sin
      tabla no hay nada que renombrar. La prueba se queda por documento, y porque el
      typecheck mira el tipo y no el valor.
    */
    for (const kind of Object.keys(ORDEN_POR_KIND) as MenuKind[]) {
      const esperado = TIPOS_DEL_CONTRATO.includes(kind) ? kind : null;
      expect(nodeTypeDe(kind), `la fila "${kind}" deberia mandar "${esperado}"`).toBe(esperado);
    }
  });

  it("y lo que la pagina pinta sale de ahi, no de un switch escrito aparte", () => {
    // Un `ctx.kind === "list" ? "list" : ...` al lado de la funcion seria una segunda
    // fuente para lo mismo, y las dos se pueden desincronizar sin romper nada.
    const codigo = sinComentarios(src(PAGINA));

    expect(codigo).toContain("nodeTypeDe(ctx.kind)");
    expect(codigo).not.toMatch(/kind === "[a-z]+"\s*\?/);
  });
});

describe("la pagina monta el formulario que ya existe, y no otra cosa", () => {
  it("no monta un Sheet: es pagina de la hoja, no panel encima del panel", () => {
    // `ShareNodeSheet` existe para los lugares que no tienen un panel del que ser
    // pagina. Aqui hay uno, y dos `Modal` sobre una pantalla son dos fondos y un
    // toque que llega al de arriba cerrando el de abajo.
    expect(hojasMontadas(src(PAGINA))).toBe(0);
  });

  it("monta `ShareNodeForm`, y no reescribe el formulario", () => {
    // La regla de la migracion entera: una segunda implementacion de compartir se
    // desincroniza de la primera y la que se desincroniza es la que nadie prueba.
    const codigo = sinComentarios(src(PAGINA));

    expect(codigo).toContain("ShareNodeForm");
    expect(codigo).not.toMatch(/useShares|useShareReach|flushOutbox|pendingOperationFor/);
  });

  it("el target sale del ctx y no de props sueltas", () => {
    // El id y el nombre ya estan en `ctx.entity`: pasarlos por props seria una
    // segunda fuente para lo que el registro sabe, y el `title` ademas es el nombre
    // que viaja en el grant, o sea el que lee la otra persona en su bandeja.
    const codigo = sinComentarios(src(PAGINA));

    expect(codigo).toMatch(/nodeType,/);
    expect(codigo).toMatch(/nodeId: ctx\.entity\.id/);
    expect(codigo).toMatch(/title: ctx\.entity\.title/);
  });
});

describe("al compartir bien se cierra el menu, como hacia la hoja vieja", () => {
  it("el onDone de la pagina es el onClose de la hoja", () => {
    /*
      La hoja de lista hacia `onDone={() => onClose()}` (`list-menu-sheet.tsx:611`),
      y el brief de la T11 decia lo contrario —"no cerraba el menu"—. El codigo es el
      que corria: cerraba. Y cerrar es lo correcto ademas por una razon propia: el
      estado del formulario —la direccion escrita, la persona del directorio— vive en
      `ShareNodeForm` y se pierde al desmontar, asi que "quedarse para mandarle a
      otro" no es una opcion que exista sin worktree.
    */
    const codigo = sinComentarios(src(PAGINA));

    expect(codigo).toContain("onDone={onClose}");
    expect(hoja).toMatch(/<SharePage ctx=\{ctx\} onClose=\{onClose\} \/>/);
  });

  it("y la pagina no se cierra sola, sin que la hoja lo decida", () => {
    // Si la pagina cerrara por su cuenta, el `onClose` de la hoja dejaria de ser la
    // unica salida y el `Sheet` —que se queda montado 330 ms en su salida
    // (`sheet.tsx:631`)— tendria dos formas de irse.
    expect(sinComentarios(src(PAGINA))).not.toMatch(/useSheetSucio|setSucio/);
  });
});

describe("el Guardar del pie es de la pagina de compartir y de ninguna otra", () => {
  it("la hoja guarda lo que el formulario publica, no una funcion propia", () => {
    /*
      El boton de enviar vive en `ShareNodeForm` —que tiene el estado del formulario—
      y el Guardar del pie vive arriba, en el `Sheet` que pinta la hoja. Un contexto
      no fluye hacia arriba, asi que el hijo **publica** y el padre pinta: el estado
      va en la hoja, el canal se pasa por `ShareFormContexto` y lo que llega al pie es
      `sharePublicado`.

      Y se mira el canal y no "que haya un onSave": un `onSave` escrito a mano en la
      hoja seria una segunda implementacion de enviar, con su propia idea de a quien
      se le manda.
    */
    const codigo = sinComentarios(hoja);

    expect(codigo).toContain("useState<ShareFormPublicado | null>(null)");
    expect(codigo).toContain("<ShareFormContexto.Provider value={shareCanal}>");
    expect(codigo).toMatch(/onSave=\{enCompartir \? sharePublicado\?\.enviar : undefined\}/);
    expect(codigo).toMatch(
      /saveDisabledReason=\{enCompartir \? sharePublicado\?\.motivo : undefined\}/,
    );
  });

  it("el corte es por pagina, y no por 'hay algo publicado'", () => {
    /*
      La parte sutil, y la que se rompe en silencio. `sharePublicado` ya es `null`
      cuando el formulario no esta montado —su cleanup limpia el canal—, asi que las
      dos formas coinciden **hoy**. Pero el `null` lo produce el hijo, y si la hoja
      dependiera de el estaria heredando de la pagina una decision que es suya: el
      proximo formulario que publique y no limpie deja un "Guardar" en una pagina sin
      formulario, o sea decoracion, sin que nada se rompa.

      Por eso el corte lo hace `pagina === "share"`. Y las tres props van con el
      mismo corte porque son la misma pregunta: que dice el boton, cuando esta apagado
      y por que.
    */
    const codigo = sinComentarios(hoja);

    expect(codigo).toMatch(/const enCompartir = pagina === "share"/);
    // Y no hay ningun `onSave` que no pase por el corte: una segunda escritura seria
    // la que gane, y depende del orden en que se escribieron.
    expect(codigo.match(/onSave=\{/g) ?? []).toHaveLength(1);
  });

  it("el boton dice Compartir, y no Guardar", () => {
    // "Guardar" en un formulario que manda un correo es la palabra equivocada, y el
    // error le llega a la otra persona: lo que se graba es el grant, no un borrador.
    expect(sinComentarios(hoja)).toMatch(/saveLabel=\{enCompartir \? t\("share\.send"\) : undefined\}/);
  });

  it("renombrar no compite por el pie, y es decision suya y no de la hoja", () => {
    /*
      `RenamePage` tiene su boton adentro y **no** usa el `onSave` del `Sheet`, y es
      deliberado (`rename-page.tsx:54-63`): el Guardar del pie se apaga solo cuando su
      promesa resuelve, y un `onSave` que rechaza deja una promesa sin manejar, asi
      que un renombrar que falla por ahi apagaria la pregunta de "salir sin guardar" y
      el nombre escrito se iria sin avisar.

      O sea que las dos mitades no se pisan porque solo compartir publica. Cuando otra
      pagina quiera el pie —`AccessPage` en la T8, `ExportPage` en la T9— el corte por
      `pagina` es lo que las separa.
    */
    expect(sinComentarios(src("src/components/menus/pages/rename-page.tsx"))).not.toMatch(
      /onSave|saveDisabledReason/,
    );
  });

  it("la hoja no inventa otro Guardar para otra pagina", () => {
    // La forma de escribirlo: si el `onSave` se calculara con un `??` encadenado —
    // `sharePublicado?.enviar ?? otroGuardar`— el corte por pagina se evapora y el
    // test de arriba sigue pasando. Se afirma que hay **un solo** `onSave` y que las
    // tres props del pie comparten el corte.
    const codigo = sinComentarios(hoja);

    expect(codigo.match(/saveDisabledReason=\{/g) ?? []).toHaveLength(1);
    expect(codigo.match(/saveLabel=\{/g) ?? []).toHaveLength(1);
    expect(codigo).not.toMatch(/\?\? [a-zA-Z]+\?\.enviar/);
  });
});

describe("el subtitulo de la pagina", () => {
  it("sale de la tabla de la hoja, y la hoja es quien lo pinta", () => {
    /*
      El subtitulo lo pinta el `Sheet`, que es el padre, y una pagina no puede
      dictarselo a quien la contiene —el mismo reparto que el borrador de renombrar,
      del otro lado del arbol—. Por eso `SUBTITULO_POR_PAGINA` tiene la entrada y la
      pagina no dice nada del titulo.
    */
    expect(hoja).toMatch(/share: "share\.subtitle"/);
    expect(sinComentarios(src(PAGINA))).not.toMatch(/subtitle|title=/);
  });

  it("y el nombre lo pone la hoja, que es quien lo tiene", () => {
    // `share.subtitle` tiene un `{name}`, y sin pasarlo la cabecera sale con la
    // llave puesta. Se pasa para todas las paginas porque el `{name}` es el nombre de
    // la entidad y una clave sin el hueco lo ignora (`dictionaries.ts:2485`).
    expect(sinComentarios(hoja)).toMatch(/t\(claveDeSubtitulo, \{ name: titulo \}\)/);
  });
});

describe("lo que esta pagina deliberadamente no hace", () => {
  it("no decide si se puede compartir: eso es del registro", () => {
    /*
      La regla de "solo el dueno comparte" tiene su casa en
      `ACCIONES.share.disponible`, y la hoja la lee para pintar la fila apagada con su
      motivo. Si la pagina vuelve a mirar `role`, la regla tiene dos casas y la que se
      desincroniza es la que no tiene test.

      Y se mira el `sinComentarios` por la razon de siempre: esta pagina explica en
      un comentario que el `null` es inalcanzable y por que, y un `not.toMatch` sobre
      el fuente entero se encontraria con su propia prosa.
    */
    expect(sinComentarios(src(PAGINA))).not.toMatch(/role|disponible|motivo/);
    // Y que la regla exista y funcione, para que el guard de arriba no sea un
    // `not.toMatch` que pasaria igual con el registro vacio.
    expect(ACCIONES.share?.disponible?.(ctxDe("list"))).toBe(true);
  });

  it("no monta `SheetOptions`: no es una lista de filas", () => {
    // Compartir es un formulario. Una pagina que armara `SheetOption[]` seria una
    // hoja mas con su propia opinion sobre el orden.
    expect(sinComentarios(src(PAGINA))).not.toMatch(/SheetOption/);
  });

  it("y no hay un segundo montaje del formulario en el menu", () => {
    // El formulario vive en `share-node-sheet.tsx` y lo monta esta pagina. Un segundo
    // montaje —una hoja hermana para "solo compartir"— diverge del primero en el pie, y
    // la que no se prueba es la que diverge.
    expect(hoja).toContain("<SharePage");
    expect(hoja, "la hoja no monta el formulario, lo monta la pagina").not.toContain(
      "<ShareNodeForm",
    );
    expect(src(PAGINA).match(/<ShareNodeForm/g) ?? []).toHaveLength(1);
  });
});

describe("la pagina existe donde la hoja la busca", () => {
  it("el directorio y la lista siguen siendo lo mismo", () => {
    // El guard de `entity-menu-sheet.test.ts:299` ya afirma esto para todo el
    // directorio; se repite el path aca para que un fallo diga que la pagina de
    // compartir es la que falta y no "una pagina".
    expect(src(PAGINA)).toContain("export function SharePage");
    expect(paginasMontadas()).toContain("share");
    expect(RAIZ.endsWith("apps/mobile")).toBe(true);
  });
});
