import { createContext, useContext } from "react";

/**
 * Whether the sheet that is open has changes nobody has committed.
 *
 * The flag lives in the **sheet**, not in the screen that drew it, and that is
 * the whole point of it. A draft held by the screen is a draft that outlives the
 * panel: open the sheet of one list, type a title, swipe to another list — the
 * text is still in the screen's state, so the next sheet opens with the last
 * one's words already in it. That is not a bug you can fix by remembering to
 * clear it in every sheet, because "every sheet" is twenty-four files and the one
 * somebody forgets is the bug. The panel comes and goes and takes its own
 * contents with it.
 *
 * It also resets itself the moment the sheet opens, so **a sheet never arrives
 * dirty**. There is no path by which "sucio" survives an opening.
 */
export interface SheetSucio {
  /** Whether there is anything uncommitted. */
  sucio: boolean;
  /**
   * Says whether the current contents differ from what was there when it opened.
   *
   * Called by whoever owns the draft, because only it knows what "different"
   * means here: for a name it is the string, for a colour it is the pair of
   * ends, for a list of tags it is the set and not the order.
   */
  setSucio: (valor: boolean) => void;
}

export const SheetSucioContexto = createContext<SheetSucio>({
  sucio: false,
  setSucio: () => {},
});

/**
 * From inside a sheet: has anything changed since it opened.
 *
 * Outside a sheet it is a no-op that reports "nothing changed", so a form can be
 * written without asking where it is — and a form used outside a sheet cannot
 * pretend to be dirty, because there is nothing that would ever save it.
 */
export function useSheetSucio(): SheetSucio {
  return useContext(SheetSucioContexto);
}