import { Ionicons } from '@expo/vector-icons';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';

import { dropIndex, rowShift } from '@/lib/lists/drag-shift';
import { useTranslation } from '@/lib/i18n';
import { useTheme } from '@/theme';

import { useA11yHint } from './a11y-hint';

/**
 * What the rows share while one of them is being dragged.
 *
 * They share it on the UI thread and not through React state: a drag fires a
 * move event per frame, and a state change per frame is a render of the whole
 * list per frame. These are shared values, so reading them in an animated style
 * costs a style recalculation and not a render.
 */
interface SortState {
  /** The row being dragged, or null. */
  draggingId: SharedValue<string | null>;
  /** Where it was when the finger went down. */
  fromIndex: SharedValue<number>;
  /** Where it would land if the finger lifted now. */
  toIndex: SharedValue<number>;
  /**
   * The distance from one row to the next, in the list being dragged.
   *
   * **It is a distance and not a height**, and that word is the whole difference
   * between a drag that lands where the hole opened and one that does not. Both
   * `dropIndex` and `rowShift` do arithmetic of "one row further down", so the
   * number they want is the *pitch* of the list: the height of a row **plus** the
   * space between rows.
   *
   * It used to be measured as a height, and in a list with no gap between rows
   * the two are the same number, so nothing was ever wrong in the one list that
   * used it. Put the same rows in a container with a gap and the pitch is four
   * points more than the height, every row further down is four points out, and
   * on a list of twenty the drop lands **more than a row short**: the finger is
   * over the last row, the row goes to the second to last, and the gap that opens
   * is not the gap it dropped into. That reads as the drag not taking, and as the
   * row bouncing when it is let go — the row was pulled back to where the data
   * said it was, away from where the finger left it.
   */
  rowHeight: SharedValue<number>;
  /** The space between rows, which is part of the pitch and not of the height. */
  gap: number;
}

const SortContext = createContext<SortState | null>(null);

/**
 * Wraps a list that can be reordered by dragging its rows.
 *
 * It holds the three numbers every row needs to make room. It is a provider and
 * not a prop on the row because the rows are inside a `FlatList`, and passing
 * four shared values through `renderItem` on every row is a prop list that has
 * to be kept in step with the component by hand.
 *
 * **`gap` is the space the caller puts between its rows, written down once.**
 * Whoever lays the rows out is the only one who knows it, and a row can only
 * measure itself, so without this the caller's layout and the drag maths each work
 * from a different idea of where row three starts.
 */
export function DraggableSort({
  children,
  gap = 0,
}: {
  children: ReactNode;
  /** The space between rows in the layout the caller built. */
  gap?: number;
}) {
  const draggingId = useSharedValue<string | null>(null);
  const fromIndex = useSharedValue(0);
  const toIndex = useSharedValue(0);
  const rowHeight = useSharedValue(ROW_HEIGHT_DEFAULT);

  const value = useMemo(
    () => ({ draggingId, fromIndex, toIndex, rowHeight, gap }),
    [draggingId, fromIndex, toIndex, rowHeight, gap],
  );

  return <SortContext.Provider value={value}>{children}</SortContext.Provider>;
}

export interface DraggableRowProps {
  id: string;
  index: number;
  total: number;
  children: React.ReactNode;
  /**
   * Called with the new order when a drag finishes. The parent owns the state,
   * so the reordering rules stay in one tested place and this component only
   * deals with the finger.
   */
  onReorder: (id: string, toIndex: number) => void;
  onDragStateChange?: (dragging: boolean) => void;
}

/**
 * A row that can be dragged to reorder, and the rows around it make room for it
 * while the finger is still down.
 *
 * The row follows the finger, and every other row between where it started and
 * where it would land moves one place out of the way. That is the whole point
 * of a live reorder: you see the gap open where the row is going to go, so the
 * drop is not a guess. Committing only on release keeps the outbox from filling
 * with an operation per frame, and the list still reads as the new order
 * immediately, because what moves is the row and not the data.
 */
