/**
 * The colours of the widgets, in the two looks the launcher can ask for.
 *
 * Fixed values and not the app's theme: a widget is drawn by Android's launcher from a headless JS
 * task, so there is no `ThemeProvider` and no `useTheme()` to read. Each widget is built twice
 * (`widgetViews` in `widget-views.tsx`) and the launcher shows the one that matches the system.
 */
type Hex = `#${string}`;

export interface Palette {
  card: Hex;
  cardRaised: Hex;
  text: Hex;
  muted: Hex;
  accent: Hex;
  done: Hex;
}

export const darkPalette: Palette = {
  card: "#0B1020",
  cardRaised: "#161D33",
  text: "#FFFFFF",
  muted: "#9AA3BC",
  accent: "#6D83FF",
  done: "#34D399",
};

export const lightPalette: Palette = {
  card: "#FFFFFF",
  cardRaised: "#EEF1FA",
  text: "#0B1020",
  muted: "#5B6580",
  accent: "#3B54E0",
  done: "#0F9F6E",
};
