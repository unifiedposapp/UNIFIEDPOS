import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Search, Plus, Edit, Trash2, X, Mail, Phone, DollarSign } from 'lucide-react';

export default function CustomersPage() {
  const [customers, setCustomers] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    address: '',
    notes: '',
  });

  useEffect(() => {
    loadCustomers();
  }, [search]);

  async function loadCustomers() {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (search) params.search = search;
      const res = await api.getCustomers(params);
      setCustomers(res.data.items || []);
    } catch (err) {
      console.error('Failed to load customers:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    try {
      if (editingCustomer) {
        await api.updateCustomer(editingCustomer.id, formData);
      } else {
        await api.createCustomer(formData);
      }
      setShowForm(false);
      setEditingCustomer(null);
      resetForm();
      loadCustomers();
    } catch (err) {
      alert('Failed to save customer');
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this customer?')) return;
    try {
      await api.deleteCustomer(id);
      loadCustomers();
    } catch (err) {
      alert('Failed to delete customer');
    }
  }

  function resetForm() {
    setFormData({ name: '', email: '', phone: '', address: '', notes: '' });
  }

  function startEdit(customer: any) {
    setEditingCustomer(customer);
    setFormData({
      name: customer.name,
      email: customer.email || '',
      phone: customer.phone || '',
      address: customer.address || '',
      notes: customer.notes || '',
    });
    setShowForm(true);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Customers</h1>
        <button
          onClick={() => { resetForm(); setEditingCustomer(null); setShowForm(true); }}
          className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm font-medium flex items-center gap-2"
        >
          <Plus size={16} /> Add Customer
        </button>
      </div>

      <div className="mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
          <input
            type="text"
            placeholder="Search customers..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 outline-none"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {loading ? (
          <div className="col-span-full text-center py-12 text-gray-400">Loading...</div>
        ) : customers.length === 0 ? (
          <div className="col-span-full text-center py-12 text-gray-400">No customers found</div>
        ) : (
          customers.map((customer) => (
            <div key={customer.id} className="bg-white rounded-xl border border-gray-200 p-6 hover:shadow-md transition">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center font-bold text-lg">
                    {customer.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">{customer.name}</h3>
                    {customer.email && (
                      <div className="flex items-center gap-1 text-xs text-gray-500 mt-0.5">
                        <Mail size={12} /> {customer.email}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => startEdit(customer)} className="p-1.5 text-gray-400 hover:text-primary-600 rounded">
                    <Edit size={16} />
                  </button>
                  <button onClick={() => handleDelete(customer.id)} className="p-1.5 text-gray-400 hover:text-red-600 rounded">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>

              {customer.phone && (
                <div className="flex items-center gap-2 text-sm text-gray-600 mb-2">
                  <Phone size={14} /> {customer.phone}
                </div>
              )}

              <div className="border-t pt-3 mt-3 grid grid-cols-2 gap-2">
                <div>
                  <p className="text-xs text-gray-500">Total Spent</p>
                  <p className="text-sm font-bold text-green-600">
                    <DollarSign size={12} className="inline" />
                    {Number(customer.totalSpent).toFixed(2)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Orders</p>
                  <p className="text-sm font-bold text-primary-600">{customer.totalOrders}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Avg Order</p>
                  <p className="text-sm font-medium">${Number(customer.averageOrderValue).toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Loyalty Points</p>
                  <p className="text-sm font-medium text-purple-600">{customer.loyaltyPoints}</p>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-2xl p-8 w-full max-w-md">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold">{editingCustomer ? 'Edit' : 'Add'} Customer</h2>
              <button onClick={() => setShowForm(false)}><X size={24} /></button>
            </div>
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Name *</label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Email</label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Phone</label>
                <input
                  type="text"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Address</label>
                <textarea
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 outline-none"
                  rows={2}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Notes</label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 outline-none"
                  rows={2}
                />
              </div>
              <button
                type="submit"
                className="w-full py-2.5 bg-primary-600 text-white font-medium rounded-lg hover:bg-primary-700"
              >
                {editingCustomer ? 'Update' : 'Create'} Customer
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
