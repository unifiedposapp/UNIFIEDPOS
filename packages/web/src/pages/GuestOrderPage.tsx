import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api/client';
import { ShoppingBag, Plus, Minus, CheckCircle2, AlertCircle, UtensilsCrossed } from 'lucide-react';

// Public, unauthenticated scan-to-order page (§17). A guest scans a table's QR
// code, browses the live menu, builds a cart, and sends the order to the kitchen.
// Prices are resolved server-side — the client only sends productId + quantity.

interface MenuItem { productId: string; name: string; description: string | null; price: number; imageUrl: string | null; available: boolean; }
interface MenuSection { id: string; name: string; items: MenuItem[]; }

export default function GuestOrderPage() {
  const { token } = useParams<{ token: string }>();
  const [table, setTable] = useState<any>(null);
  const [org, setOrg] = useState<any>(null);
  const [menu, setMenu] = useState<MenuSection[]>([]);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [customerName, setCustomerName] = useState('');
  const [state, setState] = useState<'loading' | 'ready' | 'invalid' | 'submitting' | 'sent' | 'error'>('loading');
  const [placed, setPlaced] = useState<any>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const res = await api.getPublicQrTable(token);
        setTable(res.data?.table);
        setOrg(res.data?.organization);
        setMenu(res.data?.menu || []);
        setState('ready');
      } catch (e: any) {
        setMessage(e.message || 'This QR code is not valid.');
        setState('invalid');
      }
    })();
  }, [token]);

  const flatItems = useMemo(() => menu.flatMap((s) => s.items), [menu]);
  const total = useMemo(
    () => Object.entries(cart).reduce((sum, [id, qty]) => sum + (flatItems.find((i) => i.productId === id)?.price || 0) * qty, 0),
    [cart, flatItems]
  );
  const count = useMemo(() => Object.values(cart).reduce((a, b) => a + b, 0), [cart]);

  const add = (id: string) => setCart((c) => ({ ...c, [id]: (c[id] || 0) + 1 }));
  const remove = (id: string) => setCart((c) => {
    const next = { ...c };
    const q = (next[id] || 0) - 1;
    if (q <= 0) delete next[id]; else next[id] = q;
    return next;
  });

  const submit = async () => {
    if (!token || count === 0) return;
    setState('submitting');
    try {
      const items = Object.entries(cart).map(([productId, quantity]) => ({ productId, quantity }));
      const res = await api.submitPublicQrOrder(token, { items, customerName: customerName || undefined });
      setPlaced(res.data);
      setState('sent');
    } catch (e: any) {
      setMessage(e.message || 'Could not send your order.');
      setState('error');
    }
  };

  if (state === 'loading') return <Shell><div className="text-center text-gray-500 py-16">Loading menu…</div></Shell>;
  if (state === 'invalid') {
    return (
      <Shell>
        <div className="text-center py-16 space-y-2">
          <AlertCircle className="mx-auto text-rose-500" size={40} />
          <div className="font-semibold">QR code unavailable</div>
          <div className="text-sm text-gray-500">{message}</div>
        </div>
      </Shell>
    );
  }

  if (state === 'sent' && placed) {
    return (
      <Shell>
        <div className="text-center py-16 space-y-3">
          <CheckCircle2 className="mx-auto text-emerald-500" size={56} />
          <div className="text-xl font-semibold">Order sent to the kitchen!</div>
          <div className="text-sm text-gray-500">Order {placed.orderNumber} · {placed.itemCount} item(s)</div>
          <div className="text-2xl font-bold">{placed.subtotal.toFixed(2)} {placed.currency}</div>
          <div className="text-sm text-gray-400">Your server will be with you shortly. Payment is settled at the table.</div>
          <button onClick={() => { setCart({}); setState('ready'); }} className="mt-4 text-violet-600 text-sm hover:underline">Order something else</button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="sticky top-0 bg-white/95 backdrop-blur border-b px-4 py-3 flex items-center gap-2">
        <UtensilsCrossed className="text-gold-500" size={20} />
        <div>
          <div className="font-display font-semibold">{org?.name || 'Menu'}</div>
          <div className="text-xs text-gray-500">Table {table?.number}</div>
        </div>
      </div>

      <div className="p-4 pb-32 space-y-6">
        {state === 'error' && (
          <div className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded px-3 py-2 flex items-start gap-2">
            <AlertCircle size={16} className="mt-0.5 shrink-0" /> {message}
          </div>
        )}

        {menu.map((section) => (
          <div key={section.id}>
            <h3 className="font-semibold text-gray-800 mb-2">{section.name}</h3>
            <div className="space-y-2">
              {section.items.map((item) => (
                <div key={item.productId} className="bg-white rounded-lg border p-3 flex items-center gap-3">
                  {item.imageUrl ? (
                    <img src={item.imageUrl} alt="" className="h-14 w-14 rounded object-cover" />
                  ) : (
                    <div className="h-14 w-14 rounded bg-gray-100 flex items-center justify-center text-gray-300"><UtensilsCrossed size={22} /></div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{item.name}</div>
                    {item.description && <div className="text-xs text-gray-500 truncate">{item.description}</div>}
                    <div className="text-sm text-gray-700 font-medium">{item.price.toFixed(2)} {org?.currency}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    {cart[item.productId] > 0 && (
                      <>
                        <button onClick={() => remove(item.productId)} className="h-8 w-8 rounded-full border flex items-center justify-center text-gray-600"><Minus size={14} /></button>
                        <span className="w-5 text-center font-medium">{cart[item.productId]}</span>
                      </>
                    )}
                    <button onClick={() => add(item.productId)} className="h-8 w-8 rounded-full bg-violet-600 text-white flex items-center justify-center"><Plus size={14} /></button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
        {menu.length === 0 && <div className="text-center text-gray-500 py-12">The menu is currently empty.</div>}
      </div>

      {count > 0 && (
        <div className="fixed bottom-0 inset-x-0 bg-white border-t p-4 space-y-2 shadow-lg">
          <input placeholder="Your name (optional)" value={customerName} onChange={(e) => setCustomerName(e.target.value)}
            className="border rounded px-3 py-2 w-full text-sm" />
          <button onClick={submit} disabled={state === 'submitting'}
            className="w-full bg-ink-900 text-white py-3 rounded-lg font-medium hover:bg-ink-800 disabled:opacity-50 flex items-center justify-center gap-2">
            <ShoppingBag size={16} />
            {state === 'submitting' ? 'Sending…' : `Send order · ${total.toFixed(2)} ${org?.currency || ''}`}
          </button>
        </div>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-gray-50 max-w-md mx-auto shadow-xl">{children}</div>;
}
