import { Pressable, StyleSheet, View } from 'react-native';

import { useTheme } from '@/theme';

import { AppText } from './text';

/**
 * The side of the box, in points. Exported because something has to line up with
 * it: in a task row the checkbox shares the line of the title, and the line of the
 * labels underneath has to start where the title does and not where the checkbox
 * does. A number written twice is a number that goes stale quietly — the box
 * changes and the indent stays, and nothing says so.
 */
export const CHECKBOX_BOX_SIZE = 22;

export interface CheckboxProps {
  checked: boolean;
  onToggle: () => void;
  label: string;
  disabled?: boolean;
  /** For naming this one box in a test, when there is more than one on screen. */
  testID?: string;
}

export function Checkbox({
  checked,
  onToggle,
  label,
  disabled = false,
  testID,
}: CheckboxProps) {
  const theme = useTheme();

  return (
    <Pressable
      testID={testID}
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      onPress={onToggle}
      style={({ pressed }) => [styles.row, { opacity: disabled ? 0.5 : pressed ? 0.7 : 1, gap: theme.spacing.sm }]}
    >
      <View
        style={[
          styles.box,
          {
            width: CHECKBOX_BOX_SIZE,
            height: CHECKBOX_BOX_SIZE,
            borderRadius: theme.radius.sm,
            borderColor: checked ? theme.colors.accent : theme.colors.borderStrong,
            backgroundColor: checked ? theme.colors.accent : 'transparent',
          },
        ]}
      >
        {checked ? (
          <AppText variant="caption" style={{ color: theme.colors.onAccent }}>
            ✓
          </AppText>
        ) : null}
      </View>
      {/* Only when there is a label, and this is not a detail: see `styles.label`. */}
      {label ? (
        <AppText variant="callout" tone="muted" style={styles.label}>
          {label}
        </AppText>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  box: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
  label: {
    /*
      `flex: 1`, **and that is why the label may not be an empty string.**

      Measured on an Android release build (API 35), on a task row whose label is
      `""`: this `Text` took the whole row — 755 of the row's 754 points of content
      width — and the title column beside it got zero. No title painted, the
      priority badge crushed to ten points wide and wrapping one letter per line,
      and the labels pushed off the right edge. The web lays the same tree out
      correctly, because an empty element measures zero there however it is styled.

      Why Yoga and not the browser: `flex: 1` is `flex-basis: 0%` plus
      `flex-grow: 1`, and the grow is resolved against **the space available to
      this `Pressable`**, not against its own content. The `Pressable` has no
      width of its own, so the space available to it is the whole rest of the row
      it is a child of, and an empty `Text` grows into all of it. The row then has
      nothing left, and the sibling sharing it is the one that disappears — which
      is also why it reads as a missing title rather than as a wide checkbox.

      So the label is rendered only when there is one, and `flex: 1` stays for
      the four call sites that pass text: there the label is meant to fill the row,
      and that is what this does for them.
    */
    flex: 1,
  },
});
