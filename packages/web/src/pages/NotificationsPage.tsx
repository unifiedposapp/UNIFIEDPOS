import { useEffect, useState, useCallback } from 'react';
import { api } from '../api/client';
import {
  Bell,
  BellOff,
  CheckCheck,
  Trash2,
  AlertTriangle,
  Info,
  AlertOctagon,
  Settings2,
  RefreshCw,
} from 'lucide-react';
import clsx from 'clsx';

interface Notification {
  id: string;
  type: string;
  severity: string;
  title: string;
  message: string;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
  sourceEvent: string | null;
}

interface Preferences {
  email: boolean;
  sms: boolean;
  push: boolean;
  inApp: boolean;
  lowStock: boolean;
  paymentIssues: boolean;
  marketing: boolean;
}

const SEVERITY_META: Record<string, { icon: any; color: string; badge: string }> = {
  CRITICAL: { icon: AlertOctagon, color: 'text-red-600', badge: 'bg-red-100 text-red-700' },
  WARNING: { icon: AlertTriangle, color: 'text-amber-600', badge: 'bg-amber-100 text-amber-700' },
  INFO: { icon: Info, color: 'text-blue-600', badge: 'bg-blue-100 text-blue-700' },
};

const PREF_LABELS: { key: keyof Preferences; label: string; hint: string }[] = [
  { key: 'inApp', label: 'In-app', hint: 'Show notifications inside the dashboard' },
  { key: 'email', label: 'Email', hint: 'Receive notifications by email' },
  { key: 'push', label: 'Push', hint: 'Browser / device push alerts' },
  { key: 'sms', label: 'SMS', hint: 'Text message alerts' },
  { key: 'lowStock', label: 'Low stock alerts', hint: 'When items fall below reorder point' },
  { key: 'paymentIssues', label: 'Payment issues', hint: 'Failed payments, chargebacks, disputes' },
  { key: 'marketing', label: 'Marketing', hint: 'Campaign and promotion updates' },
];

