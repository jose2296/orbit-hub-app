import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";

import type { DashboardWidget, WorkspaceWash } from "@orbit-hub/contracts";

import { useA11yHint } from "@/components/ui/a11y-hint";
import { AddMenu, useAddMenu, type AddMenuOption } from "@/components/ui/add-menu";
import { FloatingButton } from "@/components/ui/floating-button";
import { AppText } from "@/components/ui/text";
import {
  MAX_PAGES,
  PANEL_COLUMNS,
  PANEL_ROWS,
  CARRY_EDGE_MARGIN,
  CARRY_EDGE_MARGIN_MIN,
  carryAtEdge,
  carryCard,
  carryDirection,
  carryFits,
  carryTarget,
  cardSize,
  heldSpot,
  moveCardTo,
  pageCards,
  pageCount,
  pageOf,
  panelCell,
  panelHeightInPixels,
  placeCards,
  resizeCard,
} from "@/lib/dashboard/panel";
import type { PlacedCard } from "@/lib/dashboard/panel";
import type { CardMark } from "@/lib/dashboard/card-kind";
import { useTranslation } from "@/lib/i18n";
import { useTheme } from "@/theme";

import { AT_REST, PanelArrangeContext } from "./panel-arrange";
import type { PanelArrangeValue } from "./panel-arrange";
import { PanelCard } from "./panel-card";

/**
 * How a card that is not under a finger gets to where it belongs.
 *
 * A short ease-out that stops, and not a spring. A spring overshoots its target
 * and comes back, and on a screen of a dozen cards that overshoot is a dozen
 * cards each wobbling for a moment after you let go — which is noise, not motion.
 * The OS moves an icon with an ease-out and stops dead, and once you have seen
 * that, a spring on the same gesture reads as the panel being springy rather than
 * as the card being moved.
 *
 * Long enough to see where a card went, short enough that the end of it is over
 * before your hand is back where it started.
 */
const MOVE = { duration: 170, easing: Easing.out(Easing.cubic) };

/**
 * How far a finger has to travel, and how fast, to turn the screen.
 *
 * Both, and either is enough. A short fast flick counts — that is how everybody
 * swipes — and a long slow drag counts too, for a thumb that moved a long way
 * without hurry. A slow short drag does nothing, which is somebody pressing on
 * the panel and changing their mind, and turning the page on it would be the app
 * guessing.
 */
const SWIPE_DISTANCE = 56;
const SWIPE_VELOCITY = 420;

/**
 * How much of a page comes back when there is no page to go to.
 *
 * The screen moves a third of the way and stops, rather than letting the end of
 * the panel come into view. A page that will not go is a page you have tried
 * already, and the resistance is what says so without a line of text.
 */
const EDGE_RESISTANCE = 3.4;

/**
 * How long the page takes to finish the gesture.
 *
 * Not a fixed number, and that is the whole point of it. The finger stopped
 * somewhere; the page has to go from *there* to the page it is heading for, and
 * the time that should take is the time the rest of the way takes. A fixed
 * duration makes a page that had almost arrived crawl and a page that had barely
 * started race past, and a swipe that changes speed depending on how much of it
 * was left reads as two different gestures.
 *
 * So it is worked out from the distance still to travel, at a speed that is quick
 * enough to feel like the hand taking over and slow enough to see where the page
 * is going. The bounds are what stop a page from taking no time at all when it is
 * nearly there, and from taking half a second when it has the whole panel to
 * cross.
 */
const PAGE_SPEED = 2.6;
const PAGE_MIN = 90;
const PAGE_MAX = 320;

/**
 * How far a finger has to travel before its direction means anything.
 *
 * A slop and not a mark: this does not decide whether the screen turns, it only
 * says which way the hand is going. Whether the screen turns is `carryAtEdge` —
 * the card being in your hand against the edge of the panel, which is what a phone
 * does when you drag an icon to the edge of the screen and pause.
 *
 * Six points is a finger resting badly, not a finger deciding something. It was
 * fifty-six and it decided the turns, and that made carrying mean "move this far"
 * rather than "take this to the edge", which is a rule nobody could see and the OS
 * does not have.
 */
const CARRY_SLOP = 6;

/**
 * How long the background has to be held to start arranging.
 *
 * On a phone this is what everybody already does: press and hold the wallpaper and
 * the icons start jiggling. It was the pencil in the header here and only the
 * pencil, so the gesture everybody arrives with did nothing at all — and the button
 * in the header is not going away, because it is also how you *finish*, and half
 * the users of a panel are rearranging rather than looking.
 *
 * Longer than the hold that picks a card up (`CARRY_AFTER` in the card), on
 * purpose: picking up a card is a small decision you take with your thumb while
 * your hand is already there, and entering the arrangement is a decision about the
 * whole screen.
 */
const FONDO_ENTRA = 450;

/**
 * How long the push has to be held at the edge before the screen turns.
 *
 * Not zero, because a carry is a hold and a drag is a move, and this is where the
 * two are told apart a second time: a hand that brushes across a card on its way
 * somewhere else must not leave a screen behind it.
 *
 * And not long enough to feel like a mode. It is roughly the time it takes to
 * notice that the panel did not do anything and to push a little further, which is
 * the right length for a pause that means "keep going".
 */
const CARRY_TURN_HOLD = 230;

/*
 * How far the hand has to go again after a turn before another one is armed.
 *
 * This is what replaced "come back to the middle of the screen", which is what used
 * to stop a held icon from walking the whole panel — and which made a second screen
 * unreachable. The distance back was measured from the cell the card was picked up
 * on, on the screen it was picked up on, so after one turn the hand had to come back
 * a **whole screen's worth** before it was allowed to ask again: a card got to page
 * two and no further, and there was no gesture that could do more.
 *
 * A hand that has not moved cannot ask for anything, whatever side it is on, and that
 * is the whole of what the old rule was for. So that is the rule: some movement.
 *
 * Twenty-four points is about half the margin, so it is a push rather than a twitch,
 * and small enough that there is room for it at the side of a screen.
 */
const CARRY_TURN_NUDGE = 24;

export interface PanelGridProps {
  layout: DashboardWidget[];
  /** The colour of the space each card belongs to, so it is painted with it. */
  colorKeyOf: (widget: DashboardWidget) => string | null | undefined;
  /**
   * The wash of that same space, for the same reason.
   *
   * Optional because the grid has no way to invent it: it holds widgets and not
   * spaces, so the style lives with the colour in the screen that knows both.
   */
  washOf?: (widget: DashboardWidget) => WorkspaceWash | undefined;
  /**
   * The colour each space ends in, for the same reason the colour travels.
   *
   * A second choice the person made, and a card that does not get it paints the
   * derived pair: the panel says one thing and the picker another about the same
   * space.
   */
  colorToOf?: (widget: DashboardWidget) => string | null | undefined;
  /** The name of that space, for the card while the panel is being arranged. */
  whereOf: (widget: DashboardWidget) => string;
  /** What each card says, and where it goes when it is tapped. */
  describe: (widget: DashboardWidget) => {
    title: string;
    subtitle: string;
    emoji: string | null;
    href: string | null;
    /**
     * What the card *is*, so a card can be told apart from a folder or from a
     * different kind of list without reading it. A panel of cards is a grid of
     * the same rectangle, and words alone leave "Cine" and the folder called
     * "Cine" as the same thing.
     */
    mark: CardMark;
  };
  /** The write, once a drag or a resize is finished. */
  /**
   * The arrangement, and how many screens it claims.
   *
   * The count comes along in the same call and not in one of its own because the
   * two are saved together or not at all: a layout written without its count is a
   * panel whose screens are gone the next time it is read, which is the bug the
   * count was added to fix arriving by a different road.
   */
  onChange: (next: DashboardWidget[], pages?: number) => void;
  /**
   * Which screen the person is looking at.
   *
   * Read by the screen when it pins something, so a card lands where somebody is
   * standing rather than on the first screen with room. It is reported upwards
   * rather than kept here because the panel is the only thing that knows: the
   * screen cannot see a page it does not draw.
   */
  onPageChange?: (page: number) => void;
  /**
   * Whether the panel is being arranged, and how to stop.
   *
   * Lifted to the screen above, because the button that turns this on and off
   * lives in the header there and not in here. A pencil drawn inside the panel
   * that the header also has is two buttons that both mean "edit", and the one
   * the eye lands on is the one that is easiest to reach — which is not the one
   * that saves when you are done.
   */
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
  /**
   * Where the header's "done" button finds the function that ends the
   * arrangement. A ref rather than a callback, because the draft it saves is
   * state in here and a parent that held it would re-render on every frame of a
   * drag.
   */
  finishRef: { current: () => void };
  /** How many lists are not on the panel yet, for the add card. */
  availableCount: number;
  /** How many screens the panel claims, which can be more than have cards on them. */
  pages?: number;
  /** Opens the list of things that can be added. */
  onOpenEditor: () => void;
  /**
   * Adds a screen, and says how many there are now.
   *
   * A callback and not a number because the count is saved with the arrangement
   * and not on its own: a screen that exists only in memory is a screen that is
   * gone by the time you press Guardar, which is the same as not having added it.
   */
  /**
   * Told the new number of screens, so it can be written.
   *
   * The panel draws the arrangement and the screen above it stores it, and the
   * count is part of that: a screen nobody can get to is a screen that is not
   * there. The draft comes with it so the write does not undo a card that was
   * moved in the same sitting.
   */
  onAddPage?: (pages: number, draft: DashboardWidget[]) => void;
  /** Goes where a card says when it is tapped. */
  onOpen: (href: string) => void;
}

/**
 * The panel: screens of cards that the person arranges themselves.
 *
 * A card is one of a fixed set of sizes and it sits on the grid where the person
 * put it. Both are in cells and never in pixels, so the same arrangement is the
 * same panel on a phone and on a laptop — an arrangement belongs to the person and
 * not to the screen they made it on.
 *
 * More pinned things than fit is the normal case, not a mistake, so the panel has
 * as many screens as it needs and a card that does not fit goes to the next one. A
 * panel that hid what it could not draw would be a panel where somebody has things
 * they cannot reach — and that is the failure the pagination exists to remove,
 * not the other way round.
 *
 * Arranging is a mode, the way it is on the OS: the pencil in the header turns it
 * on, cards wobble, and a Guardar that was not there before turns it off and
 * writes. Outside the mode the cards are just cards and a tap goes where the card
 * says, because a panel you cannot tap your way through is a poster.
 *
 * There is no title, no count and no explanation above the grid. The panel is the
 * screen; a line of text saying that the cards can be moved is a line of text on a
 * screen where you can already see the cards, and the only thing it does is push
 * the panel down.
 */
