import { useNavigation } from 'expo-router';
import { useEffect } from 'react';

/**
 * Puts the title of the screen in the header.
 *
 * The header is what says where you are and what the back button goes back
 * from, so it carries the name of the thing rather than a generic label. The
 * name usually arrives from the cache after the first paint, which is why this
 * is a hook and not a prop: setting it again when the data lands is the whole
 * point, and a screen that forgot to would sit there saying "List" forever.
 */
export function useScreenTitle(title: string | null | undefined) {
  /*
    The navigator that draws **this** screen's header, which is the one
    `useNavigation` hands back — and not the one above it.

    It was `getParent()`, added for a reason that no longer exists: the screen sat
    inside a tab, so its own navigator was the tab bar and the header belonged to
    the stack above, and the title went under the icon. With the tab bar gone the
    screen is a screen of the app's own stack and its own navigator is the one
    with the header, so going up a level now sets the title on the root stack —
    whose header is not shown at all, and which therefore takes it and says
    nothing. Measured: the title came out empty.

    One navigator, the one that draws the header. A screen that is a screen of
    two stacks is the thing that needed this comment, and there is not one.
  */
  const navigation = useNavigation();

  useEffect(() => {
    if (!title) return;
    navigation.setOptions({ title });
  }, [navigation, title]);
}