export default function NotificationsPage() {
  const [items, setItems] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [showPrefs, setShowPrefs] = useState(false);
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params: Record<string, string> = { pageSize: '50' };
      if (filter === 'unread') params.unread = 'true';
      const res = await api.getNotifications(params);
      setItems(res.data.items || []);
      setUnreadCount(res.data.unreadCount || 0);
    } catch (e: any) {
      setError(e.message || 'Failed to load notifications');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  const openPreferences = async () => {
    setShowPrefs((s) => !s);
    if (!prefs) {
      try {
        const res = await api.getNotificationPreferences();
        setPrefs(res.data);
      } catch (e: any) {
        setError(e.message || 'Failed to load preferences');
      }
    }
  };

  const togglePref = (key: keyof Preferences) => {
    setPrefs((p) => (p ? { ...p, [key]: !p[key] } : p));
  };

  const savePrefs = async () => {
    if (!prefs) return;
    setSavingPrefs(true);
    try {
      const res = await api.updateNotificationPreferences(prefs);
      setPrefs(res.data);
      setShowPrefs(false);
    } catch (e: any) {
      setError(e.message || 'Failed to save preferences');
    } finally {
      setSavingPrefs(false);
    }
  };

  const markRead = async (id: string) => {
    try {
      await api.markNotificationRead(id);
      setItems((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
      setUnreadCount((c) => Math.max(0, c - 1));
    } catch (e: any) {
      setError(e.message || 'Failed to mark as read');
    }
  };

  const markAllRead = async () => {
    try {
      await api.markAllNotificationsRead();
      setItems((prev) => prev.map((n) => ({ ...n, isRead: true })));
      setUnreadCount(0);
    } catch (e: any) {
      setError(e.message || 'Failed to mark all as read');
    }
  };

  const remove = async (id: string) => {
    try {
      await api.deleteNotification(id);
      setItems((prev) => {
        const target = prev.find((n) => n.id === id);
        if (target && !target.isRead) setUnreadCount((c) => Math.max(0, c - 1));
        return prev.filter((n) => n.id !== id);
      });
    } catch (e: any) {
      setError(e.message || 'Failed to delete notification');
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Bell className="text-blue-600" size={26} />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Notifications</h1>
            <p className="text-sm text-gray-500">
              {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={openPreferences}
            className="flex items-center gap-2 px-3 py-2 text-sm border rounded-lg hover:bg-gray-50"
          >
            <Settings2 size={16} /> Preferences
          </button>
          <button
            onClick={markAllRead}
            disabled={unreadCount === 0}
            className="flex items-center gap-2 px-3 py-2 text-sm border rounded-lg hover:bg-gray-50 disabled:opacity-40"
          >
            <CheckCheck size={16} /> Mark all read
          </button>
          <button
            onClick={load}
            className="flex items-center gap-2 px-3 py-2 text-sm border rounded-lg hover:bg-gray-50"
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      {showPrefs && prefs && (
        <div className="mb-6 bg-white border rounded-xl p-5">
          <h2 className="font-semibold mb-4 text-gray-800">Notification preferences</h2>
          <div className="grid gap-3">
            {PREF_LABELS.map((p) => (
              <label key={p.key} className="flex items-center justify-between gap-4">
                <span>
                  <span className="text-sm font-medium text-gray-700">{p.label}</span>
                  <span className="block text-xs text-gray-400">{p.hint}</span>
                </span>
                <input
                  type="checkbox"
                  checked={prefs[p.key]}
                  onChange={() => togglePref(p.key)}
                  className="w-5 h-5 accent-blue-600"
                />
              </label>
            ))}
          </div>
          <div className="flex justify-end gap-2 mt-5">
            <button
              onClick={() => setShowPrefs(false)}
              className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={savePrefs}
              disabled={savingPrefs}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {savingPrefs ? 'Saving…' : 'Save preferences'}
            </button>
          </div>
        </div>
      )}

      <div className="flex gap-2 mb-4">
        {(['all', 'unread'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={clsx(
              'px-4 py-1.5 text-sm rounded-full border transition-colors capitalize',
              filter === f
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-gray-600 hover:bg-gray-50'
            )}
          >
            {f}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded-lg">{error}</div>
      )}

      {loading ? (
        <div className="text-center py-16 text-gray-400">Loading notifications…</div>
      ) : items.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <BellOff className="mx-auto mb-3" size={40} />
          <p>No notifications{filter === 'unread' ? ' (unread)' : ''}.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((n) => {
            const meta = SEVERITY_META[n.severity] || SEVERITY_META.INFO;
            const Icon = meta.icon;
            return (
              <div
                key={n.id}
                className={clsx(
                  'flex items-start gap-3 bg-white border rounded-xl p-4 transition-colors',
                  !n.isRead && 'border-l-4 border-l-blue-500 bg-blue-50/30'
                )}
              >
                <div className={clsx('mt-0.5', meta.color)}>
                  <Icon size={20} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={clsx('font-medium text-gray-900', !n.isRead && 'font-semibold')}>
                      {n.title}
                    </span>
                    <span className={clsx('text-[10px] px-1.5 py-0.5 rounded', meta.badge)}>
                      {n.severity}
                    </span>
                    {!n.isRead && (
                      <span className="w-2 h-2 rounded-full bg-blue-500" title="Unread" />
                    )}
                  </div>
                  <p className="text-sm text-gray-600 mt-0.5">{n.message}</p>
                  <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-400">
                    <span>{n.type.replace(/_/g, ' ')}</span>
                    <span>•</span>
                    <span>{new Date(n.createdAt).toLocaleString()}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {!n.isRead && (
                    <button
                      onClick={() => markRead(n.id)}
                      title="Mark as read"
                      className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded"
                    >
                      <CheckCheck size={16} />
                    </button>
                  )}
                  <button
                    onClick={() => remove(n.id)}
                    title="Delete"
                    className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