export function PanelGrid({
  layout,
  colorKeyOf,
  washOf,
  colorToOf,
  whereOf,
  describe,
  onChange,
  editing,
  onEditingChange,
  finishRef,
  availableCount,
  pages = 1,
  onOpenEditor,
  onAddPage,
  onPageChange,
  onOpen,
}: PanelGridProps) {
  const theme = useTheme();
  const t = useTranslation();

  const [draft, setDraft] = useState(layout);
  const [page, setPage] = useState(0);
  /**
   * How many screens the arrangement claims, in the draft.
   *
   * In state and not read straight from the prop because a screen added while
   * arranging is a change to the arrangement, and the arrangement is only real
   * once Guardar has been pressed. A ref carries it into `commit`, which runs from
   * a gesture and cannot afford to close over a value that is one render behind.
   */
  const [pagesDraft, setPagesDraft] = useState(() => pageCount(layout, pages));
  const pagesDraftRef = useRef(pagesDraft);
  pagesDraftRef.current = pagesDraft;

  /**
   * How many screens the stored panel claims, and what an arriving change sets it
   * to.
   *
   * A number in the draft, so a change that arrives from elsewhere — another
   * device, or the picker — only ever **grows** it. Setting it outright, as this
   * did, meant a re-render carrying an equal-but-new array quietly undid a screen
   * the person had just added, and the button they pressed did nothing with no
   * way to tell that from the button being broken.
   */
  const declaradas = pageCount(layout, pages);
  useEffect(() => {
    setPagesDraft((previas) => Math.max(previas, declaradas));
  }, [declaradas]);
  const [dragging, setDragging] = useState<string | null>(null);
  /** The cell the card is over, in grid cells. The arrangement, not a list order. */
  const [drop, setDrop] = useState<{ x: number; y: number } | null>(null);

  /**
   * The card in the person's hand, and the layout it was picked up from.
   *
   * `from` and not the draft, because a carry is a change to the card's own page
   * and to nothing else: the screens it travelled through only ever had that one
   * widget re-pointed, and they are already in `from`. Writing the turn from the
   * draft would take the placement of the screen it is standing on — where the
   * card was *before* anybody picked it up — and apply it to the screen it is
   * arriving at.
   *
   * A ref and not state, because it is read and written from inside a gesture, at
   * sixty moves a second, and the one thing a callback may not do here is capture
   * a value that is one frame behind.
   */
  const carry = useRef<{
    id: string;
    from: DashboardWidget[];
    /**
     * The cell the card was picked up from, and the one every cell of the carry is
     * measured against.
     *
     * Measured from there and not from where the card currently is, because the
     * turn moves it: a cell read from the card's own position is a cell read from
     * the first free spot of the screen it has just arrived at, which has nothing
     * to do with where the hand is. From `home` the same finger is in the same
     * place on every screen, which is what makes a push mean one thing however
     * many screens it crosses.
     */
    home: { x: number; y: number };
    /**
     * The screen this carry is heading for, told by the turns and not by React.
     *
     * The turns are what moved the card, so the turns are what know where it is
     * going. Read back from state when the finger lifts, the write lands on the screen
     * *before* the last one whenever a turn and the release land close together — a
     * carry that turns the page bar and puts the card somewhere else, which looks
     * perfect and arranges the wrong thing.
     */
    pagina: number;
  } | null>(null);
  /** The card being carried, in state, because the card has to *see* it. */
  const [carried, setCarried] = useState<string | null>(null);
  /**
   * The push, measured from where the hand was the last time the panel turned.
   *
   * Not from where the finger went down. Every turn spends the push: the mark is
   * measured from the turn, not from the touch, so carrying across three screens
   * is three pushes and not one long one — and it is what makes a held finger stop
   * turning pages. Without it, a hand that ends a carry at the edge of the panel
   * is past the mark forever, the turn re-arms on every move, and the panel walks
   * to the last screen by itself.
   */
  const pushBase = useRef(0);
  /**
  /** The turn that is waiting out its hold, and the side it is waiting for. */
  const turnTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * How far the screen has been pushed sideways, while a finger is on it.
   *
   * A shared value and not state, because it changes on every frame of a swipe
   * and state would re-render the whole panel sixty times a second to move
   * something by a few pixels. Read only in an animated style, so nothing else
   * in the panel has to care.
   */
  /**
   * Where the track is, in points, and where the gesture that is touching it
   * found it.
   *
   * A *position* and not a displacement, and that distinction is the whole of a
   * pager. While a finger is down the finger says "this far from where we were",
   * so the origin is remembered and the two are added; when the finger lets go the
   * track is given the position it is going to. One number for where the track is,
   * so there is nothing that can be added up twice.
   *
   * It was a displacement, and the resting place was added to it in the style —
   * which is right while a finger is down and wrong the instant the page changes,
   * because the resting place moves with the page and the displacement does not.
   * The panel counted the page twice and overshot it by one: a swipe from the
   * first screen landed on the third.
   */
  const trackX = useSharedValue(0);
  const origin = useSharedValue(0);

  /**
   * Whether a finger is on the track right now.
   *
   * The rubber band is a thing a *finger* meets, so it is applied only while there
   * is one. It used to be applied whenever the track sat outside the room it had,
   * and that is wrong in a way that only shows after a page turn: `origin` is
   * where the gesture found the track, and `settle` then animates `trackX` away
   * from it, so at rest `trackX - origin` is not zero but the width of a whole
   * page. The style read that as "past the end", divided it by
   * `EDGE_RESISTANCE`, and left the panel a third of a page short of where the
   * page indicator said it was — a swipe from the first screen to the second
   * ended 105px out, and one back ended 253px out, with the dots saying page one
   * and the cards sitting halfway to page two.
   *
   * A number that is only wrong between gestures is the hardest kind to catch:
   * the page indicator, the cards and the next swipe all agree with each other
   * and disagree with the truth, and the next swipe is answered from `origin`,
   * which the finger resets on the way down. So the panel is right again the
   * moment it is touched, and wrong the whole time anybody is looking at it.
   */
  const fingerDown = useSharedValue(false);

  /**
   * Whether the gesture that is finishing has already decided where the track goes.
   *
   * A `Pan` calls `onEnd` and then `onFinalize`, in that order, every time. Both
   * used to animate the track, and they disagreed: the first asked for the next
   * page and the second parked it on the old one, so the page indicator and the
   * screen on display ended up saying different things. One of them has to know
   * the other has been here.
   */
  const settled = useSharedValue(false);

  const setEditing = onEditingChange;

  /**
   * The cell the card is over, readable from a callback that must not re-run.
   *
   * A ref and not the state, for the same reason as `draftRef` above: a callback
   * that closes over state re-runs whenever the state changes, and this one is
   * called by a gesture that is already in flight. A ref is read at the moment it
   * is used, which is the moment the finger is at.
   */
  /** Where the hand was at the last turn, so "moved again" has a reference. */
  const giroEn = useRef(0);
  const dropRef = useRef<{ x: number; y: number } | null>(null);
  dropRef.current = drop;

  /**
   * The last layout this grid adopted or wrote, so a change from *outside* can be
   * told from the echo of one of its own.
   *
   * The picker is outside: it writes the saved layout directly, through the
   * screen above, and the grid has no way of knowing. Comparing by identity is
   * enough because the echo of our own write comes back as the same array we
   * handed over, and a write from the picker comes back as an array this grid has
   * never seen.
   */
  const adopted = useRef(layout);

  // Arranging starts from what is saved, so leaving without saving throws the
  // experiment away instead of leaving a panel nobody meant to change.
  //
  // And while arranging, a layout that changed *underneath* is adopted rather than
  // ignored. It used to be ignored for as long as the mode was on, and the picker
  // is why that cost something real: it removes a card from the saved layout, the
  // grid keeps its own draft, `finish` writes the draft, and the card is back —
  // so unpicking something in the sheet and pressing Guardar did nothing at all,
  // silently, which is the worst way for a write to fail.
  //
  // A drag in flight is the one thing that outranks it: the card under the finger
  // is the truth, and the write is made again on the way out, so a layout that
  // lands mid-drag waits rather than pulling the panel out from under the hand.
  useEffect(() => {
    if (!editing) {
      setDraft(layout);
      adopted.current = layout;
      return;
    }
    if (adopted.current !== layout && dragging === null) {
      setDraft(layout);
      adopted.current = layout;
    }
  }, [dragging, editing, layout]);

  // A card on a screen that no longer exists is a card on a screen you cannot get
  // to, so the page shown is always clamped to what there is.
  /**
   * How many screens there are, from the **draft** and not from the prop.
   *
   * It read the prop, and the prop only changes when the arrangement is saved —
   * so adding a screen while arranging changed nothing at all: the bar did not
   * appear, the dots did not, and the button looked like it had done nothing. The
   * number a person is looking at has to be the number they are editing.
   */
  const screens = useMemo(() => pageCount(draft, pagesDraft), [draft, pagesDraft]);
  const current = Math.min(page, screens - 1);
  useEffect(() => {
    if (current !== page) setPage(current);
  }, [current, page]);

  /**
   * The same two numbers, readable from a callback a gesture is holding.
   *
   * The carry reads them from a timeout and the drag reads them from a frame, and
   * neither can close over a value that is one render behind — a turn that
   * measured the screens of the panel before the card was picked up has no screen
   * to go to. Assigned during render, like every other ref here, which is the
   * moment there is one version worth reading.
   */
  const screensRef = useRef(screens);
  screensRef.current = screens;

  /**
   * Told upwards which screen this is, and only when it changes.
   *
   * The screen needs it to pin a card where somebody is standing, and the panel
   * is the only thing that knows — a screen it does not draw is a page number it
   * could only guess at. The guard is the point: a callback that fires on every
   * render is a `setState` on the parent on every render, and a panel that
   * re-renders the screen it lives in is a panel that never settles.
   */
  useEffect(() => {
    onPageChange?.(current);
  }, [current, onPageChange]);

  const gap = theme.spacing.sm;

  /**
   * The space the board gets, in points, measured rather than worked out.
   *
   * This is what makes a card a *fraction* of the screen. The board takes the
   * height that is left under the header, `panelCell` divides that height between
   * six rows, and a card of one row is a sixth of the screen, three rows is half
   * of it, four is two thirds. Nothing here is a fixed number of points, so a card
   * is the same *proportion* of a phone and of a laptop — and because six rows of
   * the cell add up to exactly the board, the panel fills the screen and has
   * nothing to scroll to.
   *
   * The width starts at zero and the height starts at a guess taken from the
   * window, because `panelCell` divides: a board of no height would make every
   * card zero tall for the frame before the measurement arrives, which is a flash
   * of an empty panel every time the screen opens.
   */
  const window = useWindowDimensions();
  const [board, setBoard] = useState({
    width: 0,
    height: Math.round(window.height * 0.72),
  });

  const cell = useMemo(() => panelCell(board, gap), [board, gap]);

  /**
   * The cards of the screen being looked at, plus the one being carried.
   *
   * The carried card goes in **first** and on the screen being looked at, whatever
   * page its own widget still says, and both of those are the whole point of this
   * line:
   *
   *  - first, because the placement gives a card the place it asks for and moves
   *    the others. A card that arrives last is told to fit round what is already
   *    there, which is the opposite: it is the card in the hand and the screen it
   *    is arriving at is what gives way.
   *  - and on the screen being looked at because the draft has not changed yet. A
   *    carry is not written until the finger lifts, and the drawing is of the
   *    draft.
   */
  const onPage = useMemo(() => {
    const suyas = draft.filter((widget) => pageOf(widget) === current);
    if (!carried) return suyas;
    const enEsta = suyas.some((widget) => widget.id === carried);
    if (enEsta) return suyas;
    const enLaMano = draft.find((widget) => widget.id === carried);
    if (!enLaMano) return suyas;
    // At the cell the hand is over and not at the one it is stored in: that stored
    // cell belongs to the screen it came from, and putting it there would put the
    // card on top of whatever is on that cell of the screen it is arriving at.
    return [
      drop ? { ...enLaMano, page: current, x: drop.x, y: drop.y } : { ...enLaMano, page: current },
      ...suyas,
    ];
  }, [carried, current, draft, drop]);
  const placed = useMemo(() => pageCards(onPage), [onPage]);

  /*
    The cards as they are drawn right now, through a ref.

    `pickUp` needs to know which cell the card it is lifting is in, and reading it
    from `placed` made the callback change identity on **every** render — `placed`
    is a new object every time — and a callback that changes identity changes the
    identity of the gesture that closes over it. That gesture is then rebuilt while
    the finger is still down and the hold is halfway through, and a handler detached
    and re-attached mid-gesture is a gesture that gets lost: the card lifts, and
    then nothing else ever arrives. No movement, no drop, no write, and a panel that
    looks like it ignored the finger.
  */
  const placedRef = useRef(placed.cards);
  placedRef.current = placed.cards;
  const hidden = placed.hidden.filter((id) => id !== carried);

  /**
   * The screens either side of this one, and what is on them.
   *
   * The neighbours and not only the one being looked at, because a swipe has to
   * have something to swipe *to*. The track is as wide as every screen side by
   * side and a card's placement is a position on that track, so the screen being
   * turned to is painted next to this one the whole time and comes in from the
   * side the finger is going. Before this there was one screen and a translation:
   * the cards slid away, the next screen appeared under them already in place, and
   * every swipe looked the same however it was made — the one thing a pager must
   * not do.
   *
   * Only the immediate neighbours, and never more than the screens that exist, so
   * a panel of six screens draws two and a panel of one draws one.
   */
  const neighbours = useMemo(() => {
    const take = (index: number) =>
      index >= 0 && index < screens
        ? {
            index,
            drawn: draft.filter((widget) => pageOf(widget) === index),
          }
        : null;
    return {
      before: take(current - 1),
      after: take(current + 1),
    };
  }, [current, draft, screens]);


  // The two things "done" needs: which screen is being looked at, and what did
  // not fit on it. Read at the moment the button is pressed, which is the only
  // moment they matter — a ref assigned during render, so the callback that saves
  // does not have to be rebuilt every time either of them changes.
  const currentRef = useRef(0);
  currentRef.current = current;

  /*
    The screen being looked at, unclamped, and `current` is not that.

    `current` is `page` trimmed to the number of screens, which is right for drawing —
    a page that does not exist is a page you cannot see — and wrong for writing. The
    two go out of step exactly during a carry: the turn asks for the next screen, the
    screen count is computed from the draft and the draft still says the card is on the
    screen it came from, so the count can be a turn behind the page bar. And then the
    card is written to the screen **before** the one it was carried to, which is a
    carry that moves the page bar and puts the card somewhere else: the gesture looked
    perfect and the arrangement was on the wrong screen.
  */
  const pageRef = useRef(0);
  pageRef.current = page;
  const hiddenRef = useRef<string[]>([]);
  hiddenRef.current = hidden;

  /**
   * The layout as it is *drawn*, which is not always the layout as it is stored.
   *
   * A card that does not fit on this screen is drawn on the next one while the
   * panel is being looked at, and only lands there for real when Guardar is
   * pressed. Without that, pinning a card onto a full screen would move every
   * card below it the moment it was pinned, and a panel that rearranges itself
   * under a finger that is dragging a card in it is a panel nobody can drag in.
   */
  const spilled = useMemo(
    () => (hidden.length === 0 ? draft : spillToNextPage(draft, current, hidden)),
    [current, draft, hidden],
  );
  const drawn = useMemo(
    () => spilled.filter((widget) => pageOf(widget) === current),
    [current, spilled],
  );

  /**
   * How wide and how tall the track is.
   *
   * One width per screen, every screen side by side, and the tallest screen sets
   * the height for all of them. The height has to be shared: a screen of two cards
   * is shorter than a screen of six, and if the track took the height of whichever
   * screen happened to be nearest, the cards on the shorter one would be measured
   * against a board that changed as it slid, and every card would change size on
   * the way past. The board's own height is the floor, which is what keeps the
   * promise that the panel does not scroll.
   */
  const gridHeight = useMemo(() => {
    const tallest = [current, neighbours.before?.index, neighbours.after?.index]
      .filter((index): index is number => index !== undefined)
      .reduce((most, index) => {
        const cards = index === current
          ? placed.cards
          : pageCards(draft.filter((widget) => pageOf(widget) === index)).cards;
        return Math.max(most, panelHeightInPixels(cards, cell));
      }, 0);
    return Math.max(tallest, board.height);
  }, [board.height, cell, current, draft, neighbours, placed.cards]);

  const commit = useCallback(
    (next: DashboardWidget[]) => {
      setDraft(next);
      // Our own write, recorded so the effect above does not come back and adopt
      // it as if the picker had sent it.
      adopted.current = next;
      onChange(next, pagesDraftRef.current);
    },
    [onChange],
  );

  /**
   * The resize.
   *
   * It writes the draft but not the store, and the difference is the point: a
   * corner drag fires an update per frame and a write per frame is one operation
   * per frame in the outbox, syncing nothing. So the size follows the finger and
   * the neighbours move with it, and one write happens when the finger lifts.
   */
  /**
   * The draft as it is right now, readable from a callback that must not re-run.
   *
   * The corner drag needs the size the finger is at *and* the layout it is being
   * applied to, and the layout is state — and a callback that closes over state
   * re-runs on every change, which recreates the gesture the finger is holding.
   * So the latest draft is kept in a ref and read from there.
   */
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const resize = useCallback(
    (id: string, size: { w: number; h: number } | null) => {
      if (size) {
        // Still dragging: the size follows the finger and the neighbours move
        // with it. Nothing is written, because a write per frame is one
        // operation per frame in the outbox and syncs nothing.
        setDraft((current) => resizeCard(current, id, size));
        return;
      }
      // The finger lifted. Whatever the last size that fitted was is now the
      // layout, and a size that was refused has already been dropped by
      // `resizeCard`, so there is nothing to put back.
      commit(draftRef.current);
    },
    [commit],
  );

  /** Where the card being dragged is, in cells, so that its centre can be followed. */
  const held = useRef<PlacedCard | null>(null);
  held.current = dragging
    ? (placed.cards.find((card) => card.id === dragging) ?? null)
    : null;

  /**
   * Where every card will be if the finger lifted right now.
   *
   * This is the thing that makes a drag feel like a drag. The dragged card
   * follows the finger on its own, and the *others* have to make room as it goes
   * past them — if they only move once you let go, the drop is a guess, and a
   * grid you cannot watch rearrange under your hand is a grid that feels broken
   * however correct the result is.
   *
   * The dragged card is placed **first, at the cell it is over**, and the rest
   * keep their own stored positions and only go to the nearest free cell when
   * those are taken. That is the whole difference between this and the version
   * that felt wrong: the neighbours move as little as they can, one cell at a
   * time, and the gap opens where the finger is instead of everybody leaping
   * aside to make room for a hole that was never really there.
   */
  const preview = useMemo(() => {
    if (!dragging || drop === null) return null;
    const widget = onPage.find((row) => row.id === dragging);
    if (!widget) return null;
    const size = cardSize(widget);

    const packed = placeCards(
      [
        { id: dragging, w: size.w, h: size.h, x: drop.x, y: drop.y },
        ...onPage
          .filter((row) => row.id !== dragging)
          .map((row) => ({ id: row.id, w: row.w, h: row.h, x: row.x, y: row.y })),
      ],
      PANEL_COLUMNS,
      PANEL_ROWS,
      dragging,
    );
    return new Map(packed.map((card) => [card.id, card]));
  }, [dragging, drop, onPage]);

  /* ------------------------------------------------------------- carrying a card -- */

  /**
   * Where the panel puts the track when it turns a screen on purpose.
   *
   * A swipe moves the track itself and only has to tell React which screen it
   * landed on; this is the other direction, where nothing has touched the track
   * and the track has to be sent there before the cards can be seen arriving.
   *
   * Which is what the dots were not doing. They called `setPage` and nothing else,
   * so the panel drew the cards of the screen that had been asked for at the place
   * of the screen the track was parked on — a dot that moved the page bar and left
   * the panel showing the previous one, which is the same panel three disagreeing
   * views: the dots, the cards and the next swipe.
   *
   * With the same easing and the same `PAGE_MIN` as a swipe that had only just
   * begun, because that is how long the last of it takes to arrive.
   */
  const goTo = useCallback(
    (wanted: number, hasta = screensRef.current) => {
      const target = Math.min(Math.max(wanted, 0), hasta - 1);
      const resting = -target * board.width;
      origin.value = resting;
      trackX.value = withTiming(resting, {
        duration: PAGE_MIN,
        easing: Easing.out(Easing.cubic),
      });
      setPage(target);
    },
    [board.width],
  );

  /**
   * One more screen, and go to it.
   *
   * Going to it is not a convenience: a screen added and not looked at is a dot at
   * the end of the bar that nobody can tell from the ones with cards on them, so
   * the bar would be showing a screen and the panel would not.
   */
  const addPage = useCallback(() => {
    if (!editing) return pagesDraft;
    const siguiente = Math.min(pagesDraft + 1, MAX_PAGES);
    if (siguiente === pagesDraft) return pagesDraft;
    setPagesDraft(siguiente);
    /*
      `goTo` y no `setPage`, y el motivo es el mismo que el de los puntos.

      La pantalla se acaba de crear, así que todavía no está en `screens` y
      `goTo` la recortaría a la última que ya existía —justo la de la que se ha
      salido— y la pista no se movería. El segundo argumento es el tope con el que
      sí existe la pantalla nueva: la cuenta que se acaba de escribir, no la que el
      ref tenga todavía.

      Con `setPage` la barra de puntos iba a la pantalla nueva y el panel se quedaba
      donde estaba: el punto, las tarjetas y el siguiente swipe, tres vistas que ya
      no contaban lo mismo. Y la tarjeta que se estaba llevando se quedaba a medio
      camino, dibujada en una pantalla que nadie estaba mirando.
    */
    goTo(siguiente - 1, siguiente);
    // Told upwards straight away, not held until the arrangement is finished.
    //
    // A screen that exists only in the draft is a screen that is gone the moment
    // the panel is left without the Guardar button — which is what "no persists"
    // meant: the dot was there, the arrow was there, and after a restart neither
    // was. The write goes through the outbox like every other, so it is the same
    // cost and the same wait, and it carries the current draft rather than the
    // saved layout so a card moved in the same session is not undone by it.
    onAddPage?.(siguiente, draftRef.current);
    return siguiente;
  }, [draftRef, editing, goTo, onAddPage, pagesDraft]);

  /**
   * Start arranging, from a hold on the background.
   *
   * A function and not the setter itself because the gesture runs on the interface
   * thread and a `setState` called from there is a render nobody asked for. And a
   * callback and not a ref because a ref read from a worklet is a copy of the object
   * as it was when the worklet was made, which is one render behind.
   */
  const entrarEnColocacion = useCallback(() => setEditing(true), [setEditing]);

  /**
   * Finish arranging, from a tap on the background.
   *
   * Through the ref the screen above owns, so the draft it saves is the one this
   * component is drawing — the same path the Guardar button in the header takes, and
   * for the same reason: two ways out of the arrangement have to write the same
   * arrangement.
   */

  const terminar = useCallback(() => finishRef.current(), []);

  /**
   * The card has been held still long enough to be picked up.
   *
   * It is lifted and nothing else: no cell moves, nothing is written, and the
   * panel has not changed. A pick-up that already decided where the card was going
   * would be a drag that happened to be slow, and the difference between the two is
   * the whole of the gesture — one places a card on this screen and the other puts
   * it in a hand that can go to another one.
   *
   * And it happens on a panel of one screen as much as on a panel of eight. It used
   * to ask first whether there was another screen to carry to, and that was the wrong
   * question: it made the hold — and with it every way of moving a card with a finger
   * — unavailable on the panel most people have. Where it may be dropped is a question
   * for the drop.
   */
  const pickUp = useCallback((id: string) => {

    const enEsta = placedRef.current.find((card) => card.id === id);
    carry.current = {
      id,
      from: draftRef.current,
      home: enEsta ? { x: enEsta.x, y: enEsta.y } : { x: 0, y: 0 },
      // The screen this carry is heading for, and it is the **gesture's** answer and
      // not React's: the turns are what moved the card, so the turns are what say
      // where it is going. Read back from state at the moment the finger lifts, the
      // write lands on the screen before the last one whenever a turn and the release
      // land close together — a carry that turns the page bar and puts the card
      // somewhere else, which looks perfect and arranges the wrong thing.
      pagina: (draftRef.current.find((w) => w.id === id)?.page ?? 0),
    };
    pushBase.current = 0;
    giroEn.current = 0;
    setCarried(id);
    setDragging(id);
  }, []);

  /**
   * A turn that is waiting out its hold, called off.
   *
   * Called on every release and every time the push comes back inside the mark. A
   * timer that outlived either of those would turn a screen with nobody's finger on
   * it, which is the one thing a pager must never do on its own.
   */
  const cancelTurn = useCallback(() => {
    if (turnTimer.current !== null) {
      clearTimeout(turnTimer.current);
      turnTimer.current = null;
    }
  }, []);

  /**
   * The screen turns, with the card still in the hand.
   *
   * And **the card does not change page here**, which is the whole of how this
   * survives its own gesture. The draft is what every screen is drawn from, so
   * moving the card's page moved it out of one `ScreenOfPanel` and into another
   * one — and a component that unmounts under a finger takes the gesture with it.
   * `onEnd` never arrived, so nothing was ever written: the card turned up on the
   * next screen, was drawn there, and was still on the old one as soon as the page
   * was reloaded. Every check of the gesture said it worked.
   *
   * So the card stays where its widget says it is, and the screen that holds it
   * draws it in the slot of the screen being looked at: a card that changes screen
   * would have to change component with it, and it does not change screen. It stays
   * where the tree put it and moves by the width of a screen, which is what
   * `pageOffset` is in `ScreenOfPanel`. Turning the screen moves the track under the
   * card and the card stays under the hand, which is also how it is done on a home
   * screen: the thing you are carrying is not on one of the pages yet.
   *
   * The write happens once, when the finger lifts, and `carryCard` works out where
   * the card has got to from the draft as it was at the pick-up.
   */
  const carriedTurn = useCallback(
    (id: string, dir: -1 | 1, dx: number, donde: { x: number; y: number }) => {
      turnTimer.current = null;
      pushBase.current = dx;
      giroEn.current = dx;

      /*
        And the card's cell on the **new** screen is where the next push is measured
        from.

        Without this a card could only ever travel one screen. The push is measured
        from the cell it was picked up on, and that cell was on the screen it came
        from, so the trip to the edge of the second screen was the trip to the edge of
        the first one plus a whole screen's width — and the finger, already at the
        side of the panel, had nowhere left to go. The panel turned once and then the
        gesture was spent: from page one to page three there was no way, which is a
        thing every phone has done since the first one had two screens.

        So after every turn the reference is the card's cell **here**, and the next
        push is a fresh journey from here — which is what it looks like, because the
        track has just moved and this is where the card now is under the hand.
      */
      const target = carryTarget(currentRef.current, dir, screensRef.current);
      if (!target) return;
      if (target.kind === "new") {
        /*
          Off the end of the panel and it makes the next screen.

          Which is what every mobile desktop does and what this panel could not do:
          the `+` next to the dots, and a drag that could only move a card to a
          screen that already existed. Arranging a panel of more than one screen was
          therefore four steps — stop dragging, press the `+`, drag again, drop —
          for the one thing the drag was already in the middle of. On a phone it is
          "drag it off the end", and now it is that here too.

          And it goes straight there, carrying the card, because a screen that
          appears somewhere other than under the thing you are holding is a screen
          that appears somewhere you are not looking.
        */
        // `addPage` answers how many there are now, so the screen the card is
        // arriving at is the last of them. Outside the `if`, because a screen that is
        // created only when somebody is carrying something is a screen that is not
        // created.
        const creada = addPage();
        if (carry.current) {
          carry.current.home = { x: donde.x, y: donde.y };
          carry.current.pagina = Math.max(0, creada - 1);
        }
        return;
      }
      // Asked before the turn, because a screen with no room is a screen the card
      // cannot be put on. See `carryFits`.
      if (!carryFits(draftRef.current, id, target.page)) return;
      if (carry.current) {
        carry.current.home = { x: donde.x, y: donde.y };
        carry.current.pagina = target.page;
      }
      goTo(target.page);
    },
    [addPage, goTo],
  );

  /**
   * The push of a card that is being carried, read once per move of the finger.
   *
   * Three things in order, and the order is the rule:
   *
   * Three things in order, and the order is the rule:
   *
   * 1. No direction, or not at the edge, or the hand has not moved since the last
   *    turn: nothing is armed and any turn waiting is called off.
   * 2. A turn is armed **once** — not re-armed on every frame — so a hand at the edge
   *    waits out one hold rather than a hold per frame.
   * 3. Armed, it turns after `CARRY_TURN_HOLD`, with the card still in the hand.
   */
  /*
    The margin in pixels, once the panel has been measured.

    `CARRY_EDGE_MARGIN` is a part of the panel's width so it grows with the panel, and
    this floor is for a panel narrower than a hundred and fifty points: without it the
    margin would be a handful of pixels and the outermost column would be a place you
    pass through rather than a place you can leave something.

    Here and not in `carryAtEdge` because it is the panel's width, and the panel
    measures itself after the first render: a margin computed at module scope would be
    a margin of a panel that does not exist yet.
  */
  const margenBorde = Math.max(CARRY_EDGE_MARGIN_MIN, board.width * CARRY_EDGE_MARGIN);

  const carriedMove = useCallback(
    (
      id: string,
      dx: number,
      donde: { x: number; y: number },
      size: { w: number; h: number },
    ) => {
      if (carry.current?.id !== id) return;
      const push = dx - pushBase.current;
      const dir = carryDirection(push, CARRY_SLOP);
      /*
        Where the **hand** is across the panel, and not where the card is — and
        measured with `push`, the travel since the last turn, not with `dx`, the
        travel since the finger went down.

        The card stops at the outermost column and stays there — `heldSpot` clamps it,
        because there is no cell past the edge — while the finger keeps going. Asking
        about the cell therefore asked the same question over and over once the card
        had arrived, and the screen turned while the card was still on its way to the
        side, which is why there was no way to leave anything flush against an edge.

        And with `dx` instead of `push` the second turn could never come: `pushBase`
        is re-based on every turn, so the turn resets one of the two numbers and not
        the other, and the measure kept saying "at the edge" for the rest of the
        gesture. A card got as far as page two and no further, and there was no gesture
        anybody could do about it.
      */
      const stepX = cell.width + cell.gap;
      const centre =
        carry.current.home.x * stepX + push + (size.w * stepX) / 2;
      // Two ways out, and both of them are the hand coming back from the edge: no
      // direction because it has stopped, and a direction but not far enough because
      // the card is somewhere that still belongs to this screen. That second one is
      // the whole of the latch: a hand held at the edge walks one page and not
      // fifteen, which is the behaviour on a phone too.
      const enElBorde = carryAtEdge(centre, board.width, dir, margenBorde);
      /*
        Two reasons to wait, and they are different things.

        The hand has to be **at the edge** — that is the margin, and it is what keeps
        a card in the outermost column from being able to leave. And after a turn the
        hand has to **move again** before it can ask for another one: a turn leaves the
        finger at the side of the panel with the card already against it, so "at the
        edge" on its own is true from the turn onwards and would turn page after page
        on its own. A hand that has not moved is not asking for anything.
      */
      const movido = Math.abs(dx - giroEn.current);
      if (dir === 0 || !enElBorde || movido < CARRY_TURN_NUDGE) {
        cancelTurn();
        return;
      }
      if (turnTimer.current !== null) return;
      turnTimer.current = setTimeout(
        () => carriedTurn(id, dir, dx, donde),
        CARRY_TURN_HOLD,
      );
    },
    [board.width, cancelTurn, carriedTurn, cell, margenBorde],
  );

  useEffect(() => {
    /*
      A turn that is waiting when the arrangement ends is a turn with nothing to
      carry. Not a leak — the timer would fire and find no card — but a panel that
      changes screen after the pencil is gone is a panel answering a gesture that was
      never finished.
    */
    if (!editing) {
      cancelTurn();
      carry.current = null;
    }
  }, [cancelTurn, editing]);

  /**
   * Where the card would land, as the finger moves.
   *
   * A state change per frame, and it is the one place in the panel that accepts
   * that cost: the answer has to be somewhere for the neighbours to move out of
   * the way, and that is what turns a drop into a decision rather than a guess.
   * What is *not* per frame is the layout — nothing is written until the finger
   * lifts.
   */
  const onDragMove = useCallback(
    (id: string, dx: number, dy: number) => {
      const card = held.current;
      if (!card) return;
      const stepX = cell.width + cell.gap;
      const stepY = cell.height + cell.gap;
      // A card that is being carried reads the same travel as a push towards
      // another screen. It still falls through to the cell below, because a card
      // that has been carried to a screen lands *somewhere on it*, and the place the
      // hand let go of it is the only opinion anybody has about where.
      const enLaMano = carry.current?.id === id ? carry.current : null;
      // And measured from the cell it was **picked up at**, not from the one it is
      // in now. The difference only shows once the panel has turned a screen, and it
      // shows as the card jumping: the turn moves the card to the first free cell of
      // the screen it arrives at, so a cell measured from there is a cell that has
      // nothing to do with where the hand is. From `home` the same finger is in the
      // same place on every screen, which is what makes the gesture mean one thing
      // however many screens it crosses.
      const desde = enLaMano?.home ?? { x: card.x, y: card.y };
      const destino = heldSpot(
        { w: card.w, h: card.h },
        {
          x: desde.x * stepX + dx + (card.w * stepX) / 2,
          y: desde.y * stepY + dy + (card.h * stepY) / 2,
        },
        cell,
      );
      setDrop(destino);
      if (enLaMano) carriedMove(id, dx, destino, { w: card.w, h: card.h });
    },
    [cell, carriedMove],
  );

  const onDragEnd = useCallback(
    (id: string) => {
      // Read from the ref, and not from the argument of a state updater.
      //
      // A `setState` updater runs *during* the render that applies it, so calling
      // `commit` — which sets state again — from inside one is a second state
      // change in the middle of somebody else's render. React says so out loud
      // ("Cannot update a component while rendering a different component") and
      // the write can be dropped. The value is the same either way; doing it this
      // way just does not make React shout about it.
      /*
        The drop is taken **and emptied** here, in one line, and that is not a
        tidy-up: a `Pan` calls `onEnd` and then `onFinalize`, so this runs twice for
        one release.

        Before the carry, running twice was harmless because both calls did the same
        thing to the same draft. A carry is not: the first call is the one that
        moves the card to another screen, and a second call that still had a drop
        cell and a draft from before the turn would take that card and put it back
        on the screen it came from — so the card arrived, was drawn on the next
        screen, and was then written back where it started. It looked perfect until
        the page was reloaded.

        So the second call finds nothing to do, which is the truth: the release has
        already been answered.
      */
      const landed = dropRef.current;
      dropRef.current = null;
      const enLaMano = carry.current;
      const lleva = enLaMano?.id === id;
      carry.current = null;
      cancelTurn();
      setCarried(null);
      setDragging(null);
      setDrop(null);

      if (lleva && enLaMano) {
        /*
          The write a carry owes, and the only one: the card goes to the screen it
          has been carried to and then to the cell the hand let go over it.

          Both worked out from the layout as it was when the card was picked up. The
          live draft cannot answer it — the carry never wrote to the draft, and the
          draft still says the card is on the screen it came from, which is the one
          number the whole gesture exists to change.

          And it returns the same array when the carry went nowhere, which is how
          this knows there is nothing to write: a hand that picked a card up and
          put it straight down has not arranged anything, and that should not put an
          operation in the outbox for somebody to sync.
        */
        /*
          The page the carry got to **and** the page the panel is on, and the one the
          panel is on wins when they disagree.

          They can disagree, and the way they disagree is the whole of this gesture: a
          turn moves the screen under the card without moving the card, so "which screen
          is the card on" is two questions at once — where the card is being taken and
          where the panel has got to. Asking only the first writes the card to the
          screen it was on before the last turn whenever the two have drifted, and the
          result looks like a carry that turned the page bar and put the card somewhere
          else. The panel is what the person is looking at, so that is what decides.
        */
        const destino = Math.max(enLaMano.pagina, pageRef.current);
        const next = carryCard(enLaMano.from, id, destino, landed);

        if (next !== enLaMano.from) commit(next);
        return;
      }

      if (landed === null) return;
      // Only this screen moves, and only the card that was held: the cards of the
      // other screens keep their place, so coming back to a screen finds it as it
      // was left rather than shuffled by a drag that happened two screens away.
      commit(moveCardTo(draftRef.current, id, landed));
    },
    [cancelTurn, commit],
  );

  const unpin = useCallback(
    (id: string) => commit(draft.filter((widget) => widget.id !== id)),
    [commit, draft],
  );


  /**
   * Ends the arrangement: writes what is on screen and stops editing.
   *
   * The button that does this lives in the header of the screen above, and the
   * draft it saves lives here. So the function is published through a ref the
   * parent owns and calls on tap.
   *
   * A ref and not a callback prop with the parent calling back in: a parent that
   * stored this in state and passed it down would be doing a `setState` in a
   * `useEffect` on every render, which is the "Cannot update a component while
   * rendering" warning all over again. A ref is written during render and read on
   * tap, which is what a ref is for.
   */

  const finish = useCallback(() => {
    // Whatever could not be shown here goes to the next screen for real, so a card
    // pinned on a full screen is somewhere and not nowhere.
    commit(spillToNextPage(draftRef.current, currentRef.current, hiddenRef.current));
    // And the carry ends with the arrangement: whatever the draft says is what is
    // written, so a card that was on its way to another screen stays there, and a
    // card that was only being carried to look at goes home.
    cancelTurn();
    carry.current = null;
    setCarried(null);
    setDragging(null);
    setDrop(null);
    setEditing(false);
  }, [cancelTurn, commit, setEditing]);

  useEffect(() => {
    finishRef.current = finish;
  });

  const arrange = useMemo(
    () => ({
      editing,
      dragging,
      carried,
      /*
        Only while arranging, and no more than that.

        It used to also ask whether there was another screen, which is where it went
        wrong: a panel of one screen answered no, the card never lifted, and moving a
        card to another cell — the thing this gesture exists for — stopped working on
        the panel most people have, for want of a second screen to move it to. Where
        the card may be dropped is a question for the drop, not for the lift.
      */
      canPickUp: editing,
      onPickUp: pickUp,
      onDragMove,
      onDragEnd,
    }),
    [
      carried,
      dragging,
      editing,
      onDragEnd,
      onDragMove,
      pickUp,
      screens,
    ],
  );

  /**
   * The sideways movement of the whole screen during a swipe.
   *
   * A *track*, not a single screen: the board is as wide as all its screens
   * side by side and this says how much of that is showing. That is the
   * difference between a panel you swipe and a panel that changes, and it is why
   * the next screen comes in from the side the finger is heading for instead of
   * appearing in place. Rubber-banded at the ends, so pulling on the first screen
   * drags it a third of the way and stops rather than letting a screen that does
   * not exist come into view.
   */
  const trackStyle = useAnimatedStyle(() => {
    // How far the finger has gone from where it found the track, and how far it
    // could go before there was no page left to show: going left there is
    // `current` screens of room and going right there are the rest.
    const travel = trackX.value - origin.value;
    const roomLeft = current * board.width;
    const roomRight = (screens - 1 - current) * board.width;
    // Past the end, only the part past the end is resisted, and by a third. Not
    // the whole travel: resisting the whole thing would make a legal swipe feel
    // heavy for its entire length, which is a different complaint from the one
    // this is fixing.
    //
    // And only while a finger is down. `settle` animates `trackX` away from
    // `origin`, so at rest the two sit a whole page apart and this would read a
    // correct resting place as a pull past the end of the panel and shrink it by
    // `EDGE_RESISTANCE` — which is how every page turn used to end with the cards
    // a third of a page from where the dots said they were. See `fingerDown`.
    let moved = travel;
    if (fingerDown.value) {
      if (travel > roomLeft) moved = roomLeft + (travel - roomLeft) / EDGE_RESISTANCE;
      if (travel < -roomRight) moved = -roomRight + (travel + roomRight) / EDGE_RESISTANCE;
    }
    return { width: board.width * screens, transform: [{ translateX: origin.value + moved }] };
  });

  const pistaAdd = useA11yHint(t("dashboard.addCardHint"));

  /*
    What the panel's plus can do, which is two things: a card, or a screen.

    It was one, so the plus went straight to the picker. That was right while it
    was one — a sheet with a single row in it is a tap that could have gone
    straight where it was going — and the moment there is a second thing, that
    same button has to choose. The rule that does it is `useAddMenu`: one option
    does the thing, two open a menu. So the panel went from one row to two
    without the button moving, changing shape, or gaining a twin somewhere else.
  */
  const opcionesAnadir = useMemo<AddMenuOption[]>(
    () => [
      {
        key: "cards",
        label: t("dashboard.addMenu.item"),
        description: t("dashboard.addMenu.itemHint"),
        icon: "apps-outline",
        onPress: onOpenEditor,
      },
      {
        key: "page",
        label: t("dashboard.addMenu.page"),
        description: t("dashboard.addMenu.pageHint"),
        icon: "albums-outline",
        onPress: addPage,
      },
    ],
    [addPage, onOpenEditor, t],
  );
  const { directo, abrir, cerrar, abierto, menu } = useAddMenu(opcionesAnadir);

  const turnPage = useCallback(
    (wanted: number) => setPage(Math.min(Math.max(wanted, 0), screens - 1)),
    [screens],
  );

  /**
   * Finishing a swipe, wherever the finger let go of it.
   *
   * The gesture stops the track under the finger and this hands it to an
   * animation that continues from *there* to the page it was going to. That is
   * the difference between a swipe and a button, and it has two parts.
   *
   * Which page it goes to: far enough, or fast enough, in the direction of the
   * travel — with the direction taken from the velocity when the finger was moving
   * at the end, because a flick that is still travelling when it is let go of is
   * the clearest statement of intent a hand can make, and from the distance when
   * it had already stopped, because then the distance is all there is.
   *
   * How long it takes: from the distance that is left, not a fixed number. See
   * `PAGE_SPEED` — a fixed duration makes a page that had nearly arrived crawl
   * and one that had barely started race past.
   *
   * And the page is set first, before the animation runs, because the track draws
   * the *neighbouring* screens as well as this one. The cards that are coming into
   * view have to already be on the track or there is nothing for the animation to
   * move, and the page state is what says which cards those are.
   */
  const settle = (from: number, velocity: number) => {
    'worklet';
    const roomLeft = from;
    const roomRight = screens - 1 - from;
    const travel = trackX.value - origin.value;
    const far = Math.abs(travel) > SWIPE_DISTANCE;
    const fast = Math.abs(velocity) > SWIPE_VELOCITY;
    // The finger's own direction decides, and the velocity only breaks the tie of
    // a finger that had already come back before it lifted.
    const forward = Math.abs(velocity) > 40 ? velocity < 0 : travel < 0;

    let target = from;
    if ((far || fast) && forward && roomRight > 0) target = from + 1;
    else if ((far || fast) && !forward && roomLeft > 0) target = from - 1;

    // Where it comes to rest, and how long the rest of the way should take: from
    // the distance still to travel, so a page that had nearly arrived does not
    // crawl and one that had barely started does not race.
    const resting = -target * board.width;
    const left = Math.abs(resting - trackX.value);
    trackX.value = withTiming(resting, {
      duration: Math.min(Math.max(left / PAGE_SPEED, PAGE_MIN), PAGE_MAX),
      easing: Easing.out(Easing.cubic),
    });
    return target;
  };

  /**
   * Turning the screen with a swipe.
   *
   * Horizontal, and it claims the gesture only once the finger has clearly gone
   * sideways: `activeOffsetX` is what stops a tap on a card from turning into half
   * a page turn, and `failOffsetY` is what lets a vertical drag through to the
   * scroll — without it the panel eats the scroll on a phone, which is a much
   * worse thing to break than a gesture that needs a moment.
   *
   * One gesture, built twice: once for the whole board and once for the board's
   * background, and only one of the two is ever enabled. It used to be a single
   * gesture wrapped around everything and switched off while arranging, on the
   * reasoning that a horizontal drag there is dragging a card. But the person
   * arranging a panel is the one most likely to want to see another screen, and
   * the reason it was switched off is not true: a drag that starts on a card never
   * reaches the background, because the card is on top of it. So the swipe comes
   * back for the background, and only for the background.
   */
  const buildTurn = (enabled: boolean) =>
    Gesture.Pan()
      .enabled(enabled)
      .activeOffsetX([-14, 14])
      .failOffsetY([-12, 12])
      .onStart(() => {
        // The gesture found the track here, wherever a page turn that is still
        // animating had left it. Without this a swipe that interrupts the
        // animation of the previous one measures from the page the finger is
        // looking at instead of from where the track actually is.
        //
        // `current` and not `currentRef.current`. A ref read from a worklet is a
        // copy of the object as it was when the worklet was made, and the copy is
        // one render behind: a swipe that began on the last screen measured from
        // the one before it, and the track came off the end of the panel. The
        // gesture is built on the JavaScript thread during render, so closing over
        // the number directly is both correct and one frame fresher.
        origin.value = -current * board.width;
        trackX.value = origin.value;
        settled.value = false;
        fingerDown.value = true;
      })
      .onUpdate((event) => {
        // The track goes with the finger, and the page it is showing comes with it
        // because the track holds every screen side by side. Not a nicety: a page
        // that appears only once the finger has let go makes the panel feel like it
        // decided on its own, and there is no way to stop halfway and change your
        // mind.
        trackX.value = origin.value + event.translationX;
      })
      .onEnd((event) => {
        // `onEnd` is followed by `onFinalize` every single time, so the two must
        // not both decide where the track ends up. It is this one that decides,
        // and `onFinalize` below knows it has.
        //
        // It used to be the other way round, and it was a bug that looked like
        // something else: `onFinalize` animated back to `currentRef`, which is the
        // page *before* this one, and this callback had already asked React for the
        // next one. So the page said two and the track was parked on one, and the
        // panel answered the next swipe from a screen that was not the one on
        // display.
        const target = settle(current, event.velocityX);
        settled.value = true;
        if (target !== current) runOnJS(turnPage)(target);
      })
      .onFinalize(() => {
        // The finger is off the track, so the band stops: whatever is still
        // moving is the animation finishing, and a band applied to that would
        // drag a correct resting place back towards where the finger let go.
        fingerDown.value = false;
        if (settled.value) {
          // `onEnd` already sent the track where it was going.
          settled.value = false;
          return;
        }
        // Cancelled, or the gesture lost to something else before it ever became
        // a swipe. Back to the page that is actually current, from wherever the
        // track happens to be.
        trackX.value = withTiming(-current * board.width, {
          duration: PAGE_MIN,
          easing: Easing.out(Easing.cubic),
        });
      });

  const turn = buildTurn(screens > 1 && !editing);

  /**
   * What a finger on the **background** of the panel can do, and it is three things.
   *
   * Holding it starts arranging, tapping it while arranging stops, and dragging it
   * sideways changes screen. All three are the desktop's, and they are here for the
   * same reason the pencil in the header is still here: everybody arrives at a home
   * screen knowing two of them, and a panel that only answers the third is a panel
   * where the gesture everybody already has does nothing at all.
   *
   * A **race**, and not three handlers, because they have to answer between them: a
   * swipe moves, a tap does not, and a hold does not move. Which one wins is the
   * whole question, and `Race` is that question asked once instead of in three
   * places.
   *
   * The one that is not here is a long press *on a card*, which is the pick-up.
   * That is not an omission but the shape of it: the card is not part of the
   * background, so the background's handler is never told about a finger that went
   * down on one. Holding a card picks the card up; holding the empty board beside
   * it starts arranging.
   */
  const fondo = Gesture.Race(
    Gesture.LongPress()
      .enabled(!editing)
      .minDuration(FONDO_ENTRA)
      .onStart(() => {
        runOnJS(entrarEnColocacion)();
      }),
    /*
      El toque, que termina la colocación.

      **Sin `maxDuration`.** Dentro de un `Race`, el gesto que llega a su plazo
      *falla*, y el que falla se lleva por delante la composición entera. Con un plazo
      de 400 ms el hold de 450 ms ya no tenía composición que ganar, y el gesto se
      quedaba muerto sin decir nada. Los dos se distinguen por cuánto dura el dedo,
      que es la pregunta que ya se estaban haciendo, así que el plazo no hace falta:
      el hold gana primero, el toque sólo llega si el dedo se levantó antes.

      Y ocho puntos, porque un toque que sobrevive a un dedo que ha viajado un poco
      es un toque que se dispara después de que alguien ha empezado a arrastrar y
      se ha arrepentido.
    */
    Gesture.Tap()
      .enabled(editing)
      .maxDistance(8)
      .onEnd(() => {
        runOnJS(terminar)();
      }),
    screens > 1 && editing ? buildTurn(true) : Gesture.Pan().enabled(false),
  );

  return (
    <View style={[styles.root, { gap: theme.spacing.sm }]}>
      {/*
        Where you are, always.

        It used to appear only while arranging, on the reasoning that it is part
        of the editing. It is not: a panel with three screens and nothing to say
        you are on the first of them is three panels, and the only hint that there
        is more is that a card is missing. The dots are the answer, and they are
        the same height in both modes so the panel does not jump when you start
        arranging it.
      */}
      {screens > 1 ? (
        <PageBar
          page={current}
          screens={screens}
          // And not a bare `setPage`: the dots and the arrows are the panel
          // turning a screen on purpose, which is the same thing a carry does and
          // the same thing a swipe finishes by doing. See `goTo`.
          onChange={goTo}
          canAddPage={editing && pagesDraft < MAX_PAGES}
          onAddPage={addPage}
        />
      ) : null}

      {/*
        The board: everything that is left under the header, measured.

        This is the whole of how the panel fills the screen. It is a sibling of
        the header with `flex: 1`, so it takes the space the header did not ask
        for, and `onLayout` says how much that was. Everything below — the cell,
        every card — is a fraction of that number, so there is nothing to scroll
        and the six rows are the screen.
      */}
      <View
        style={styles.board}
        onLayout={(event) => {
          const next = {
            width: event.nativeEvent.layout.width,
            height: event.nativeEvent.layout.height,
          };
          // Only when it really changed: a layout callback that sets state on
          // every call re-renders the screen forever, and on a panel that is
          // measured against its own content that is a loop.
          setBoard((current) =>
            current.width === next.width && current.height === next.height
              ? current
              : next,
          );
        }}
      >
        {/*
          The track is always mounted, and that is not a style choice: it is what
          owns the swipe. It used to be drawn *instead of* the panel whenever the
          screen being looked at had nothing on it — the empty page said so with a
          block of its own — so on an empty screen there was no pager at all. The
          dots still worked, which is why it read as a panel that had decided to
          have one screen: a swipe across an empty screen did nothing, and the only
          way off it was to aim at a dot the size of a grain of rice.

          And the empty page is exactly when the swipe matters most. It is the
          screen somebody arrives at to put something on, and the screen they leave
          from having realised there is nothing to put there.
        */}
        <GestureDetector gesture={turn}>
          {/*
            An `Animated.View` and not a `View`, which is not a detail: an animated
            style on a plain view is quietly ignored, so the swipe would have turned
            the page with no movement under the finger — working, and feeling like
            the panel had changed its mind on its own. TypeScript said as much, which
            is the good kind of saying.
          */}
          <Animated.View
            testID="panel-grid"
            style={[styles.track, trackStyle, { height: gridHeight }]}
          >
            {/*
              The background, and the only thing under the finger while the panel is
              being arranged.

              It is the first child so that every card is painted over it, and a card
              is a card: a drag that begins on one never arrives here, which is what
              lets `fondo` be three gestures and not one that has to guess.

              A sibling of the screens and not their parent, and that is also what
              keeps holding a card from starting the arrangement: the background is
              behind the cards rather than above them, so a finger that went down on
              one never tells it anything. Hold a card and the card is picked up;
              hold the empty board beside it and the panel starts to be arranged.
            */}
            <GestureDetector gesture={fondo}>
              <View testID="panel-background" style={StyleSheet.absoluteFill} />
            </GestureDetector>

            {/*
              Every screen that can be seen, each one at its own place on the track.
              The one being looked at is in the middle of what is mounted, its
              neighbours to either side, so a swipe has the next screen to bring in
              and does not have to invent it at the end.

              A screen that is not the current one is drawn plainly and is not
              arranged: it is either arriving or leaving, and a card under a finger on
              a screen nobody is arranging is not a card anybody can be holding.
            */}
            {[neighbours.before, { index: current, drawn }, neighbours.after]
              .filter((screen): screen is { index: number; drawn: DashboardWidget[] } => screen !== null)
              .map((screen) => (
                <ScreenOfPanel
                  key={screen.index}
                  offset={screen.index * board.width}
                  width={board.width}
                  height={gridHeight}
                  live={screen.index === current}
                  cell={cell}
                  widgets={screen.drawn}
                  preview={screen.index === current ? preview : undefined}
                  dragging={dragging}
                  carried={carried}
                  drop={drop}
                  current={current}
                  arrange={arrange}
                  describe={describe}
                  colorKeyOf={colorKeyOf}
                  washOf={washOf}
                  colorToOf={colorToOf}
                  whereOf={whereOf}
                  onOpen={onOpen}
                  onResize={resize}
                  onUnpin={unpin}
              />
            ))}
          </Animated.View>
        </GestureDetector>

        {/*
          The empty page says it is empty — **over** the track and not instead of it.

          **Nothing but the message, always** — and that is a change, not a
          formatting one. A page with nothing on it used to draw four dashed
          rectangles the size of cards while it was being arranged: an empty panel
          that looked like a panel waiting to be filled, said in the shape things
          will be.

          It read as four placeholders that were not cards. They could not be moved,
          they were not cards, they were on every empty page — the one you had just
          added, and the one you had just emptied by taking the last card off it —
          and a person arranging their panel is looking at their cards. Empty now
          says it is empty, which is a state somebody is in rather than a thing that
          failed to load, and it is the same whether the panel is being arranged or
          not.

          And `pointerEvents="none"`, which is the other half of it: an empty page
          that says so with a box that eats touches is an empty page you cannot
          swipe away from, which is the bug this whole block was moved out for.
        */}
        {drawn.length === 0 ? (
          <View style={styles.vacio} pointerEvents="none">
            <EmptyPage label={t("dashboard.pageEmpty")} />
          </View>
        ) : null}

        {editing && hidden.length > 0 ? (
          <AppText variant="caption" tone="subtle">
            {t("dashboard.movedToNext", { count: hidden.length })}
          </AppText>
        ) : null}

        {/*
          The one button that adds something, in the corner the thumb reaches,
          and only while the panel is being arranged.

          It was a panel-filling dashed block with a line of text under it, which
          pushed the cards up to make room for itself and said "there are six
          things left to add" to somebody who was trying to move a card. The app
          already has this button, in this corner, on every screen that creates
          something — so this is that one, and a second button in a different
          place doing a different thing is how you end up looking for the other
          one.

          And only while arranging: outside the mode there is nothing to add to,
          because everything can already be reached by tapping what is on it.
        */}
        {editing && availableCount > 0 ? (
          <>
            <View style={styles.fabSlot} pointerEvents="box-none">
              <FloatingButton {...pistaAdd.props} onPress={directo ?? abrir} />
            </View>
            {pistaAdd.node}
            <AddMenu
              visible={abierto}
              onClose={cerrar}
              title={t("dashboard.addMenu.title")}
              subtitle={t("dashboard.addMenu.subtitle")}
              options={menu ?? []}
            />
          </>
        ) : null}
      </View>
    </View>
  );
}

