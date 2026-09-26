import { useEffect, useState } from "react";
import { Platform } from "react-native";

/**
 * Whether there is room for the wide version of this app.
 *
 * A hook and not a function that reads `innerWidth`, because a layout that
 * decides its own shape while it renders is a layout that is right until
 * something else happens to re-render it: rotate the phone, drag the window
 * across the edge of a laptop screen, and a screen that read the width an hour
 * ago keeps the shape it read. The listener is what makes the answer current.
 *
 * Only the web resizes in a way worth listening to, and only the web has a wide
 * layout worth having: a tablet in the hand is a big phone, and a bottom tab bar
 * under the thumb is still the right place for it.
 */
export function useIsWide(): boolean {
  const [wide, setWide] = useState(() => measure());

  useEffect(() => {
    if (Platform.OS !== "web") return;

    const onResize = () => setWide(measure());
    globalThis.addEventListener?.("resize", onResize);
    return () => globalThis.removeEventListener?.("resize", onResize);
  }, []);

  return wide;
}

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

function measure(): boolean {
  if (Platform.OS !== "web") return false;
  const width = (globalThis as { innerWidth?: number }).innerWidth ?? 0;
  return width >= DRAWER_BREAKPOINT;
}
