import { useState, useEffect } from 'react';
import { CreditCard, XCircle, CheckCircle, Flag, Banknote } from 'lucide-react';
import { api } from '../api/client';

type Tab = 'payments' | 'refunds' | 'chargebacks' | 'disputes' | 'payouts';

export default function PaymentsPage() {
  const [payments, setPayments] = useState<any[]>([]);
  const [refunds, setRefunds] = useState<any[]>([]);
  const [chargebacks, setChargebacks] = useState<any[]>([]);
  const [disputes, setDisputes] = useState<any[]>([]);
  const [payouts, setPayouts] = useState<any[]>([]);
  const [tab, setTab] = useState<Tab>('payments');
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const [payRes, refRes, cbRes, dispRes, poRes] = await Promise.all([
        api.getPayments(), api.getRefunds(), api.getChargebacks(), api.getDisputes(), api.getPayouts(),
      ]);
      setPayments(payRes.data?.items || []);
      setRefunds(refRes.data || []);
      setChargebacks(cbRes.data || []);
      setDisputes(dispRes.data || []);
      setPayouts(poRes.data || []);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  const handleVoid = async (id: string) => {
    if (!confirm('Void this payment?')) return;
    try { await api.voidPayment(id); loadData(); } catch (e: any) { alert(e.message); }
  };

  const handleSettle = async (id: string) => {
    try { await api.settlePayment(id); loadData(); } catch (e: any) { alert(e.message); }
  };

  const handleChargeback = async (payment: any) => {
    const amount = prompt(`Chargeback amount for ${payment.order?.orderNumber || payment.id} (max ${Number(payment.amount).toFixed(2)}):`, String(payment.amount));
    if (!amount) return;
    const reason = prompt('Reason (optional):') || undefined;
    try { await api.createChargeback({ paymentId: payment.id, amount: Number(amount), reason }); loadData(); } catch (e: any) { alert(e.message); }
  };

  const handleResolve = async (kind: 'chargeback' | 'dispute', id: string, status: string) => {
    try {
      if (kind === 'chargeback') await api.resolveChargeback(id, status);
      else await api.resolveDispute(id, status);
      loadData();
    } catch (e: any) { alert(e.message); }
  };

  const handleNewPayout = async () => {
    const amount = prompt('Payout amount:');
    if (!amount) return;
    try { await api.createPayout({ amount: Number(amount) }); loadData(); } catch (e: any) { alert(e.message); }
  };

  const handlePayoutStatus = async (id: string, status: string) => {
    try { await api.setPayoutStatus(id, status); loadData(); } catch (e: any) { alert(e.message); }
  };

  const statusColor = (s: string) => {
    const colors: Record<string, string> = {
      COMPLETED: 'bg-green-100 text-green-700', AUTHORIZED: 'bg-blue-100 text-blue-700',
      SETTLED: 'bg-purple-100 text-purple-700', RECONCILED: 'bg-gray-100 text-gray-700',
      VOIDED: 'bg-red-100 text-red-700', REFUNDED: 'bg-orange-100 text-orange-700',
      FAILED: 'bg-red-100 text-red-700', DECLINED: 'bg-red-100 text-red-700',
      OPEN: 'bg-red-100 text-red-700', UNDER_REVIEW: 'bg-amber-100 text-amber-700',
      WON: 'bg-green-100 text-green-700', LOST: 'bg-red-100 text-red-700',
      PENDING: 'bg-amber-100 text-amber-700', PROCESSING: 'bg-blue-100 text-blue-700',
    };
    return colors[s] || 'bg-gray-100 text-gray-700';
  };

  if (loading) return <div className="p-6">Loading...</div>;

  const tabs: { key: Tab; label: string }[] = [
    { key: 'payments', label: 'Payments' },
    { key: 'refunds', label: 'Refunds' },
    { key: 'chargebacks', label: `Chargebacks (${chargebacks.length})` },
    { key: 'disputes', label: `Disputes (${disputes.length})` },
    { key: 'payouts', label: `Payouts (${payouts.length})` },
  ];

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2"><CreditCard size={24} /> Payments</h1>
        {tab === 'payouts' && (
          <button onClick={handleNewPayout} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium flex items-center gap-2">
            <Banknote size={16} /> New Payout
          </button>
        )}
      </div>
      <div className="flex gap-2 mb-6 flex-wrap">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} className={`px-4 py-2 rounded-lg font-medium ${tab === t.key ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}>{t.label}</button>
        ))}
      </div>
      {tab === 'payments' && (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">Order</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">Method</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">Amount</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">Status</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">Date</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {payments.map((p) => (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm">{p.order?.orderNumber || '-'}</td>
                  <td className="px-4 py-3 text-sm">{p.method}</td>
                  <td className="px-4 py-3 text-sm font-medium">${Number(p.amount).toFixed(2)}</td>
                  <td className="px-4 py-3"><span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColor(p.status)}`}>{p.status}</span></td>
                  <td className="px-4 py-3 text-sm text-gray-500">{new Date(p.createdAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      {p.status === 'COMPLETED' && <button onClick={() => handleSettle(p.id)} className="p-1 text-purple-600 hover:bg-purple-50 rounded" title="Settle"><CheckCircle size={16} /></button>}
                      {['COMPLETED', 'AUTHORIZED'].includes(p.status) && <button onClick={() => handleVoid(p.id)} className="p-1 text-red-600 hover:bg-red-50 rounded" title="Void"><XCircle size={16} /></button>}
                      {['COMPLETED', 'SETTLED', 'RECONCILED'].includes(p.status) && <button onClick={() => handleChargeback(p)} className="p-1 text-orange-600 hover:bg-orange-50 rounded" title="Chargeback"><Flag size={16} /></button>}
                    </div>
                  </td>
                </tr>
              ))}
              {payments.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">No payments yet</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {tab === 'refunds' && (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">Order</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">Amount</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">Reason</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">Status</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {refunds.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm">{r.order?.orderNumber || '-'}</td>
                  <td className="px-4 py-3 text-sm font-medium text-red-600">${Number(r.amount).toFixed(2)}</td>
                  <td className="px-4 py-3 text-sm">{r.reason || '-'}</td>
                  <td className="px-4 py-3"><span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColor(r.status)}`}>{r.status}</span></td>
                  <td className="px-4 py-3 text-sm text-gray-500">{new Date(r.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
              {refunds.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-500">No refunds yet</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {tab === 'chargebacks' && (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">Payment</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">Amount</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">Reason</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">Status</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">Filed</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {chargebacks.map((c) => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-mono text-xs">{String(c.paymentId).slice(0, 8)}</td>
                  <td className="px-4 py-3 text-sm font-medium text-red-600">${Number(c.amount).toFixed(2)}</td>
                  <td className="px-4 py-3 text-sm">{c.reason || '-'}</td>
                  <td className="px-4 py-3"><span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColor(c.status)}`}>{c.status}</span></td>
                  <td className="px-4 py-3 text-sm text-gray-500">{new Date(c.createdAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    {c.status === 'OPEN' || c.status === 'UNDER_REVIEW' ? (
                      <div className="flex gap-1">
                        <button onClick={() => handleResolve('chargeback', c.id, 'WON')} className="px-2 py-1 text-xs border rounded text-green-700 hover:bg-green-50">Won</button>
                        <button onClick={() => handleResolve('chargeback', c.id, 'LOST')} className="px-2 py-1 text-xs border rounded text-red-700 hover:bg-red-50">Lost</button>
                      </div>
                    ) : <span className="text-xs text-gray-400">Resolved</span>}
                  </td>
                </tr>
              ))}
              {chargebacks.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">No chargebacks</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {tab === 'disputes' && (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">Payment</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">Amount</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">Reason</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">Status</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">Filed</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {disputes.map((d) => (
                <tr key={d.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-mono text-xs">{String(d.paymentId).slice(0, 8)}</td>
                  <td className="px-4 py-3 text-sm font-medium text-orange-600">${Number(d.amount).toFixed(2)}</td>
                  <td className="px-4 py-3 text-sm">{d.reason || '-'}</td>
                  <td className="px-4 py-3"><span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColor(d.status)}`}>{d.status}</span></td>
                  <td className="px-4 py-3 text-sm text-gray-500">{new Date(d.filedAt || d.createdAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    {d.status === 'OPEN' || d.status === 'UNDER_REVIEW' ? (
                      <div className="flex gap-1">
                        <button onClick={() => handleResolve('dispute', d.id, 'WON')} className="px-2 py-1 text-xs border rounded text-green-700 hover:bg-green-50">Won</button>
                        <button onClick={() => handleResolve('dispute', d.id, 'LOST')} className="px-2 py-1 text-xs border rounded text-red-700 hover:bg-red-50">Lost</button>
                      </div>
                    ) : <span className="text-xs text-gray-400">Resolved</span>}
                  </td>
                </tr>
              ))}
              {disputes.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">No disputes</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {tab === 'payouts' && (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">Amount</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">Currency</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">Status</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">Created</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {payouts.map((po) => (
                <tr key={po.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-medium">${Number(po.amount).toFixed(2)}</td>
                  <td className="px-4 py-3 text-sm">{po.currency}</td>
                  <td className="px-4 py-3"><span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColor(po.status)}`}>{po.status}</span></td>
                  <td className="px-4 py-3 text-sm text-gray-500">{new Date(po.createdAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      {po.status === 'PENDING' && <button onClick={() => handlePayoutStatus(po.id, 'PROCESSING')} className="px-2 py-1 text-xs border rounded text-blue-700 hover:bg-blue-50">Process</button>}
                      {po.status === 'PROCESSING' && <button onClick={() => handlePayoutStatus(po.id, 'COMPLETED')} className="px-2 py-1 text-xs border rounded text-green-700 hover:bg-green-50">Complete</button>}
                      {['PENDING', 'PROCESSING'].includes(po.status) && <button onClick={() => handlePayoutStatus(po.id, 'FAILED')} className="px-2 py-1 text-xs border rounded text-red-700 hover:bg-red-50">Fail</button>}
                    </div>
                  </td>
                </tr>
              ))}
              {payouts.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-500">No payouts</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
