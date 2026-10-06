import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useMemo, useRef, useState } from "react";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { StyleSheet, View } from "react-native";

import { HUE_STRIP, hexToHsv, hsvToHex, puntoAHsv, puntoAHue } from "@/lib/workspace/picker";
import type { Hsv } from "@/lib/workspace/picker";

export interface ColorSquareProps {
  /**
   * The colour the square opens on, as hex.
   *
   * Any case: it is read through `hexToHsv`, which takes six digits with or
   * without the hash. What comes back out of `onChange` is always the
   * canonical `#RRGGBB` uppercase of `hsvToHex` — callers that compare do it
   * case-insensitively or canonicalise first.
   */
  color: string;
  /**
   * Called with every move, **not on release.**
   *
   * Live and not committed, on purpose: the caller decides what "commit" means
   * — the workspace writes on its check so a drag does not enqueue a hundred
   * operations, a state sheet stages into its own state and saves on its button.
   * A square that wrote would make that choice for them.
   */
  onChange: (hex: string) => void;
  /** Both sides in points, and square on purpose (see below). */
  size?: number;
  /** Front for the square's and the strip's `testID`s, when a walkthrough needs them. */
  testIDPrefix?: string;
  /** What a screen reader calls the square and the hue strip. */
  squareLabel: string;
  hueLabel: string;
}

/**
 * A saturation square with its hue strip: any colour, by dragging.
 *
 * **Extracted out of `workspace-color-picker.tsx`, which drew this exact square
 * for spaces**, because states pick free colours now and two squares are two
 * markers that stop agreeing with the finger. What it draws and how it is
 * dragged is unchanged: saturation across and brightness down (the arrangement
 * every phone already teaches), hue underneath, marker from measured sizes and
 * not assumed ones, `touch-action: none` so the browser hands the gesture over
 * instead of scrolling the sheet from under the finger.
 *
 * The hsv lives here and the hex lives outside: the square reads `color` on
 * open and on every change of it, and reports every move through `onChange`.
 * A caller that stages (a sheet with a save button) and a caller that commits
 * on check (a space) both work, because neither decision is made here.
 */
