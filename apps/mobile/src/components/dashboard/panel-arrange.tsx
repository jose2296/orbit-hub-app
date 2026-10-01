import { createContext } from "react";

/**
 * What a card needs to know about the drag the whole panel is in the middle of.
 *
 * A card cannot work out where it would land on its own: a drop is relative to
 * the *other* cards, and a card only knows about itself. So the panel works it
 * out and hands it down.
 *
 * A context and not props, because the card is three components below the grid
 * and threading six callbacks through a `PlacedCard` that exists only to position
 * it is a prop list that has to be kept in step by hand.
 */
export interface PanelArrange {
  /** Whether the panel is being arranged at all. */
  editing: boolean;
  /**
   * The card being dragged.
   *
   * That is all this says, and the drop position is not here any more: it was
   * `dropIndex`, an index into the order of the screen, and it is now a cell of
   * the grid that only the panel has any business deciding. A card does not need
   * to know where it would land — it follows the finger and the grid moves — so
   * the value is kept upstairs where the placement is worked out.
   */
  dragging: string | null;
  /**
   * The card being carried from one screen to another.
   *
   * Not the same as `dragging`: a card is being dragged for as long as a finger is
   * moving it on its own screen, and it is being *carried* from the moment it was
   * held still until it is let go. The difference is what the push to one side
   * means — on a drag it is a cell, and on a carry it is another screen — and the
   * handles go away on a carry, because a card in your hand is not a card with a
   * corner to pull.
   */
  carried: string | null;
  /**
   * Whether a card can be carried at all.
   *
   * Whether the hold is answered at all, and **not** whether there is another
   * screen to carry to.
   *
   * Those came apart, and the wrong way round is the one that does the harm. On a
   * panel of one screen — which is most people's panel — asking for another screen
   * before allowing the hold meant the card could not be lifted, so it could not be
   * moved either, and rearranging a single screen became impossible with a finger.
   * And there was nothing wrong with the gesture: the hold puts a card in your hand
   * on any page of any phone, and where it can be dropped is a question for after.
   */
  canPickUp: boolean;
  /**
   * The card has been held still long enough to be picked up.
   *
   * The card has been still for long enough to be in a hand, which is the only
   * state in which pushing it sideways means another screen.
   */
  onPickUp: (id: string) => void;
  onDragMove: (id: string, dx: number, dy: number) => void;
  onDragEnd: (id: string) => void;
}

export const PanelArrangeContext = createContext<PanelArrange | null>(null);

/** The name of the shape, for the places that pass it around. */
export type PanelArrangeValue = PanelArrange;

/**
 * A panel that is not being arranged.
 *
 * The screens either side of the one on display are painted so that a swipe has
 * something to bring in, and they are given this instead of the real thing. It
 * matters for more than tidiness: with the real context they draw a resize corner
 * and an unpin button each, on a screen that is off to the side, and those buttons
 * are in the page. They cannot be pressed, and a screen reader announces a control
 * nobody can reach as a control that is there.
 */
export const AT_REST: PanelArrange = {
  editing: false,
  dragging: null,
  carried: null,
  canPickUp: false,
  onPickUp: () => {},
  onDragMove: () => {},
  onDragEnd: () => {},
};
