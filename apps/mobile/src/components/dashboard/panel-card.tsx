import { Ionicons } from "@expo/vector-icons";
import { useCallback, useContext, useEffect, useRef } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import type { WorkspaceWash } from "@orbit-hub/contracts";

import { useA11yHint } from "@/components/ui/a11y-hint";
import { AppText } from "@/components/ui/text";
import { SpaceWash } from "@/components/ui/wash";
import { oneStepTowards, resizeStartSize, sizeFromDrag } from "@/lib/dashboard/panel";
import { cardMarkGlyph } from "@/lib/dashboard/card-kind";
import type { CardMark } from "@/lib/dashboard/card-kind";
import { useTranslation } from "@/lib/i18n";
import { spacePaint } from "@/lib/workspace/color";
import { useTheme } from "@/theme";

import { PanelArrangeContext } from "./panel-arrange";

/**
 * How far a card leans while the panel is being arranged.
 *
 * Just over half a degree, and slower than a heartbeat, and that is a correction
 * rather than a taste: the old values were nearly twice the angle and a fifth of
 * the period, and the cards rattled. The worst of it was not the size but the
 * shape — a five-step sequence that came back to zero at the end of every cycle,
 * so every card went still for a frame, twice a second, in step with all the
 * others. A card that stops moving is a stutter, and a dozen of them stopping
 * together is a panel that twitches.
 *
 * Now it swings from one extreme to the other and eases at each end, so the
 * velocity only reaches zero at the turn, which is the one place a lean is
 * supposed to hesitate. The cards are not in step either: `phaseOf` staggers
 * them, because a row of cards tilting in unison reads as one object twitching
 * rather than as a deck of cards being arranged.
 */
const WOBBLE = 0.55;
const WOBBLE_HALF = 640;

/**
 * How far into the wobble a card starts, in milliseconds.
 *
 * Taken from the id so it is the *same* card's phase on every render, on every
 * device and after every rearrangement. From the position on the screen it would
 * change as soon as a card moved, and every card would visibly restart its
 * wobble at the moment you let go of one — which is the last thing a panel
 * should do while you are arranging it.
 */
function phaseOf(id: string): number {
  let sum = 0;
  for (let index = 0; index < id.length; index += 1) {
    sum = (sum * 31 + id.charCodeAt(index)) % 9973;
  }
  return (sum % 7) * 95;
}

/**
 * How the card under the finger gives the hand back.
 *
 * A short ease-out that stops, and no spring: it overshoots the place it was
 * released at and comes back, which on the one gesture that is supposed to feel
 * like picking something up reads as the card being sprung out of your hand. The
 * scale barely moves for the same reason — enough to say "this one is held", not
 * enough to announce it.
 */
const LIFT = 1.02;
const MOVE = { duration: 170, easing: Easing.out(Easing.cubic) };
const WOBBLE_OUT = { duration: 200, easing: Easing.out(Easing.cubic) };

/**
 * How long a finger has to rest on a card before the card is in your hand.
 *
 * A hold and not a distance, because there are two gestures on this card and only
 * one finger. A few points of movement place the card on this screen — that is the
 * grid everybody already knows, and it is why the panel has no drag threshold to
 * learn — and pushing a card sideways to another screen is a *different* intent
 * that can only be told from the first one by the hand going still first. So the
 * movement that places the card wins whenever it happens, and the card is only
 * picked up by waiting.
 *
 * Short enough that it does not feel like a mode, long enough that nobody sets a
 * finger down and pushes before the card answers. About the same as the hold the
 * OS uses to pick an icon off a home screen, which is the gesture this is copying.
 */
const CARRY_AFTER = 280;

/**
 * How much bigger a card is while it is being carried.
 *
 * More than the drag lift, and for the same reason the drag lift is more than
 * nothing: the two states have to be told apart from the shape of the card alone.
 * A card being dragged is being placed and a card being carried is in a hand, and
 * the second one is the only state in which the panel turns screens under you — so
 * if the two look the same, a panel turning a screen is a panel reacting to
 * something the person cannot see.
 */
const CARRY_LIFT = 1.07;

