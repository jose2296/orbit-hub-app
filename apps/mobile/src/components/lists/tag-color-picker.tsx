import { Ionicons } from "@expo/vector-icons";
import { derivedTagColor } from "@orbit-hub/contracts";
import { LinearGradient } from "expo-linear-gradient";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import type { AccessibilityActionEvent } from "react-native";
import { runOnJS } from "react-native-reanimated";

import { useTranslation } from "@/lib/i18n";
import {
  ICON_COLOR_KEYS,
  ICON_COLOR_LABEL,
  ICON_COLORS,
  iconColor,
} from "@/lib/lists/item-icons";
import {
  hexDeHsv,
  normalizaHex,
  tagColorHex,
  tintaDe,
} from "@/lib/lists/tag-colors";
// `clamp01` comes from here and not from `./picker`, which re-exports the
// conversions and the two pointer functions and not the clamp: `puntoAHsv` and
// `puntoAHue` are the pointer's way of reaching it, and the arrow keys below are
// not a pointer. `test/color-picker-math.test.ts` reads it from this file too, so
// this is not a new way into it.
import { clamp01 } from "@/lib/workspace/hsl";
import { HUE_STRIP, hexToHsv, puntoAHsv, puntoAHue } from "@/lib/workspace/picker";
import { useTheme } from "@/theme";

import { selectedProps } from "../ui/a11y-state";
import { AppText } from "../ui/text";

export { hexDeHsv, normalizaHex, tintaDe };

/**
 * The colour of one label: the twelve the app draws with, a hue strip, a square
 * and a field for the exact one.
 *
 * **Everything painted here is the colour that was chosen, not the colour the
 * label will be read in.** A pill takes its text to 4.5:1 against its own fill by
 * moving that text —`labelPillColors`, in `@/lib/lists/tag-colors`— and it ends up
 * far from the chosen colour: in the light theme most of the twelve land near
 * black. So the pill cannot be the place where a colour is judged, this panel is
 * the only place where it is, and the ring on the square, the tilde on a swatch
 * and the dot by the field are drawn in the colour under them.
 *
 * **The interface is not tested; the three functions that are, live next door.**
 * This repo does not mount components in `vitest run` —`test/task-row-layout.test.ts`
 * reads the source and `test/color-picker-math.test.ts` tests the arithmetic— so
 * `normalizaHex`, `hexDeHsv` and `tintaDe` are in `@/lib/lists/tag-colors` and are
 * re-exported here: `test/tag-color-picker.test.ts` cannot import this file, because
 * neither `@expo/vector-icons` nor `react-native-gesture-handler` loads outside a
 * device, measured with a test that imports `workspace-color-picker.tsx` and nothing
 * else. **Everything below the imports is checked in a browser, in Task 7.**
 *
 * ---
 *
 * **The recents are dead in every instance that closes itself, and only alive in the
 * one that does not.** Task 5 mounts this panel in two places and only one of them
 * keeps it: under the new-label field it is always visible, and beside a label the
 * task already carries it is mounted only while that label's picker is open —which is
 * the shape the strip it replaced had, so closing it does what closing it did.
 *
 * **`escribir` pushes into `recientes` and `pickColor` unmounts this panel in the same
 * `finally` that writes.** So in a pill-mounted instance a free colour is added to the
 * row and the row is destroyed in the same commit: it is never rendered, not even for
 * a frame, and the row is not "reset between openings" — it is **unreachable**, and
 * reopening finds nothing because nothing was ever there to keep. **Only the
 * always-visible instance accumulates anything**, which is where the row earns its
 * place: you type a name, you try a free colour on it, you change your mind about the
 * hue and it is one press away.
 *
 * The alternative was to keep the panel mounted and hide it, or to lift the recents
 * into the sheet and pass them in, and both were left out on purpose: hiding it keeps
 * a full picker —square, strip, field and thirteen swatches— in the tree and in the
 * accessibility order of a panel that is not showing it, and lifting the recents would
 * give `TagColorPicker` a second source for the same state, which is the shape that
 * ends with two lists of recents and one of them stale. A row that is only reachable
 * from one of two instances is odd, and it is a cost with a price on it: **a free
 * colour chosen for an existing label is not one press away next time — the twelve
 * are, and those are the colours most labels actually get.**
 */
export interface TagColorPickerProps {
  /** The colour currently chosen, or `null` for "derived from the name". */
  value: string | null;
  /** Called on every committed choice. `null` means "go back to derived". */
  onChange: (hex: string | null) => void;
  /** Omitted when the picker is mounted for a label that does not exist yet. */
  onClose?: () => void;
  /** The label name, used for the accessibility labels. */
  tag?: string;
}

