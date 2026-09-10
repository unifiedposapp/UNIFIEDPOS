import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Gift, CreditCard, Clock, RotateCcw, Plus, DollarSign, Search, Package, Tags, Undo2, X } from 'lucide-react';
import { PRODUCT_TYPE_LABELS, productTypeLabel, isStockTracked } from '@pos/shared';

type Tab = 'giftcards' | 'storecredit' | 'layaway' | 'suspended' | 'products' | 'categories' | 'returns';

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-800',
  INACTIVE: 'bg-gray-100 text-gray-800',
  PENDING: 'bg-yellow-100 text-yellow-800',
  COMPLETED: 'bg-blue-100 text-blue-800',
  CANCELLED: 'bg-red-100 text-red-800',
  EXPIRED: 'bg-gray-100 text-gray-800',
  DEPLETED: 'bg-gray-100 text-gray-800',
  VOIDED: 'bg-red-100 text-red-800',
};

// Gift cards can be purchased in denominations up to this ceiling (mirrors the
// server-side GIFT_CARD_MAX in routes/retail.ts).
const GIFT_CARD_MAX = 1000;

export default function RetailPage() {
  const [tab, setTab] = useState<Tab>('giftcards');
  const [giftCards, setGiftCards] = useState<any[]>([]);
  const [storeCredits, setStoreCredits] = useState<any[]>([]);
  const [layaways, setLayaways] = useState<any[]>([]);
  const [suspendedCarts, setSuspendedCarts] = useState<any[]>([]);

  // Forms
  const [showGiftForm, setShowGiftForm] = useState(false);
  const [giftForm, setGiftForm] = useState({ amount: '', customerId: '', expiresAt: '' });
  const [giftError, setGiftError] = useState('');
  const [purchasedCard, setPurchasedCard] = useState<any>(null);
  const [lookupNumber, setLookupNumber] = useState('');
  const [lookupResult, setLookupResult] = useState<any>(null);
  const [lookupError, setLookupError] = useState('');
  const [showCreditForm, setShowCreditForm] = useState(false);
  const [creditForm, setCreditForm] = useState({ customerId: '', balance: '', reason: '' });
  const [showLayawayForm, setShowLayawayForm] = useState(false);
  const [layawayForm, setLayawayForm] = useState({ customerId: '', totalAmount: '', depositAmount: '', dueDate: '', items: '' });
  const [payAmount, setPayAmount] = useState('');

  // Catalog management (Products & Categories tabs reuse the Inventory APIs)
  const [products, setProducts] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [productTypeFilter, setProductTypeFilter] = useState('');
  const [showProductForm, setShowProductForm] = useState(false);
  const [editingProduct, setEditingProduct] = useState<any>(null);
  const [productForm, setProductForm] = useState({ name: '', sku: '', price: '', costPrice: '', categoryId: '', type: 'PHYSICAL' });
  const [productError, setProductError] = useState('');
  const [showCategoryForm, setShowCategoryForm] = useState(false);
  const [categoryForm, setCategoryForm] = useState({ name: '', description: '', color: '#3B82F6' });

  // Returns & exchanges
  const [exchangeForm, setExchangeForm] = useState({ orderId: '', reason: '' });
  const [returnItems, setReturnItems] = useState<{ productId: string; quantity: string }[]>([{ productId: '', quantity: '1' }]);
  const [exchangeItems, setExchangeItems] = useState<{ productId: string; quantity: string }[]>([{ productId: '', quantity: '1' }]);
  const [exchangeMsg, setExchangeMsg] = useState('');
  const [exchangeError, setExchangeError] = useState('');

  const load = async () => {
    const [gcRes, scRes, lwRes, susRes] = await Promise.all([
      api.getGiftCards(),
      api.getStoreCredits(),
      api.getLayaways(),
      api.getSuspendedCarts(),
    ]);
    setGiftCards(gcRes.data || []);
    setStoreCredits(scRes.data || []);
    setLayaways(lwRes.data || []);
    setSuspendedCarts(susRes.data || []);
  };

  const loadCatalog = async () => {
    const params: Record<string, string> = {};
    if (productTypeFilter) params.type = productTypeFilter;
    const [prodRes, catRes] = await Promise.all([
      api.getProducts(params),
      api.getCategories(),
    ]);
    setProducts(prodRes.data?.items || []);
    setCategories(catRes.data || []);
  };

  useEffect(() => { load(); }, []);
  useEffect(() => { loadCatalog(); }, [productTypeFilter]);

  const purchaseGiftCard = async () => {
    const amount = Number(giftForm.amount);
    setGiftError('');
    if (!amount || amount <= 0) { setGiftError('Enter an amount greater than zero.'); return; }
    if (amount > GIFT_CARD_MAX) { setGiftError(`Gift card amount cannot exceed $${GIFT_CARD_MAX.toLocaleString()}.`); return; }
    try {
      const res = await api.createGiftCard({
        amount,
        customerId: giftForm.customerId || undefined,
        expiresAt: giftForm.expiresAt || undefined,
      });
      setPurchasedCard(res.data);
      setShowGiftForm(false);
      setGiftForm({ amount: '', customerId: '', expiresAt: '' });
      load();
    } catch (err: any) {
      setGiftError(err?.message || 'Failed to purchase gift card.');
    }
  };

  const redeemGiftCard = async (id: string, balance: number) => {
    const input = prompt(`Redeem amount (available $${Number(balance).toFixed(2)}):`, Number(balance).toFixed(2));
    if (input === null) return;
    const amount = Number(input);
    if (!amount || amount <= 0) { alert('Enter a valid amount.'); return; }
    try {
      await api.redeemGiftCard(id, amount);
      load();
    } catch (err: any) {
      alert(err?.message || 'Failed to redeem gift card.');
    }
  };

  const lookupGiftCard = async () => {
    setLookupError('');
    setLookupResult(null);
    const cardNumber = lookupNumber.trim();
    if (!cardNumber) { setLookupError('Enter a card number.'); return; }
    try {
      const res = await api.lookupGiftCard(cardNumber);
      setLookupResult(res.data);
    } catch (err: any) {
      setLookupError(err?.message || 'Card not found.');
    }
  };

  const issueCredit = async () => {
    const amount = Number(creditForm.balance);
    if (!creditForm.customerId) { alert('Customer ID is required.'); return; }
    if (!amount || amount <= 0) { alert('Enter an amount greater than zero.'); return; }
    try {
      await api.issueStoreCredit({
        customerId: creditForm.customerId,
        amount,
        reason: creditForm.reason || undefined,
      });
      setShowCreditForm(false);
      setCreditForm({ customerId: '', balance: '', reason: '' });
      load();
    } catch (err: any) {
      alert(err?.message || 'Failed to issue store credit.');
    }
  };

  const redeemStoreCredit = async (id: string, balance: number) => {
    const input = prompt(`Redeem amount (available $${Number(balance).toFixed(2)}):`, Number(balance).toFixed(2));
    if (input === null) return;
    const amount = Number(input);
    if (!amount || amount <= 0) { alert('Enter a valid amount.'); return; }
    try {
      await api.redeemStoreCredit(id, amount);
      load();
    } catch (err: any) {
      alert(err?.message || 'Failed to redeem store credit.');
    }
  };

  const createLayaway = async () => {
    await api.createLayaway({
      customerId: layawayForm.customerId,
      totalAmount: Number(layawayForm.totalAmount),
      depositAmount: Number(layawayForm.depositAmount),
      dueDate: layawayForm.dueDate,
      items: layawayForm.items ? JSON.parse(layawayForm.items) : [],
    });
    setShowLayawayForm(false);
    setLayawayForm({ customerId: '', totalAmount: '', depositAmount: '', dueDate: '', items: '' });
    load();
  };

  const payLayaway = async (id: string) => {
    await api.payLayaway(id, Number(payAmount));
    setPayAmount('');
    load();
  };

  const cancelLayaway = async (id: string) => {
    if (!confirm('Cancel this layaway? Customer will receive store credit.')) return;
    await api.cancelLayaway(id);
    load();
  };

  const resumeCart = async (id: string) => {
    await api.resumeSuspendedCart(id);
    load();
  };

  const deleteCart = async (id: string) => {
    if (!confirm('Delete this suspended cart?')) return;
    await api.deleteSuspendedCart(id);
    load();
  };

  const resetProductForm = () => {
    setProductForm({ name: '', sku: '', price: '', costPrice: '', categoryId: '', type: 'PHYSICAL' });
    setEditingProduct(null);
  };

  const saveProduct = async () => {
    setProductError('');
    const price = Number(productForm.price);
    const costPrice = Number(productForm.costPrice);
    if (!productForm.name.trim() || !productForm.sku.trim()) { setProductError('Name and SKU are required.'); return; }
    if (!price || price <= 0) { setProductError('Enter a price greater than zero.'); return; }
    if (!costPrice || costPrice <= 0) { setProductError('Enter a cost price greater than zero.'); return; }
    const payload = {
      name: productForm.name.trim(),
      sku: productForm.sku.trim(),
      price,
      costPrice,
      type: productForm.type,
      categoryId: productForm.categoryId || undefined,
    };
    try {
      if (editingProduct) await api.updateProduct(editingProduct.id, payload);
      else await api.createProduct(payload);
      setShowProductForm(false);
      resetProductForm();
      loadCatalog();
    } catch (err: any) {
      setProductError(err?.message || 'Failed to save product.');
    }
  };

  const editProduct = (p: any) => {
    setEditingProduct(p);
    setProductForm({
      name: p.name, sku: p.sku, price: String(p.price), costPrice: String(p.costPrice),
      categoryId: p.categoryId || '', type: p.type || 'PHYSICAL',
    });
    setShowProductForm(true);
  };

  const deleteProduct = async (id: string) => {
    if (!confirm('Delete this product?')) return;
    await api.deleteProduct(id);
    loadCatalog();
  };

  const saveCategory = async () => {
    if (!categoryForm.name.trim()) { alert('Category name is required.'); return; }
    try {
      await api.createCategory(categoryForm);
      setShowCategoryForm(false);
      setCategoryForm({ name: '', description: '', color: '#3B82F6' });
      loadCatalog();
    } catch (err: any) {
      alert(err?.message || 'Failed to save category.');
    }
  };

  const updateReturnItem = (idx: number, field: 'productId' | 'quantity', value: string) =>
    setReturnItems(prev => prev.map((it, i) => (i === idx ? { ...it, [field]: value } : it)));
  const addReturnItem = () => setReturnItems(prev => [...prev, { productId: '', quantity: '1' }]);
  const removeReturnItem = (idx: number) =>
    setReturnItems(prev => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));
  const updateExchangeItem = (idx: number, field: 'productId' | 'quantity', value: string) =>
    setExchangeItems(prev => prev.map((it, i) => (i === idx ? { ...it, [field]: value } : it)));
  const addExchangeItem = () => setExchangeItems(prev => [...prev, { productId: '', quantity: '1' }]);
  const removeExchangeItem = (idx: number) =>
    setExchangeItems(prev => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));

  const processExchange = async () => {
    setExchangeMsg('');
    setExchangeError('');
    if (!exchangeForm.orderId.trim()) { setExchangeError('Enter the original order ID.'); return; }
    const rItems = returnItems.filter(i => i.productId).map(i => ({ productId: i.productId, quantity: Number(i.quantity) || 1 }));
    const xItems = exchangeItems.filter(i => i.productId).map(i => ({ productId: i.productId, quantity: Number(i.quantity) || 1 }));
    if (rItems.length === 0 && xItems.length === 0) { setExchangeError('Add at least one returned or exchanged item.'); return; }
    try {
      await api.processExchange({
        orderId: exchangeForm.orderId.trim(),
        returnItems: rItems,
        exchangeItems: xItems,
        reason: exchangeForm.reason || undefined,
      });
      setExchangeMsg('Exchange processed and inventory updated.');
      setExchangeForm({ orderId: '', reason: '' });
      setReturnItems([{ productId: '', quantity: '1' }]);
      setExchangeItems([{ productId: '', quantity: '1' }]);
      loadCatalog();
    } catch (err: any) {
      setExchangeError(err?.message || 'Failed to process exchange.');
    }
  };

  const tabs: { id: Tab; label: string; icon: any; count?: number }[] = [
    { id: 'giftcards', label: 'Gift Cards', icon: Gift, count: giftCards.length },
    { id: 'storecredit', label: 'Store Credit', icon: CreditCard, count: storeCredits.length },
    { id: 'layaway', label: 'Layaway', icon: Clock, count: layaways.length },
    { id: 'suspended', label: 'Suspended Carts', icon: RotateCcw, count: suspendedCarts.length },
    { id: 'products', label: 'Products', icon: Package, count: products.length },
    { id: 'categories', label: 'Categories', icon: Tags, count: categories.length },
    { id: 'returns', label: 'Returns & Exchanges', icon: Undo2 },
  ];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Retail Engine</h1>
        <p className="text-gray-500">Gift cards, store credit, layaway, and suspended carts</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm transition-colors ${
              tab === t.id ? 'bg-white shadow text-blue-700 font-medium' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <t.icon size={16} />
            {t.label}
            {typeof t.count === 'number' && (
              <span className="text-xs bg-gray-200 text-gray-700 px-1.5 py-0.5 rounded">{t.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* Gift Cards Tab */}
      {tab === 'giftcards' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  placeholder="Check a card number"
                  value={lookupNumber}
                  onChange={e => setLookupNumber(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') lookupGiftCard(); }}
                  className="border rounded-lg pl-9 pr-3 py-2 text-sm w-64"
                />
              </div>
              <button onClick={lookupGiftCard} className="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg text-sm hover:bg-gray-300">Check</button>
            </div>
            <button onClick={() => { setShowGiftForm(!showGiftForm); setGiftError(''); }} className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700">
              <Plus size={16} /> Purchase Gift Card
            </button>
          </div>

          {lookupResult && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm flex flex-wrap items-center gap-4">
              <span className="font-mono font-medium">{lookupResult.cardNumber}</span>
              <span>Balance: <strong className="font-mono">${Number(lookupResult.balance).toFixed(2)}</strong></span>
              <span className={`text-xs px-2 py-1 rounded ${STATUS_COLORS[lookupResult.status] || ''}`}>{lookupResult.status}</span>
              <span className={lookupResult.redeemable ? 'text-green-700' : 'text-red-600'}>{lookupResult.redeemable ? 'Redeemable' : 'Not redeemable'}</span>
              <button onClick={() => redeemGiftCard(lookupResult.id, lookupResult.balance)} disabled={!lookupResult.redeemable} className="ml-auto text-xs bg-green-600 text-white px-3 py-1 rounded hover:bg-green-700 disabled:opacity-50">Redeem</button>
            </div>
          )}
          {lookupError && <div className="text-sm text-red-600">{lookupError}</div>}

          {purchasedCard && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-sm space-y-1">
              <div className="font-semibold text-green-800">Gift card purchased!</div>
              <div>Card number: <span className="font-mono font-medium">{purchasedCard.cardNumber}</span></div>
              <div>Amount: <span className="font-mono">${Number(purchasedCard.balance).toFixed(2)}</span></div>
              <div className="text-gray-500">Give this number to the customer so they can redeem it at checkout.</div>
            </div>
          )}

          {showGiftForm && (
            <div className="bg-white rounded-lg border p-4 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div>
                  <label className="text-xs text-gray-500">Amount (max ${GIFT_CARD_MAX.toLocaleString()})</label>
                  <input placeholder="e.g. 100" type="number" min={1} max={GIFT_CARD_MAX} step="0.01" value={giftForm.amount} onChange={e => setGiftForm({ ...giftForm, amount: e.target.value })} className="border rounded px-3 py-2 w-full" />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Customer ID (optional)</label>
                  <input placeholder="Link to a customer" value={giftForm.customerId} onChange={e => setGiftForm({ ...giftForm, customerId: e.target.value })} className="border rounded px-3 py-2 w-full" />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Expires (optional)</label>
                  <input type="date" value={giftForm.expiresAt} onChange={e => setGiftForm({ ...giftForm, expiresAt: e.target.value })} className="border rounded px-3 py-2 w-full" />
                </div>
                <div className="flex items-end">
                  <button onClick={purchaseGiftCard} className="bg-green-600 text-white rounded px-4 py-2 hover:bg-green-700 w-full">Purchase</button>
                </div>
              </div>
              {giftError && <div className="text-sm text-red-600">{giftError}</div>}
              <p className="text-xs text-gray-400">A unique card number is generated automatically. Purchases are capped at ${GIFT_CARD_MAX.toLocaleString()}.</p>
            </div>
          )}
          <div className="bg-white rounded-lg border">
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="text-left px-4 py-3 text-sm font-medium">Card Number</th>
                  <th className="text-left px-4 py-3 text-sm font-medium">Customer</th>
                  <th className="text-right px-4 py-3 text-sm font-medium">Balance</th>
                  <th className="text-right px-4 py-3 text-sm font-medium">Original</th>
                  <th className="text-left px-4 py-3 text-sm font-medium">Status</th>
                  <th className="text-left px-4 py-3 text-sm font-medium">Expires</th>
                  <th className="text-right px-4 py-3 text-sm font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {giftCards.map(gc => (
                  <tr key={gc.id} className="border-b hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-mono">{gc.cardNumber}</td>
                    <td className="px-4 py-3 text-sm">{gc.customer?.name || '-'}</td>
                    <td className="px-4 py-3 text-sm text-right font-mono">${Number(gc.balance).toFixed(2)}</td>
                    <td className="px-4 py-3 text-sm text-right font-mono">${Number(gc.originalAmount).toFixed(2)}</td>
                    <td className="px-4 py-3"><span className={`text-xs px-2 py-1 rounded ${STATUS_COLORS[gc.status] || ''}`}>{gc.status}</span></td>
                    <td className="px-4 py-3 text-sm text-gray-500">{gc.expiresAt ? new Date(gc.expiresAt).toLocaleDateString() : '-'}</td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => redeemGiftCard(gc.id, gc.balance)} disabled={gc.status !== 'ACTIVE' || Number(gc.balance) <= 0} className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded hover:bg-green-200 disabled:opacity-40">Redeem</button>
                    </td>
                  </tr>
                ))}
                {giftCards.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">No gift cards</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Store Credit Tab */}
      {tab === 'storecredit' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button onClick={() => setShowCreditForm(!showCreditForm)} className="flex items-center gap-2 bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700">
              <Plus size={16} /> Issue Store Credit
            </button>
          </div>
          {showCreditForm && (
            <div className="bg-white rounded-lg border p-4 space-y-3">
              <div className="grid grid-cols-4 gap-3">
                <input placeholder="Customer ID" value={creditForm.customerId} onChange={e => setCreditForm({ ...creditForm, customerId: e.target.value })} className="border rounded px-3 py-2" />
                <input placeholder="Amount" type="number" value={creditForm.balance} onChange={e => setCreditForm({ ...creditForm, balance: e.target.value })} className="border rounded px-3 py-2" />
                <input placeholder="Reason" value={creditForm.reason} onChange={e => setCreditForm({ ...creditForm, reason: e.target.value })} className="border rounded px-3 py-2" />
                <button onClick={issueCredit} className="bg-purple-600 text-white rounded px-4 py-2 hover:bg-purple-700">Issue</button>
              </div>
            </div>
          )}
          <div className="bg-white rounded-lg border">
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="text-left px-4 py-3 text-sm font-medium">Customer</th>
                  <th className="text-right px-4 py-3 text-sm font-medium">Balance</th>
                  <th className="text-right px-4 py-3 text-sm font-medium">Original</th>
                  <th className="text-left px-4 py-3 text-sm font-medium">Reason</th>
                  <th className="text-left px-4 py-3 text-sm font-medium">Status</th>
                  <th className="text-left px-4 py-3 text-sm font-medium">Expires</th>
                  <th className="text-right px-4 py-3 text-sm font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {storeCredits.map(sc => (
                  <tr key={sc.id} className="border-b hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm">{sc.customer?.name || '-'}</td>
                    <td className="px-4 py-3 text-sm text-right font-mono">${Number(sc.balance).toFixed(2)}</td>
                    <td className="px-4 py-3 text-sm text-right font-mono">${Number(sc.originalAmount).toFixed(2)}</td>
                    <td className="px-4 py-3 text-sm">{sc.reason || '-'}</td>
                    <td className="px-4 py-3"><span className={`text-xs px-2 py-1 rounded ${STATUS_COLORS[sc.status] || ''}`}>{sc.status}</span></td>
                    <td className="px-4 py-3 text-sm text-gray-500">{sc.expiresAt ? new Date(sc.expiresAt).toLocaleDateString() : '-'}</td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => redeemStoreCredit(sc.id, sc.balance)} disabled={sc.status !== 'ACTIVE' || Number(sc.balance) <= 0} className="text-xs bg-purple-100 text-purple-700 px-2 py-1 rounded hover:bg-purple-200 disabled:opacity-40">Redeem</button>
                    </td>
                  </tr>
                ))}
                {storeCredits.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">No store credits</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Layaway Tab */}
      {tab === 'layaway' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button onClick={() => setShowLayawayForm(!showLayawayForm)} className="flex items-center gap-2 bg-orange-600 text-white px-4 py-2 rounded-lg hover:bg-orange-700">
              <Plus size={16} /> New Layaway
            </button>
          </div>
          {showLayawayForm && (
            <div className="bg-white rounded-lg border p-4 space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <input placeholder="Customer ID" value={layawayForm.customerId} onChange={e => setLayawayForm({ ...layawayForm, customerId: e.target.value })} className="border rounded px-3 py-2" />
                <input placeholder="Total Amount" type="number" value={layawayForm.totalAmount} onChange={e => setLayawayForm({ ...layawayForm, totalAmount: e.target.value })} className="border rounded px-3 py-2" />
                <input placeholder="Deposit Amount" type="number" value={layawayForm.depositAmount} onChange={e => setLayawayForm({ ...layawayForm, depositAmount: e.target.value })} className="border rounded px-3 py-2" />
                <input placeholder="Due Date" type="date" value={layawayForm.dueDate} onChange={e => setLayawayForm({ ...layawayForm, dueDate: e.target.value })} className="border rounded px-3 py-2" />
                <input placeholder="Items JSON (optional)" value={layawayForm.items} onChange={e => setLayawayForm({ ...layawayForm, items: e.target.value })} className="border rounded px-3 py-2" />
                <button onClick={createLayaway} className="bg-orange-600 text-white rounded px-4 py-2 hover:bg-orange-700">Create</button>
              </div>
            </div>
          )}
          <div className="bg-white rounded-lg border">
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="text-left px-4 py-3 text-sm font-medium">Order #</th>
                  <th className="text-left px-4 py-3 text-sm font-medium">Customer</th>
                  <th className="text-right px-4 py-3 text-sm font-medium">Total</th>
                  <th className="text-right px-4 py-3 text-sm font-medium">Paid</th>
                  <th className="text-right px-4 py-3 text-sm font-medium">Remaining</th>
                  <th className="text-left px-4 py-3 text-sm font-medium">Status</th>
                  <th className="text-left px-4 py-3 text-sm font-medium">Due Date</th>
                  <th className="text-right px-4 py-3 text-sm font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {layaways.map(lw => (
                  <tr key={lw.id} className="border-b hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-mono">{lw.orderNumber}</td>
                    <td className="px-4 py-3 text-sm">{lw.customer?.name || '-'}</td>
                    <td className="px-4 py-3 text-sm text-right font-mono">${Number(lw.totalAmount).toFixed(2)}</td>
                    <td className="px-4 py-3 text-sm text-right font-mono">${Number(lw.paidAmount).toFixed(2)}</td>
                    <td className="px-4 py-3 text-sm text-right font-mono">${(Number(lw.totalAmount) - Number(lw.paidAmount)).toFixed(2)}</td>
                    <td className="px-4 py-3"><span className={`text-xs px-2 py-1 rounded ${STATUS_COLORS[lw.status] || ''}`}>{lw.status}</span></td>
                    <td className="px-4 py-3 text-sm">{lw.dueDate ? new Date(lw.dueDate).toLocaleDateString() : '-'}</td>
                    <td className="px-4 py-3 text-right">
                      {lw.status === 'ACTIVE' && (
                        <div className="flex items-center gap-1 justify-end">
                          <input placeholder="$" type="number" value={payAmount} onChange={e => setPayAmount(e.target.value)} className="border rounded px-2 py-1 w-20 text-sm" />
                          <button onClick={() => payLayaway(lw.id)} className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded hover:bg-green-200">
                            <DollarSign size={12} /> Pay
                          </button>
                          <button onClick={() => cancelLayaway(lw.id)} className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded hover:bg-red-200">Cancel</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
                {layaways.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-500">No layaways</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Suspended Carts Tab */}
      {tab === 'suspended' && (
        <div className="bg-white rounded-lg border">
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 text-sm font-medium">Reference</th>
                <th className="text-left px-4 py-3 text-sm font-medium">Employee</th>
                <th className="text-right px-4 py-3 text-sm font-medium">Total</th>
                <th className="text-left px-4 py-3 text-sm font-medium">Notes</th>
                <th className="text-left px-4 py-3 text-sm font-medium">Created</th>
                <th className="text-right px-4 py-3 text-sm font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {suspendedCarts.map(sc => (
                <tr key={sc.id} className="border-b hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-medium">{sc.reference || '-'}</td>
                  <td className="px-4 py-3 text-sm">{sc.employee?.name || '-'}</td>
                  <td className="px-4 py-3 text-sm text-right font-mono">${Number(sc.totalAmount).toFixed(2)}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{sc.notes || '-'}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{new Date(sc.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => resumeCart(sc.id)} className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded hover:bg-blue-200 mr-1">Resume</button>
                    <button onClick={() => deleteCart(sc.id)} className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded hover:bg-red-200">Delete</button>
                  </td>
                </tr>
              ))}
              {suspendedCarts.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">No suspended carts</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {/* Products Tab */}
      {tab === 'products' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <select value={productTypeFilter} onChange={e => setProductTypeFilter(e.target.value)} className="border rounded-lg px-3 py-2 text-sm">
              <option value="">All types</option>
              {Object.entries(PRODUCT_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <button onClick={() => { resetProductForm(); setProductError(''); setShowProductForm(!showProductForm); }} className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700">
              <Plus size={16} /> {showProductForm ? 'Close' : 'Add Product'}
            </button>
          </div>

          {showProductForm && (
            <div className="bg-white rounded-lg border p-4 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-gray-500">Name</label>
                  <input value={productForm.name} onChange={e => setProductForm({ ...productForm, name: e.target.value })} className="border rounded px-3 py-2 w-full" />
                </div>
                <div>
                  <label className="text-xs text-gray-500">SKU</label>
                  <input value={productForm.sku} onChange={e => setProductForm({ ...productForm, sku: e.target.value })} className="border rounded px-3 py-2 w-full" />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Type</label>
                  <select value={productForm.type} onChange={e => setProductForm({ ...productForm, type: e.target.value })} className="border rounded px-3 py-2 w-full">
                    {Object.entries(PRODUCT_TYPE_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500">Price</label>
                  <input type="number" min="0" step="0.01" value={productForm.price} onChange={e => setProductForm({ ...productForm, price: e.target.value })} className="border rounded px-3 py-2 w-full" />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Cost price</label>
                  <input type="number" min="0" step="0.01" value={productForm.costPrice} onChange={e => setProductForm({ ...productForm, costPrice: e.target.value })} className="border rounded px-3 py-2 w-full" />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Category</label>
                  <select value={productForm.categoryId} onChange={e => setProductForm({ ...productForm, categoryId: e.target.value })} className="border rounded px-3 py-2 w-full">
                    <option value="">No category</option>
                    {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              </div>
              {productError && <div className="text-sm text-red-600">{productError}</div>}
              <div className="flex gap-2">
                <button onClick={saveProduct} className="bg-blue-600 text-white rounded px-4 py-2 hover:bg-blue-700">{editingProduct ? 'Update' : 'Create'} Product</button>
                {editingProduct && <button onClick={() => { resetProductForm(); setShowProductForm(false); }} className="bg-gray-200 text-gray-700 rounded px-4 py-2 hover:bg-gray-300">Cancel edit</button>}
              </div>
            </div>
          )}

          <div className="bg-white rounded-lg border">
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="text-left px-4 py-3 text-sm font-medium">Product</th>
                  <th className="text-left px-4 py-3 text-sm font-medium">SKU</th>
                  <th className="text-left px-4 py-3 text-sm font-medium">Type</th>
                  <th className="text-left px-4 py-3 text-sm font-medium">Category</th>
                  <th className="text-right px-4 py-3 text-sm font-medium">Price</th>
                  <th className="text-right px-4 py-3 text-sm font-medium">Stock</th>
                  <th className="text-right px-4 py-3 text-sm font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {products.map(p => (
                  <tr key={p.id} className="border-b hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-medium">{p.name}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{p.sku}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{productTypeLabel(p.type)}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{p.category?.name || '-'}</td>
                    <td className="px-4 py-3 text-sm text-right font-mono">${Number(p.price).toFixed(2)}</td>
                    <td className="px-4 py-3 text-sm text-right">{isStockTracked(p.type) ? (p.stock ?? 0) : '—'}</td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => editProduct(p)} className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded hover:bg-blue-200 mr-1">Edit</button>
                      <button onClick={() => deleteProduct(p.id)} className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded hover:bg-red-200">Delete</button>
                    </td>
                  </tr>
                ))}
                {products.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">No products</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Categories Tab */}
      {tab === 'categories' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button onClick={() => setShowCategoryForm(!showCategoryForm)} className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700">
              <Plus size={16} /> {showCategoryForm ? 'Close' : 'Add Category'}
            </button>
          </div>
          {showCategoryForm && (
            <div className="bg-white rounded-lg border p-4">
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <input placeholder="Category name" value={categoryForm.name} onChange={e => setCategoryForm({ ...categoryForm, name: e.target.value })} className="border rounded px-3 py-2" />
                <input placeholder="Description (optional)" value={categoryForm.description} onChange={e => setCategoryForm({ ...categoryForm, description: e.target.value })} className="border rounded px-3 py-2" />
                <input type="color" value={categoryForm.color} onChange={e => setCategoryForm({ ...categoryForm, color: e.target.value })} className="border rounded px-3 py-2 h-10 cursor-pointer" />
                <button onClick={saveCategory} className="bg-indigo-600 text-white rounded px-4 py-2 hover:bg-indigo-700">Create</button>
              </div>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {categories.map(cat => (
              <div key={cat.id} className="bg-white rounded-lg border p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg shrink-0" style={{ backgroundColor: cat.color || '#6366F1' }} />
                <div>
                  <h3 className="font-medium">{cat.name}</h3>
                  <p className="text-sm text-gray-500">{cat._count?.products ?? cat.productCount ?? 0} products</p>
                </div>
              </div>
            ))}
            {categories.length === 0 && <div className="text-gray-500 text-sm col-span-full py-8 text-center">No categories yet</div>}
          </div>
        </div>
      )}

      {/* Returns & Exchanges Tab */}
      {tab === 'returns' && (
        <div className="bg-white rounded-lg border p-4 space-y-4">
          <div>
            <h2 className="text-lg font-semibold">Process a return or exchange</h2>
            <p className="text-sm text-gray-500">Restock returned items and deduct exchanged items. Inventory updates automatically.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500">Original order ID</label>
              <input value={exchangeForm.orderId} onChange={e => setExchangeForm({ ...exchangeForm, orderId: e.target.value })} placeholder="e.g. ORD-20260909-0001" className="border rounded px-3 py-2 w-full" />
            </div>
            <div>
              <label className="text-xs text-gray-500">Reason (optional)</label>
              <input value={exchangeForm.reason} onChange={e => setExchangeForm({ ...exchangeForm, reason: e.target.value })} className="border rounded px-3 py-2 w-full" />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium">Returned items</label>
              <button onClick={addReturnItem} className="text-xs bg-gray-200 text-gray-700 px-2 py-1 rounded hover:bg-gray-300">+ Add line</button>
            </div>
            <div className="space-y-2">
              {returnItems.map((it, idx) => (
                <div key={idx} className="flex gap-2">
                  <select value={it.productId} onChange={e => updateReturnItem(idx, 'productId', e.target.value)} className="border rounded px-3 py-2 flex-1">
                    <option value="">Select product</option>
                    {products.map(p => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}
                  </select>
                  <input type="number" min="1" value={it.quantity} onChange={e => updateReturnItem(idx, 'quantity', e.target.value)} className="border rounded px-3 py-2 w-24" />
                  <button onClick={() => removeReturnItem(idx)} disabled={returnItems.length === 1} className="text-red-600 px-2 disabled:opacity-30"><X size={16} /></button>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium">Exchange items (new)</label>
              <button onClick={addExchangeItem} className="text-xs bg-gray-200 text-gray-700 px-2 py-1 rounded hover:bg-gray-300">+ Add line</button>
            </div>
            <div className="space-y-2">
              {exchangeItems.map((it, idx) => (
                <div key={idx} className="flex gap-2">
                  <select value={it.productId} onChange={e => updateExchangeItem(idx, 'productId', e.target.value)} className="border rounded px-3 py-2 flex-1">
                    <option value="">Select product</option>
                    {products.map(p => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}
                  </select>
                  <input type="number" min="1" value={it.quantity} onChange={e => updateExchangeItem(idx, 'quantity', e.target.value)} className="border rounded px-3 py-2 w-24" />
                  <button onClick={() => removeExchangeItem(idx)} disabled={exchangeItems.length === 1} className="text-red-600 px-2 disabled:opacity-30"><X size={16} /></button>
                </div>
              ))}
            </div>
          </div>

          {exchangeError && <div className="text-sm text-red-600">{exchangeError}</div>}
          {exchangeMsg && <div className="text-sm text-green-700">{exchangeMsg}</div>}
          <button onClick={processExchange} className="bg-green-600 text-white rounded px-4 py-2 hover:bg-green-700">Process Exchange</button>
        </div>
      )}
    </div>
  );
}