/**
 * The layout with the cards that did not fit moved to the next screen.
 *
 * Drawn, not stored, and the difference is the whole reason this is a function
 * rather than a change in the commit: what the panel shows has to be the panel
 * plus a fallback, and the fallback has to be reversible the moment there is room
 * again. Doing it on write would make a resize that is refused on one screen
 * permanently move cards to another one.
 */
function spillToNextPage(
  layout: DashboardWidget[],
  page: number,
  hidden: string[],
): DashboardWidget[] {
  if (hidden.length === 0) return layout;
  const ids = new Set(hidden);
  return layout.map((widget) =>
    ids.has(widget.id) && pageOf(widget) === page
      ? { ...widget, page: Math.min(page + 1, MAX_PAGES - 1) }
      : widget,
  );
}

/**
 * One screen of the panel, at its own place on the track.
 *
 * Absolute and placed by hand rather than in a flex row, because the card inside
 * is already absolutely positioned in cells and a screen that is a flex child
 * would be a flex child whose width depends on its contents. The track is
 * `board.width` per screen and every screen claims exactly one of those slots, so
 * the arithmetic of "which page is showing" is one multiplication.
 *
 * `live` is the screen being looked at, and it is the only one that is arranged:
 * a card being dragged or resized on a screen that is arriving would be a gesture
 * on a card that is not there yet. The screen that is not live gets its own
 * context with the arranging switched off, which is what keeps the resize corners
 * and the unpin buttons of the *next* screen out of the page: they are off screen
 * so nobody can press them, but they are in the document, and a screen reader
 * reads a button it cannot see as a button anybody can press.
 */
