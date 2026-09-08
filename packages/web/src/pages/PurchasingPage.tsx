import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Package, Plus } from 'lucide-react';

export default function PurchasingPage() {
  const [orders, setOrders] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ supplierId: '', locationId: '', items: [{ productId: '', quantity: '1', unitCost: '0' }] });

  const load = async () => {
    const [poRes, supRes, prodRes, locRes] = await Promise.all([
      api.getPurchaseOrders(),
      api.getSuppliers(),
      api.getProducts(),
      api.getLocations(),
    ]);
    setOrders(poRes.data || []);
    setSuppliers(supRes.data || []);
    setProducts(prodRes.data?.items || []);
    if (locRes.data?.length > 0 && !form.locationId) {
      setForm(f => ({ ...f, locationId: locRes.data[0].id }));
    }
  };

  useEffect(() => { load(); }, []);

  const addItem = () => {
    setForm(f => ({ ...f, items: [...f.items, { productId: '', quantity: '1', unitCost: '0' }] }));
  };

  const create = async () => {
    await api.createPurchaseOrder({
      supplierId: form.supplierId,
      locationId: form.locationId,
      items: form.items.map(i => ({
        productId: i.productId,
        quantity: Number(i.quantity),
        unitCost: Number(i.unitCost),
      })),
    });
    setShowForm(false);
    load();
  };

  const receive = async (id: string) => {
    if (!confirm('Mark this PO as received? Inventory will be updated.')) return;
    // For simplicity, receive all items at once
    await api.receivePurchaseOrder(id, []);
    load();
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Purchasing</h1>
          <p className="text-gray-500">Purchase orders and inventory receiving</p>
        </div>
        <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-2 bg-teal-600 text-white px-4 py-2 rounded-lg hover:bg-teal-700">
          <Plus size={18} /> New PO
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-lg border p-4 space-y-3">
          <h3 className="font-semibold">Create Purchase Order</h3>
          <div className="grid grid-cols-2 gap-3">
            <select value={form.supplierId} onChange={e => setForm({ ...form, supplierId: e.target.value })} className="border rounded px-3 py-2">
              <option value="">Select supplier...</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <select className="border rounded px-3 py-2 bg-gray-50" disabled>
              <option>Main Store</option>
            </select>
          </div>

          <div className="space-y-2">
            <h4 className="text-sm font-medium">Items</h4>
            {form.items.map((item, idx) => (
              <div key={idx} className="grid grid-cols-4 gap-2">
                <select value={item.productId} onChange={e => {
                  const items = [...form.items];
                  items[idx] = { ...items[idx], productId: e.target.value };
                  setForm({ ...form, items });
                }} className="border rounded px-3 py-2 col-span-2">
                  <option value="">Select product...</option>
                  {products.map(p => <option key={p.id} value={p.id}>{p.name} (${Number(p.price).toFixed(2)})</option>)}
                </select>
                <input placeholder="Qty" type="number" value={item.quantity} onChange={e => {
                  const items = [...form.items];
                  items[idx] = { ...items[idx], quantity: e.target.value };
                  setForm({ ...form, items });
                }} className="border rounded px-3 py-2" />
                <input placeholder="Unit cost" type="number" value={item.unitCost} onChange={e => {
                  const items = [...form.items];
                  items[idx] = { ...items[idx], unitCost: e.target.value };
                  setForm({ ...form, items });
                }} className="border rounded px-3 py-2" />
              </div>
            ))}
            <button onClick={addItem} className="text-sm text-teal-600 hover:underline">+ Add item</button>
          </div>

          <button onClick={create} className="bg-teal-600 text-white px-4 py-2 rounded hover:bg-teal-700">Create PO</button>
        </div>
      )}

      <div className="bg-white rounded-lg border">
        <table className="w-full">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left px-4 py-3 text-sm font-medium">Date</th>
              <th className="text-left px-4 py-3 text-sm font-medium">Description</th>
              <th className="text-right px-4 py-3 text-sm font-medium">Amount</th>
              <th className="text-left px-4 py-3 text-sm font-medium">Status</th>
              <th className="text-right px-4 py-3 text-sm font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {orders.map(o => (
              <tr key={o.id} className="border-b hover:bg-gray-50">
                <td className="px-4 py-3 text-sm">{new Date(o.createdAt).toLocaleDateString()}</td>
                <td className="px-4 py-3 text-sm">{o.description}</td>
                <td className="px-4 py-3 text-sm text-right font-mono">${Number(o.amount).toFixed(2)}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-1 rounded ${o.status === 'POSTED' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
                    {o.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  {o.status === 'DRAFT' && (
                    <button onClick={() => receive(o.id)} className="text-xs bg-teal-100 text-teal-700 px-3 py-1 rounded hover:bg-teal-200 flex items-center gap-1 ml-auto">
                      <Package size={12} /> Receive
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {orders.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-500">No purchase orders yet</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
