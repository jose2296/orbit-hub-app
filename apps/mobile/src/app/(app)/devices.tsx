import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { Device } from '@orbit-hub/contracts';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Divider } from '@/components/ui/divider';
import { EmptyState } from '@/components/ui/empty-state';
import { Screen } from '@/components/ui/screen';
import { AppText } from '@/components/ui/text';
import { useSession } from '@/hooks/use-session';
import { useTranslation } from '@/lib/i18n';
import { useTheme } from '@/theme';

const PLATFORM_ICON: Record<Device['platform'], keyof typeof Ionicons.glyphMap> = {
  ios: 'phone-portrait-outline',
  android: 'phone-portrait-outline',
  web: 'desktop-outline',
  unknown: 'help-circle-outline',
};

/**
 * Device and session management. Revoking a device kills its access token on
 * the next request, not when the token happens to expire.
 */
export default function DevicesScreen() {
  const theme = useTheme();
  const t = useTranslation();
  const router = useRouter();
  const { listDevices, revokeDevice, signOut } = useSession();

  const [devices, setDevices] = useState<Device[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [signingOutEverywhere, setSigningOutEverywhere] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setDevices(await listDevices());
    } catch {
      setDevices([]);
      setError(t('errors.network'));
    }
  }, [listDevices, t]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function onRevoke(device: Device) {
    setRevokingId(device.id);
    setError(null);
    try {
      await revokeDevice(device.id);
      if (device.current) {
        // The session we just killed is ours: go back to onboarding.
        router.replace('/(onboarding)/welcome');
        return;
      }
      await load();
    } catch {
      setError(t('errors.unknown'));
    } finally {
      setRevokingId(null);
    }
  }

  async function onSignOutEverywhere() {
    setSigningOutEverywhere(true);
    setError(null);
    try {
      await signOut(true);
      router.replace('/(onboarding)/welcome');
    } catch {
      setError(t('errors.unknown'));
      setSigningOutEverywhere(false);
    }
  }

  return (
    <Screen>
      {error ? (
        <AppText variant="caption" tone="danger">
          {error}
        </AppText>
      ) : null}

      <Card padded={false}>
        {devices === null ? (
          <EmptyState compact title={t('common.loading')} />
        ) : devices.length === 0 ? (
          <EmptyState compact title={t('devices.empty')} />
        ) : (
          devices.map((device, index) => (
            <View key={device.id}>
              {index > 0 ? <Divider inset={56} /> : null}
              <View style={[styles.row, { gap: theme.spacing.md, padding: theme.spacing.lg }]}>
                <View
                  style={[
                    styles.icon,
                    { backgroundColor: theme.colors.accentSoft, borderRadius: theme.radius.md },
                  ]}
                >
                  <Ionicons
                    name={PLATFORM_ICON[device.platform]}
                    size={20}
                    color={theme.colors.accentSoftText}
                  />
                </View>
                <View style={styles.flex}>
                  <AppText variant="bodyStrong">{device.label}</AppText>
                  <AppText variant="caption" tone="muted">
                    {new Date(device.lastSeenAt).toLocaleString()}
                  </AppText>
                </View>
                {device.current ? <Badge label={t('devices.thisDevice')} tone="accent" /> : null}
              </View>
              <View style={{ paddingHorizontal: theme.spacing.lg, paddingBottom: theme.spacing.lg }}>
                <Button
                  label={device.current ? t('devices.signOutThis') : t('devices.revoke')}
                  variant="danger"
                  size="sm"
                  onPress={() => void onRevoke(device)}
                  loading={revokingId === device.id}
                />
              </View>
            </View>
          ))
        )}
      </Card>

      {devices && devices.length > 1 ? (
        <Button
          label={t('devices.signOutEverywhere')}
          variant="secondary"
          onPress={() => void onSignOutEverywhere()}
          loading={signingOutEverywhere}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  flex: {
    flex: 1,
  },
  icon: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
