import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { api } from '../api/client';
import { COUNTRIES } from '../data/countries';
import { CURRENCIES } from '../data/currencies';
import { Globe2 } from 'lucide-react';
import LegalFooter from '../components/LegalFooter';
import PhoneInput from '../components/PhoneInput';

const INDUSTRIES = [
  'RETAIL', 'RESTAURANT', 'GROCERY', 'PHARMACY', 'SALON', 'BAKERY',
  'CAFE', 'BAR', 'SERVICES', 'WHOLESALE', 'E-COMMERCE', 'OTHER',
];

const input =
  'w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gold-400 focus:border-gold-400 outline-none transition bg-white';

// Regional-indicator flag from an ISO alpha-2 code.
function flagEmoji(code: string): string {
  const cc = (code || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (cc.length !== 2) return '🌐';
  return cc.replace(/./g, (ch) => String.fromCodePoint(127397 + ch.charCodeAt(0)));
}

export default function RegisterPage() {
  const navigate = useNavigate();
  const { login } = useAuthStore();

  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
    organizationName: '',
    industry: 'RETAIL',
    countryCode: 'US',
    currency: 'USD',
    phone: '',
    phoneDialCode: '+1',
  });
  const [countrySearch, setCountrySearch] = useState('');
  const [currencySearch, setCurrencySearch] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const selected = useMemo(
    () => COUNTRIES.find((c) => c.code === form.countryCode) || COUNTRIES[0],
    [form.countryCode]
  );

  const filteredCountries = useMemo(() => {
    const q = countrySearch.trim().toLowerCase();
    if (!q) return COUNTRIES;
    return COUNTRIES.filter((c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q));
  }, [countrySearch]);

  // Full ISO 4217 catalog, searchable — every active world currency is selectable.
  const filteredCurrencies = useMemo(() => {
    const q = currencySearch.trim().toLowerCase();
    if (!q) return CURRENCIES;
    return CURRENCIES.filter((c) =>
      c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q));
  }, [currencySearch]);

  const set = (key: keyof typeof form, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const chooseCountry = (code: string) => {
    const country = COUNTRIES.find((c) => c.code === code);
    setForm((f) => ({ ...f, countryCode: code, currency: country?.currency || f.currency, phoneDialCode: country?.dialCode || f.phoneDialCode }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (form.password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (form.password !== form.confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);
    try {
      const response = await api.register({
        name: form.name.trim(),
        email: form.email.trim(),
        password: form.password,
        organizationName: form.organizationName.trim(),
        industry: form.industry,
        country: selected.name,
        countryCode: selected.code,
        currency: form.currency,
        phone: form.phone.trim() ? `${form.phoneDialCode} ${form.phone.trim()}` : undefined,
      });
      const { user, token, employee, organization } = response.data;
      localStorage.setItem('pos_token', token);
      login(user, token, employee, organization);
      navigate('/', { replace: true });
    } catch (err: any) {
      setError(err.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-ink-950 via-ink-900 to-ink-950 px-4 py-10">
      <div className="pointer-events-none absolute -top-40 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-gold-500/10 blur-3xl" />
      <div className="relative w-full max-w-lg">
        <div className="rounded-2xl bg-white/95 p-8 shadow-luxe ring-1 ring-gold-500/20 backdrop-blur">
          <div className="mb-6 flex items-center justify-center">
            <img
              src="/logo.png"
              alt="UnifiedPOS"
              className="h-16 w-16 rounded-2xl object-cover shadow-luxe ring-1 ring-gold-500/40"
            />
          </div>

          <h1 className="mb-1 text-center font-display text-3xl text-ink-900">Create your account</h1>
          <div className="gold-rule mx-auto mb-2" />
          <p className="mb-6 flex items-center justify-center gap-1.5 text-center text-gray-500">
            <Globe2 size={15} className="text-gold-600" />
            Available in {COUNTRIES.length} countries &amp; territories
          </p>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Full name</label>
                <input className={input} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Jane Doe" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input className={input} type="email" value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="you@business.com" required />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Business name</label>
              <input className={input} value={form.organizationName} onChange={(e) => set('organizationName', e.target.value)} placeholder="Acme Stores Ltd." required />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Industry</label>
              <select className={input} value={form.industry} onChange={(e) => set('industry', e.target.value)}>
                {INDUSTRIES.map((i) => (
                  <option key={i} value={i}>{i}</option>
                ))}
              </select>
            </div>

            <PhoneInput
              id="regPhone"
              label="Phone (optional)"
              dialCode={form.phoneDialCode}
              phoneNumber={form.phone}
              onChange={(dc, num) => setForm((f) => ({ ...f, phoneDialCode: dc, phone: num }))}
            />

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Country / region</label>
              <input
                className={input + ' mb-2'}
                value={countrySearch}
                onChange={(e) => setCountrySearch(e.target.value)}
                placeholder={`Search ${COUNTRIES.length} countries...`}
              />
              <select className={input} value={form.countryCode} onChange={(e) => chooseCountry(e.target.value)}>
                {filteredCountries.map((c) => (
                  <option key={c.code} value={c.code}>
                    {flagEmoji(c.code)} {c.name} ({c.code}) — {c.currency}
                  </option>
                ))}
                {!filteredCountries.some((c) => c.code === form.countryCode) && (
                  <option value={form.countryCode}>{flagEmoji(selected.code)} {selected.name} ({selected.code})</option>
                )}
              </select>
              <p className="mt-1 text-xs text-gray-500">
                Selected: <span className="font-medium text-gray-700">{flagEmoji(selected.code)} {selected.name}</span> · Currency {selected.currency} · Dial {selected.dialCode}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Currency</label>
              <input
                className={input + ' mb-2'}
                value={currencySearch}
                onChange={(e) => setCurrencySearch(e.target.value)}
                placeholder={`Search ${CURRENCIES.length} ISO 4217 currencies...`}
              />
              <select className={input} value={form.currency} onChange={(e) => set('currency', e.target.value)}>
                {filteredCurrencies.map((c) => (
                  <option key={c.code} value={c.code}>{c.code} — {c.name}{c.symbol ? ` (${c.symbol})` : ''}</option>
                ))}
                {!filteredCurrencies.some((c) => c.code === form.currency) && form.currency && (
                  <option value={form.currency}>{form.currency}</option>
                )}
              </select>
              <p className="mt-1 text-xs text-gray-500">Auto-filled from the country above; override with any world currency if you trade in more than one.</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                <input className={input} type="password" value={form.password} onChange={(e) => set('password', e.target.value)} placeholder="Min. 8 characters" required minLength={8} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Confirm password</label>
                <input className={input} type="password" value={form.confirmPassword} onChange={(e) => set('confirmPassword', e.target.value)} placeholder="Re-enter password" required minLength={8} />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-gradient-to-r from-gold-400 to-gold-600 py-2.5 font-semibold text-ink-950 shadow-gold transition hover:from-gold-300 hover:to-gold-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? 'Creating account...' : 'Create account'}
            </button>
          </form>

          <div className="mt-6 text-center text-sm text-gray-600">
            Already have an account?{' '}
            <Link to="/login" className="font-semibold text-ink-700 hover:text-gold-600">
              Sign in
            </Link>
          </div>
        </div>
        <LegalFooter tone="dark" className="mt-6" />
      </div>
    </div>
  );
}
