import { Platform } from "react-native";

/**
 * The props that mark a control as the chosen one, on both platforms.
 *
 * **react-native-web 0.21.2 ignores `accessibilityState` entirely.** Not "mostly
 * ignores": the string does not appear in its prop handling at all, and the
 * `forwardedProps` list it filters through has no entry for it. So a component
 * that only says `accessibilityState={{ selected: true }}` — which is the React
 * Native way, and the way everything in this app was written — produces a
 * `role="radio"` in the DOM with **no `aria-selected` at all**. Measured: zero
 * elements with `aria-selected` in the whole page, including the one that was
 * visibly selected and the one carrying the accent border.
 *
 * It also hits the twelve colour swatches, which is a worse version of the same
 * problem: a row of twelve mutually exclusive circles that says nothing at all to
 * anyone asking the page which one is on.
 *
 * So both are passed. RNW reads `aria-selected`; native reads `accessibilityState`,
 * and neither is harmed by the other being present.
 *
 * **This is app-wide, not just this picker.** Every `accessibilityState.selected`
 * in the codebase has the same hole. The one place the runtime difference was
 * verified against `node_modules` rather than against the page is documented here
 * so the next person does not go looking for it.
 */
export function selectedProps(selected: boolean): {
  accessibilityState: { selected: boolean };
  "aria-selected"?: boolean;
} {
  return {
    accessibilityState: { selected },
    ...(Platform.OS === "web" ? { "aria-selected": selected } : {}),
  };
}

/**
 * The same, for a control that opens and closes something.
 *
 * The same hole, the same fix, and it is worth its own function because the
 * disclosure is the case where the missing attribute costs the most: a
 * disclosure button that does not say it is a disclosure is indistinguishable
 * from a link to a screen, so a screen reader announces "button" and stops, and
 * the person has no idea whether there is anything behind it.
 *
 * Measured on this app's menu button before the fix: `role="button"`,
 * `aria-label="Cerrar el menú"`, and no `aria-expanded` — a control that said it
 * was closing a menu and gave no sign of whether the menu was open.
 *
 * The chevrons that open a space, a folder and a list in the drawer had the same
 * hole, as did the three rows of the tree while they are open, which is why this
 * is used in five places in that one file and not one.
 */
export function expandedProps(expanded: boolean): {
  accessibilityState: { expanded: boolean };
  "aria-expanded"?: boolean;
} {
  return {
    accessibilityState: { expanded },
    ...(Platform.OS === "web" ? { "aria-expanded": expanded } : {}),
  };
}
