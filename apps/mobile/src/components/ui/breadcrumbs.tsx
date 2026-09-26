import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { useTranslation } from '@/lib/i18n';
import { useTheme } from '@/theme';

import { AppText } from './text';

export interface Crumb {
  label: string;
  href?: string;
}

/**
 * Where you are, as a path you can click.
 *
 * A title on its own says which screen this is; a path says how you got here
 * and how to get back. It only appears when there is somewhere to go: on a
 * screen with no parent, a single crumb is just the title again.
 */
export function Breadcrumbs({ crumbs }: { crumbs: Crumb[] }) {
  const theme = useTheme();
  const router = useRouter();

  if (crumbs.length < 2) return null;

  return (
    <View
      accessibilityRole="summary"
      style={[styles.row, { gap: theme.spacing.xs }]}
    >
      {crumbs.map((crumb, index) => {
        const last = index === crumbs.length - 1;
        return (
          <View key={`${crumb.label}-${index}`} style={[styles.row, { gap: theme.spacing.xs }]}>
            {index > 0 ? (
              <Ionicons
                name="chevron-forward"
                size={12}
                color={theme.colors.textSubtle}
              />
            ) : null}
            {crumb.href && !last ? (
              <Pressable
                accessibilityRole="link"
                accessibilityLabel={crumb.label}
                onPress={() => router.push(crumb.href as never)}
                hitSlop={6}
              >
                <AppText variant="caption" tone="accent">
                  {crumb.label}
                </AppText>
              </Pressable>
            ) : (
              <AppText variant="caption" tone={last ? 'muted' : 'subtle'}>
                {crumb.label}
              </AppText>
            )}
          </View>
        );
      })}
    </View>
  );
}

/**
 * A button that goes back, with a landing place when there is nothing to go
 * back to.
 *
 * A deep link or a fresh tab has no history, and a back button that does
 * nothing is worse than none: the person taps it twice and blames the app.
 */
export function BackButton({ fallbackHref }: { fallbackHref?: string }) {
  const theme = useTheme();
  const t = useTranslation();
  const router = useRouter();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('common.back')}
      hitSlop={10}
      onPress={() => {
        if (router.canGoBack()) router.back();
        else if (fallbackHref) router.replace(fallbackHref as never);
        else router.replace('/(app)/(tabs)');
      }}
      style={({ pressed }) => [
        styles.back,
        {
          backgroundColor: theme.colors.surfaceMuted,
          borderRadius: theme.radius.pill,
          opacity: pressed ? 0.7 : 1,
          marginRight: theme.spacing.xs,
        },
      ]}
    >
      <Ionicons name="chevron-back" size={20} color={theme.colors.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  back: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