function ScreenOfPanel({
  offset,
  width,
  height,
  live,
  cell,
  widgets,
  preview,
  dragging,
  carried,
  drop,
  current,
  arrange,
  describe,
  colorKeyOf,
  washOf,
  colorToOf,
  whereOf,
  onOpen,
  onResize,
  onUnpin,
}: {
  offset: number;
  width: number;
  height: number;
  live: boolean;
  cell: { width: number; height: number; gap: number };
  widgets: DashboardWidget[];
  preview?: Map<string, PlacedCard> | null;
  dragging: string | null;
  /** The card in the person's hand, if it is on **this** screen. */
  carried: string | null;
  /** The cell the hand is over it. */
  drop: { x: number; y: number } | null;
  /** Which screen the panel is looking at, for the card in the hand. */
  current: number;
  arrange: PanelArrangeValue;
  describe: PanelGridProps["describe"];
  colorKeyOf: PanelGridProps["colorKeyOf"];
  washOf: PanelGridProps["washOf"];
  colorToOf: PanelGridProps["colorToOf"];
  whereOf: PanelGridProps["whereOf"];
  onOpen: (href: string) => void;
  onResize: (id: string, size: { w: number; h: number } | null) => void;
  onUnpin: (id: string) => void;
}) {
  const placed = useMemo(() => pageCards(widgets), [widgets]);
  /**
   * Whether this screen is arranged, which is not the same question as whether it
   * is the one on display.
   *
   * A screen that holds the card in the hand is arranged even after the panel has
   * turned and it is not the screen being looked at. It used to be handed
   * `AT_REST` the moment that happened, and the card under the finger lost its
   * gestures with it: a `Pan` that is disabled mid-gesture never ends, so the
   * release had nowhere to arrive and the carry was never written. The card
   * crossed the screen, was drawn on the other side, and was still on this one
   * after a reload.
   */
  const context = useMemo(() => (live || carried ? arrange : AT_REST), [carried, live, arrange]);

  return (
    <PanelArrangeContext.Provider value={context}>
      <View
        testID={`panel-screen-${offset}`}
        /*
          `box-none`, and this is what makes the swipe work while the panel is
          being arranged.

          A screen is a full-page box, so with the default `auto` it is a touch
          target everywhere, including the empty board between the cards — and the
          background that owns the swipe is painted *underneath* it, being the
          first child of the track. So the screen took every touch on the panel
          and the background gesture never fired once: a swipe across the free
          board moved nothing at all, and the only way to change page while
          arranging was the dots. The card drag kept working, which is exactly
          what made it read as the swipe being switched off on purpose rather
          than as a layer in the wrong order.

          `box-none` is the shape the arrangement actually has: the screen is not
          a thing you touch, it is the space the cards are in, and a touch in the
          gaps between them belongs to the board. The cards are children, so they
          keep their touches — the drag, the resize corner and the tap that opens
          the list all still land on the card under the finger, and only the
          emptiness falls through to the background underneath.
        */
        pointerEvents="box-none"
        style={[styles.screen, { left: offset, width, height }]}
      >
      {placed.cards.map((card) => {
        const widget = widgets.find((row) => row.id === card.id);
        if (!widget) return null;
        const info = describe(widget);
        // While a drag is in flight the *other* cards are placed as if the drop
        // had already happened. The dragged one keeps its own place, because the
        // finger is deciding where it is.
        const target = preview?.get(widget.id) ?? card;

        /*
          The card in the hand is drawn in the slot of the screen being looked at,
          from the screen that has it stored.

          Both halves matter, and the reason is that it may not be moved. A card
          drawn as the other screen's child is a different component, and swapping
          the one under the finger half way through a gesture is what killed this
          once already: the element the touch started on goes away and the touch
          stops belonging to anybody. So the card stays exactly where it is in the
          tree, and only its position changes — by the width of a screen, which is
          what this offset is.

          And it animates over the same `PAGE_MIN` the track does, in the same
          easing. That is not decoration: the track's translation and this offset
          cancel each other out exactly while both are moving, so the card stays
          under the hand while the panel slides underneath it. Snap the offset and
          the card jumps a whole screen to the right and comes back.
        */
        const enLaMano = carried === widget.id && drop !== null;
        const donde = enLaMano ? { ...drop, w: target.w, h: target.h } : target;

        return (
          <PlacedCardView
            key={widget.id}
            card={donde}
            cell={cell}
            pageOffset={enLaMano ? (current - offset / width) * width : 0}
            lifted={enLaMano || (live && dragging === widget.id)}
          >
            <PanelCard
              id={widget.id}
              title={info.title}
              subtitle={info.subtitle}
              emoji={info.emoji}
              colorKey={colorKeyOf(widget)}
              wash={washOf?.(widget)}
              colorToKey={colorToOf?.(widget)}
              where={whereOf(widget)}
              compact={donde.h < 2}
              size={cardSize(widget)}
              cell={cell}
              mark={info.mark}
              onPress={() => {
                if (info.href) onOpen(info.href);
              }}
              onResize={onResize}
              onUnpin={() => onUnpin(widget.id)}
            />
          </PlacedCardView>
        );
      })}
      </View>
    </PanelArrangeContext.Provider>
  );
}