/**
 * How many of this session's free colours are offered under the square.
 *
 * **In this panel's state and not in `lib/workspace/recent-colors.ts`, because that
 * one has no room for a label.** It keeps two lists, one per end of a wash, under a
 * key that says `recent-workspace-colors`, and its API asks which end — a question a
 * label has no answer to. There is no common place to read them from, so these are
 * local, and local means what it says: a panel that has just been mounted starts
 * with an empty row. With the panel mounted twice, as Task 5 mounts it, the two do
 * not see each other's.
 */
const MAX_RECIENTES = 8;

/**
 * The square's side, and why it is a number and not the width of the panel.
 *
 * A square wider than it is tall makes a drag across it cover more colour than the
 * same drag down it, and the marker drifts away from the finger. Beside the field
 * rather than above it, because a picker that takes the whole panel pushes the
 * thing that answers "is this the colour I meant?" off the screen.
 */
const TAMANO = 132;

/**
 * How far one press of an arrow key moves each of the two adjustable controls.
 *
 * Ten degrees and a tenth of saturation, and both are a compromise between two
 * things that want opposite numbers: one press has to be **one step you can hear**,
 * and the whole control has to be crossable in a number of presses somebody will
 * actually sit through. Thirty-six of these walk the length of the hue strip and
 * ten of them walk the width of the square, which is where both numbers come from.
 *
 * **A percentage point on brightness is the same step and it is not wired up**; see
 * `moverLaSaturacion` for why one axis gets the keys and the other does not.
 */
const PASO_DEL_TONO = 10;
const PASO_DE_LA_SATURACION = 0.1;

/**
 * The only two actions either control answers, and the same two on both.
 *
 * `accessibilityRole="adjustable"` promises a control that the arrow keys move; on
 * its own that promise is empty, because the role says what kind of control this is
 * and not what pressing up does to it. These are the two names React Native defines
 * for it —anything else lands in a platform's custom-action menu instead of on the
 * arrow keys— and they are declared once here because both controls answer exactly
 * these two and a third would be answered by neither.
 */
const ACCIONES_DE_UN_EJE = [
  { name: "increment" },
  { name: "decrement" },
] as const;

/**
 * The colour a panel opens on: the chosen one, or the one the name derives.
 *
 * `value` is a hex or one of the twelve names —a build from before free colours
 * wrote names— and `tagColorHex` is what turns either into a hex, so this does not
 * decide for a second time what a colour is. A label with no name and nothing
 * chosen lands on that same function's own fallback, which is where "nobody chose"
 * is drawn.
 */
function hexDeValor(value: string | null, tag?: string): string {
  return tagColorHex(value ?? (tag ? derivedTagColor(tag) : "neutral"));
}

/**
 * Whether a hex is one of the twelve, read out of the twelve's own table.
 *
 * A comparison and not a list written here: `ICON_COLORS` is the only copy of those
 * hexes in the app, and a second copy is the one that does not get updated.
 */
function esDeLaPaleta(hex: string): boolean {
  return Object.values(ICON_COLORS).includes(hex);
}

/**
 * The colour of one label, and the ways to choose it.
 *
 * **The twelve come first and the free colour after**, because twelve swatches are
 * one press and a square is a hunt. **Nothing is written while a finger is on the
 * square**: the square moves a marker and the button underneath commits, for the
 * reason `workspace-color-picker.tsx` gives — a drag crosses every colour between
 * here and there, and a write per colour crossed is a queue full of operations and
 * a label flickering between colours while somebody is trying to look at one.
 */
