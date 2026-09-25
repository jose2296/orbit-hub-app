import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import type { ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from '@/theme';

export interface ScreenProps {
  children: React.ReactNode;
  scroll?: boolean;
  /** Extra bottom padding, e.g. to clear a sticky footer. */
  bottomInset?: number;
  style?: ViewStyle;
  testID?: string;
}

/**
 * Base screen: safe areas, background colour and an optional scroll container.
 * Every route uses it so spacing stays consistent across platforms.
 */
export function Screen({ children, scroll = true, bottomInset = 0, style, testID }: ScreenProps) {
  const theme = useTheme();

  const content = scroll ? (
    <ScrollView
      contentContainerStyle={[
        styles.content,
        {
          padding: theme.spacing.lg,
          paddingBottom: theme.spacing.xxl + bottomInset,
          gap: theme.spacing.lg,
        },
      ]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  ) : (
    <View
      style={[
        styles.content,
        styles.flex,
        {
          padding: theme.spacing.lg,
          paddingBottom: theme.spacing.xxl + bottomInset,
          gap: theme.spacing.lg,
        },
      ]}
    >
      {children}
    </View>
  );

  return (
    <SafeAreaView
      edges={['top', 'left', 'right']}
      style={[styles.flex, { backgroundColor: theme.colors.background }, style]}
      testID={testID}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        {content}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
  },
});
