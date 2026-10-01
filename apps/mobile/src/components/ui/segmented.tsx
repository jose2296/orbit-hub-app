import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { useTheme } from '@/theme';

import { AppText } from './text';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  label?: string;
}

export function Segmented<T extends string>({ options, value, onChange, label }: SegmentedProps<T>) {
  const theme = useTheme();

  /*
    The white pill, **and it slides to the chosen one instead of appearing under
    it**.

    This control is all over the app — what kind of view, which sort, which of two
    things — and it answered a press by swapping the background of one segment for
    the transparency of another. A change of colour is a blink: the eye has to find
    where the white went, and on a control this small and this frequent that is a
    cost paid dozens of times a session.

    **The segments are measured and not assumed to be equal.** Two options whose
    labels are three letters and nine letters are not the same width, and a pill
    that is half the row would be visibly wrong on the second one. Each one reports
    where it is, once, and the pill goes to the chosen one's box.
  */
  const [cajas, setCajas] = useState<Record<string, { x: number; width: number }>>({});
  const elegida = cajas[value];
  const x = useSharedValue(0);
  const ancho = useSharedValue(0);

  useEffect(() => {
    if (!elegida) return;
    x.value = withSpring(elegida.x, { damping: 20, stiffness: 240, mass: 0.6 });
    ancho.value = withSpring(elegida.width, { damping: 20, stiffness: 240, mass: 0.6 });
  }, [elegida, x, ancho]);

  const estiloPildora = useAnimatedStyle(() => ({
    width: ancho.value,
    transform: [{ translateX: x.value }],
  }));

  return (
    <View style={{ gap: theme.spacing.sm }}>
      {label ? (
        <AppText variant="callout" tone="muted">
          {label}
        </AppText>
      ) : null}
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={label}
        style={[
          styles.container,
          {
            backgroundColor: theme.colors.surfaceMuted,
            borderRadius: theme.radius.md,
            padding: 3,
            gap: 3,
          },
        ]}
      >
        {ancho.value > 0 ? (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.pildora,
              {
                borderRadius: theme.radius.sm,
                backgroundColor: theme.colors.surface,
                ...theme.shadow.card,
              },
              estiloPildora,
            ]}
          />
        ) : null}

        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value}
              onLayout={(event) => {
                const { x: donde, width } = event.nativeEvent.layout;
                setCajas((previas) =>
                  previas[option.value]?.x === donde && previas[option.value]?.width === width
                    ? previas
                    : { ...previas, [option.value]: { x: donde, width } },
                );
              }}
              accessibilityRole="radio"
              /*
                `aria-checked`, and not only `accessibilityState={{ selected }}`.

                A radio says which one is chosen with `aria-checked`; `aria-selected`
                belongs to a tab or to an option inside a list, and a segmented
                control is neither. React Native Web writes
                `accessibilityState.selected` out as `aria-selected` whatever the
                role is, so on the web this announced itself as a radio and then
                never said which one was chosen — checked in the browser, with
                neither `aria-checked` nor `aria-selected` on the element, which is
                a row of unmarked radios to anything reading it.

                Both are set, and deliberately: the state prop is what the native
                platforms read and this is what the web reads.
              */
              aria-checked={selected}
              accessibilityState={{ selected }}
              onPress={() => onChange(option.value)}
              style={({ pressed }) => [
                styles.segment,
                {
                  borderRadius: theme.radius.sm,
                  paddingVertical: theme.spacing.sm,
                  // Only the press is answered here now. The chosen one is the pill
                  // behind everything, and giving the segment its own background as
                  // well would put two whites on top of each other.
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <AppText
                variant="callout"
                tone={selected ? 'default' : 'muted'}
                align="center"
                style={selected ? { fontWeight: '600' } : undefined}
              >
                {option.label}
              </AppText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  /** Out of the flow, so it does not push the segments along. */
  pildora: {
    position: 'absolute',
    top: 3,
    bottom: 3,
    left: 0,
  },
  container: {
    flexDirection: 'row',
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
