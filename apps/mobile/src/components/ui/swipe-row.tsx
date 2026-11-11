import { Ionicons } from "@expo/vector-icons";
import { useRef, type ComponentProps, type ReactNode } from "react";
import type { GestureResponderEvent } from "react-native";
import { Pressable, StyleSheet, View } from "react-native";
import { Swipeable } from "react-native-gesture-handler";

import { useTheme } from "@/theme";

import { AppText } from "./text";

export interface SwipeAction {
  key: string;
  label: string;
  icon: ComponentProps<typeof Ionicons>["name"];
  /** `danger` for what cannot be undone, `success` for what finishes something. */
  tone?: "neutral" | "success" | "danger";
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
      ? { fondo: theme.colors.dangerSoft, texto: theme.colors.danger }
      : tone === "success"
        ? { fondo: theme.colors.successSoft, texto: theme.colors.success }
        : { fondo: theme.colors.surface, texto: theme.colors.text };

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
  const izquierda = () =>
    leftAction && acento ? (
      <View
        style={[
          styles.izquierda,
          {
            backgroundColor: acento.fondo,
            borderColor: theme.colors.border,
            borderRadius: theme.radius.lg,
            marginVertical: inset,
            marginRight: theme.spacing.xs,
            paddingLeft: theme.spacing.lg,
            gap: theme.spacing.sm,
          },
        ]}
      >
        <Ionicons name={leftAction.icon} size={22} color={acento.texto} />
        <AppText variant="callout" numberOfLines={1} style={{ color: acento.texto }}>
          {leftAction.label}
        </AppText>
      </View>
    ) : null;

  return (
    <Swipeable
      ref={ref}
      renderRightActions={acciones}
      renderLeftActions={leftAction ? izquierda : undefined}
      overshootLeft={false}
      leftThreshold={LEFT_THRESHOLD}
      overshootRight={false}
      friction={1.5}
      rightThreshold={36}
      dragOffsetFromRightEdge={16}
      onSwipeableOpen={(direction) => {
        if (direction === "left" && leftAction) {
          // Llego hasta el final: se hace y la fila vuelve sola a su sitio.
          ref.current?.close();
          leftAction.onPress();
          return;
        }
        abierta.current = true;
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
const LEFT_THRESHOLD = 120;
const LEFT_PANEL_WIDTH = 160;

const styles = StyleSheet.create({
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
