import { describe, expect, it } from "vitest";

import { SYNC_WRITABLE_FIELDS } from "../src/db/constants.js";

describe("mover un bookmark de espacio", () => {
  it("workspaceId entra en los campos escribibles de un bookmark", () => {
    // El pedido era literal: "deberia poder moverlo luego a otro sitio si esta
    // sin clasificar". Y la razon de que no se pudiera no era que no se debiera:
    // `SYNC_WRITABLE_FIELDS.bookmark` no tenia el campo, y el test de abajo
    // afirmaba esa ausencia sin dejar escrita ninguna razon.
    expect(SYNC_WRITABLE_FIELDS.bookmark).toContain("workspaceId");
  });

  it("seguir sin poder escribir lo que es del servidor", () => {
    // La lista blanca se ensancho, no se abrio. El documento, el texto y el
    // estado de la extraccion son del servidor y siguen sin entrar.
    expect(SYNC_WRITABLE_FIELDS.bookmark).not.toContain("document");
    expect(SYNC_WRITABLE_FIELDS.bookmark).not.toContain("plainText");
    expect(SYNC_WRITABLE_FIELDS.bookmark).not.toContain("extractionState");
    expect(SYNC_WRITABLE_FIELDS.bookmark).not.toContain("imageUrl");
  });
});
