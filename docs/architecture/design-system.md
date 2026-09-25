# Design system

One visual source of truth for Android, iOS and web. Tokens live in
`apps/mobile/src/theme/tokens.ts`; nothing in a screen may hardcode a colour, spacing value or
radius.

## Structure

```text
src/theme/
├── tokens.ts            colours, spacing, radius, typography, shadows
├── theme-provider.tsx   appearance + accent state, persisted locally
└── index.ts             public surface
src/components/ui/       the reusable kit
```

## Colour

Two neutral ramps (light, dark) plus five accents. Every accent defines five roles:

| Token | Use |
| --- | --- |
| `accent` | Primary buttons, active tabs, focus rings, icons |
| `onAccent` | Content placed on `accent` |
| `accentSoft` | Badges, selected rows, tinted surfaces |
| `accentSoftText` | Accent text on `accentSoft` |
| `accentBorder` | Accent borders on inputs and outlined controls |

Neutrals cover `background`, `surface`, `surfaceMuted`, `surfaceSunken`, `border`,
`borderStrong`, `text`, `textMuted`, `textSubtle`, `skeleton`, `overlay`, `tabBar`.
Status colours (`success`, `warning`, `danger`, `info`) each have a soft variant.

Accents: `orbit` (default blue), `violet`, `emerald`, `amber`, `rose`. The user picks one in
Settings; the choice is persisted per device and applied instantly.

Appearance is `system`, `light` or `dark`. With `system`, the OS setting decides and the app
re-renders on change.

## Typography

| Token | Size / line height | Weight |
| --- | --- | --- |
| `display` | 32 / 38 | 700 |
| `title` | 24 / 30 | 700 |
| `heading` | 18 / 24 | 600 |
| `body` | 16 / 23 | 400 |
| `bodyStrong` | 16 / 22 | 600 |
| `callout` | 14 / 20 | 500 |
| `caption` | 12 / 17 | 500 |
| `label` | 11 / 14 | 600, uppercase |

System fonts only. Custom fonts are a deliberate future decision, not a default.

## Spacing and radius

4-point scale: `xxs 2`, `xs 4`, `sm 8`, `md 12`, `lg 16`, `xl 24`, `xxl 32`, `xxxl 48`.
Radii: `sm 8`, `md 12`, `lg 16`, `xl 22`, `pill 999`.

## Component kit

| Component | Purpose |
| --- | --- |
| `Screen` | Safe areas, background, optional scroll, keyboard avoidance |
| `AppText` | Every piece of text, with variant and tone |
| `Button` | primary / secondary / ghost / danger, three sizes, loading state |
| `Card` | default / elevated / outlined / muted |
| `TextField` | label, hint, error, password reveal, focus ring |
| `Checkbox` | Terms and settings toggles |
| `Badge` | Status pills with tone |
| `SectionHeader`, `ListRow` | Screen anatomy and settings rows |
| `EmptyState` | Designed empty states, never a blank screen |
| `Segmented` | Two to three mutually exclusive options |
| `SwatchPicker` | Accent selection |
| `Divider` | Horizontal or vertical |
| `LogoMark` | Brand mark, drawn with views so it scales crisply |

## Conventions

- Touch targets are at least 44×44 on native; buttons are 36/48/56 by size.
- Every interactive element declares `accessibilityRole` and, where useful, a label.
- Pressed state is opacity plus background change, never a layout shift.
- `empty`, `loading`, `error` and `content` are designed states of every screen that loads data.
- Elevation uses the theme shadows so light and dark stay consistent.

## What this deliberately avoids

- No styling library (NativeWind, Tamagui, Restyle): tokens plus a small kit are enough today
  and keep the web bundle small.
- No web-only CSS. React Native styles are the shared language; the web target adapts with
  `Pressable` states and focus rings rather than with CSS.
- No AI-generated card soup: sections use `SectionHeader` + content, not a card around every
  element.
