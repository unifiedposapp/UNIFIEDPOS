import { useEffect, useState } from 'react';
import { COUNTRIES } from '../data/countries';

interface Props {
  dialCode: string;
  phoneNumber: string;
  onChange: (dialCode: string, phoneNumber: string) => void;
  id?: string;
  label?: string;
  hint?: string;
  className?: string;
}

// Turn an ISO alpha-2 code into its flag via regional-indicator symbols.
function flagEmoji(code: string): string {
  const cc = (code || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (cc.length !== 2) return '🌐';
  return cc.replace(/./g, (ch) => String.fromCodePoint(127397 + ch.charCodeAt(0)));
}

const SORTED = [...COUNTRIES].sort((a, b) => a.name.localeCompare(b.name));

/**
 * International phone field: a country dial-code selector (all 249 nations,
 * flag + name + calling code) paired with the national number input.
 * The dial code can be driven externally (e.g. synced from the business
 * address country) while still letting the user override it independently.
 */
export default function PhoneInput({ dialCode, phoneNumber, onChange, id, label, hint, className = '' }: Props) {
  const [cc, setCc] = useState(() => COUNTRIES.find((c) => c.dialCode === dialCode)?.code || 'US');

  // Resync the visible country only when the external dial code diverges from
  // the current selection (keeps manual picks like Canada vs. United States).
  useEffect(() => {
    const current = COUNTRIES.find((c) => c.code === cc);
    if (current && current.dialCode !== dialCode) {
      const next = COUNTRIES.find((c) => c.dialCode === dialCode);
      if (next) setCc(next.code);
    }
  }, [dialCode, cc]);

  const selected = COUNTRIES.find((c) => c.code === cc);

  const handleCountry = (code: string) => {
    setCc(code);
    const c = COUNTRIES.find((x) => x.code === code);
    if (c) onChange(c.dialCode, phoneNumber);
  };

  return (
    <div className={className}>
      {label && (
        <label htmlFor={id} className="mb-1 block text-sm font-medium text-gray-700">
          {label}
        </label>
      )}
      <div className="flex">
        <select
          aria-label="Phone country / dial code"
          value={cc}
          onChange={(e) => handleCountry(e.target.value)}
          className="w-44 shrink-0 rounded-l-lg border border-r-0 border-gray-300 bg-gray-50 px-2 py-2 text-sm text-gray-700 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
        >
          {SORTED.map((c) => (
            <option key={c.code} value={c.code}>
              {flagEmoji(c.code)} {c.name} · {c.dialCode}
            </option>
          ))}
        </select>
        <input
          id={id}
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          value={phoneNumber}
          placeholder={selected ? `${selected.dialCode} 000 000 0000` : 'Phone number'}
          onChange={(e) => onChange(dialCode, e.target.value)}
          className="w-full rounded-r-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
        />
      </div>
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
    </div>
  );
}
