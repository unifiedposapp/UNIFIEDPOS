import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Search, Plus, Edit, Trash2, X, AlertTriangle, Layers, Calendar } from 'lucide-react';
import clsx from 'clsx';
import { PRODUCT_TYPE_LABELS, productTypeLabel } from '@pos/shared';

export default function InventoryPage() {
  const [products, setProducts] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [showProductForm, setShowProductForm] = useState(false);
  const [showCategoryForm, setShowCategoryForm] = useState(false);
  const [editingProduct, setEditingProduct] = useState<any>(null);
  const [lowStock, setLowStock] = useState<any[]>([]);
  const [tab, setTab] = useState<'products' | 'categories' | 'alerts' | 'batches'>('products');
  const [batches, setBatches] = useState<any[]>([]);
  const [serials, setSerials] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [showBatchForm, setShowBatchForm] = useState(false);
  const [batchForm, setBatchForm] = useState({
    productId: '', locationId: '', batchNumber: '', quantity: '', expirationDate: '', unitCost: '',
  });

  const [formData, setFormData] = useState({
    name: '', sku: '', barcode: '', description: '', price: '', costPrice: '',
    categoryId: '', imageUrl: '', type: 'PHYSICAL',
  });
  const [typeFilter, setTypeFilter] = useState('');
  const [catFormData, setCatFormData] = useState({ name: '', description: '', color: '#3B82F6' });

  useEffect(() => { loadData(); }, [search, typeFilter]);

  async function loadData() {
    try {
      const params: Record<string, string> = {};
      if (search) params.search = search;
      if (typeFilter) params.type = typeFilter;
      const [prodRes, catRes, lowRes, batchRes, serialRes, locRes] = await Promise.all([
        api.getProducts(params),
        api.getCategories(),
        api.getLowStock(),
        api.getBatches(),
        api.getSerials(),
        api.getLocations(),
      ]);
      setProducts(prodRes.data.items || []);
      setCategories(catRes.data || []);
      setLowStock(lowRes.data || []);
      setBatches(batchRes.data || []);
      setSerials(serialRes.data || []);
      setLocations(locRes.data || []);
    } catch (err) {
      console.error('Failed to load inventory:', err);
    }
  }

  async function handleSaveProduct(e: React.FormEvent) {
    e.preventDefault();
    try {
      const data = {
        ...formData,
        price: Number(formData.price),
        costPrice: Number(formData.costPrice),
      };
      if (editingProduct) {
        await api.updateProduct(editingProduct.id, data);
      } else {
        await api.createProduct(data);
      }
      setShowProductForm(false);
      setEditingProduct(null);
      resetForm();
      loadData();
    } catch (err) {
      alert('Failed to save product');
    }
  }

  async function handleSaveCategory(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.createCategory(catFormData);
      setShowCategoryForm(false);
      setCatFormData({ name: '', description: '', color: '#3B82F6' });
      loadData();
    } catch (err) {
      alert('Failed to save category');
    }
  }

  async function handleDeleteProduct(id: string) {
    if (!confirm('Delete this product?')) return;
    await api.deleteProduct(id);
    loadData();
  }

  function resetForm() {
    setFormData({ name: '', sku: '', barcode: '', description: '', price: '', costPrice: '', categoryId: '', imageUrl: '', type: 'PHYSICAL' });
  }

  function startEdit(product: any) {
    setEditingProduct(product);
    setFormData({
      name: product.name, sku: product.sku, barcode: product.barcode || '',
      description: product.description || '', price: String(product.price),
      costPrice: String(product.costPrice), categoryId: product.categoryId || '',
      imageUrl: product.imageUrl || '', type: product.type || 'PHYSICAL',
    });
    setShowProductForm(true);
  }

  async function handleSaveBatch(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.createBatch({
        productId: batchForm.productId,
        locationId: batchForm.locationId,
        batchNumber: batchForm.batchNumber,
        quantity: Number(batchForm.quantity),
        expirationDate: batchForm.expirationDate || undefined,
        unitCost: batchForm.unitCost ? Number(batchForm.unitCost) : undefined,
      });
      setShowBatchForm(false);
      setBatchForm({ productId: '', locationId: '', batchNumber: '', quantity: '', expirationDate: '', unitCost: '' });
      loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to receive batch');
    }
  }

  async function handleConsumeBatch(batch: any) {
    const qty = prompt(`Consume from batch ${batch.batchNumber} (${batch.remaining} remaining):`, '1');
    if (!qty) return;
    try {
      await api.consumeBatch(batch.id, { quantity: Number(qty) });
      loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to consume batch');
    }
  }

  async function handleBatchStatus(batch: any, status: string) {
    try {
      await api.setBatchStatus(batch.id, status);
      loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to update batch status');
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Inventory</h1>
        <div className="flex gap-2">
          <button onClick={() => setShowCategoryForm(true)} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm font-medium">
            Add Category
          </button>
          <button onClick={() => { resetForm(); setEditingProduct(null); setShowProductForm(true); }} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm font-medium flex items-center gap-2">
            <Plus size={16} /> Add Product
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 w-fit">
        {(['products', 'categories', 'alerts', 'batches'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={clsx('px-4 py-2 rounded-md text-sm font-medium transition', tab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700')}
          >
            {t === 'alerts'
              ? `Low Stock (${lowStock.length})`
              : t === 'batches'
              ? `Batches & Serials (${batches.length})`
              : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === 'products' && (
        <>
          <div className="mb-4 flex gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <input type="text" placeholder="Search products..." value={search} onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 outline-none" />
            </div>
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}
              className="px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 outline-none text-sm">
              <option value="">All types</option>
              {Object.entries(PRODUCT_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-6 py-3 text-start text-xs font-medium text-gray-500 uppercase">Product</th>
                  <th className="px-6 py-3 text-start text-xs font-medium text-gray-500 uppercase">SKU</th>
                  <th className="px-6 py-3 text-start text-xs font-medium text-gray-500 uppercase">Category</th>
                  <th className="px-6 py-3 text-start text-xs font-medium text-gray-500 uppercase">Type</th>
                  <th className="px-6 py-3 text-start text-xs font-medium text-gray-500 uppercase">Price</th>
                  <th className="px-6 py-3 text-start text-xs font-medium text-gray-500 uppercase">Stock</th>
                  <th className="px-6 py-3 text-start text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {products.map((p) => (
                  <tr key={p.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 text-sm font-medium">{p.name}</td>
                    <td className="px-6 py-4 text-sm text-gray-500">{p.sku}</td>
                    <td className="px-6 py-4 text-sm text-gray-500">{p.category?.name}</td>
                    <td className="px-6 py-4 text-sm text-gray-500">{productTypeLabel(p.type)}</td>
                    <td className="px-6 py-4 text-sm">${Number(p.price).toFixed(2)}</td>
                    <td className="px-6 py-4">
                      <span className={clsx('text-sm font-medium', (p.stock || 0) <= 5 ? 'text-red-600' : 'text-green-600')}>
                        {p.stock || 0}
                      </span>
                    </td>
                    <td className="px-6 py-4 flex gap-2">
                      <button onClick={() => startEdit(p)} className="p-1.5 text-gray-400 hover:text-primary-600"><Edit size={16} /></button>
                      <button onClick={() => handleDeleteProduct(p.id)} className="p-1.5 text-gray-400 hover:text-red-600"><Trash2 size={16} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'categories' && (
        <div className="grid grid-cols-3 gap-4">
          {categories.map((cat) => (
            <div key={cat.id} className="bg-white rounded-xl border p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg" style={{ backgroundColor: cat.color || '#3B82F6' }} />
              <div>
                <h3 className="font-medium">{cat.name}</h3>
                <p className="text-sm text-gray-500">{cat._count?.products || 0} products</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'alerts' && (
        <div className="bg-white rounded-xl border overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-6 py-3 text-start text-xs font-medium text-gray-500 uppercase">Product</th>
                <th className="px-6 py-3 text-start text-xs font-medium text-gray-500 uppercase">Current Stock</th>
                <th className="px-6 py-3 text-start text-xs font-medium text-gray-500 uppercase">Reorder Point</th>
                <th className="px-6 py-3 text-start text-xs font-medium text-gray-500 uppercase">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {lowStock.map((balance: any) => (
                <tr key={balance.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 text-sm font-medium flex items-center gap-2">
                    <AlertTriangle size={16} className="text-yellow-500" /> {balance.product?.name}
                  </td>
                  <td className="px-6 py-4 text-sm text-red-600 font-medium">{balance.quantity}</td>
                  <td className="px-6 py-4 text-sm text-gray-500">{balance.reorderPoint}</td>
                  <td className="px-6 py-4">
                    <span className="px-2.5 py-1 bg-red-100 text-red-700 rounded-full text-xs font-medium">Low Stock</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'batches' && (
        <div className="space-y-8">
          {/* Batches / lots */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold flex items-center gap-2"><Layers size={18} /> Batches & Lots</h2>
              <button onClick={() => setShowBatchForm(true)} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm font-medium flex items-center gap-2">
                <Plus size={16} /> Receive Batch
              </button>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-6 py-3 text-start text-xs font-medium text-gray-500 uppercase">Product</th>
                    <th className="px-6 py-3 text-start text-xs font-medium text-gray-500 uppercase">Batch #</th>
                    <th className="px-6 py-3 text-start text-xs font-medium text-gray-500 uppercase">Qty / Remaining</th>
                    <th className="px-6 py-3 text-start text-xs font-medium text-gray-500 uppercase">Expiration</th>
                    <th className="px-6 py-3 text-start text-xs font-medium text-gray-500 uppercase">Status</th>
                    <th className="px-6 py-3 text-start text-xs font-medium text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {batches.length === 0 && (
                    <tr><td colSpan={6} className="px-6 py-8 text-center text-sm text-gray-400">No batches received yet.</td></tr>
                  )}
                  {batches.map((b) => {
                    const expiring = b.expirationDate && new Date(b.expirationDate) < new Date(Date.now() + 30 * 86400000);
                    return (
                      <tr key={b.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 text-sm font-medium">{b.product?.name}<span className="block text-xs text-gray-400">{b.product?.sku}</span></td>
                        <td className="px-6 py-4 text-sm text-gray-600">{b.batchNumber}</td>
                        <td className="px-6 py-4 text-sm">{b.remaining} / {b.quantity}</td>
                        <td className="px-6 py-4 text-sm">
                          {b.expirationDate ? (
                            <span className={clsx('flex items-center gap-1', expiring ? 'text-amber-600' : 'text-gray-500')}>
                              <Calendar size={14} /> {new Date(b.expirationDate).toLocaleDateString()}
                            </span>
                          ) : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-6 py-4">
                          <span className={clsx('px-2.5 py-1 rounded-full text-xs font-medium', {
                            'bg-green-100 text-green-700': b.status === 'ACTIVE',
                            'bg-red-100 text-red-700': b.status === 'EXPIRED' || b.status === 'RECALLED',
                            'bg-gray-100 text-gray-600': b.status === 'DEPLETED',
                          })}>{b.status}</span>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex gap-2">
                            <button onClick={() => handleConsumeBatch(b)} disabled={b.remaining <= 0} className="px-2.5 py-1 text-xs border rounded hover:bg-gray-50 disabled:opacity-40">Consume</button>
                            {b.status === 'ACTIVE' && (
                              <>
                                <button onClick={() => handleBatchStatus(b, 'EXPIRED')} className="px-2.5 py-1 text-xs border rounded hover:bg-amber-50 text-amber-700">Expire</button>
                                <button onClick={() => handleBatchStatus(b, 'RECALLED')} className="px-2.5 py-1 text-xs border rounded hover:bg-red-50 text-red-700">Recall</button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Serial numbers */}
          <div>
            <h2 className="text-lg font-semibold mb-3">Serial Numbers</h2>
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-6 py-3 text-start text-xs font-medium text-gray-500 uppercase">Product</th>
                    <th className="px-6 py-3 text-start text-xs font-medium text-gray-500 uppercase">Serial</th>
                    <th className="px-6 py-3 text-start text-xs font-medium text-gray-500 uppercase">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {serials.length === 0 && (
                    <tr><td colSpan={3} className="px-6 py-8 text-center text-sm text-gray-400">No serial numbers registered.</td></tr>
                  )}
                  {serials.map((s) => (
                    <tr key={s.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 text-sm font-medium">{s.product?.name}</td>
                      <td className="px-6 py-4 text-sm text-gray-600 font-mono">{s.serial}</td>
                      <td className="px-6 py-4">
                        <span className={clsx('px-2.5 py-1 rounded-full text-xs font-medium', {
                          'bg-green-100 text-green-700': s.status === 'IN_STOCK',
                          'bg-blue-100 text-blue-700': s.status === 'SOLD' || s.status === 'RESERVED',
                          'bg-red-100 text-red-700': s.status === 'DEFECTIVE',
                          'bg-gray-100 text-gray-600': s.status === 'RETURNED' || s.status === 'IN_REPAIR',
                        })}>{s.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Batch Form Modal */}
      {showBatchForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-2xl p-8 w-full max-w-lg">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold">Receive Batch / Lot</h2>
              <button onClick={() => setShowBatchForm(false)}><X size={24} /></button>
            </div>
            <form onSubmit={handleSaveBatch} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Product</label>
                <select required value={batchForm.productId} onChange={(e) => setBatchForm({ ...batchForm, productId: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 outline-none">
                  <option value="">Select product</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Location</label>
                <select required value={batchForm.locationId} onChange={(e) => setBatchForm({ ...batchForm, locationId: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 outline-none">
                  <option value="">Select location</option>
                  {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Batch Number</label>
                  <input type="text" required value={batchForm.batchNumber} onChange={(e) => setBatchForm({ ...batchForm, batchNumber: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Quantity</label>
                  <input type="number" min="1" required value={batchForm.quantity} onChange={(e) => setBatchForm({ ...batchForm, quantity: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 outline-none" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Expiration (optional)</label>
                  <input type="date" value={batchForm.expirationDate} onChange={(e) => setBatchForm({ ...batchForm, expirationDate: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Unit Cost (optional)</label>
                  <input type="number" step="0.01" min="0" value={batchForm.unitCost} onChange={(e) => setBatchForm({ ...batchForm, unitCost: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 outline-none" />
                </div>
              </div>
              <button type="submit" className="w-full py-2.5 bg-primary-600 text-white font-medium rounded-lg hover:bg-primary-700">
                Receive Batch
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Product Form Modal */}
      {showProductForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-2xl p-8 w-full max-w-lg max-h-[90vh] overflow-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold">{editingProduct ? 'Edit' : 'Add'} Product</h2>
              <button onClick={() => setShowProductForm(false)}><X size={24} /></button>
            </div>
            <form onSubmit={handleSaveProduct} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Name</label>
                  <input type="text" required value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">SKU</label>
                  <input type="text" required value={formData.sku} onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 outline-none" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Price</label>
                  <input type="number" step="0.01" required value={formData.price} onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Cost Price</label>
                  <input type="number" step="0.01" required value={formData.costPrice} onChange={(e) => setFormData({ ...formData, costPrice: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 outline-none" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Category</label>
                <select value={formData.categoryId} onChange={(e) => setFormData({ ...formData, categoryId: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 outline-none" required>
                  <option value="">Select category</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Type</label>
                <select value={formData.type} onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 outline-none">
                  {Object.entries(PRODUCT_TYPE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Description</label>
                <textarea value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 outline-none" rows={2} />
              </div>
              <button type="submit" className="w-full py-2.5 bg-primary-600 text-white font-medium rounded-lg hover:bg-primary-700">
                {editingProduct ? 'Update' : 'Create'} Product
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Category Form Modal */}
      {showCategoryForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-2xl p-8 w-full max-w-md">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold">Add Category</h2>
              <button onClick={() => setShowCategoryForm(false)}><X size={24} /></button>
            </div>
            <form onSubmit={handleSaveCategory} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Name</label>
                <input type="text" required value={catFormData.name} onChange={(e) => setCatFormData({ ...catFormData, name: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Color</label>
                <input type="color" value={catFormData.color} onChange={(e) => setCatFormData({ ...catFormData, color: e.target.value })}
                  className="w-full h-10 border rounded-lg cursor-pointer" />
              </div>
              <button type="submit" className="w-full py-2.5 bg-primary-600 text-white font-medium rounded-lg hover:bg-primary-700">
                Create Category
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