export interface PanelCardProps {
  id: string;
  title: string;
  subtitle: string;
  emoji: string | null;
  /**
   * What this card is, drawn as an icon.
   *
   * Not the emoji: an emoji is a picture of whatever the person chose, and the
   * emoji of "Cine" is a camera on one card and a clapperboard on another. This
   * is the one thing about the card nobody chose, and it is what makes a folder
   * and a list of the same name look like different things.
   */
  mark: CardMark;
  /** The space the card is in, which is the colour it is painted with. */
  colorKey: string | null | undefined;
  /**
   * How that space is painted, and the card is painted the same way.
   *
   * The panel is the one place two spaces sit next to each other, so a card that
   * fell back to the default wash would be the one card in the row that is painted
   * differently from the same space everywhere else.
   */
  wash?: WorkspaceWash | null;
  /**
   * The colour the space ends in, chosen by the person who owns it.
   *
   * Here beside the colour because a card that leaves it out is painted with the
   * derived pair, and the picker right next to it is showing the chosen one: two
   * pictures of the same space on one screen.
   */
  colorToKey?: string | null;
  /** Which space it is, said while the panel is being arranged. */
  where: string;
  /** A card of one row has room for the name and nothing else. */
  compact: boolean;
  /** The size it is at now, in cells. */
  size: { w: number; h: number };
  /** The cell of the fine grid, in pixels, as the panel measured it. */
  cell: { width: number; height: number; gap: number };
  onPress: () => void;
  /**
   * The size the corner drag is at, or `null` when it is not being dragged.
   *
   * `null` and not a size, because the end of the drag has to be told apart from
   * a size: the panel writes the layout once the corner is released, and a write
   * per frame is one operation per frame in the outbox.
   */
  onResize: (id: string, size: { w: number; h: number } | null) => void;
  onUnpin: () => void;
}

/**
 * One card of the panel, and the two gestures that make it movable.
 *
 * The wobble is the old app's affordance and it is here for the same reason it was
 * there: a card that can be picked up has to *say* so, and a still card under a
 * pencil button reads as a poster. It is a fraction of a degree and it only runs
 * while the panel is being arranged.
 *
 * The corner is a gesture inside the card's gesture, and the inner one wins. That
 * nesting is the whole trick: without it, pulling the corner picks the card up
 * instead of resizing it, and there is no other way to say "make this one bigger".
 *
 * **The card does not follow the finger.** It is drawn in the cell the finger is
 * over, and the finger only decides which cell that is. This is the opposite of
 * the obvious thing to write and it is what makes a drag feel like a deck of
 * cards rather than a floating rectangle: a card glued to your fingertip is
 * somewhere between cells the whole time, and every other card is somewhere
 * definite, so the panel is never at rest. Snapping means the card hops from slot
 * to slot and the panel is only ever in a position the grid recognises — which is
 * also the only position it can be saved in.
 */
