import { Pressable, StyleSheet, View } from "react-native";

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

  const opciones: { clave: MediaTab; etiqueta: string; cuenta: number }[] = [
    { clave: "pending", etiqueta: pendingLabel, cuenta: pendingCount },
    { clave: "seen", etiqueta: seenLabel, cuenta: seenCount },
  ];

  return (
    <View
      accessibilityRole="tablist"
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
                borderRadius: theme.radius.sm,
                backgroundColor: activo ? theme.colors.surface : "transparent",
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
  pastilla: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
});
