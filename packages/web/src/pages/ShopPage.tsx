import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api/client';
import { ShoppingBag, Plus, Minus, CheckCircle2, AlertCircle, Store, MapPin, Clock, Truck, Package, Search, X, ReceiptText } from 'lucide-react';

// ─── Public online storefront (/shop/:slug) ─────────────────────────────────
// The customer-facing shop a merchant publishes from Settings ▸ Storefront.
// Unauthenticated, no cart persistence, and deliberately thin on trust: the
// only thing this page decides is WHICH products and HOW MANY. Every price,
// the tax, the delivery fee and the minimum-order rule are re-derived on the
// server when the order is placed, so a tampered payload cannot change a total.
//
// The same component also renders the order-status surface (/shop/:slug/status/
// :token), which is readable only through the claim token handed out at checkout.

interface ShopItem {
  productId: string;
  name: string;
  sku: string | null;
  type: string;
  description: string | null;
  imageUrl: string | null;
  price: number;
  available: boolean;
  stock: number | null;
}
interface ShopSection {
  name: string;
  items: ShopItem[];
}
interface ShopData {
  slug: string;
  name: string;
  headerText: string | null;
  themeColor: string | null;
  storeName: string;
  currency: string;
  locationName: { name: string; address: string | null; phone: string | null } | null;
  fulfillmentTypes: string[];
  pickupSlots: { day: string; slots: string[] }[] | null;
  deliveryFee: number;
  minOrderAmount: number;
  payOnPickup: boolean;
  taxRate: number;
  menu: ShopSection[];
}

const FULFILLMENT_LABELS: Record<string, { label: string; hint: string; icon: any }> = {
  PICKUP: { label: 'Pickup', hint: 'Collect at the counter', icon: Package },
  CURBSIDE: { label: 'Curbside', hint: 'We bring it to your car', icon: Store },
  DELIVERY: { label: 'Delivery', hint: 'To your door', icon: Truck },
  SHIP: { label: 'Shipping', hint: 'Carrier delivery in a few days', icon: MapPin },
};

