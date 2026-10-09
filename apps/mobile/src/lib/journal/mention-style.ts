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

export function mentionStyleMap(accent: { color: string; background: string }): Record<string, MentionStyleProperties> {
  const map: Record<string, MentionStyleProperties> = {
    [mentionIndicatorFor(null)]: {
      color: accent.color,
      backgroundColor: accent.background,
      textDecorationLine: "none",
    },
  };
  for (const key of WORKSPACE_COLORS) {
    /*
      Una clave por color, y ninguna para los indicadores viejos.

      La web deriva el nombre del estilo del primer carácter del indicador, así que
      una clave `@teal` compartiría variable con el `@` pelado y el último escrito
      ganaría: el acento se volvería del color que fuese el último de la lista. En
      Android el mapa se consulta con el indicador completo, y por eso añadir esas
      claves "arreglaba" el teléfono mientras rompía el navegador.

      Un chip con indicador viejo se arregla donde se pinta, no donde se buscan los
      estilos: `normaliseIndicator` lo reescribe antes de buscar el estilo.
    */
    map[mentionIndicatorFor(key)] = chipStyle(colorOf(key));
  }
  return map;
}
