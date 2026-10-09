/**
 * How a chip is painted: one style per space colour, keyed by the indicator the
 * chip carries (`@teal`, `@rose`, ...). The library looks the style up by that
 * indicator, so a chip is the colour of its space without the document saying so
 * in any way but its indicator.
 *
 * The colours are the space colours the app already draws, so a chip and the space
 * it belongs to match. A chip with no colour falls back to the plain trigger style.
 */

import { WORKSPACE_COLORS, mentionIndicatorFor } from "@orbit-hub/contracts";

import { colorOf } from "@/lib/workspace/color";
import type { MentionStyleProperties } from "react-native-enriched-html";

/** Translucent wash behind the text, on top of the space colour. */
const WASH = "26";

function chipStyle(colour: string): MentionStyleProperties {
  return {
    color: colour,
    backgroundColor: `${colour}${WASH}`,
    textDecorationLine: "none",
  };
}

/** Every chip style the app can draw, keyed by its indicator. */
export function mentionStyleMap(accent: { color: string; background: string }): Record<string, MentionStyleProperties> {
  const map: Record<string, MentionStyleProperties> = {
    [mentionIndicatorFor(null)]: {
      color: accent.color,
      backgroundColor: accent.background,
      textDecorationLine: "none",
    },
  };
  for (const key of WORKSPACE_COLORS) {
    map[mentionIndicatorFor(key)] = chipStyle(colorOf(key));
  }
  return map;
}
