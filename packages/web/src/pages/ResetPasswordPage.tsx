import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { KeyRound } from 'lucide-react';

const input =
  'w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none transition';

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const [step, setStep] = useState<'request' | 'reset' | 'done'>('request');
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [tokenFromLink, setTokenFromLink] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);

  // Arriving from an emailed reset link (/reset-password?token=...): prefill the
  // single-use token and jump straight to the "choose a new password" step.
  useEffect(() => {
    const linked = searchParams.get('token');
    if (linked) {
      setToken(linked);
      setTokenFromLink(true);
      setStep('reset');
      setInfo('Reset link accepted — choose a new password below.');
    }
  }, [searchParams]);

  const handleRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInfo('');
    setLoading(true);
    try {
      const res = await api.forgotPassword(email.trim());
      // In production the token is emailed, never returned. Only local dev with no
      // mail provider returns it inline, so the flow can be completed here.
      const issued = res.data?.resetToken;
      if (issued) {
        setToken(issued);
        setTokenFromLink(false);
        setInfo('Dev mode: reset token returned inline (valid 15 min). In production this is emailed instead.');
        setStep('reset');
      } else {
        setInfo(res.message || 'If that account exists, a password reset link has been sent. Check your inbox.');
      }
    } catch (err: any) {
      setError(err.message || 'Could not start password reset');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    setLoading(true);
    try {
      await api.resetPassword(token.trim(), password);
      setStep('done');
    } catch (err: any) {
      setError(err.message || 'Could not reset password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-900 to-primary-700 px-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-xl p-8">
          <div className="flex items-center justify-center mb-6">
            <div className="w-14 h-14 bg-primary-600 rounded-xl flex items-center justify-center overflow-hidden">
              {step === 'done' ? (
                <img src="/logo.png" alt="UnifiedPOS" className="h-full w-full object-cover" />
              ) : (
                <KeyRound size={28} className="text-white" />
              )}
            </div>
          </div>

          {step === 'done' ? (
            <>
              <h1 className="text-2xl font-bold text-center text-gray-900 mb-2">Password updated</h1>
              <p className="text-center text-gray-500 mb-6">You can now sign in with your new password.</p>
              <Link
                to="/login"
                className="block w-full py-2.5 text-center bg-primary-600 text-white font-medium rounded-lg hover:bg-primary-700 transition"
              >
                Back to sign in
              </Link>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-bold text-center text-gray-900 mb-2">Reset password</h1>
              <p className="text-center text-gray-500 mb-6">
                {step === 'request'
                  ? 'Enter your account email and we’ll send you a reset link.'
                  : tokenFromLink
                    ? 'Choose a new password to finish resetting your account.'
                    : 'Enter the token from your email and choose a new password.'}
              </p>

              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{error}</div>
              )}
              {info && (
                <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700">{info}</div>
              )}

              {step === 'request' ? (
                <form onSubmit={handleRequest} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                    <input className={input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@yourbusiness.com" required />
                  </div>
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full py-2.5 bg-primary-600 text-white font-medium rounded-lg hover:bg-primary-700 disabled:opacity-50 transition"
                  >
                    {loading ? 'Sending...' : 'Send reset link'}
                  </button>
                </form>
              ) : (
                <form onSubmit={handleReset} className="space-y-4">
                  {!tokenFromLink && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Reset token</label>
                      <input className={input} value={token} onChange={(e) => setToken(e.target.value)} placeholder="Paste the token from your email" required />
                    </div>
                  )}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">New password</label>
                    <input className={input} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Min. 8 characters" required minLength={8} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Confirm new password</label>
                    <input className={input} type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Re-enter new password" required minLength={8} />
                  </div>
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full py-2.5 bg-primary-600 text-white font-medium rounded-lg hover:bg-primary-700 disabled:opacity-50 transition"
                  >
                    {loading ? 'Updating...' : 'Update password'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setStep('request'); setToken(''); setError(''); }}
                    className="w-full py-2 text-sm text-gray-500 hover:text-gray-700 transition"
                  >
                    Use a different email
                  </button>
                </form>
              )}

              <div className="mt-6 text-center text-sm text-gray-600">
                Remembered it?{' '}
                <Link to="/login" className="font-semibold text-primary-600 hover:text-primary-700">
                  Back to sign in
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
