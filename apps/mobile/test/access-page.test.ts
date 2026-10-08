import { describe, expect, it } from "vitest";

import { dictionaries } from "@/lib/i18n/dictionaries";
import {
  ORDEN_POR_KIND,
  accionesPara,
  type MenuContext,
} from "@/lib/menus/registry";
import { src } from "./menus-test-helpers";

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

  it("no pregunta el reach de lo que el contrato no alcanza", () => {
    const hoja = src(HOJA);
    // `NODE_TYPE` tiene exactamente los tres que el enum de Share admite. Los otros
    // dos kinds no estan, y esa es la razon por la que la pagina no pregunta: no es
    // una decision de copy, es que `GET /shares/:nodeType/:id/reach` no los entiende.
    // Y afirmar el mapa entero es mejor que afirmar la ausencia de dos claves: si
    // alguien agrega `collection` aca, el enum del contrato sigue sin tenerlo.
    const mapa = hoja.match(/const NODE_TYPE[^=]*= \{([\s\S]*?)\};/)?.[1] ?? "";
    const claves = [...mapa.matchAll(/\s*(\w+):/g)].map((m) => m[1]!);
    expect(claves.sort()).toEqual(["folder", "list", "note"]);
    expect(hoja).not.toMatch(/nodeType: "(collection|bookmark)"/);
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