export function DraggableRow({
  id,
  index,
  total,
  children,
  onReorder,
  onDragStateChange,
}: DraggableRowProps) {
  const theme = useTheme();
  const t = useTranslation();
  const [dragging, setDragging] = useState(false);
  const sort = useContext(SortContext);

  const translateY = useSharedValue(0);
  const startY = useSharedValue(0);
  const isDragging = useSharedValue(false);
  const rowHeight = sort?.rowHeight ?? useSharedValue(ROW_HEIGHT_DEFAULT);

  const commit = useCallback(
    (toIndex: number) => {
      if (toIndex !== index && toIndex >= 0 && toIndex < total) {
        onReorder(id, toIndex);
      }
    },
    [id, index, onReorder, total],
  );

  const marcarArrastrada = useCallback(() => {
    recienArrastrado.current = true;
  }, []);

  const setDraggingState = useCallback(
    (value: boolean) => {
      setDragging(value);
      onDragStateChange?.(value);
    },
    [onDragStateChange],
  );

  /*
    The drag, **and it only exists on the handle**.

    It used to be a pan on the whole row that armed after two hundred
    milliseconds, which is the standard trick for "drag a row that is also a
    button". It costs two things that this app cannot afford:

    - **a long press is taken.** Two hundred milliseconds of holding a row is the
      gesture every other part of the app now uses to read a name that is too long
      to fit, and a row that is a button and a name and a drag surface has room for
      two of the three. The sheet of long names could not be in a list that is
      reorderable, and the reason was this line.
    - **the whole row is a drag target by accident.** Sliding a finger down a list
      to read it passes over four rows, and any of them could pick up a drag.

    On the handle instead, the drag is where the drawing says it is, it starts as
    soon as the finger moves, and the row is free to be a button, a name and
    anything else. There is no delay to wait out and nothing to disarm.
  */
  const gesture = Gesture.Pan()
    // A couple of points of slop, so a tap on the handle is a tap and a drag is a
    // drag, and nothing in between.
    .minDistance(2)
    .onStart(() => {
      isDragging.value = true;
      startY.value = translateY.value;
      if (sort) {
        sort.draggingId.value = id;
        sort.fromIndex.value = index;
        sort.toIndex.value = index;
      }
      runOnJS(setDraggingState)(true);
    })
    .onUpdate((event) => {
      // The row follows the finger exactly, and the *others* move. Snapping the
      // dragged row to a grid instead would mean the finger and the row
      // disagreeing by half a row for the whole drag, and the gap would open
      // somewhere other than where the row is.
      translateY.value = startY.value + event.translationY;

      if (sort) {
        // The landing place is computed by the same function the tests cover, and
        // not by a second copy of the arithmetic here: the two drifting apart is
        // how the row ends up dropping somewhere the hole is not.
        sort.toIndex.value = dropIndex({
          index,
          total,
          translationY: event.translationY,
          rowHeight: rowHeight.value,
        });
      }
    })
    .onEnd(() => {
      runOnJS(commit)(sort ? sort.toIndex.value : index);
      translateY.value = withTiming(0, SOLTAR);
      isDragging.value = false;
      if (sort) sort.draggingId.value = null;
      runOnJS(setDraggingState)(false);
      runOnJS(marcarArrastrada)();
    })
    .onFinalize(() => {
      translateY.value = withTiming(0, SOLTAR);
      isDragging.value = false;
      if (sort) sort.draggingId.value = null;
    });

  /**
   * The row was just dropped, and the click that ends the drag must not count.
   *
   * On native the tap that follows a drag is cancelled by the responder system
   * and none of this is needed. On the web it is not: a `Pressable` is a DOM
   * `click`, the browser fires one whenever the press and the release land on
   * the same element, and the gesture takes pointer capture on this row so they
   * always do — however far the finger travelled. So the drop was a drag *and* a
   * tap, and every row that opens on tap opened itself at the end of every drag.
   *
   * Which is why the symptom looked like the drag not working: the order did
   * change, and the screen navigated away a moment later, so the arrangement was
   * never seen to have held.
   */
  const recienArrastrado = useRef(false);
  const wrapperRef = useRef<View>(null);

  useEffect(() => {
    const nodo = wrapperRef.current as unknown as HTMLElement | null;
    // `addEventListener` only exists on a DOM node, which is the whole point:
    // on iOS and Android this is not a branch, it is a no-op.
    if (!nodo?.addEventListener) return;
    const alPulsar = (event: Event) => {
      if (!recienArrastrado.current) return;
      recienArrastrado.current = false;
      // In the capture phase and not the bubble one, because the row's own
      // `onPress` has already been bound by the time anything could stop it.
      event.preventDefault();
      event.stopPropagation();
    };
    nodo.addEventListener('click', alPulsar, true);
    return () => nodo.removeEventListener('click', alPulsar, true);
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    zIndex: isDragging.value ? 10 : 0,
    // A lifted row is a larger shadow, and the CSS form is the one that is not
    // deprecated on the web.
    boxShadow: isDragging.value ? '0px 10px 20px rgba(0, 0, 0, 0.25)' : '0px 0px 0px rgba(0, 0, 0, 0)',
  }));

  /**
   * The gap.
   *
   * A row moves out of the way when the dragged row's landing place has passed
   * it, and only then: a row that moved for a drag that is still coming back
   * would have to move back, and a list that flutters is worse than a list that
   * waits. There is no state update here, so a hundred rows can do this per
   * frame without a single render.
   */
  const makeRoomStyle = useAnimatedStyle(() => {
    const desplazamiento = sort
      ? rowShift({
          draggingId: sort.draggingId.value,
          id,
          index,
          from: sort.fromIndex.value,
          to: sort.toIndex.value,
          rowHeight: sort.rowHeight.value,
        })
      : 0;
    return { transform: [{ translateY: desplazamiento }] };
  });

  // Whether there is width for the handle.
  //
  // With the menu pushing, the row is 82px. The handle and the space reserved for
  // it are 60 of those, and what was left for the name of the item was nothing:
  // a checkbox, a drag handle and no item, so the handle goes and the name comes
  // back.
  //
  // **This used to cost a narrow row nothing and now it costs it the drag.** The
  // handle was a drawing on a row that could be dragged anywhere; it is now the
  // only thing that can be dragged. No row that is reorderable in this app is
  // narrow — the three that use this are full width on a phone and wider on a
  // tablet — so the branch is a guard and not a state, and it is written down
  // here because the day it does start happening the symptom is a list that
  // silently cannot be put in order.
  const [ancho, setAncho] = useState(0);
  const estrecho = ancho > 0 && ancho < 210;

  const pista = useA11yHint(t('items.dragHint'));

  return (
    <View
      ref={wrapperRef}
      style={styles.wrapper}
      onLayout={(event) => {
        setAncho(event.nativeEvent.layout.width);
        /*
          Measured, not assumed, and **measured as the distance to the next row**:
          this row's height plus the space the caller leaves between rows. The drag
          maths divides how far the finger has gone by that number to know how many
          places the row has moved, so a number that is only the height leaves every
          row further down short of where it is, and on a long list the drop lands
          more than a row away from the gap that opened for it.
        */
        const alto = event.nativeEvent.layout.height;
        if (sort && alto > 0) sort.rowHeight.value = alto + sort.gap;
      }}
    >
      <Animated.View
        style={[
          {
            borderRadius: theme.radius.lg,
            backgroundColor: theme.colors.surface,
            ...theme.shadow.card,
          },
          dragging ? styles.dragging : null,
          makeRoomStyle,
          animatedStyle,
        ]}
      >
        {children}
      </Animated.View>

      {/*
        The handle, **and it is the drag**.

        The drawing is eighteen points wide in a row that is fifty or sixty tall,
        and a finger is about forty: pressing exactly on the glyph is a thing
        people are bad at, and the drag that used to cover the whole row was the
        compensation. The compensation is the hit slop instead — **twenty points
        on every side**, so the touchable area is fifty-eight wide and covers the
        height of the row, which is a target you cannot miss. It is on the handle
        and not on the row, so the slop never reaches the name or the checkbox.
      */}
      {estrecho ? null : (
      <>
      <GestureDetector gesture={gesture}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('items.dragToReorder')}
          {...pista.props}
          /*
            **Moving the row without dragging it**, because a drag is the one
            gesture nobody can do with a screen reader or with a switch.

            Increment and decrement are the two names the platform already
            understands for "this goes up" and "this goes down", and they land on
            the same `onReorder` the finger does, so a list can be put in order
            without ever being dragged.
          */
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === 'increment') commit(index - 1);
            if (event.nativeEvent.actionName === 'decrement') commit(index + 1);
          }}
          hitSlop={20}
          style={styles.handle}
        >
          <Ionicons name="reorder-two" size={18} color={theme.colors.textMuted} />
        </Pressable>
      </GestureDetector>
      {pista.node}
      </>
      )}
    </View>
  );
}

