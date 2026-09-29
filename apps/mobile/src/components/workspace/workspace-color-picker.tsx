import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useCallback, useMemo, useRef, useState } from "react";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { Pressable, StyleSheet, View } from "react-native";

import { useTranslation } from "@/lib/i18n";
import {
  DEFAULT_WORKSPACE_COLOR,
  WORKSPACE_COLORS,
  colorOf,
  isWorkspaceColor,
  spacePaint,
} from "@/lib/workspace/color";
import { HUE_STRIP, hexToHsv, hsvToHex, puntoAHsv, puntoAHue } from "@/lib/workspace/picker";
import { recentColors, rememberColor } from "@/lib/workspace/recent-colors";
import {
  DEFAULT_WASH,
  WASH_VARIANTS,
  isWashVariant,
} from "@/lib/workspace/wash";
import type { WashVariant } from "@/lib/workspace/wash";
import { useTheme } from "@/theme";

import { selectedProps } from "@/components/ui/a11y-state";
import { SpaceWash } from "../ui/wash";
import { AppText } from "../ui/text";

export interface WorkspaceColorPickerProps {
  /** The colour the wash starts in: a name from the list, or a `#RRGGBB`. */
  value: string | null | undefined;
  /** The colour it ends in, or `null` when it has never been chosen. */
  valueTo: string | null | undefined;
  /** Which of the two ways it is painted. */
  wash: string | null | undefined;
  onPick: (color: string) => void;
  onPickTo: (color: string | null) => void;
  /** Writes the style. A separate call because it is a separate decision. */
  onPickWash: (wash: WashVariant) => void;
}

const ES_HEX = /^#?[0-9A-Fa-f]{6}$/;

const comoHex = (value: string): string => {
  const limpio = value.trim();
  return (limpio.startsWith("#") ? limpio : `#${limpio}`).toUpperCase();
};

/**
 * The colour an end of a wash has right now, as a hex the square can open on.
 *
 * A name resolves through the palette, a custom one is taken as written, and an
 * end nobody chose falls back to the first one — which is what the space is
 * actually painted, derived and all, so the square opens on the colour the person
 * is looking at and not on a blank.
 */
function hexDe(valor: string | null | undefined): string {
  if (typeof valor === "string" && ES_HEX.test(valor.trim())) return comoHex(valor);
  if (isWorkspaceColor(valor)) return colorOf(valor);
  return colorOf(DEFAULT_WORKSPACE_COLOR);
}

/**
 * The colour of a space, and a way to actually pick one.
 *
 * **The twelve swatches are the fast way in**, and each one is painted with the
 * wash it produces — through the same `SpaceWash` the cards use — because a flat
 * circle in front of a gradient card is a swatch that lies about what it does.
 *
 * **The field and the square are the way to get the exact one.** Somebody with a
 * colour in mind is not helped by a thirteenth swatch. The square is saturation
 * across and brightness down, which is the arrangement every person already
 * knows from the phone they are holding; the strip underneath is the hue. A hue
 * wheel was the alternative and it is worse: a wheel puts the colours you want
 * next to the colours you do not, and the one you want is never where your
 * thumb is.
 *
 * **A field as well, and not instead.** The square gets you *nearly* the colour
 * you had; the field is the only way to say it exactly, and there is a
 * difference between the two that matters when the colour is a brand.
 *
 * **Nothing is written until you press the check.** A picker that fires on every
 * pixel of a drag would put a hundred undoable writes in the sync queue and
 * make the space flicker between eleven colours while you are trying to look at
 * one.
 */
