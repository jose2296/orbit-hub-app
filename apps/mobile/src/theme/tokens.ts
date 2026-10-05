import type { Accent } from "@orbit-hub/contracts";
import type { TextStyle, ViewStyle } from "react-native";

export type ColorSchemeName = "light" | "dark";

export interface AccentColors {
  /** Filled accent surface (buttons, active tabs, focus rings). */
  solid: string;
  /** Text/icon colour that sits on top of `solid`. */
  onSolid: string;
  /** Tinted background for badges and selected rows. */
  soft: string;
  /** Accent coloured text that sits on top of `soft`. */
  softText: string;
  /** Accent coloured border for inputs and outlined controls. */
  border: string;
}

const ACCENTS: Record<Accent, { light: AccentColors; dark: AccentColors }> = {
  orbit: {
    light: {
      solid: "#3B63E0",
      onSolid: "#FFFFFF",
      soft: "#E8EDFD",
      softText: "#29429C",
      border: "#B9C7F7",
    },
    dark: {
      solid: "#7C97FF",
      onSolid: "#0B1020",
      soft: "#1B2440",
      softText: "#B9C7FF",
      border: "#2F3C63",
    },
  },
  violet: {
    light: {
      solid: "#7C3AED",
      onSolid: "#FFFFFF",
      soft: "#F1EAFE",
      softText: "#5B21B6",
      border: "#D3C2F8",
    },
    dark: {
      solid: "#A78BFA",
      onSolid: "#14061F",
      soft: "#251A3A",
      softText: "#D3C2F8",
      border: "#3C2C5C",
    },
  },
  emerald: {
    light: {
      solid: "#0E9F6E",
      onSolid: "#FFFFFF",
      soft: "#E1F6EE",
      softText: "#0A6B4C",
      border: "#A9E0CB",
    },
    dark: {
      solid: "#34D399",
      onSolid: "#04160F",
      soft: "#12291F",
      softText: "#A9E0CB",
      border: "#1F4636",
    },
  },
  amber: {
    light: {
      solid: "#C2740A",
      onSolid: "#FFFFFF",
      soft: "#FDF1DF",
      softText: "#8A5406",
      border: "#F2D5A8",
    },
    dark: {
      solid: "#FBBF24",
      onSolid: "#1A1204",
      soft: "#2C2210",
      softText: "#F2D5A8",
      border: "#4A3A19",
    },
  },
  rose: {
    light: {
      solid: "#D42D5C",
      onSolid: "#FFFFFF",
      soft: "#FDE8EE",
      softText: "#96173C",
      border: "#F6BCCB",
    },
    dark: {
      solid: "#FB7185",
      onSolid: "#1F0509",
      soft: "#2E1419",
      softText: "#F6BCCB",
      border: "#4E222B",
    },
  },
};

interface NeutralColors {
  background: string;
  surface: string;
  surfaceMuted: string;
  surfaceSunken: string;
  border: string;
  borderStrong: string;
  text: string;
  textMuted: string;
  textSubtle: string;
  skeleton: string;
  overlay: string;
  tabBar: string;
  shadow: string;
}

