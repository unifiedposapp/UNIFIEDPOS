import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { useRealtime } from '../hooks/useRealtime';
import {
  Package,
  Plus,
  Trash2,
  Send,
  PackageCheck,
  Ban,
  X,
  RefreshCw,
  Bot,
  ChevronDown,
  ChevronUp,
  Truck,
} from 'lucide-react';

// ─── Purchasing ──────────────────────────────────────────────────────────────
// Purchase orders are real documents now: a supplier, a destination location,
// priced lines, and a lifecycle (DRAFT → SENT → PARTIAL → RECEIVED, or
// CANCELLED). Sending mails the lines to the supplier when a mail provider is
// wired; receiving is what raises stock and posts the expense, so the ledger
// never books goods that have not arrived. Orders the buying agent drafted from
// a replenishment run carry a provenance marker and land here like any other.

const STATUS_TONES: Record<string, string> = {
  DRAFT: 'bg-ink-100 text-ink-600',
  SENT: 'bg-sky-100 text-sky-700',
  PARTIAL: 'bg-amber-100 text-amber-700',
  RECEIVED: 'bg-emerald-100 text-emerald-700',
  CANCELLED: 'bg-rose-100 text-rose-600',
};

interface Line {
  id?: string;
  productId: string;
  quantity: string;
  unitCost: string;
  receivedQty?: number;
  productName?: string;
}

const blankOrder = {
  supplierId: '',
  locationId: '',
  expectedDate: '',
  notes: '',
};

