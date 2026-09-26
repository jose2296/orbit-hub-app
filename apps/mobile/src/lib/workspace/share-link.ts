import { Platform, Share } from "react-native";

/**
 * Getting a link out of the app and into a conversation.
 *
 * On the web that means the clipboard, and on a phone it means the system share
 * sheet. Not a copy on both: a person holding a phone who pressed "copy" now
 * has an invitation in a clipboard they have to switch apps to paste from,
 * whereas the share sheet puts them straight in the conversation with the other
 * person. So the button is called the same thing in both places and does the
 * thing that makes sense with the machine in their hand.
 *
 * No new library for this. `expo-clipboard` would do the copy on native, and
 * adding it for a button that is better served by `Share` is a dependency that
 * exists to be one line short.
 *
 * It can fail — a browser can refuse the permission, and a user can dismiss the
 * share sheet — so it answers whether it worked and the caller says so, instead
 * of the screen claiming "Copiado" over a clipboard that never got it.
 */
export async function shareLink(text: string, title: string): Promise<boolean> {
  try {
    if (Platform.OS === "web") {
      const nav = globalThis.navigator;
      if (!nav?.clipboard?.writeText) return false;
      await nav.clipboard.writeText(text);
      return true;
    }

    const result = await Share.share({ message: text, title });
    // `dismissedAction` is iOS only, and a share sheet that was dismissed is a
    // share that did not happen.
    return result.action === Share.sharedAction;
  } catch {
    return false;
  }
}