const NEUTRALS: Record<ColorSchemeName, NeutralColors> = {
  light: {
    background: "#F6F7FB",
    surface: "#FFFFFF",
    surfaceMuted: "#F0F2F8",
    surfaceSunken: "#E9ECF4",
    border: "#E2E6EF",
    borderStrong: "#CBD2E1",
    text: "#0E1220",
    textMuted: "#59627A",
    textSubtle: "#8A93A8",
    skeleton: "#E7EAF2",
    /*
      The veil over a sheet, **and it was too light to read as a veil.**

      Forty-five percent of a near-black over a near-white screen leaves the
      background legible: the poster behind the sheet stays recognisable, the
      header under it stays readable, and a person cannot tell at a glance whether
      the thing on top of the screen is a sheet they opened or the screen itself
      with a panel on it. A veil is a statement that something is on top and
      something else is not available right now, and at this strength it was a
      tint.

      Sixty-two is measured on the web, not chosen: it is the point where the
      background is unmistakably behind glass — the header text is no longer
      something you would read if you meant to — while the sheet's own text is
      still the brightest thing on the screen by a long way. Going further starts
      costing the panel's contrast against its own veil, which is the opposite of
      what a veil is for.

      **This token is the bottom sheet's and nothing else's.** It is read in one
      place in the whole app, so darkening it darkens the sheet and not the drawer,
      the dialogs or anything else that might have wanted the old strength.
    */
    overlay: "rgba(10, 13, 26, 0.62)",
    tabBar: "#FFFFFF",
    shadow: "#0E1220",
  },
  dark: {
    background: "#0B1020",
    surface: "#141A28",
    surfaceMuted: "#1B2231",
    surfaceSunken: "#10151F",
    border: "#242D3E",
    borderStrong: "#37425A",
    text: "#F3F6FC",
    textMuted: "#9AA5BC",
    textSubtle: "#6C7791",
    skeleton: "#1E2634",
    /*
      The same veil in the dark, and **dark for the opposite reason**: here the
      background behind the sheet is already almost black, so a near-black veil at
      a strength that reads on white reads as nothing at all. It is pushed further
      than the light one for the same effect and not because dark needs to be
      heavier — because on a dark screen the only thing a veil can take away is
      light, and this one was taking almost none.
    */
    overlay: "rgba(2, 4, 10, 0.76)",
    tabBar: "#101623",
    shadow: "#000000",
  },
};

const STATUS: Record<
  ColorSchemeName,
  {
    success: string;
    successSoft: string;
    warning: string;
    warningSoft: string;
    danger: string;
    dangerSoft: string;
    info: string;
    infoSoft: string;
  }
> = {
  light: {
    success: "#0E9F6E",
    successSoft: "#E1F6EE",
    warning: "#C2740A",
    warningSoft: "#FDF1DF",
    danger: "#D42D5C",
    dangerSoft: "#FDE8EE",
    info: "#3B63E0",
    infoSoft: "#E8EDFD",
  },
  dark: {
    success: "#34D399",
    successSoft: "#12291F",
    warning: "#FBBF24",
    warningSoft: "#2C2210",
    danger: "#FB7185",
    dangerSoft: "#2E1419",
    info: "#7C97FF",
    infoSoft: "#1B2440",
  },
};

