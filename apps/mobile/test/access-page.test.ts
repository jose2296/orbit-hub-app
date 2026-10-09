import { describe, expect, it } from "vitest";

import { dictionaries } from "@/lib/i18n/dictionaries";
import {
  ORDEN_POR_KIND,
  accionesPara,
  nodeTypeDe,
  type MenuContext,
} from "@/lib/menus/registry";
import { sinComentarios, src } from "./menus-test-helpers";

const HOJA = "src/components/menus/pages/access-page.tsx";


function ctxDe(kind: MenuContext["kind"]): MenuContext {
  return {
    kind,
    entity: { id: "x", title: "Algo", role: "owner", shared: true },
    caps: {},
  };
}

describe("la pagina de acceso", () => {
  it("existe y se monta desde la hoja", () => {
    const hoja = src("src/components/menus/entity-menu-sheet.tsx");
    expect(hoja).toMatch(/pagina === "access"/);
    expect(src(HOJA), "la pagina esta al lado de las otras cinco").toBeTruthy();
  });

  it("la fila se ofrece: access esta en PAGINAS_MONTADAS", () => {
    const paginas = src("src/lib/menus/paginas.ts");
    const montadas = paginas.match(/PAGINAS_MONTADAS: MenuPageId\[\] = \[([^\]]*)\]/)?.[1];
    expect(montadas, "la lista de paginas montadas").toBeTruthy();
    expect(montadas!.includes('"access"'), "access ya se pinta, no se filtra").toBe(true);
  });

  it("esta declarada para los cinco kinds y no se ofrece menos", () => {
    for (const kind of Object.keys(ORDEN_POR_KIND) as MenuContext["kind"][]) {
      expect(ORDEN_POR_KIND[kind], kind).toContain("access");
      const ids = accionesPara(ctxDe(kind)).map((a) => a.id);
      expect(ids, kind).toContain("access");
    }
  });

  it("la insignia sale del contexto, no de un copy nuevo", () => {
    const hoja = src(HOJA);
    expect(hoja).toMatch(/import \{ SharedBadge \} from "@\/components\/shares\/shared-badge"/);
    expect(hoja).toMatch(/shared=\{ctx\.entity\.shared\}/);
    expect(hoja).toMatch(/role=\{ctx\.entity\.role\}/);
    // Las dos frases de la insignia ya existen; la pagina no las reescribe.
    for (const k of ["shared.yours", "shared.fromThem", "shared.canEdit", "shared.canOnlyRead"]) {
      expect(dictionaries.es[k as keyof typeof dictionaries.es], k).toBeTruthy();
      expect(dictionaries.en[k as keyof typeof dictionaries.en], k).toBeTruthy();
    }
  });

  it("el hook separa tres estados, y null no es el vacio", () => {
    const hook = src("src/lib/menus/alcance.ts");
    expect(hook).toContain("cargando");
    expect(hook).toContain("fallo");
    expect(hook).toContain("listo");
    // Donde se usa `useShareReach`, con la cita de por que no.
    expect(hook).toMatch(/person-picker/);
  });

  it("un fallo nunca pinta la lista vacia", () => {
    const hoja = src(HOJA);
    // El `listo` y solo el `listo` puede dibujar `reachPeople`: cualquier otro
    // estado muestra error o espera. Si el salto de estado se escribe al reves,
    // el fallo de red contaria "nadie mas lo tiene".
    expect(hoja).toMatch(/estado === "listo"/);
    const listo = hoja.slice(hoja.indexOf('estado === "listo"'));
    expect(listo).toMatch(/reachPeople|reachOne|reachOther/);
    // Y el fallo tiene reintento.
    expect(hoja).toMatch(/common\.retry/);
  });

  it("pregunta el reach de los cinco, y no con un mapa suyo", () => {
    /*
      Esta prueba decia que `NODE_TYPE` tenia **exactamente** `folder`, `list` y
      `note`, y que los otros dos kinds no estaban. Eso era una afirmacion sobre la
      copia del enum del contrato que la pagina tenia escrita a mano, y la copia era
      lo unico que se comprobaba: si alguien agraba `collection` ahi, el mapa tendria
      cuatro claves y esta prueba fallaria — lo cual esta bien— pero la pagina
      seguiria mandando un `nodeType` que el servidor no entiende, que es lo que de
      verdad importaba.

      Ahora no hay mapa. Hay `nodeTypeDe`, que lee `shareNodeTypeSchema.options`, y la
      pregunta es si los cinco se preguntan. Que es lo que la T10 abre, y lo que
      permite borrar `share.reachNotYet`: una pagina que dice "todavia no se puede
      saber" cuando si se puede es una pagina que enseña a no creerse el "si".
    */
    const hoja = src(HOJA);

    for (const kind of Object.keys(ORDEN_POR_KIND) as MenuContext["kind"][]) {
      expect(nodeTypeDe(kind), `${kind}: el contrato lo admite y la pagina no lo pregunta`).not.toBeNull();
    }

    // Y que la pagina no tenga ni un mapa propio ni la frase que ya no aplica.
    expect(hoja, "la pagina declara su propio mapa de nodeType").not.toMatch(/const NODE_TYPE/);
    expect(hoja, "la pagina no usa la funcion compartida").toContain("nodeTypeDe(ctx.kind)");
    // Sin comentarios: la pagina explica arriba por que se borro la frase, asi que un
    // `not.toMatch` sobre el fuente entero se encontraria con su propia prosa — que es
    // exactamente para lo que existe `sinComentarios`.
    expect(sinComentarios(hoja)).not.toMatch(/reachNotYet/);
    expect(
      dictionaries.es["share.reachNotYet" as keyof typeof dictionaries.es],
      "la clave quedo en el diccionario sin que nadie la use",
    ).toBeUndefined();
    expect(
      dictionaries.en["share.reachNotYet" as keyof typeof dictionaries.en],
      "la clave quedo en el diccionario sin que nadie la use",
    ).toBeUndefined();
  });

  it("y sigue sin montando su propia idea de cuando se puede preguntar", () => {
    /*
      El `nodeType` sale de una funcion compartida y el corte de la pagina es por
      el. Lo que **no** puede haber es un segundo corte escrito aqui: un
      `ctx.kind === "collection" && <algo>` seria la copia de vuelta, y por lo mismo
      que la tabla no habia que mantenerla: no se desincroniza visible, se pierde.
    */
    const hoja = sinComentarios(src(HOJA));

    expect(hoja).not.toMatch(/kind === "[a-z]+"/);
    expect(hoja).toMatch(/\{nodeType \?/);
  });

  it("el copy de los tres estados existe en los dos idiomas", () => {
    const hoja = src(HOJA);
    const claves = [...hoja.matchAll(/t\("([a-zA-Z.]+)"/g)].map((m) => m[1]!);
    expect(claves.length, "la pagina usa claves de i18n").toBeGreaterThan(0);
    for (const k of claves) {
      expect(dictionaries.es[k as keyof typeof dictionaries.es], `${k} falta en es`).toBeTruthy();
      expect(dictionaries.en[k as keyof typeof dictionaries.en], `${k} falta en en`).toBeTruthy();
    }
  });

  it("la pagina no monta su propia hoja", () => {
    const hoja = src(HOJA);
    expect(hoja).not.toMatch(/<Sheet[\s/>]/);
    expect(hoja).not.toContain("useSheetSucio");
  });

  it("no hay firma de handler que la pagina no necesite", () => {
    const hoja = src(HOJA);
    // La pagina es de lectura: no borra, no renombra, no comparte.
    expect(hoja).not.toMatch(/onBorrar|onRename|handlers\./);
  });

  it("los helpers salen de un solo lado", () => {
    // Y el test no re-declara lo que ya esta en el helper.
    const test = src("test/access-page.test.ts");
    expect(test).not.toMatch(/^const MENUS_RAIZ = /m);
    expect(test).not.toMatch(/^const src = /m);
  });
});
