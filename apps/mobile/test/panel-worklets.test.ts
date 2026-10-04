import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
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
function sourceFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.tsx?$/.test(entry.name)) {
        found.push(full);
      }
    }
  };
  walk(src);
  return found.sort();
}

function filesWithWorklets(): string[] {
  return sourceFiles().filter((full) => {
    const text = readFileSync(full, "utf8");
    return text.includes("'worklet'") || text.includes('"worklet"');
  });
}

/**
 * Every file of the source, **and the check below needs all of them and not only
 * the ones with a directive in them.**
 *
 * A worklet does not have to say so: the plugin turns `useDerivedValue`'s callback
 * into one on its own, and that callback has no directive to find. So a check that
 * starts from the directive starts from the wrong set, and the file where the
 * rubber band is computed — which has one directive, in another function — looks
 * like a file with one worklet in it when it has two.
 */
const allSourceFiles = sourceFiles();

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
): { name: string; body: string; node: ts.Node }[] {
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
    (body.statements[0]?.getText().includes("'worklet'") ||
      body.statements[0]?.getText().includes('"worklet"') ||
      false);

  const found: { name: string; body: string; node: ts.Node }[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name && isWorklet(node.body)) {
      found.push({
        name: node.name.text,
        body: node.body!.getText(),
        node: node.body!,
      });
    }
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const { initializer } = node;
      const callable =
        ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)
          ? initializer
          : null;
      if (callable && isWorklet(callable.body) && ts.isIdentifier(node.name)) {
        found.push({
          name: node.name.text,
          body: callable.body!.getText(),
          node: callable.body!,
        });
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

/**
 * Every callback the Reanimated plugin turns into a worklet **without being told
 * to**, and where in the call it sits.
 *
 * **This list is the plugin's, copied out of
 * `node_modules/react-native-worklets/plugin/index.js`**, and copying it is the
 * point: the failure it guards against is invisible from here, so the list cannot
 * be a list of the cases somebody happened to remember. `reanimatedFunctionHooks`
 * and `reanimatedFunctionArgsToWorkletize` are the plugin's own two sets, and the
 * gesture entries are `gestureHandlerObjectHooks` and `gestureHandlerBuilderMethods`
 * with argument 0.
 *
 * **The first version of this check left all of these out**, and it passed with the
 * bug it was written for still in the file: it only looked at functions carrying
 * the directive, and `movido` — the rubber band, the thing that was broken — is a
 * `useDerivedValue` callback with no directive anywhere near it. So the check found
 * no worklets in `board-tabs.tsx` and none in the screen beyond `settle`, and
 * reported nothing, and was right about nothing.
 */
const AUTO_WORKLETIZED: Record<string, number[]> = {
  useFrameCallback: [0],
  useAnimatedStyle: [0],
  useAnimatedProps: [0],
  createAnimatedPropAdapter: [0],
  useDerivedValue: [0],
  useAnimatedScrollHandler: [0],
  useAnimatedReaction: [0, 1],
  withTiming: [2],
  withSpring: [2],
  withDecay: [1],
  withRepeat: [3],
  runOnUI: [0],
  executeOnUIRuntimeSync: [0],
  scheduleOnUI: [0],
  runOnUISync: [0],
  runOnUIAsync: [0],
  runOnRuntime: [1],
  runOnRuntimeSync: [1],
  runOnRuntimeAsync: [1],
  scheduleOnRuntime: [1],
  runOnRuntimeSyncWithId: [1],
  scheduleOnRuntimeWithId: [1],
  useTapGesture: [0],
  usePanGesture: [0],
  usePinchGesture: [0],
  useRotationGesture: [0],
  useFlingGesture: [0],
  useLongPressGesture: [0],
  useNativeGesture: [0],
  useManualGesture: [0],
  useHoverGesture: [0],
};

/** Every `on*` of a gesture builder, all of them at argument 0. */
const GESTURE_CALLBACKS = [
  "onBegin",
  "onStart",
  "onEnd",
  "onFinalize",
  "onUpdate",
  "onChange",
  "onTouchesDown",
  "onTouchesMove",
  "onTouchesUp",
  "onTouchesCancelled",
];

/**
 * The callbacks of a file that the plugin workletises on its own, **with the text
 * of the call they were found in so the failure message can name the place.**
 */
function autoWorklets(path: string): { where: string; node: ts.Node }[] {
  const code = readFileSync(path, "utf8");
  const tree = ts.createSourceFile(
    path,
    code,
    ts.ScriptTarget.ESNext,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const found: { where: string; node: ts.Node }[] = [];
  const take = (
    args: ts.NodeArray<ts.Expression> | undefined,
    index: number,
    label: string,
  ) => {
    const argument = args?.[index];
    if (!argument) return;
    const callable =
      ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)
        ? argument
        : null;
    if (!callable?.body) return;
    found.push({
      where: `${label} at argument ${index} (line ${
        tree.getLineAndCharacterOfPosition(argument.getStart()).line + 1
      })`,
      node: callable.body,
    });
  };
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const { expression } = node;
      const positions = AUTO_WORKLETIZED[expression.text];
      if (positions) {
        for (const index of positions) take(node.arguments, index, expression.text);
      }
    }
    // `Gesture.Pan().onStart(cb)`: the callee is a member expression, and the
    // builder methods are only workletised on a gesture object — which is why
    // this is checked by name and not by "any member call".
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.name) &&
      GESTURE_CALLBACKS.includes(node.expression.name.text)
    ) {
      take(node.arguments, 0, `.${node.expression.name.text}()`);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return found;
}

