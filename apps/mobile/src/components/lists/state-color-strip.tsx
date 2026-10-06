import { Pressable, StyleSheet, View } from "react-native";

import type { ItemIconColor } from "@orbit-hub/contracts";

import { useTranslation } from "@/lib/i18n";
import { ICON_COLOR_KEYS, ICON_COLOR_LABEL, iconColor } from "@/lib/lists/item-icons";
import { useTheme } from "@/theme";

export interface StateColorStripProps {
  /** The chosen colour, as the key the board stores. */
  color: ItemIconColor;
  /** Called with the key that was pressed. */
  onChange: (color: ItemIconColor) => void;
  /**
   * The front of the rows' `testID`s, **`state-editor-color` unless a caller
   * says otherwise.**
   *
   * It is a prop and not a constant because two of these strips can be on screen
   * at once — the states editor behind the single-state one — and two rows with
   * one `testID` are a script pressing the wrong one. The default keeps the
   * editor's rows where its walkthrough looks for them.
   */
  testIDPrefix?: string;
}

/**
 * The twelve colours a column can be, in one row.
 *
 * **Extracted out of `state-editor-sheet.tsx`, where it was a private function
 * drawing the same twelve in the same order**, because the single-state sheet
 * draws them too and two strips are two lists that drift apart. What it draws is
 * unchanged: thirty-point round swatches, the chosen one ringed with the theme's
 * own text colour, the ring always drawn and transparent when not chosen — `Sheet`
 * measures why in `IconCell`, and the short version is that a border that appears
 * pushes the other eleven along by six points on every tap.
 *
 * A key and not a colour value, for the reason the contract says it with: the app
 * draws the ones it offers, so there is no colour nobody can read. A free picker
 * is a contract change, a migration and a legibility argument in both themes, and
 * none of the three lives here.
 */
export function StateColorStrip({
  color,
  onChange,
  testIDPrefix = "state-editor-color",
}: StateColorStripProps) {
  const theme = useTheme();
  const t = useTranslation();

  return (
    <View style={[styles.tira, { gap: theme.spacing.xs }]}>
      {ICON_COLOR_KEYS.map((opcion) => {
        const activa = color === opcion;
        return (
          <Pressable
            key={opcion}
            testID={`${testIDPrefix}-${opcion}`}
            accessibilityRole="button"
            accessibilityState={{ selected: activa }}
            accessibilityLabel={t(ICON_COLOR_LABEL[opcion])}
            onPress={() => onChange(opcion)}
            style={({ pressed }) => [
              styles.muestra,
              {
                backgroundColor: iconColor(opcion),
                borderColor: activa ? theme.colors.text : "transparent",
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  tira: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  muestra: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 3,
  },
});
