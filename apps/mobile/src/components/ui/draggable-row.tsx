import { Ionicons } from '@expo/vector-icons';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { useTranslation } from '@/lib/i18n';
import { useTheme } from '@/theme';

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
 * A row that can be dragged to reorder.
 *
 * The gesture follows the finger and the row springs back when released. The
 * target index is computed on the UI thread from the row height, and only the
 * committed result is handed back to the parent, so nothing is written to the
 * outbox while the user is still dragging.
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

  const translateY = useSharedValue(0);
  const startY = useSharedValue(0);
  const isDragging = useSharedValue(false);

  const ROW_HEIGHT = ROW_HEIGHT_DEFAULT;
  const rowHeight = useSharedValue(ROW_HEIGHT);
  const offsetIndex = useSharedValue(0);

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
      runOnJS(setDraggingState)(true);
    })
    .onUpdate((event) => {
      translateY.value = startY.value + event.translationY;
      const shift = Math.round(event.translationY / rowHeight.value);
      offsetIndex.value = Math.max(-index, Math.min(shift, total - 1 - index));
    })
    .onEnd(() => {
      runOnJS(commit)(index + offsetIndex.value);
      translateY.value = withSpring(0, { damping: 18, stiffness: 220 });
      isDragging.value = false;
      runOnJS(setDraggingState)(false);
    })
    .onFinalize(() => {
      translateY.value = withSpring(0, { damping: 18, stiffness: 220 });
      isDragging.value = false;
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: translateY.value },
      // The rows below the dragged one make room, which is what makes the drop
      // target visible instead of a guess.
      { scale: isDragging.value ? 1.02 : 1 },
    ],
    zIndex: isDragging.value ? 10 : 0,
    shadowOpacity: isDragging.value ? 0.2 : 0,
  }));

  return (
    <View style={styles.wrapper}>
      <GestureDetector gesture={gesture}>
        <Animated.View
          style={[
            {
              borderRadius: theme.radius.lg,
              backgroundColor: theme.colors.surface,
              ...theme.shadow.card,
            },
            dragging ? styles.dragging : null,
            animatedStyle,
          ]}
        >
          {children}
        </Animated.View>
      </GestureDetector>

      {/* The handle is the explicit affordance: the row body stays tappable. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('items.dragToReorder')}
        accessibilityHint={t('items.dragHint')}
        hitSlop={8}
        style={styles.handle}
        onLongPress={() => setDraggingState(true)}
      >
        <Ionicons name="reorder-two" size={18} color={theme.colors.textMuted} />
      </Pressable>
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
