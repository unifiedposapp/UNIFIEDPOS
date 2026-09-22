import { useState, useEffect } from 'react';
import { ArrowRightLeft, ArrowDownToLine, ClipboardList } from 'lucide-react';
import { api } from '../api/client';

export default function TransfersPage() {
  const [tab, setTab] = useState<'transfers' | 'movements' | 'counts'>('transfers');
  const [transfers, setTransfers] = useState<any[]>([]);
  const [movements, setMovements] = useState<any[]>([]);
  const [counts, setCounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const [tRes, mRes, cRes] = await Promise.all([
        api.getTransfers(), api.getInventoryMovements(), api.getStockCounts(),
      ]);
      setTransfers(tRes.data || []);
      setMovements(mRes.data || []);
      setCounts(cRes.data || []);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  const statusColor = (s: string) => {
    const c: Record<string, string> = {
      PENDING: 'bg-yellow-100 text-yellow-700', IN_TRANSIT: 'bg-blue-100 text-blue-700',
      RECEIVED: 'bg-green-100 text-green-700', CANCELLED: 'bg-red-100 text-red-700',
      COMPLETED: 'bg-green-100 text-green-700', DRAFT: 'bg-gray-100 text-gray-700',
    };
    return c[s] || 'bg-gray-100 text-gray-700';
  };

  if (loading) return <div className="p-6">Loading...</div>;

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6 flex items-center gap-2"><ArrowRightLeft size={24} /> Inventory Operations</h1>
      <div className="flex gap-2 mb-6">
        {[
          { key: 'transfers', label: 'Transfers', icon: ArrowRightLeft },
          { key: 'movements', label: 'Movements', icon: ArrowDownToLine },
          { key: 'counts', label: 'Cycle Counts', icon: ClipboardList },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key as any)} className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium ${tab === t.key ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
            <t.icon size={16} /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'transfers' && (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-start px-4 py-3 text-sm font-medium text-gray-600">Status</th>
                <th className="text-start px-4 py-3 text-sm font-medium text-gray-600">Items</th>
                <th className="text-start px-4 py-3 text-sm font-medium text-gray-600">Notes</th>
                <th className="text-start px-4 py-3 text-sm font-medium text-gray-600">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {transfers.map(t => (
                <tr key={t.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3"><span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColor(t.status)}`}>{t.status}</span></td>
                  <td className="px-4 py-3 text-sm">{t.items?.length || 0} items</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{t.notes || '-'}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{new Date(t.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
              {transfers.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-500">No transfers</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'movements' && (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-start px-4 py-3 text-sm font-medium text-gray-600">Product</th>
                <th className="text-start px-4 py-3 text-sm font-medium text-gray-600">Type</th>
                <th className="text-start px-4 py-3 text-sm font-medium text-gray-600">Qty</th>
                <th className="text-start px-4 py-3 text-sm font-medium text-gray-600">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {movements.slice(0, 50).map(m => (
                <tr key={m.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm">{m.balance?.product?.name || '-'}</td>
                  <td className="px-4 py-3"><span className="px-2 py-1 bg-gray-100 rounded-full text-xs">{m.type}</span></td>
                  <td className={`px-4 py-3 text-sm font-medium ${m.quantity > 0 ? 'text-green-600' : 'text-red-600'}`}>{m.quantity > 0 ? '+' : ''}{m.quantity}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{new Date(m.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
              {movements.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-500">No movements</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'counts' && (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-start px-4 py-3 text-sm font-medium text-gray-600">Status</th>
                <th className="text-start px-4 py-3 text-sm font-medium text-gray-600">Items</th>
                <th className="text-start px-4 py-3 text-sm font-medium text-gray-600">Notes</th>
                <th className="text-start px-4 py-3 text-sm font-medium text-gray-600">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {counts.map(c => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3"><span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColor(c.status)}`}>{c.status}</span></td>
                  <td className="px-4 py-3 text-sm">{c.items?.length || 0} items</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{c.notes || '-'}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{new Date(c.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
              {counts.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-500">No cycle counts</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
