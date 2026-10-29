import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api/client';
import { Plus, Minus, Trash2, ShoppingBag, CheckCircle2, AlertTriangle } from 'lucide-react';

/**
 * The device surface (§7): what an unpaired tablet actually renders.
 *
 * One route, two jobs, chosen by the pairing token's mode:
 *   KIOSK             — public catalogue, guest basket, submit to the counter
 *   CUSTOMER_DISPLAY  — read-only mirror of the cashier's live basket
 *
 * This page holds no credentials and never trusts its own arithmetic: the kiosk
 * order is repriced by the server from the catalogue, and the display only
 * renders what the till pushed. A 401 here means "not paired", which is why the
 * API client exempts /device/ from the session-expiry redirect.
 */

const money = (n: number) => `$${Number(n || 0).toFixed(2)}`;

export default function DevicePage() {
  const { token = '' } = useParams<{ token: string }>();

  const [state, setState] = useState<'loading' | 'ready' | 'unpaired'>('loading');
  const [boot, setBoot] = useState<any>(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [basket, setBasket] = useState<Record<string, number>>({});
  const [customerName, setCustomerName] = useState('');
  const [fulfillmentType, setFulfillmentType] = useState('TAKEOUT');
  const [submitting, setSubmitting] = useState(false);
  const [confirmation, setConfirmation] = useState<any>(null);
  const [cart, setCart] = useState<any>(null);
  const lastSeen = useRef<string>('');

  async function bootstrap() {
    try {
      const res = await api.kioskBootstrap(token);
      setBoot(res.data);
      setState('ready');
    } catch (err: any) {
      setState('unpaired');
      setError(err?.message || 'This device is not paired');
    }
  }

  useEffect(() => {
    bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // A pairing is only "alive" while the device keeps announcing itself.
  useEffect(() => {
    if (state !== 'ready') return;
    const beat = setInterval(() => {
      api.kioskHeartbeat(token).catch(() => setState('unpaired'));
    }, 30_000);
    return () => clearInterval(beat);
  }, [state, token]);

  // The display polls; the till pushes. Polling is what makes a dropped push
  // self-heal without the cashier noticing.
  useEffect(() => {
    if (state !== 'ready' || boot?.mode !== 'CUSTOMER_DISPLAY') return;
    let cancelled = false;

    async function poll() {
      try {
        const res = await api.kioskGetCart(token);
        if (cancelled) return;
        setCart(res.data);
        const stamp = String(res.data?.updatedAt ?? '');
        if (stamp && stamp !== lastSeen.current) lastSeen.current = stamp;
      } catch {
        if (!cancelled) setState('unpaired');
      }
    }

    poll();
    const timer = setInterval(poll, 2500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [state, token, boot?.mode]);

  const catalogue: any[] = boot?.catalogue ?? [];
  const visible = catalogue.filter((p) => p.available !== false).filter((p) =>
    search ? String(p.name).toLowerCase().includes(search.toLowerCase()) : true,
  );

  const lines = Object.entries(basket)
    .map(([productId, quantity]) => {
      const product = catalogue.find((p) => p.id === productId);
      if (!product) return null;
      return { product, quantity, total: Number(product.price) * quantity };
    })
    .filter(Boolean) as { product: any; quantity: number; total: number }[];

  const subtotal = lines.reduce((s, l) => s + l.total, 0);
  const itemCount = lines.reduce((s, l) => s + l.quantity, 0);

  function step(product: any, delta: number) {
    setBasket((prev) => {
      const increment = product.isWeighed ? 0.1 : 1;
      const current = prev[product.id] ?? 0;
      const next = Math.round((current + delta * increment) * 1000) / 1000;
      const copy = { ...prev };
      if (next <= 0) delete copy[product.id];
      else copy[product.id] = next;
      return copy;
    });
  }

  async function submitOrder() {
    if (lines.length === 0) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await api.kioskSubmitOrder(token, {
        items: lines.map((l) => ({ productId: l.product.id, quantity: l.quantity })),
        customerName: customerName || undefined,
        fulfillmentType,
      });
      setConfirmation(res.data);
      setBasket({});
      setCustomerName('');
    } catch (err: any) {
      setError(err?.message || 'The order could not be submitted');
    } finally {
      setSubmitting(false);
    }
  }

  if (state === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 text-gray-500 text-sm">
        Connecting to the store…
      </div>
    );
  }

  if (state === 'unpaired') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 gap-3 px-6 text-center">
        <AlertTriangle size={40} className="text-amber-500" />
        <h1 className="text-xl font-semibold">This device is not paired</h1>
        <p className="text-sm text-gray-500 max-w-md">
          {error || 'Ask a manager to pair it again from Kiosk & Displays, then reopen the link on this device.'}
        </p>
      </div>
    );
  }

  const store = boot?.store;

  // ── Customer display ──────────────────────────────────────────────────────
  if (boot?.mode === 'CUSTOMER_DISPLAY') {
    const displayCart = cart?.cart;
    const displayLines = displayCart?.lines ?? [];
    const paid = String(displayCart?.paymentStatus ?? '').toUpperCase();
    return (
      <div className="min-h-screen bg-slate-900 text-white flex flex-col">
        <header className="px-8 py-6 border-b border-slate-700 flex items-center justify-between">
          <div className="text-lg font-semibold">{store?.storeName ?? 'Welcome'}</div>
          <div className="text-sm text-slate-400">{boot.label}</div>
        </header>

        <main className="flex-1 flex">
          <div className="flex-1 p-8 overflow-y-auto">
            {displayLines.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-3">
                <ShoppingBag size={48} />
                <p className="text-lg">Scan your first item</p>
              </div>
            ) : (
              <div className="space-y-3">
                {displayLines.map((l: any, i: number) => (
                  <div key={i} className="flex items-baseline justify-between gap-6 text-lg">
                    <div className="flex-1">
                      <div className="font-medium">{l.productName}</div>
                      <div className="text-sm text-slate-400 tabular-nums">
                        {Number(l.quantity)} × {money(l.unitPrice)}
                      </div>
                    </div>
                    <div className="tabular-nums">{money(l.totalAmount)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <aside className="w-96 bg-slate-800 p-8 flex flex-col justify-between">
            <div className="space-y-4">
              {displayCart?.customerName && (
                <div className="text-sm text-slate-400">Guest: {displayCart.customerName}</div>
              )}
              <div className="flex items-baseline justify-between text-slate-300">
                <span>Subtotal</span>
                <span className="tabular-nums">{money(displayCart?.subtotal ?? 0)}</span>
              </div>
              {Number(displayCart?.discount ?? 0) !== 0 && (
                <div className="flex items-baseline justify-between text-slate-300">
                  <span>Discount</span>
                  <span className="tabular-nums">−{money(displayCart?.discount ?? 0)}</span>
                </div>
              )}
              {Number(displayCart?.tax ?? 0) !== 0 && (
                <div className="flex items-baseline justify-between text-slate-300">
                  <span>Tax</span>
                  <span className="tabular-nums">{money(displayCart?.tax ?? 0)}</span>
                </div>
              )}
              {Number(displayCart?.tip ?? 0) !== 0 && (
                <div className="flex items-baseline justify-between text-slate-300">
                  <span>Tip</span>
                  <span className="tabular-nums">{money(displayCart?.tip ?? 0)}</span>
                </div>
              )}
            </div>

            <div className="space-y-3">
              <div className="border-t border-slate-600 pt-4 flex items-baseline justify-between">
                <span className="text-slate-300">Total</span>
                <span className="text-4xl font-bold tabular-nums">{money(displayCart?.total ?? 0)}</span>
              </div>
              {['PAID', 'COMPLETED', 'APPROVED'].includes(paid) && (
                <div className="flex items-center gap-2 text-green-400 font-medium">
                  <CheckCircle2 size={20} /> Payment approved — thank you
                </div>
              )}
            </div>
          </aside>
        </main>
      </div>
    );
  }

  // ── Self-service kiosk ────────────────────────────────────────────────────
  if (confirmation) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center gap-4 px-6 text-center">
        <CheckCircle2 size={56} className="text-green-600" />
        <h1 className="text-2xl font-bold">Order placed</h1>
        <p className="text-gray-600">
          Your number is <span className="font-mono font-semibold">{confirmation.order?.orderNumber}</span>
        </p>
        <p className="text-sm text-gray-500">
          Total {money(confirmation.order?.totalAmount ?? 0)} — please pay at the counter.
        </p>
        {confirmation.requiresAgeCheck && (
          <p className="text-sm text-amber-700 bg-amber-100 rounded-lg px-4 py-2">
            Photo ID will be checked before this order is released.
          </p>
        )}
        <button
          onClick={() => setConfirmation(null)}
          className="mt-4 bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700"
        >
          Start another order
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <div className="flex-1 flex flex-col">
        <header className="bg-white border-b px-6 py-4 flex items-center justify-between">
          <div>
            <div className="text-lg font-semibold">{store?.storeName ?? 'Self-service'}</div>
            <div className="text-xs text-gray-500">{store?.tagline ?? 'Tap an item to add it'}</div>
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search products…"
            className="border rounded-lg px-4 py-2 text-sm w-72"
          />
        </header>

        <main className="flex-1 overflow-y-auto p-6">
          {visible.length === 0 ? (
            <div className="h-full flex items-center justify-center text-gray-400 text-sm">
              Nothing available right now.
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
              {visible.map((p) => (
                <button
                  key={p.id}
                  onClick={() => step(p, 1)}
                  className="bg-white border rounded-xl p-4 text-left hover:border-blue-400 hover:shadow-sm transition"
                >
                  {p.imageUrl ? (
                    <img src={p.imageUrl} alt={p.name} className="w-full h-28 object-cover rounded-lg mb-3" />
                  ) : (
                    <div className="w-full h-28 bg-gray-100 rounded-lg mb-3 flex items-center justify-center text-gray-300">
                      <ShoppingBag size={28} />
                    </div>
                  )}
                  <div className="font-medium text-sm leading-snug">{p.name}</div>
                  <div className="text-gray-600 text-sm mt-1 tabular-nums">
                    {money(p.price)}
                    {p.isWeighed && <span className="text-xs text-gray-400"> /{String(p.unitOfMeasure ?? 'kg').toLowerCase()}</span>}
                  </div>
                  {p.ageRestricted && (
                    <div className="text-xs text-amber-700 mt-1">18+ · ID checked at the counter</div>
                  )}
                </button>
              ))}
            </div>
          )}
        </main>
      </div>

      <aside className="w-96 bg-white border-l flex flex-col">
        <div className="px-5 py-4 border-b font-semibold flex items-center justify-between">
          <span>Your order</span>
          <span className="text-sm text-gray-500">{itemCount} item(s)</span>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3">
          {lines.length === 0 ? (
            <div className="text-sm text-gray-400 py-10 text-center">Nothing added yet.</div>
          ) : (
            lines.map((l) => (
              <div key={l.product.id} className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{l.product.name}</div>
                  <div className="text-xs text-gray-500 tabular-nums">
                    {money(l.product.price)} × {l.quantity}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => step(l.product, -1)}
                    className="w-7 h-7 rounded border flex items-center justify-center hover:bg-gray-50"
                  >
                    <Minus size={12} />
                  </button>
                  <span className="w-10 text-center text-sm tabular-nums">{l.quantity}</span>
                  <button
                    onClick={() => step(l.product, 1)}
                    className="w-7 h-7 rounded border flex items-center justify-center hover:bg-gray-50"
                  >
                    <Plus size={12} />
                  </button>
                  <button
                    onClick={() =>
                      setBasket((prev) => {
                        const copy = { ...prev };
                        delete copy[l.product.id];
                        return copy;
                      })
                    }
                    className="w-7 h-7 rounded flex items-center justify-center text-gray-400 hover:text-rose-600"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
                <div className="w-16 text-right text-sm tabular-nums">{money(l.total)}</div>
              </div>
            ))
          )}
        </div>

        <div className="border-t px-5 py-4 space-y-3">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-gray-600">Total</span>
            <span className="text-2xl font-bold tabular-nums">{money(subtotal)}</span>
          </div>

          <input
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            placeholder="Your name (optional)"
            className="w-full border rounded-lg px-3 py-2 text-sm"
          />

          <select
            value={fulfillmentType}
            onChange={(e) => setFulfillmentType(e.target.value)}
            className="w-full border rounded-lg px-3 py-2 text-sm"
          >
            <option value="TAKEOUT">Take away</option>
            <option value="DINE_IN">Eat in</option>
            <option value="PICKUP">Pick up</option>
          </select>

          {error && <div className="text-xs text-rose-700 bg-rose-50 rounded px-2 py-1">{error}</div>}

          <button
            onClick={submitOrder}
            disabled={submitting || lines.length === 0}
            className="w-full bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? 'Placing order…' : 'Place order'}
          </button>
          <p className="text-xs text-gray-500 text-center">Prices are confirmed by the store when you submit.</p>
        </div>
      </aside>
    </div>
  );
}
