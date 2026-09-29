import { useNavigation } from 'expo-router';
import { useEffect, useMemo } from 'react';

import type { WashVariant } from '@/lib/workspace/wash';

/**
 * Puts the space a screen belongs to in the header, which is the one place its
 * colour lives now.
 *
 * **A hook and not a prop, for the same reason the title is one:** the space
 * arrives from the cache after the first paint, and setting it again when the
 * data lands is the whole point. A screen that forgot to would sit there in the
 * theme's grey while its own content said which space it was in.
 *
 * **The screen only says which space; it does not say how to paint it.** The
 * colour, the pair, and which of the two colours the title goes on top of are all
 * decided in `AppHeader`, with the same `spacePaint` that paints the panel's
 * cards. A screen that decided the paint itself would be a second answer to the
 * same question, and the eleven screens that are not inside a space would each
 * have needed their own idea of what to do about it — when the honest answer is
 * one line: there is no space here, so the header is the theme's background.
 *
 * `null` is that answer, and it is the default: nobody calls this hook, and the
 * header is neutral.
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
) {
  const navigation = useNavigation();

  const publicado = useMemo(
    () =>
      space
        ? { color: space.color, colorTo: space.colorTo, wash: space.wash }
        : null,
    [space],
  );

  useEffect(() => {
    // `espacio` is not a navigator option: it is ours, and it is read by
    // `AppHeader` out of the options it already receives. Writing it through
    // `setOptions` is what makes it arrive, and a screen that leaves without
    // clearing it would hand its colour to the next screen — which is why the
    // effect always writes, with `null` included.
    (navigation as unknown as { setOptions: (o: Record<string, unknown>) => void }).setOptions({
      espacio: publicado,
    });
  }, [navigation, publicado]);
}
