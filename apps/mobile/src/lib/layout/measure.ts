/**
 * The numbers a layout is built out of, and nothing else.
 *
 * No `Platform`, no `Dimensions`, no React: this is geometry, it is a function of
 * a width, and it can be asked what it does. That is the reason it is a separate
 * file from the hook that reads the window — `useIsWide` needs react-native to
 * know what a platform is, and importing it into a test to ask "how wide is the
 * menu" would mean parsing all of react-native to do arithmetic.
 *
 * Everything here is a decision somebody made with a number in front of it. The
 * number and the reason it is that number live together, because the reason is
 * the part that stops the next person from moving it.
 */

/**
 * Where the drawer appears.
 *
 * 900 points and not 768: at 768 a drawer and its margin leave under 500 for
 * the content, which is a phone-width column with a third of the screen spent
 * on four words.
 */
export const DRAWER_BREAKPOINT = 900;

/** How wide the content of a screen is allowed to get, for reading. */
export const READING_WIDTH = 720;

/** For grids: the panel of cards, and anything else laid out in columns. */
export const GRID_WIDTH = 1000;

/**
 * How wide the menu is, on every screen that shows it.
 *
 * One number and not one per size, because a menu that is 288 on a phone and 264
 * on a laptop is two menus: the row you learned to aim at on one is a few pixels
 * off on the other, and the indentation of the tree stops lining up with the edge
 * of the column. The menu is one thing that is placed differently, not two
 * things that look similar.
 */
export const DRAWER_MAX_WIDTH = 288;

/** What the menu takes of the screen, up to `DRAWER_MAX_WIDTH`. */
export const DRAWER_FRACTION = 0.66;

/**
 * The width of the menu on a screen of a given width.
 *
 * Two thirds, and medido: con tres cuartos la app se quedaba en 110 px de un
 * movil de 430, y en 90 de uno de 360. Una franja de 110 px no reconoce la
 * pantalla que interrumpes, y las filas se salen de ella.
 *
 * A phone is left with a strip of app behind the menu, and that strip is the
 * whole reason for the fraction being well under one: the screen you interrupted
 * still has to be recognizable.
 *
 * There is no argument for which of the two placements this is. A function that
 * took one would be how the menu became two menus again.
 */
export function drawerWidth(screenWidth: number): number {
  return Math.min(DRAWER_MAX_WIDTH, Math.round(screenWidth * DRAWER_FRACTION));
}

/**
 * Whether a width is a wide one.
 *
 * The answer to a number, with the number's meaning in one place. `useIsWide` is
 * the answer to the *window*, which is the same question plus a listener.
 */
export function isWideWidth(width: number): boolean {
  return width >= DRAWER_BREAKPOINT;
}
