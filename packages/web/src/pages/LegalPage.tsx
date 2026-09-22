import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ShieldCheck, Scale, Cookie, Accessibility, RotateCcw, FileCheck2 } from 'lucide-react';
import {
  LEGAL_DOCS,
  COMPANY,
  PARENT_COMPANY,
  LEGAL_LAST_UPDATED,
  COPYRIGHT,
} from '../data/legal';

/**
 * Standalone legal document viewer (Privacy Policy / Terms of Use).
 * Reachable both before sign-in (from the auth screens) and inside the app.
 */
export default function LegalPage() {
  const { doc } = useParams<{ doc: string }>();
  const navigate = useNavigate();
  const legal = LEGAL_DOCS[(doc || '').toLowerCase()] || LEGAL_DOCS.privacy;
  const ICONS: Record<string, any> = { privacy: ShieldCheck, terms: Scale, cookies: Cookie, accessibility: Accessibility, refunds: RotateCcw, dpa: FileCheck2 };
  const Icon = ICONS[legal.slug] || ShieldCheck;

  return (
    <div className="min-h-screen">
      <div className="sticky top-0 z-10 border-b border-ink-100 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-3 px-4">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-1.5 text-sm text-ink-600 transition-colors hover:text-gold-600"
          >
            <ArrowLeft size={16} className="rtl:rotate-180" /> Back
          </button>
          <div className="flex-1" />
          <span className="font-display text-sm text-ink-900">{COMPANY}</span>
        </div>
      </div>

      <main className="max-w-3xl mx-auto px-4 py-8">
        <div className="rounded-2xl border border-ink-100 bg-white p-6 shadow-luxe ring-1 ring-gold-500/10 sm:p-10">
          <div className="mb-2 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gold-50 ring-1 ring-gold-200">
              <Icon size={22} className="text-gold-600" />
            </div>
            <h1 className="font-display text-2xl text-ink-900 sm:text-3xl">{legal.title}</h1>
          </div>
          <p className="text-xs text-gray-400 mb-6">
            Last updated: {LEGAL_LAST_UPDATED} &middot; {COMPANY}, a division of {PARENT_COMPANY}
          </p>

          <p className="text-gray-600 leading-relaxed mb-8">{legal.intro}</p>

          <div className="space-y-7">
            {legal.sections.map((section) => (
              <section key={section.heading}>
                <h2 className="text-base font-semibold text-gray-900 mb-2">{section.heading}</h2>
                {section.body.map((para, i) => (
                  <p key={i} className="text-sm text-gray-600 leading-relaxed mb-2">{para}</p>
                ))}
                {section.bullets && (
                  <ul className="list-disc pl-5 space-y-1 mt-2">
                    {section.bullets.map((b, i) => (
                      <li key={i} className="text-sm text-gray-600 leading-relaxed">{b}</li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>

          <div className="mt-10 pt-6 border-t">
            <p className="text-xs text-gray-500 text-center leading-relaxed">{COPYRIGHT}</p>
          </div>
        </div>
      </main>
    </div>
  );
}
