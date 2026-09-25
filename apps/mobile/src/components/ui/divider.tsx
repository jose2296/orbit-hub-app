import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/theme';

export interface DividerProps {
  inset?: number;
  vertical?: boolean;
}

export function Divider({ inset = 0, vertical = false }: DividerProps) {
  const theme = useTheme();

  if (vertical) {
    return (
      <View
        style={{
          width: StyleSheet.hairlineWidth,
          alignSelf: 'stretch',
          backgroundColor: theme.colors.border,
          marginVertical: inset,
        }}
      />
    );
  }

  return (
    <View
      style={{
        height: StyleSheet.hairlineWidth,
        backgroundColor: theme.colors.border,
        marginLeft: inset,
      }}
    />
  );
}
