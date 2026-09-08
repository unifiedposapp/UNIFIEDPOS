import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Truck, Plus } from 'lucide-react';

export default function SuppliersPage() {
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', contactName: '', email: '', phone: '', address: '' });

  const load = async () => {
    const res = await api.getSuppliers();
    setSuppliers(res.data || []);
  };

  useEffect(() => { load(); }, []);

  const create = async () => {
    await api.createSupplier(form);
    setShowForm(false);
    setForm({ name: '', contactName: '', email: '', phone: '', address: '' });
    load();
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this supplier?')) return;
    await api.deleteSupplier(id);
    load();
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Suppliers</h1>
          <p className="text-gray-500">Manage vendor and supplier relationships</p>
        </div>
        <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700">
          <Plus size={18} /> Add Supplier
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-lg border p-4 space-y-3">
          <h3 className="font-semibold">New Supplier</h3>
          <div className="grid grid-cols-5 gap-3">
            <input placeholder="Company name *" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="border rounded px-3 py-2" />
            <input placeholder="Contact name" value={form.contactName} onChange={e => setForm({ ...form, contactName: e.target.value })} className="border rounded px-3 py-2" />
            <input placeholder="Email" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} className="border rounded px-3 py-2" />
            <input placeholder="Phone" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} className="border rounded px-3 py-2" />
            <button onClick={create} className="bg-indigo-600 text-white rounded px-4 py-2 hover:bg-indigo-700">Create</button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-4">
        {suppliers.map(s => (
          <div key={s.id} className="bg-white rounded-lg border p-4">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                <Truck size={20} className="text-indigo-500" />
                <h3 className="font-bold">{s.name}</h3>
              </div>
              <button onClick={() => remove(s.id)} className="text-xs text-red-500 hover:underline">Delete</button>
            </div>
            {s.contactName && <div className="text-sm text-gray-600 mt-1">Contact: {s.contactName}</div>}
            {s.email && <div className="text-sm text-gray-500">{s.email}</div>}
            {s.phone && <div className="text-sm text-gray-500">{s.phone}</div>}
            {s.address && <div className="text-sm text-gray-400 mt-1">{s.address}</div>}
            <div className={`mt-2 text-xs px-2 py-1 rounded inline-block ${s.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
              {s.isActive ? 'Active' : 'Inactive'}
            </div>
          </div>
        ))}
        {suppliers.length === 0 && (
          <div className="col-span-3 text-center py-12 text-gray-500">No suppliers yet. Add your first supplier above.</div>
        )}
      </div>
    </div>
  );
}
