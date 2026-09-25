import { Pressable, StyleSheet, View } from 'react-native';

import { useTheme } from '@/theme';

import { AppText } from './text';

export interface CheckboxProps {
  checked: boolean;
  onToggle: () => void;
  label: string;
  disabled?: boolean;
}

export function Checkbox({ checked, onToggle, label, disabled = false }: CheckboxProps) {
  const theme = useTheme();

  return (
    <Pressable
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
            width: 22,
            height: 22,
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
      <AppText variant="callout" tone="muted" style={styles.label}>
        {label}
      </AppText>
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
    flex: 1,
  },
});
