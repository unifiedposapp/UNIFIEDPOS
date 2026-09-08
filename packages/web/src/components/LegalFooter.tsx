import { Link } from 'react-router-dom';
import { COPYRIGHT } from '../data/legal';

interface Props {
  tone?: 'light' | 'dark';
  className?: string;
}

/**
 * Reusable legal footer: Privacy Policy + Terms of Use links and the
 * company copyright line. Used on the auth screens and inside the app.
 */
export default function LegalFooter({ tone = 'light', className = '' }: Props) {
  const linkCls =
    tone === 'dark' ? 'text-white/80 hover:text-white' : 'text-gray-500 hover:text-gray-800';
  const textCls = tone === 'dark' ? 'text-white/70' : 'text-gray-400';

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
      </div>
      <p className={`text-[11px] leading-relaxed ${textCls}`}>{COPYRIGHT}</p>
    </footer>
  );
}
