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
          /*
            La etiqueta, como nombre del campo.

            El `AppText` de arriba es una etiqueta *visual*: es un `div` con texto,
            no un `<label for>`, asi que nada en el documento la conecta a este
            input. Un lector de pantalla anuncia entonces "campo de texto", "correo",
            "contraseña", "contraseña" — cuatro cajas seguidas sin nada que las
            distinga, y quien rellena un registro no oye cual de las dos quiere la
            contraseña repetida.

            No es un problema solo de la web: en nativo lo lee igual TalkBack o
            VoiceOver, asi que el campo no tiene nombre en ninguna plataforma.

            Va **despues** de `{...rest}` para que un `accessibilityLabel` explicito
            del que llama siga mandando. Que la etiqueta visible y la dicha fueran
            distintas seria una segunda version de la misma confusion.
          */
          accessibilityLabel={rest.accessibilityLabel ?? label}
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
