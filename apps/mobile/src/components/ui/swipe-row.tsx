import { Ionicons } from "@expo/vector-icons";
import { useRef, type ComponentProps, type ReactNode } from "react";
import type { GestureResponderEvent } from "react-native";
import { Animated, Pressable, StyleSheet, View } from "react-native";
import { Swipeable } from "react-native-gesture-handler";

import { useTheme } from "@/theme";

import { AppText } from "./text";

export interface SwipeAction {
  key: string;
  label: string;
  icon: ComponentProps<typeof Ionicons>["name"];
  /** `danger` for what cannot be undone, `success` for what finishes something, `warning` for what reopens it. */
  tone?: "neutral" | "success" | "warning" | "danger";
  onPress: () => void;
}

/** What the row gets to wire its own press, so a swipe is never read as a tap. */
export interface SwipeRowGuard {
  /** Wraps the row's `onPress`. */
  press: (alPulsar: () => void) => (e?: GestureResponderEvent) => void;
  /** Goes on the row's `onPressIn`; remembers where the finger landed. */
  pressIn: (e: GestureResponderEvent) => void;
}

/**
 * A row that opens its actions when it is dragged to the left, like the mail apps.
 *
 * One component for every list of the app, so the actions look the same wherever
 * they appear: the same tile as the cards of the app (a border, the same radius, a
 * soft fill) and not a saturated block. The colour is only the tone of the action —
 * red is the one that cannot be undone.
 *
 * **The row must not open when the drag ends.** On the web the browser sends a
 * `click` when the finger lifts, and the row took it as a tap. The row is handed a
 * guard for that: a press that ended far from where it began is the end of a drag,
 * and a press on an open row only closes it.
 */
