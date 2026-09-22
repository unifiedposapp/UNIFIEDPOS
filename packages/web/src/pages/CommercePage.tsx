import { useEffect, useState, useCallback } from 'react';
import { api } from '../api/client';
import {
  Globe, Store, ShoppingCart, PackageCheck, MapPin, Truck, Link2, Boxes,
  Plus, RefreshCw, Play, CheckCircle2, X,
} from 'lucide-react';

type Tab = 'overview' | 'channels' | 'orders' | 'fulfillment' | 'pickup' | 'delivery' | 'marketplace' | 'inventory';

const STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-yellow-100 text-yellow-800',
  PREPARING: 'bg-amber-100 text-amber-800',
  READY: 'bg-blue-100 text-blue-800',
  OUT_FOR_DELIVERY: 'bg-indigo-100 text-indigo-800',
  SHIPPED: 'bg-indigo-100 text-indigo-800',
  DELIVERED: 'bg-green-100 text-green-800',
  COMPLETED: 'bg-green-100 text-green-800',
  CANCELLED: 'bg-red-100 text-red-800',
  FAILED: 'bg-red-100 text-red-800',
  CONFIRMED: 'bg-blue-100 text-blue-800',
  PAID: 'bg-green-100 text-green-800',
  FULFILLED: 'bg-green-100 text-green-800',
  CONNECTED: 'bg-green-100 text-green-800',
  DISCONNECTED: 'bg-gray-100 text-gray-800',
  ACTIVE: 'bg-green-100 text-green-800',
  INACTIVE: 'bg-gray-100 text-gray-800',
};

const CHANNELS = ['WEBSITE', 'MOBILE_APP', 'SOCIAL', 'MARKETPLACE', 'PHONE', 'POP_UP'];
const FULFILLMENT_TYPES = ['PICKUP', 'CURBSIDE', 'DELIVERY', 'SHIP'];

const badge = (s: string) => (
  <span className={`text-xs px-2 py-1 rounded ${STATUS_COLORS[s] || 'bg-gray-100 text-gray-800'}`}>{s}</span>
);
const money = (n: any) => `$${Number(n || 0).toFixed(2)}`;

