import type { Accent, Appearance } from '@orbit-hub/contracts';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Platform, useColorScheme } from 'react-native';

import { keyValueStore } from '@/lib/storage/key-value';

import { ACCENT_NAMES, createTheme } from './tokens';
import type { ColorSchemeName, Theme } from './tokens';

const STORAGE_KEY = 'orbithub:appearance';

interface AppearancePreference {
  appearance: Appearance;
  accent: Accent;
}

const DEFAULT_PREFERENCE: AppearancePreference = {
  appearance: 'system',
  accent: 'orbit',
};

interface ThemeContextValue {
  theme: Theme;
  appearance: Appearance;
  accent: Accent;
  /** True when the resolved scheme comes from the OS rather than an explicit choice. */
  followsSystem: boolean;
  setAppearance: (appearance: Appearance) => void;
  setAccent: (accent: Accent) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function isAccent(value: string): value is Accent {
  return (ACCENT_NAMES as string[]).includes(value);
}

function isAppearance(value: string): value is Appearance {
  return value === 'system' || value === 'light' || value === 'dark';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const [appearance, setAppearanceState] = useState<Appearance>(DEFAULT_PREFERENCE.appearance);
  const [accent, setAccentState] = useState<Accent>(DEFAULT_PREFERENCE.accent);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        const parsed = keyValueStore.getJson<Partial<AppearancePreference>>(STORAGE_KEY);
        if (parsed && active) {
          if (isAppearance(String(parsed.appearance))) {
            setAppearanceState(parsed.appearance as Appearance);
          }
          if (isAccent(String(parsed.accent))) {
            setAccentState(parsed.accent as Accent);
          }
        }
      } catch {
        // A corrupted preference must never block the app: fall back to defaults.
      } finally {
        if (active) {
          setHydrated(true);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  const persist = useCallback((next: AppearancePreference) => {
    keyValueStore.setJson(STORAGE_KEY, next);
  }, []);

  const setAppearance = useCallback(
    (next: Appearance) => {
      setAppearanceState(next);
      persist({ appearance: next, accent });
    },
    [accent, persist],
  );

  const setAccent = useCallback(
    (next: Accent) => {
      setAccentState(next);
      persist({ appearance, accent: next });
    },
    [appearance, persist],
  );

  const scheme: ColorSchemeName =
    appearance === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : appearance;

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme: createTheme(scheme, hydrated ? accent : DEFAULT_PREFERENCE.accent),
      appearance,
      accent: hydrated ? accent : DEFAULT_PREFERENCE.accent,
      followsSystem: appearance === 'system',
      setAppearance,
      setAccent,
    }),
    [accent, appearance, hydrated, setAccent, setAppearance, scheme],
  );

  /*
   * The document follows the app, on the web.
   *
   * `+html.tsx` paints `body` from a media query, so the document is the colour
   * of the *system* and the app is the colour the person chose, and the two
   * disagree the moment anybody forces one against the other: force dark on a
   * light system and the page is dark on a white sheet. Nothing visible inside
   * the app changes, because `Screen` paints the whole viewport — the light shows
   * in the places the app does not reach, and, worse, in the moment before it
   * mounts. `#root` is transparent, `Screen` has not painted yet, and on a slow
   * connection somebody who chose dark gets a white flash first.
   *
   * So the document is corrected here, once the preference is known: the CSS
   * stays as it is for the first paint — it is the only thing that can be right
   * before JavaScript runs — and this takes it from there. `colorScheme` as well,
   * because a scrollbar and a form control are painted by the browser from that
   * and would otherwise stay on the system's choice.
   */
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const body = document.body;
    const root = document.documentElement;
    body.style.backgroundColor = value.theme.colors.background;
    root.style.colorScheme = scheme === 'dark' ? 'dark' : 'light';
  }, [scheme, value.theme.colors.background]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used inside <ThemeProvider>');
  }
  return context.theme;
}

export function useThemePreferences(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useThemePreferences must be used inside <ThemeProvider>');
  }
  return context;
}
