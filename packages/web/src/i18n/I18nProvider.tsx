import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useLocaleStore } from '../stores/localeStore';
import { translate, type TranslationKey } from './translations';
import { getLocaleMeta, type Locale } from './locales';

export interface I18nContextValue {
  /** Active locale code. */
  locale: Locale;
  /** Switch the active locale (persisted by the store). */
  setLocale: (locale: Locale) => void;
  /** Translate a key, with optional `{name}` interpolation. Falls back to `en`, then the key. */
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
  /** BCP-47 tag for Intl date/number formatting (e.g. `en-US`). */
  localeTag: string;
  /** Text direction of the active locale. */
  dir: 'ltr' | 'rtl';
}

const I18nContext = createContext<I18nContextValue | null>(null);

/**
 * Root i18n provider. Reads the persisted locale from the Zustand store, keeps
 * `<html lang>`/`<html dir>` in sync for a11y + native formatters, and exposes a
 * memoized `t()`. Dependency-free by design: a plain context + dictionary lookup
 * keeps the bundle lean (no i18n runtime library) while covering the shell.
 */
export function I18nProvider({ children }: { children: ReactNode }) {
  const { locale, setLocale } = useLocaleStore();
  const meta = getLocaleMeta(locale);

  useEffect(() => {
    document.documentElement.lang = meta.htmlLang;
    document.documentElement.dir = meta.dir;
  }, [meta]);

  const value = useMemo<I18nContextValue>(() => {
    const t = (key: TranslationKey, vars?: Record<string, string | number>): string =>
      translate(locale, key, vars);
    return { locale, setLocale, t, localeTag: meta.htmlLang, dir: meta.dir };
  }, [locale, setLocale, meta]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** Access the active locale + `t()`. Throws if used outside <I18nProvider>. */
export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within an I18nProvider');
  return ctx;
}
