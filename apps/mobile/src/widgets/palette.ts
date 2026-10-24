/**
 * The colours of the widgets.
 *
 * Fixed values and not the theme: a widget is drawn by Android's launcher from a headless JS task,
 * so there is no `ThemeProvider` and no `useTheme()` to read. They are the brand's own dark card so
 * the widget reads the same over any wallpaper.
 */
export const widgetPalette = {
  card: "#0B1020",
  cardRaised: "#161D33",
  text: "#FFFFFF",
  muted: "#9AA3BC",
  accent: "#6D83FF",
  done: "#34D399",
} as const;
