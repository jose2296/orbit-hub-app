import { describe, expect, it } from "vitest";

import {
  deduplicaCrudos,
  deduplicaProveedores,
} from "../src/modules/catalogs/provider-dedupe.js";

/**
 * The duplicates in "where to watch".
 *
 * These are the exact strings TMDB returns for a Spanish film today. Every one of
 * them was a pair of cards with the same logo and two names, which reads as two
 * services to choose between.
 */
describe("donde verlo: el mismo servicio dos veces", () => {
  it("mismo logo, mismo nombre, dos veces: una", () => {
    const salida = deduplicaCrudos(
      [
        { provider_name: "Netflix", logo_path: "/netflix.jpg" },
        { provider_name: "Netflix", logo_path: "/netflix.jpg" },
      ],
      "flatrate",
    );
    expect(salida).toHaveLength(1);
  });

  it("'Movistar Plus+' y 'Movistar Plus+ Utd' son uno, y se queda el nombre corto", () => {
    const salida = deduplicaCrudos(
      [
        { provider_name: "Movistar Plus+ Utd", logo_path: "/movistar.jpg" },
        { provider_name: "Movistar Plus+", logo_path: "/movistar.jpg" },
      ],
      "flatrate",
    );

    // Sin el segundo de estos, sale como dos tarjetas y hay que elegir entre dos
    // nombres del mismo servicio.
    expect(salida).toHaveLength(1);
    // Y el que sobrevive es el que se dice de viva voz, no el interno.
    expect(salida[0]?.name).toBe("Movistar Plus+");
  });

  it("'Amazon Prime' y 'Amazon Prime Video' son uno", () => {
    const salida = deduplicaCrudos(
      [
        { provider_name: "Amazon Prime Video", logo_path: "/prime.jpg" },
        { provider_name: "Amazon Prime", logo_path: "/prime.jpg" },
      ],
      "flatrate",
    );
    expect(salida).toHaveLength(1);
    expect(salida[0]?.name).toBe("Amazon Prime");
  });

  it("mismo servicio en suscripcion y en alquiler: dos tarjetas, a proposito", () => {
    // Apple's own shop. Es una decision distinta y con otro precio, y meterlas en
    // la misma tarjeta esconderia justo el dato que hace decidir.
    const salida = deduplicaProveedores([
      { name: "Apple TV+", logoPath: "/apple.jpg", offering: "flatrate" },
      { name: "Apple TV+", logoPath: "/apple.jpg", offering: "rent" },
    ]);
    expect(salida.map((p) => p.offering).sort()).toEqual(["flatrate", "rent"]);
  });

  it("un paquete con su propio logo se queda aparte", () => {
    // "HBO Max Amazon" es dos suscripciones en una. Fusionarlo con cualquiera de
    // las dos parte dira a alguien que pague a la que no es.
    const salida = deduplicaCrudos(
      [
        { provider_name: "HBO Max", logo_path: "/hbo.jpg" },
        { provider_name: "HBO Max Amazon", logo_path: "/hbo-amazon.jpg" },
        { provider_name: "Amazon Prime", logo_path: "/prime.jpg" },
      ],
      "flatrate",
    );
    expect(salida).toHaveLength(3);
  });

  it("sin logo, compara por nombre y sin tildes ni mayusculas", () => {
    const salida = deduplicaCrudos(
      [
        { provider_name: "Canal+", logo_path: null },
        { provider_name: "CANAL+", logo_path: null },
      ],
      "rent",
    );
    // Ni tildes ni mayusculas cuentan como diferencia: el mismo servicio escrito
    // de dos formas es el mismo servicio.
    expect(salida).toHaveLength(1);
  });

  it("sin logo, lo que solo cambia en como se escribe sigue siendo dos", () => {
    // "Canal+" y "Canal Plus" no se parecen en nada mas que en una letra, y
    // fundirlos seria inventarse que elTMDB los dio por la misma empresa. Cuando
    // no hay logo no hay con que comparar y la respuesta honesta son dos.
    const salida = deduplicaCrudos(
      [
        { provider_name: "Canal+", logo_path: null },
        { provider_name: "Canal Plus", logo_path: null },
      ],
      "rent",
    );
    expect(salida).toHaveLength(2);
  });

  it("sin logo, dos nombres que no se parecen siguen siendo dos", () => {
    const salida = deduplicaCrudos(
      [
        { provider_name: "Canal+", logo_path: null },
        { provider_name: "Atresplayer", logo_path: null },
      ],
      "rent",
    );
    expect(salida).toHaveLength(2);
  });

  it("el logo manda sobre el nombre: mismo logo con nombres raros es uno", () => {
    // Alguien de la empresa lo metio con el nombre comercial de otro pais. El
    // dibujo es el mismo y el dibujo es el que la persona reconoce.
    const salida = deduplicaCrudos(
      [
        { provider_name: "Filmin", logo_path: "/filmin.jpg" },
        { provider_name: "Filmin HD", logo_path: "/FILMIN.JPG" },
      ],
      "flatrate",
    );
    expect(salida).toHaveLength(1);
  });

  it("no pierde el orden en que venían las decisiones", () => {
    // El orden lo pone el llamante (alquilar antes que comprar antes que
    // suspender) porque es el orden en el que se parecen menos entre si.
    const salida = deduplicaProveedores([
      { name: "A", logoPath: "/a.jpg", offering: "rent" },
      { name: "B", logoPath: "/b.jpg", offering: "buy" },
      { name: "C", logoPath: "/c.jpg", offering: "flatrate" },
    ]);
    expect(salida.map((p) => p.offering)).toEqual(["rent", "buy", "flatrate"]);
  });

  it("uno con logo y otro sin el, con el mismo nombre, son dos", () => {
    // El logo manda cuando hay dos logos, y el nombre cuando no hay ninguno. El
    // caso intermedio — el mismo nombre, uno con dibujo y otro sin el — no tiene
    // nada que comparar, porque las dos claves son distintas por construccion:
    // comparar "por el logo si hay, si no por el nombre" no es un fallback, son
    // dos universos separados. Fundirlos aqui seria decir que TMDB garantiza que
    // el mismo nombre es la misma empresa, y no lo garantiza.
    const salida = deduplicaCrudos(
      [
        { provider_name: "Atresplayer", logo_path: null },
        { provider_name: "Atresplayer", logo_path: "/atres.jpg" },
      ],
      "flatrate",
    );
    expect(salida).toHaveLength(2);
  });
});
