import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Search, Eye, RotateCcw, XCircle, X, Pause, Play } from 'lucide-react';
import clsx from 'clsx';

const ORDER_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Draft',
  HELD: 'On Hold',
  CONFIRMED: 'Confirmed',
  PAID: 'Paid',
  PROCESSING: 'Processing',
  FULFILLED: 'Fulfilled',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  REFUNDED: 'Refunded',
  PARTIALLY_REFUNDED: 'Partially Refunded',
};

export default function OrdersPage() {
  const [tab, setTab] = useState<'all' | 'held'>('all');
  const [orders, setOrders] = useState<any[]>([]);
  const [heldOrders, setHeldOrders] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState<any>(null);

  useEffect(() => {
    loadOrders();
  }, [search, statusFilter, tab]);

  async function loadOrders() {
    setLoading(true);
    try {
      if (tab === 'held') {
        const res = await api.getOrders({ status: 'HELD' });
        setHeldOrders(Array.isArray(res.data) ? res.data : (res.data?.items || []));
        setOrders([]);
      } else {
        const params: Record<string, string> = {};
        if (search) params.search = search;
        if (statusFilter) params.status = statusFilter;
        const res = await api.getOrders(params);
        setOrders(Array.isArray(res.data) ? res.data : (res.data?.items || []));
        setHeldOrders([]);
      }
    } catch (err) {
      console.error('Failed to load orders:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleRefund(id: string) {
    if (!confirm('Are you sure you want to refund this order?')) return;
    try {
      await api.refundOrder(id);
      loadOrders();
      setSelectedOrder(null);
    } catch (err) {
      alert('Refund failed');
    }
  }

  async function handleCancel(id: string) {
    if (!confirm('Are you sure you want to cancel this order?')) return;
    try {
      await api.cancelOrder(id);
      loadOrders();
      setSelectedOrder(null);
    } catch (err) {
      alert('Cancel failed');
    }
  }

  async function handleHold(id: string) {
    try {
      await api.holdOrder(id);
      loadOrders();
    } catch (err) {
      alert('Failed to hold order');
    }
  }

  async function handleRecall(id: string) {
    try {
      await api.recallOrder(id);
      loadOrders();
    } catch (err) {
      alert('Failed to recall order');
    }
  }

  const statusColors: Record<string, string> = {
    DRAFT: 'bg-gray-100 text-gray-700',
    HELD: 'bg-yellow-100 text-yellow-700',
    CONFIRMED: 'bg-blue-100 text-blue-700',
    PAID: 'bg-indigo-100 text-indigo-700',
    PROCESSING: 'bg-purple-100 text-purple-700',
    FULFILLED: 'bg-cyan-100 text-cyan-700',
    COMPLETED: 'bg-green-100 text-green-700',
    CANCELLED: 'bg-red-100 text-red-700',
    REFUNDED: 'bg-orange-100 text-orange-700',
    PARTIALLY_REFUNDED: 'bg-amber-100 text-amber-700',
  };

  const displayOrders = tab === 'held' ? heldOrders : orders;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Orders</h1>
      </div>

      {/* Tab Bar */}
      <div className="flex gap-2 mb-4">
        <button onClick={() => setTab('all')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium ${tab === 'all' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
          <Search size={16} /> All Orders
        </button>
        <button onClick={() => setTab('held')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium ${tab === 'held' ? 'bg-yellow-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
          <Pause size={16} /> Held Orders
        </button>
      </div>

      {tab === 'all' && (
        <div className="flex gap-4 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input
              type="text"
              placeholder="Search by order number..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 outline-none"
          >
            <option value="">All Statuses</option>
            {Object.entries(ORDER_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{String(label)}</option>
            ))}
          </select>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Order #</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Customer</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Channel</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Items</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Total</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {loading ? (
              <tr><td colSpan={8} className="px-6 py-12 text-center text-gray-400">Loading...</td></tr>
            ) : displayOrders.length === 0 ? (
              <tr><td colSpan={8} className="px-6 py-12 text-center text-gray-400">
                {tab === 'held' ? 'No held orders' : 'No orders found'}
              </td></tr>
            ) : (
              displayOrders.map((order) => (
                <tr key={order.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 text-sm font-medium text-primary-600">{order.orderNumber}</td>
                  <td className="px-6 py-4 text-sm text-gray-500">{new Date(order.createdAt).toLocaleDateString()}</td>
                  <td className="px-6 py-4 text-sm text-gray-500">{order.customer?.name || 'Walk-in'}</td>
                  <td className="px-6 py-4"><span className="px-2 py-1 bg-gray-100 rounded-full text-xs">{order.channel}</span></td>
                  <td className="px-6 py-4 text-sm text-gray-500">{order.items?.length || 0} items</td>
                  <td className="px-6 py-4 text-sm font-medium">${Number(order.totalAmount).toFixed(2)}</td>
                  <td className="px-6 py-4">
                    <span className={clsx('px-2.5 py-1 rounded-full text-xs font-medium', statusColors[order.status])}>
                      {ORDER_STATUS_LABELS[order.status] || order.status}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex gap-2">
                      <button onClick={() => setSelectedOrder(order)} className="p-1.5 text-gray-400 hover:text-primary-600 rounded" title="View">
                        <Eye size={16} />
                      </button>
                      {tab === 'held' && order.status === 'HELD' && (
                        <button onClick={() => handleRecall(order.id)} className="p-1.5 text-gray-400 hover:text-green-600 rounded" title="Recall">
                          <Play size={16} />
                        </button>
                      )}
                      {tab === 'all' && ['DRAFT', 'CONFIRMED'].includes(order.status) && (
                        <button onClick={() => handleHold(order.id)} className="p-1.5 text-gray-400 hover:text-yellow-600 rounded" title="Hold">
                          <Pause size={16} />
                        </button>
                      )}
                      {order.status === 'COMPLETED' && (
                        <>
                          <button onClick={() => handleRefund(order.id)} className="p-1.5 text-gray-400 hover:text-yellow-600 rounded" title="Refund">
                            <RotateCcw size={16} />
                          </button>
                          <button onClick={() => handleCancel(order.id)} className="p-1.5 text-gray-400 hover:text-red-600 rounded" title="Cancel">
                            <XCircle size={16} />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Order Detail Modal */}
      {selectedOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-2xl p-8 w-full max-w-lg max-h-[80vh] overflow-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold">Order {selectedOrder.orderNumber}</h2>
              <button onClick={() => setSelectedOrder(null)} className="text-gray-400 hover:text-gray-600"><X size={24} /></button>
            </div>
            <div className="space-y-2 text-sm">
              <p><strong>Date:</strong> {new Date(selectedOrder.createdAt).toLocaleString()}</p>
              <p><strong>Customer:</strong> {selectedOrder.customer?.name || 'Walk-in'}</p>
              <p><strong>Channel:</strong> {selectedOrder.channel}</p>
              <p><strong>Status:</strong> {ORDER_STATUS_LABELS[selectedOrder.status] || selectedOrder.status}</p>
              {selectedOrder.couponCode && <p><strong>Coupon:</strong> {selectedOrder.couponCode}</p>}
              {selectedOrder.employee && <p><strong>Cashier:</strong> {selectedOrder.employee.id}</p>}
            </div>
            <div className="mt-4 border-t pt-4">
              <h3 className="font-medium mb-2">Items</h3>
              {selectedOrder.items?.map((item: any) => (
                <div key={item.id} className="flex justify-between text-sm py-1">
                  <span>{item.productName} x{item.quantity}</span>
                  <span>${Number(item.totalAmount).toFixed(2)}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 border-t pt-4 space-y-1">
              <div className="flex justify-between text-sm"><span>Subtotal</span><span>${Number(selectedOrder.subtotal).toFixed(2)}</span></div>
              {Number(selectedOrder.discountAmount) > 0 && (
                <div className="flex justify-between text-sm text-red-600"><span>Discount</span><span>-${Number(selectedOrder.discountAmount).toFixed(2)}</span></div>
              )}
              <div className="flex justify-between text-sm"><span>Tax</span><span>${Number(selectedOrder.taxAmount).toFixed(2)}</span></div>
              {Number(selectedOrder.tipAmount) > 0 && (
                <div className="flex justify-between text-sm"><span>Tip</span><span>${Number(selectedOrder.tipAmount).toFixed(2)}</span></div>
              )}
              <div className="flex justify-between font-bold text-lg pt-2 border-t">
                <span>Total</span><span>${Number(selectedOrder.totalAmount).toFixed(2)}</span>
              </div>
            </div>
            {selectedOrder.payments?.length > 0 && (
              <div className="mt-4 border-t pt-4">
                <h3 className="font-medium mb-2">Payments</h3>
                {selectedOrder.payments.map((p: any) => (
                  <div key={p.id} className="flex justify-between text-sm py-1">
                    <span>{p.method} - {p.status}</span><span>${Number(p.amount).toFixed(2)}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-4 border-t pt-4 flex gap-2">
              {selectedOrder.status === 'HELD' && (
                <button onClick={() => { handleRecall(selectedOrder.id); setSelectedOrder(null); }}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700">
                  <Play size={16} /> Recall Order
                </button>
              )}
              {['DRAFT', 'CONFIRMED'].includes(selectedOrder.status) && (
                <button onClick={() => { handleHold(selectedOrder.id); setSelectedOrder(null); }}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-yellow-500 text-white rounded-lg hover:bg-yellow-600">
                  <Pause size={16} /> Hold Order
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
