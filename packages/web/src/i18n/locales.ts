/**
 * Supported UI locales + their metadata (§ global-ready shell).
 *
 * Adding a language is two steps: (1) add its code to the `Locale` union and a
 * row to `SUPPORTED_LOCALES`, and (2) add a matching dictionary in
 * `translations.ts`. Anything a dictionary omits falls back to `DEFAULT_LOCALE`,
 * so partial translations ship safely.
 */

export type Locale =
  | 'en' | 'es' | 'fr' | 'de' | 'pt' | 'ar' | 'zh' | 'hi'
  | 'tr' | 'ja' | 'ko' | 'vi' | 'id' | 'th' | 'sw' | 'he' | 'fa';

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
  { code: 'tr', htmlLang: 'tr-TR', nativeLabel: 'Türkçe', englishLabel: 'Turkish', flag: '🇹🇷', dir: 'ltr' },
  { code: 'ja', htmlLang: 'ja-JP', nativeLabel: '日本語', englishLabel: 'Japanese', flag: '🇯🇵', dir: 'ltr' },
  { code: 'ko', htmlLang: 'ko-KR', nativeLabel: '한국어', englishLabel: 'Korean', flag: '🇰🇷', dir: 'ltr' },
  { code: 'vi', htmlLang: 'vi-VN', nativeLabel: 'Tiếng Việt', englishLabel: 'Vietnamese', flag: '🇻🇳', dir: 'ltr' },
  { code: 'id', htmlLang: 'id-ID', nativeLabel: 'Bahasa Indonesia', englishLabel: 'Indonesian', flag: '🇮🇩', dir: 'ltr' },
  { code: 'th', htmlLang: 'th-TH', nativeLabel: 'ไทย', englishLabel: 'Thai', flag: '🇹🇭', dir: 'ltr' },
  { code: 'sw', htmlLang: 'sw-KE', nativeLabel: 'Kiswahili', englishLabel: 'Swahili', flag: '🇰🇪', dir: 'ltr' },
  { code: 'he', htmlLang: 'he-IL', nativeLabel: 'עברית', englishLabel: 'Hebrew', flag: '🇮🇱', dir: 'rtl' },
  { code: 'fa', htmlLang: 'fa-IR', nativeLabel: 'فارسی', englishLabel: 'Persian', flag: '🇮🇷', dir: 'rtl' },
];

export function getLocaleMeta(code: Locale): LocaleMeta {
  return SUPPORTED_LOCALES.find((l) => l.code === code) ?? SUPPORTED_LOCALES[0];
}