export function SwipeRow({
  actions,
  children,
  inset = 0,
  opaque = true,
  leftAction,
  releaseLabel = "",
}: {
  actions: SwipeAction[];
  children: ReactNode | ((guard: SwipeRowGuard) => ReactNode);
  /** Vertical breathing room of the tiles, for rows that touch their neighbours. */
  inset?: number;
  /**
   * Paint the screen's background under the sliding row. Turn it off for rows that are
   * opaque cards with rounded corners: the square background shows at the corners.
   */
  opaque?: boolean;
  /**
   * What a long drag to the **right** does. It is not a button to tap: the row has to
   * be dragged most of the way before it commits, so finishing something takes a
   * deliberate gesture and a short, accidental drag does nothing.
   */
  leftAction?: SwipeAction;
  /** What the panel says once the drag has gone far enough ("Release"). */
  releaseLabel?: string;
}) {
  const theme = useTheme();
  const ref = useRef<Swipeable>(null);
  const abierta = useRef(false);
  const inicio = useRef(0);

  const guard: SwipeRowGuard = {
    pressIn: (e) => {
      inicio.current = e.nativeEvent.pageX;
    },
    press: (alPulsar) => (e) => {
      if (abierta.current) {
        ref.current?.close();
        return;
      }
      if (e && Math.abs(e.nativeEvent.pageX - inicio.current) > 10) return;
      alPulsar();
    },
  };

  const tono = (tone: SwipeAction["tone"]) =>
    tone === "danger"
      ? { fondo: theme.colors.dangerSoft, texto: theme.colors.danger, solido: theme.colors.danger }
      : tone === "success"
        ? { fondo: theme.colors.successSoft, texto: theme.colors.success, solido: theme.colors.success }
        : tone === "warning"
          ? { fondo: theme.colors.warningSoft, texto: theme.colors.warning, solido: theme.colors.warning }
          : { fondo: theme.colors.surface, texto: theme.colors.text, solido: theme.colors.accent };

  const acciones = () => (
    <View
      style={[
        styles.acciones,
        { gap: theme.spacing.xs, paddingLeft: theme.spacing.xs, paddingVertical: inset },
      ]}
    >
      {actions.map((accion) => {
        const { fondo, texto } = tono(accion.tone);
        return (
          <Pressable
            key={accion.key}
            accessibilityRole="button"
            accessibilityLabel={accion.label}
            onPress={() => {
              ref.current?.close();
              accion.onPress();
            }}
            style={({ pressed }) => [
              styles.accion,
              {
                backgroundColor: pressed ? theme.colors.surfaceMuted : fondo,
                borderColor: theme.colors.border,
                borderRadius: theme.radius.lg,
              },
            ]}
          >
            <Ionicons name={accion.icon} size={20} color={texto} />
            <AppText variant="caption" numberOfLines={1} style={{ color: texto }}>
              {accion.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );

  const acento = leftAction ? tono(leftAction.tone) : null;
  /*
    El panel de la derecha de la fila, **vivo con el dedo**.

    Hasta el umbral es una baldosa suave que dice la accion; en cuanto el arrastre lo
    cruza se rellena del todo, el icono crece y el texto cambia a "Suelta": ese salto
    es lo que dice que, si sueltas ahora, se completa, y que antes de el no. Lo
    mueve `dragX` directamente, sin estado de React, para que siga al dedo cuadro a
    cuadro.
  */
  const izquierda = (_progress: Animated.AnimatedInterpolation<number>, dragX: Animated.AnimatedInterpolation<number>) => {
    if (!leftAction || !acento) return null;
    const cruza = { inputRange: [0, LEFT_THRESHOLD - 1, LEFT_THRESHOLD], extrapolate: "clamp" as const };
    const fondo = dragX.interpolate({ ...cruza, outputRange: [acento.fondo, acento.fondo, acento.solido] });
    const icono = dragX.interpolate({ ...cruza, outputRange: [acento.texto, acento.texto, theme.colors.onAccent] });
    const escala = dragX.interpolate({
      inputRange: [0, LEFT_THRESHOLD * 0.5, LEFT_THRESHOLD, LEFT_PANEL_WIDTH],
      outputRange: [0.7, 0.9, 1.2, 1.2],
      extrapolate: "clamp",
    });
    const antes = dragX.interpolate({ ...cruza, outputRange: [1, 1, 0] });
    const despues = dragX.interpolate({ ...cruza, outputRange: [0, 0, 1] });
    return (
      <Animated.View
        style={[
          styles.izquierda,
          {
            backgroundColor: fondo,
            borderColor: theme.colors.border,
            borderRadius: theme.radius.lg,
            marginVertical: inset,
            marginRight: theme.spacing.xs,
            paddingLeft: theme.spacing.lg,
            gap: theme.spacing.sm,
          },
        ]}
      >
        <Animated.View style={{ transform: [{ scale: escala }] }}>
          <AnimatedIonicons name={leftAction.icon} size={22} style={{ color: icono }} />
        </Animated.View>
        <View style={styles.etiquetas}>
          <Animated.View style={[styles.etiqueta, { opacity: antes }]}>
            <AppText variant="callout" numberOfLines={1} style={{ color: acento.texto }}>
              {leftAction.label}
            </AppText>
          </Animated.View>
          <Animated.View style={[styles.etiqueta, { opacity: despues }]}>
            <AppText variant="callout" numberOfLines={1} style={{ color: theme.colors.onAccent }}>
              {releaseLabel}
            </AppText>
          </Animated.View>
        </View>
      </Animated.View>
    );
  };

  return (
    <Swipeable
      ref={ref}
      renderRightActions={acciones}
      renderLeftActions={leftAction ? izquierda : undefined}
      overshootLeft={false}
      leftThreshold={LEFT_THRESHOLD}
      overshootRight={false}
      friction={1}
      rightThreshold={36}
      dragOffsetFromRightEdge={16}
      onSwipeableWillOpen={(direction) => {
        if (direction === "left" && leftAction) {
          // Soltado pasado el umbral: se hace ya, sin esperar a que acabe la
          // animacion, y la fila vuelve sola a su sitio.
          ref.current?.close();
          leftAction.onPress();
        }
      }}
      onSwipeableOpen={(direction) => {
        if (direction === "right") abierta.current = true;
      }}
      onSwipeableClose={() => {
        abierta.current = false;
      }}
      // El fondo de la pantalla: sin el, al arrastrar el texto se veria cortado sobre el vacio.
      childrenContainerStyle={opaque ? { backgroundColor: theme.colors.background } : undefined}
    >
      {typeof children === "function" ? children(guard) : children}
    </Swipeable>
  );
}

/**
 * How far the row must be dragged to the right for it to commit, in points. The panel
 * behind is wider than this on purpose: it has to be pulled most of the way, not tapped.
 */
const AnimatedIonicons = Animated.createAnimatedComponent(Ionicons);
const LEFT_THRESHOLD = 130;
const LEFT_PANEL_WIDTH = 170;

const styles = StyleSheet.create({
  etiquetas: {
    flex: 1,
    height: 22,
  },
  etiqueta: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    justifyContent: "center",
  },
  izquierda: {
    width: LEFT_PANEL_WIDTH,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
  },
  acciones: {
    flexDirection: "row",
    alignItems: "stretch",
  },
  accion: {
    width: 72,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    borderWidth: 1,
  },
});