export const SPACING = {
  none: 0,
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const RADIUS = {
  none: 0,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 22,
  pill: 999,
} as const;

/**
 * La escala, **en orden, y bajando**.
 *
 * Antes de esto la tabla estaba escrita asi:
 *
 * ```
 * display 32 · title 24 · heading 18 · body 16 · bodyLarge 18 · bodyStrong 16
 * ```
 *
 * Nueve nombres para siete tamaños, y el tamaño **volvía a subir** en `bodyLarge`.
 * Una tabla así no puede contestar a "haz los textos más grandes": tocar un nombre
 * sube el que está debajo y baja el que está encima, y no hay forma de saber
 * cuál de los dos era el que había que tocar.
 *
 * La regla que se sigue ahora, y que `test/type-scale.test.ts` comprueba:
 *
 * 1. **El orden en que se declara es el orden en que baja el tamaño.** Un nombre no
 *    puede meterse entre dos que no le dejan sitio.
 * 2. **Un tamaño, un nombre.** La única repetición es `bodyStrong`, que es `body` en
 *    negrita: mismo tamaño, mismo interlineado, distinto peso. Antes `bodyStrong`
 *    medía 16/22 y `body` 16/23 — el mismo tamaño a dos alturas distintas, que es
 *    la forma de que dos renglones que deberían alinearse no se alineen.
 * 3. **El interlineado no se aprieta al bajar el tamaño.** Si la razón
 *    `lineHeight / fontSize` sube al bajar, el paso pequeño se nota pegado y el
 *    grande se nota aireado, que es la jerarquía al revés.
 * 4. **La razón es la misma para `body` y `bodyStrong`**, por el punto 2.
 *
 * Los números: subir uno a cada uno, menos `display`, que es de las dos pantallas
 * que ya son una sola cosa grande y subirlo las empuja al borde.
 *
 * `display` 32→34 se sube y no se sube a 40 porque es la pantalla del nombre
 * entero, y a 40 un título largo deja de caber en la caja. Es el único sitio donde
 * la regla dice "un punto más" y el resto dice "los de abajo", y está escrito
 * aquí para que la próxima vez se sepa que fue a propósito.
 */
export const TYPE_SCALE = {
  /** The one screen whose whole content is a name. */
  display: { fontSize: 34, lineHeight: 40, fontWeight: "700" },
  /** The title of a sheet, and of a card that is mostly a title. */
  title: { fontSize: 26, lineHeight: 32, fontWeight: "700" },
  /**
   * A screen's own title in the bar, and a section inside a sheet.
   *
   * It was 18 and it is 20. **Not `title`**, which was measured: the bar leaves 264
   * points between the menu and the action slot, and at 26 a thirty-character name
   * wants about 390 — so every long list would have shown a cut name in the one
   * line that says which screen you are on. Twenty is as far as it goes before that
   * starts happening, and a cut name is still recoverable with a long press.
   */
  heading: { fontSize: 20, lineHeight: 26, fontWeight: "600" },
  /** For the one long text a screen is really about, like a film's synopsis. */
  bodyLarge: { fontSize: 19, lineHeight: 27, fontWeight: "400" },
  body: { fontSize: 17, lineHeight: 24, fontWeight: "400" },
  /** `body` in bold. Same size, **same leading**: see rule 2 above. */
  bodyStrong: { fontSize: 17, lineHeight: 24, fontWeight: "600" },
  callout: { fontSize: 15, lineHeight: 21, fontWeight: "500" },
  /**
   * Counts, badges and the small print. 174 uses, and the reason the app read small:
   * it was the most-used size in it and it was 12.
   */
  caption: { fontSize: 13, lineHeight: 18, fontWeight: "500" },
  /** Uppercase micro-labels. */
  label: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "600",
    letterSpacing: 0.6,
  },
} as const satisfies Record<string, TextStyle>;

/**
 * How much bigger an icon is than the label it goes with.
 *
 * An icon **leads** its label. Same size and the row reads as two things of equal
 * weight instead of a name with a picture in front of it, and this is not a matter
 * of taste: it is what happens when the text moves and the icons do not.
 *
 * Measured while making this, and it is the reason the icons are not left alone.
 * The drawer's nav icons were `size={18}` written by hand in **31 places**, and the
 * label beside them was 16. Then the label went to 17 and the icon stayed at 18 —
 * one point of lead on a row that had had two, which is a row that has quietly
 * stopped being an icon. So the number now comes from the size of the text, and
 * there is only one number.
 */
const ICON_LEAD = 1.15;

/**
 * The icon that goes with each size, **computed and not written**.
 *
 * A second table of nine numbers next to the first one is how the two drift apart,
 * which is what just happened. This one cannot be edited: it is `TYPE_SCALE` with
 * `fontSize * 1.15`, and `test/type-scale.test.ts` comprueba que el icono sigue
 * siendo más grande que la etiqueta.
 */
/**
 * La tipografía del **cuerpo de una nota**, y solo de ahí.
 *
 * El editor de notas es el único sitio de la app que **no fija la familia**: usa
 * `theme.typography.body` para el tamaño y para el color, y para la letra se queda con
 * lo que tenga la plataforma. Que son **tres**: Roboto en Android, San Francisco en iOS y
 * la del navegador en la web — Chromium y Safari no tienen la misma, así que en web
 * tampoco hay una sola. Medido: la misma nota se ve distinta en cada uno de los tres
 * sitios, y el editor tenía ya un comentario diciendo que sin esto "la nota se leía como
 * otra app en vez de como una pantalla de esta". El comentario llevaba razón y el tamaño
 * estaba resuelto; la familia no.
 *
 * **Una pila de las que ya tiene el sistema, y no una fuente empaquetada.** Una fuente
 * propia son megabytes en el bundle y un salto visible mientras carga —y en el editor de
 * notas eso es la primera cosa que se ve al abrir—. Una pila de serifas del sistema no
 * cuesta nada, está en las tres plataformas y no se nota la diferencia entre ellas en el
 * cuerpo de texto, que es donde la serifa importa y no en la interfaz.
 *
 * **Serifada a propósito, y solo en las notas.** Una nota es el único texto de la app
 * que se lee de principio a fin: las listas son rótulos, los títulos son rótulos, y un
 * rótulo en serifa es un rótulo con adorno. El cuerpo de una nota de tres párrafos en
 * una sans de interfaz es correcto y es lo que hace todo el mundo; en un párrafo largo
 * cansa más, y la serifa es lo que sostiene la lectura sin que se canse la vista.
 */
