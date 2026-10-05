import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import type { TextInputProps } from 'react-native';

import { counterState } from '@/lib/lists/field-limit';
import { useTheme } from '@/theme';

import { AppText } from './text';

export interface TextFieldProps extends Omit<TextInputProps, 'style'> {
  label?: string;
  error?: string | null;
  hint?: string | null;
  containerStyle?: TextInputProps['style'];
  /**
   * The width of the field, and the counter appears.
   *
   * Not `maxLength`: this is a **warning**, not a cap. `String.length` counts
   * UTF-16 units and so does `maxLength`, so the two would agree — but `maxLength`
   * stops the keystroke, and a person who cannot finish typing a name cannot see
   * what they would have written. Being told "ten left" lets them shorten it.
   *
   * Off by default: the auth fields and the padded ones do not want a counter, and
   * each field opts in with the width the contracts will actually store.
   */
  limit?: number;
}

export function TextField({
  label,
  error,
  hint,
  containerStyle,
  secureTextEntry,
  limit,
  ...rest
}: TextFieldProps) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const counter = limit === undefined ? null : counterState(rest.value ?? '', limit);

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
      {/*
        The hint and the counter share a line, and the counter goes on the right:
        a field that is nearly full has to say so next to where you type, not
        below the error that may or may not be there.

        The error wins the line. An error explains why something was refused, and
        burying it under a character count is how a real message gets missed.
      */}
      {error ? (
        <AppText variant="caption" tone="danger">
          {error}
        </AppText>
      ) : hint ? (
        <AppText variant="caption" tone="subtle">
          {hint}
        </AppText>
      ) : null}

      {counter ? (
        <View style={styles.counterRow}>
          {/*
            `live="polite"` and not `assertive`: a screen reader is told the count
            when it changes and not on every keystroke, which at one character a
            time is unusable. The number is also the accessible name, so it can be
            read on demand without waiting for it to change.
          */}
          <AppText
            variant="caption"
            tone={counter.tone}
            accessibilityRole="text"
            accessibilityLiveRegion="polite"
            accessibilityLabel={`${counter.value}`}
            style={styles.counter}
          >
            {counter.value}
          </AppText>
        </View>
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
  counterRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  counter: {
    // `alignSelf` y no el del `View`: el contador va a su derecha y no puede
    // empujar al texto de al lado.
    flexShrink: 0,
  },
});
