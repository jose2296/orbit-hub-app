import { Ionicons } from '@expo/vector-icons';
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
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
  /** How tall a row is, in the list being dragged. */
  rowHeight: SharedValue<number>;
}

const SortContext = createContext<SortState | null>(null);

/**
 * Wraps a list that can be reordered by dragging its rows.
 *
 * It holds the three numbers every row needs to make room. It is a provider and
 * not a prop on the row because the rows are inside a `FlatList`, and passing
 * four shared values through `renderItem` on every row is a prop list that has
 * to be kept in step with the component by hand.
 */
export function DraggableSort({ children }: { children: ReactNode }) {
  const draggingId = useSharedValue<string | null>(null);
  const fromIndex = useSharedValue(0);
  const toIndex = useSharedValue(0);
  const rowHeight = useSharedValue(ROW_HEIGHT_DEFAULT);

  const value = useMemo(
    () => ({ draggingId, fromIndex, toIndex, rowHeight }),
    [draggingId, fromIndex, toIndex, rowHeight],
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

  const setDraggingState = useCallback(
    (value: boolean) => {
      setDragging(value);
      onDragStateChange?.(value);
    },
    [onDragStateChange],
  );

  const gesture = Gesture.Pan()
    // A drag has to beat the row's own taps, but not steal a scroll.
    .activateAfterLongPress(200)
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
      translateY.value = withSpring(0, { damping: 18, stiffness: 220 });
      isDragging.value = false;
      if (sort) sort.draggingId.value = null;
      runOnJS(setDraggingState)(false);
    })
    .onFinalize(() => {
      translateY.value = withSpring(0, { damping: 18, stiffness: 220 });
      isDragging.value = false;
      if (sort) sort.draggingId.value = null;
    });

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
  // a checkbox, a drag handle and no item. On a row that narrow the drag is not
  // usable either — a finger covers the whole thing — so the handle goes and the
  // name comes back.
  const [ancho, setAncho] = useState(0);
  const estrecho = ancho > 0 && ancho < 210;

  const pista = useA11yHint(t('items.dragHint'));

  return (
    <View
      style={styles.wrapper}
      onLayout={(event) => {
        setAncho(event.nativeEvent.layout.width);
        // Measured, not assumed: the rows are not all the same height, and a
        // gap of the wrong size is a drop target that is off by a row.
        const alto = event.nativeEvent.layout.height;
        if (sort && alto > 0) sort.rowHeight.value = alto;
      }}
    >
      <GestureDetector gesture={gesture}>
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
      </GestureDetector>

      {/* The handle is the explicit affordance: the row body stays tappable. */}
      {estrecho ? null : (
      <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('items.dragToReorder')}
        {...pista.props}
        hitSlop={8}
        style={styles.handle}
        onLongPress={() => setDraggingState(true)}
      >
        <Ionicons name="reorder-two" size={18} color={theme.colors.textMuted} />
      </Pressable>
      {pista.node}
      </>
      )}
    </View>
  );
}

const ROW_HEIGHT_DEFAULT = 64;

const styles = StyleSheet.create({
  wrapper: {
    position: 'relative',
  },
  dragging: {
    opacity: 0.98,
  },
  handle: {
    position: 'absolute',
    right: 8,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
});
