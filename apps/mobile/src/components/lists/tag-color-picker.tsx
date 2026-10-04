import { Ionicons } from "@expo/vector-icons";
import { derivedTagColor } from "@orbit-hub/contracts";
import { LinearGradient } from "expo-linear-gradient";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { Pressable, StyleSheet, TextInput, View } from "react-native";

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
  const sucio = colorDelCuadrado !== hexGuardado;

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

  const gestoCuadrado = useMemo(
    () =>
      Gesture.Pan()
        // From the first pixel: tapping the square is a choice, and a threshold
        // would mean a tap lands nowhere.
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
      <AppText variant="caption" tone="subtle">
        {t("tags.color")}
      </AppText>

      {/*
        The thirteen answers to one question —the derived colour and the twelve— as
        one group. One `radiogroup` and not two blocks, because they are one choice
        and `selectedProps` is what puts `aria-selected` in the DOM for all of them.
      */}
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={t("tags.color")}
        style={{ gap: theme.spacing.sm }}
      >
        <Pressable
          accessibilityRole="radio"
          accessibilityLabel={
            tag ? t("tags.backToDerivedOf", { name: tag }) : t("tags.backToDerived")
          }
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
            {tag ? t("tags.backToDerivedOf", { name: tag }) : t("tags.backToDerived")}
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
                accessibilityLabel={t(ICON_COLOR_LABEL[option])}
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
          accessibilityLabel={t("tags.colorHue")}
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
            style={[styles.marcadorTira, { left: (hsv.h / 360) * anchoTira - 9 }]}
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
            accessibilityLabel={t("tags.colorSquare")}
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
                accessibilityLabel={t("tags.colorCustom")}
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
              */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("common.save")}
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
            It commits on press and not on every pixel of a drag, and it is
            **dimmed rather than hidden** when there is nothing to change: hiding
            it would move the layout under the finger of somebody about to drag the
            square.
          */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("tags.colorUse")}
            accessibilityState={{ disabled: !sucio }}
            disabled={!sucio}
            onPress={() => escribir(colorDelCuadrado)}
            style={({ pressed }) => [
              styles.usar,
              {
                backgroundColor: theme.colors.accent,
                borderRadius: theme.radius.md,
                opacity: !sucio ? 0.35 : pressed ? 0.85 : 1,
              },
            ]}
          >
            <AppText variant="callout" numberOfLines={1} style={{ color: theme.colors.onAccent }}>
              {t("tags.colorUse")}
            </AppText>
          </Pressable>
        </View>
      </View>

      {/*
        The free colours of this session, and nothing else: the twelve are above,
        and a list that repeated them would push out the ones that are not there
        anywhere else. Empty until something has been chosen, and never a row of
        nothing.
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

      {onClose ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("common.close")}
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
    borderColor: "#FFFFFF",
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
  usar: {
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
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