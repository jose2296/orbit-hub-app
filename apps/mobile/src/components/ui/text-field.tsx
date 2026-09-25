import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import type { TextInputProps } from 'react-native';

import { useTheme } from '@/theme';

import { AppText } from './text';

export interface TextFieldProps extends Omit<TextInputProps, 'style'> {
  label?: string;
  error?: string | null;
  hint?: string | null;
  containerStyle?: TextInputProps['style'];
}

export function TextField({
  label,
  error,
  hint,
  containerStyle,
  secureTextEntry,
  ...rest
}: TextFieldProps) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);

  const borderColor = error
    ? theme.colors.danger
    : focused
      ? theme.colors.accent
      : theme.colors.border;

  const isPassword = secureTextEntry === true;

  return (
    <View style={{ gap: theme.spacing.xs }}>
      {label ? (
        <AppText variant="callout" tone="muted">
          {label}
        </AppText>
      ) : null}
      <View
        style={[
          styles.container,
          {
            borderColor,
            borderWidth: focused || error ? 1.5 : StyleSheet.hairlineWidth * 2,
            borderRadius: theme.radius.md,
            backgroundColor: theme.colors.surface,
            paddingHorizontal: theme.spacing.md,
            minHeight: 48,
          },
        ]}
      >
        <TextInput
          {...rest}
          secureTextEntry={isPassword && !revealed}
          onFocus={(event) => {
            setFocused(true);
            rest.onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            rest.onBlur?.(event);
          }}
          placeholderTextColor={theme.colors.textSubtle}
          selectionColor={theme.colors.accent}
          style={[
            styles.input,
            {
              color: theme.colors.text,
              fontSize: theme.typography.body.fontSize,
            },
            containerStyle,
          ]}
        />
        {isPassword ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={revealed ? 'Hide password' : 'Show password'}
            hitSlop={8}
            onPress={() => setRevealed((value) => !value)}
          >
            <AppText variant="callout" tone="accent">
              {revealed ? 'Hide' : 'Show'}
            </AppText>
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <AppText variant="caption" tone="danger">
          {error}
        </AppText>
      ) : hint ? (
        <AppText variant="caption" tone="subtle">
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  input: {
    flex: 1,
    paddingVertical: 12,
  },
});
