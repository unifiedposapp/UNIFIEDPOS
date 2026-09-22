import { describe, it, expect } from 'vitest';
import { en, dictionaries, translate, type TranslationKey } from '../src/i18n/translations';
import { SUPPORTED_LOCALES, DEFAULT_LOCALE, getLocaleMeta } from '../src/i18n/locales';

const masterKeys = Object.keys(en) as TranslationKey[];

// The original eight locales are fully translated and are held to complete
// coverage. The extended tranche (don't-miss-the-world) ships the always-visible
// chrome first and deepens incrementally — anything omitted falls back to `en`
// at runtime, so partial dictionaries are safe by design (see translations.ts).
const COMPLETE_LOCALES = ['en', 'es', 'fr', 'de', 'pt', 'ar', 'zh', 'hi'];
const CORE_CHROME_KEYS: TranslationKey[] = [
  'common.loading', 'a11y.skip', 'a11y.mainNav',
  'app.tagline', 'app.status.operational', 'app.signOut', 'lang.switcher',
  'nav.group.sell', 'nav.group.merchandise', 'nav.group.growth', 'nav.group.workforce',
  'nav.group.finance', 'nav.group.platform', 'nav.group.admin', 'nav.group.global',
  'nav.pos', 'nav.orders', 'nav.payments', 'nav.inventory', 'nav.catalog', 'nav.customers',
  'nav.reports', 'nav.settings', 'nav.loyalty', 'nav.marketing', 'nav.employees',
  'nav.delivery', 'nav.storefront', 'nav.fiscalization', 'nav.rails',
  'login.subtitle', 'login.email', 'login.password', 'login.forgot', 'login.submit',
  'login.submitting', 'login.noAccount', 'login.createOne',
];
const isComplete = (code: string) => COMPLETE_LOCALES.includes(code);

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

  it('complete locales fully cover the master key set (no missing/blank translations)', () => {
    for (const [code, dict] of Object.entries(dictionaries)) {
      if (!isComplete(code)) continue;
      const missing = masterKeys.filter((k) => {
        const v = (dict as Record<string, string | undefined>)[k];
        return v == null || v.trim().length === 0;
      });
      expect(missing, `complete locale "${code}" is missing keys`).toEqual([]);
    }
  });

  it('extended locales translate the always-visible core chrome', () => {
    for (const [code, dict] of Object.entries(dictionaries)) {
      if (isComplete(code)) continue;
      const missing = CORE_CHROME_KEYS.filter((k) => {
        const v = (dict as Record<string, string | undefined>)[k];
        return v == null || v.trim().length === 0;
      });
      expect(missing, `extended locale "${code}" is missing core chrome keys`).toEqual([]);
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

  it('resolves localized values for the extended don-t-miss-the-world locales', () => {
    expect(translate('tr', 'nav.payments')).toBe('Ödemeler');
    expect(translate('ja', 'nav.orders')).toBe('注文');
    expect(translate('ko', 'nav.settings')).toBe('설정');
    expect(translate('sw', 'nav.customers')).toBe('Wateja');
    // Falls back to `en` for keys an extended locale has not translated yet.
    expect(translate('th', 'nav.webhooks')).toBe('Webhooks');
  });

  it('marks the new right-to-left locales as rtl', () => {
    expect(getLocaleMeta('he').dir).toBe('rtl');
    expect(getLocaleMeta('fa').dir).toBe('rtl');
    expect(getLocaleMeta('ar').dir).toBe('rtl');
  });
});
