import { Pressable, StyleSheet, View } from 'react-native';

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

  return (
    <View style={{ gap: theme.spacing.sm }}>
      {label ? (
        <AppText variant="callout" tone="muted">
          {label}
        </AppText>
      ) : null}
      <View
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
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              onPress={() => onChange(option.value)}
              style={({ pressed }) => [
                styles.segment,
                {
                  backgroundColor: selected ? theme.colors.surface : 'transparent',
                  borderRadius: theme.radius.sm,
                  paddingVertical: theme.spacing.sm,
                  opacity: pressed && !selected ? 0.7 : 1,
                },
                selected ? theme.shadow.card : null,
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
  container: {
    flexDirection: 'row',
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