/**
 * Whether a name called from a worklet is one of ours, and where it lives.
 *
 * **Only the imports that resolve inside `src`**, and that filter is the whole
 * design. A call to `withTiming` or `runOnJS` is a call into a library that knows
 * what a worklet is; a call to a function of this repository's own source is a call
 * into a file that has to answer for itself. `Math` and `Easing` and everything
 * else the language and the libraries provide are not imports at all, so they are
 * never even looked at.
 */
function ownImports(path: string): Map<string, string> {
  const code = readFileSync(path, "utf8");
  const tree = ts.createSourceFile(
    path,
    code,
    ts.ScriptTarget.ESNext,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const found = new Map<string, string>();
  for (const statement of tree.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      continue;
    }
    const specifier = statement.moduleSpecifier.text;
    const resolved = resolveInsideSrc(path, specifier);
    if (!resolved) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      found.set(element.name.text, resolved);
    }
  }
  return found;
}

/**
 * The file an import specifier points at, **or null when it points outside `src`.**
 *
 * Both spellings the repository uses: the `@/` alias from `tsconfig.json`, which is
 * `./src/*`, and a relative path. The extension is tried rather than written down
 * because every import in the source omits it, and a check that only understood the
 * spelling that happens to appear in the file being fixed would be a check that
 * passes because it found nothing.
 */
function resolveInsideSrc(from: string, specifier: string): string | null {
  const base = specifier.startsWith("@/")
    ? join(src, specifier.slice(2))
    : join(dirname(from), specifier);
  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ]) {
    if (!candidate.startsWith(src)) continue;
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Whether the named export of a file carries the directive. */
function exportedAsWorklet(path: string, name: string): boolean {
  const code = readFileSync(path, "utf8");
  const tree = ts.createSourceFile(
    path,
    code,
    ts.ScriptTarget.ESNext,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const isDirective = (body: ts.Node | undefined) =>
    body !== undefined &&
    ts.isBlock(body) &&
    (body.statements[0]?.getText().includes("'worklet'") ||
      body.statements[0]?.getText().includes('"worklet"') ||
      false);

  /**
   * Whether a declaration carries `export`, read off its modifiers.
   *
   * **`ts.getModifiers` and not `node.modifiers`**, because the second one does not
   * exist on the type this function takes and `tsc` says so — which is the only
   * thing in this file that `tsc` has ever caught, and it caught it in the checker
   * rather than in the code the checker guards.
   */
  const isExported = (node: ts.Node) =>
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node)?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    ) ??
      false);

  let found = false;
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
      if (isExported(node)) found = isDirective(node.body);
      return;
    }
    if (
      ts.isVariableDeclaration(node) &&
      node.name &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer
    ) {
      const { initializer } = node;
      const callable =
        ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)
          ? initializer
          : null;
      if (callable && isExported(node)) found = isDirective(callable.body);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return found;
}

/**
 * The functions declared in a file itself, **and whether each says it is a
 * worklet.**
 *
 * The same failure as the imported one and it lives one door further down: a helper
 * declared in the same file as the gesture, without the directive, called from a
 * `useDerivedValue`. So it is checked too, and it is checked by the same rule.
 * Written as a lookup rather than as a name filter because `Math` and `Easing` and
 * every other thing the language provides are not declarations of ours and must not
 * be treated as missing ones.
 */
function localFunctions(path: string): Map<string, boolean> {
  const code = readFileSync(path, "utf8");
  const tree = ts.createSourceFile(
    path,
    code,
    ts.ScriptTarget.ESNext,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const isDirective = (body: ts.Node | undefined) =>
    body !== undefined &&
    ts.isBlock(body) &&
    (body.statements[0]?.getText().includes("'worklet'") ||
      body.statements[0]?.getText().includes('"worklet"') ||
      false);

  const found = new Map<string, boolean>();
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name) {
      found.set(node.name.text, isDirective(node.body));
    }
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      ts.isIdentifier(node.name)
    ) {
      const { initializer } = node;
      const callable =
        ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)
          ? initializer
          : null;
      if (callable) found.set(node.name.text, isDirective(callable.body));
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return found;
}

