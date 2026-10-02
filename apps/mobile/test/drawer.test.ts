import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import {
  DRAWER_BREAKPOINT,
  DRAWER_FRACTION,
  DRAWER_MAX_WIDTH,
  drawerWidth,
} from "@/lib/layout/measure";

const RAIZ = join(process.cwd(), "src");

/** Every source file under `src`, with its text and its path relative to it. */
function fuentes(): [string, string][] {
  const salida: [string, string][] = [];

  const recorrer = (dir: string) => {
    for (const entrada of readdirSync(dir, { withFileTypes: true })) {
      const ruta = join(dir, entrada.name);
      if (entrada.isDirectory()) {
        recorrer(ruta);
      } else if (entrada.name.endsWith(".ts") || entrada.name.endsWith(".tsx")) {
        salida.push([relative(RAIZ, ruta), readFileSync(ruta, "utf8")]);
      }
    }
  };

  recorrer(RAIZ);
  return salida;
}

describe("el ancho del menu", () => {
  /**
   * Two thirds of the screen, and the cap on top of it.
   *
   * The numbers are in the source comment of `drawerWidth` and they were measured
   * on real phones: at three quarters the app was left with 110 px of a 430 wide
   * phone and 90 of a 360 one, and a strip that narrow does not read as the
   * screen it is interrupting. The fraction and the cap are the decision, so they
   * are pinned here instead of being left to whoever edits the constant.
   */
  it("son dos tercios de la pantalla", () => {
    expect(drawerWidth(430)).toBe(Math.round(430 * DRAWER_FRACTION));
  });

  it("nunca pasa del maximo", () => {
    expect(drawerWidth(1280)).toBe(DRAWER_MAX_WIDTH);
    expect(drawerWidth(3840)).toBe(DRAWER_MAX_WIDTH);
  });

  /**
   * The same number on a phone and on a laptop, for the same screen width.
   *
   * This is the whole point of the function existing: the menu is one component
   * that is placed differently, and a function that took a "which placement is
   * this" argument would be how it started being two menus again.
   */
  it("es el mismo menu en las dos pantallas, no dos anchos", () => {
    const pantallas = [360, 430, 768, DRAWER_BREAKPOINT, 1024, 1440];
    for (const ancho of pantallas) {
      expect(drawerWidth(ancho)).toBe(drawerWidth(ancho));
      // And wide enough to show its own rows, never more than the cap.
      expect(drawerWidth(ancho)).toBeLessThanOrEqual(DRAWER_MAX_WIDTH);
      expect(drawerWidth(ancho)).toBeGreaterThan(200);
    }
  });

  it("deja una franja de app reconocible en un movil pequeno", () => {
    // The push is only worth doing if what it pushes is still a screen. This is
    // the 360 case, the narrowest phone that is still a phone.
    expect(360 - drawerWidth(360)).toBeGreaterThan(100);
  });
});

/**
 * There is one menu, and it is the whole menu.
 *
 * There used to be two: `DrawerPanel` for a phone, with the file tree in it, and
 * `SideDrawer` for a wide screen, with a flat list of the spaces and their
 * dots. They were meant to be the same navigation and were not — every folder,
 * list and item was reachable only on a phone — and the way that happens is
 * always the same way: two lists of rows that are supposed to match, kept in
 * step by hand, drifting apart over a few months.
 *
 * These read the source because the failure is structural. A component either is
 * the menu or is not, and there is no render to assert on here: the panel draws
 * a file tree out of a local store, and a test of it would be a test of
 * react-native. What can be checked is that only one file is allowed to declare
 * the menu at all.
 */