export const NOTE_BODY_FONT =
  // iOS y macOS
  'ui-serif, "New York", Georgia, ' +
  // Android
  '"Noto Serif", "Roboto Serif", serif, ' +
  // Windows y el resto de escritorio
  '"Segoe UI", Cambria, "Times New Roman", serif';

export const ICON_SCALE = Object.fromEntries(
  Object.entries(TYPE_SCALE).map(([nombre, t]) => [nombre, Math.round(t.fontSize * ICON_LEAD)]),
) as Record<keyof typeof TYPE_SCALE, number>;

export type ThemeColors = NeutralColors &
  (typeof STATUS)["light"] & {
    /** Filled accent surface: primary buttons, active tabs, focus rings. */
    accent: string;
    /** Content colour that sits on `accent`. */
    onAccent: string;
    /** Tinted accent background: badges, selected rows. */
    accentSoft: string;
    /** Accent coloured text on top of `accentSoft`. */
    accentSoftText: string;
    /** Accent coloured border: inputs and outlined controls. */
    accentBorder: string;
    onSurface: string;
    headerBackground: string;
  };

export interface Theme {
  scheme: ColorSchemeName;
  accent: Accent;
  colors: ThemeColors;
  spacing: typeof SPACING;
  radius: typeof RADIUS;
  typography: typeof TYPE_SCALE;
  /** The icon that goes with each size. See `ICON_SCALE`. */
  iconSize: typeof ICON_SCALE;
  shadow: {
    card: ViewStyle;
    floating: ViewStyle;
  };
}

export function createTheme(scheme: ColorSchemeName, accent: Accent): Theme {
  const neutral = NEUTRALS[scheme];
  const status = STATUS[scheme];
  const accentColors = ACCENTS[accent][scheme];

  return {
    scheme,
    accent,
    colors: {
      ...neutral,
      ...status,
      accent: accentColors.solid,
      onAccent: accentColors.onSolid,
      accentSoft: accentColors.soft,
      accentSoftText: accentColors.softText,
      accentBorder: accentColors.border,
      onSurface: neutral.text,
      headerBackground: neutral.background,
    },
    spacing: SPACING,
    radius: RADIUS,
    typography: TYPE_SCALE,
    iconSize: ICON_SCALE,
    // `boxShadow` rather than the `shadow*` family: React Native Web dropped
    // the old props, and the new architecture understands the CSS form on
    // native too, so one token covers all three targets.
    shadow: {
      card: {
        boxShadow: `0px 6px 16px ${withAlpha(neutral.shadow, scheme === "light" ? 0.08 : 0.4)}`,
        elevation: 2,
      },
      floating: {
        boxShadow: `0px 12px 24px ${withAlpha(neutral.shadow, scheme === "light" ? 0.16 : 0.55)}`,
        elevation: 8,
      },
    },
  };
}

/** `#RRGGBB` plus an alpha, as an 8 digit hex colour. */
function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  const full =
    value.length === 3
      ? value
          .split("")
          .map((char) => char + char)
          .join("")
      : value;
  const channel = Math.round(Math.min(Math.max(alpha, 0), 1) * 255)
    .toString(16)
    .padStart(2, "0");
  return `#${full}${channel}`;
}

export const ACCENT_NAMES = Object.keys(ACCENTS) as Accent[];

export function accentSwatch(accent: Accent, scheme: ColorSchemeName): string {
  return ACCENTS[accent][scheme].solid;
}
