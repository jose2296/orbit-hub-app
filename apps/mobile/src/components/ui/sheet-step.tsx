import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";

/** The spring of the morph (`MORPH_SPRING` in `sheet.tsx`), so both move as one. */
const SPRING = { damping: 26, stiffness: 190, mass: 1 } as const;

export interface SheetStepProps {
  /** The step being shown. A change of value is a change of page. */
  step: string;
  children: ReactNode;
}

/**
 * The page change inside a `Sheet`, in the same language as the morph that opens
 * it: the new page **settles into place** (fades in while it grows from 96% to
 * 100%) instead of travelling across.
 *
 * The fade starts a little late and the scale starts at once, and that gap is the
 * point: the panel is already springing to the new height, and the content shows
 * up once there is room for it, exactly as the content of the open morph waits for
 * the panel to be big enough. Nothing moves sideways, so going forward and going
 * back look the same, and that is on purpose.
 *
 * It only decides how the page appears. State, `onBack`, the footer and the panel
 * height stay with the sheet. Only the entering page is animated: the leaving one
 * is gone in the same frame, so there is never a frame with two pages on top of
 * each other.
 */
export function SheetStep({ step, children }: SheetStepProps) {
  const previous = useRef(step);
  const progress = useSharedValue(1);

  useEffect(() => {
    if (previous.current === step) return;
    previous.current = step;
    progress.value = 0;
    progress.value = withSpring(1, SPRING);
  }, [step, progress]);

  const style = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0.1, 0.65], [0, 1], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(progress.value, [0, 1], [0.96, 1], Extrapolation.CLAMP) }],
    transformOrigin: "top",
  }));

  return <Animated.View style={style}>{children}</Animated.View>;
}
