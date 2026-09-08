import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useCartStore } from '../stores/cartStore';
import { useAuthStore } from '../stores/authStore';
import { attachBarcodeScanner } from '../services/hardware';
import { 
  Search, Plus, Minus, Trash2, CreditCard, Banknote, Smartphone, 
  User, Pause, ShoppingCart, Percent, MoreHorizontal, Clock,
  MapPin, Monitor, UserCircle, CheckCircle,
  Wallet, Zap, QrCode, Landmark, BadgeDollarSign, Bitcoin, Gift,
  Receipt, FileText, ChevronDown, ChevronUp
} from 'lucide-react';
import clsx from 'clsx';
import {
  PAYMENT_METHODS,
  availableMethods,
  groupByCategory,
  QUICK_METHOD_IDS,
  type PaymentMethodCategory,
} from '../data/paymentMethods';

// Category → representative icon for the checkout payment picker.
const CATEGORY_ICON: Record<PaymentMethodCategory, any> = {
  CARD: CreditCard,
  DIGITAL_WALLET: Wallet,
  REAL_TIME: Zap,
  QR: QrCode,
  BANK_TRANSFER: Landmark,
  BNPL: BadgeDollarSign,
  MOBILE_MONEY: Smartphone,
  VOUCHER: Receipt,
  CRYPTO: Bitcoin,
  CASH: Banknote,
  STORE_VALUE: Gift,
  OFFLINE: FileText,
};

