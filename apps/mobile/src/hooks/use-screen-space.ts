import { useNavigation } from 'expo-router';
import { useEffect, useMemo } from 'react';

import { colorOf } from '@/lib/workspace/color';
import type { WashVariant } from '@/lib/workspace/wash';

/**
 * Puts the space a screen belongs to in the header, so the header is painted with
 * it and the screens stop painting it themselves.
 *
 * **A hook and not a prop, for the same reason the title is one**: the space
 * arrives from the cache after the first paint, and setting it again when the
 * data lands is the whole point. A screen that forgot to would sit there in the
 * theme's grey while its own content said which space it was in.
 *
 * **A flat colour and not the wash.** The header is the navigator's own view, and
 * it takes one `backgroundColor`: a gradient would mean replacing the header with
 * a custom one, and the header was unified on purpose — there is one, and the
 * title, the back button and the menu are in the same place on every screen. So
 * the header gets the first colour of the wash, which is the colour the person
 * chose, and the gradient stays where it already was: on the cards of the panel.
 *
 * **And the contrast decides, not the colour.** A header painted in the space's
 * colour has the title drawn on top of it in the theme's own text colour, and
 * those two are not related: a pale space in a dark theme gives white on
 * near-white. So the colour is only used when the title can be read on it, and
 * when it cannot the header falls back to the theme's background. Nobody has to
 * pick a colour that happens to work, and nobody has to remember which ones do.
 * The threshold is the one the rest of the app measures against, and it is in one
 * place so it cannot drift from the one used elsewhere.
 */
export function useScreenSpace(
  space:
    | {
        id: string;
        color?: string | null;
        colorTo?: string | null;
        wash?: WashVariant | null;
      }
    | null
    | undefined,
  /** The title colour the header would draw on top of it. */
  texto: string,
  /** What the header uses when there is no space, or when the colour fails. */
  fondo: string,
) {
  const navigation = useNavigation();

  const elegido = useMemo(() => {
    const color = colorOf(space?.color ?? null);
    if (!space || !color) return fondo;
    return contraste(texto, color) >= MIN_CONTRASTE ? color : fondo;
  }, [fondo, space, texto]);

  useEffect(() => {
    navigation.setOptions({
      headerStyle: { backgroundColor: elegido },
      headerTitleStyle: { fontWeight: '600' },
    });
  }, [elegido, navigation]);
}

/** Below this the title cannot be read on the header, whatever the colours are. */
const MIN_CONTRASTE = 4.5;

/**
 * The contrast ratio of two colours, as WCAG defines it.
 *
 * Written out and not imported: the formula is six lines, and a dependency for
 * six lines that are never going to change is a dependency somebody has to
 * update when it stops being six lines. The relative luminance is the one with
 * the 0.03928 constant, which is not a magic number: it is where `(c + 0.055) / 1.055`
 * crosses 0.04045, the boundary of the sRGB non-linearity.
 */
export function contraste(a: string, b: string): number {
  const la = luminancia(a);
  const lb = luminancia(b);
  const [claro, oscuro] = la > lb ? [la, lb] : [lb, la];
  return (claro + 0.05) / (oscuro + 0.05);
}

function luminancia(color: string): number {
  const [r, g, b] = canales(color);
  const lineal = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lineal(r) + 0.7152 * lineal(g) + 0.0722 * lineal(b);
}

function canales(color: string): [number, number, number] {
  const hex = color.trim().replace('#', '');
  const completo =
    hex.length === 3
      ? hex
          .split('')
          .map((c) => c + c)
          .join('')
      : hex;
  const n = Number.parseInt(completo.slice(0, 6) || '000000', 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
