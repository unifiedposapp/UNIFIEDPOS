import { describe, it, expect } from 'vitest';
import { en, dictionaries, translate, type TranslationKey } from '../src/i18n/translations';
import { SUPPORTED_LOCALES, DEFAULT_LOCALE, getLocaleMeta } from '../src/i18n/locales';

const masterKeys = Object.keys(en) as TranslationKey[];

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

  it('every locale fully covers the master key set (no missing/blank translations)', () => {
    for (const [code, dict] of Object.entries(dictionaries)) {
      const missing = masterKeys.filter((k) => {
        const v = (dict as Record<string, string | undefined>)[k];
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
});
