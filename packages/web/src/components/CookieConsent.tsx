import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { Cookie, X } from 'lucide-react';

const STORAGE_KEY = 'pos_cookie_consent';

/**
 * First-visit cookie / consent notice. Mounted inside the authenticated
 * shell. Records the choice locally and (when signed in) persists it to the
 * Compliance Center backend as a COOKIE consent record.
 */
export default function CookieConsent() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) setVisible(true);
    } catch {
      /* storage unavailable — don't block the UI */
    }
  }, []);

  async function decide(prefs: { functional: boolean; analytics: boolean; marketing: boolean; thirdPartySharing: boolean }) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...prefs, at: new Date().toISOString() }));
    } catch {
      /* ignore */
    }
    if (typeof localStorage !== 'undefined' && localStorage.getItem('pos_token')) {
      try {
        await api.saveComplianceConsent({ type: 'COOKIE', source: 'banner', necessary: true, ...prefs });
      } catch {
        /* fire-and-forget */
      }
    }
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 p-3 sm:p-4">
      <div className="mx-auto max-w-3xl rounded-2xl border border-gold-500/30 bg-ink-950/95 p-4 text-white shadow-luxe backdrop-blur sm:p-5">
        <div className="flex items-start gap-3">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gold-500/15 text-gold-300">
            <Cookie size={18} />
          </span>
          <div className="flex-1">
            <h3 className="font-display text-lg text-gold-200">We value your privacy</h3>
            <p className="mt-1 text-xs leading-relaxed text-white/70">
              We use strictly-necessary storage to keep you signed in. With your permission we also enable functional,
              analytics and marketing features. Read our{' '}
              <Link to="/legal/cookies" className="text-gold-300 hover:underline">Cookie Policy</Link> and{' '}
              <Link to="/legal/privacy" className="text-gold-300 hover:underline">Privacy Policy</Link>.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={() => decide({ functional: true, analytics: true, marketing: true, thirdPartySharing: true })}
                className="rounded-lg bg-gold-500 px-4 py-2 text-sm font-semibold text-ink-950 shadow-gold hover:bg-gold-400"
              >
                Accept all
              </button>
              <button
                onClick={() => decide({ functional: false, analytics: false, marketing: false, thirdPartySharing: false })}
                className="rounded-lg border border-white/25 px-4 py-2 text-sm font-medium text-white/85 hover:bg-white/10"
              >
                Essential only
              </button>
              <Link
                to="/compliance"
                onClick={() => setVisible(false)}
                className="inline-flex items-center rounded-lg px-4 py-2 text-sm font-medium text-gold-300 hover:bg-white/5"
              >
                Customize
              </Link>
            </div>
          </div>
          <button onClick={() => setVisible(false)} aria-label="Dismiss cookie notice" className="text-white/50 hover:text-white">
            <X size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
