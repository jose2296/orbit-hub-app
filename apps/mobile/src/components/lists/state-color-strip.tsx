import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import type { StateColor } from "@orbit-hub/contracts";

import { useTranslation } from "@/lib/i18n";
import { ICON_COLOR_KEYS, ICON_COLOR_LABEL, iconColor } from "@/lib/lists/item-icons";
import { useTheme } from "@/theme";
import { ColorSquare } from "@/components/ui/color-square";
import { AppText } from "@/components/ui/text";
import { TextField } from "@/components/ui/text-field";

export interface StateColorStripProps {
  /** The chosen colour: a palette key or a hex a person chose. */
  color: StateColor;
  /** Called with the key or hex that was chosen. */
  onChange: (color: StateColor) => void;
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
 * A key or a hex, since the contract takes both: the twelve are one tap each
 * and a person's own colour lives in the row below (well on web, hex field
 * everywhere). The legibility the keys promised does not extend to the hex —
 * the contract says so next to the union — and the row keeps its name in the
 * theme's text colour so a column is never only its colour.
 */
export function StateColorStrip({
  color,
  onChange,
  testIDPrefix = "state-editor-color",
}: StateColorStripProps) {
  const theme = useTheme();
  const t = useTranslation();

  /**
   * What the hex field says, **and it starts where the column is.**
   *
   * A key reads as its own colour (`iconColor` maps it), a hex reads as itself,
   * so opening the sheet on a red column offers `#...` of that red rather than
   * an empty field — and an empty field would be the picker forgetting the
   * answer it already has.
   */
  const [hex, setHex] = useState(() => iconColor(color));
  useEffect(() => {
    setHex(iconColor(color));
    // `color` and nothing else: syncing on every render would take the field
    // back while it is being typed in, and the text is local state precisely so
    // that it is not taken back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [color]);

  /** What the field says as a colour, or `null` for "not one". */
  const hexValido = normalizarHex(hex);
  const valido = hex.trim().length === 0 || hexValido !== null;

  /** A keystroke: kept as typed, and written when it becomes a colour. */
  function escribirHex(valor: string) {
    setHex(valor);
    const canonico = normalizarHex(valor);
    if (canonico !== null) onChange(canonico);
  }

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
      {/*
        A colour of one's own, **below the twelve and not among them.**
        The twelve are one tap each; a free colour gets the same square the
        spaces use (`ColorSquare`: saturation square, hue strip) plus a field
        for the exact six digits. The square reports every move live and the
        field writes when it becomes a colour; both land in the same `onChange`,
        and the parent stages — a sheet with a save button, an editor with its
        draft — so neither writes anything by itself.
      */}
      <View style={{ gap: theme.spacing.xs, marginTop: theme.spacing.sm }}>
        <AppText variant="caption" tone="subtle">
          {t("board.stateCustom")}
        </AppText>
        <ColorSquare
          color={iconColor(color)}
          onChange={onChange}
          testIDPrefix={testIDPrefix}
          squareLabel={t("board.stateCustom")}
          hueLabel={t("board.stateHue")}
        />
        <TextField
          testID={`${testIDPrefix}-hex`}
          label={t("board.stateHex")}
          value={hex}
          onChangeText={escribirHex}
          placeholder={t("board.stateHexPlaceholder")}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={7}
        />
        {!valido ? (
          <AppText variant="caption" tone="subtle">
            {t("board.stateHexInvalid")}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}

/**
 * What the field says as a colour, or `null` for "not one".
 *
 * Six hex digits with or without the hash, either case; canonical form is
 * lowercase with the hash, because that is what the contract's regex reads.
 * Three digits, names and words are not colours here — the twelve above are
 * the names, and a word in this field is a typo wearing confidence.
 */
function normalizarHex(valor: string): string | null {
  const limpio = valor.trim().replace(/^#/, "").toLowerCase();
  return /^[0-9a-f]{6}$/.test(limpio) ? `#${limpio}` : null;
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