export function TagColorPicker({ value, onChange, onClose, tag }: TagColorPickerProps) {
  const theme = useTheme();
  const t = useTranslation();

  /** The colour this label has now. */
  const hexGuardado = hexDeValor(value, tag);
  /** The one it goes back to, whether or not anyone has chosen. */
  const deducido = hexDeValor(null, tag);

  /** What the square is showing, which may not be what is saved. */
  const [hsv, setHsv] = useState(() => hexToHsv(hexGuardado));
  const [texto, setTexto] = useState(hexGuardado);
  const [mal, setMal] = useState(false);
  const [recientes, setRecientes] = useState<string[]>([]);

  /**
   * The square follows the colour whenever the colour changes from outside.
   *
   * Not only when a swatch is pressed: also when this panel's own "back to
   * derived" calls `onChange(null)`, and when the name under a label that does not
   * exist yet changes, because that is the colour such a label has. Without this
   * the square keeps showing a colour the label no longer has, with the commit
   * button lit and nothing behind it to commit.
   */
  useEffect(() => {
    setHsv(hexToHsv(hexGuardado));
    setTexto(hexGuardado);
    setMal(false);
  }, [hexGuardado]);

  const colorDelCuadrado = hexDeHsv(hsv.h, hsv.s, hsv.v);
  /*
    `sucio` se fue con el boton: era la comparacion que lo apagaba cuando no habia
    nada que escribir. Sin boton no hay nada que apagar.
  */

  /**
   * **Whose colour this panel is choosing**, and every accessible name below ends
   * with it.
   *
   * The tags page of the task sheet mounts this panel **twice at the same time**: the
   * one hanging off a pill, which writes straight away, and the one under the
   * new-label field, which writes into pending state. Two instances of the same
   * component on one panel means two of every control, and a screen reader announces
   * one control at a time with no memory of where it was — so two buttons called "Use
   * this colour" and two called "Save" and two adjustables called "Colour tone", each
   * committing **a different colour**, is a panel where the labels do not say which
   * one anything belongs to. That is new with the second mount, and no amount of
   * correct behaviour elsewhere makes it better.
   *
   * So every name is qualified, the way `tags.backToDerivedOf` already was —that one
   * was right before there were two panels and is the pattern, not a special case— and
   * the pending panel qualifies itself as **the new label** rather than with nothing:
   * "Colour tone of the new label" and "Colour tone of Mercadona" are two different
   * things being said, and "Colour tone" said twice is nothing at all.
   *
   * `recentColors` and `recentColorOf` are the two names that are **not** qualified,
   * and the reason is measured rather than hoped: the recents row only renders when
   * there is something in it, and in a pill-mounted panel there never is, because
   * `pickColor` unmounts the panel in the same `finally` that writes. One instance
   * renders that row, so its names are unambiguous. **If the panel ever stopped
   * closing on a write, those two keys would need a tag like the rest.**
   */
  const nombreDe = tag ?? t("tags.pendingLabel");

  /**
   * The one door every colour goes through, and the only place `onChange` is
   * called with one.
   *
   * A swatch, a recent, the square's button and the field all land here, so none of
   * them can hand the map a colour it does not accept: `normalizaHex` is the same
   * rule the server applies, and a colour it does not accept comes back as
   * "derived" with no error anywhere on the way.
   */
  const escribir = useCallback(
    (color: string) => {
      const hex = normalizaHex(color);
      if (hex === null) return;
      onChange(hex);
      setMal(false);
      // The recents are for the colours the twelve cannot answer, so a preset does
      // not go in: it is one press away already and would take the place of a free
      // colour that is not.
      if (!esDeLaPaleta(hex)) {
        setRecientes((previos) =>
          [hex, ...previos.filter((c) => c !== hex)].slice(0, MAX_RECIENTES),
        );
      }
    },
    [onChange],
  );

  /**
   * What the field says, written.
   *
   * A field that does not resolve is not written: the error appears and the last
   * colour stays, because a half-typed `#3B5` is not a colour anybody chose and
   * writing it would put a value in the map that the server drops.
   */
  const aplicarCampo = useCallback(() => {
    const hex = normalizaHex(texto);
    if (hex === null) {
      setMal(true);
      return;
    }
    setHsv(hexToHsv(hex));
    escribir(hex);
  }, [escribir, texto]);

  /**
   * The one option that is not a colour: `null` is "nobody chose", which is what the
   * deduced one already is, and there is no colour that means "nobody decided". It
   * clears the field's error because it is not a colour that failed to parse.
   */
  const volverAlDeducido = useCallback(() => {
    setMal(false);
    onChange(null);
  }, [onChange]);

  /*
   * The measured sizes are in state and not in a ref: the marker is painted from
   * them, and a ref does not repaint. `onLayout` is the only thing that knows the
   * real number, and it runs after the first paint, so the two differ exactly when
   * it matters.
   */
  const [caja, setCaja] = useState({ width: TAMANO, height: TAMANO });
  const [anchoTira, setAnchoTira] = useState(0);

  const alMoverCuadrado = useCallback(
    (x: number, y: number) =>
      setHsv((actual) => puntoAHsv(x, y, caja.width, caja.height, actual.h)),
    [caja.width, caja.height],
  );

  const alMoverTira = useCallback(
    (x: number) => setHsv((actual) => ({ ...actual, h: puntoAHue(x, anchoTira) })),
    [anchoTira],
  );

  /**
   * The hue from the arrow keys, and it **goes round the loop** instead of stopping.
   *
   * `HUE_STRIP` is seven colours and the seventh is the first, so the strip is a
   * circle: 350° followed by 10° is the short way round and not fifty degrees back
   * through green. `puntoAHue` clamps rather than wrapping, and that is right for it
   * —a drag that leaves the strip has run out of gradient to follow— but the arrow
   * keys are not leaving the strip, they are on it, so they wrap. The double modulo
   * is what makes it so from a negative angle too: `-5 % 360` is `-5`.
   */
  const moverElTono = useCallback(
    (delta: number) =>
      setHsv((actual) => ({ ...actual, h: (((actual.h + delta) % 360) + 360) % 360 })),
    [],
  );

  /**
   * The square from the arrow keys: **one axis of the two, and on purpose.**
   *
   * An adjustable control gets one pair of arrow keys and one `accessibilityValue`
   * number, so a two-axis square can only answer one of its axes with them.
   * Saturation is the one that gets them, because it is what separates a colour from
   * a washed-out version of itself, and both extremes of it are the same colour.
   * Brightness is **said out loud** in the same `accessibilityValue.text` and moved
   * with the hex field beside it, which takes any colour: so it is reachable without
   * a drag, just not with the arrow keys. That is a real limit of the platform
   * control and not a choice that could be coded around, and the field is the way
   * out of it.
   */
  const moverLaSaturacion = useCallback(
    (delta: number) => setHsv((actual) => ({ ...actual, s: clamp01(actual.s + delta) })),
    [],
  );

  /**
   * The two handlers, one per axis, and they are written out instead of coming from
   * a factory because `useCallback` needs a stable identity to keep one: a handler
   * built by a `makeHandler(mover)` inside the render body is a new function on
   * every pixel of a drag, and this is a control that re-renders sixty times a
   * second while somebody moves the square.
   */
  const enElTono = useCallback(
    (event: AccessibilityActionEvent): void => {
      if (event.nativeEvent.actionName === "increment") moverElTono(PASO_DEL_TONO);
      else if (event.nativeEvent.actionName === "decrement") moverElTono(-PASO_DEL_TONO);
    },
    [moverElTono],
  );

  const enLaSaturacion = useCallback(
    (event: AccessibilityActionEvent): void => {
      if (event.nativeEvent.actionName === "increment") moverLaSaturacion(PASO_DE_LA_SATURACION);
      else if (event.nativeEvent.actionName === "decrement") moverLaSaturacion(-PASO_DE_LA_SATURACION);
    },
    [moverLaSaturacion],
  );

  /*
   * Two drags, as gestures and not as `PanResponder`, for the reason
   * `workspace-color-picker.tsx` gives in full: on the web the browser keeps the
   * finger to scroll or to drag the document unless the view says `touch-action:
   * none`, which react-native-web drops from the style before it reaches CSS. The
   * latest callback comes from a ref because a gesture must not be rebuilt while a
   * finger is on it —`alMoverCuadrado` closes over the measured box.
   */
  const alMoverCuadradoRef = useRef(alMoverCuadrado);
  alMoverCuadradoRef.current = alMoverCuadrado;
  const alMoverTiraRef = useRef(alMoverTira);
  alMoverTiraRef.current = alMoverTira;

  /*
    The two arrows on the JS thread. Created **once** and reading the ref each time
    they are called, which is all that is needed for the gesture not to be rebuilt
    with a finger on it without keeping the first render's measured width.
  */
  const moverCuadrado = useCallback((x: number, y: number) => {
    alMoverCuadradoRef.current(x, y);
  }, []);
  const moverTira = useCallback((x: number) => {
    alMoverTiraRef.current(x);
  }, []);

  /*
    El commit, **al levantar el dedo y no en un boton**.

    Igual que en el picker del espacio: el cuadrado y la tira mueven una
    previsualizacion local mientras el dedo esta encima, y al soltar se escribe lo
    que quedo. Un boton aparte para decir "usa esto" pedia confirmar dos veces lo
    mismo —elegir el color y decir que lo elegiste.

    Y un toque cuenta como un arrastre de un pixel: el gesto del cuadrado tiene
    `minDistance(0)`, asi que tocarlo tambien pasa por `onBegin`/`onEnd` y tambien
    escribe. Sin esto, quitar el boton dejaba al toque sin puerta.
  */
  const hsvRef = useRef(hsv);
  hsvRef.current = hsv;
  const alTerminar = useCallback(() => {
    escribir(hexDeHsv(hsvRef.current.h, hsvRef.current.s, hsvRef.current.v));
  }, [escribir]);
  const alTerminarRef = useRef(alTerminar);
  alTerminarRef.current = alTerminar;
  const terminar = useCallback(() => {
    alTerminarRef.current();
  }, []);

  const gestoCuadrado = useMemo(
    () =>
      Gesture.Pan()
        // From the first pixel: tapping the square is a choice, and a threshold
        // would mean a tap lands nowhere.
        /*
          `runOnJS`, for the reason `workspace-color-picker.tsx` gives in full: a
          gesture callback runs on the UI thread, and `alMoverCuadradoRef.current` is
          an ordinary JavaScript function living on the JS thread. Called from there it
          does not run — the call stays on the thread that cannot run it. The gesture
          registers, the app opens, the finger moves across the square and the colour
          does not change. It breaks nothing at compile time or at launch, which is
          what makes it this bad.

          **And the `runOnJS` wraps an arrow, not the callback.** `runOnJS(fn)` returns
          a new function, and that call is evaluated **when the gesture is built** —
          once, because the `useMemo` above has `[]`. Writing
          `runOnJS(alMoverCuadradoRef.current)(e.x, e.y)` therefore looks like it reads
          the ref on every movement and does not: it keeps whatever the ref held on the
          first render, when `onLayout` had not run yet and the box was still the
          assumed width and `anchoTira` was 0.

          That was true of this file as well as the workspace one, and it is why the
          square came out wrong and the whole strip did nothing —with a width of 0,
          `puntoAHue` returns hue 0 every time. The arrow is created once, so the
          gesture is not rebuilt with a finger on it, and it reads the ref **when it is
          called**, which is the moment that matters.
        */
        .onBegin((e) => runOnJS(moverCuadrado)(e.x, e.y))
        .onUpdate((e) => runOnJS(moverCuadrado)(e.x, e.y))
        /*
          Solo al terminar con exito, y no en `onFinalize`: un gesto cancelado no
          es una eleccion, y escribirlo guardaria el color donde el dedo iba de
          paso. `onEnd` es el dedo levantado a proposito.
        */
        .onEnd(() => runOnJS(terminar)()),
    [],
  );

  const gestoTira = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(0)
        .onBegin((e) => runOnJS(moverTira)(e.x))
        .onUpdate((e) => runOnJS(moverTira)(e.x))
        .onEnd(() => runOnJS(terminar)()),
    [],
  );

  return (
    <View style={{ gap: theme.spacing.md }}>
      <AppText variant="caption" tone="subtle">
        {t("tags.colorOf", { name: nombreDe })}
      </AppText>

      {/*
        The thirteen answers to one question —the derived colour and the twelve— as
        one group. One `radiogroup` and not two blocks, because they are one choice
        and `selectedProps` is what puts `aria-selected` in the DOM for all of them.
      */}
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={t("tags.colorOf", { name: nombreDe })}
        style={{ gap: theme.spacing.sm }}
      >
        <Pressable
          accessibilityRole="radio"
          accessibilityLabel={t("tags.backToDerivedOf", { name: nombreDe })}
          {...selectedProps(value === null)}
          onPress={volverAlDeducido}
          style={({ pressed }) => [
            styles.deducido,
            {
              backgroundColor: theme.colors.surfaceMuted,
              borderColor: value === null ? theme.colors.accent : theme.colors.border,
              borderRadius: theme.radius.md,
              opacity: pressed ? 0.8 : 1,
            },
          ]}
        >
          {/* In the colour the label goes back to: the point of the option is which
              colour that is. */}
          <View
            style={[
              styles.deducidoPunto,
              { backgroundColor: deducido, borderRadius: theme.radius.pill },
            ]}
          />
          <AppText
            variant="callout"
            numberOfLines={1}
            style={{ flex: 1, color: value === null ? theme.colors.accent : undefined }}
          >
            {t("tags.backToDerivedOf", { name: nombreDe })}
          </AppText>
          {value === null ? (
            <Ionicons name="checkmark" size={16} color={theme.colors.accent} />
          ) : null}
        </Pressable>

        <View style={[styles.rejilla, { gap: theme.spacing.xs }]}>
          {ICON_COLOR_KEYS.map((option) => {
            const hex = iconColor(option);
            /*
             * Compared as colours and not against `value`: the map can hold one of
             * the twelve names from a build from before free colours, and the same
             * colour in two forms is the same choice. And `value !== null`, because
             * with nothing chosen the label *is* painted one of the twelve and none
             * of the twelve is chosen.
             */
            const elegido = value !== null && hexGuardado === hex;
            return (
              <Pressable
                key={option}
                accessibilityRole="radio"
                accessibilityLabel={t("tags.colorSwatchOf", {
                  color: t(ICON_COLOR_LABEL[option]),
                  name: nombreDe,
                })}
                {...selectedProps(elegido)}
                onPress={() => {
                  setHsv(hexToHsv(hex));
                  escribir(hex);
                }}
                style={({ pressed }) => [
                  styles.muestra,
                  {
                    backgroundColor: hex,
                    // The border takes its place whether or not it has a colour, so
                    // the row does not jump under the finger when one is chosen.
                    borderColor: elegido ? theme.colors.accent : "transparent",
                    borderRadius: theme.radius.pill,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
              >
                {elegido ? <Ionicons name="checkmark" size={16} color={tintaDe(hex)} /> : null}
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* The hue across the whole panel: it is 24 points tall, and a drag along it crosses
          the whole circle. */}
      <GestureDetector gesture={gestoTira}>
        <View
          onLayout={(e) => setAnchoTira(e.nativeEvent.layout.width)}
          accessibilityRole="adjustable"
          accessibilityLabel={t("tags.colorHueOf", { name: nombreDe })}
          /*
           * What the role promised and what it did not. `adjustable` on its own is a
           * label with nothing behind it: a screen reader says "adjustable" and then
           * the arrow keys do nothing at all, which is the worst shape a control can
           * have — it advertises an interaction it refuses. So the value it moves is
           * the hue in degrees and the two arrow-key actions move it.
           *
           * **The text is degrees and not a colour name on purpose**: the whole strip
           * is one hue at a time, so the name would be the same number of different
           * words and the one thing a listener needs — where in the circle this is —
           * is the number.
           *
           * **None of this reaches the browser, and none of it is verified anywhere.**
           * Measured in `node_modules/react-native-web@0.21.2`: neither
           * `accessibilityActions` nor `onAccessibilityAction` appears anywhere under
           * `dist/` — there is nothing to grep for and nothing that consumes them— and
           * `modules/AccessibilityUtil/propsToAccessibilityComponent.js` maps no role
           * called `adjustable`, so not even the role lands. That is the same hole
           * `a11y-state.ts` documents for `accessibilityState`, one level down.
           *
           * **So whether the arrow keys move the hue on a real device is unknown.**
           * Not "expected to work on the two platforms where a screen reader is a
           * device feature": unknown. There is no test here, no simulator and no
           * hardware behind these lines, and a comment that says the keys work is
           * claiming something nothing here protects — which is worse than saying
           * nothing, because the next reader takes it as measured. What is true is
           * only that the role is no longer empty: the value, the two actions and the
           * handlers are the ones React Native documents for it, and **whoever runs
           * this on a device with a screen reader is the first to find out whether that
           * was enough.**
           */
          accessibilityValue={{
            min: 0,
            max: 360,
            now: Math.round(hsv.h),
            text: `${Math.round(hsv.h)}°`,
          }}
          accessibilityActions={ACCIONES_DE_UN_EJE}
          onAccessibilityAction={enElTono}
          style={[styles.tira, { borderRadius: theme.radius.sm }]}
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
              {
                left: (hsv.h / 360) * anchoTira - 9,
                /*
                 * **The ink of the colour under the ring, not a fixed white**, and
                 * this is the control that makes that matter: the strip is the only
                 * way to reach a hue the twelve do not have, so a ring that vanishes
                 * hides the one marker that is picking the arbitrary colour.
                 *
                 * Measured white against the six hues of `HUE_STRIP`: **1.07:1 on
                 * `#FFFF00`, 1.25 on `#00FFFF` and 1.37 on `#00FF00`** — three of the
                 * six below the 1.5 that is a hairline, against a ring that is three
                 * points wide. It was visible on the other three and that is what hid
                 * it: a marker that is there half the time reads as being flaky.
                 *
                 * The colour under it is **saturation and brightness at one**, not
                 * `colorDelCuadrado`: the ring is painted on the strip, the strip is
                 * `HUE_STRIP` whatever the square happens to be showing, and taking
                 * the square's brightness here would pick the ink off a surface that
                 * is not there — the same mistake `marcador` avoids by asking for the
                 * colour of its own square.
                 */
                borderColor: tintaDe(hexDeHsv(hsv.h, 1, 1)),
              },
            ]}
          />
        </View>
      </GestureDetector>

      {/*
        The square and the field **side by side**, and that is the whole layout of
        this panel: one finds the colour and the other says it exactly, and the
        button that commits what the square is showing sits with both.
      */}
      <View style={[styles.fila, { gap: theme.spacing.md }]}>
        {/* Saturation across, brightness down: two gradients laid on top of each
            other, white to the hue and then transparent to black. */}
        <GestureDetector gesture={gestoCuadrado}>
          <View
            onLayout={(e) =>
              setCaja({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })
            }
            accessibilityRole="adjustable"
            accessibilityLabel={t("tags.colorSquareOf", { name: nombreDe })}
            /*
             * The same promise as the strip's, kept: a value, the two actions and
             * what they do. `now`/`min`/`max` are **saturation in per cent** — the
             * axis the arrow keys move, chosen and argued in `moverLaSaturacion`—
             * and the text carries **both** axes, because a square is two numbers
             * and reading out only the one that moves leaves the brightness of the
             * colour the listener is choosing entirely unsaid.
             *
             * That text is a translated string and not a template with two names in
             * it: a sentence with a number in the middle is prose, and prose is what
             * `dictionaries.ts` is for.
             */
            accessibilityValue={{
              min: 0,
              max: 100,
              now: Math.round(hsv.s * 100),
              text: t("tags.colorSquareValue", {
                saturation: Math.round(hsv.s * 100),
                brightness: Math.round(hsv.v * 100),
              }),
            }}
            accessibilityActions={ACCIONES_DE_UN_EJE}
            onAccessibilityAction={enLaSaturacion}
            style={[styles.cuadrado, { borderRadius: theme.radius.md }]}
          >
            <LinearGradient
              colors={["#FFFFFF", hexDeHsv(hsv.h, 1, hsv.v)]}
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
                  // The ink of the colour **under** the ring, so the ring is visible
                  // on the pale corner of the square and on the black one.
                  borderColor: tintaDe(colorDelCuadrado),
                },
              ]}
            />
          </View>
        </GestureDetector>

        <View style={[styles.columna, { gap: theme.spacing.sm }]}>
          <View style={{ gap: theme.spacing.xs }}>
            <AppText variant="caption" tone="subtle">
              {t("tags.colorCustom")}
            </AppText>
            <View style={[styles.campoFila, { gap: theme.spacing.sm }]}>
              {/*
                What the field says, and not what the square is showing: with a
                half-typed colour the dot goes back to the colour the label has,
                which is the honest answer to "what colour is this".
              */}
              <View
                style={[
                  styles.campoMuestra,
                  {
                    backgroundColor: normalizaHex(texto) ?? hexGuardado,
                    borderColor: theme.colors.border,
                    borderRadius: theme.radius.sm,
                  },
                ]}
              />
              <TextInput
                value={texto}
                onChangeText={(nuevo) => {
                  setTexto(nuevo);
                  setMal(false);
                }}
                onSubmitEditing={aplicarCampo}
                autoCorrect={false}
                autoCapitalize="none"
                returnKeyType="done"
                accessibilityLabel={t("tags.colorCustomOf", { name: nombreDe })}
                selectionColor={theme.colors.accent}
                placeholder="#1F6FEB"
                placeholderTextColor={theme.colors.textSubtle}
                style={[
                  styles.campo,
                  {
                    backgroundColor: theme.colors.surface,
                    borderColor: mal ? theme.colors.danger : theme.colors.border,
                    borderRadius: theme.radius.md,
                    color: theme.colors.text,
                  },
                ]}
              />
              {/*
                It commits the field and not the square, so it does not wear the
                same glyph as the square's button —two checks side by side with
                different meanings is a control nobody can tell apart.

                **Su propio nombre y no el de `common.save`**, que es lo que ponia
                antes de que la pagina de etiquetas tuviera una segunda instancia de
                este panel: "Guardar" es la cadena mas generica de este diccionario, y
                dos en un panel que confirman dos hex distintos son lo peor del par.
                Cuesta una cadena mas larga y dice que hace el boton con el color **de
                quien** — y aqui va escrita **sin la llamada**, porque
                `test/translations.test.ts` recorre el fuente con una regexp y no tiene
                en cuenta los comentarios: una llamada a secas en medio de la prosa sale
                como "una clave con `{name}` llamada sin el nombre".
              */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("tags.colorSaveOf", { name: nombreDe })}
                hitSlop={6}
                onPress={aplicarCampo}
              >
                <Ionicons name="return-down-forward" size={20} color={theme.colors.accent} />
              </Pressable>
            </View>
            {mal ? (
              <AppText variant="caption" tone="danger">
                {t("tags.colorBad")}
              </AppText>
            ) : null}
          </View>

          {/*
            Y aqui **ya no hay boton de "usar este color"**.

            Era el que escribia lo que el cuadrado mostraba, y pedia confirmar dos
            veces lo mismo: mover el dedo al color y pulsar que lo quieres. Ahora
            escribe el dedo al levantarse —mismo commit, sin el segundo paso— y lo
            unico que queda en esta columna es el cuadrado con su tira, que es lo
            que esta columna siempre fue.
          */}
        </View>
      </View>

      {/*
        The free colours of this session, and nothing else: the twelve are above,
        and a list that repeated them would push out the ones that are not there
        anywhere else. Empty until something has been chosen, and never a row of
        nothing — **and in a panel that closes on a write it is never anything**; see
        the header.
      */}
      {recientes.length > 0 ? (
        <View style={{ gap: theme.spacing.xs }}>
          <AppText variant="caption" tone="subtle">
            {t("tags.recentColors")}
          </AppText>
          <View style={[styles.recientes, { gap: theme.spacing.sm }]}>
            {recientes.map((hex) => (
              <Pressable
                key={hex}
                accessibilityRole="button"
                accessibilityLabel={t("tags.recentColorOf", { color: hex })}
                hitSlop={6}
                onPress={() => {
                  setHsv(hexToHsv(hex));
                  escribir(hex);
                }}
                style={({ pressed }) => [
                  styles.reciente,
                  {
                    backgroundColor: hex,
                    borderColor: theme.colors.border,
                    borderRadius: theme.radius.pill,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              />
            ))}
          </View>
        </View>
      ) : null}

      {/*
        `onClose` is what makes this the only mount that can be closed, and it is why
        the picker brings a close button the strip never had. **Its accessible name is
        not `t("common.close")`**, which is what it said at first: the sheet's own X is
        also "Cerrar", two controls on one panel with the same name and the same
        meaning, and — measured against this file — a script that dismisses the sheet by
        pressing "Cerrar" would find whichever comes first in the document. Naming this
        one for what it closes makes the two separable by the thing that separates them.
      */}
      {onClose ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("tags.colorCloseOf", { name: nombreDe })}
          onPress={onClose}
          style={({ pressed }) => [
            styles.cerrar,
            {
              backgroundColor: theme.colors.surfaceMuted,
              borderRadius: theme.radius.md,
              opacity: pressed ? 0.8 : 1,
            },
          ]}
        >
          <AppText variant="callout" tone="muted">
            {t("common.close")}
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  deducido: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 44,
    paddingHorizontal: 12,
    borderWidth: 1,
  },
  deducidoPunto: {
    width: 18,
    height: 18,
  },
  rejilla: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  muestra: {
    width: 34,
    height: 34,
    borderWidth: 3,
    alignItems: "center",
    justifyContent: "center",
  },
  tira: {
    height: 24,
    // No `flex: 1`: in a column `flex-basis` is the height, so it would overwrite
    // the 24 above with zero and the strip would measure no height at all —and a
    // view with no height gets no touch either.
    flexShrink: 0,
    overflow: "hidden",
    touchAction: "none",
  },
  fila: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  columna: {
    // `alignSelf` and not the row's `alignItems`, because the child's own wins.
    flex: 1,
    alignSelf: "stretch",
    justifyContent: "space-between",
  },
  cuadrado: {
    width: TAMANO,
    height: TAMANO,
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
    // **No `borderColor` here.** It was `#FFFFFF`, and the ring is transparent
    // inside, so this one value decided whether the marker existed on three of the
    // six hues of the strip; it is `tintaDe(hexDeHsv(h, 1, 1))` at the call site,
    // which is the only place that knows the hue the ring is sitting on.
    shadowColor: "#000000",
    shadowOpacity: 0.4,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
  },
  campoFila: {
    flexDirection: "row",
    alignItems: "center",
  },
  campoMuestra: {
    width: 28,
    height: 28,
    borderWidth: 1,
  },
  campo: {
    flex: 1,
    height: 44,
    paddingHorizontal: 12,
    borderWidth: 1,
    fontSize: 15,
  },
  /*
    `usar` se fue con el boton de "usar este color": era su estilo y de nadie mas.
  */
  recientes: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  reciente: {
    width: 30,
    height: 30,
    borderWidth: 1,
  },
  cerrar: {
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
});