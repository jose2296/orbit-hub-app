import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { fdFiles } from "./swipe-guard-files";

/**
 * A row inside a `SwipeRow` that wires `guard.press` must also wire `guard.pressIn`.
 *
 * Without the start position the guard cannot tell a tap from the end of a drag, and a
 * bookmark row stopped opening when it forgot it. Checked on source because the bug
 * lives in what a row forgets to pass, which a render with a stub cannot show.
 */
describe("every row that uses the swipe guard wires both halves", () => {
  const archivos = fdFiles();

  it("finds the rows that use the guard", () => {
    expect(archivos.length).toBeGreaterThanOrEqual(3);
  });

  for (const archivo of archivos) {
    it(`${archivo} passes guard.pressIn next to guard.press`, () => {
      const texto = readFileSync(resolve(__dirname, "..", archivo), "utf8");
      expect(texto).toContain("guard.press(");
      expect(texto).toMatch(/guard\??\.pressIn/);
    });
  }
});