export function PanelCard({
  id,
  title,
  subtitle,
  emoji,
  mark,
  colorKey,
  wash,
  colorToKey,
  where,
  compact,
  size,
  cell,
  onPress,
  onResize,
  onUnpin,
}: PanelCardProps) {
  const theme = useTheme();
  const t = useTranslation();
  // `undefined` and not `null`: the paint layer reads an absent wash as "fall back
  // to the default", and a card of a space that has not chosen one has to look
  // the way it did before the choice existed.
  // The end colour is passed on for the reason above: the person chose it, and
  // without it the card paints a pair the picker is not showing.
  const paint = spacePaint(colorKey, wash ?? undefined, colorToKey);
  const arrange = useContext(PanelArrangeContext);
  const editing = arrange?.editing ?? false;
  /** Whether this card is the one in the person's hand, and not just being placed. */
  const carried = arrange?.carried === id;

  const scale = useSharedValue(1);
  const wobble = useSharedValue(0);

  /**
   * Whether a corner drag is on this card right now.
   *
   * Exists for the effect below and for nothing else. Reading it in a JavaScript
   * effect is legitimate: the value it guards is written on the interface thread
   * and the effect runs on the other one, so what it wants to know is "was a
   * resize in flight when this prop changed", and by the time an effect runs for
   * a mid-drag prop, this is the answer.
   */
  const resizing = useSharedValue(false);

  /**
   * The size the corner drag starts from.
   *
   * A shared value and not the `size` prop, because the prop follows the panel
   * and the panel is following this drag: read mid-drag it would make the start
   * point move under the finger, and the card would drift every time it snapped
   * to a cell.
   *
   * And the sync below is what that first paragraph is about, so it is worth
   * saying what it must not do: it must not run *during* a resize. A resize
   * changes `size` — that is its whole job — and syncing then moves the start
   * point forward to where the finger has got to, so the next frame measures the
   * finger's travel from a base that has already grown. The two compound and the
   * card runs away from under the hand: measured, one drag of 198 points turned a
   * one column card into a four column one, changing three times in the 33
   * milliseconds it took the finger to cover ten points, when one change of
   * column needs 138. From the hand that is one movement from one to four, and it
   * is not the size list's fault.
   */
  const startSize = useSharedValue(size);
  useEffect(() => {
    startSize.value = resizeStartSize(startSize.value, size, resizing.value);
  }, [size, startSize, resizing]);

  /**
   * The size this card was drawn at on the previous frame of this drag.
   *
   * Not `size`, because the prop is written by the JavaScript thread and this is
   * read on the interface thread sixty times a second; a value that has not
   * arrived yet is a value that is late. The cap on how far the size may move in
   * a frame has to be measured against what was *drawn*, and what was drawn is
   * only known here.
   */
  const drawnSize = useSharedValue(size);
  useEffect(() => {
    if (!editing) drawnSize.value = size;
  }, [size, editing, drawnSize]);

  /**
   * Straightens the card up and puts the scale back.
   *
   * Both the release and the cancellation call this, because they are the same
   * thing from the card's point of view: the hand is no longer on it. Only the
   * arrangement differs, and that has already been written.
   *
   * There is nothing to put back *positionally*: the card is in the cell the drop
   * chose, and the panel animates it there. So this is the whole release.
   */
  const settle = () => {
    'worklet';
    scale.value = withTiming(1, MOVE);
  };

  /**
   * The hold that puts the card in the person's hand.
   *
   * Armed when the finger goes down and disarmed the moment the gesture activates,
   * so a card is either being placed or being picked up and never both: the two
   * read the same travel differently, and a card that answered a push to the right
   * with a new screen *and* with a new column is a panel that answers two questions
   * at once and gets one of them wrong.
   *
   * A `setTimeout` and not a gesture of its own, because a gesture cannot be armed
   * for "the finger has stopped moving" without also owning the movement, and the
   * movement belongs to the drag.
   */
  const pickUp = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearPickUp = useCallback(() => {
    if (pickUp.current === null) return;
    clearTimeout(pickUp.current);
    pickUp.current = null;
  }, []);
  // A timer outliving the card would lift a card that is not on the panel any more.
  useEffect(() => clearPickUp, [clearPickUp]);

  useEffect(() => {
    if (!editing) {
      cancelAnimation(wobble);
      wobble.value = withTiming(0, WOBBLE_OUT);
      return undefined;
    }
    wobble.value = withDelay(
      phaseOf(id),
      withRepeat(
        withSequence(
          withTiming(-WOBBLE, {
            duration: WOBBLE_HALF,
            easing: Easing.inOut(Easing.sin),
          }),
          withTiming(WOBBLE, {
            duration: WOBBLE_HALF,
            easing: Easing.inOut(Easing.sin),
          }),
        ),
        -1,
        false,
      ),
    );
    return () => cancelAnimation(wobble);
  }, [editing, id, wobble]);

  const drag = Gesture.Pan()
    .enabled(editing)
    // A card is also a link, so a drag has to beat a tap. Not a long press: the
    // old app started on a few pixels of movement, and that is what a hand
    // already expects from a grid.
    .minDistance(6)
    .onBegin(() => {
      clearPickUp();
      if (!arrange?.canCarry) return;
      pickUp.current = setTimeout(() => {
        pickUp.current = null;
        // The corner got the finger and not the card. Read here and not when the
        // timer was armed because the two handlers are told about a touch in no
        // order anybody should depend on, and a resize that also picked the card
        // up is a card that is in your hand and being resized at the same time.
        if (resizing.value) return;
        // The card straightens up and comes off the page further than a drag
        // does, because it is being carried and not placed. See `CARRY_LIFT`.
        cancelAnimation(wobble);
        wobble.value = withTiming(0, WOBBLE_OUT);
        scale.value = withTiming(CARRY_LIFT, MOVE);
        arrange.onPickUp(id);
      }, CARRY_AFTER);
    })
    .onStart(() => {
      // Movement beats the hold, so the hold is off from here: this is a drag.
      clearPickUp();
      // The card straightens up as it is picked up. A card that keeps leaning
      // while it is being carried looks broken, not alive.
      cancelAnimation(wobble);
      wobble.value = withTiming(0, WOBBLE_OUT);
      // Never smaller than what it is: a card that was picked up and then moved
      // within its screen is still in a hand, and dropping it back to the drag
      // lift on the first frame would say it had been put down while it is being
      // carried to another one.
      scale.value = withTiming(Math.max(scale.value, LIFT), MOVE);
      runOnJS(arrange?.onDragStart ?? noop)(id);
    })
    .onUpdate((event) => {
      // The finger does not move the card. It says which cell the card is over,
      // and the panel draws the card there and moves the neighbours out of the
      // way. See the note at the top of this file for why the obvious thing —
      // translating the card by the finger's delta — is the wrong one.
      runOnJS(arrange?.onDragMove ?? noop)(
        id,
        event.translationX,
        event.translationY,
      );
    })
    .onEnd(() => {
      clearPickUp();
      runOnJS(arrange?.onDragEnd ?? noop)(id);
      settle();
    })
    .onFinalize(() => {
      // Every release ends here, including a release of a finger that never moved:
      // the hold has to be disarmed by a tap as much as by a drag, or a card lifts
      // itself a quarter of a second after being tapped.
      clearPickUp();
      runOnJS(arrange?.onDragEnd ?? noop)(id);
      settle();
    });

  const resize = Gesture.Pan()
    .enabled(editing)
    .minDistance(2)
    .onBegin(() => {
      // The corner is not the card. `resizing` is what the pick-up timer checks,
      // and it has to be set here and not at activation: a corner that is held
      // rather than pulled is still the corner.
      resizing.value = true;
      clearPickUp();
    })
    .onStart(() => {
      resizing.value = true;
      startSize.value = size;
      drawnSize.value = size;
    })
    .onUpdate((event) => {
      // The same arithmetic the tests cover, and not a second copy of it here:
      // the two drifting apart is how a card ends up a size the panel did not ask
      // for, and a resize that only works on one screen.
      //
      // `oneStepTowards` is what makes the sizes in between reachable: a finger
      // moving quickly asks for several sizes in one frame and the ones it passes
      // over are never seen. See the note on it in `panel.ts`.
      const want = sizeFromDrag(
        startSize.value,
        event.translationX,
        event.translationY,
        cell,
      );
      const next = oneStepTowards(drawnSize.value, want);
      drawnSize.value = next;
      runOnJS(onResize)(id, next);
    })
    .onEnd(() => {
      resizing.value = false;
      runOnJS(onResize)(id, null);
    })
    .onFinalize(() => {
      resizing.value = false;
      runOnJS(onResize)(id, null);
    });

  const animated = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }, { rotate: `${wobble.value}deg` }],
  }));

  /*
    The hint while arranging, which is the only screen where the card is not a
    link.

    It used to be the name of the space the card is in, which the card already
    says in its own last line while arranging — so a screen reader heard the same
    sentence twice and learned nothing about what the card can *do*. The space goes
    first because it is on the card, and the carry goes with it because it is the
    one thing about this mode that is not visible anywhere: there is no button that
    pushes a card to another screen, and a gesture nobody is told about is a
    gesture nobody does.
  */
  const pista = useA11yHint(
    editing
      ? `${where ? `${where}. ` : ""}${t("dashboard.carryCard")}`
      : subtitle,
  );

  return (
    /*
      The fragment and not a bare `GestureDetector`: a detector takes exactly one
      view as a child, and the accessibility hint is a second one. Putting the hint
      inside made the panel fail to render at all, with a message about the number
      of children that says nothing about which one is wrong.

      The hint is `position: absolute` at `-9999px`, so it is out of the way in the
      layout and the card keeps the full height of its cell either way.
    */
    <>
      <GestureDetector gesture={drag}>
        <Animated.View style={[styles.fill, animated]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={title}
            {...pista.props}
            // While the panel is being arranged a tap goes nowhere: a card that
            // opens the list you were trying to move is a card you cannot move.
            onPress={editing ? undefined : onPress}
            style={[
              styles.card,
              { borderColor: paint.border, borderRadius: theme.radius.lg },
            ]}
          >
            <SpaceWash
              colorKey={colorKey}
              // The same pair as the paint above, and the same reason: a card
              // painted with the derived pair is a different space on screen.
              colorToKey={colorToKey}
              wash={wash ?? undefined}
              radius={theme.radius.lg}
              style={styles.wash}
            />

            {/*
              The mark, and the emoji beside it, and the order they are in.

              The mark comes first because it is the part that is *not* decoration:
              it is the same on every card of the same kind, so the eye can pick
              "the film one" out of a grid without reading a word. The emoji is the
              person's own, so it goes after and stays out of the way — and on a
              card of one row, where there is room for the name and nothing else,
              only the mark survives. Dropping the emoji there is not losing
              information: the name is the thing being read and the mark is the
              thing being recognised.
            */}
            <View style={styles.body}>
              <View style={styles.markRow}>
              <Ionicons
                name={cardMarkGlyph(mark)}
                size={compact ? 14 : 16}
                color={paint.foreground}
                style={styles.mark}
              />
                {emoji && !compact ? (
                  <AppText variant="title" style={styles.emoji}>
                    {emoji}
                  </AppText>
                ) : null}
              </View>

              <AppText
              variant="bodyStrong"
              numberOfLines={compact ? 1 : 3}
              style={[styles.title, { color: paint.foreground }]}
            >
              {title}
            </AppText>

              {/* A card of one row has room for the name and nothing else, and a
                second line in it is a line cut in half. */}
              {compact ? null : (
                <>
                  <View style={styles.spacer} />
                  <AppText
                    variant="caption"
                    style={{ color: paint.muted }}
                    numberOfLines={1}
                  >
                    {editing ? where : subtitle}
                  </AppText>
                </>
              )}
            </View>
          </Pressable>

          {/*
            The way out of the panel, and only while arranging.

            A SIBLING of the card and not inside it. It is a button, the card is a
            button, and a button inside a button is invalid HTML that the browser
            complains about on the console and that a screen reader reads as one
            control with two names. It is also why the two work at all: nested, the
            tap lands on the outer one and nothing can be unpinned.

            Not while it is being carried, for the reason the corner is not either:
            a card in a hand is a card being moved somewhere, and the two buttons on
            it would be about a third of the area the hand is trying to travel
            across — on the corner the finger has to be anyway.
          */}
          {editing && !carried ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("dashboard.unpinCard", { name: title })}
              hitSlop={10}
              onPress={onUnpin}
              style={[styles.unpin, { borderRadius: theme.radius.pill }]}
            >
              <Ionicons name="close" size={14} color={paint.foreground} />
            </Pressable>
          ) : null}

          {/* The corner you pull. Bottom right, because that is the corner whose
            movement a hand already knows how to make, and 44 across, because 44
            is about a fingertip. Gone while the card is being carried, and for the
            same reason as the unpin: it is 44 of hand to cross on the way to
            another screen, and a corner that resizes the card being carried would
            resize it on the way past. */}
          {editing && !carried ? (
            <GestureDetector gesture={resize}>
              <View
                accessibilityRole="button"
                accessibilityLabel={t("dashboard.resizeCard", { name: title })}
                style={styles.handle}
              >
                <View style={styles.handleInner}>
                  <Ionicons
                    name="resize"
                    size={20}
                    color="#FFFFFF"
                    style={styles.handleIcon}
                  />
                </View>
              </View>
            </GestureDetector>
          ) : null}
        </Animated.View>
      </GestureDetector>
      {pista.node}
    </>
  );
}

