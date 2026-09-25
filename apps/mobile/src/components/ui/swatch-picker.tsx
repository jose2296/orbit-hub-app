import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { useTheme } from '@/theme';
import { ACCENT_NAMES, accentSwatch } from '@/theme';
import type { Accent } from '@orbit-hub/contracts';

import { AppText } from './text';

export interface SwatchPickerProps {
  value: Accent;
  onChange: (accent: Accent) => void;
  label?: string;
}

/** Accent colour picker. Every swatch keeps a visible selected state. */
export function SwatchPicker({ value, onChange, label }: SwatchPickerProps) {
  const theme = useTheme();

  return (
    <View style={{ gap: theme.spacing.sm }}>
      {label ? (
        <AppText variant="callout" tone="muted">
          {label}
        </AppText>
      ) : null}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.row, { gap: theme.spacing.md }]}
      >
        {ACCENT_NAMES.map((accent) => {
          const selected = accent === value;
          return (
            <Pressable
              key={accent}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={accent}
              onPress={() => onChange(accent)}
              style={({ pressed }) => [
                styles.swatch,
                {
                  backgroundColor: accentSwatch(accent, theme.scheme),
                  borderRadius: theme.radius.pill,
                  borderColor: selected ? theme.colors.text : 'transparent',
                  borderWidth: selected ? 2 : 0,
                  opacity: pressed ? 0.8 : 1,
                },
              ]}
            />
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 2,
  },
  swatch: {
    width: 36,
    height: 36,
  },
});