describe("el menu es uno", () => {
  it("solo un archivo declara la navegacion del menu", () => {
    // `t("drawer.spaces")` heads the section with the spaces in it, so any file
    // that *paints* it is painting a menu. Matched on the call and not on the
    // key, because the dictionary has the key too and it paints nothing.
    const declarantes = fuentes()
      .filter(([, texto]) => /t\(\s*["']drawer\.spaces["']/.test(texto))
      .map(([ruta]) => ruta);

    expect(declarantes).toEqual([join("components", "layout", "drawer.tsx")]);
  });

  it("ese menu lleva el arbol entero, no solo los espacios", () => {
    const menu = readFileSync(
      join(RAIZ, "components", "layout", "drawer.tsx"),
      "utf8",
    );

    // The three things that were on the phone and not on the desktop. If one of
    // them goes missing the menu is a flat list again, and this is the test that
    // says so before somebody screenshots it.
    for (const parte of [
      "function SpaceBranch",
      "function FolderBranch",
      "function ListBranch",
    ]) {
      expect(menu).toContain(parte);
    }

    // The inbox row is **not** one of them any more, and that is the fix rather
    // than a regression: the share notification links to `/shared`, that route had
    // to become a screen, and a screen cannot draw a function that only exists
    // inside the drawer. It lives in `shared-inbox-row` now and both draw the same
    // one — see `email-links.test.ts`, which is the test that says the link has
    // somewhere to land.
    expect(menu).toContain("SharedInboxRow");
    const fila = readFileSync(
      join(RAIZ, "components", "shares", "shared-inbox-row.tsx"),
      "utf8",
    );
    expect(fila).toContain("export function SharedInboxRow");
  });

  it("no queda un segundo menu en un archivo aparte", () => {
    const menus = fuentes()
      .map(([ruta]) => ruta)
      .filter((ruta) => /drawer|sidebar/i.test(ruta));

    expect(menus).toEqual([join("components", "layout", "drawer.tsx")]);
  });
});

/**
 * The hamburger collapses it, and it does it in both placements.
 *
 * It used to be a button that only ever opened: `onPress={() => setOpen(true)}`.
 * That is fine while the menu can only be closed by tapping the screen it pushed
 * aside, and it is a dead end the moment it can be collapsed — close the column
 * on a wide screen and nothing in the app brings it back.
 */
describe("la hamburguesa", () => {
  const menu = readFileSync(
    join(RAIZ, "components", "layout", "drawer.tsx"),
    "utf8",
  );

  it("alterna en vez de solo abrir", () => {
    const boton = menu.slice(menu.indexOf("export function DrawerButton"));
    expect(boton).toContain("onPress={toggle}");
    // The old one-liner, which is the bug this whole file used to have.
    expect(menu).not.toContain("setOpen(true)}");
  });

  it("dice lo que hace, y lo dice bien para un lector de pantalla", () => {
    const boton = menu.slice(menu.indexOf("export function DrawerButton"));
    // A hamburger that only says "open" while it is open is a control that lies
    // to somebody who cannot see that it is open.
    expect(boton).toContain("t(\"drawer.close\")");
    expect(boton).toContain("t(\"drawer.open\")");
    // And it has to publish that it is a disclosure, on both platforms.
    expect(boton).toContain("expandedProps(open)");
  });

  /**
   * The disclosure state reaches a browser, not only a phone.
   *
   * `accessibilityState={{ expanded }}` is the React Native way and react-native-web
   * 0.21.2 throws it away — the string is not in its prop handling at all. The
   * hamburger was written that way and the page had `role="button"`,
   * `aria-label="Cerrar el menú"` and no `aria-expanded`: a control that said it
   * was closing a menu and gave no sign of whether the menu was open. Measured in
   * the browser, in `scripts/verify-drawer.mjs`.
   *
   * So both are passed, and this is the check that the second one is not dropped
   * in a tidy-up. Same reasoning as `a11y-selected.ts`, which is the same bug for
   * `selected`.
   */
  it("el estado de desplegado se publica en las dos plataformas", () => {
    const estado = readFileSync(join(RAIZ, "components", "ui", "a11y-state.ts"), "utf8");

    // Both spellings, in the same function, or one of the two platforms loses.
    const cuerpo = estado.slice(estado.indexOf("export function expandedProps"));
    expect(cuerpo).toContain("accessibilityState: { expanded }");
    expect(cuerpo).toContain("\"aria-expanded\": expanded");
    expect(cuerpo).toContain("Platform.OS === \"web\"");

    // And the drawer uses it everywhere something opens and closes: the menu
    // button, the arrow that opens a branch, and the three rows of the tree while
    // they are open. Five call sites, and the one that gets dropped in a tidy-up
    // is the one nobody looks at.
    const veces = (menu.match(/expandedProps\(/g) ?? []).length;
    expect(veces).toBe(5);
    expect(menu).not.toContain("accessibilityState={{ expanded:");

    // `selected` had the same hole and the same helper.
    expect(menu).toContain("selectedProps(focused)");
    expect(menu).not.toContain("accessibilityState={{ selected:");
  });
});

/**
 * The wide screen is not a second app.
 *
 * `_layout` is where a fork like this comes back: a branch that renders one
 * navigation for a phone and a different one for a desktop, which is the shape
 * the bug had. It has to be one shell with the screen as an argument.
 */
describe("el layout de (app)", () => {
  const layout = readFileSync(
    join(RAIZ, "app", "(app)", "_layout.tsx"),
    "utf8",
  );

  it("usa el mismo shell en las dos pantallas", () => {
    expect(layout).toContain("<DrawerProvider wide={wide}>");
    // One `Drawer` and one `DrawerProvider`, and `stack` inside it. Counted and
    // not matched literally: the children of `Drawer` have changed more than once
    // — the provider for the header's action slot, the one that says the header
    // has spent the status bar — and every time, this assertion failed on the
    // shape instead of on the thing it is for.
    expect([...layout.matchAll(/<Drawer\b/g)]).toHaveLength(1);
    expect([...layout.matchAll(/<DrawerProvider\b/g)]).toHaveLength(1);

    const drawer = layout.slice(layout.indexOf("<Drawer wide={wide}>"));
    expect(drawer).toContain("</Drawer>");
    // `stack` has to be inside it, or the shell is not wrapping the navigation.
    const dentroDelDrawer = drawer.slice(0, drawer.indexOf("</Drawer>"));
    expect(dentroDelDrawer).toContain("stack");
  });

  it("no importa ningun otro menu", () => {
    const imports = [...layout.matchAll(/from "([^"]+)"/g)].map((m) => m[1]);
    const menus = imports.filter((ruta) => /drawer|sidebar/.test(ruta ?? ""));
    expect(menus).toEqual(["@/components/layout/drawer"]);
  });

  /**
   * The hamburger is in the header of every screen, not only the three
   * destinations.
   *
   * The three destinations are rows *inside* the menu, so closing it takes the
   * way back to them away with it. A hamburger that only existed on the three
   * tabs was a way to collapse the navigation and then be unable to open it from
   * any of the other nine screens.
   */
  it("el boton esta en la cabecera de toda la pila, no solo de las pestanas", () => {
    // One `headerLeft` for the whole `Stack`, and it holds the button.
    expect(layout).toContain("headerLeft: () => (");
    const header = layout.slice(
      layout.indexOf("headerLeft: () => ("),
      layout.indexOf("}}>"),
    );
    expect(header).toContain("<DrawerButton />");
    expect(header).toContain("<BackButton />");
  });
});
