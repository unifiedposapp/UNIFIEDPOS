import { create } from 'zustand';
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, type Locale } from '../i18n/locales';

const STORAGE_KEY = 'pos_locale';

/**
 * Pick the initial locale: an explicit prior choice (localStorage) wins, then the
 * browser language if we support it, else the default. Wrapped in try/catch so
 * privacy-mode storage or a missing `navigator` never crashes app boot.
 */
function detectInitialLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && SUPPORTED_LOCALES.some((l) => l.code === stored)) {
      return stored as Locale;
    }
    const browser = (navigator.language || '').slice(0, 2).toLowerCase();
    const match = SUPPORTED_LOCALES.find((l) => l.code === browser);
    if (match) return match.code;
  } catch {
    /* storage/navigator unavailable — fall through to default */
  }
  return DEFAULT_LOCALE;
}

interface LocaleState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

export const useLocaleStore = create<LocaleState>((set) => ({
  locale: detectInitialLocale(),
  setLocale: (locale) => {
    try {
      localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      /* ignore persistence failures — the in-memory switch still applies */
    }
    set({ locale });
  },
}));
