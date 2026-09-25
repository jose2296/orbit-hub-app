import { Ionicons } from '@expo/vector-icons';
import { Link } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { LogoMark } from '@/components/brand/logo-mark';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { AppText } from '@/components/ui/text';
import { useTranslation } from '@/lib/i18n';
import { useTheme } from '@/theme';

const HIGHLIGHTS = [
  { icon: 'albums-outline', key: 'onboarding.point.workspaces' },
  { icon: 'list-outline', key: 'onboarding.point.lists' },
  { icon: 'document-text-outline', key: 'onboarding.point.notes' },
  { icon: 'people-outline', key: 'onboarding.point.collab' },
] as const;

export default function WelcomeScreen() {
  const theme = useTheme();
  const t = useTranslation();

  return (
    <Screen>
      <View style={styles.header}>
        <LogoMark size={56} />
        <View style={{ gap: theme.spacing.sm }}>
          <AppText variant="display">{t('onboarding.title')}</AppText>
          <AppText variant="body" tone="muted">
            {t('onboarding.subtitle')}
          </AppText>
        </View>
      </View>

      <View style={[styles.list, { gap: theme.spacing.md }]}>
        {HIGHLIGHTS.map((highlight) => (
          <View key={highlight.key} style={[styles.item, { gap: theme.spacing.md }]}>
            <View
              style={[
                styles.icon,
                { backgroundColor: theme.colors.accentSoft, borderRadius: theme.radius.md },
              ]}
            >
              <Ionicons name={highlight.icon} size={20} color={theme.colors.accentSoftText} />
            </View>
            <AppText variant="body" style={styles.flex}>
              {t(highlight.key)}
            </AppText>
          </View>
        ))}
      </View>

      <View style={[styles.actions, { gap: theme.spacing.md }]}>
        <Link href="/(auth)/sign-up" asChild>
          <Button label={t('onboarding.createAccount')} icon="arrow-forward" iconPosition="trailing" />
        </Link>
        <Link href="/(auth)/sign-in" asChild>
          <Button label={t('onboarding.signIn')} variant="secondary" />
        </Link>
        <AppText variant="caption" tone="subtle" align="center">
          {t('onboarding.terms')}
        </AppText>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: 24,
    paddingTop: 32,
  },
  list: {
    flex: 1,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  icon: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flex: {
    flex: 1,
  },
  actions: {
    paddingBottom: 8,
  },
});
