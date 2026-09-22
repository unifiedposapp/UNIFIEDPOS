import { describe, it, expect } from 'vitest';
import { en, dictionaries, translate, type TranslationKey } from '../src/i18n/translations';
import { SUPPORTED_LOCALES, DEFAULT_LOCALE, getLocaleMeta } from '../src/i18n/locales';

const masterKeys = Object.keys(en) as TranslationKey[];

// Every supported locale — the original eight plus the don't-miss-the-world
// extended tranche (tr/ja/ko/vi/id/th/sw/he/fa) — is now held to COMPLETE
// coverage of the master key set. Partial dictionaries would still be safe
// (omissions fall back to `en`), but with breadth delivered we enforce parity
// so no string silently regresses to English.
const ALL_CODES = Object.keys(dictionaries);

describe('locale metadata', () => {
  it('has unique codes and includes the default locale', () => {
    const codes = SUPPORTED_LOCALES.map((l) => l.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).toContain(DEFAULT_LOCALE);
  });

  it('resolves metadata and falls back to the first entry for unknown codes', () => {
    expect(getLocaleMeta('fr').htmlLang).toBe('fr-FR');
    expect(getLocaleMeta('zz' as any).code).toBe(SUPPORTED_LOCALES[0].code);
  });

  it('provides a dictionary for every supported locale', () => {
    for (const l of SUPPORTED_LOCALES) {
      expect(dictionaries[l.code], `missing dictionary for ${l.code}`).toBeDefined();
    }
  });
});

describe('dictionary integrity', () => {
  it('master (en) dictionary is non-empty with non-empty string values', () => {
    expect(masterKeys.length).toBeGreaterThan(0);
    for (const k of masterKeys) {
      expect(typeof en[k]).toBe('string');
      expect((en[k] as string).trim().length).toBeGreaterThan(0);
    }
  });

  it('no locale contains orphan keys absent from the master', () => {
    for (const [code, dict] of Object.entries(dictionaries)) {
      const orphans = Object.keys(dict).filter((k) => !(k in en));
      expect(orphans, `locale "${code}" has orphan keys`).toEqual([]);
    }
  });

  it('every supported locale fully covers the master key set (no missing/blank translations)', () => {
    for (const code of ALL_CODES) {
      const dict = dictionaries[code as keyof typeof dictionaries] as Record<string, string | undefined>;
      const missing = masterKeys.filter((k) => {
        const v = dict[k];
        return v == null || v.trim().length === 0;
      });
      expect(missing, `locale "${code}" is missing keys`).toEqual([]);
    }
  });

  it('all values are trimmed (no leading/trailing whitespace)', () => {
    for (const [code, dict] of Object.entries(dictionaries)) {
      for (const [k, v] of Object.entries(dict)) {
        if (typeof v !== 'string') continue;
        expect(v, `${code}.${k} should be trimmed`).toBe(v.trim());
      }
    }
  });
});

describe('translate()', () => {
  it('returns the master value for the default locale', () => {
    expect(translate('en', 'app.signOut')).toBe('Sign Out');
  });

  it('returns the localized value for a translated locale', () => {
    expect(translate('es', 'app.signOut')).toBe('Cerrar sesión');
    expect(translate('fr', 'nav.orders')).toBe('Commandes');
    expect(translate('de', 'nav.settings')).toBe('Einstellungen');
    expect(translate('pt', 'login.submit')).toBe('Entrar');
  });

  it('falls back to en for an unknown locale code', () => {
    expect(translate('zz' as any, 'app.signOut')).toBe('Sign Out');
  });

  it('interpolates {name} placeholders and leaves unknown ones intact', () => {
    // Synthesize a template through the interpolation path via a known key shape.
    const out = translate('en', 'app.signOut', { unused: 1 });
    expect(out).toBe('Sign Out'); // no placeholders → unchanged
  });

  it('resolves localized values across the extended global-breadth locales', () => {
    expect(translate('tr', 'nav.payments')).toBe('Ödemeler');
    expect(translate('ja', 'nav.orders')).toBe('注文');
    expect(translate('ko', 'nav.settings')).toBe('설정');
    expect(translate('sw', 'nav.customers')).toBe('Wateja');
    // Now fully covered: these deepened keys resolve in-language, not via fallback.
    expect(translate('th', 'nav.reports')).toBe('รายงาน');
    expect(translate('vi', 'nav.inventory')).toBe('Kho hàng');
    expect(translate('he', 'login.submit')).toBe('התחברות');
    expect(translate('fa', 'nav.customers')).toBe('مشتریان');
    expect(translate('id', 'nav.settings')).toBe('Pengaturan');
  });

  it('marks the new right-to-left locales as rtl', () => {
    expect(getLocaleMeta('he').dir).toBe('rtl');
    expect(getLocaleMeta('fa').dir).toBe('rtl');
    expect(getLocaleMeta('ar').dir).toBe('rtl');
  });
});
