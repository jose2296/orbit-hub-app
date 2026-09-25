import type { Accent } from '@orbit-hub/contracts';
import type { TextStyle, ViewStyle } from 'react-native';

export type ColorSchemeName = 'light' | 'dark';

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
      solid: '#3B63E0',
      onSolid: '#FFFFFF',
      soft: '#E8EDFD',
      softText: '#29429C',
      border: '#B9C7F7',
    },
    dark: {
      solid: '#7C97FF',
      onSolid: '#0B1020',
      soft: '#1B2440',
      softText: '#B9C7FF',
      border: '#2F3C63',
    },
  },
  violet: {
    light: {
      solid: '#7C3AED',
      onSolid: '#FFFFFF',
      soft: '#F1EAFE',
      softText: '#5B21B6',
      border: '#D3C2F8',
    },
    dark: {
      solid: '#A78BFA',
      onSolid: '#14061F',
      soft: '#251A3A',
      softText: '#D3C2F8',
      border: '#3C2C5C',
    },
  },
  emerald: {
    light: {
      solid: '#0E9F6E',
      onSolid: '#FFFFFF',
      soft: '#E1F6EE',
      softText: '#0A6B4C',
      border: '#A9E0CB',
    },
    dark: {
      solid: '#34D399',
      onSolid: '#04160F',
      soft: '#12291F',
      softText: '#A9E0CB',
      border: '#1F4636',
    },
  },
  amber: {
    light: {
      solid: '#C2740A',
      onSolid: '#FFFFFF',
      soft: '#FDF1DF',
      softText: '#8A5406',
      border: '#F2D5A8',
    },
    dark: {
      solid: '#FBBF24',
      onSolid: '#1A1204',
      soft: '#2C2210',
      softText: '#F2D5A8',
      border: '#4A3A19',
    },
  },
  rose: {
    light: {
      solid: '#D42D5C',
      onSolid: '#FFFFFF',
      soft: '#FDE8EE',
      softText: '#96173C',
      border: '#F6BCCB',
    },
    dark: {
      solid: '#FB7185',
      onSolid: '#1F0509',
      soft: '#2E1419',
      softText: '#F6BCCB',
      border: '#4E222B',
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
    background: '#F6F7FB',
    surface: '#FFFFFF',
    surfaceMuted: '#F0F2F8',
    surfaceSunken: '#E9ECF4',
    border: '#E2E6EF',
    borderStrong: '#CBD2E1',
    text: '#0E1220',
    textMuted: '#59627A',
    textSubtle: '#8A93A8',
    skeleton: '#E7EAF2',
    overlay: 'rgba(14, 18, 32, 0.45)',
    tabBar: '#FFFFFF',
    shadow: '#0E1220',
  },
  dark: {
    background: '#0B1020',
    surface: '#141A28',
    surfaceMuted: '#1B2231',
    surfaceSunken: '#10151F',
    border: '#242D3E',
    borderStrong: '#37425A',
    text: '#F3F6FC',
    textMuted: '#9AA5BC',
    textSubtle: '#6C7791',
    skeleton: '#1E2634',
    overlay: 'rgba(3, 6, 14, 0.6)',
    tabBar: '#101623',
    shadow: '#000000',
  },
};

const STATUS: Record<
  ColorSchemeName,
  { success: string; successSoft: string; warning: string; warningSoft: string; danger: string; dangerSoft: string; info: string; infoSoft: string }
> = {
  light: {
    success: '#0E9F6E',
    successSoft: '#E1F6EE',
    warning: '#C2740A',
    warningSoft: '#FDF1DF',
    danger: '#D42D5C',
    dangerSoft: '#FDE8EE',
    info: '#3B63E0',
    infoSoft: '#E8EDFD',
  },
  dark: {
    success: '#34D399',
    successSoft: '#12291F',
    warning: '#FBBF24',
    warningSoft: '#2C2210',
    danger: '#FB7185',
    dangerSoft: '#2E1419',
    info: '#7C97FF',
    infoSoft: '#1B2440',
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

const TYPE_SCALE = {
  display: { fontSize: 32, lineHeight: 38, fontWeight: '700' },
  title: { fontSize: 24, lineHeight: 30, fontWeight: '700' },
  heading: { fontSize: 18, lineHeight: 24, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 23, fontWeight: '400' },
  bodyStrong: { fontSize: 16, lineHeight: 22, fontWeight: '600' },
  callout: { fontSize: 14, lineHeight: 20, fontWeight: '500' },
  caption: { fontSize: 12, lineHeight: 17, fontWeight: '500' },
  label: { fontSize: 11, lineHeight: 14, fontWeight: '600', letterSpacing: 0.6 },
} as const satisfies Record<string, TextStyle>;

export type ThemeColors = NeutralColors &
  (typeof STATUS)['light'] & {
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
    // `boxShadow` rather than the `shadow*` family: React Native Web dropped
    // the old props, and the new architecture understands the CSS form on
    // native too, so one token covers all three targets.
    shadow: {
      card: {
        boxShadow: `0px 6px 16px ${withAlpha(neutral.shadow, scheme === 'light' ? 0.08 : 0.4)}`,
        elevation: 2,
      },
      floating: {
        boxShadow: `0px 12px 24px ${withAlpha(neutral.shadow, scheme === 'light' ? 0.16 : 0.55)}`,
        elevation: 8,
      },
    },
  };
}

/** `#RRGGBB` plus an alpha, as an 8 digit hex colour. */
function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace('#', '');
  const full =
    value.length === 3
      ? value
          .split('')
          .map((char) => char + char)
          .join('')
      : value;
  const channel = Math.round(Math.min(Math.max(alpha, 0), 1) * 255)
    .toString(16)
    .padStart(2, '0');
  return `#${full}${channel}`;
}

export const ACCENT_NAMES = Object.keys(ACCENTS) as Accent[];

export function accentSwatch(accent: Accent, scheme: ColorSchemeName): string {
  return ACCENTS[accent][scheme].solid;
}
