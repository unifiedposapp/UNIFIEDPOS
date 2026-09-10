import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api/client';
import { CreditCard, Lock, CheckCircle2, AlertCircle } from 'lucide-react';

// Public, unauthenticated checkout for a §9 payment link. Reached by scanning or
// clicking a shareable /pay/:token URL. Never exposes more than the amount and
// description. When the PSP is in simulator mode (no Stripe keys) the charge is
// processed deterministically so the flow is fully testable end to end.

type State = 'loading' | 'ready' | 'paying' | 'paid' | 'error' | 'inactive';

export default function PayLinkPage() {
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<State>('loading');
  const [link, setLink] = useState<any>(null);
  const [method, setMethod] = useState('CARD');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const res = await api.getPublicPaymentLink(token);
        if (!res?.data) { setState('inactive'); return; }
        setLink(res.data);
        setState('ready');
      } catch (e: any) {
        setMessage(e.message || 'This payment link is not available.');
        setState('inactive');
      }
    })();
  }, [token]);

  const pay = async () => {
    if (!token) return;
    setState('paying');
    setMessage('');
    try {
      const res = await api.payPublicPaymentLink(token, { method });
      setMessage(res?.data?.status === 'PAID' ? 'Payment complete. Thank you!' : 'Payment received.');
      setState('paid');
    } catch (e: any) {
      setMessage(e.message || 'Payment failed. Please try again.');
      setState('error');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-ink-950 via-ink-900 to-ink-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden">
        <div className="bg-gradient-to-r from-gold-400 to-gold-200 px-6 py-4 flex items-center gap-2">
          <CreditCard className="text-ink-900" size={22} />
          <span className="font-display text-lg text-ink-900">Secure Payment</span>
        </div>

        <div className="p-6 space-y-4">
          {state === 'loading' && <div className="text-center text-gray-500 py-8">Loading…</div>}

          {state === 'inactive' && (
            <div className="text-center py-8 space-y-2">
              <AlertCircle className="mx-auto text-rose-500" size={40} />
              <div className="font-semibold text-gray-800">Link unavailable</div>
              <div className="text-sm text-gray-500">{message || 'This payment link is no longer active.'}</div>
            </div>
          )}

          {state === 'paid' && (
            <div className="text-center py-8 space-y-2">
              <CheckCircle2 className="mx-auto text-emerald-500" size={48} />
              <div className="font-semibold text-gray-800">{message}</div>
              <div className="text-sm text-gray-500">A receipt has been recorded. You can close this page.</div>
            </div>
          )}

          {(state === 'ready' || state === 'paying' || state === 'error') && link && (
            <>
              <div className="text-center">
                <div className="text-sm text-gray-500">{link.description || 'Amount due'}</div>
                <div className="text-4xl font-bold text-ink-900 mt-1">
                  {Number(link.amount).toFixed(2)} <span className="text-lg text-gray-500">{link.currency}</span>
                </div>
                {link.simulator && (
                  <div className="mt-2 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-2 py-1 inline-block">
                    Test mode — no live card is charged
                  </div>
                )}
              </div>

              <div>
                <label className="text-sm text-gray-500">Payment method</label>
                <select value={method} onChange={(e) => setMethod(e.target.value)} className="mt-1 border rounded px-3 py-2 w-full">
                  <option value="CARD">Card</option>
                  <option value="CASH">Cash</option>
                  <option value="BANK_TRANSFER">Bank transfer</option>
                </select>
              </div>

              {state === 'error' && (
                <div className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded px-3 py-2 flex items-start gap-2">
                  <AlertCircle size={16} className="mt-0.5 shrink-0" /> {message}
                </div>
              )}

              <button onClick={pay} disabled={state === 'paying'}
                className="w-full bg-ink-900 text-white py-3 rounded-lg font-medium hover:bg-ink-800 disabled:opacity-50 flex items-center justify-center gap-2">
                <Lock size={16} /> {state === 'paying' ? 'Processing…' : `Pay ${Number(link.amount).toFixed(2)} ${link.currency}`}
              </button>
              <p className="text-center text-xs text-gray-400">Payments are processed securely by {link.provider || 'the payment provider'}.</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
