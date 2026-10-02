import { describe, expect, it } from "vitest";

import { planTagColorChange } from "@/lib/lists/tag-colors";

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