export default function CommercePage() {
  const [tab, setTab] = useState<Tab>('overview');
  const [overview, setOverview] = useState<any>(null);
  const [channels, setChannels] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [fulfillments, setFulfillments] = useState<any[]>([]);
  const [pickups, setPickups] = useState<any[]>([]);
  const [deliveries, setDeliveries] = useState<any[]>([]);
  const [zones, setZones] = useState<any[]>([]);
  const [integrations, setIntegrations] = useState<any[]>([]);
  const [inventory, setInventory] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Forms
  const [showChannelForm, setShowChannelForm] = useState(false);
  const [channelForm, setChannelForm] = useState({ key: 'WEBSITE', name: '', channelType: 'ONLINE', platform: '', url: '' });
  const [showOrderForm, setShowOrderForm] = useState(false);
  const [orderForm, setOrderForm] = useState<any>({ channel: 'WEBSITE', fulfillmentType: 'PICKUP', customerId: '', scheduledAt: '', recipientName: '', addressLine1: '', city: '', state: '', postalCode: '', phoneNumber: '' });
  const [orderLines, setOrderLines] = useState<any[]>([]);
  const [lineProduct, setLineProduct] = useState('');
  const [lineQty, setLineQty] = useState('1');
  const [showZoneForm, setShowZoneForm] = useState(false);
  const [zoneForm, setZoneForm] = useState<any>({ name: '', radiusMiles: '5', baseFee: '5', perMileFee: '1', minOrder: '0', maxDistance: '10' });
  const [showIntegrationForm, setShowIntegrationForm] = useState(false);
  const [integrationForm, setIntegrationForm] = useState({ provider: 'shopify', type: 'ECOMMERCE', name: '' });

  const guard = useCallback(async (fn: () => Promise<void>) => {
    try { setError(null); await fn(); } catch (e: any) { setError(e.message || 'Request failed'); }
  }, []);

  const loadTab = useCallback(async (t: Tab) => {
    await guard(async () => {
      if (t === 'overview') setOverview((await api.getCommerceOverview()).data);
      if (t === 'channels') setChannels((await api.getSalesChannels()).data || []);
      if (t === 'orders') {
        setOrders((await api.getCommerceOrders()).data || []);
        if (products.length === 0) setProducts((await api.getProducts()).data?.items || []);
        if (customers.length === 0) setCustomers((await api.getCustomers()).data?.items || []);
      }
      if (t === 'fulfillment') setFulfillments((await api.getFulfillmentQueue()).data || []);
      if (t === 'pickup') setPickups((await api.getPickupOrders()).data || []);
      if (t === 'delivery') {
        setDeliveries((await api.getDeliveries()).data || []);
        setZones((await api.getDeliveryZones()).data || []);
      }
      if (t === 'marketplace') setIntegrations((await api.getCommerceIntegrations()).data || []);
      if (t === 'inventory') {
        setInventory((await api.getOmnichannelInventory()).data || []);
        if (products.length === 0) setProducts((await api.getProducts()).data?.items || []);
      }
    });
  }, [guard, products.length, customers.length]);

  useEffect(() => { loadTab(tab); }, [tab, loadTab]);

  // ── Actions ────────────────────────────────────────────────
  const createChannel = () => guard(async () => {
    await api.createSalesChannel({ ...channelForm, platform: channelForm.platform || undefined, url: channelForm.url || undefined });
    setShowChannelForm(false); setChannelForm({ key: 'WEBSITE', name: '', channelType: 'ONLINE', platform: '', url: '' }); loadTab('channels');
  });
  const toggleChannel = (c: any) => guard(async () => { await api.updateSalesChannel(c.id, { isActive: !c.isActive }); loadTab('channels'); });
  const removeChannel = (id: string) => guard(async () => { if (confirm('Delete this channel?')) { await api.deleteSalesChannel(id); loadTab('channels'); } });

  const addLine = () => {
    if (!lineProduct) return;
    const p = products.find((x) => x.id === lineProduct);
    setOrderLines([...orderLines, { productId: lineProduct, name: p?.name || '', quantity: Number(lineQty) || 1, unitPrice: Number(p?.price || 0) }]);
    setLineProduct(''); setLineQty('1');
  };
  const submitOrder = () => guard(async () => {
    if (orderLines.length === 0) { setError('Add at least one item'); return; }
    const payload: any = {
      channel: orderForm.channel,
      fulfillmentType: orderForm.fulfillmentType,
      customerId: orderForm.customerId || undefined,
      scheduledAt: orderForm.scheduledAt || undefined,
      items: orderLines.map((l) => ({ productId: l.productId, quantity: l.quantity, unitPrice: l.unitPrice })),
    };
    if (orderForm.fulfillmentType === 'DELIVERY' || orderForm.fulfillmentType === 'SHIP') {
      payload.delivery = {
        recipientName: orderForm.recipientName || undefined,
        addressLine1: orderForm.addressLine1 || undefined,
        city: orderForm.city || undefined,
        state: orderForm.state || undefined,
        postalCode: orderForm.postalCode || undefined,
        phoneNumber: orderForm.phoneNumber || undefined,
      };
    }
    await api.createOnlineOrder(payload);
    setShowOrderForm(false); setOrderLines([]);
    setOrderForm({ channel: 'WEBSITE', fulfillmentType: 'PICKUP', customerId: '', scheduledAt: '', recipientName: '', addressLine1: '', city: '', state: '', postalCode: '', phoneNumber: '' });
    loadTab('orders');
  });
  const cancelOrder = (id: string) => guard(async () => { if (confirm('Cancel this order?')) { await api.cancelCommerceOrder(id); loadTab('orders'); } });

  const advance = (id: string, status: string) => guard(async () => { await api.setFulfillmentStatus(id, status); loadTab('fulfillment'); });
  const pickupReady = (id: string) => guard(async () => { await api.markPickupReady(id); loadTab('pickup'); });
  const pickupComplete = (id: string) => guard(async () => { await api.markPickupComplete(id); loadTab('pickup'); });

  const createZone = () => guard(async () => {
    await api.createDeliveryZone({ name: zoneForm.name, radiusMiles: Number(zoneForm.radiusMiles), baseFee: Number(zoneForm.baseFee), perMileFee: Number(zoneForm.perMileFee), minOrder: Number(zoneForm.minOrder), maxDistance: Number(zoneForm.maxDistance) });
    setShowZoneForm(false); setZoneForm({ name: '', radiusMiles: '5', baseFee: '5', perMileFee: '1', minOrder: '0', maxDistance: '10' }); loadTab('delivery');
  });
  const removeZone = (id: string) => guard(async () => { if (confirm('Delete this zone?')) { await api.deleteDeliveryZone(id); loadTab('delivery'); } });
  const dispatch = (id: string) => guard(async () => { const courier = prompt('Courier / driver name?') || undefined; await api.dispatchDelivery(id, { courier }); loadTab('delivery'); });
  const delivered = (id: string) => guard(async () => { await api.markDelivered(id); loadTab('delivery'); });

  const connectIntegration = () => guard(async () => {
    await api.connectIntegration({ ...integrationForm, name: integrationForm.name || integrationForm.provider });
    setShowIntegrationForm(false); setIntegrationForm({ provider: 'shopify', type: 'ECOMMERCE', name: '' }); loadTab('marketplace');
  });
  const syncIntegration = (id: string) => guard(async () => { await api.syncIntegration(id); loadTab('marketplace'); });
  const disconnect = (id: string) => guard(async () => { if (confirm('Disconnect this integration?')) { await api.disconnectIntegration(id); loadTab('marketplace'); } });

  const tabs = [
    { id: 'overview' as Tab, label: 'Overview', icon: Globe },
    { id: 'channels' as Tab, label: 'Channels', icon: Store, count: channels.length },
    { id: 'orders' as Tab, label: 'Online Orders', icon: ShoppingCart, count: orders.length },
    { id: 'fulfillment' as Tab, label: 'Fulfillment', icon: PackageCheck, count: fulfillments.length },
    { id: 'pickup' as Tab, label: 'Pickup', icon: MapPin, count: pickups.length },
    { id: 'delivery' as Tab, label: 'Delivery', icon: Truck, count: deliveries.length },
    { id: 'marketplace' as Tab, label: 'Marketplace', icon: Link2, count: integrations.length },
    { id: 'inventory' as Tab, label: 'Omnichannel Stock', icon: Boxes, count: inventory.length },
  ];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Commerce Hub</h1>
        <p className="text-gray-500">Omnichannel sales, online ordering, pickup, delivery, marketplace & unified inventory (§13)</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg flex items-center justify-between">
          <span className="text-sm">{error}</span>
          <button onClick={() => setError(null)}><X size={16} /></button>
        </div>
      )}

      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit flex-wrap">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm transition-colors ${tab === t.id ? 'bg-white shadow text-blue-700 font-medium' : 'text-gray-600 hover:text-gray-900'}`}>
            <t.icon size={16} />{t.label}
            {t.count !== undefined && <span className="text-xs bg-gray-200 text-gray-700 px-1.5 py-0.5 rounded">{t.count}</span>}
          </button>
        ))}
      </div>

      {/* ── Overview ── */}
      {tab === 'overview' && overview && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {[
              { label: 'Active Channels', value: overview.activeChannels },
              { label: 'Online Orders', value: overview.onlineOrders },
              { label: 'Online Today', value: overview.onlineOrdersToday },
              { label: 'Pending Fulfillment', value: overview.pendingFulfillments },
              { label: 'Active Deliveries', value: overview.activeDeliveries },
              { label: 'Integrations', value: overview.connectedIntegrations },
            ].map((s) => (
              <div key={s.label} className="bg-white rounded-lg border p-4">
                <div className="text-2xl font-bold">{s.value ?? 0}</div>
                <div className="text-xs text-gray-500 mt-1">{s.label}</div>
              </div>
            ))}
          </div>
          <div className="bg-white rounded-lg border">
            <div className="px-4 py-3 border-b font-medium">Revenue by Channel</div>
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr><th className="text-start px-4 py-3 text-sm">Channel</th><th className="text-end px-4 py-3 text-sm">Orders</th><th className="text-end px-4 py-3 text-sm">Revenue</th></tr>
              </thead>
              <tbody>
                {(overview.revenueByChannel || []).map((r: any) => (
                  <tr key={r.channel} className="border-b hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-medium">{r.channel}</td>
                    <td className="px-4 py-3 text-sm text-end">{r.orders}</td>
                    <td className="px-4 py-3 text-sm text-end font-mono">{money(r.revenue)}</td>
                  </tr>
                ))}
                {(!overview.revenueByChannel || overview.revenueByChannel.length === 0) && (
                  <tr><td colSpan={3} className="px-4 py-8 text-center text-gray-500">No completed channel revenue yet</td></tr>)}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Channels ── */}
      {tab === 'channels' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button onClick={() => setShowChannelForm(!showChannelForm)} className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"><Plus size={16} /> New Channel</button>
          </div>
          {showChannelForm && (
            <div className="bg-white rounded-lg border p-4 grid grid-cols-2 md:grid-cols-6 gap-3">
              <select value={channelForm.key} onChange={(e) => setChannelForm({ ...channelForm, key: e.target.value })} className="border rounded px-3 py-2">
                {CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <input placeholder="Display name" value={channelForm.name} onChange={(e) => setChannelForm({ ...channelForm, name: e.target.value })} className="border rounded px-3 py-2" />
              <select value={channelForm.channelType} onChange={(e) => setChannelForm({ ...channelForm, channelType: e.target.value })} className="border rounded px-3 py-2">
                {['ONLINE', 'MARKETPLACE', 'SOCIAL', 'MOBILE', 'IN_STORE'].map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <input placeholder="Platform (shopify…)" value={channelForm.platform} onChange={(e) => setChannelForm({ ...channelForm, platform: e.target.value })} className="border rounded px-3 py-2" />
              <input placeholder="URL" value={channelForm.url} onChange={(e) => setChannelForm({ ...channelForm, url: e.target.value })} className="border rounded px-3 py-2" />
              <button onClick={createChannel} className="bg-blue-600 text-white rounded px-4 py-2 hover:bg-blue-700">Create</button>
            </div>
          )}
          <div className="bg-white rounded-lg border">
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr><th className="text-start px-4 py-3 text-sm">Key</th><th className="text-start px-4 py-3 text-sm">Name</th><th className="text-start px-4 py-3 text-sm">Type</th><th className="text-start px-4 py-3 text-sm">Platform</th><th className="text-start px-4 py-3 text-sm">Status</th><th className="text-end px-4 py-3 text-sm">Actions</th></tr>
              </thead>
              <tbody>
                {channels.map((c) => (
                  <tr key={c.id} className="border-b hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-mono">{c.key}</td>
                    <td className="px-4 py-3 text-sm">{c.name}</td>
                    <td className="px-4 py-3 text-sm">{c.channelType}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{c.platform || '-'}</td>
                    <td className="px-4 py-3">{badge(c.isActive ? 'ACTIVE' : 'INACTIVE')}</td>
                    <td className="px-4 py-3 text-end">
                      <button onClick={() => toggleChannel(c)} className="text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded hover:bg-gray-200 mr-1">{c.isActive ? 'Disable' : 'Enable'}</button>
                      <button onClick={() => removeChannel(c.id)} className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded hover:bg-red-200">Delete</button>
                    </td>
                  </tr>
                ))}
                {channels.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">No sales channels</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Online Orders ── */}
      {tab === 'orders' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button onClick={() => setShowOrderForm(!showOrderForm)} className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700"><Plus size={16} /> New Online Order</button>
          </div>
          {showOrderForm && (
            <div className="bg-white rounded-lg border p-4 space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <select value={orderForm.channel} onChange={(e) => setOrderForm({ ...orderForm, channel: e.target.value })} className="border rounded px-3 py-2">
                  {CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <select value={orderForm.fulfillmentType} onChange={(e) => setOrderForm({ ...orderForm, fulfillmentType: e.target.value })} className="border rounded px-3 py-2">
                  {FULFILLMENT_TYPES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <select value={orderForm.customerId} onChange={(e) => setOrderForm({ ...orderForm, customerId: e.target.value })} className="border rounded px-3 py-2">
                  <option value="">— Customer (optional) —</option>
                  {customers.map((c: any) => <option key={c.id} value={c.id}>{c.name || c.email}</option>)}
                </select>
                <input type="datetime-local" value={orderForm.scheduledAt} onChange={(e) => setOrderForm({ ...orderForm, scheduledAt: e.target.value })} className="border rounded px-3 py-2" />
              </div>
              {(orderForm.fulfillmentType === 'DELIVERY' || orderForm.fulfillmentType === 'SHIP') && (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <input placeholder="Recipient name" value={orderForm.recipientName} onChange={(e) => setOrderForm({ ...orderForm, recipientName: e.target.value })} className="border rounded px-3 py-2" />
                  <input placeholder="Address" value={orderForm.addressLine1} onChange={(e) => setOrderForm({ ...orderForm, addressLine1: e.target.value })} className="border rounded px-3 py-2" />
                  <input placeholder="City" value={orderForm.city} onChange={(e) => setOrderForm({ ...orderForm, city: e.target.value })} className="border rounded px-3 py-2" />
                  <input placeholder="State" value={orderForm.state} onChange={(e) => setOrderForm({ ...orderForm, state: e.target.value })} className="border rounded px-3 py-2" />
                  <input placeholder="Postal code" value={orderForm.postalCode} onChange={(e) => setOrderForm({ ...orderForm, postalCode: e.target.value })} className="border rounded px-3 py-2" />
                  <input placeholder="Phone" value={orderForm.phoneNumber} onChange={(e) => setOrderForm({ ...orderForm, phoneNumber: e.target.value })} className="border rounded px-3 py-2" />
                </div>
              )}
              <div className="flex gap-2 items-center">
                <select value={lineProduct} onChange={(e) => setLineProduct(e.target.value)} className="border rounded px-3 py-2 flex-1">
                  <option value="">— Add product —</option>
                  {products.map((p: any) => <option key={p.id} value={p.id}>{p.name} ({money(p.price)})</option>)}
                </select>
                <input type="number" min="1" value={lineQty} onChange={(e) => setLineQty(e.target.value)} className="border rounded px-3 py-2 w-24" />
                <button onClick={addLine} className="bg-gray-800 text-white rounded px-4 py-2 hover:bg-gray-900">Add</button>
              </div>
              {orderLines.length > 0 && (
                <ul className="text-sm divide-y border rounded">
                  {orderLines.map((l, i) => (
                    <li key={i} className="flex justify-between px-3 py-2">
                      <span>{l.name} × {l.quantity}</span>
                      <span className="font-mono">{money(l.unitPrice * l.quantity)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <button onClick={submitOrder} className="bg-green-600 text-white rounded px-4 py-2 hover:bg-green-700">Place Order</button>
            </div>
          )}
          <div className="bg-white rounded-lg border overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr><th className="text-start px-4 py-3 text-sm">Order #</th><th className="text-start px-4 py-3 text-sm">Channel</th><th className="text-start px-4 py-3 text-sm">Fulfillment</th><th className="text-start px-4 py-3 text-sm">Customer</th><th className="text-end px-4 py-3 text-sm">Total</th><th className="text-start px-4 py-3 text-sm">Status</th><th className="text-end px-4 py-3 text-sm">Actions</th></tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id} className="border-b hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-mono">{o.orderNumber}</td>
                    <td className="px-4 py-3 text-sm">{o.channel}</td>
                    <td className="px-4 py-3 text-sm">{o.fulfillmentType}</td>
                    <td className="px-4 py-3 text-sm">{o.customer?.name || '-'}</td>
                    <td className="px-4 py-3 text-sm text-end font-mono">{money(o.totalAmount)}</td>
                    <td className="px-4 py-3">{badge(o.status)}</td>
                    <td className="px-4 py-3 text-end">
                      {o.status !== 'CANCELLED' && <button onClick={() => cancelOrder(o.id)} className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded hover:bg-red-200">Cancel</button>}
                    </td>
                  </tr>
                ))}
                {orders.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">No online orders</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Fulfillment ── */}
      {tab === 'fulfillment' && (
        <div className="bg-white rounded-lg border overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr><th className="text-start px-4 py-3 text-sm">Order</th><th className="text-start px-4 py-3 text-sm">Type</th><th className="text-start px-4 py-3 text-sm">Status</th><th className="text-start px-4 py-3 text-sm">Scheduled</th><th className="text-start px-4 py-3 text-sm">Tracking</th><th className="text-end px-4 py-3 text-sm">Advance</th></tr>
            </thead>
            <tbody>
              {fulfillments.map((f) => (
                <tr key={f.id} className="border-b hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-mono">{f.order?.orderNumber}</td>
                  <td className="px-4 py-3 text-sm">{f.type}</td>
                  <td className="px-4 py-3">{badge(f.status)}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{f.scheduledAt ? new Date(f.scheduledAt).toLocaleString() : '-'}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{f.trackingNumber || f.courier || '-'}</td>
                  <td className="px-4 py-3 text-end space-x-1">
                    {['PREPARING', 'READY', 'SHIPPED', 'COMPLETED'].filter((s) => s !== f.status).slice(0, 3).map((s) => (
                      <button key={s} onClick={() => advance(f.id, s)} className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded hover:bg-blue-200">{s}</button>
                    ))}
                  </td>
                </tr>
              ))}
              {fulfillments.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">No fulfillment tasks</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Pickup ── */}
      {tab === 'pickup' && (
        <div className="bg-white rounded-lg border overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr><th className="text-start px-4 py-3 text-sm">Order</th><th className="text-start px-4 py-3 text-sm">Type</th><th className="text-start px-4 py-3 text-sm">Customer</th><th className="text-start px-4 py-3 text-sm">Status</th><th className="text-start px-4 py-3 text-sm">Ready At</th><th className="text-end px-4 py-3 text-sm">Actions</th></tr>
            </thead>
            <tbody>
              {pickups.map((f) => (
                <tr key={f.id} className="border-b hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-mono">{f.order?.orderNumber}</td>
                  <td className="px-4 py-3 text-sm">{f.type}</td>
                  <td className="px-4 py-3 text-sm">{f.order?.customer?.name || '-'}</td>
                  <td className="px-4 py-3">{badge(f.status)}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{f.readyAt ? new Date(f.readyAt).toLocaleTimeString() : '-'}</td>
                  <td className="px-4 py-3 text-end space-x-1">
                    {f.status !== 'READY' && f.status !== 'COMPLETED' && <button onClick={() => pickupReady(f.id)} className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded hover:bg-blue-200">Mark Ready</button>}
                    {f.status === 'READY' && <button onClick={() => pickupComplete(f.id)} className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded hover:bg-green-200"><CheckCircle2 size={12} className="inline" /> Picked Up</button>}
                  </td>
                </tr>
              ))}
              {pickups.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">No pickup orders</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Delivery ── */}
      {tab === 'delivery' && (
        <div className="space-y-6">
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="font-medium">Active Deliveries</h2>
            </div>
            <div className="bg-white rounded-lg border overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b">
                  <tr><th className="text-start px-4 py-3 text-sm">Order</th><th className="text-start px-4 py-3 text-sm">Recipient</th><th className="text-start px-4 py-3 text-sm">Address</th><th className="text-start px-4 py-3 text-sm">Courier</th><th className="text-end px-4 py-3 text-sm">Fee</th><th className="text-start px-4 py-3 text-sm">Status</th><th className="text-end px-4 py-3 text-sm">Actions</th></tr>
                </thead>
                <tbody>
                  {deliveries.map((d) => (
                    <tr key={d.id} className="border-b hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm font-mono">{d.order?.orderNumber}</td>
                      <td className="px-4 py-3 text-sm">{d.recipientName || d.order?.customer?.name || '-'}</td>
                      <td className="px-4 py-3 text-sm text-gray-500">{[d.addressLine1, d.city, d.postalCode].filter(Boolean).join(', ') || '-'}</td>
                      <td className="px-4 py-3 text-sm">{d.courier || '-'}</td>
                      <td className="px-4 py-3 text-sm text-end font-mono">{money(d.deliveryFee)}</td>
                      <td className="px-4 py-3">{badge(d.status)}</td>
                      <td className="px-4 py-3 text-end space-x-1">
                        {d.status !== 'OUT_FOR_DELIVERY' && d.status !== 'DELIVERED' && <button onClick={() => dispatch(d.id)} className="text-xs bg-indigo-100 text-indigo-700 px-2 py-1 rounded hover:bg-indigo-200"><Play size={12} className="inline" /> Dispatch</button>}
                        {d.status === 'OUT_FOR_DELIVERY' && <button onClick={() => delivered(d.id)} className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded hover:bg-green-200">Delivered</button>}
                      </td>
                    </tr>
                  ))}
                  {deliveries.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">No deliveries</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="font-medium">Delivery Zones</h2>
              <button onClick={() => setShowZoneForm(!showZoneForm)} className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"><Plus size={16} /> New Zone</button>
            </div>
            {showZoneForm && (
              <div className="bg-white rounded-lg border p-4 grid grid-cols-2 md:grid-cols-7 gap-3">
                <input placeholder="Zone name" value={zoneForm.name} onChange={(e) => setZoneForm({ ...zoneForm, name: e.target.value })} className="border rounded px-3 py-2" />
                <input placeholder="Radius (mi)" type="number" value={zoneForm.radiusMiles} onChange={(e) => setZoneForm({ ...zoneForm, radiusMiles: e.target.value })} className="border rounded px-3 py-2" />
                <input placeholder="Base fee" type="number" value={zoneForm.baseFee} onChange={(e) => setZoneForm({ ...zoneForm, baseFee: e.target.value })} className="border rounded px-3 py-2" />
                <input placeholder="Per-mile fee" type="number" value={zoneForm.perMileFee} onChange={(e) => setZoneForm({ ...zoneForm, perMileFee: e.target.value })} className="border rounded px-3 py-2" />
                <input placeholder="Min order" type="number" value={zoneForm.minOrder} onChange={(e) => setZoneForm({ ...zoneForm, minOrder: e.target.value })} className="border rounded px-3 py-2" />
                <input placeholder="Max distance" type="number" value={zoneForm.maxDistance} onChange={(e) => setZoneForm({ ...zoneForm, maxDistance: e.target.value })} className="border rounded px-3 py-2" />
                <button onClick={createZone} className="bg-blue-600 text-white rounded px-4 py-2 hover:bg-blue-700">Create</button>
              </div>
            )}
            <div className="bg-white rounded-lg border overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b">
                  <tr><th className="text-start px-4 py-3 text-sm">Zone</th><th className="text-start px-4 py-3 text-sm">Location</th><th className="text-end px-4 py-3 text-sm">Radius</th><th className="text-end px-4 py-3 text-sm">Base Fee</th><th className="text-end px-4 py-3 text-sm">Per Mile</th><th className="text-end px-4 py-3 text-sm">Min Order</th><th className="text-end px-4 py-3 text-sm">Actions</th></tr>
                </thead>
                <tbody>
                  {zones.map((z) => (
                    <tr key={z.id} className="border-b hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm font-medium">{z.name}</td>
                      <td className="px-4 py-3 text-sm">{z.location?.name || 'All'}</td>
                      <td className="px-4 py-3 text-sm text-end">{Number(z.radiusMiles)} mi</td>
                      <td className="px-4 py-3 text-sm text-end font-mono">{money(z.baseFee)}</td>
                      <td className="px-4 py-3 text-sm text-end font-mono">{money(z.perMileFee)}</td>
                      <td className="px-4 py-3 text-sm text-end font-mono">{money(z.minOrder)}</td>
                      <td className="px-4 py-3 text-end"><button onClick={() => removeZone(z.id)} className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded hover:bg-red-200">Delete</button></td>
                    </tr>
                  ))}
                  {zones.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">No delivery zones</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── Marketplace ── */}
      {tab === 'marketplace' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button onClick={() => setShowIntegrationForm(!showIntegrationForm)} className="flex items-center gap-2 bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700"><Plus size={16} /> Connect Integration</button>
          </div>
          {showIntegrationForm && (
            <div className="bg-white rounded-lg border p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
              <select value={integrationForm.provider} onChange={(e) => setIntegrationForm({ ...integrationForm, provider: e.target.value })} className="border rounded px-3 py-2">
                {['shopify', 'amazon', 'ebay', 'etsy', 'woocommerce', 'bigcommerce', 'doordash', 'ubereats', 'grubhub'].map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <select value={integrationForm.type} onChange={(e) => setIntegrationForm({ ...integrationForm, type: e.target.value })} className="border rounded px-3 py-2">
                {['ECOMMERCE', 'MARKETPLACE', 'DELIVERY'].map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <input placeholder="Display name" value={integrationForm.name} onChange={(e) => setIntegrationForm({ ...integrationForm, name: e.target.value })} className="border rounded px-3 py-2" />
              <button onClick={connectIntegration} className="bg-purple-600 text-white rounded px-4 py-2 hover:bg-purple-700">Connect</button>
            </div>
          )}
          <div className="bg-white rounded-lg border overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr><th className="text-start px-4 py-3 text-sm">Name</th><th className="text-start px-4 py-3 text-sm">Provider</th><th className="text-start px-4 py-3 text-sm">Type</th><th className="text-start px-4 py-3 text-sm">Status</th><th className="text-start px-4 py-3 text-sm">Last Sync</th><th className="text-end px-4 py-3 text-sm">Actions</th></tr>
              </thead>
              <tbody>
                {integrations.map((i) => (
                  <tr key={i.id} className="border-b hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-medium">{i.name}</td>
                    <td className="px-4 py-3 text-sm">{i.provider}</td>
                    <td className="px-4 py-3 text-sm">{i.type}</td>
                    <td className="px-4 py-3">{badge(i.status)}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{i.lastSyncAt ? new Date(i.lastSyncAt).toLocaleString() : 'Never'}</td>
                    <td className="px-4 py-3 text-end space-x-1">
                      <button onClick={() => syncIntegration(i.id)} className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded hover:bg-blue-200"><RefreshCw size={12} className="inline" /> Sync</button>
                      <button onClick={() => disconnect(i.id)} className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded hover:bg-red-200">Disconnect</button>
                    </td>
                  </tr>
                ))}
                {integrations.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">No commerce integrations</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Omnichannel Inventory ── */}
      {tab === 'inventory' && (
        <div className="bg-white rounded-lg border overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr><th className="text-start px-4 py-3 text-sm">Product</th><th className="text-start px-4 py-3 text-sm">SKU</th><th className="text-end px-4 py-3 text-sm">On Hand</th><th className="text-end px-4 py-3 text-sm">Reserved</th><th className="text-end px-4 py-3 text-sm">Available (ATP)</th><th className="text-start px-4 py-3 text-sm">Locations</th><th className="text-start px-4 py-3 text-sm">Status</th></tr>
            </thead>
            <tbody>
              {inventory.map((p) => (
                <tr key={p.productId} className="border-b hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-medium">{p.name}</td>
                  <td className="px-4 py-3 text-sm font-mono text-gray-500">{p.sku || '-'}</td>
                  <td className="px-4 py-3 text-sm text-end">{p.totalOnHand}</td>
                  <td className="px-4 py-3 text-sm text-end">{p.totalReserved}</td>
                  <td className="px-4 py-3 text-sm text-end font-bold">{p.availableToPromise}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{p.locations.map((l: any) => `${l.locationName || '—'}: ${l.available}`).join(' · ')}</td>
                  <td className="px-4 py-3">{p.lowStock ? <span className="text-xs px-2 py-1 rounded bg-red-100 text-red-800">LOW STOCK</span> : <span className="text-xs px-2 py-1 rounded bg-green-100 text-green-800">IN STOCK</span>}</td>
                </tr>
              ))}
              {inventory.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">No inventory records</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
