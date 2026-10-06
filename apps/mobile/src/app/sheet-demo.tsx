import { Ionicons } from '@expo/vector-icons';
import { useRef, useState } from 'react';
import { Pressable, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { MorphTray, TrayView } from '@/components/ui/morph-tray';
import type { TrayOrigin, TrayPreset } from '@/components/ui/morph-tray';
import { Screen } from '@/components/ui/screen';
import { AppText } from '@/components/ui/text';
import { useTranslation } from '@/lib/i18n';
import { useTheme } from '@/theme';

type TrayPage = 'menu' | 'share' | 'confirm';

const HEIGHTS: Record<TrayPage, number> = { menu: 300, share: 380, confirm: 230 };
const PRESET_LIST: TrayPreset[] = ['smooth', 'snappy', 'bouncy'];

/**
 * Demo of a morphing tray: it grows out of the button, switches between views
 * by springing its size, and closes by dragging down. Same code on every target.
 */
export default function SheetDemoScreen() {
  const theme = useTheme();
  const t = useTranslation();
  const root = useRef<View>(null);
  const trigger = useRef<View>(null);

  const [open, setOpen] = useState(false);
  const [origin, setOrigin] = useState<TrayOrigin | null>(null);
  const [page, setPage] = useState<TrayPage>('menu');
  const [preset, setPreset] = useState<TrayPreset>('smooth');

  function show() {
    const finish = (o: TrayOrigin | null) => {
      setOrigin(o);
      setPage('menu');
      setOpen(true);
    };
    if (!trigger.current || !root.current) return finish(null);
    trigger.current.measureLayout(
      root.current as never,
      (x, y, width, height) => finish({ x, y, width, height }),
      () => finish(null),
    );
  }

  function row(icon: keyof typeof Ionicons.glyphMap, label: string, onPress: () => void) {
    return (
      <Pressable
        key={label}
        onPress={onPress}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 14,
          paddingVertical: 12,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <View
          style={{
            width: 38,
            height: 38,
            borderRadius: 12,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.colors.accentSoft,
          }}
        >
          <Ionicons name={icon} size={20} color={theme.colors.accentSoftText} />
        </View>
        <AppText variant="bodyStrong" style={{ flex: 1 }}>
          {label}
        </AppText>
        <Ionicons name="chevron-forward" size={18} color={theme.colors.textSubtle} />
      </Pressable>
    );
  }

  return (
    <View ref={root} style={{ flex: 1 }} collapsable={false}>
      <Screen>
        <View style={{ gap: 20 }}>
          <AppText variant="title">Morphing tray</AppText>
          <AppText tone="muted">
            The tray grows out of the button, resizes when you change view and closes when you drag
            it down. Pick a spring and open it.
          </AppText>

          <View style={{ flexDirection: 'row', gap: 8 }}>
            {PRESET_LIST.map((p) => (
              <Pressable
                key={p}
                onPress={() => setPreset(p)}
                style={{
                  paddingHorizontal: 16,
                  paddingVertical: 8,
                  borderRadius: theme.radius.pill,
                  backgroundColor: preset === p ? theme.colors.accent : theme.colors.surfaceMuted,
                }}
              >
                <AppText
                  variant="label"
                  tone={preset === p ? 'inverse' : 'muted'}
                  style={{ textTransform: 'capitalize' }}
                >
                  {p}
                </AppText>
              </Pressable>
            ))}
          </View>

          <View ref={trigger} collapsable={false} style={{ alignSelf: 'flex-start' }}>
            <Button label={t('sheetDemo.open')} onPress={show} />
          </View>
        </View>
      </Screen>

      <MorphTray
        visible={open}
        origin={origin}
        height={HEIGHTS[page]}
        preset={preset}
        onClose={() => setOpen(false)}
      >
        <TrayView key={page}>
          {page === 'menu' && (
            <View>
              <AppText variant="heading" style={{ marginBottom: 6 }}>
                Quick actions
              </AppText>
              {row('share-outline', 'Share', () => setPage('share'))}
              {row('copy-outline', 'Duplicate', () => setOpen(false))}
              {row('trash-outline', 'Delete', () => setPage('confirm'))}
            </View>
          )}
          {page === 'share' && (
            <View style={{ gap: 12 }}>
              <Pressable onPress={() => setPage('menu')} hitSlop={10}>
                <AppText tone="accent" variant="bodyStrong">
                  ‹ Back
                </AppText>
              </Pressable>
              <AppText variant="heading">Share with</AppText>
              {['Ana', 'Luis', 'Marta', 'Team'].map((name) =>
                row('person-circle-outline', name, () => setOpen(false)),
              )}
            </View>
          )}
          {page === 'confirm' && (
            <View style={{ gap: 14 }}>
              <AppText variant="heading">Delete this item?</AppText>
              <AppText tone="muted">This cannot be undone.</AppText>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Button label={t('common.cancel')} variant="secondary" onPress={() => setPage('menu')} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button label={t('common.delete')} variant="danger" onPress={() => setOpen(false)} />
                </View>
              </View>
            </View>
          )}
        </TrayView>
      </MorphTray>
    </View>
  );
}
