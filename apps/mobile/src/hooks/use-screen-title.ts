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
  const navigation = useNavigation();

  useEffect(() => {
    if (!title) return;
    navigation.setOptions({ title });
  }, [navigation, title]);
}
