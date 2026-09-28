import type { ReactNode } from "react";
import { useRef } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";

let contador = 0;
const siguienteId = () => `pista-${(contador += 1)}`;

/**
 * A hint a screen reader can actually read, on every platform.
 *
 * **Why this exists.** `accessibilityHint` is an iOS prop. react-native-web
 * 0.21.2 does not have the string anywhere in its package, and it filters props
 * through a strict allowlist, so on web the hint is deleted at the `<View>`
 * boundary: no ARIA attribute, no unknown-attribute leak, no warning. Every one
 * of the 27 hints in this app works on a phone and does not exist in a browser,
 * and nothing in the DOM or the console says so. An accessibility audit cannot
 * find a gap that leaves no trace.
 *
 * The web target is `aria-describedby`, which wants the *id of an element*, not
 * a string — so the text has to exist in the document. Hence a hidden node: it
 * is in the accessibility tree, it is not painted, and it is not read by anybody
 * looking at the screen.
 *
 * On native both are passed: `accessibilityHint` is real there and is what
 * VoiceOver and TalkBack read.
 *
 * Off-screen rather than `display: none` and not `opacity: 0`, because both of
 * those take the element out of the accessibility tree, which is the one thing
 * it is here for.
 */
export function A11yHint({ hint, children }: { hint: string; children: ReactNode }) {
  const id = useHintId();

  return (
    <View>
      {children}
      {/*
        Rendered on web only. On native it would be a second thing for the screen
        reader to read out loud, because there the hint is already attached to the
        control and a visible-to-the-reader sibling is a duplicate.
      */}
      {Platform.OS === "web" ? (
        <Text id={id} style={styles.soloParaLectores}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * A hint attached to a control, without wrapping it.
 *
 * The spread version, for the call sites that already have a `Pressable` and do
 * not want another element in the tree. Returns the props to spread and the node
 * to render next to it:
 *
 * ```tsx
 * const pista = useA11yHint(t("drawer.opensFolder", { name: folder.name }));
 * <Pressable {...pista.props} />
 * {pista.node}
 * ```
 */
export function useA11yHint(hint?: string | null) {
  const id = useHintId();
  const web = Platform.OS === "web";
  const hay = typeof hint === "string" && hint.length > 0;

  return {
    /**
     * Spread onto the control. **Both** platforms, not one.
     *
     * On web it is `aria-describedby`; on native it is `accessibilityHint` again,
     * which is what the call site was passing before. Returning `{}` on native
     * would have been shorter and it would have quietly deleted the hint from
     * iOS and Android at every migrated call site — the fix for a web bug
     * breaking the platforms that already worked, which is the worst direction
     * for this kind of change to fail in.
     */
    props: !hay
      ? ({} as Record<string, string>)
      : web
        ? ({ "aria-describedby": id } as Record<string, string>)
        : ({ accessibilityHint: hint } as Record<string, string>),
    // Nothing to point at when there is no hint, so no node and no id in the tree.
    node: !hay || !web ? null : (
      <Text id={id} style={styles.soloParaLectores}>
        {hint}
      </Text>
    ),
  };
}

/**
 * The same id on every render, and only one per mount.
 *
 * A `useState` initialiser and not a `useId`: the value has to survive a
 * re-render, and an id that changed on every render would leave `aria-describedby`
 * pointing at a node that no longer exists for the frame in between.
 */
function useHintId(): string {
  // A ref, not `useState(siguienteId)`: that would call the factory on every
  // render and throw the value away, and the id has to be the same one for the
  // life of the component.
  const ref = useRef<string | null>(null);
  if (ref.current === null) ref.current = siguienteId();
  return ref.current;
}

const styles = StyleSheet.create({
  soloParaLectores: {
    position: "absolute",
    // Off the top-left corner, and **not** left at its static position.
    //
    // Measured: with `position: absolute` and no `left`/`top`, the node lands on
    // the top-left pixel of the control it belongs to, and `elementFromPoint`
    // there returns the hint instead of the button. One CSS pixel, in a corner,
    // never the middle — so nothing was visibly broken and nothing was clickable
    // by accident, but "never the middle" is a property of the layout and not a
    // guarantee, and a control with no text is small enough for the corner to be
    // a quarter of it.
    //
    // The node is also the last thing in the tab order of a screen reader, so
    // -9999 does not make it unreachable; it is not focusable and it has nothing
    // to focus.
    left: -9999,
    top: 0,
    width: 1,
    height: 1,
    // Not `display: none` and not `opacity: 0`: both remove the node from the
    // accessibility tree, and being in that tree is the entire job.
    opacity: 0.01,
    overflow: "hidden",
  },
});
