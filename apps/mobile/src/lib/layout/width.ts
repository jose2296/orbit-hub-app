import { useEffect, useState } from "react";
import { Platform } from "react-native";

import { isWideWidth } from "@/lib/layout/measure";

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
 *
 * The numbers are in `measure`, which is the module that can be asked a question
 * without a window. This one is the window.
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

function measure(): boolean {
  if (Platform.OS !== "web") return false;
  const width = (globalThis as { innerWidth?: number }).innerWidth ?? 0;
  return isWideWidth(width);
}