export default function POSPage() {
  const [products, setProducts] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [settings, setSettings] = useState<any>(null);
  const [customers, setCustomers] = useState<any[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [currentTime, setCurrentTime] = useState(new Date());
  const [heldOrders, setHeldOrders] = useState<any[]>([]);
  const [couponCode, setCouponCode] = useState('');
  const [couponApplied, setCouponApplied] = useState<any>(null);
  const [couponError, setCouponError] = useState('');
  const [showAllMethods, setShowAllMethods] = useState(false);
  const [methodSearch, setMethodSearch] = useState('');
  // Stored-value redemption step (gift card / store credit need extra input).
  const [pendingMethod, setPendingMethod] = useState<string | null>(null);
  const [giftCardNumber, setGiftCardNumber] = useState('');
  const [giftCardInfo, setGiftCardInfo] = useState<any>(null);
  const [giftCardError, setGiftCardError] = useState('');
  const [lookingUpCard, setLookingUpCard] = useState(false);
  const [storeCreditTotal, setStoreCreditTotal] = useState<number | null>(null);
  const [loadingCredit, setLoadingCredit] = useState(false);

  const { items, addItem, removeItem, updateQuantity, clearCart, getSubtotal, setCustomer, discount, discountType, setDiscount } = useCartStore();
  const { user, organization } = useAuthStore();

  useEffect(() => {
    loadData();
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Barcode scanner (keyboard-wedge): a scan drops the code into product search.
  useEffect(() => attachBarcodeScanner((code) => setSearch(code)), []);

  useEffect(() => {
    loadData();
  }, [search, selectedCategory]);

  async function loadData() {
    try {
      const params: Record<string, string> = {};
      if (search) params.search = search;
      if (selectedCategory) params.categoryId = selectedCategory;

      const [prodRes, catRes, setRes, custRes, heldRes] = await Promise.all([
        api.getProducts(params),
        api.getCategories(),
        api.getSettings(),
        api.getCustomers({ pageSize: '100' }),
        api.getOrders({ status: 'HELD' }),
      ]);

      setProducts(prodRes.data.items || []);
      setCategories(catRes.data || []);
      setSettings(setRes.data);
      setCustomers(custRes.data.items || []);
      setHeldOrders(heldRes.data || []);
    } catch (err) {
      console.error('Failed to load data:', err);
    }
  }

  const taxRate = organization?.taxRate || settings?.taxRate || 0;
  const subtotal = getSubtotal();
  const discountAmount = discountType === 'PERCENTAGE' 
    ? subtotal * (discount / 100)
    : discount;
  const taxableAmount = subtotal - discountAmount;
  const tax = taxableAmount * (taxRate / 100);
  const total = taxableAmount + tax;

  // Region-aware payment catalog: in-store methods for the business's market, or
  // the entire worldwide in-store catalog when no country is configured so that
  // no payment type is ever missing from the picker.
  const country = settings?.countryCode || (organization as any)?.countryCode || '';
  const inStoreMethods = country
    ? availableMethods('IN_STORE', country)
    : PAYMENT_METHODS.filter((m) => m.channels.includes('IN_STORE'));
  const quickMethods = inStoreMethods.filter((m) => QUICK_METHOD_IDS.includes(m.id));
  const methodSearchLc = methodSearch.trim().toLowerCase();
  const methodGroups = groupByCategory(
    methodSearchLc
      ? inStoreMethods.filter(
          (m) => m.name.toLowerCase().includes(methodSearchLc) || m.id.toLowerCase().includes(methodSearchLc),
        )
      : inStoreMethods,
  );

  async function handleCheckout(paymentMethod: string, giftCard?: string) {
    if (items.length === 0) return;
    setProcessing(true);

    try {
      await api.createOrder({
        items: items.map((i) => ({
          productId: i.productId,
          variantId: i.variantId,
          quantity: i.quantity,
          unitPrice: i.price,
          discountAmt: i.discount,
          notes: i.notes,
        })),
        customerId: selectedCustomerId || undefined,
        paymentMethod,
        amountPaid: total,
        giftCardNumber: giftCard || undefined,
        couponCode: couponApplied?.code || undefined,
      });

      clearCart();
      setCheckoutOpen(false);
      setSelectedCustomerId('');
      setCouponCode('');
      setCouponApplied(null);
      setCouponError('');
      setShowAllMethods(false);
      setMethodSearch('');
      resetStoredValueStep();
      loadData();
    } catch (err: any) {
      console.error('Checkout failed:', err);
      const msg = err?.message || 'Checkout failed. Please try again.';
      // Surface backend stored-value errors inside the redemption step when open.
      if (pendingMethod === 'GIFT_CARD') setGiftCardError(msg);
      else alert(msg);
    } finally {
      setProcessing(false);
    }
  }

  function resetStoredValueStep() {
    setPendingMethod(null);
    setGiftCardNumber('');
    setGiftCardInfo(null);
    setGiftCardError('');
    setStoreCreditTotal(null);
  }

  // Stored-value tenders need an extra input step before the charge is captured.
  function selectPaymentMethod(methodId: string) {
    if (methodId === 'GIFT_CARD') {
      setPendingMethod('GIFT_CARD');
      setGiftCardNumber('');
      setGiftCardInfo(null);
      setGiftCardError('');
      return;
    }
    if (methodId === 'STORE_CREDIT') {
      setPendingMethod('STORE_CREDIT');
      setGiftCardError('');
      if (selectedCustomerId) loadStoreCreditTotal(selectedCustomerId);
      else setStoreCreditTotal(null);
      return;
    }
    handleCheckout(methodId);
  }

  async function handleLookupGiftCard() {
    const num = giftCardNumber.trim();
    if (!num) {
      setGiftCardError('Enter the gift card number');
      setGiftCardInfo(null);
      return;
    }
    setLookingUpCard(true);
    setGiftCardError('');
    try {
      const res = await api.lookupGiftCard(num);
      setGiftCardInfo(res.data);
      if (!res.data.redeemable) {
        setGiftCardError(res.data.status === 'EXPIRED' ? 'This gift card has expired' : 'This gift card is not redeemable');
      }
    } catch (err: any) {
      setGiftCardInfo(null);
      setGiftCardError(err?.message || 'Gift card not found');
    } finally {
      setLookingUpCard(false);
    }
  }

  async function loadStoreCreditTotal(customerId: string) {
    if (!customerId) {
      setStoreCreditTotal(null);
      return;
    }
    setLoadingCredit(true);
    try {
      const res = await api.getStoreCredits({ customerId, status: 'ACTIVE' });
      let sum = 0;
      for (const c of res.data || []) sum += Number(c.balance);
      setStoreCreditTotal(sum);
    } catch (err) {
      console.error('Failed to load store credit:', err);
      setStoreCreditTotal(0);
    } finally {
      setLoadingCredit(false);
    }
  }

  async function handleHoldOrder() {
    if (items.length === 0) return;
    
    try {
      await api.createOrder({
        items: items.map((i) => ({
          productId: i.productId,
          variantId: i.variantId,
          quantity: i.quantity,
          unitPrice: i.price,
          discountAmt: i.discount,
          notes: i.notes,
        })),
        customerId: selectedCustomerId || undefined,
        status: 'HELD',
      });

      clearCart();
      setSelectedCustomerId('');
      loadData();
      alert('Order held successfully');
    } catch (err) {
      console.error('Failed to hold order:', err);
      alert('Failed to hold order');
    }
  }

  async function handleRecallOrder(orderId: string) {
    try {
      const orderRes = await api.getOrder(orderId);
      const order = orderRes.data;
      
      clearCart();
      order.items.forEach((item: any) => {
        addItem({
          id: item.productId,
          name: item.productName,
          price: Number(item.unitPrice),
        });
        // Update quantity
        for (let i = 1; i < item.quantity; i++) {
          addItem({
            id: item.productId,
            name: item.productName,
            price: Number(item.unitPrice),
          });
        }
      });
      
      if (order.customerId) {
        setSelectedCustomerId(order.customerId);
        setCustomer(order.customerId);
      }
      
      await api.updateOrderStatus(orderId, 'DRAFT');
      loadData();
    } catch (err) {
      console.error('Failed to recall order:', err);
      alert('Failed to recall order');
    }
  }

  function handleCustomerChange(customerId: string) {
    setSelectedCustomerId(customerId);
    setCustomer(customerId || undefined);
    // Keep an open store-credit step in sync with the newly selected customer.
    if (pendingMethod === 'STORE_CREDIT') {
      if (customerId) loadStoreCreditTotal(customerId);
      else setStoreCreditTotal(null);
    }
  }

  function handleApplyDiscount() {
    const discountStr = prompt('Enter discount amount or percentage (e.g., 10 or 10%):');
    if (!discountStr) return;
    
    const isPercentage = discountStr.includes('%');
    const value = parseFloat(discountStr.replace('%', ''));
    
    if (isNaN(value)) {
      alert('Invalid discount value');
      return;
    }
    
    setDiscount(value, isPercentage ? 'PERCENTAGE' : 'FIXED');
  }

  async function handleApplyCoupon() {
    if (!couponCode.trim()) return;
    setCouponError('');
    try {
      const res = await api.validateCoupon(couponCode);
      if (res.data.valid) {
        setCouponApplied(res.data.coupon);
        if (res.data.coupon.type === 'PERCENTAGE') {
          setDiscount(res.data.coupon.value, 'PERCENTAGE');
        } else {
          setDiscount(res.data.coupon.value, 'FIXED');
        }
        setCouponError('');
      } else {
        setCouponError(res.data.reason || 'Invalid coupon');
        setCouponApplied(null);
      }
    } catch (e: any) {
      setCouponError(e.message || 'Failed to validate coupon');
      setCouponApplied(null);
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header Bar - §7.1 */}
      <div className="bg-white border-b border-gray-200 px-6 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <MapPin size={18} className="text-gray-500" />
              <span className="font-medium">{organization?.name || 'Main Location'}</span>
            </div>
            <div className="flex items-center gap-2">
              <Monitor size={18} className="text-gray-500" />
              <span className="font-medium">Register 01</span>
            </div>
            <div className="flex items-center gap-2">
              <UserCircle size={18} className="text-gray-500" />
              <span className="font-medium">{user?.name || 'Cashier'}</span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-green-600">
              <CheckCircle size={18} />
              <span className="font-medium">Online</span>
            </div>
            <div className="flex items-center gap-2 text-gray-600">
              <Clock size={18} />
              <span className="font-mono">{currentTime.toLocaleTimeString()}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex gap-6 flex-1 overflow-hidden p-6">
        {/* Product Grid */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex items-center gap-4 mb-4">
            <div className="relative flex-1">
              <Search size={20} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search products..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* Categories */}
          <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
            <button
              onClick={() => setSelectedCategory('')}
              className={clsx(
                'px-4 py-2 rounded-lg whitespace-nowrap transition-colors',
                !selectedCategory ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              )}
            >
              All
            </button>
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                className={clsx(
                  'px-4 py-2 rounded-lg whitespace-nowrap transition-colors',
                  selectedCategory === cat.id ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                )}
              >
                {cat.name}
              </button>
            ))}
          </div>

          {/* Products */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 overflow-y-auto flex-1">
            {products.map((product) => (
              <button
                key={product.id}
                onClick={() => addItem({
                  id: product.id,
                  name: product.name,
                  price: Number(product.price),
                })}
                className="bg-white rounded-lg shadow hover:shadow-md transition-shadow p-4 text-left"
              >
                <h3 className="font-semibold text-sm mb-1">{product.name}</h3>
                <p className="text-xs text-gray-500 mb-2">{product.sku}</p>
                <p className="text-lg font-bold text-blue-600">${Number(product.price).toFixed(2)}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Cart */}
        <div className="w-96 bg-white rounded-lg shadow-lg flex flex-col">
          <div className="p-4 border-b border-gray-200">
            <h2 className="text-lg font-bold flex items-center gap-2">
              <ShoppingCart size={20} />
              Current Order
            </h2>
          </div>

          {/* Cart Items */}
          <div className="flex-1 overflow-y-auto p-4">
            {items.length === 0 ? (
              <div className="text-center text-gray-500 py-12">
                <ShoppingCart size={48} className="mx-auto mb-4 opacity-20" />
                <p>Cart is empty</p>
              </div>
            ) : (
              <div className="space-y-3">
                {items.map((item) => (
                  <div key={item.productId} className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{item.name}</p>
                      <p className="text-xs text-gray-500">${item.price.toFixed(2)} each</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => updateQuantity(item.productId, item.quantity - 1)}
                        className="p-1 hover:bg-gray-100 rounded"
                      >
                        <Minus size={16} />
                      </button>
                      <span className="w-8 text-center font-medium">{item.quantity}</span>
                      <button
                        onClick={() => updateQuantity(item.productId, item.quantity + 1)}
                        className="p-1 hover:bg-gray-100 rounded"
                      >
                        <Plus size={16} />
                      </button>
                      <button
                        onClick={() => removeItem(item.productId)}
                        className="p-1 text-red-600 hover:bg-red-50 rounded ml-2"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Totals */}
          <div className="border-t border-gray-200 p-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Subtotal:</span>
              <span className="font-medium">${subtotal.toFixed(2)}</span>
            </div>
            {discountAmount > 0 && (
              <div className="flex justify-between text-sm text-red-600">
                <span>Discount:</span>
                <span>-${discountAmount.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Tax ({taxRate}%):</span>
              <span className="font-medium">${tax.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-lg font-bold pt-2 border-t border-gray-200">
              <span>Total:</span>
              <span className="text-blue-600">${total.toFixed(2)}</span>
            </div>
          </div>

          {/* Action Bar - §7.1 */}
          <div className="border-t border-gray-200 p-4">
            <div className="grid grid-cols-5 gap-2 mb-3">
              <button
                onClick={handleHoldOrder}
                disabled={items.length === 0}
                className="flex flex-col items-center gap-1 p-2 bg-yellow-100 text-yellow-700 rounded hover:bg-yellow-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Pause size={18} />
                <span className="text-xs">Hold</span>
              </button>
              <button
                onClick={() => {
                  const custInput = document.getElementById('customer-select');
                  if (custInput) custInput.focus();
                }}
                className="flex flex-col items-center gap-1 p-2 bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
              >
                <User size={18} />
                <span className="text-xs">Customer</span>
              </button>
              <button
                onClick={handleApplyDiscount}
                disabled={items.length === 0}
                className="flex flex-col items-center gap-1 p-2 bg-purple-100 text-purple-700 rounded hover:bg-purple-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Percent size={18} />
                <span className="text-xs">Discount</span>
              </button>
              <button
                className="flex flex-col items-center gap-1 p-2 bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
              >
                <MoreHorizontal size={18} />
                <span className="text-xs">More</span>
              </button>
              <button
                onClick={() => setCheckoutOpen(true)}
                disabled={items.length === 0}
                className="flex flex-col items-center gap-1 p-2 bg-green-100 text-green-700 rounded hover:bg-green-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <CreditCard size={18} />
                <span className="text-xs">Pay</span>
              </button>
            </div>

            {/* Customer Select */}
            <select
              id="customer-select"
              value={selectedCustomerId}
              onChange={(e) => handleCustomerChange(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">Walk-in Customer</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Held Orders Panel */}
      {heldOrders.length > 0 && (
        <div className="bg-yellow-50 border-t border-yellow-200 p-4">
          <h3 className="font-semibold text-yellow-900 mb-2 flex items-center gap-2">
            <Pause size={18} />
            Held Orders ({heldOrders.length})
          </h3>
          <div className="flex gap-3 overflow-x-auto">
            {heldOrders.map((order) => (
              <button
                key={order.id}
                onClick={() => handleRecallOrder(order.id)}
                className="bg-white border border-yellow-300 rounded-lg p-3 hover:bg-yellow-100 min-w-[200px] text-left"
              >
                <p className="font-semibold">{order.orderNumber}</p>
                <p className="text-sm text-gray-600">{order.items.length} items</p>
                <p className="text-sm font-bold text-yellow-700">${Number(order.totalAmount).toFixed(2)}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Checkout Modal */}
      {checkoutOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-[30rem] max-w-[92vw] max-h-[90vh] overflow-y-auto">
            <h2 className="text-2xl font-bold mb-4">Payment</h2>
            <div className="text-3xl font-bold text-center mb-6 text-blue-600">
              ${total.toFixed(2)}
            </div>
            {/* Coupon Code */}
            <div className="mb-4">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={couponCode}
                  onChange={e => { setCouponCode(e.target.value); setCouponError(''); }}
                  placeholder="Coupon code"
                  className="flex-1 px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                />
                <button onClick={handleApplyCoupon} className="px-3 py-2 bg-gray-200 text-gray-700 rounded-lg text-sm hover:bg-gray-300">Apply</button>
              </div>
              {couponApplied && <div className="text-xs text-green-600 mt-1">Coupon "{couponApplied.code}" applied!</div>}
              {couponError && <div className="text-xs text-red-600 mt-1">{couponError}</div>}
            </div>

            {/* Stored-value redemption step (gift card / store credit) */}
            {pendingMethod === 'GIFT_CARD' && (
              <div className="mb-4 p-3 border border-blue-200 bg-blue-50 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-blue-900 flex items-center gap-2">
                    <Gift size={16} /> Redeem Gift Card
                  </h3>
                  <button onClick={resetStoredValueStep} className="text-xs text-gray-500 hover:text-gray-700">Back</button>
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={giftCardNumber}
                    onChange={(e) => { setGiftCardNumber(e.target.value); setGiftCardError(''); }}
                    placeholder="Card number (GC-XXXX-XXXX-XXXX)"
                    className="flex-1 px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    onClick={handleLookupGiftCard}
                    disabled={lookingUpCard}
                    className="px-3 py-2 bg-gray-200 text-gray-700 rounded-lg text-sm hover:bg-gray-300 disabled:opacity-50"
                  >
                    {lookingUpCard ? '…' : 'Lookup'}
                  </button>
                </div>
                {giftCardInfo && (
                  <div className="mt-2 text-xs">
                    <span className="font-medium">{giftCardInfo.cardNumber}</span>
                    {' — '}balance <span className="font-semibold">${Number(giftCardInfo.balance).toFixed(2)}</span>
                    {' '}<span className="text-gray-500">({giftCardInfo.status})</span>
                    {giftCardInfo.redeemable && Number(giftCardInfo.balance) < total && (
                      <span className="text-red-600"> — insufficient for ${total.toFixed(2)}</span>
                    )}
                  </div>
                )}
                {giftCardError && <div className="mt-1 text-xs text-red-600">{giftCardError}</div>}
                <button
                  onClick={() => handleCheckout('GIFT_CARD', giftCardNumber.trim())}
                  disabled={processing || !giftCardInfo?.redeemable || Number(giftCardInfo?.balance ?? 0) < total}
                  className="mt-3 w-full p-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Redeem &amp; Pay ${total.toFixed(2)}
                </button>
              </div>
            )}

            {pendingMethod === 'STORE_CREDIT' && (
              <div className="mb-4 p-3 border border-emerald-200 bg-emerald-50 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-emerald-900 flex items-center gap-2">
                    <Wallet size={16} /> Redeem Store Credit
                  </h3>
                  <button onClick={resetStoredValueStep} className="text-xs text-gray-500 hover:text-gray-700">Back</button>
                </div>
                {!selectedCustomerId ? (
                  <p className="text-xs text-gray-600">Select a customer below to load their store credit balance.</p>
                ) : (
                  <>
                    <div className="text-xs">
                      Available credit:{' '}
                      <span className="font-semibold">
                        {loadingCredit ? '…' : `$${(storeCreditTotal ?? 0).toFixed(2)}`}
                      </span>
                      {storeCreditTotal !== null && storeCreditTotal < total && (
                        <span className="text-red-600"> — insufficient for ${total.toFixed(2)}</span>
                      )}
                    </div>
                    {giftCardError && <div className="mt-1 text-xs text-red-600">{giftCardError}</div>}
                    <button
                      onClick={() => handleCheckout('STORE_CREDIT')}
                      disabled={processing || loadingCredit || (storeCreditTotal ?? 0) < total}
                      className="mt-3 w-full p-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Redeem &amp; Pay ${total.toFixed(2)}
                    </button>
                  </>
                )}
              </div>
            )}

            <div className="space-y-3">
              {/* Quick-access methods */}
              <div className="grid grid-cols-2 gap-2">
                {quickMethods.map((m) => {
                  const Icon = CATEGORY_ICON[m.category] || CreditCard;
                  return (
                    <button
                      key={m.id}
                      onClick={() => selectPaymentMethod(m.id)}
                      disabled={processing}
                      className="flex items-center justify-center gap-2 p-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium"
                    >
                      <Icon size={18} />
                      <span className="truncate">{m.name}</span>
                    </button>
                  );
                })}
              </div>

              {/* Expand the full global catalog */}
              <button
                onClick={() => setShowAllMethods((s) => !s)}
                disabled={processing}
                className="w-full flex items-center justify-center gap-2 p-2 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-50"
              >
                {showAllMethods ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                {showAllMethods ? 'Show fewer methods' : `All payment methods (${inStoreMethods.length})`}
              </button>

              {showAllMethods && (
                <div>
                  <input
                    type="text"
                    value={methodSearch}
                    onChange={(e) => setMethodSearch(e.target.value)}
                    placeholder="Search payment methods…"
                    className="w-full px-3 py-2 border rounded-lg text-sm mb-2 focus:ring-2 focus:ring-blue-500"
                  />
                  <div className="max-h-64 overflow-y-auto space-y-3 pr-1">
                    {methodGroups.map((g) => {
                      const Icon = CATEGORY_ICON[g.category];
                      return (
                        <div key={g.category}>
                          <div className="flex items-center gap-2 text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                            {Icon ? <Icon size={14} /> : null}
                            {g.label}
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            {g.methods.map((m) => (
                              <button
                                key={m.id}
                                onClick={() => selectPaymentMethod(m.id)}
                                disabled={processing}
                                className="flex items-center gap-2 p-2 border rounded-lg hover:bg-blue-50 hover:border-blue-400 disabled:opacity-50 text-sm text-gray-700"
                              >
                                <span className="truncate">{m.name}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                    {methodGroups.length === 0 && (
                      <p className="text-sm text-gray-500 text-center py-4">
                        No methods match "{methodSearch}".
                      </p>
                    )}
                  </div>
                </div>
              )}

              <button
                onClick={() => { setCheckoutOpen(false); resetStoredValueStep(); }}
                disabled={processing}
                className="w-full p-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
            {processing && (
              <div className="mt-4 text-center text-gray-600">
                Processing payment...
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
