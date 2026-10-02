import { createContext, useContext } from "react";
import type { ReactNode } from "react";

/**
 * Whether the bar above this screen has already spent the status bar's height.
 *
 * **The one fact two components need and neither can work out alone.**
 * `AppHeader` takes the top safe-area inset so its buttons are not under the
 * clock; `Screen` takes the same inset so its content is not. Only one of them
 * should, or a phone with a notch gets the gap twice — measured here as a bar of
 * 24 points above a page that starts another 24 points down.
 *
 * `AppHeader` is drawn by the navigator, above the screen, so a screen cannot see
 * whether it is there; and `Screen` is drawn by the screen, so it cannot know what
 * the navigator did. The layout is the only thing that knows both, so the layout
 * says so here and the two read it. It is the same arrangement as
 * `HeaderActionProvider`, and for the same reason.
 *
 * `false` by default, and that is the safe direction: a screen outside a layout
 * that draws a header keeps its own top inset, which is what every screen without
 * a bar has always done.
 */
const HeaderOwnsTopInsetContext = createContext(false);

export function HeaderOwnsTopInset({ children }: { children: ReactNode }) {
  return (
    <HeaderOwnsTopInsetContext.Provider value={true}>
      {children}
    </HeaderOwnsTopInsetContext.Provider>
  );
}

export function useHeaderOwnsTopInset(): boolean {
  return useContext(HeaderOwnsTopInsetContext);
}