/**
 * The room the handle takes on the right of a row.
 *
 * Exported because the row has to end before it, and a row that does not is a
 * row whose name runs under the handle: the number was written down twice — once
 * here as `right: 8` plus the padding of the glyph, and once in the row as a
 * guess — and the two of them only agreed because somebody typed 28.
 */
export const DRAG_HANDLE_WIDTH = 40;

/**
 * How a row goes back to its place, **and it is a timing and not a spring**.
 *
 * It was `withSpring(0, { damping: 18, stiffness: 220 })`, which is a spring that
 * overshoots by arithmetic: a mass of one on a stiffness of 220 needs a damping of
 * 2·√220 = **29.7** to come to rest without passing the target, and 18 is well
 * under it. So the row went past the row it had just been dropped on, came back,
 * and settled — the bounce, on every drop, on every row of the list.
 *
 * **A `withTiming` cannot pass the target**: it interpolates between two numbers
 * and stops there. So the row lands and stays landed, which is what "no bounce at
 * all" means, and 170 ms with a decelerating curve reads as the row settling
 * rather than as the row travelling across the screen.
 *
 * The spring is not missed anywhere else: the shadow under a row being dragged and
 * the pill of the tabs are the two that want a little life in them, and they have
 * it.
 */
const SOLTAR = { duration: 170, easing: Easing.out(Easing.cubic) } as const;

