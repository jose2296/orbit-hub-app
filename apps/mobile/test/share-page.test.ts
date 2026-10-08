import { describe, expect, it } from "vitest";

import { shareNodeTypeSchema } from "@orbit-hub/contracts";

import { PAGINAS_MONTADAS, puedeOfrecerse } from "@/lib/menus/paginas";
import { ACCIONES, ORDEN_POR_KIND, accionesPara } from "@/lib/menus/registry";
import type { MenuContext, MenuKind } from "@/lib/menus/registry";

import {
  RAIZ,
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

/**
 * El mapa de la pagina, **leido del fuente**.
 *
 * Se parsea en vez de escribirse porque el valor que hay que aprobar es el que esta
 * en el archivo: una copia en el test aprobaria una tabla que nadie esta mirando.
 * Y sale por el nombre de la constante, no por una linea fija, para que
 * renombrarla falle con un mensaje que lo diga —un guard que se desincroniza en
 * silencio es exactamente lo que este archivo no quiere ser—.
 */
function mapaDelFuente(fuente: string): Record<string, string | null> {
  const bloque = fuente.match(/NODE_TYPE_POR_KIND[^=]*=\s*\{([\s\S]*?)\n\}/)?.[1];

  if (bloque === undefined) {
    throw new Error("la pagina no declara NODE_TYPE_POR_KIND, o no con esa forma");
  }

  const entradas: Record<string, string | null> = {};

  for (const linea of bloque.split("\n")) {
    const entrada = linea.match(/^\s*(?<kind>[a-zA-Z]+):\s*(?<valor>null|"[a-z_]+")\s*,?\s*$/);

    // Los dos grupos existen si la linea entero —el `$` del patron los exige—, pero
    // con `noUncheckedIndexedAccess` el tipo no lo sabe: se comprueban por nombre y
    // no por posicion, asi que agregar un grupo al patron no rompe el asignar.
    if (entrada?.groups?.kind === undefined || entrada.groups.valor === undefined) continue;

    const { kind, valor } = entrada.groups;

    entradas[kind] = valor === "null" ? null : valor.slice(1, -1);
  }

  return entradas;
}

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

  it("los kinds que el contrato no admite no reciben la fila, ni con la pagina puesta", () => {
    /*
      `collection` y `bookmark` no estan en `shareNodeTypeSchema`, y ofrecerles la
      fila seria pintar algo que al tocarlo manda un `nodeType` que el contrato no
      admite. No es que la pagina no sepa el valor —`SharePage` los tiene en `null`
      y por eso pinta nada—: es que el registro no llega a ofrecer la fila, asi que
      el `null` no es codigo alcanzable sino la red de seguridad de un hueco que se
      cierra en la T10.
    */
    for (const kind of Object.keys(ORDEN_POR_KIND) as MenuKind[]) {
      const enElContrato = TIPOS_DEL_CONTRATO.includes(kind);
      const acciones = accionesPara(ctxDe(kind)).filter(puedeOfrecerse);

      if (enElContrato) continue;

      expect(
        acciones.map((accion) => accion.id),
        `"${kind}" no esta en shareNodeTypeSchema y no puede recibir la fila`,
      ).not.toContain("share");
    }
  });
});

describe("el nodeType sale del ctx y es uno que el contrato admite", () => {
  it("la tabla cubre todos los kinds, y no hay kind nuevo sin decidir", () => {
    /*
      El `Record<MenuKind, ...>` del tipo ya obliga a esto en tiempo de compilacion;
      el guard lo afirma en el test porque el tipocheck no corre con cada test y
      porque **la lista de kinds sale del registro**, o sea que un kind nuevo que no
      se escriba aca rompe el test y no un import que nadie mira.
    */
    const mapa = mapaDelFuente(src(PAGINA));

    expect(Object.keys(mapa).sort()).toEqual(Object.keys(ORDEN_POR_KIND).sort());
  });

  it("cada valor que no es null es un nodeType del contrato", () => {
    const mapa = mapaDelFuente(src(PAGINA));

    for (const [kind, nodeType] of Object.entries(mapa)) {
      if (nodeType === null) continue;

      expect(
        TIPOS_DEL_CONTRATO,
        `"${kind}" manda el nodeType "${nodeType}", que shareNodeTypeSchema no admite`,
      ).toContain(nodeType);
    }
  });

  it("un kind que el contrato admite con su propio nombre no se renombra solo", () => {
    /*
      `MenuKind` y `shareNodeTypeSchema` comparten `list`, `note` y `folder` **con el
      mismo nombre**, asi que para esos tres la respuesta no se inventa: es el kind.
      Un cuarto valor —digamos mandar `"folder"` para una nota— pasaria el guard de
      arriba —es un valor valido del enum— y mandaria el grant al tipo equivocado, que
      es el fallo que no se ve. Por eso la regla se afirma en los dos sentidos: lo que
      se manda es el kind, y lo que no esta en el enum no manda nada.
    */
    const mapa = mapaDelFuente(src(PAGINA));

    for (const [kind, nodeType] of Object.entries(mapa)) {
      const esperado = TIPOS_DEL_CONTRATO.includes(kind) ? kind : null;

      expect(nodeType, `la fila "${kind}" manda "${nodeType}" y deberia mandar "${esperado}"`).toBe(
        esperado,
      );
    }
  });

  it("y lo que la pagina pinta sale de ahi, no de un switch escrito aparte", () => {
    // Un `ctx.kind === "list" ? "list" : ...` al lado de la tabla seria una segunda
    // fuente para lo mismo, y las dos se pueden desincronizar sin romper nada.
    const codigo = sinComentarios(src(PAGINA));

    expect(codigo).toContain("NODE_TYPE_POR_KIND[ctx.kind]");
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