/**
 * One card, placed, and the motion that takes it to where it belongs.
 *
 * A resize re-places every card, and doing that in a `useEffect` is a render of
 * the screen per change, sixty times a second. So the placement is read inside an
 * animated style and animated to: the card moves, the screen does not re-render.
 *
 * **Every** card animates, including the one under the corner, and it used not to.
 * The reasoning was that a card being resized is being resized *by the finger*,
 * so it has to be exactly where the finger is and anything with momentum is
 * latency. That is true of moving a card, where the finger's position is the
 * answer, and it is not true of resizing one: the size is a step, not a position,
 * so the finger is choosing between a handful of sizes and the card cannot be
 * under the finger at all — it is as many cells across as the size says. Set
 * without animating, a resize was the one thing on the panel that teleported: the
 * card jumped a whole cell, and the neighbours glided to their new places while
 * it did, which reads as the card being the wrong shape rather than as the card
 * having been resized. It eases like everything else.
 */
function PlacedCardView({
  card,
  cell,
  lifted,
  pageOffset = 0,
  children,
}: {
  card: { x: number; y: number; w: number; h: number };
  cell: { width: number; height: number; gap: number };
  lifted: boolean;
  /**
   * How far along the track this card sits, for a card that is drawn above it.
   *
   * A card that belongs to a screen is placed at that screen's slot by the screen
   * itself. A card being carried is drawn by the panel, on top of the track, and
   * needs the same slot said out loud — without it the card stays on the slot of
   * the screen it came from while the track slides under it, and it leaves the
   * window with the screen it just left, which is a card that walked off the panel
   * while it was being carried across it.
   */
  pageOffset?: number;
  children: React.ReactNode;
}) {
  const x = useSharedValue(card.x);
  const y = useSharedValue(card.y);
  const w = useSharedValue(card.w);
  const h = useSharedValue(card.h);

  /**
   * The slot on the track, and it **moves with the same easing the track does**.
   *
   * That pairing is the whole of a card that is being carried across screens. The
   * track slides a screen to the left and this slides a screen to the right over
   * the same 90 milliseconds with the same curve, so the two cancel exactly and
   * the card does not move at all while the panel turns under it.
   *
   * Snap it instead and the card jumps to the far side of the panel for a frame —
   * and then slides back — which is the one thing that makes a carried card look
   * like it is being thrown rather than held. A card whose page is not being turned
   * has an offset of zero and this never runs.
   */
  const offset = useSharedValue(pageOffset);
  useEffect(() => {
    offset.value = withTiming(pageOffset, {
      duration: PAGE_MIN,
      easing: Easing.out(Easing.cubic),
    });
  }, [offset, pageOffset]);

  useEffect(() => {
    // They ease into place and stop. A card that overshoots and comes back is fine
    // when there is one of it; with a screen of them, every card in the panel rings
    // for a moment after you let go, and the panel reads as nervous rather than as
    // responsive.
    x.value = withTiming(card.x, MOVE);
    y.value = withTiming(card.y, MOVE);
    w.value = withTiming(card.w, MOVE);
    h.value = withTiming(card.h, MOVE);
  }, [card.h, card.w, card.x, card.y, h, w, x, y]);

  const box = useAnimatedStyle(() => ({
    left: offset.value + x.value * (cell.width + cell.gap),
    top: y.value * (cell.height + cell.gap),
    width: w.value * cell.width + (w.value - 1) * cell.gap,
    height: h.value * cell.height + (h.value - 1) * cell.gap,
  }));

  return (
    <Animated.View
      style={[
        styles.cell,
        // The lifted card is above the others and lifts a little off the page.
        // Enough to tell which card you are holding once two of them overlap,
        // and not so much that the panel looks like it has come apart.
        lifted ? styles.lifted : null,
        box,
      ]}
    >
      {children}
    </Animated.View>
  );
}