const ROW_HEIGHT_DEFAULT = 64;

const styles = StyleSheet.create({
  wrapper: {
    position: 'relative',
    /*
      The row is not text, it is a thing you move, **and on the web the browser
      disagrees.**

      The drag starts on the handle, which is not text, but the finger then travels
      over the row below and Chromium — which starts a selection from any
      `mousedown` that moves, and has no notion of "this is a drag and not a
      text selection" — highlights every label it passes and **leaves them
      highlighted after the drop**. The reorder sheet went from a list of cards to
      a page of blue text with a shadow under one of them.

      `user-select: none` is a no-op on Android and iOS, which have no text
      selection outside an input, so this costs nothing there and fixes the only
      platform that had the problem.
    */
    userSelect: 'none',
  },
  dragging: {
    opacity: 0.98,
  },
  /*
    40 de ancho y no 26, medido en web: el asa media 18 de glifo mas 4 de relleno a
    cada lado, y 26 es por debajo de lo que un dedo alcanza con fiabilidad. El alto
    ya era el de la fila entera, que es lo que hacia el blanco util en vertical.

    El glifo se queda donde estaba: el blanco crece **hacia dentro** y el icono se
    centra, asi que a simple vista el asa no se ha movido y lo unico que cambia es
    lo que se puede pulsar. Por eso `DRAG_HANDLE_WIDTH` pasa a 40: el hueco que la
    fila reserva a la derecha tiene que medir lo que el asa ocupa de verdad, o el
    nombre del titular acabaria debajo del asa.
  */
  handle: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: DRAG_HANDLE_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