export function ColorSquare({
  color,
  onChange,
  size = 132,
  testIDPrefix,
  squareLabel,
  hueLabel,
}: ColorSquareProps) {
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(color));
  useEffectSync(color, setHsv);

  /**
   * The measured sizes, in state and not in a ref.
   *
   * The marker is painted from these, and a ref does not repaint: the first
   * version held the measured width in a ref and drew the marker with an assumed
   * size, so on a real phone the marker sat a third of the way across a box
   * twice as wide, and the thing under the finger was never the thing picked.
   * `onLayout` is the only thing that knows the real number.
   */
  const [caja, setCaja] = useState({ width: size, height: size });
  const [anchoTira, setAnchoTira] = useState(0);

  const moverCuadrado = (x: number, y: number) => {
    const siguiente = puntoAHsv(x, y, caja.width, caja.height, hsv.h);
    setHsv(siguiente);
    onChange(hsvToHex(siguiente));
  };
  const moverTira = (x: number) => {
    const siguiente = { ...hsv, h: puntoAHue(x, anchoTira) };
    setHsv(siguiente);
    onChange(hsvToHex(siguiente));
  };

  /*
    The latest callbacks read from refs, because a gesture must not be rebuilt
    while a finger is on it: the movers close over the measured box, so closing
    over them directly would rebuild the gesture on every frame of a drag.
  */
  const moverCuadradoRef = useRef(moverCuadrado);
  moverCuadradoRef.current = moverCuadrado;
  const moverTiraRef = useRef(moverTira);
  moverTiraRef.current = moverTira;

  const gestoCuadrado = useMemo(
    () =>
      Gesture.Pan()
        // From the first pixel: tapping the square is a choice, and waiting for
        // a threshold would mean a tap lands nowhere.
        .minDistance(0)
        .onBegin((e) => moverCuadradoRef.current(e.x, e.y))
        .onUpdate((e) => moverCuadradoRef.current(e.x, e.y)),
    [],
  );

  const gestoTira = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(0)
        .onBegin((e) => moverTiraRef.current(e.x))
        .onUpdate((e) => moverTiraRef.current(e.x)),
    [],
  );

  return (
    <View style={{ gap: 8 }}>
      {/* Saturation across, brightness down. Two gradients laid on top of each
          other: white to the hue, and then transparent to black. */}
      <GestureDetector gesture={gestoCuadrado}>
        <View
          {...(testIDPrefix ? { testID: `${testIDPrefix}-square` } : null)}
          onLayout={(e) =>
            setCaja({
              width: e.nativeEvent.layout.width,
              height: e.nativeEvent.layout.height,
            })
          }
          accessibilityRole="adjustable"
          accessibilityLabel={squareLabel}
          style={[
            styles.cuadrado,
            { width: size, height: size, borderRadius: 8 },
          ]}
        >
          <LinearGradient
            colors={["#FFFFFF", hsvToHex({ ...hsv, s: 1 })]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={StyleSheet.absoluteFill}
          />
          <LinearGradient
            colors={["rgba(0,0,0,0)", "rgba(0,0,0,1)"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <View
            pointerEvents="none"
            style={[
              styles.marcador,
              {
                left: hsv.s * caja.width - 10,
                top: (1 - hsv.v) * caja.height - 10,
                // A ring that shows on both a white and a black background, and
                // not a white ring that vanishes on the pale corner.
                borderColor:
                  hsv.v > 0.55 && hsv.s < 0.6 ? "#0B1120" : "#FFFFFF",
              },
            ]}
          />
        </View>
      </GestureDetector>

      {/* The hue, under the square, the way every other picker has it. */}
      <GestureDetector gesture={gestoTira}>
        <View
          {...(testIDPrefix ? { testID: `${testIDPrefix}-hue` } : null)}
          onLayout={(e) => setAnchoTira(e.nativeEvent.layout.width)}
          accessibilityRole="adjustable"
          accessibilityLabel={hueLabel}
          style={[styles.tira, { borderRadius: 8 }]}
        >
          <LinearGradient
            colors={[...HUE_STRIP]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={StyleSheet.absoluteFill}
          />
          <View
            pointerEvents="none"
            style={[
              styles.marcadorTira,
              { left: (hsv.h / 360) * anchoTira - 9 },
            ]}
          />
        </View>
      </GestureDetector>
    </View>
  );
}

/**
 * Follow the prop, and only the prop.
 *
 * Syncing on every render would take the square back while it is being dragged;
 * syncing on `color` follows a swatch press, a side switch and a reopen — the
 * three moments the square must show something the finger did not put there.
 */
function useEffectSync(color: string, setHsv: (hsv: Hsv) => void) {
  useEffect(() => {
    setHsv(hexToHsv(color));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [color]);
}

const styles = StyleSheet.create({
  cuadrado: {
    flexShrink: 0,
    overflow: "hidden",
    // `touch-action: none`, and it is what makes the drag work at all on the
    // web: without it the browser keeps the finger to scroll and the gesture
    // never activates.
    touchAction: "none",
  },
  tira: {
    // No `flex: 1`: in a column `flex-basis` is the height, so it would
    // overwrite the 24 below with zero and the strip would measure 132x0 —
    // on screen nowhere, and a view of no height gets no touch either.
    height: 24,
    flexShrink: 0,
    overflow: "hidden",
    touchAction: "none",
  },
  marcador: {
    position: "absolute",
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
  },
  marcadorTira: {
    position: "absolute",
    top: 3,
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 3,
    borderColor: "#FFFFFF",
    shadowColor: "#000000",
    shadowOpacity: 0.4,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
  },
});
