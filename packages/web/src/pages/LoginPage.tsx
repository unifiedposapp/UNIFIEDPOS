import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { api } from '../api/client';
import LegalFooter from '../components/LegalFooter';
import { useI18n } from '../i18n/I18nProvider';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [mfaToken, setMfaToken] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const { login } = useAuthStore();
  const { t } = useI18n();

  // Persist the token BEFORE fetching /me, otherwise getMe() is sent
  // unauthenticated and returns 401, which previously broke sign-in.
  const finishLogin = async (data: { user: any; token: string; employee?: any }) => {
    localStorage.setItem('pos_token', data.token);
    let fullOrg = null;
    try {
      const meResponse = await api.getMe();
      fullOrg = meResponse.data.organization;
    } catch {
      fullOrg = null;
    }
    login(data.user, data.token, data.employee, fullOrg);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await api.login(email, password);
      // §37 MFA — server returns a short-lived challenge instead of a session.
      if (response.data?.mfaRequired) {
        setMfaToken(response.data.mfaToken);
        setLoading(false);
        return;
      }
      await finishLogin(response.data);
    } catch (err: any) {
      setError(err.message || t('login.errorDefault'));
    } finally {
      setLoading(false);
    }
  };

  const handleMfaSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const response = await api.mfaVerify(mfaToken, mfaCode);
      await finishLogin(response.data);
    } catch (err: any) {
      setError(err.message || t('login.mfaErrorDefault'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-ink-950 via-ink-900 to-ink-950 px-4">
      <div className="pointer-events-none absolute -top-40 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-gold-500/10 blur-3xl" />
      <div className="relative w-full max-w-md">
        <div className="rounded-2xl bg-white/95 p-8 shadow-luxe ring-1 ring-gold-500/20 backdrop-blur">
          <div className="mb-6 flex items-center justify-center">
            <img
              src="/logo.png"
              alt="UnifiedPOS"
              className="h-16 w-16 rounded-2xl object-cover shadow-luxe ring-1 ring-gold-500/40"
            />
          </div>

          <h1 className="mb-1 text-center font-display text-3xl text-ink-900">{t('login.brandName')}</h1>
          <div className="gold-rule mx-auto mb-2" />
          <p className="mb-8 text-center text-gray-500">{t('login.subtitle')}</p>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
              {error}
            </div>
          )}

          <form onSubmit={mfaToken ? handleMfaSubmit : handleSubmit}>
            {mfaToken ? (
              <>
                <p className="mb-4 text-center text-sm text-gray-600">
                  {t('login.mfaPrompt')}
                </p>
                <div className="mb-6">
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('login.mfaCode')}</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={mfaCode}
                    onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ''))}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-center text-2xl tracking-[0.5em] focus:ring-2 focus:ring-gold-400 focus:border-gold-400 outline-none transition"
                    placeholder="000000"
                    required
                  />
                </div>
              </>
            ) : (
              <>
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('login.email')}</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gold-400 focus:border-gold-400 outline-none transition"
                    placeholder={t('login.emailPlaceholder')}
                    required
                  />
                </div>

                <div className="mb-6">
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-sm font-medium text-gray-700">{t('login.password')}</label>
                    <Link to="/reset-password" className="text-xs font-medium text-ink-700 hover:text-gold-600">
                      {t('login.forgot')}
                    </Link>
                  </div>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gold-400 focus:border-gold-400 outline-none transition"
                    placeholder={t('login.passwordPlaceholder')}
                    required
                  />
                </div>
              </>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-gradient-to-r from-gold-400 to-gold-600 py-2.5 font-semibold text-ink-950 shadow-gold transition hover:from-gold-300 hover:to-gold-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? (mfaToken ? t('login.mfaVerifying') : t('login.submitting')) : mfaToken ? t('login.mfaVerify') : t('login.submit')}
            </button>

            {mfaToken && (
              <button
                type="button"
                onClick={() => { setMfaToken(''); setMfaCode(''); setError(''); }}
                className="mt-3 w-full text-sm text-gray-500 hover:text-ink-700"
              >
                {t('login.mfaDifferentAccount')}
              </button>
            )}
          </form>

          <div className="mt-6 text-center text-sm text-gray-600">
            {t('login.noAccount')}{' '}
            <Link to="/register" className="font-semibold text-ink-700 hover:text-gold-600">
              {t('login.createOne')}
            </Link>
          </div>
        </div>
        <LegalFooter tone="dark" className="mt-6" />
      </div>
    </div>
  );
}