export default function PurchasingPage() {
  const [orders, setOrders] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [supplierFilter, setSupplierFilter] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [receiving, setReceiving] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  // Draft editor
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [head, setHead] = useState<any>(blankOrder);
  const [lines, setLines] = useState<Line[]>([{ productId: '', quantity: '1', unitCost: '0' }]);

  const load = useCallback(async () => {
    const query: Record<string, string> = {};
    if (statusFilter) query.status = statusFilter;
    if (supplierFilter) query.supplierId = supplierFilter;
    const [poRes, supRes, prodRes, locRes, sumRes] = await Promise.all([
      api.getPurchaseOrders(Object.keys(query).length ? query : undefined),
      api.getSuppliers(),
      api.getProducts(),
      api.getLocations(),
      api.getPurchaseOrderSummary(),
    ]);
    setOrders(poRes.data || []);
    setSuppliers(supRes.data || []);
    setProducts(prodRes.data || []);
    setLocations(locRes.data || []);
    setSummary(sumRes.data);
  }, [statusFilter, supplierFilter]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, supplierFilter]);
  // Receiving in another terminal should repaint this screen.
  useRealtime(() => {
    load();
  });

  const productsById = useMemo(() => new Map(products.map((p: any) => [p.id, p])), [products]);

  const openNew = () => {
    setEditingId(null);
    setHead({ ...blankOrder, locationId: locations[0]?.id || '' });
    setLines([{ productId: '', quantity: '1', unitCost: '0' }]);
    setShowForm(true);
    setNotice('');
  };

  const openEdit = (po: any) => {
    setEditingId(po.id);
    setHead({
      supplierId: po.supplierId,
      locationId: po.locationId || '',
      expectedDate: po.expectedDate ? new Date(po.expectedDate).toISOString().slice(0, 10) : '',
      notes: po.notes || '',
    });
    setLines(po.items.map((i: any) => ({ productId: i.productId, quantity: String(i.quantity), unitCost: String(i.unitCost), receivedQty: i.receivedQty })));
    setShowForm(true);
    setNotice('');
  };

  const setLine = (idx: number, patch: Partial<Line>) =>
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));

  const pickProduct = (idx: number, productId: string) => {
    const product: any = productsById.get(productId);
    // Cost defaults to the last thing the supplier charged, not the retail price.
    setLine(idx, {
      productId,
      unitCost: product ? String(product.costPrice ?? product.price ?? 0) : '0',
    });
  };

  const draftTotal = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unitCost) || 0), 0);
  const validLines = lines.filter((l) => l.productId && Number(l.quantity) > 0);

  const save = async (andSend = false) => {
    if (!head.supplierId) {
      setNotice('Choose a supplier first.');
      return;
    }
    if (!validLines.length) {
      setNotice('Add at least one priced line.');
      return;
    }
    setBusy(true);
    setNotice('');
    const payload = {
      supplierId: head.supplierId,
      locationId: head.locationId || null,
      expectedDate: head.expectedDate || null,
      notes: head.notes || undefined,
      items: validLines.map((l) => ({ productId: l.productId, quantity: Number(l.quantity), unitCost: Number(l.unitCost) })),
    };
    try {
      let id = editingId;
      if (editingId) await api.updatePurchaseOrder(editingId, payload);
      else id = (await api.createPurchaseOrder(payload)).data?.id ?? null;
      if (andSend && id) {
        const sent = await api.sendPurchaseOrder(id);
        setNotice(
          sent.data?.emailed
            ? `Order sent and emailed to ${sent.data.supplierEmail}.`
            : 'Order sent. No mail provider is configured, so email the supplier yourself from the order lines.'
        );
      } else {
        setNotice(editingId ? 'Draft updated.' : 'Purchase order drafted.');
      }
      setShowForm(false);
      setEditingId(null);
      await load();
    } catch (e: any) {
      setNotice(e?.message || 'Could not save the order.');
    } finally {
      setBusy(false);
    }
  };

  const send = async (po: any) => {
    if (!confirm(`Send ${po.id.slice(0, 8)} to ${po.supplierName}? The supplier is emailed when mail is configured.`)) return;
    setBusy(true);
    try {
      const res = await api.sendPurchaseOrder(po.id);
      await load();
      setNotice(
        res.data?.emailed
          ? `Order sent and emailed to ${res.data.supplierEmail}.`
          : `Order marked sent. ${res.data?.supplierEmail ? `No mail provider is configured, so nothing was emailed to ${res.data.supplierEmail} — send it from your own inbox.` : 'This supplier has no email on file.'}`
      );
    } catch (e: any) {
      setNotice(e?.message || 'Could not send the order.');
    } finally {
      setBusy(false);
    }
  };

  const receive = async (po: any, items: { productId: string; quantity: number }[]) => {
    setBusy(true);
    setNotice('');
    try {
      const res = await api.receivePurchaseOrder(po.id, items);
      setReceiving(null);
      await load();
      setNotice(`Received ${res.data?.receivedLines} line(s) into stock — status ${res.data?.status}, expense posted to the ledger.`);
    } catch (e: any) {
      setNotice(e?.message || 'Could not receive the order.');
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (po: any) => {
    const reason = window.prompt(`Cancel ${po.id.slice(0, 8)}? Reason (optional):`);
    if (reason === null) return;
    setBusy(true);
    try {
      await api.cancelPurchaseOrder(po.id);
      await load();
      setNotice('Order cancelled.');
    } catch (e: any) {
      setNotice(e?.message || 'Could not cancel the order.');
    } finally {
      setBusy(false);
    }
  };

  const removePo = async (po: any) => {
    if (!confirm('Delete this draft?')) return;
    await api.deletePurchaseOrder(po.id);
    load();
  };

  return (
    <div className="space-y-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 font-display text-2xl font-semibold text-ink-900">
            <Package size={22} className="text-gold-500" /> Purchasing
          </h1>
          <p className="text-sm text-ink-400">Raise orders, send them to the supplier, and receive the goods into stock.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200 px-3 py-2 text-sm text-ink-600 hover:bg-ink-50">
            <RefreshCw size={15} /> Refresh
          </button>
          <button onClick={openNew} className="inline-flex items-center gap-1.5 rounded-lg bg-ink-900 px-4 py-2 text-sm font-medium text-white hover:bg-ink-800">
            <Plus size={16} /> New purchase order
          </button>
        </div>
      </header>

      {summary && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Stat label="Drafts" value={summary.draftOrders} />
          <Stat label="Awaiting delivery" value={summary.awaitingDelivery} />
          <Stat label="Received this month" value={summary.receivedThisMonth} />
          <Stat label="Spend this month" value={money(summary.spendThisMonth)} />
          <Stat label="Active suppliers" value={summary.activeSuppliers} />
        </div>
      )}

      {notice && <div className="rounded-lg border border-gold-200 bg-gold-50 px-3 py-2 text-sm text-ink-700">{notice}</div>}

      {showForm && (
        <div className="space-y-4 rounded-xl border border-ink-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-ink-900">{editingId ? 'Edit draft order' : 'New purchase order'}</h2>
            <button
              onClick={() => {
                setShowForm(false);
                setEditingId(null);
              }}
              className="rounded-lg border border-ink-200 p-1.5 text-ink-500 hover:bg-ink-50"
            >
              <X size={15} />
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Supplier">
              <select value={head.supplierId} onChange={(e) => setHead({ ...head, supplierId: e.target.value })} className={inputCls}>
                <option value="">Select supplier…</option>
                {suppliers.map((s: any) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.email ? '' : ' (no email)'}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Deliver to">
              <select value={head.locationId} onChange={(e) => setHead({ ...head, locationId: e.target.value })} className={inputCls}>
                <option value="">Main location</option>
                {locations.map((l: any) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Expected by">
              <input type="date" value={head.expectedDate} onChange={(e) => setHead({ ...head, expectedDate: e.target.value })} className={inputCls} />
            </Field>
            <Field label="Notes for the supplier">
              <input value={head.notes} onChange={(e) => setHead({ ...head, notes: e.target.value })} placeholder="Dock access after 10am" className={inputCls} />
            </Field>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-medium uppercase tracking-wide text-ink-400">Lines</div>
            {lines.map((line, idx) => (
              <div key={idx} className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[1fr_88px_110px_100px_32px]">
                <select value={line.productId} onChange={(e) => pickProduct(idx, e.target.value)} className={inputCls}>
                  <option value="">Select product…</option>
                  {products.map((p: any) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.sku ? ` · ${p.sku}` : ''}
                    </option>
                  ))}
                </select>
                <input type="number" min="1" value={line.quantity} onChange={(e) => setLine(idx, { quantity: e.target.value })} placeholder="Qty" className={inputCls} />
                <input type="number" min="0" step="0.01" value={line.unitCost} onChange={(e) => setLine(idx, { unitCost: e.target.value })} placeholder="Unit cost" className={inputCls} />
                <span className="text-end font-mono text-sm text-ink-700">{money((Number(line.quantity) || 0) * (Number(line.unitCost) || 0))}</span>
                <button
                  onClick={() => setLines((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev))}
                  className="justify-self-end rounded-lg border border-ink-200 p-1.5 text-ink-400 hover:bg-rose-50 hover:text-rose-600"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            <button onClick={() => setLines((prev) => [...prev, { productId: '', quantity: '1', unitCost: '0' }])} className="text-sm text-teal-700 hover:underline">
              + Add line
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-100 pt-3">
            <div className="font-display text-lg font-semibold text-ink-900">Total {money(draftTotal)}</div>
            <div className="flex gap-2">
              <button onClick={() => save()} disabled={busy} className="rounded-lg border border-ink-200 px-4 py-2 text-sm text-ink-700 hover:bg-ink-50 disabled:opacity-50">
                {editingId ? 'Save draft' : 'Save as draft'}
              </button>
              <button onClick={() => save(true)} disabled={busy || !head.supplierId || !validLines.length} className="inline-flex items-center gap-1.5 rounded-lg bg-gold-500 px-4 py-2 text-sm font-medium text-ink-950 hover:bg-gold-400 disabled:opacity-50">
                <Send size={14} /> Create and send
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Filters + list */}
      <div className="flex flex-wrap items-center gap-2">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-auto rounded-lg border border-ink-200 px-2 py-1.5 text-sm">
          <option value="">All statuses</option>
          {['DRAFT', 'SENT', 'PARTIAL', 'RECEIVED', 'CANCELLED'].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select value={supplierFilter} onChange={(e) => setSupplierFilter(e.target.value)} className="w-auto rounded-lg border border-ink-200 px-2 py-1.5 text-sm">
          <option value="">All suppliers</option>
          {suppliers.map((s: any) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <span className="text-xs text-ink-400">{orders.length} order(s)</span>
      </div>

      <div className="space-y-3">
        {orders.map((po) => {
          const open = expanded === po.id;
          const receiveOpen = receiving === po.id;
          return (
            <div key={po.id} className="rounded-xl border border-ink-100 bg-white shadow-luxe-sm">
              <div className="flex flex-wrap items-start justify-between gap-3 p-4">
                <div className="min-w-0">
                  <button onClick={() => setExpanded(open ? null : po.id)} className="flex items-center gap-1.5 font-semibold text-ink-900 hover:underline">
                    {open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                    {po.supplierName || 'Supplier'}
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_TONES[po.status] || 'bg-ink-100 text-ink-600'}`}>{po.status}</span>
                  </button>
                  <div className="mt-1 text-xs text-ink-500">
                    {new Date(po.orderDate || po.createdAt).toLocaleDateString()} · {po.items?.length ?? 0} line(s)
                    {po.expectedDate ? ` · due ${new Date(po.expectedDate).toLocaleDateString()}` : ''}
                    {po.receivedDate ? ` · received ${new Date(po.receivedDate).toLocaleDateString()}` : ''}
                    {po.supplierEmail ? ` · ${po.supplierEmail}` : ' · no supplier email'}
                  </div>
                  {po.replenishmentRunId && (
                    <div className="mt-1 inline-flex items-center gap-1 rounded bg-violet-50 px-1.5 py-0.5 text-[11px] text-violet-700">
                      <Bot size={11} /> Raised by the buying agent
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-end">
                    <div className="font-mono text-lg font-semibold text-ink-900">{money(Number(po.totalAmount))}</div>
                    <div className="text-[11px] text-ink-400">{po.id.slice(0, 8)}</div>
                  </div>
                  {po.status === 'DRAFT' && (
                    <>
                      <button onClick={() => openEdit(po)} className="rounded-lg border border-ink-200 px-3 py-1.5 text-xs text-ink-700 hover:bg-ink-50">
                        Edit
                      </button>
                      <button onClick={() => send(po)} disabled={busy} className="inline-flex items-center gap-1 rounded-lg bg-ink-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-ink-800 disabled:opacity-50">
                        <Send size={12} /> Send
                      </button>
                      <button onClick={() => removePo(po)} className="rounded-lg border border-rose-200 p-1.5 text-rose-600 hover:bg-rose-50">
                        <Trash2 size={13} />
                      </button>
                    </>
                  )}
                  {(po.status === 'SENT' || po.status === 'PARTIAL' || po.status === 'DRAFT') && (
                    <button
                      onClick={() => setReceiving(receiveOpen ? null : po.id)}
                      className="inline-flex items-center gap-1 rounded-lg bg-gold-500 px-3 py-1.5 text-xs font-medium text-ink-950 hover:bg-gold-400"
                    >
                      <PackageCheck size={12} /> {receiveOpen ? 'Close receiving' : 'Receive'}
                    </button>
                  )}
                  {po.status !== 'RECEIVED' && po.status !== 'CANCELLED' && (
                    <button onClick={() => cancel(po)} className="inline-flex items-center gap-1 rounded-lg border border-ink-200 px-3 py-1.5 text-xs text-ink-600 hover:bg-ink-50">
                      <Ban size={12} /> Cancel
                    </button>
                  )}
                </div>
              </div>

              {po.notes && !open && <div className="px-4 pb-3 text-xs italic text-ink-400">{truncate(po.notes)}</div>}

              {open && (
                <div className="border-t border-ink-100 px-4 py-3">
                  <table className="w-full text-sm">
                    <thead className="text-[11px] uppercase tracking-wide text-ink-400">
                      <tr>
                        <th className="py-1 text-start font-medium">Product</th>
                        <th className="py-1 text-end font-medium">Ordered</th>
                        <th className="py-1 text-end font-medium">Received</th>
                        <th className="py-1 text-end font-medium">Unit cost</th>
                        <th className="py-1 text-end font-medium">Line total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(po.items || []).map((item: any) => (
                        <tr key={item.id} className="border-t border-ink-50">
                          <td className="py-1.5">
                            <div className="text-ink-900">{item.productName}</div>
                            {item.sku && <div className="text-[11px] text-ink-400">{item.sku}</div>}
                          </td>
                          <td className="py-1.5 text-end font-mono">{item.quantity}</td>
                          <td className={`py-1.5 text-end font-mono ${item.receivedQty < item.quantity ? 'text-amber-600' : 'text-emerald-600'}`}>{item.receivedQty}</td>
                          <td className="py-1.5 text-end font-mono">{money(Number(item.unitCost))}</td>
                          <td className="py-1.5 text-end font-mono">{money(Number(item.lineTotal))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {po.notes && <div className="mt-2 text-xs text-ink-500">Notes: {po.notes}</div>}
                </div>
              )}

              {receiveOpen && (
                <ReceivingPanel
                  po={po}
                  busy={busy}
                  onSubmit={(quantities) => {
                    const items = Object.entries(quantities)
                      .filter(([, qty]) => qty > 0)
                      .map(([productId, quantity]) => ({ productId, quantity }));
                    return receive(po, items);
                  }}
                  onReceiveAll={() => receive(po, [])}
                />
              )}
            </div>
          );
        })}
        {!orders.length && (
          <div className="rounded-xl border border-dashed border-ink-200 p-10 text-center text-sm text-ink-400">
            No purchase orders yet — draft one above, or approve a replenishment suggestion under Insights to have the buying agent write it for you.
          </div>
        )}
      </div>
    </div>
  );
}

/** Partial-receiving form: default every line to what is still outstanding. */
function ReceivingPanel({
  po,
  busy,
  onSubmit,
  onReceiveAll,
}: {
  po: any;
  busy: boolean;
  onSubmit: (quantities: Record<string, number>) => void;
  onReceiveAll: () => void;
}) {
  const outstanding = (po.items || []).map((i: any) => ({ productId: i.productId, name: i.productName, left: i.quantity - i.receivedQty, id: i.id }));
  const [quantities, setQuantities] = useState<Record<string, string>>(() => Object.fromEntries(outstanding.map((o: any) => [o.productId, String(o.left)])));

  return (
    <div className="border-t border-ink-100 bg-ink-50/60 p-4">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-ink-500">
        <Truck size={13} /> What actually arrived
      </div>
      <div className="space-y-2">
        {outstanding.map((item: any) => (
          <div key={item.id} className="grid grid-cols-[1fr_110px] items-center gap-2">
            <span className="truncate text-sm text-ink-700">
              {item.name} <span className="text-xs text-ink-400">· {item.left} outstanding</span>
            </span>
            <input
              type="number"
              min="0"
              max={item.left}
              value={quantities[item.productId] ?? '0'}
              onChange={(e) => setQuantities({ ...quantities, [item.productId]: e.target.value })}
              className={inputCls}
            />
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={() => onSubmit(Object.fromEntries(Object.entries(quantities).map(([k, v]) => [k, Math.max(0, Number(v) || 0)])))}
          disabled={busy}
          className="rounded-lg bg-gold-500 px-4 py-2 text-sm font-medium text-ink-950 hover:bg-gold-400 disabled:opacity-50"
        >
          Receive these quantities
        </button>
        <button onClick={onReceiveAll} disabled={busy} className="rounded-lg border border-ink-200 bg-white px-4 py-2 text-sm text-ink-700 hover:bg-ink-50 disabled:opacity-50">
          Receive everything in full
        </button>
      </div>
      <p className="mt-2 text-[11px] text-ink-400">Stock rises and the expense posts only for what you confirm here; a part-delivery leaves the order PARTIAL and keeps the balance open.</p>
    </div>
  );
}

const inputCls = 'w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-ink-400';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-ink-400">{label}</span>
      {children}
    </label>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-ink-100 bg-white p-3">
      <div className="text-[11px] uppercase tracking-wide text-ink-400">{label}</div>
      <div className="font-display text-xl font-semibold text-ink-900">{value}</div>
    </div>
  );
}

function truncate(text: string, max = 120) {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function money(value: number, currency = 'USD') {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(Number(value) || 0);
  } catch {
    return `$${(Number(value) || 0).toFixed(2)}`;
  }
}
