import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";

import { AppText } from "@/components/ui/text";
import { useTheme } from "@/theme";

export type MediaTab = "pending" | "seen";

export interface MediaTabsProps {
  value: MediaTab;
  onChange: (tab: MediaTab) => void;
  pendingCount: number;
  seenCount: number;
  pendingLabel: string;
  seenLabel: string;
}

/**
 * Seen and not seen, **as two tabs and not as a filter**.
 *
 * In the old app this was a switch inside the filters sheet, and the consequence
 * was that the size of what you were looking at was a setting: the same list
 * showed four covers or two hundred depending on a toggle somebody had to go and
 * find. Two tabs say the same thing and put the count on them, so "where are the
 * ones I have not seen" is answered by the width of a tab instead of by opening a
 * menu.
 *
 * **The count is on the tab and not hidden in the sheet**, for the same reason: a
 * number you have to open something to find is a number you cannot use to decide
 * which tab to open.
 *
 * **Both tabs are always there, even with nothing on one of them.** A tab that
 * appears and disappears moves everything under the finger, and "Por ver" with a
 * zero on it is a real state: it means the list is done.
 */
export function MediaTabs({
  value,
  onChange,
  pendingCount,
  seenCount,
  pendingLabel,
  seenLabel,
}: MediaTabsProps) {
  const theme = useTheme();

  /*
    The pill that says which tab, **and it moves instead of jumping**.

    It was the background of the pressed tab, so switching tabs swapped two
    colours instantly. On two tabs that is a flash, and the whole row is directly
    above a carousel that is one screen tall: a flash up there is a flash in the
    middle of the eye's journey to the poster, and it reads as the page blinking.

    So the pill is a separate view that slides, on a spring, and the two tabs keep
    only their text. **Its width is measured and not assumed** — the two tabs are
    `flex: 1`, so on a phone they are half each, but a label long enough to want
    more room would make them different and a hard-coded half would be visibly
    wrong. Measuring the row and halving what is left is the same answer in both
    cases.
  */
  const [ancho, setAncho] = useState(0);
  const x = useSharedValue(0);
  const pastilla = useMemo(() => (ancho - 8) / 2, [ancho]);

  useEffect(() => {
    if (pastilla <= 0) return;
    x.value = withSpring(value === "seen" ? pastilla : 0, {
      damping: 18,
      stiffness: 220,
      mass: 0.6,
    });
  }, [pastilla, value, x]);

  const estiloPastilla = useAnimatedStyle(() => ({
    width: pastilla,
    transform: [{ translateX: x.value }],
  }));

  const opciones: { clave: MediaTab; etiqueta: string; cuenta: number }[] = [
    { clave: "pending", etiqueta: pendingLabel, cuenta: pendingCount },
    { clave: "seen", etiqueta: seenLabel, cuenta: seenCount },
  ];

  return (
    <View
      accessibilityRole="tablist"
      onLayout={(event) => setAncho(event.nativeEvent.layout.width)}
      style={[
        styles.fila,
        {
          gap: 4,
          padding: 4,
          borderRadius: theme.radius.md,
          backgroundColor: theme.colors.surfaceMuted,
        },
      ]}
      testID="media-tabs"
    >
      {/*
        The pill, **behind the tabs and not inside either of them**: a tab that
        carries its own background cannot have the background of another one slide
        under it.
      */}
      {pastilla > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.pastillaMovil,
            {
              borderRadius: theme.radius.sm,
              backgroundColor: theme.colors.surface,
            },
            estiloPastilla,
          ]}
          testID="media-tabs-pill"
        />
      ) : null}
      {opciones.map(({ clave, etiqueta, cuenta }) => {
        const activo = value === clave;
        return (
          <Pressable
            key={clave}
            testID={`media-tab-${clave}`}
            accessibilityRole="tab"
            accessibilityState={{ selected: activo }}
            accessibilityLabel={`${etiqueta}, ${cuenta}`}
            onPress={() => onChange(clave)}
            style={({ pressed }) => [
              styles.pastilla,
              {
                gap: theme.spacing.xs,
                paddingHorizontal: theme.spacing.sm,
                paddingVertical: theme.spacing.xs,
                // 36 y no 40: esta fila esta **encima** del carrusel, no dentro de
                // el, y el alto que roba se le roba al poster. Es el unico
                // objetivo de la app por debajo de 40 y esta es la razon.
                minHeight: 36,
                opacity: pressed ? 0.75 : 1,
              },
            ]}
          >
            <AppText
              variant="caption"
              numberOfLines={1}
              style={{ color: activo ? theme.colors.text : theme.colors.textMuted }}
            >
              {etiqueta}
            </AppText>
            <AppText
              variant="caption"
              numberOfLines={1}
              style={{
                color: activo ? theme.colors.accent : theme.colors.textSubtle,
                fontWeight: activo ? "700" : "400",
              }}
            >
              {cuenta}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  fila: {
    flexDirection: "row",
    alignItems: "stretch",
  },
  /** Taken out of the flow, so it does not push the tabs to the right. */
  pastillaMovil: {
    position: "absolute",
    top: 4,
    left: 4,
    bottom: 4,
  },
  pastilla: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
});
