import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { api } from '../api/client';
import LegalFooter from '../components/LegalFooter';

/**
 * Dedicated sign-in surface for the UnifiedPOS platform-operator (SUPER_ADMIN)
 * console. Same credentials flow as the regular Sign In, but this page only
 * accepts a SUPER_ADMIN account: any other role is refused with an inline
 * message and no session is persisted. Linked from the app footer so tenant
 * staff can find the operator entrance, without ever seeing it inside their
 * own tenant UI.
 */
export default function PlatformLoginPage() {
  const navigate = useNavigate();
  const { user, isAuthenticated, login, logout } = useAuthStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Already signed in? If they're a Super Admin, skip straight to the console.
  // If they're a tenant user, sign them out first so the operator entrance is
  // never reachable while holding a non-platform session.
  useEffect(() => {
    if (!isAuthenticated || !user) return;
    if (user.role === 'SUPER_ADMIN') navigate('/admin', { replace: true });
    else logout();
  }, [isAuthenticated, user, navigate, logout]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const response = await api.login(email, password);
      const data = response.data as { user: { role: string } & Record<string, unknown>; token: string; employee?: unknown };
      // MFA-protected platform account is not currently in scope; if the server
      // ever starts returning a challenge for SUPER_ADMIN we bail out clearly
      // rather than silently mis-log the operator in.
      if ((data as { mfaRequired?: boolean }).mfaRequired) {
        setError('Multi-factor is enabled on this account. Sign in from the standard page to complete verification.');
        return;
      }
      if (data.user.role !== 'SUPER_ADMIN') {
        setError('This account is not a platform operator. Please use the standard Sign In instead.');
        return;
      }
      // Wipe any stale tenant artefacts (employee, organization) from a prior
      // merchant session before we persist the platform one, so the auth store
      // hydrates cleanly with just { user, token } and a Super Admin never
      // inherits an organizationId from a previous tenant login.
      localStorage.removeItem('pos_employee');
      localStorage.removeItem('pos_organization');
      login(data.user as never, data.token, data.employee as never);
      navigate('/admin', { replace: true });
    } catch (err) {
      setError((err as { message?: string }).message || 'Invalid credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 px-4">
      <div className="pointer-events-none absolute -top-40 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-indigo-500/20 blur-3xl" />
      <div className="relative w-full max-w-md">
        <div className="rounded-2xl bg-white/95 p-8 shadow-2xl ring-1 ring-indigo-500/20 backdrop-blur">
          <div className="mb-6 flex items-center justify-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-lg">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-8 w-8"
                aria-hidden="true"
              >
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
            </div>
          </div>

          <h1 className="mb-1 text-center font-display text-3xl text-slate-900">Platform Console</h1>
          <div className="mx-auto mb-2 h-px w-16 bg-gradient-to-r from-transparent via-indigo-500 to-transparent" />
          <p className="mb-8 text-center text-sm text-slate-500">
            UnifiedPOS operator sign-in. Tenant staff should use the
            {' '}
            <Link to="/login" className="font-medium text-indigo-700 hover:text-indigo-900 underline">
              standard Sign In
            </Link>
            .
          </p>

          {error && (
            <div
              role="alert"
              className="mb-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700"
            >
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div className="mb-4">
              <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="platform-email">
                Operator email
              </label>
              <input
                id="platform-email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-4 py-2.5 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-400"
                placeholder="platform@unifiedpos.com"
                required
              />
            </div>

            <div className="mb-6">
              <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="platform-password">
                Password
              </label>
              <input
                id="platform-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-4 py-2.5 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-400"
                placeholder="••••••••"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-gradient-to-r from-indigo-500 to-violet-600 py-2.5 font-semibold text-white shadow-lg transition hover:from-indigo-400 hover:to-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? 'Verifying...' : 'Enter Admin Portal'}
            </button>
          </form>

          <div className="mt-6 text-center text-xs text-slate-500">
            Access is logged. Only SUPER_ADMIN accounts pass through this door.
          </div>
        </div>
        <LegalFooter tone="dark" className="mt-6" />
      </div>
    </div>
  );
}