/**
 * The pages, as dots between arrows.
 *
 * Dots and not a count, because the question is not which page you are on but how
 * many there are, and a "3 / 7" on a panel you are arranging is a number to count
 * rather than a place to aim. The arrows are there because a dot is a target too
 * small for a finger that is also dragging a card around.
 */
function PageBar({
  page,
  screens,
  onChange,
  canAddPage,
  onAddPage,
}: {
  page: number;
  screens: number;
  onChange: (page: number) => void;
  /** Only while arranging: outside it there is nothing to arrange onto. */
  canAddPage: boolean;
  onAddPage: () => void;
}) {
  const theme = useTheme();
  const t = useTranslation();

  /**
   * How many dots to draw: exactly as many as there are screens.
   *
   * It was `screens + 1`, and a dot more than there are screens is worse than no
   * dots at all: the last one is a promise the panel cannot keep. Pressing it sets
   * a page that does not exist, the clamp puts you back where you were, and the
   * only evidence anybody gets is a dot that does nothing — which reads as the app
   * being broken rather than as the dot being wrong.
   *
   * The number comes from `pageCount`, which is the highest screen that has
   * something on it, so every dot is a screen somebody's cards are on and every
   * one of them is somewhere you can get to.
   */
  const total = Math.min(Math.max(screens, 1), MAX_PAGES);

  return (
    <View style={[styles.row, styles.pages, { gap: theme.spacing.md }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("dashboard.previousPage")}
        disabled={page === 0}
        hitSlop={10}
        onPress={() => onChange(Math.max(page - 1, 0))}
        style={({ pressed }) => [
          styles.pageArrow,
          { opacity: pressed || page === 0 ? 0.5 : 1 },
        ]}
      >
        <Ionicons
          name="chevron-back"
          size={18}
          color={page === 0 ? theme.colors.textSubtle : theme.colors.text}
        />
      </Pressable>

      <View style={[styles.row, { gap: theme.spacing.sm }]}>
        {Array.from({ length: total }, (_, index) => (
          <Pressable
            key={index}
            accessibilityRole="button"
            accessibilityState={{ selected: index === page }}
            /*
              Which screen you are on, in the label, and not only in the colour.
              `accessibilityState.selected` does not reach the web: a button is not
              an option, so there is no valid `aria-selected` for it and the
              attribute is simply not written. The only thing left telling the two
              dots apart was a background colour, which is invisible to a screen
              reader and to anybody who cannot separate the accent from the border.
              The label says which screen it is and whether it is the one being
              looked at, in words, and it is the same words whether or not you can
              see the dot.
            */
            accessibilityLabel={
              index === page
                ? t("dashboard.herePage", { page: index + 1 })
                : t("dashboard.goToPage", { page: index + 1 })
            }
            hitSlop={8}
            onPress={() => onChange(index)}
            testID={index === page ? "panel-page-current" : `panel-page-${index}`}
          >
            <View
              style={[
                styles.dot,
                {
                  backgroundColor:
                    index === page ? theme.colors.accent : theme.colors.border,
                },
              ]}
            />
          </Pressable>
        ))}
      </View>

      {
        /*
          A screen that can be added, at the end of the bar, and only while
          arranging.

          It is a plus and not a fourth kind of arrow because it is the only one of
          the four that makes something rather than going somewhere, and a bar where
          three keys move and one creates is a bar you read twice. Disabled at the
          cap and for the same reason the last dot is not a promise: a plus that does
          nothing is worse than a plus that is not there.
        */
      }
      {canAddPage ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("dashboard.addPage")}
          hitSlop={10}
          onPress={onAddPage}
          testID="panel-add-page"
          style={({ pressed }) => [
            styles.pageArrow,
            { opacity: pressed ? 0.5 : 1 },
          ]}
        >
          <Ionicons
            name="add-circle-outline"
            size={18}
            color={theme.colors.textSubtle}
          />
        </Pressable>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("dashboard.nextPage")}
        disabled={page >= total - 1}
        hitSlop={10}
        onPress={() => onChange(Math.min(page + 1, total - 1))}
        style={({ pressed }) => [
          styles.pageArrow,
          { opacity: pressed || page >= total - 1 ? 0.5 : 1 },
        ]}
      >
        <Ionicons
          name="chevron-forward"
          size={18}
          color={
            page >= total - 1 ? theme.colors.textSubtle : theme.colors.text
          }
        />
      </Pressable>
    </View>
  );
}

