import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Pressable, StyleSheet } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTranslation } from "@/lib/i18n";
import { useTheme } from "@/theme";

export interface TrayOrigin {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type TrayPreset = "smooth" | "snappy" | "bouncy";

/** Spring configs: the only thing that changes between presets is the feel. */
const PRESETS = {
  smooth: { damping: 26, stiffness: 190, mass: 1 },
  snappy: { damping: 30, stiffness: 420, mass: 0.9 },
  bouncy: { damping: 13, stiffness: 210, mass: 1 },
} as const;

const MARGIN = 12;

export interface MorphTrayProps {
  visible: boolean;
  onClose: () => void;
  /** Where the tray grows from. Without it the tray rises from the bottom edge. */
  origin: TrayOrigin | null;
  /** Height of the current view; changing it morphs the tray to the new size. */
  height: number;
  preset?: TrayPreset;
  children: ReactNode;
}

/**
 * A tray that grows out of the control that opened it instead of sliding in
 * from the edge. Pure Reanimated + gesture-handler, so it runs the same on
 * Android, iOS and web; a native-only library would break the web target.
 *
 * One shared value (`progress`, 0 → 1) drives position, size, radius, backdrop
 * and content fade; `height` is a second one, so switching views is a spring
 * on the size and not a remount.
 */
export function MorphTray({
  visible,
  onClose,
  origin,
  height,
  preset = "smooth",
  children,
}: MorphTrayProps) {
  const theme = useTheme();
  const t = useTranslation();
  const insets = useSafeAreaInsets();
  // Measured, not the window: the tray lives in the screen below the header, and
  // `origin` is expressed in the same coordinates.
  const [{ w: winW, h: winH }, setBox] = useState({ w: 0, h: 0 });

  const [mounted, setMounted] = useState(visible);
  const progress = useSharedValue(0);
  const alto = useSharedValue(height);
  const drag = useSharedValue(0);

  const config = PRESETS[preset];
  const trayW = Math.min(winW - MARGIN * 2, 520);
  const trayX = (winW - trayW) / 2;
  const bottom = Math.max(insets.bottom, MARGIN);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      drag.value = 0;
      progress.value = withSpring(1, config);
    } else {
      progress.value = withSpring(0, { ...PRESETS.snappy, overshootClamping: true }, (done) => {
        if (done) runOnJS(setMounted)(false);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useEffect(() => {
    alto.value = withSpring(height, config);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height, preset]);

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      drag.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      if (drag.value > 90 || e.velocityY > 900) {
        runOnJS(onClose)();
      } else {
        drag.value = withSpring(0, PRESETS.snappy);
      }
    });

  const o = origin ?? { x: trayX, y: winH, width: trayW, height: 0 };

  const trayStyle = useAnimatedStyle(() => {
    const p = progress.value;
    const targetTop = winH - bottom - alto.value;
    return {
      left: interpolate(p, [0, 1], [o.x, trayX]),
      width: interpolate(p, [0, 1], [o.width, trayW]),
      top: interpolate(p, [0, 1], [o.y, targetTop]) + drag.value,
      height: interpolate(p, [0, 1], [o.height, alto.value]),
      borderRadius: interpolate(p, [0, 1], [theme.radius.pill, 28]),
      opacity: interpolate(p, [0, 0.08], [0, 1], Extrapolation.CLAMP),
    };
  });

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 1], [0, 1], Extrapolation.CLAMP),
  }));

  const contentStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0.45, 0.9], [0, 1], Extrapolation.CLAMP),
    transform: [
      { translateY: interpolate(progress.value, [0.45, 1], [14, 0], Extrapolation.CLAMP) },
      { scale: interpolate(progress.value, [0.45, 1], [0.96, 1], Extrapolation.CLAMP) },
    ],
  }));

  if (!mounted) return null;

  return (
    <Animated.View
      style={StyleSheet.absoluteFill}
      pointerEvents="box-none"
      onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
    >
      <Animated.View
        style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.overlay }, backdropStyle]}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel={t("common.close")} />
      </Animated.View>
      <GestureDetector gesture={pan}>
        <Animated.View
          style={[
            styles.tray,
            {
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.border,
              shadowColor: theme.colors.shadow,
            },
            trayStyle,
          ]}
        >
          <Animated.View style={[styles.content, contentStyle]}>{children}</Animated.View>
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
}

/** Cross-fade helper for the view inside a tray; keyed by view name. */
export function TrayView({ children }: { children: ReactNode }) {
  const o = useSharedValue(0);
  useEffect(() => {
    o.value = withTiming(1, { duration: 220 });
  }, [o]);
  const style = useAnimatedStyle(() => ({
    opacity: o.value,
    transform: [{ translateX: (1 - o.value) * 18 }],
  }));
  return <Animated.View style={style}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  tray: {
    position: "absolute",
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    shadowOpacity: 0.25,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  content: { flex: 1, padding: 20 },
});
