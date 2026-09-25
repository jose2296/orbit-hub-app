import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Platform, View } from 'react-native';

import { LogoMark } from '@/components/brand/logo-mark';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Divider } from '@/components/ui/divider';
import { ListRow, SectionHeader } from '@/components/ui/list-row';
import { Screen } from '@/components/ui/screen';
import { Segmented } from '@/components/ui/segmented';
import { AppText } from '@/components/ui/text';
import { SwatchPicker } from '@/components/ui/swatch-picker';
import { useSession } from '@/hooks/use-session';
import { useI18n } from '@/lib/i18n';
import { useThemePreferences } from '@/theme';
import type { Appearance } from '@orbit-hub/contracts';

export default function SettingsScreen() {
  const router = useRouter();
  const { locale, setLocale, t } = useI18n();
  const { appearance, accent, setAppearance, setAccent } = useThemePreferences();
  const { user, signOut } = useSession();
  const [signingOut, setSigningOut] = useState(false);

  function confirmSignOut() {
    if (Platform.OS === 'web') {
      void handleSignOut();
      return;
    }
    Alert.alert(t('settings.signOut'), t('settings.signOutConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('settings.signOut'), style: 'destructive', onPress: () => void handleSignOut() },
    ]);
  }

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await signOut();
      router.replace('/(onboarding)/welcome');
    } finally {
      setSigningOut(false);
    }
  }

  const version = Constants.expoConfig?.version ?? '0.1.0';

  return (
    <Screen>
      <View>
        <AppText variant="title">{t('tabs.settings')}</AppText>
      </View>

      <Card variant="muted">
        <View style={{ gap: 4 }}>
          <AppText variant="label" tone="subtle" uppercase>
            {t('settings.sections.account')}
          </AppText>
          <AppText variant="bodyStrong">{user?.displayName}</AppText>
          <AppText variant="caption" tone="muted">
            {t('settings.signedInAs')} {user?.email}
          </AppText>
        </View>
      </Card>

      <View style={{ gap: 12 }}>
        <SectionHeader title={t('settings.sections.preferences')} />

        <Card style={{ gap: 20 }}>
          <Segmented<Appearance>
            label={t('settings.appearance.theme')}
            value={appearance}
            onChange={setAppearance}
            options={[
              { value: 'system', label: t('settings.appearance.system') },
              { value: 'light', label: t('settings.appearance.light') },
              { value: 'dark', label: t('settings.appearance.dark') },
            ]}
          />

          <SwatchPicker
            label={t('settings.appearance.accent')}
            value={accent}
            onChange={setAccent}
          />

          <Divider />

          <Segmented<'es' | 'en'>
            label={t('settings.language')}
            value={locale}
            onChange={setLocale}
            options={[
              { value: 'es', label: t('settings.language.es') },
              { value: 'en', label: t('settings.language.en') },
            ]}
          />
        </Card>
      </View>

      <View style={{ gap: 12 }}>
        <SectionHeader title={t('settings.sections.data')} />
        <Card padded={false} style={{ paddingHorizontal: 16 }}>
          <ListRow
            icon="phone-portrait-outline"
            title={t('settings.devices')}
            subtitle={t('settings.devices.body')}
            chevron
            onPress={() => router.push('/(app)/devices')}
          />
          <Divider inset={50} />
          <ListRow
            icon="download-outline"
            title={t('settings.export')}
            subtitle={t('settings.export.body')}
            chevron
            onPress={() => {
              // Data export ships with the account API (Phase 1).
            }}
          />
          <Divider inset={50} />
          <ListRow
            icon="trash-outline"
            title={t('settings.deleteAccount')}
            subtitle={t('settings.deleteAccount.body')}
            destructive
          />
        </Card>
      </View>

      <View style={{ gap: 12 }}>
        <SectionHeader title={t('settings.sections.about')} />
        <Card padded={false} style={{ paddingHorizontal: 16 }}>
          <ListRow
            icon="document-text-outline"
            title={t('settings.terms')}
            subtitle={`${t('settings.version')} ${version}`}
            chevron
          />
        </Card>
      </View>

      <View style={{ alignItems: 'center', gap: 12 }}>
        <LogoMark size={32} withWordmark />
        <Button
          label={t('settings.signOut')}
          variant="secondary"
          onPress={confirmSignOut}
          loading={signingOut}
        />
      </View>
    </Screen>
  );
}