/**
 * A screen with nothing on it, said once, in the middle.
 *
 * Not a grid of placeholders and not a card-sized anything. A page that is empty is
 * a real state — somebody made it, and it is waiting — and the only thing it needs is
 * for that to be obvious without looking like something failed to load.
 */
function EmptyPage({ label }: { label: string }) {
  const theme = useTheme();
  return (
    <View
      testID="panel-empty-page"
      accessibilityLabel={label}
      style={[styles.screen, styles.emptyPage, { width: "100%" }]}
    >
      <Ionicons name="albums-outline" size={24} color={theme.colors.textSubtle} />
      <AppText variant="callout" tone="subtle" style={styles.emptyPageText}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  /**
   * The panel takes the whole page.
   *
   * Not a column of things that ends somewhere: a board. It is the one screen
   * where the content *is* the screen, and the rest of the space is what a card
   * gets.
   */
  root: {
    flex: 1,
  },
  /**
   * The board: the space under the header, measured on the way in.
   *
   * `flex: 1` so it takes exactly what the header left and no more. A board
   * taller than the space it was given is a board with a scroll, and the whole
   * point is that there is not one.
   *
   * `position: relative` so the absolutely positioned things inside it are placed
   * against the board and not against whatever happens to be further up. The
   * ghosts of an empty panel are one of them, and without this they come out zero
   * wide — a panel that looks like it has not drawn.
   *
   * `overflow: hidden`, and it is the **board** that has to be the one clipping.
   * The track is as wide as every screen side by side, so its own `overflow`
   * clips at three screens and lets the other two through — which is why a panel
   * of three screens showed sixteen pixels of the next one sitting at the right
   * edge, on a panel that had not been touched. The clip has to be a box one
   * screen wide, and this is the only one that is.
   *
   * It costs the shadow on a card being dragged against the right or the left
   * edge, which is clipped at the panel's own border. That is the cheaper half of
   * the trade: a shadow that stops at the edge of the screen reads as a card at
   * the edge of the screen, and a sliver of a page you have not asked for reads as
   * a page that is already there.
   */
  /**
   * The middle of an empty page: the icon over the line, both centred, and
   * neither of them taking any space the cards would not have taken.
   */
  emptyPage: {
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  emptyPageText: {
    textAlign: "center",
  },
  /**
   * Where the empty page says so.
   *
   * Over the whole board and touching nothing: it is a sentence about the screen,
   * not a thing on it. The first version of this drew it *instead* of the track,
   * which is what took the swipe away from an empty screen.
   */
  vacio: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  board: {
    flex: 1,
    width: "100%",
    position: "relative",
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
  },
  flex: {
    flex: 1,
  },
  iconButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  pages: {
    justifyContent: "center",
  },
  pageArrow: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  /**
   * The track: every screen of the panel, side by side.
   *
   * Its width is set by the animated style and is the board's width times the
   * number of screens, because the position of a screen on it is that width times
   * the screen's number.
   *
   * `overflow: hidden` here does **not** clip the screens either side of the one
   * being looked at, and the comment used to say it did. It cannot: the clip is
   * at this box's own border, and this box is every screen side by side, so the
   * far side of it is off the panel. The clip that does that is on `board`, which
   * is one screen wide. This stays because a screen's own painting still has to
   * stay inside it — the `lifted` card's shadow, mostly — and because removing it
   * would be a change with nothing to gain.
   */
  track: {
    position: "relative",
    overflow: "hidden",
  },
  /** One screen, at its slot on the track. */
  screen: {
    position: "absolute",
    top: 0,
  },
  cell: {
    position: "absolute",
  },
  lifted: {
    zIndex: 20,
    // The CSS form, because the `shadow*` family was dropped on the web and this
    // is the one that works on all three targets.
    boxShadow: "0px 6px 16px rgba(0, 0, 0, 0.22)",
  },
  /**
   * Where the floating button lives.
   *
   * Absolute to the bottom right of the panel, the same corner it is in on every
   * other screen. `pointerEvents: "box-none"` on the wrapper so the corner of the
   * panel under the button still belongs to the panel: a card you are dragging
   * *into* that corner has to be able to land there, and a wrapper that ate the
   * touches would make the last cell of the panel impossible to drop anything on.
   */
  fabSlot: {
    position: "absolute",
    right: 0,
    bottom: 0,
    width: 78,
    height: 82,
  },
  addCard: {
    gap: 4,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 18,
    borderWidth: 1,
    borderStyle: "dashed",
  },
});
