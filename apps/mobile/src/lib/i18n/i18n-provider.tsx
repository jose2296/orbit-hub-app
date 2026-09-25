import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocales } from 'expo-localization';
import type { Locale } from '@orbit-hub/contracts';
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from '@orbit-hub/config';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { dictionaries, formatTranslation } from './dictionaries';
import type { TranslationKey } from './dictionaries';

const STORAGE_KEY = 'orbithub:locale';

export type TranslateValues = Record<string, string | number>;
export type Translate = (key: TranslationKey, values?: TranslateValues) => string;

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Translate;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function deviceLocale(): Locale {
  const [first] = getLocales();
  const tag = first?.languageTag?.toLowerCase() ?? '';
  const match = SUPPORTED_LOCALES.find((locale) => tag.startsWith(locale));
  return match ?? DEFAULT_LOCALE;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  useEffect(() => {
    let active = true;

    void (async () => {
      const fallback = deviceLocale();
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (!active) return;
        if (stored === 'es' || stored === 'en') {
          setLocaleState(stored);
          return;
        }
        setLocaleState(fallback);
      } catch {
        if (active) setLocaleState(fallback);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    void AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {
      // Best effort: the in-memory locale is still correct for this session.
    });
  }, []);

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale,
      // A key built from data (a role, a status) can miss the dictionary. That
      // is a missing label, not a reason to blank the screen, so the raw key is
      // shown and the mismatch stays obvious.
      t: (key, values) => {
        const template = dictionaries[locale][key];
        return template === undefined
          ? key
          : formatTranslation(template, values);
      },
    }),
    [locale, setLocale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used inside <I18nProvider>');
  }
  return context;
}

/** Convenience hook for components that only need the translate function. */
export function useTranslation(): Translate {
  return useI18n().t;
}
