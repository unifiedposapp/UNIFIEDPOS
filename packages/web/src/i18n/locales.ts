/**
 * Supported UI locales + their metadata (§ global-ready shell).
 *
 * Adding a language is two steps: (1) add its code to the `Locale` union and a
 * row to `SUPPORTED_LOCALES`, and (2) add a matching dictionary in
 * `translations.ts`. Anything a dictionary omits falls back to `DEFAULT_LOCALE`,
 * so partial translations ship safely.
 */

export type Locale = 'en' | 'es' | 'fr' | 'de' | 'pt' | 'ar' | 'zh' | 'hi';

export interface LocaleMeta {
  /** Internal code used by the store + dictionaries. */
  code: Locale;
  /** BCP-47 tag applied to <html lang> and used for Intl date/number formats. */
  htmlLang: string;
  /** Endonym shown in the switcher (always in its own language). */
  nativeLabel: string;
  /** English name, used for the a11y label / tooltip. */
  englishLabel: string;
  /** Flag emoji — a compact, dependency-free visual cue. */
  flag: string;
  /** Text direction — `rtl` drives the mirrored shell (Arabic). */
  dir: 'ltr' | 'rtl';
}

export const DEFAULT_LOCALE: Locale = 'en';

export const SUPPORTED_LOCALES: LocaleMeta[] = [
  { code: 'en', htmlLang: 'en-US', nativeLabel: 'English', englishLabel: 'English', flag: '🇺🇸', dir: 'ltr' },
  { code: 'es', htmlLang: 'es-ES', nativeLabel: 'Español', englishLabel: 'Spanish', flag: '🇪🇸', dir: 'ltr' },
  { code: 'fr', htmlLang: 'fr-FR', nativeLabel: 'Français', englishLabel: 'French', flag: '🇫🇷', dir: 'ltr' },
  { code: 'de', htmlLang: 'de-DE', nativeLabel: 'Deutsch', englishLabel: 'German', flag: '🇩🇪', dir: 'ltr' },
  { code: 'pt', htmlLang: 'pt-BR', nativeLabel: 'Português', englishLabel: 'Portuguese', flag: '🇧🇷', dir: 'ltr' },
  { code: 'ar', htmlLang: 'ar-SA', nativeLabel: 'العربية', englishLabel: 'Arabic', flag: '🇸🇦', dir: 'rtl' },
  { code: 'zh', htmlLang: 'zh-CN', nativeLabel: '简体中文', englishLabel: 'Chinese (Simplified)', flag: '🇨🇳', dir: 'ltr' },
  { code: 'hi', htmlLang: 'hi-IN', nativeLabel: 'हिन्दी', englishLabel: 'Hindi', flag: '🇮🇳', dir: 'ltr' },
];

export function getLocaleMeta(code: Locale): LocaleMeta {
  return SUPPORTED_LOCALES.find((l) => l.code === code) ?? SUPPORTED_LOCALES[0];
}
