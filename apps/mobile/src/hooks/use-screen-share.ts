import { useNavigation } from "expo-router";
import { useEffect } from "react";

/** What a screen says about being shared, so the header can draw it. */
export interface PantallaCompartido {
  /** The node, or `null` when the screen is about something that cannot be shared. */
  node: { nodeType: "workspace" | "folder" | "list" | "note"; id: string } | null;
  /** `true` when somebody handed it to you: the `shared` flag on the entity. */
  conmigo?: boolean;
  /** Opens the share sheet from the badge. */
  onShare?: () => void;
}

/**
 * Puts "te lo compartieron" and "tu lo compartiste" in the header.
 *
 * Travels through `setOptions` and not through the header's action context, and
 * the difference matters. The action slot holds a **function** and the layout
 * re-applies its own options on every render of the layout, which is why a screen
 * cannot own a slot the layout also owns — see `header-action.tsx`, where that
 * was measured rather than guessed. What lives here is plain data, exactly like
 * the title, and the title works.
 *
 * It goes out again on the way to `null`, for the reason `useHeaderAction` clears
 * its slot: a stack keeps the screen underneath mounted, so without the cleanup
 * the badge of the list you pushed past is still on the folder you came back to.
 */
export function useScreenShare(compartido: PantallaCompartido | null): void {
  const navigation = useNavigation();

  useEffect(() => {
    navigation.setOptions({ compartido });
    return () => navigation.setOptions({ compartido: undefined });
  }, [navigation, compartido]);
}