export function WorkspaceColorPicker({
  value,
  valueTo,
  wash,
  onPick,
  onPickTo,
  onPickWash,
}: WorkspaceColorPickerProps) {
  const theme = useTheme();
  const t = useTranslation();

  const esPropioDesde = typeof value === "string" && ES_HEX.test(value.trim());
  const esPropioHasta = typeof valueTo === "string" && ES_HEX.test(valueTo.trim());

  /**
   * Which of the two ends is being edited.
   *
   * A switch and not two panels. The square can edit one colour and there are two
   * ends, so something has to say which; two rows of twelve swatches stacked would
   * answer it by doubling everything and pushing the preview off the screen. One
   * row that changes, and the preview always showing **both** ends so the person
   * can see the other one while they move this one.
   */
  const [lado, setLado] = useState<"desde" | "hasta">("desde");

  const valorDelLado = lado === "desde" ? value : valueTo;
  const esPropio = lado === "desde" ? esPropioDesde : esPropioHasta;
  const setValorDelLado = lado === "desde" ? onPick : onPickTo;

  /**
   * Write this end, and remember the colour.
   *
   * Every path that commits goes through here — a preset swatch, the square's
   * check, a recent — so the recents cannot miss one. And it records on the
   * **commit**, never on the drag: a drag crosses a hundred colours and a list of
   * the hundred would be a history of the gesture rather than of the choices.
   */
  const escribir = useCallback(
    (color: string) => {
      // A palette swatch arrives as its **key** ("rose") and a recent as a hex, and
      // only the second one is something to remember. Passing the key straight to
      // the recents was the bug: the list silently kept everything out, because
      // "ROSE" is not a colour and the check is what a colour looks like.
      rememberColor(lado, hexDe(color));
      setValorDelLado(color);
      bump();
    },
    [lado, setValorDelLado],
  );

  /**
   * The recents on screen.
   *
   * In state and not read on render, because they change when a colour is used
   * and nothing else in this component would re-render: a picker that remembered a
   * colour and did not show it until the next time it opened is a memory nobody
   * can see.
   */
  const [tick, setTick] = useState(0);
  const bump = useCallback(() => setTick((n) => n + 1), []);
  const recientes = useMemo(
    () => (tick >= 0 ? recentColors(lado) : []),
    // `tick` is the dependency that matters: it changes when a colour is used.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lado, tick],
  );

  /** The active end's saved colour, when it is one of the twelve. */
  const actualDelLado = isWorkspaceColor(valorDelLado) ? valorDelLado : null;

  /** What the square and the strip are showing, which may not be saved yet. */
  const [hsv, setHsv] = useState(() => hexToHsv(hexDe(valorDelLado)));
  /** The style, resolved: a space with none has the one it always had. */
  const estiloActual: WashVariant = isWashVariant(wash) ? wash : DEFAULT_WASH;

  /**
   * The two ends as they are saved, and what the preview is showing.
   *
   * The preview is the pair the square has built — this side from the square, the
   * other one as it is — because a preview that ignores the thing you are dragging
   * is not a preview. And the button only lights up when what the square says is
   * not what is saved.
   */
  const guardadoDesde = esPropioDesde ? comoHex(value as string) : colorOf(value);
  const guardadoHasta = valueTo
    ? esPropioHasta
      ? comoHex(valueTo)
      : colorOf(valueTo)
    : null;

  const colorActual = hsvToHex(hsv);
  const colorGuardada = lado === "desde" ? guardadoDesde : (guardadoHasta ?? guardadoDesde);
  const sucio = colorActual !== colorGuardada;

  /**
   * The end the square is **not** on, so the preview and the two little
   * pictures can show both ends while this one moves.
   *
   * For the second end that has never been chosen, this is what the space is
   * really painted with, derived — the preview shows the real thing rather than
   * the first colour twice.
   */
  const elOtro =
    lado === "desde"
      ? (guardadoHasta ?? spacePaint(value, estiloActual).stops[1])
      : guardadoDesde;

  /**
   * The pair in the order they are painted.
   *
   * On the second end, the colour the square is moving is the one that goes
   * **last**: a pair is ordered, and if the edited end jumped to the front every
   * time somebody switched ends, the whole wash would flip as you moved between
   * them and you would be looking at a picture that never gets saved.
   */
  const par = lado === "desde"
    ? { desde: colorActual, hasta: elOtro }
    : { desde: elOtro, hasta: colorActual };

  /**
   * How big the square is, and why it is not the width of the panel.
   *
   * It was `width: '100%'` with `aspectRatio: 1`, which on a 430-point phone is
   * a 398-point square: the picker took the whole panel, and the preview of the
   * result — the one thing that answers "is this the colour I meant?" — was below
   * the fold. Fixed and small, so the square and the preview sit **side by side**
   * and both are on screen without scrolling. A square wider than it is tall
   * would make a drag across it cover more colour than one down it, and the
   * marker would drift away from the finger, so it is square on purpose.
   */
  const TAMANO = 132;

  /**
   * The measured sizes, in state and not in a ref.
   *
   * The marker is painted from these, and a ref does not repaint: the first
   * version held the measured width in a ref and drew the marker with the
   * *assumed* `lado`, so on a real phone the marker sat about a third of the way
   * across a box twice as wide, and the thing under your finger was never the
   * thing you got. `onLayout` is the only thing that knows the real number and
   * it runs after the first paint, so the two differ exactly when it matters.
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

  /*
   * The two drags, as gestures and not as `PanResponder`.
   *
   * A `PanResponder` claims the touch through the responder system, and on the web
   * the browser decides first: unless something tells it not to, it keeps the
   * finger to scroll or to drag the document, and the responder is never called.
   * `touchAction: "none"` in the style does not fix it, because react-native-web
   * drops the property before it reaches CSS — measured, `touch-action` stayed
   * `auto` with it in the style.
   *
   * So the two symptoms were the same line. A drag across the square left the
   * colour exactly as it was, and the browser's own drag of the page is what the
   * report described as "arrastrar en el picker cierra el modal": the app was
   * never dismissing anything, the document was being dragged and the sheet went
   * with it. `Gesture.Pan` sets `touch-action: none` on the view itself, which is
   * the one thing that makes the browser hand the gesture over.
   *
   * The latest callback is read from a ref because a gesture must not be rebuilt
   * while a finger is on it: `alMoverCuadrado` closes over the measured box, so
   * closing over it directly would rebuild the gesture on every frame of a drag.
   */
  const alMoverCuadradoRef = useRef(alMoverCuadrado);
  alMoverCuadradoRef.current = alMoverCuadrado;
  const alMoverTiraRef = useRef(alMoverTira);
  alMoverTiraRef.current = alMoverTira;

  const gestoCuadrado = useMemo(
    () =>
      Gesture.Pan()
        // From the first pixel: tapping the square is a choice, and waiting for a
        // threshold would mean a tap lands nowhere.
        .minDistance(0)
        .onBegin((e) => alMoverCuadradoRef.current(e.x, e.y))
        .onUpdate((e) => alMoverCuadradoRef.current(e.x, e.y)),
    [],
  );

  const gestoTira = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(0)
        .onBegin((e) => alMoverTiraRef.current(e.x))
        .onUpdate((e) => alMoverTiraRef.current(e.x)),
    [],
  );

  return (
    <View style={{ gap: theme.spacing.md }}>
      {/*
        The two ways to paint it, and which of the two ends is being edited.

        **The switch is above the styles, not below the colours.** A wash has two
        ends and one square, so something has to say which end the square is on.
        Putting the switch first means the row of colours below it always belongs
        to the end the person is looking at, and the preview always shows both, so
        the other end is visible while this one moves.
      */}
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={t("workspaces.washGroup")}
        style={[styles.estilos, { gap: theme.spacing.sm }]}
      >
        {(["desde", "hasta"] as const).map((extremo) => {
          const elegido = lado === extremo;
          return (
            <Pressable
              key={extremo}
              accessibilityRole="radio"
              accessibilityLabel={t(`workspaces.washSide.${extremo}` as never)}
              {...selectedProps(elegido)}
              onPress={() => {
                setLado(extremo);
                // The square opens on the end it is about to edit, or the marker
                // sits on the other colour's hue and the first thing you drag
                // jumps somewhere unrelated.
                setHsv(hexToHsv(hexDe(extremo === "desde" ? value : valueTo)));
              }}
              style={({ pressed }) => [
                styles.extremo,
                {
                  borderColor: elegido ? theme.colors.accent : theme.colors.border,
                  backgroundColor: elegido
                    ? theme.colors.accentSoft
                    : pressed
                      ? theme.colors.surfaceMuted
                      : "transparent",
                },
              ]}
            >
              <View
                style={[
                  styles.extremoPunto,
                  {
                    backgroundColor: hexDe(extremo === "desde" ? value : valueTo),
                  },
                ]}
              />
              <AppText
                variant="callout"
                numberOfLines={1}
                style={{ color: elegido ? theme.colors.accent : undefined }}
              >
                {t(`workspaces.washSide.${extremo}` as never)}
              </AppText>
            </Pressable>
          );
        })}
      </View>

      {/* The two ways, each drawn with the two colours the square has built. */}
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={t("workspaces.washGroup")}
        style={[styles.estilos, { gap: theme.spacing.sm }]}
      >
        {WASH_VARIANTS.map((estilo) => {
          const elegido = estilo === estiloActual;
          return (
            <Pressable
              key={estilo}
              // `radio` and not `button`, because two of these are one choice and
              // `button` with a `selected` state does not put `aria-selected` in
              // the DOM: measured, the attribute was `null` on both including the
              // chosen one, so the row said nothing to anyone asking the page how
              // it was set.
              accessibilityRole="radio"
              accessibilityLabel={t(`workspaces.wash.${estilo}` as never)}
              {...selectedProps(elegido)}
              onPress={() => onPickWash(estilo)}
              style={({ pressed }) => [
                styles.estilo,
                {
                  borderColor: elegido ? theme.colors.accent : theme.colors.border,
                  opacity: pressed ? 0.8 : 1,
                },
              ]}
            >
              <SpaceWash
                colorKey={par.desde}
                colorToKey={par.hasta}
                wash={estilo}
                radius={6}
                style={styles.estiloMuestra}
              />
              <AppText variant="caption" tone="subtle" numberOfLines={1}>
                {t(`workspaces.wash.${estilo}` as never)}
              </AppText>
            </Pressable>
          );
        })}
      </View>

      {/*
        The twelve, as washes, and they belong to whichever end the switch is on.

        The ring is on the one that is chosen **on this side**, not on the one that
        is chosen overall: with two ends, a swatch can be the colour of the first
        end and also of the second, and one ring cannot say which. `actual` is the
        active end's value, so the row is honest about the end being edited.
      */}
      <View style={[styles.rejilla, { gap: theme.spacing.sm }]}>
        {WORKSPACE_COLORS.map((color) => {
          const selected = color.key === actualDelLado && !esPropio;
          return (
            <Pressable
              key={color.key}
              accessibilityRole="button"
              accessibilityLabel={t(`workspaces.color.${color.key}` as never)}
              {...selectedProps(selected)}
              onPress={() => {
                setHsv(hexToHsv(colorOf(color.key)));
                escribir(color.key);
              }}
              style={({ pressed }) => [
                styles.muestra,
                {
                  borderColor: selected ? theme.colors.accent : "transparent",
                  opacity: pressed ? 0.8 : 1,
                },
              ]}
            >
              {/*
                Each swatch shows **the pair** it would make, not the colour on its
                own: with two ends, a row of twelve flat-ish circles does not tell
                you what the space will look like, it tells you twelve colours you
                already have.
              */}
              <SpaceWash
                colorKey={color.key}
                colorToKey={
                  lado === "desde"
                    ? (guardadoHasta ?? undefined)
                    : undefined
                }
                wash={estiloActual}
                radius={19}
                style={styles.relleno}
              />
              {selected ? (
                <Ionicons name="checkmark" size={18} color={spacePaint(color.key).foreground} />
              ) : null}
            </Pressable>
          );
        })}
      </View>

      {/*
        The square and the preview **side by side**, and that is the whole layout
        of this panel. The preview is the only thing on screen that answers "is
        this the colour I meant?", so it is never below the square, never under a
        fold and never behind a scroll: whatever else happens on a 430-point
        screen, the square and its result are both on it.
      */}
      <View style={[styles.fila, { gap: theme.spacing.md }]}>
        {/* The square and the strip, stacked, as one column. */}
        <View style={{ gap: theme.spacing.sm }}>
          {/* Saturation across, brightness down. Two gradients laid on top of
              each other: white to the hue, and then transparent to black. */}
          <GestureDetector gesture={gestoCuadrado}>
            <View
              onLayout={(e) =>
                setCaja({
                  width: e.nativeEvent.layout.width,
                  height: e.nativeEvent.layout.height,
                })
              }
              accessibilityRole="adjustable"
              accessibilityLabel={t("workspaces.colorSquare")}
              style={[styles.cuadrado, { borderRadius: theme.radius.md }]}
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
              onLayout={(e) => setAnchoTira(e.nativeEvent.layout.width)}
              accessibilityRole="adjustable"
              accessibilityLabel={t("workspaces.colorHue")}
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

        {/*
          The preview, and the button that writes it.

          **It shows both ends**, whichever one the square is on. A preview of one
          colour when there are two is a picture of half the thing, and the half
          you are not editing is exactly the half you need to see while you edit
          this one.

          It commits on press and not on every pixel of a drag: a picker that fired
          on drag would put a hundred writes in the sync queue and make the space
          flicker between eleven colours while you are trying to look at one. So it
          is a button, and it is **dimmed rather than hidden** when there is nothing
          to change — hiding it would move the layout under the finger of somebody
          about to drag the square.

          Its height is **not** left to the text inside it. `flex: 1` on a centred
          row collapses the column to the height of a line of text, which is not a
          preview of a card. It is `alignSelf: stretch` and the square's height, so
          the thing you drag and the thing it does read as a pair.
        */}
        <View style={[styles.columnaPreview, { gap: theme.spacing.sm }]}>
          <SpaceWash
            colorKey={par.desde}
            colorToKey={par.hasta}
            wash={estiloActual}
            radius={theme.radius.md}
            style={styles.preview}
          >
            <AppText variant="caption" style={styles.previewTexto}>
              {t("workspaces.colorPreview")}
            </AppText>
          </SpaceWash>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("workspaces.colorUse")}
            accessibilityState={{ disabled: !sucio }}
            disabled={!sucio}
            onPress={() => escribir(colorActual)}
            style={({ pressed }) => [
              styles.usar,
              {
                backgroundColor: theme.colors.accent,
                borderRadius: theme.radius.md,
                opacity: !sucio ? 0.35 : pressed ? 0.85 : 1,
              },
            ]}
          >
            <AppText
              variant="callout"
              numberOfLines={1}
              style={{ color: theme.colors.onAccent }}
            >
              {t("workspaces.colorUse")}
            </AppText>
          </Pressable>
        </View>
      </View>

      {/*
        The ones this space has actually used, and **both ends' in one row**.

        The square and the hue strip can reach any colour, and that is the point of
        them — but a wash is a *pair*, and the pair that looks right is the one
        where somebody already liked both halves. Making the second end means
        arriving again at a colour the first end already has, at a slightly
        different brightness, and that is the most repeated action in this picker.

        So each end remembers its own colours and the row offers both, and on
        "Termina en" the colours used on "Empieza en" are one press away. That is
        what makes a gradient *from* a colour instead of hunting for it twice.

        Empty until something has been used, and never a row of nothing: a heading
        over four blank circles is a thing to read for no reason.
      */}
      {recientes.length > 0 ? (
        <View style={{ gap: theme.spacing.xs }}>
          <AppText variant="caption" tone="subtle">
            {lado === "desde"
              ? t("workspaces.recentColors")
              : t("workspaces.recentColorsTo")}
          </AppText>
          <View style={styles.recientes}>
            {recientes.map((hex) => (
              <Pressable
                key={hex}
                accessibilityRole="button"
                accessibilityLabel={t("workspaces.recentColorOf", { color: hex })}
                hitSlop={6}
                onPress={() => {
                  setHsv(hexToHsv(hex));
                  escribir(hex);
                }}
                style={({ pressed }) => [
                  styles.reciente,
                  {
                    backgroundColor: hex,
                    borderRadius: 999,
                    borderColor: theme.colors.border,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              />
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  extremo: {
    // Two across the 382-point content column with a gap of 8: 187 each, which is
    // room for "Empieza en" plus the dot without the word being cut.
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 40,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  extremoPunto: {
    width: 18,
    height: 18,
    borderRadius: 9,
  },
  estilos: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  estilo: {
    // Two now and not five, and each one gets half the row. It was sized for
    // "Complementario" fitting on one line, and with two there is no reason to
    // leave the pictures small.
    flex: 1,
    alignItems: "center",
    gap: 4,
    padding: 4,
    borderRadius: 10,
    borderWidth: 1,
  },
  estiloMuestra: {
    width: "100%",
    height: 40,
  },
  rejilla: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  muestra: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 3,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  relleno: {
    // `position: 'absolute'` and not just the four offsets. Without it the `View`
    // is in normal flow with no content of its own and measures 0x0: the gradient
    // is in the DOM and correct, on a box the size of nothing. Twelve invisible
    // swatches — and the symptom "the gradient is not showing" points at the
    // gradient, which was never the problem.
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 19,
  },
  cuadrado: {
    // Fixed, and next to the preview rather than above it. See `lado` for why
    // this is not the width of the panel.
    width: 132,
    height: 132,
    // The same reason as the strip, and it would bite here too the moment
    // something above it in the column changed height.
    flexShrink: 0,
    overflow: "hidden",
    /*
     * `touch-action: none`, and it is what makes the drag work at all on the web.
     *
     * A `PanResponder` goes through the responder system, and on the web the
     * browser decides first: unless the element says `touch-action: none`, the
     * browser keeps the finger to scroll or to drag the page, the responder never
     * activates, and the handler is never called. Measured in the browser before
     * this line: a touch drag across the whole square left the colour exactly as
     * it was.
     *
     * It is also the thing the report was about, and the two are the same line.
     * The browser's idea of a drag inside a panel it is scrolling is what moved
     * the panel out from under the finger and closed the sheet — the app was
     * never dismissing anything, the browser was dragging the document, and the
     * sheet went with it. Saying "this is not a scroll, it is a colour" takes the
     * gesture away from the browser and gives it to the square, which is the only
     * thing that should be moving.
     *
     * The same fix the list drag needed, and for the same reason; see the note in
     * `docs/roadmap.md` about `GestureHandlerRootView`.
     */
    touchAction: "none",
  },
  tira: {
    // **No `flex: 1`**, and it is worth saying why because it looks right.
    //
    // `flex: 1` is `flex: 1 1 0%`, and in a column `flex-basis` is the *height*.
    // So it overwrites the 24 below with zero, and since the column has no free
    // space to hand out, `flex-grow` has nothing to grow: the strip measured
    // 132x0, it was not on the screen, and a view of no height gets no touch
    // either. Measured in the browser, and the marker landed 48 px off.
    height: 24,
    flexShrink: 0,
    overflow: "hidden",
    // And the same `touch-action` as the square, for the same reason: this is a
    // `PanResponder` too, and a hue strip is even more tempting for the browser
    // to treat as something to scroll past.
    touchAction: "none",
  },
  recientes: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  reciente: {
    width: 30,
    height: 30,
    borderWidth: 1,
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
  fila: {
    flexDirection: "row",
    alignItems: "center",
  },
  campo: {
    flex: 1,
    height: 44,
    paddingHorizontal: 12,
    borderWidth: 1,
    fontSize: 15,
  },
  aplicar: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  columnaPreview: {
    // Fills what is left of the row, and is as tall as the square beside it so
    // the two read as a pair.
    //
    // **`alignSelf: 'stretch'` and not the row's `alignItems`.** Verified in the
    // browser by overriding each one on its own: with this removed the column
    // came out 69 tall and the preview 17 — the height of the line of text in it,
    // which is not a preview of a card. Changing `alignItems` on the row instead
    // changes nothing, because `align-self` on the child wins. The first version
    // of this comment credited the row, and the credit was in the wrong place.
    flex: 1,
    alignSelf: "stretch",
  },
  preview: {
    // Takes the room that is not the button, instead of the height of its text.
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  previewTexto: {
    color: "#FFFFFF",
    fontSize: 12,
  },
  usar: {
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
});