/** The names a worklet body calls, by identifier. Member calls are not included. */
function callsIn(node: ts.Node): string[] {
  const names: string[] = [];
  const visit = (child: ts.Node) => {
    if (ts.isCallExpression(child) && ts.isIdentifier(child.expression)) {
      names.push(child.expression.text);
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return [...new Set(names)];
}

/**
 * The directive on the far side of every call a worklet makes into this
 * repository's own source.
 *
 * **This exists because one function did not have it and nothing here could see
 * that.** `trackRoomAt` — the floor of the rubber band — was called from the
 * `useDerivedValue` that applies the band, sixty times a second for every frame of
 * every drag, without the directive. On the web the interface thread and the
 * JavaScript thread are the same thread, so the call answers and nothing looks
 * wrong; on native there is no JavaScript thread on the other end of it and the
 * function does not answer, every frame, with the finger down.
 *
 * **And there is no way to measure that from here.** No test in this repository can
 * run a worklet on an interface thread and see it fail, because the failure is the
 * absence of a thread. So the only thing that can be checked is the source: that
 * every function a worklet calls into `src` says it is one. That is a reading and
 * not a measurement, and it is the honest amount of checking this failure allows.
 *
 * What it buys is that the next function like this is a failing test on the web
 * rather than a crash on a phone nobody here has.
 */
describe("a worklet only calls functions that are worklets themselves", () => {
  /**
   * The calls it examined, **in two lists and not one.**
   *
   * Two because the guard below has to hold both halves apart, and one list is what
   * let the auto-detected half go loose: with `AUTO_WORKLETIZED` and
   * `GESTURE_CALLBACKS` emptied, the worklets that carry the directive still produce
   * their calls, so the list is not empty and a guard of "the list is not empty"
   * stays green **with the half that finds the original bug switched off.** Both
   * halves were in that state and neither noticed.
   */
  const conDirectiva: string[] = [];
  const automaticos: string[] = [];
  const offenders: string[] = [];

  /** The worklets that carry the directive: named functions and arrow consts. */
  const conLaDirectiva = (path: string) =>
    workletsInOrder(path, readFileSync(path, "utf8")).map((w) => ({
      where: w.name,
      node: w.node,
    }));

  for (const path of allSourceFiles) {
    const imports = ownImports(path);
    const locals = localFunctions(path);
    const name = path.slice(src.length + 1);
    if (imports.size === 0 && locals.size === 0) continue;
    /**
     * Both kinds of worklet, **and the kind is kept so the guard can count them
     * apart.** The ones the plugin workletises on its own are the ones that fixed the
     * original bug, and they have no directive to be found by.
     */
    const mitades: {
      donde: string[];
      worklets: { where: string; node: ts.Node }[];
    }[] = [
      { donde: conDirectiva, worklets: conLaDirectiva(path) },
      { donde: automaticos, worklets: autoWorklets(path) },
    ];
    for (const { donde, worklets } of mitades) {
      for (const worklet of worklets) {
        for (const callee of callsIn(worklet.node)) {
          // An imported name wins: if it is ours from another file, that file has to
          // answer for it, and looking at a same-named local declaration would be
          // checking the wrong one. **`imports.get` returning nothing is also the whole
          // of "not one of ours from another file",** so there is nothing for a `has`
          // to add here: if the name were in the map, `get` would have found it.
          const target = imports.get(callee);
          if (target) {
            const where = `${name}: ${worklet.where} calls ${callee} from ${target.slice(src.length + 1)}`;
            donde.push(where);
            if (!exportedAsWorklet(target, callee)) {
              offenders.push(`${where}, which is not a worklet`);
            }
            continue;
          }
          if (!locals.has(callee)) continue;
          donde.push(`${name}: ${worklet.where} calls ${callee} declared here`);
          if (!locals.get(callee)) {
            offenders.push(
              `${name}: ${worklet.where} calls ${callee}, declared in this ` +
                "file, which is not a worklet",
            );
          }
        }
      }
    }
  }

  it("finds the calls made from a worklet that carries the directive", () => {
    // Every call on this list is one where the answer depends on a directive, and
    // **a list that comes out empty means the scan is not looking** rather than that
    // there is nothing to look at. Today it is `nextPageFor` from `settle`,
    // `sizeFromDrag` and `oneStepTowards` from the panel's drag, and `dropIndex` and
    // `rowShift` from the draggable row.
    expect(conDirectiva.length).toBeGreaterThan(0);
  });

  /**
   * **And the half that finds the original bug, which is the one with no directive
   * to be found by.**
   *
   * This is the guard that was missing. With `AUTO_WORKLETIZED` and
   * `GESTURE_CALLBACKS` emptied, the list above is not empty — the worklets with a
   * directive still produce their calls — so a single "the list is not empty" guard
   * stayed green with this half switched off, and the `useDerivedValue` that called
   * `trackRoomAt` without the directive was never in the examination at all.
   *
   * **So this one is pinned by name and not only by count.** A count on its own would
   * be enough to catch the emptied list, and the name catches the other way round: a
   * callback that stopped being a worklet position, or a `trackRoomAt` that stopped
   * being called from one. A guard that fails for a reason that is not a bug is a
   * guard that gets deleted.
   */
  it("finds the calls made from a worklet the plugin workletises on its own", () => {
    expect(automaticos.length).toBeGreaterThan(0);
    expect(automaticos.join("\n")).toContain("trackRoomAt");
  });

  it("every one of them says it is a worklet on the other side", () => {
    expect(offenders).toEqual([]);
  });
});