function money(value: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

export default function ShopPage() {
  const { slug, token } = useParams<{ slug: string; token?: string }>();
  const [shop, setShop] = useState<ShopData | null>(null);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [section, setSection] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [fulfillment, setFulfillment] = useState('PICKUP');
  const [slot, setSlot] = useState('');
  const [contact, setContact] = useState({ name: '', email: '', phone: '' });
  const [address, setAddress] = useState({ recipientName: '', addressLine1: '', addressLine2: '', city: '', postalCode: '', country: '', phoneNumber: '' });
  const [notes, setNotes] = useState('');
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'submitting'>('loading');
  const [placed, setPlaced] = useState<any>(null);
  const [message, setMessage] = useState('');
  const [cartOpen, setCartOpen] = useState(false);

  useEffect(() => {
    if (!slug) return;
    setState('loading');
    api
      .getPublicStorefront(slug)
      .then((res) => {
        setShop(res.data);
        const offered: string[] = res.data?.fulfillmentTypes || [];
        setFulfillment(offered.length ? offered[0] : 'PICKUP');
        setState('ready');
      })
      .catch((e: any) => {
        setMessage(e?.message || 'This store is not open online.');
        setState('error');
      });
  }, [slug]);

  const flatItems = useMemo(() => (shop?.menu || []).flatMap((s) => s.items), [shop]);
  const lines = useMemo(
    () =>
      Object.entries(cart)
        .map(([id, qty]) => {
          const item = flatItems.find((i) => i.productId === id);
          return item ? { item, qty, total: item.price * qty } : null;
        })
        .filter(Boolean) as { item: ShopItem; qty: number; total: number }[],
    [cart, flatItems]
  );
  const subtotal = lines.reduce((s, l) => s + l.total, 0);
  const deliveryFee = fulfillment === 'DELIVERY' ? shop?.deliveryFee || 0 : 0;
  const tax = round2(subtotal * ((shop?.taxRate || 0) / 100));
  const total = round2(subtotal + tax + deliveryFee);
  const count = lines.reduce((s, l) => s + l.qty, 0);
  const belowMinimum = (shop?.minOrderAmount || 0) > 0 && subtotal < (shop?.minOrderAmount || 0);
  const accent = shop?.themeColor || '#0f766e';

  const add = (item: ShopItem) => {
    setCart((c) => ({ ...c, [item.productId]: Math.min((c[item.productId] || 0) + 1, item.stock ?? 999) }));
    setCartOpen(true);
  };
  const remove = (id: string) =>
    setCart((c) => {
      const next = { ...c };
      const q = (next[id] || 0) - 1;
      if (q <= 0) delete next[id];
      else next[id] = q;
      return next;
    });

  const submit = async () => {
    if (!slug || !count || belowMinimum) return;
    setState('submitting');
    setMessage('');
    try {
      const res = await api.placeStorefrontOrder(slug, {
        fulfillmentType: fulfillment,
        items: lines.map((l) => ({ productId: l.item.productId, quantity: l.qty })),
        customer: { name: contact.name || undefined, email: contact.email || undefined, phone: contact.phone || undefined },
        ...(fulfillment === 'DELIVERY' || fulfillment === 'SHIP'
          ? { delivery: { ...address, recipientName: address.recipientName || contact.name, phoneNumber: address.phoneNumber || contact.phone } }
          : {}),
        pickupSlot: slot || undefined,
        notes: notes || undefined,
      });
      setPlaced(res.data);
      setCart({});
      setCartOpen(false);
      setState('ready');
    } catch (e: any) {
      setMessage(e?.message || 'We could not place your order.');
      setState('ready');
    }
  };

  if (state === 'loading' && !placed) {
    return (
      <Shell accent={accent}>
        <div className="py-24 text-center text-ink-400">Opening the shop…</div>
      </Shell>
    );
  }

  if (state === 'error' && !placed) {
    return (
      <Shell accent={accent}>
        <div className="py-24 text-center space-y-3">
          <AlertCircle className="mx-auto text-rose-500" size={40} />
          <div className="font-semibold text-lg">Shop unavailable</div>
          <div className="text-sm text-ink-400">{message}</div>
        </div>
      </Shell>
    );
  }

  // ── Order confirmation (immediately after checkout) ───────────────────────
  if (placed) {
    return (
      <Shell accent={accent}>
        <div className="px-5 py-14 text-center space-y-4">
          <CheckCircle2 className="mx-auto text-emerald-500" size={56} />
          <div className="text-2xl font-semibold">Order {placed.orderNumber} is in</div>
          <p className="text-sm text-ink-400">
            {placed.payOnPickup ? 'Pay when you collect.' : 'Paid online.'} We will email you when it is ready.
          </p>
          <div className="bg-white rounded-xl border border-ink-100 p-4 text-start space-y-1">
            {(placed.items || []).map((i: any, idx: number) => (
              <div key={idx} className="flex justify-between text-sm">
                <span>
                  {i.quantity} × {i.name}
                </span>
                <span className="font-mono">{money(i.totalAmount, placed.currency)}</span>
              </div>
            ))}
            <div className="border-t mt-2 pt-2 flex justify-between font-semibold">
              <span>Total</span>
              <span className="font-mono">{money(placed.totalAmount, placed.currency)}</span>
            </div>
            {placed.deliveryFee > 0 && <div className="text-xs text-ink-400">Includes {money(placed.deliveryFee, placed.currency)} delivery</div>}
          </div>
          {placed.trackUrl && (
            <a href={new URL(placed.trackUrl, window.location.href).pathname} className="inline-flex items-center gap-2 text-sm font-medium" style={{ color: accent }}>
              <ReceiptText size={16} /> Track this order
            </a>
          )}
          <div>
            <button onClick={() => setPlaced(null)} className="text-sm text-ink-400 hover:underline">
              Back to the shop
            </button>
          </div>
        </div>
      </Shell>
    );
  }

  // ── Order status, reachable only with the claim token ─────────────────────
  if (token && slug) return <StatusView slug={slug} token={token} accent={accent} shopName={shop?.name || ''} />;

  const visibleSections = (shop?.menu || [])
    .map((s) => ({
      ...s,
      items: s.items.filter(
        (i) => (!search || i.name.toLowerCase().includes(search.toLowerCase()) || (i.sku || '').toLowerCase().includes(search.toLowerCase())) && (!section || s.name === section)
      ),
    }))
    .filter((s) => s.items.length);

  return (
    <Shell accent={accent}>
      {/* Header */}
      <header className="text-white px-5 py-6" style={{ backgroundColor: accent }}>
        <div className="flex items-start gap-3">
          <Store size={26} className="mt-1 shrink-0 opacity-90" />
          <div className="min-w-0">
            <h1 className="font-display text-2xl leading-tight">{shop?.name || shop?.storeName}</h1>
            {shop?.headerText && <p className="text-sm opacity-90 mt-1">{shop.headerText}</p>}
            {shop?.locationName?.address && <p className="text-xs opacity-75 mt-1">{shop.locationName.address}</p>}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2 text-xs">
          {(shop?.fulfillmentTypes || []).map((f) => {
            const meta = FULFILLMENT_LABELS[f] || { label: f, hint: '', icon: Package };
            const active = fulfillment === f;
            return (
              <button
                key={f}
                onClick={() => setFulfillment(f)}
                title={meta.hint}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-medium transition ${active ? 'bg-white text-ink-900' : 'bg-white/15 hover:bg-white/25'}`}
              >
                <meta.icon size={14} /> {meta.label}
              </button>
            );
          })}
        </div>
      </header>

      {/* Search + category filter */}
      <div className="sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-ink-100 px-4 py-3 space-y-2">
        <div className="relative">
          <Search size={16} className="absolute start-3 top-1/2 -translate-y-1/2 text-ink-300" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search the shop"
            className="w-full rounded-lg border border-ink-200 bg-white py-2 ps-9 pe-3 text-sm outline-none focus:border-ink-400"
          />
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-0.5">
          <FilterPill active={!section} onClick={() => setSection(null)} label={`All (${flatItems.length})`} accent={accent} />
          {(shop?.menu || []).map((s) => (
            <FilterPill key={s.name} active={section === s.name} onClick={() => setSection(s.name)} label={`${s.name} (${s.items.length})`} accent={accent} />
          ))}
        </div>
      </div>

      <main className="p-4 pb-40 space-y-6">
        {message && (
          <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            <AlertCircle size={16} className="mt-0.5 shrink-0" /> {message}
          </div>
        )}

        {visibleSections.map((s) => (
          <section key={s.name}>
            <h2 className="mb-2 font-semibold text-ink-800">{s.name}</h2>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {s.items.map((item) => {
                const qty = cart[item.productId] || 0;
                return (
                  <div key={item.productId} className="flex items-center gap-3 rounded-xl border border-ink-100 bg-white p-3">
                    {item.imageUrl ? (
                      <img src={item.imageUrl} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover" />
                    ) : (
                      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-ink-50 text-ink-300">
                        <Package size={22} />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-ink-900">{item.name}</div>
                      {item.description && <div className="truncate text-xs text-ink-400">{item.description}</div>}
                      <div className="mt-0.5 flex items-center gap-2 text-sm">
                        <span className="font-medium" style={{ color: accent }}>
                          {money(item.price, shop?.currency || 'USD')}
                        </span>
                        {item.stock != null && item.stock <= 5 && (
                          <span className="text-xs text-amber-600">{item.stock > 0 ? `Only ${item.stock} left` : 'Sold out'}</span>
                        )}
                      </div>
                    </div>
                    {item.available ? (
                      <div className="flex items-center gap-1.5">
                        {qty > 0 && (
                          <>
                            <button onClick={() => remove(item.productId)} aria-label={`Remove one ${item.name}`} className="flex h-8 w-8 items-center justify-center rounded-full border border-ink-200 text-ink-600">
                              <Minus size={14} />
                            </button>
                            <span className="w-5 text-center font-medium">{qty}</span>
                          </>
                        )}
                        <button
                          onClick={() => add(item)}
                          aria-label={`Add ${item.name}`}
                          className="flex h-8 w-8 items-center justify-center rounded-full text-white"
                          style={{ backgroundColor: accent }}
                        >
                          <Plus size={14} />
                        </button>
                      </div>
                    ) : (
                      <span className="rounded-full bg-ink-100 px-2 py-1 text-xs text-ink-400">Out of stock</span>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
        {!visibleSections.length && <div className="py-16 text-center text-ink-400">Nothing here matches that search.</div>}
      </main>

      {/* Cart bar */}
      <div className="fixed bottom-0 inset-x-0 z-20 border-t border-ink-100 bg-white/98 backdrop-blur px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {cartOpen && (
          <div className="mx-auto mb-3 max-w-2xl space-y-2 rounded-xl border border-ink-100 bg-white p-3 shadow-luxe-sm max-h-[45vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">Your basket</div>
              <button onClick={() => setCartOpen(false)} aria-label="Close basket" className="text-ink-400 hover:text-ink-700">
                <X size={16} />
              </button>
            </div>
            {lines.map((l) => (
              <div key={l.item.productId} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate">
                  {l.qty} × {l.item.name}
                </span>
                <span className="font-mono">{money(l.total, shop?.currency || 'USD')}</span>
              </div>
            ))}
            {!lines.length && <div className="text-sm text-ink-400">Add something to get going.</div>}

            {lines.length > 0 && (
              <>
                <div className="space-y-1 border-t border-ink-100 pt-2 text-sm">
                  <Row label="Subtotal" value={money(subtotal, shop?.currency || 'USD')} />
                  {shop?.taxRate ? <Row label={`Tax (${shop.taxRate}%)`} value={money(tax, shop?.currency || 'USD')} /> : null}
                  {deliveryFee > 0 ? <Row label="Delivery" value={money(deliveryFee, shop?.currency || 'USD')} /> : null}
                  <div className="flex justify-between font-semibold">
                    <span>Total</span>
                    <span className="font-mono">{money(total, shop?.currency || 'USD')}</span>
                  </div>
                </div>

                {(fulfillment === 'DELIVERY' || fulfillment === 'SHIP') && (
                  <div className="grid grid-cols-2 gap-2 border-t border-ink-100 pt-2">
                    <Field placeholder="Full name" value={address.recipientName} onChange={(v) => setAddress({ ...address, recipientName: v })} />
                    <Field placeholder="Phone" value={address.phoneNumber} onChange={(v) => setAddress({ ...address, phoneNumber: v })} />
                    <Field className="col-span-2" placeholder="Street address" value={address.addressLine1} onChange={(v) => setAddress({ ...address, addressLine1: v })} />
                    <Field className="col-span-2" placeholder="Apartment, suite (optional)" value={address.addressLine2} onChange={(v) => setAddress({ ...address, addressLine2: v })} />
                    <Field placeholder="City" value={address.city} onChange={(v) => setAddress({ ...address, city: v })} />
                    <Field placeholder="Postal code" value={address.postalCode} onChange={(v) => setAddress({ ...address, postalCode: v })} />
                    <Field className="col-span-2" placeholder="Country" value={address.country} onChange={(v) => setAddress({ ...address, country: v })} />
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2 border-t border-ink-100 pt-2">
                  <Field placeholder="Your name" value={contact.name} onChange={(v) => setContact({ ...contact, name: v })} />
                  <Field placeholder="Email for updates" value={contact.email} onChange={(v) => setContact({ ...contact, email: v })} />
                  <Field className="col-span-2" placeholder="Phone" value={contact.phone} onChange={(v) => setContact({ ...contact, phone: v })} />
                </div>

                {shop?.pickupSlots?.length ? (
                  <label className="block border-t border-ink-100 pt-2 text-sm">
                    <span className="mb-1 flex items-center gap-1.5 text-ink-500">
                      <Clock size={14} /> Preferred slot
                    </span>
                    <select value={slot} onChange={(e) => setSlot(e.target.value)} className="w-full rounded-lg border border-ink-200 px-3 py-2">
                      <option value="">Any time during opening hours</option>
                      {shop.pickupSlots.map((d) =>
                        d.slots.map((s) => (
                          <option key={`${d.day}-${s}`} value={`${d.day} ${s}`}>
                            {d.day} {s}
                          </option>
                        ))
                      )}
                    </select>
                  </label>
                ) : null}

                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Notes for the shop (optional)"
                  rows={2}
                  className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm"
                />
              </>
            )}
          </div>
        )}

        <button
          onClick={() => (cartOpen ? setCartOpen(false) : setCartOpen(true))}
          disabled={!count}
          className="flex w-full items-center justify-center gap-2 rounded-lg py-3 font-medium text-white disabled:opacity-40"
          style={{ backgroundColor: accent }}
        >
          <ShoppingBag size={16} />
          {count ? `${count} item${count > 1 ? 's' : ''} · ${money(total, shop?.currency || 'USD')}` : 'Your basket is empty'}
          {count > 0 && <span className="text-xs opacity-80">{cartOpen ? '(close)' : '(open)'}</span>}
        </button>
        {belowMinimum && count > 0 && (
          <p className="mt-1.5 text-center text-xs text-amber-600">
            Minimum order is {money(shop?.minOrderAmount || 0, shop?.currency || 'USD')}
          </p>
        )}
        {count > 0 && !belowMinimum && (
          <button
            onClick={submit}
            disabled={state === 'submitting'}
            className="mt-2 w-full rounded-lg border-2 py-2.5 text-sm font-semibold disabled:opacity-60"
            style={{ borderColor: accent, color: accent }}
          >
            {state === 'submitting' ? 'Placing your order…' : shop?.payOnPickup ? 'Place order · pay at pickup' : 'Place order'}
          </button>
        )}
      </div>
    </Shell>
  );
}

function StatusView({ slug, token, accent, shopName }: { slug: string; token: string; accent: string; shopName: string }) {
  const [order, setOrder] = useState<any>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api
      .getStorefrontOrderStatus(slug, token)
      .then((res) => setOrder(res.data))
      .catch((e: any) => setError(e?.message || 'We could not find that order.'));
  }, [slug, token]);

  const steps = ['CONFIRMED', 'PROCESSING', 'READY', 'COMPLETED'];
  const current = steps.indexOf(order?.status);

  if (error) {
    return (
      <Shell accent={accent}>
        <div className="py-24 text-center text-sm text-rose-600">{error}</div>
      </Shell>
    );
  }
  if (!order) {
    return (
      <Shell accent={accent}>
        <div className="py-24 text-center text-ink-400">Checking your order…</div>
      </Shell>
    );
  }
  return (
    <Shell accent={accent}>
      <header className="px-5 py-6 text-white" style={{ backgroundColor: accent }}>
        <div className="text-sm opacity-80">{shopName}</div>
        <h1 className="font-display text-2xl">Order {order.orderNumber}</h1>
      </header>
      <div className="space-y-5 p-5">
        <ol className="space-y-3">
          {steps.map((s, i) => (
            <li key={s} className="flex items-center gap-3 text-sm">
              <span
                className="flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold"
                style={{ backgroundColor: i <= current ? accent : '#e5e7eb', color: i <= current ? '#fff' : '#6b7280' }}
              >
                {i < current ? '✓' : i + 1}
              </span>
              <span className={i <= current ? 'font-medium text-ink-900' : 'text-ink-400'}>{s.charAt(0) + s.slice(1).toLowerCase()}</span>
            </li>
          ))}
        </ol>
        <div className="rounded-xl border border-ink-100 bg-white p-4">
          {order.items.map((i: any, idx: number) => (
            <div key={idx} className="flex justify-between py-0.5 text-sm">
              <span>
                {i.quantity} × {i.name}
              </span>
              <span className="font-mono">{money(i.totalAmount, order.currency)}</span>
            </div>
          ))}
          <div className="mt-2 flex justify-between border-t pt-2 font-semibold">
            <span>Total</span>
            <span className="font-mono">{money(order.totalAmount, order.currency)}</span>
          </div>
        </div>
        {order.note && <p className="text-sm text-ink-500">{order.note}</p>}
      </div>
    </Shell>
  );
}

function Shell({ children, accent }: { children: React.ReactNode; accent: string }) {
  return (
    <div className="min-h-screen bg-ink-50">
      <div className="mx-auto max-w-3xl bg-white shadow-luxe">{children}</div>
      <p className="mx-auto max-w-3xl py-4 text-center text-xs text-ink-400">
        Powered by <span style={{ color: accent }}>UnifiedPOS</span>
      </p>
    </div>
  );
}

function FilterPill({ label, active, onClick, accent }: { label: string; active: boolean; onClick: () => void; accent: string }) {
  return (
    <button
      onClick={onClick}
      className="shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition"
      style={active ? { backgroundColor: accent, borderColor: accent, color: '#fff' } : { borderColor: '#e5e7eb', color: '#4b5563' }}
    >
      {label}
    </button>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-ink-600">
      <span>{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}

function Field({ placeholder, value, onChange, className = '' }: { placeholder: string; value: string; onChange: (v: string) => void; className?: string }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-ink-400 ${className}`}
    />
  );
}

function round2(value: number) {
  return Math.round((Number(value) || 0) * 100) / 100;
}
