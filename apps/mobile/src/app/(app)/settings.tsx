import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Alert, Platform, View } from 'react-native';

import { LogoMark } from '@/components/brand/logo-mark';
import { ExportResultSheet } from '@/components/export/export-result-sheet';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Divider } from '@/components/ui/divider';
import { ListRow, SectionHeader } from '@/components/ui/list-row';
import { Screen } from '@/components/ui/screen';
import { Segmented } from '@/components/ui/segmented';
import { AppText } from '@/components/ui/text';
import { SwatchPicker } from '@/components/ui/swatch-picker';
import { useExport } from '@/hooks/use-export';
import type { ExportRequest } from '@/hooks/use-export';
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
  const { running, error, result, run } = useExport();
  /** Whether the sheet of results is up. What is in it is not state of its own. */
  const [showing, setShowing] = useState(false);

  /**
   * The one request this row ever makes, and **held rather than rebuilt per press.**
   *
   * A retry has to be the same ask — same path, same format, same title, same
   * fallback id — and a request put together again at press time is a request that
   * can come out different: the name of the file is built out of the day and the
   * title, so a retry across midnight, or after the account's name changed, is a
   * second file with another name. One object, sent twice.
   *
   * `title: 'export'` is the title the server itself puts in the
   * `Content-Disposition` of the account export, so both sides build
   * `orbit-hub-export-<date>.json` out of it. The id is only the fallback for a
   * title that leaves nothing usable, and `'export'` never does — it is there
   * because the request carries one.
   */
  const request = useMemo<ExportRequest>(
    () => ({
      path: '/account/export',
      format: 'json',
      title: 'export',
      fallbackId: user?.id ?? 'export',
    }),
    [user?.id],
  );

  /**
   * Whether an attempt is in flight, **in a ref and not in the state above.**
   *
   * The row is disabled while one runs, and the retry button cannot be: the sheet
   * spends a quarter of a second leaving with the button still on it and still
   * pressable, and a second tap in that window is a second download of several
   * megabytes and a second share panel on a phone. A ref is read when the press
   * happens and not when the handler was built, which is the whole point — the
   * button carries the handler from the render the sheet was painted with, and that
   * render's `running` was already false.
   */
  const exporting = useRef(false);

  /**
   * Exporting, and all of it in one function.
   *
   * The sheet goes down before the request and comes back up when the attempt has
   * settled, so it is only ever on screen with something to say — and a retry is
   * this same function, which leaves the panel the way the first press did instead
   * of sitting there on a dead error with a button that has nothing new to do. The
   * row behind is what says "preparing the file…" in between.
   */
  async function handleExport() {
    if (exporting.current) return;
    exporting.current = true;
    setShowing(false);
    try {
      await run(request);
    } finally {
      exporting.current = false;
      setShowing(true);
    }
  }

  function handleRetry() {
    void handleExport();
  }

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
      {/* No header of its own: the title and the menu button come from the header
          the layout above owns, the same one every other screen uses. */}

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
            icon="albums-outline"
            title={t('settings.sheetDemo')}
            subtitle={t('settings.sheetDemo.body')}
            chevron
            onPress={() => router.push('/sheet-demo')}
          />
          <Divider inset={50} />
          {/*
            The one row here that does the thing instead of going somewhere, and the
            two props that say so are the ones this component already has: disabled
            while it runs, and a subtitle that stops describing the row and starts
            describing the wait. `ListRow` has no `loading`, and it is not getting one
            for this — it is the row every screen in the app draws, and a prop that
            only one caller reads is a prop the next caller will read wrongly.

            **And no `chevron`**, which is the other half of saying so. Every other
            row on this screen that has one goes somewhere; this one stays put and
            the panel comes up over it. A chevron promises a screen that is not
            there, and the comment about the old "Términos y privacidad" row below
            is about exactly this — a row that looked navigable and was not.
          */}
          <ListRow
            icon="download-outline"
            title={t('settings.export')}
            subtitle={running ? t('export.running') : t('settings.export.body')}
            disabled={running}
            onPress={() => void handleExport()}
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

      {/*
        What came out, and under what name.

        Opened from the attempt having settled and not from the press, because a
        panel that appears on the press has nothing to say for the seconds a
        multi-megabyte file takes. The attempt is put together here, out of the
        hook's own state, because a snapshot taken before the `await` would be the
        state of the attempt before this one.
      */}
      <ExportResultSheet
        attempt={showing ? { result, error, onRetry: handleRetry } : null}
        onClose={() => setShowing(false)}
      />

      <View style={{ gap: 12 }}>
        <SectionHeader title={t('settings.sections.about')} />
        <Card padded={false} style={{ paddingHorizontal: 16 }}>
          {/*
            Two rows and not one, because this used to be a single row called
            "Términos y privacidad" with a chevron and **no `onPress`**: a link
            that looks like it goes somewhere and does not. One row cannot have
            two destinations, so the name was split and each half got the press
            it always looked like it had.
          */}
          <ListRow
            icon="document-text-outline"
            title={t('settings.terms')}
            subtitle={`${t('settings.version')} ${version}`}
            chevron
            onPress={() => router.push('/terms')}
          />
          <Divider inset={50} />
          <ListRow
            icon="shield-checkmark-outline"
            title={t('settings.privacy')}
            chevron
            onPress={() => router.push('/privacy')}
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

