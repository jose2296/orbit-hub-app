import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/text';
import { useTheme } from '@/theme';

export interface LogoMarkProps {
  size?: number;
  /** Renders the wordmark next to the symbol. */
  withWordmark?: boolean;
}

/**
 * OrbitHub mark: a ring with a body on the orbit. Drawn with views so it stays
 * crisp at every size and needs no image asset.
 */
export function LogoMark({ size = 48, withWordmark = false }: LogoMarkProps) {
  const theme = useTheme();
  const ringSize = size;
  const dotSize = Math.max(6, Math.round(size * 0.22));

  return (
    <View style={[styles.row, { gap: theme.spacing.md }]}>
      <View
        accessibilityLabel="OrbitHub"
        style={[
          styles.ring,
          {
            width: ringSize,
            height: ringSize,
            borderRadius: ringSize / 2,
            borderWidth: Math.max(2, Math.round(size * 0.09)),
            borderColor: theme.colors.accent,
            backgroundColor: theme.colors.accentSoft,
          },
        ]}
      >
        <View
          style={{
            width: dotSize,
            height: dotSize,
            borderRadius: dotSize / 2,
            backgroundColor: theme.colors.accent,
          }}
        />
      </View>
      {withWordmark ? (
        <AppText variant="title" accessibilityLabel="OrbitHub">
          OrbitHub
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  ring: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
