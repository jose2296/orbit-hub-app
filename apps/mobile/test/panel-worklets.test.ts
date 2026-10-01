import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import ts from "typescript";

/**
 * The order of the worklets.
 *
 * This exists because of a failure that reads like a bundler bug and is not one.
 * The Reanimated plugin rewrites a worklet into an immediately-invoked factory
 * whose *arguments* are everything the worklet closes over — including the other
 * worklets it calls — and it emits them in source order at the top of the module.
 * So a worklet that calls one declared below it is evaluated before that one
 * exists, and the web build dies during static rendering with
 *
 *   ReferenceError: Cannot access 'X' before initialization
 *
 * in a minified bundle, with no module named anywhere in the stack. Native builds
 * are fine, `tsc` is fine, and the unit tests are fine, because the problem is in
 * the *emitted order* and not in the source.
 *
 * Checking the order here is the only place it can be checked cheaply: a test that
 * imports the module and calls the functions proves nothing, because by then Babel
 * has already reordered everything.
 */
const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "src");

/**
 * Every file that has worklets in it.
 *
 * Found by walking the source rather than written down here, because a file with
 * a worklet in it that nobody remembered to add to a list is a file whose
 * worklets are never checked — and the failure that causes reads like a bundler
 * bug with no module named in it. A check that only looks at the file somebody
 * remembered is worse than no check, because it passes with a straight face.
 */
function filesWithWorklets(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.tsx?$/.test(entry.name)) {
        const text = readFileSync(full, "utf8");
        if (text.includes("'worklet'") || text.includes('"worklet"')) {
          found.push(full);
        }
      }
    }
  };
  walk(src);
  return found.sort();
}

/**
 * The worklet functions of a file, in the order they are declared.
 *
 * Parsed with TypeScript's own parser rather than with a regular expression. A
 * regular expression cannot tell a parameter of type `{ w: number }` from the
 * opening brace of the body, so it reads the signature as the body and quietly
 * misses every worklet that takes an object — which is a test that passes
 * because it found nothing, which is worse than no test.
 *
 * Both shapes: a named `function` and an arrow assigned to a const. The second
 * one was missing when this was first written, and the first version of the test
 * cheerfully reported "zero worklets in panel-card.tsx" about a file that has one
 * in it. The file was new to the check; the check was not new enough for the file.
 */
function workletsInOrder(
  path: string,
  code: string,
): { name: string; body: string }[] {
  const tree = ts.createSourceFile(
    path,
    code,
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.TS,
  );

  /**
   * The directive is the first statement of the body, which is where it means
   * anything. An expression-bodied arrow has no statements to look at, so it is
   * not a worklet — Reanimated needs the directive as a statement, and a
   * one-line `() => 'worklet'` arrow is not one.
   */
  const isWorklet = (body: ts.Node | undefined) =>
    body !== undefined &&
    ts.isBlock(body) &&
    (body.statements[0]?.getText().includes("'worklet'") ?? false);

  const found: { name: string; body: string }[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name && isWorklet(node.body)) {
      found.push({ name: node.name.text, body: node.body!.getText() });
    }
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const { initializer } = node;
      const callable =
        ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)
          ? initializer
          : null;
      if (callable && isWorklet(callable.body) && ts.isIdentifier(node.name)) {
        found.push({ name: node.name.text, body: callable.body!.getText() });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return found;
}

const byFile = filesWithWorklets().map((path) => ({
  path,
  name: path.slice(src.length + 1),
  worklets: workletsInOrder(path, readFileSync(path, "utf8")),
}));

describe("worklets are declared after the worklets they call", () => {
  it("looks at every file that has worklets in it", () => {
    // If this ever finds nothing the tests below pass for the wrong reason, and
    // that is the failure this file exists to prevent.
    expect(byFile.length).toBeGreaterThan(0);
    for (const file of byFile) {
      expect(
        file.worklets.length,
        `${file.name} tiene worklets pero el analizador no encuentra ninguno`,
      ).toBeGreaterThan(0);
    }
  });

  it("knows the worklets of the panel module by name", () => {
    // The exact list, so that a worklet that is renamed, added or dropped is a
    // test that fails and not a test that quietly checks a different set. The
    // order matters as much as the names: it is what the test below reads.
    const panel = byFile.find((file) =>
      file.name.endsWith("lib/dashboard/panel.ts"),
    );
    expect(panel?.worklets.map((worklet) => worklet.name)).toEqual([
      "snapSize",
      "clampCell",
      "rectIsFree",
      "takeRect",
      "emptyGrid",
      "firstFreeSpot",
      "nearestFreeSpot",
      "placeCards",
      "sizeFromDrag",
      "oneStepTowards",
      "heldSpot",
      "dropSpot",
    ]);
  });

  it("never calls a worklet declared later in the same file", () => {
    for (const file of byFile) {
      for (const [index, worklet] of file.worklets.entries()) {
        for (const other of file.worklets.slice(index + 1)) {
          expect(
            new RegExp(`\\b${other.name}\\s*\\(`).test(worklet.body),
            `${file.name}: ${worklet.name} calls ${other.name}, which is ` +
              "declared below it. Babel emits the worklets in source order, so " +
              "the web build fails with \"Cannot access 'X' before " +
              "initialization\" during static rendering, with no module named in " +
              `the stack. Move ${other.name} above ${worklet.name}.`,
          ).toBe(false);
        }
      }
    }
  });
});
