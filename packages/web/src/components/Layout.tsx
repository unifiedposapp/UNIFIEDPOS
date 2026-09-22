import { NavLink, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { api } from '../api/client';
import {
  ShoppingCart,
  ClipboardList,
  Package,
  BarChart3,
  Settings,
  LogOut,
  Menu,
  X,
  Users,
  SquareStack,
  FileText,
  Armchair,
  Star,
  DollarSign,
  UserCog,
  Truck,
  ShoppingBag,
  Webhook,
  Brain,
  CreditCard,
  Megaphone,
  MessageSquare,
  ArrowRightLeft,
  Monitor,
  Shield,
  ShieldCheck,
  Gift,
  Globe,
  Building2,
  Code2,
  Activity,
  Boxes,
  RefreshCw,
  Bell,
  Printer,
  Link2,
  UtensilsCrossed,
  Images,
  LineChart,
  ShieldAlert,
  // Global-expansion subsystems
  Receipt,
  Landmark,
  Bot,
  Layers,
  PiggyBank,
  Store,
  Network,
  Building,
  Puzzle,
  Scale,
  Repeat,
  CandlestickChart,
} from 'lucide-react';
import { useState, useEffect, useCallback } from 'react';
import clsx from 'clsx';
import LegalFooter from './LegalFooter';
import CookieConsent from './CookieConsent';
import LanguageSwitcher from './LanguageSwitcher';
import { useI18n } from '../i18n/I18nProvider';
import type { TranslationKey } from '../i18n/translations';
import { useRealtime, useRealtimeStatus } from '../hooks/useRealtime';

// Navigation grouped into luxury "collections" so the deep feature set stays elegant.
// Labels are i18n keys resolved at render via `t()` (see i18n/translations.ts).
const navGroups: { labelKey: TranslationKey; items: { to: string; labelKey: TranslationKey; icon: any }[] }[] = [
  {
    labelKey: 'nav.group.sell',
    items: [
      { to: '/pos', labelKey: 'nav.pos', icon: ShoppingCart },
      { to: '/orders', labelKey: 'nav.orders', icon: ClipboardList },
      { to: '/restaurant', labelKey: 'nav.restaurant', icon: Armchair },
      { to: '/restaurant-ops', labelKey: 'nav.restaurantOps', icon: UtensilsCrossed },
      { to: '/retail', labelKey: 'nav.retail', icon: Gift },
      { to: '/commerce', labelKey: 'nav.commerce', icon: Globe },
      { to: '/payments', labelKey: 'nav.payments', icon: CreditCard },
      { to: '/payment-links', labelKey: 'nav.paymentLinks', icon: Link2 },
    ],
  },
  {
    labelKey: 'nav.group.merchandise',
    items: [
      { to: '/inventory', labelKey: 'nav.inventory', icon: Package },
      { to: '/catalog', labelKey: 'nav.catalog', icon: Boxes },
      { to: '/media', labelKey: 'nav.media', icon: Images },
      { to: '/transfers', labelKey: 'nav.transfers', icon: ArrowRightLeft },
      { to: '/purchasing', labelKey: 'nav.purchasing', icon: ShoppingBag },
      { to: '/suppliers', labelKey: 'nav.suppliers', icon: Truck },
    ],
  },
  {
    labelKey: 'nav.group.growth',
    items: [
      { to: '/customers', labelKey: 'nav.customers', icon: Users },
      { to: '/loyalty', labelKey: 'nav.loyalty', icon: Star },
      { to: '/marketing', labelKey: 'nav.marketing', icon: Megaphone },
      { to: '/ai', labelKey: 'nav.ai', icon: Brain },
      { to: '/analytics', labelKey: 'nav.analytics', icon: LineChart },
      { to: '/copilot', labelKey: 'nav.copilot', icon: MessageSquare },
    ],
  },
  {
    labelKey: 'nav.group.workforce',
    items: [
      { to: '/employees', labelKey: 'nav.employees', icon: UserCog },
      { to: '/permissions', labelKey: 'nav.permissions', icon: Shield },
      { to: '/registers', labelKey: 'nav.registers', icon: SquareStack },
      { to: '/devices', labelKey: 'nav.devices', icon: Monitor },
      { to: '/hardware', labelKey: 'nav.hardware', icon: Printer },
    ],
  },
  {
    labelKey: 'nav.group.finance',
    items: [
      { to: '/accounting', labelKey: 'nav.accounting', icon: DollarSign },
      { to: '/reports', labelKey: 'nav.reports', icon: BarChart3 },
    ],
  },
  {
    labelKey: 'nav.group.platform',
    items: [
      { to: '/developer', labelKey: 'nav.developer', icon: Code2 },
      { to: '/webhooks', labelKey: 'nav.webhooks', icon: Webhook },
      { to: '/enterprise', labelKey: 'nav.enterprise', icon: Building2 },
      { to: '/system', labelKey: 'nav.system', icon: Activity },
      { to: '/sync', labelKey: 'nav.sync', icon: RefreshCw },
    ],
  },
  {
    labelKey: 'nav.group.global',
    items: [
      { to: '/fiscalization', labelKey: 'nav.fiscalization', icon: Receipt },
      { to: '/rails', labelKey: 'nav.rails', icon: Landmark },
      { to: '/agent-ops', labelKey: 'nav.agentOps', icon: Bot },
      { to: '/verticals', labelKey: 'nav.verticals', icon: Layers },
      { to: '/finance', labelKey: 'nav.finance', icon: PiggyBank },
      { to: '/agents', labelKey: 'nav.agents', icon: Store },
      { to: '/mesh', labelKey: 'nav.mesh', icon: Network },
      { to: '/franchise', labelKey: 'nav.franchise', icon: Building },
      { to: '/apps', labelKey: 'nav.apps', icon: Puzzle },
      { to: '/benchmark', labelKey: 'nav.benchmark', icon: Scale },
      { to: '/fx', labelKey: 'nav.fx', icon: CandlestickChart },
      { to: '/subscriptions', labelKey: 'nav.subscriptions', icon: Repeat },
    ],
  },
  {
    labelKey: 'nav.group.admin',
    items: [
      { to: '/notifications', labelKey: 'nav.notifications', icon: Bell },
      { to: '/audit', labelKey: 'nav.audit', icon: FileText },
      { to: '/fraud', labelKey: 'nav.fraud', icon: ShieldAlert },
      { to: '/compliance', labelKey: 'nav.compliance', icon: ShieldCheck },
      { to: '/settings', labelKey: 'nav.settings', icon: Settings },
    ],
  },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuthStore();
  const { t, localeTag } = useI18n();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const refreshUnread = useCallback(async () => {
    try {
      const res = await api.getUnreadCount();
      setUnreadCount(res.data?.count || 0);
    } catch {
      /* ignore polling errors */
    }
  }, []);

  // Real-time: refresh the badge the instant the server emits a business event
  // (order/payment/inventory/notification). SSE replaces the old 30s poll; a
  // slow 2-minute fallback poll remains in case the stream is unavailable.
  useRealtime(() => refreshUnread());
  const realtimeStatus = useRealtimeStatus();

  useEffect(() => {
    refreshUnread();
    const interval = setInterval(refreshUnread, 120000);
    return () => clearInterval(interval);
  }, [refreshUnread]);

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  return (
    <div className="flex h-screen">
      {/* WCAG 2.4.1 bypass block — visually hidden until keyboard-focused. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:shadow-lg focus:ring-2 focus:ring-gold-500"
      >
        {t('a11y.skip')}
      </a>
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-ink-950/60 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ── Luxury sidebar ── */}
      <aside
        className={clsx(
          'fixed inset-y-0 start-0 z-30 w-72 transform border-e border-white/10 bg-gradient-to-b from-ink-950 via-ink-900 to-ink-950 shadow-[8px_0_40px_-20px_rgba(10,13,24,0.9)] rtl:shadow-[-8px_0_40px_-20px_rgba(10,13,24,0.9)] transition-transform lg:static lg:flex lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full rtl:translate-x-full'
        )}
      >
        <div className="flex h-full flex-col">
          {/* Brand */}
          <div className="flex h-20 items-center gap-3 border-b border-white/10 px-5">
            <img
              src="/logo.png"
              alt="UnifiedPOS"
              className="h-10 w-10 rounded-xl object-cover shadow-gold ring-1 ring-gold-500/40"
            />
            <div className="min-w-0">
              <div className="bg-gradient-to-r from-gold-200 via-gold-400 to-gold-200 bg-clip-text font-display text-lg leading-tight text-transparent">
                UnifiedPOS
              </div>
              <div className="text-[10px] uppercase tracking-luxe text-ink-300/70">{t('app.tagline')}</div>
            </div>
            <button className="ms-auto text-ink-200 hover:text-white lg:hidden" onClick={() => setSidebarOpen(false)} aria-label="Close menu">
              <X size={22} />
            </button>
          </div>

          {/* Nav */}
          <nav className="flex-1 overflow-y-auto py-3" aria-label={t('a11y.mainNav')}>
            {navGroups.map((group) => (
              <div key={group.labelKey} className="mb-1">
                <p className="px-6 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-luxe text-ink-400/50">
                  {t(group.labelKey)}
                </p>
                {group.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === '/pos'}
                    onClick={() => setSidebarOpen(false)}
                    className={({ isActive }) =>
                      clsx(
                        'group relative mx-3 flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all',
                        isActive
                          ? 'bg-gold-500/10 font-medium text-gold-100'
                          : 'text-ink-200/70 hover:bg-white/5 hover:text-white'
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <span
                          className={clsx(
                            'absolute start-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-gold-400 transition-opacity',
                            isActive ? 'opacity-100' : 'opacity-0'
                          )}
                        />
                        <item.icon
                          size={18}
                          className={clsx('shrink-0', isActive ? 'text-gold-300' : 'text-ink-300 group-hover:text-gold-200')}
                        />
                        <span className="truncate">{t(item.labelKey)}</span>
                        {item.to === '/notifications' && unreadCount > 0 && (
                          <span className="ms-auto flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-gold-500 px-1 text-[10px] font-bold text-ink-950">
                            {unreadCount > 99 ? '99+' : unreadCount}
                          </span>
                        )}
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            ))}
          </nav>

          {/* User */}
          <div className="border-t border-white/10 p-4">
            <div className="mb-3 flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gold-500/15 text-sm font-semibold text-gold-300 ring-1 ring-gold-500/30">
                {user?.name?.charAt(0) || 'U'}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-white">{user?.name || 'User'}</div>
                <div className="truncate text-[11px] uppercase tracking-wide text-gold-200/60">{user?.role || ''}</div>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink-200/80 transition-colors hover:bg-white/5 hover:text-rose-300"
            >
              <LogOut size={16} />
              {t('app.signOut')}
            </button>
          </div>

          {/* Legal & copyright */}
          <LegalFooter tone="dark" className="border-t border-white/10 px-3 py-2.5" />
        </div>
      </aside>

      {/* ── Main column ── */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <header className="flex h-16 items-center border-b border-ink-100/70 bg-white/70 px-4 shadow-luxe-sm backdrop-blur-md lg:px-6">
          <button className="me-4 text-ink-700 lg:hidden" onClick={() => setSidebarOpen(true)}>
            <Menu size={22} />
          </button>
          <div className="hidden items-center gap-2 text-xs text-ink-400 sm:flex">
            <span
              className={clsx(
                'h-1.5 w-1.5 animate-pulse rounded-full',
                realtimeStatus === 'open' ? 'bg-emerald-400' : 'bg-amber-400'
              )}
              title={realtimeStatus === 'open' ? 'Live real-time connection' : 'Reconnecting…'}
            />
            <span className="font-medium tracking-wide">{t('app.status.operational')}</span>
          </div>
          <div className="flex-1" />
          <div className="flex items-center gap-2 text-sm text-ink-500 sm:gap-4">
            <span className="hidden text-xs font-medium text-ink-500 md:block">
              {new Date().toLocaleDateString(localeTag, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            </span>
            <LanguageSwitcher />
            <button
              onClick={() => navigate('/notifications')}
              title={t('nav.notifications')}
              aria-label={t('nav.notifications')}
              className="relative rounded-lg p-2 text-ink-500 transition-colors hover:bg-gold-50 hover:text-gold-600"
            >
              <Bell size={20} />
              {unreadCount > 0 && (
                <span className="absolute -end-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </button>
          </div>
        </header>

        {/* Page content */}
        <main id="main-content" className="flex-1 overflow-y-auto">{children}</main>
      </div>

      {/* First-visit cookie / consent notice */}
      <CookieConsent />
    </div>
  );
}