function noop() {}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  card: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  wash: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  body: {
    flex: 1,
    padding: 12,
  },
  /**
   * The mark and the emoji, side by side and above the name.
   *
   * A row and not two stacked lines, because on a card of one row there is room
   * for exactly one line above the name, and on a tall card two lines of glyph is
   * a header where the title should be.
   */
  markRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 2,
  },
  mark: {
    flexShrink: 0,
  },
  emoji: {
    marginBottom: 2,
  },
  title: {
    flexShrink: 1,
  },
  spacer: {
    flex: 1,
    minHeight: 2,
  },
  unpin: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
    // Above the card, not inside it: a sibling that is absolutely positioned
    // draws on top of it and is still its own control.
    zIndex: 2,
    // On the wash and not from the theme: the card is the colour of a space, and
    // the theme has no colour that reads on all eight of them.
    backgroundColor: "rgba(11,17,32,0.34)",
  },
  handle: {
    position: "absolute",
    right: 0,
    bottom: 0,
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    // Above the card for the same reason as the unpin button: it is a separate
    // control that sits on top of the card rather than inside it.
    zIndex: 2,
  },
  handleInner: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 6,
    backgroundColor: "rgba(11,17,32,0.4)",
  },
  handleIcon: {
    // The icon points up and to the left and the corner is the bottom right, so
    // it is turned to point the other way. An arrow pointing away from the corner
    // it resizes is a handle that says the opposite of what it does.
    transform: [{ rotate: "45deg" }],
  },
});
