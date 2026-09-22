import { useState, useRef, useEffect } from 'react';
import { Globe, Check, ChevronDown } from 'lucide-react';
import clsx from 'clsx';
import { useI18n } from '../i18n/I18nProvider';
import { SUPPORTED_LOCALES, getLocaleMeta } from '../i18n/locales';

/**
 * Compact language picker for the top bar. Shows the active locale's flag, opens
 * an accessible listbox of supported languages, and persists the choice via the
 * i18n store. Closes on outside click or Escape.
 */
export default function LanguageSwitcher() {
  const { locale, setLocale, t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = getLocaleMeta(locale);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={t('lang.switcher')}
        aria-label={t('lang.switcher')}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-ink-500 transition-colors hover:bg-gold-50 hover:text-gold-600"
      >
        <Globe size={18} />
        <span className="hidden text-base leading-none sm:inline">{current.flag}</span>
        <ChevronDown size={14} className={clsx('transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label={t('lang.switcher')}
          className="absolute end-0 z-40 mt-2 w-44 overflow-hidden rounded-xl border border-ink-100 bg-white py-1 shadow-luxe"
        >
          {SUPPORTED_LOCALES.map((l) => {
            const active = l.code === locale;
            return (
              <button
                key={l.code}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  setLocale(l.code);
                  setOpen(false);
                }}
                className={clsx(
                  'flex w-full items-center gap-2 px-3 py-2 text-start text-sm transition-colors hover:bg-gold-50',
                  active ? 'font-medium text-gold-700' : 'text-ink-600',
                )}
              >
                <span className="text-base leading-none">{l.flag}</span>
                <span className="flex-1 truncate">{l.nativeLabel}</span>
                {active && <Check size={14} className="text-gold-600" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
