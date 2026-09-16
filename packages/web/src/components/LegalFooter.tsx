import { Link } from 'react-router-dom';
import { COPYRIGHT } from '../data/legal';

interface Props {
  tone?: 'light' | 'dark';
  className?: string;
}

/**
 * Reusable legal footer: Privacy Policy + Terms of Use links, a one-click
 * download of the User Manual (PDF book), and the company copyright line.
 * Used on the auth screens and inside the app.
 */
export default function LegalFooter({ tone = 'light', className = '' }: Props) {
  const linkCls =
    tone === 'dark' ? 'text-white/80 hover:text-white' : 'text-gray-500 hover:text-gray-800';
  const textCls = tone === 'dark' ? 'text-white/70' : 'text-gray-400';
  const manualCls =
    tone === 'dark'
      ? 'text-amber-300 hover:text-amber-200'
      : 'text-amber-700 hover:text-amber-900';

  return (
    <footer className={`text-center space-y-1 ${className}`}>
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs font-medium">
        <Link to="/legal/privacy" className={linkCls}>Privacy</Link>
        <span className={textCls}>&middot;</span>
        <Link to="/legal/terms" className={linkCls}>Terms</Link>
        <span className={textCls}>&middot;</span>
        <Link to="/legal/cookies" className={linkCls}>Cookies</Link>
        <span className={textCls}>&middot;</span>
        <Link to="/legal/accessibility" className={linkCls}>Accessibility</Link>
        <span className={textCls}>&middot;</span>
        <Link to="/legal/refunds" className={linkCls}>Refunds</Link>
        <span className={textCls}>&middot;</span>
        <a
          href="/User-Manual.pdf"
          download="Unified-POS-Manual-of-Use.pdf"
          className={`inline-flex items-center gap-1 font-semibold ${manualCls}`}
          title="Download the full User Manual as a PDF book"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-3.5 w-3.5"
            aria-hidden="true"
          >
            <path d="M12 3v12" />
            <path d="m7 10 5 5 5-5" />
            <path d="M5 21h14" />
          </svg>
          User Manual (PDF)
        </a>
      </div>
      <p className={`text-[11px] leading-relaxed ${textCls}`}>{COPYRIGHT}</p>
    </footer>
  );
}
