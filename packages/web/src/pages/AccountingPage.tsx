import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { DollarSign, TrendingUp, TrendingDown, ArrowUpRight, BarChart3, FileText, Receipt, PieChart, Calendar } from 'lucide-react';

type Tab = 'entries' | 'reconciliation' | 'tax' | 'cogs' | 'expenses' | 'invoices' | 'pnl';

export default function AccountingPage() {
  const [tab, setTab] = useState<Tab>('entries');
  const [entries, setEntries] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [filter, setFilter] = useState({ type: '', status: '' });
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ type: 'EXPENSE', amount: '', description: '' });

  // Financial data
  const [reconciliations, setReconciliations] = useState<any[]>([]);
  const [taxReport, setTaxReport] = useState<any>(null);
  const [cogsReport, setCogsReport] = useState<any>(null);
  const [expenses, setExpenses] = useState<any>(null);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [pnl, setPnl] = useState<any>(null);
  const [dateRange, setDateRange] = useState({ startDate: '', endDate: '' });

  const load = async () => {
    const params: Record<string, string> = {};
    if (filter.type) params.type = filter.type;
    if (filter.status) params.status = filter.status;
    const [entRes, sumRes] = await Promise.all([
      api.getAccountingEntries(params),
      api.getAccountingSummary(params),
    ]);
    setEntries(entRes.data || []);
    setSummary(sumRes.data);
  };

  const loadTab = async () => {
    const dr: Record<string, string> = {};
    if (dateRange.startDate) dr.startDate = dateRange.startDate;
    if (dateRange.endDate) dr.endDate = dateRange.endDate;
    switch (tab) {
      case 'reconciliation': {
        const res = await api.getReconciliationHistory();
        setReconciliations(res.data || []);
        break;
      }
      case 'tax': {
        const res = await api.getTaxReport(dr);
        setTaxReport(res.data);
        break;
      }
      case 'cogs': {
        const res = await api.getCogsReport(dr);
        setCogsReport(res.data);
        break;
      }
      case 'expenses': {
        const res = await api.getExpenses(dr);
        setExpenses(res.data);
        break;
      }
      case 'invoices': {
        const res = await api.getInvoices();
        setInvoices(res.data || []);
        break;
      }
      case 'pnl': {
        const res = await api.getPnL(dr);
        setPnl(res.data);
        break;
      }
    }
  };

  useEffect(() => { load(); }, [filter]);
  useEffect(() => { loadTab(); }, [tab, dateRange]);

  const createEntry = async () => {
    await api.createAccountingEntry({ type: form.type, amount: Number(form.amount), description: form.description });
    setShowForm(false);
    setForm({ type: 'EXPENSE', amount: '', description: '' });
    load();
  };

  const reconcile = async (id: string) => {
    await api.reconcileEntry(id);
    load();
  };

  const voidEntry = async (id: string) => {
    if (!confirm('Void this entry? A corrective entry will be created.')) return;
    await api.voidEntry(id);
    load();
  };

  const generateRecon = async () => {
    const date = new Date().toISOString().split('T')[0];
    await api.generateDailyReconciliation(date);
    loadTab();
  };

  const TYPE_COLORS: Record<string, string> = {
    PAYMENT: 'bg-green-100 text-green-800',
    REFUND: 'bg-red-100 text-red-800',
    EXPENSE: 'bg-orange-100 text-orange-800',
    ADJUSTMENT: 'bg-blue-100 text-blue-800',
    TRANSFER: 'bg-purple-100 text-purple-800',
  };

  const STATUS_COLORS: Record<string, string> = {
    DRAFT: 'bg-gray-100 text-gray-800',
    POSTED: 'bg-blue-100 text-blue-800',
    RECONCILED: 'bg-green-100 text-green-800',
    VOIDED: 'bg-red-100 text-red-800',
    PENDING: 'bg-yellow-100 text-yellow-800',
    DISCREPANCY: 'bg-orange-100 text-orange-800',
  };

  const tabItems = [
    { id: 'entries' as Tab, label: 'Entries', icon: FileText },
    { id: 'reconciliation' as Tab, label: 'Reconciliation', icon: Calendar },
    { id: 'tax' as Tab, label: 'Tax Report', icon: Receipt },
    { id: 'cogs' as Tab, label: 'COGS', icon: BarChart3 },
    { id: 'expenses' as Tab, label: 'Expenses', icon: DollarSign },
    { id: 'invoices' as Tab, label: 'Invoices', icon: FileText },
    { id: 'pnl' as Tab, label: 'P&L', icon: PieChart },
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Financial OS</h1>
          <p className="text-gray-500">Accounting, reconciliation, tax, and financial reporting</p>
        </div>
        {tab === 'entries' && (
          <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700">
            <DollarSign size={18} /> New Entry
          </button>
        )}
        {tab === 'reconciliation' && (
          <button onClick={generateRecon} className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700">
            <Calendar size={18} /> Generate Today
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
        {tabItems.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
              tab === t.id ? 'bg-white shadow text-blue-700 font-medium' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <t.icon size={14} />
            {t.label}
          </button>
        ))}
      </div>

      {/* Date Range Filter (for most tabs) */}
      {tab !== 'entries' && tab !== 'invoices' && (
        <div className="flex gap-3">
          <input type="date" value={dateRange.startDate} onChange={e => setDateRange({ ...dateRange, startDate: e.target.value })} className="border rounded px-3 py-2 text-sm" />
          <input type="date" value={dateRange.endDate} onChange={e => setDateRange({ ...dateRange, endDate: e.target.value })} className="border rounded px-3 py-2 text-sm" />
        </div>
      )}

      {/* Summary Cards (entries tab) */}
      {tab === 'entries' && summary && (
        <div className="grid grid-cols-4 gap-4">
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <div className="flex items-center gap-2 text-green-600 mb-1"><TrendingUp size={18} /> Income</div>
            <div className="text-2xl font-bold">${summary.totalIncome?.toFixed(2)}</div>
          </div>
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <div className="flex items-center gap-2 text-red-600 mb-1"><TrendingDown size={18} /> Refunds</div>
            <div className="text-2xl font-bold">${summary.totalRefunds?.toFixed(2)}</div>
          </div>
          <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
            <div className="flex items-center gap-2 text-orange-600 mb-1"><DollarSign size={18} /> Expenses</div>
            <div className="text-2xl font-bold">${summary.totalExpenses?.toFixed(2)}</div>
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-center gap-2 text-blue-600 mb-1"><ArrowUpRight size={18} /> Net Revenue</div>
            <div className="text-2xl font-bold">${summary.netRevenue?.toFixed(2)}</div>
          </div>
        </div>
      )}

      {/* Entries Tab */}
      {tab === 'entries' && (
        <>
          <div className="flex gap-3">
            <select value={filter.type} onChange={e => setFilter({ ...filter, type: e.target.value })} className="border rounded px-3 py-2">
              <option value="">All Types</option>
              <option value="PAYMENT">Payment</option>
              <option value="REFUND">Refund</option>
              <option value="EXPENSE">Expense</option>
              <option value="ADJUSTMENT">Adjustment</option>
              <option value="TRANSFER">Transfer</option>
            </select>
            <select value={filter.status} onChange={e => setFilter({ ...filter, status: e.target.value })} className="border rounded px-3 py-2">
              <option value="">All Statuses</option>
              <option value="DRAFT">Draft</option>
              <option value="POSTED">Posted</option>
              <option value="RECONCILED">Reconciled</option>
              <option value="VOIDED">Voided</option>
            </select>
          </div>

          {showForm && (
            <div className="bg-white rounded-lg border p-4 space-y-3">
              <h3 className="font-semibold">New Accounting Entry</h3>
              <div className="grid grid-cols-4 gap-3">
                <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} className="border rounded px-3 py-2">
                  <option value="EXPENSE">Expense</option>
                  <option value="PAYMENT">Payment</option>
                  <option value="REFUND">Refund</option>
                  <option value="ADJUSTMENT">Adjustment</option>
                </select>
                <input placeholder="Amount" type="number" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} className="border rounded px-3 py-2" />
                <input placeholder="Description" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className="border rounded px-3 py-2" />
                <button onClick={createEntry} className="bg-green-600 text-white rounded px-4 py-2 hover:bg-green-700">Create</button>
              </div>
            </div>
          )}

          <div className="bg-white rounded-lg border">
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="text-left px-4 py-3 text-sm font-medium">Date</th>
                  <th className="text-left px-4 py-3 text-sm font-medium">Type</th>
                  <th className="text-left px-4 py-3 text-sm font-medium">Description</th>
                  <th className="text-right px-4 py-3 text-sm font-medium">Amount</th>
                  <th className="text-left px-4 py-3 text-sm font-medium">Status</th>
                  <th className="text-right px-4 py-3 text-sm font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {entries.map(e => (
                  <tr key={e.id} className="border-b hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm">{new Date(e.postedAt).toLocaleDateString()}</td>
                    <td className="px-4 py-3"><span className={`text-xs px-2 py-1 rounded ${TYPE_COLORS[e.type] || ''}`}>{e.type}</span></td>
                    <td className="px-4 py-3 text-sm">{e.description || '-'}</td>
                    <td className="px-4 py-3 text-sm text-right font-mono">${Number(e.amount).toFixed(2)}</td>
                    <td className="px-4 py-3"><span className={`text-xs px-2 py-1 rounded ${STATUS_COLORS[e.status] || ''}`}>{e.status}</span></td>
                    <td className="px-4 py-3 text-right">
                      {e.status === 'POSTED' && (
                        <>
                          <button onClick={() => reconcile(e.id)} className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded hover:bg-green-200 mr-1">Reconcile</button>
                          <button onClick={() => voidEntry(e.id)} className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded hover:bg-red-200">Void</button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
                {entries.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">No entries found</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Reconciliation Tab */}
      {tab === 'reconciliation' && (
        <div className="bg-white rounded-lg border">
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 text-sm font-medium">Date</th>
                <th className="text-right px-4 py-3 text-sm font-medium">Sales</th>
                <th className="text-right px-4 py-3 text-sm font-medium">Payments</th>
                <th className="text-right px-4 py-3 text-sm font-medium">Refunds</th>
                <th className="text-right px-4 py-3 text-sm font-medium">Expected</th>
                <th className="text-right px-4 py-3 text-sm font-medium">Actual</th>
                <th className="text-right px-4 py-3 text-sm font-medium">Variance</th>
                <th className="text-left px-4 py-3 text-sm font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {reconciliations.map(r => (
                <tr key={r.id} className="border-b hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm">{new Date(r.date).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-sm text-right font-mono">${Number(r.totalSales).toFixed(2)}</td>
                  <td className="px-4 py-3 text-sm text-right font-mono">${Number(r.totalPayments).toFixed(2)}</td>
                  <td className="px-4 py-3 text-sm text-right font-mono">${Number(r.totalRefunds).toFixed(2)}</td>
                  <td className="px-4 py-3 text-sm text-right font-mono">${Number(r.expectedBalance).toFixed(2)}</td>
                  <td className="px-4 py-3 text-sm text-right font-mono">{r.actualBalance != null ? `$${Number(r.actualBalance).toFixed(2)}` : '-'}</td>
                  <td className={`px-4 py-3 text-sm text-right font-mono ${r.variance && Math.abs(Number(r.variance)) > 0.01 ? 'text-red-600 font-semibold' : ''}`}>
                    {r.variance != null ? `$${Number(r.variance).toFixed(2)}` : '-'}
                  </td>
                  <td className="px-4 py-3"><span className={`text-xs px-2 py-1 rounded ${STATUS_COLORS[r.status] || ''}`}>{r.status}</span></td>
                </tr>
              ))}
              {reconciliations.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-500">No reconciliations yet</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {/* Tax Report Tab */}
      {tab === 'tax' && taxReport && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="text-sm text-blue-600 mb-1">Taxable Revenue</div>
              <div className="text-2xl font-bold">${taxReport.taxableRevenue?.toFixed(2)}</div>
            </div>
            <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
              <div className="text-sm text-orange-600 mb-1">Tax Collected ({taxReport.taxRate}%)</div>
              <div className="text-2xl font-bold">${taxReport.totalTaxCollected?.toFixed(2)}</div>
            </div>
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <div className="text-sm text-green-600 mb-1">Orders</div>
              <div className="text-2xl font-bold">{taxReport.orderCount}</div>
            </div>
          </div>
        </div>
      )}

      {/* COGS Tab */}
      {tab === 'cogs' && cogsReport && (
        <div className="space-y-4">
          <div className="grid grid-cols-4 gap-4">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="text-sm text-blue-600 mb-1">Revenue</div>
              <div className="text-2xl font-bold">${cogsReport.totalRevenue?.toFixed(2)}</div>
            </div>
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <div className="text-sm text-red-600 mb-1">COGS</div>
              <div className="text-2xl font-bold">${cogsReport.totalCOGS?.toFixed(2)}</div>
            </div>
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <div className="text-sm text-green-600 mb-1">Gross Profit</div>
              <div className="text-2xl font-bold">${cogsReport.grossProfit?.toFixed(2)}</div>
            </div>
            <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
              <div className="text-sm text-purple-600 mb-1">Margin</div>
              <div className="text-2xl font-bold">{cogsReport.marginPercent?.toFixed(1)}%</div>
            </div>
          </div>
          {cogsReport.productBreakdown && (
            <div className="bg-white rounded-lg border">
              <table className="w-full">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="text-left px-4 py-3 text-sm font-medium">Product</th>
                    <th className="text-right px-4 py-3 text-sm font-medium">Qty</th>
                    <th className="text-right px-4 py-3 text-sm font-medium">Revenue</th>
                    <th className="text-right px-4 py-3 text-sm font-medium">Cost</th>
                    <th className="text-right px-4 py-3 text-sm font-medium">Margin</th>
                    <th className="text-right px-4 py-3 text-sm font-medium">Margin %</th>
                  </tr>
                </thead>
                <tbody>
                  {cogsReport.productBreakdown.slice(0, 20).map((p: any) => (
                    <tr key={p.productId} className="border-b hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm">{p.name}</td>
                      <td className="px-4 py-3 text-sm text-right">{p.quantity}</td>
                      <td className="px-4 py-3 text-sm text-right font-mono">${p.revenue.toFixed(2)}</td>
                      <td className="px-4 py-3 text-sm text-right font-mono">${p.cost.toFixed(2)}</td>
                      <td className="px-4 py-3 text-sm text-right font-mono">${p.margin.toFixed(2)}</td>
                      <td className={`px-4 py-3 text-sm text-right font-mono ${p.marginPercent < 20 ? 'text-red-600' : ''}`}>{p.marginPercent.toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Expenses Tab */}
      {tab === 'expenses' && expenses && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
              <div className="text-sm text-orange-600 mb-1">Total Expenses</div>
              <div className="text-2xl font-bold">${expenses.total?.toFixed(2)}</div>
            </div>
          </div>
          {expenses.items && (
            <div className="bg-white rounded-lg border">
              <table className="w-full">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="text-left px-4 py-3 text-sm font-medium">Date</th>
                    <th className="text-left px-4 py-3 text-sm font-medium">Category</th>
                    <th className="text-left px-4 py-3 text-sm font-medium">Vendor</th>
                    <th className="text-right px-4 py-3 text-sm font-medium">Amount</th>
                    <th className="text-left px-4 py-3 text-sm font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {expenses.items.map((e: any) => (
                    <tr key={e.id} className="border-b hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm">{new Date(e.incurredAt).toLocaleDateString()}</td>
                      <td className="px-4 py-3 text-sm">{e.category}</td>
                      <td className="px-4 py-3 text-sm">{e.vendor || '-'}</td>
                      <td className="px-4 py-3 text-sm text-right font-mono">${Number(e.amount).toFixed(2)}</td>
                      <td className="px-4 py-3"><span className={`text-xs px-2 py-1 rounded ${STATUS_COLORS[e.status] || ''}`}>{e.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Invoices Tab */}
      {tab === 'invoices' && (
        <div className="bg-white rounded-lg border">
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 text-sm font-medium">Invoice #</th>
                <th className="text-left px-4 py-3 text-sm font-medium">Customer</th>
                <th className="text-right px-4 py-3 text-sm font-medium">Amount</th>
                <th className="text-left px-4 py-3 text-sm font-medium">Due Date</th>
                <th className="text-left px-4 py-3 text-sm font-medium">Status</th>
                <th className="text-right px-4 py-3 text-sm font-medium">Days Overdue</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map(inv => (
                <tr key={inv.id} className="border-b hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-mono">{inv.invoiceNumber}</td>
                  <td className="px-4 py-3 text-sm">{inv.customer?.name || '-'}</td>
                  <td className="px-4 py-3 text-sm text-right font-mono">${Number(inv.totalAmount).toFixed(2)}</td>
                  <td className="px-4 py-3 text-sm">{inv.dueDate ? new Date(inv.dueDate).toLocaleDateString() : '-'}</td>
                  <td className="px-4 py-3"><span className={`text-xs px-2 py-1 rounded ${STATUS_COLORS[inv.status] || ''}`}>{inv.status}</span></td>
                  <td className={`px-4 py-3 text-sm text-right ${inv.daysOverdue > 0 ? 'text-red-600 font-semibold' : ''}`}>
                    {inv.daysOverdue > 0 ? `${inv.daysOverdue}d` : '-'}
                  </td>
                </tr>
              ))}
              {invoices.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">No invoices</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {/* P&L Tab */}
      {tab === 'pnl' && pnl && (
        <div className="space-y-4">
          <div className="bg-white rounded-lg border p-6">
            <h3 className="text-lg font-semibold mb-4">Profit & Loss Statement</h3>
            <div className="space-y-3">
              <div className="flex justify-between py-2 border-b">
                <span className="text-gray-600">Revenue</span>
                <span className="font-mono font-semibold">${pnl.revenue?.toFixed(2)}</span>
              </div>
              <div className="flex justify-between py-2 border-b text-red-600">
                <span>Less: Refunds</span>
                <span className="font-mono">-${pnl.refunds?.toFixed(2)}</span>
              </div>
              <div className="flex justify-between py-2 border-b text-orange-600">
                <span>Less: COGS</span>
                <span className="font-mono">-${pnl.cogs?.toFixed(2)}</span>
              </div>
              <div className="flex justify-between py-2 border-b bg-green-50 px-3 rounded">
                <span className="font-semibold text-green-700">Gross Profit</span>
                <span className="font-mono font-semibold text-green-700">${pnl.grossProfit?.toFixed(2)}</span>
              </div>
              <div className="flex justify-between py-2 pl-3 text-sm text-gray-500">
                <span>Gross Margin</span>
                <span className="font-mono">{pnl.grossMargin?.toFixed(1)}%</span>
              </div>
              <div className="flex justify-between py-2 border-b text-red-600">
                <span>Less: Expenses</span>
                <span className="font-mono">-${pnl.expenses?.toFixed(2)}</span>
              </div>
              <div className={`flex justify-between py-3 px-3 rounded font-bold text-lg ${pnl.netProfit >= 0 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                <span>Net Profit</span>
                <span className="font-mono">${pnl.netProfit?.toFixed(2)}</span>
              </div>
              <div className="flex justify-between py-2 text-sm text-gray-500">
                <span>Net Margin</span>
                <span className="font-mono">{pnl.netMargin?.toFixed(1)}%</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
