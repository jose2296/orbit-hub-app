import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import type { ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { useTheme } from '@/theme';

import type { IconName } from './button';
import { AppText } from './text';

export interface EmptyStateProps {
  icon?: IconName;
  title: string;
  description?: string;
  action?: React.ReactNode;
  style?: ViewStyle;
  compact?: boolean;
}

/**
 * Empty is a designed state, not a blank screen: it explains what will appear
 * here and offers the next action.
 *
 * **And it arrives.** It was a static block that was simply there, on a screen
 * that has just changed to nothing: a filter that hides every row, a tab with a
 * zero on it, a list whose only item was deleted. Each of those is a screen the
 * person did not expect to be empty, and appearing instantly makes the emptiness
 * feel like a fault. A quarter of a second of fade and a small rise says "this is
 * the state" instead of "something went wrong", and it costs nothing because there
 * is nothing else on the screen to wait for.
 *
 * The rise is **six points and not a slide**: an empty state is not arriving from
 * anywhere, it is the screen settling.
 */
export function EmptyState({ icon, title, description, action, style, compact = false }: EmptyStateProps) {
  const theme = useTheme();

  const entrada = useSharedValue(0);
  useEffect(() => {
    entrada.value = withTiming(1, { duration: 260, easing: Easing.out(Easing.cubic) });
  }, [entrada]);
  const estilo = useAnimatedStyle(() => ({
    opacity: entrada.value,
    transform: [{ translateY: (1 - entrada.value) * 6 }],
  }));

  return (
    <Animated.View
      style={[
        styles.container,
        estilo,
        {
          gap: theme.spacing.sm,
          paddingVertical: compact ? theme.spacing.lg : theme.spacing.xxl,
          paddingHorizontal: theme.spacing.lg,
        },
        style,
      ]}
    >
      {icon ? (
        <View
          style={[
            styles.icon,
            {
              backgroundColor: theme.colors.accentSoft,
              borderRadius: theme.radius.pill,
              marginBottom: theme.spacing.xs,
            },
          ]}
        >
          <AppText variant="title" style={{ color: theme.colors.accentSoftText }}>
            {icon === 'sparkles' ? '✦' : '◦'}
          </AppText>
        </View>
      ) : null}
      <AppText variant="heading" align="center">
        {title}
      </AppText>
      {description ? (
        <AppText variant="callout" tone="muted" align="center">
          {description}
        </AppText>
      ) : null}
      {action ? <View style={{ marginTop: theme.spacing.sm }}>{action}</View> : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
