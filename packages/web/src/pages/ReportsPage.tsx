import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { DollarSign, ShoppingBag, TrendingUp, CreditCard, Sun, Layers, Users, Package, ArrowDown, ArrowUp } from 'lucide-react';

export default function ReportsPage() {
  const [tab, setTab] = useState<'sales' | 'today' | 'drilldown' | 'labor' | 'inventory'>('sales');
  const [report, setReport] = useState<any>(null);
  const [daily, setDaily] = useState<any[]>([]);
  const [today, setToday] = useState<any>(null);
  const [drilldown, setDrilldown] = useState<any[]>([]);
  const [labor, setLabor] = useState<any>(null);
  const [inventory, setInventory] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState({ start: '', end: '' });

  useEffect(() => { loadTab(); }, [tab, dateRange]);

  const loadTab = async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (dateRange.start) params.startDate = dateRange.start;
      if (dateRange.end) params.endDate = dateRange.end;

      if (tab === 'sales') {
        const [salesRes, dailyRes] = await Promise.all([
          api.getSalesReport(params),
          api.getDailyReport(params),
        ]);
        setReport(salesRes.data);
        setDaily(dailyRes.data || []);
      } else if (tab === 'today') {
        const res = await api.getTodayReport();
        setToday(res.data);
      } else if (tab === 'drilldown') {
        const res = await api.getDrilldown(params);
        setDrilldown(res.data || []);
      } else if (tab === 'labor') {
        const res = await api.getLaborReport(params);
        setLabor(res.data);
      } else if (tab === 'inventory') {
        const res = await api.getInventoryReport();
        setInventory(res.data);
      }
    } catch (err) {
      console.error('Failed to load report:', err);
    } finally {
      setLoading(false);
    }
  };

  const pct = (curr: number, prev: number) => {
    if (!prev) return curr > 0 ? '+100%' : '0%';
    const change = ((curr - prev) / prev * 100).toFixed(1);
    return Number(change) >= 0 ? `+${change}%` : `${change}%`;
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
        <div className="flex gap-2">
          <input
            type="date"
            value={dateRange.start}
            onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
            className="px-3 py-2 border rounded-lg text-sm"
          />
          <input
            type="date"
            value={dateRange.end}
            onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
            className="px-3 py-2 border rounded-lg text-sm"
          />
        </div>
      </div>

      {/* Tab Bar */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {[
          { key: 'sales', label: 'Sales', icon: DollarSign },
          { key: 'today', label: 'Today', icon: Sun },
          { key: 'drilldown', label: 'Drill-Down', icon: Layers },
          { key: 'labor', label: 'Labor', icon: Users },
          { key: 'inventory', label: 'Inventory', icon: Package },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key as any)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium ${tab === t.key ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            <t.icon size={16} /> {t.label}
          </button>
        ))}
      </div>

      {loading && <div className="text-center py-12 text-gray-400">Loading...</div>}

      {/* TODAY TAB */}
      {!loading && tab === 'today' && today && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white rounded-xl border p-6">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center"><DollarSign size={20} className="text-green-600" /></div>
                <span className="text-sm text-gray-500">Today's Sales</span>
              </div>
              <p className="text-2xl font-bold">${(today.sales || 0).toFixed(2)}</p>
              <p className={`text-xs mt-1 flex items-center gap-1 ${(today.vsYesterday || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {(today.vsYesterday || 0) >= 0 ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
                {pct(today.sales || 0, today.yesterdaySales || 0)} vs yesterday
              </p>
            </div>
            <div className="bg-white rounded-xl border p-6">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center"><ShoppingBag size={20} className="text-blue-600" /></div>
                <span className="text-sm text-gray-500">Orders</span>
              </div>
              <p className="text-2xl font-bold">{today.orders || 0}</p>
              <p className="text-xs text-gray-400 mt-1">Avg ${((today.orders || 0) > 0 ? (today.sales || 0) / (today.orders || 0) : 0).toFixed(2)} per order</p>
            </div>
            <div className="bg-white rounded-xl border p-6">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-lg bg-purple-100 flex items-center justify-center"><TrendingUp size={20} className="text-purple-600" /></div>
                <span className="text-sm text-gray-500">Gross Margin</span>
              </div>
              <p className="text-2xl font-bold">{(today.grossMargin || 0).toFixed(1)}%</p>
            </div>
            <div className="bg-white rounded-xl border p-6">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-lg bg-orange-100 flex items-center justify-center"><CreditCard size={20} className="text-orange-600" /></div>
                <span className="text-sm text-gray-500">Customers</span>
              </div>
              <p className="text-2xl font-bold">{today.customers || 0}</p>
            </div>
          </div>

          {/* Comparisons */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-white rounded-xl border p-6">
              <h3 className="font-semibold mb-3">vs Yesterday</h3>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Yesterday Sales</span>
                  <span className="font-medium">${(today.yesterdaySales || 0).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Change</span>
                  <span className={`font-medium ${(today.vsYesterday || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>{pct(today.sales || 0, today.yesterdaySales || 0)}</span>
                </div>
              </div>
            </div>
            <div className="bg-white rounded-xl border p-6">
              <h3 className="font-semibold mb-3">vs Last Week</h3>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Same Day Last Week</span>
                  <span className="font-medium">${(today.lastWeekSales || 0).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Change</span>
                  <span className={`font-medium ${(today.vsLastWeek || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>{pct(today.sales || 0, today.lastWeekSales || 0)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Inventory Risk */}
          {today.inventoryRisk && (today.inventoryRisk.lowStock > 0 || today.inventoryRisk.outOfStock > 0) && (
            <div className="bg-white rounded-xl border p-6">
              <h3 className="font-semibold mb-3">Inventory Risk</h3>
              <div className="flex gap-6">
                <div className="text-center">
                  <div className="text-2xl font-bold text-yellow-600">{today.inventoryRisk.lowStock}</div>
                  <div className="text-xs text-gray-500">Low Stock</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-red-600">{today.inventoryRisk.outOfStock}</div>
                  <div className="text-xs text-gray-500">Out of Stock</div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* SALES TAB (original) */}
      {!loading && tab === 'sales' && (
        <div className="space-y-6">
          <div className="grid grid-cols-4 gap-4">
            <div className="bg-white rounded-xl border p-6">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center"><DollarSign size={20} className="text-green-600" /></div>
                <span className="text-sm text-gray-500">Revenue</span>
              </div>
              <p className="text-2xl font-bold">${(report?.totalRevenue || 0).toFixed(2)}</p>
            </div>
            <div className="bg-white rounded-xl border p-6">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center"><ShoppingBag size={20} className="text-blue-600" /></div>
                <span className="text-sm text-gray-500">Orders</span>
              </div>
              <p className="text-2xl font-bold">{report?.totalOrders || 0}</p>
            </div>
            <div className="bg-white rounded-xl border p-6">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-lg bg-purple-100 flex items-center justify-center"><TrendingUp size={20} className="text-purple-600" /></div>
                <span className="text-sm text-gray-500">Avg Order</span>
              </div>
              <p className="text-2xl font-bold">${(report?.averageOrderValue || 0).toFixed(2)}</p>
            </div>
            <div className="bg-white rounded-xl border p-6">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-lg bg-orange-100 flex items-center justify-center"><CreditCard size={20} className="text-orange-600" /></div>
                <span className="text-sm text-gray-500">Tax Collected</span>
              </div>
              <p className="text-2xl font-bold">${(report?.totalTax || 0).toFixed(2)}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div className="bg-white rounded-xl border p-6">
              <h2 className="text-lg font-bold mb-4">Top Products</h2>
              {report?.topProducts?.length > 0 ? (
                <div className="space-y-3">
                  {report.topProducts.map((p: any, i: number) => (
                    <div key={p.productId} className="flex items-center gap-3">
                      <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-xs flex items-center justify-center font-bold">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{p.productName}</p>
                        <p className="text-xs text-gray-500">{p.quantitySold} sold</p>
                      </div>
                      <span className="text-sm font-bold">${p.revenue.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              ) : <p className="text-gray-400 text-center py-8">No sales data yet</p>}
            </div>
            <div className="bg-white rounded-xl border p-6">
              <h2 className="text-lg font-bold mb-4">Payment Methods</h2>
              {report?.paymentBreakdown?.length > 0 ? (
                <div className="space-y-3">
                  {report.paymentBreakdown.map((p: any) => (
                    <div key={p.method} className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">{p.method}</p>
                        <p className="text-xs text-gray-500">{p.count} transactions</p>
                      </div>
                      <span className="text-sm font-bold">${p.total.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              ) : <p className="text-gray-400 text-center py-8">No payment data yet</p>}
            </div>
          </div>

          <div className="bg-white rounded-xl border p-6">
            <h2 className="text-lg font-bold mb-4">Daily Sales</h2>
            {daily.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-start text-xs font-medium text-gray-500 uppercase">Date</th>
                      <th className="px-4 py-2 text-start text-xs font-medium text-gray-500 uppercase">Orders</th>
                      <th className="px-4 py-2 text-start text-xs font-medium text-gray-500 uppercase">Revenue</th>
                      <th className="px-4 py-2 text-start text-xs font-medium text-gray-500 uppercase">Tax</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {daily.slice().reverse().map((d) => (
                      <tr key={d.date}>
                        <td className="px-4 py-2 text-sm">{d.date}</td>
                        <td className="px-4 py-2 text-sm">{d.totalOrders}</td>
                        <td className="px-4 py-2 text-sm font-medium">${d.totalRevenue.toFixed(2)}</td>
                        <td className="px-4 py-2 text-sm">${d.totalTax.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="text-gray-400 text-center py-8">No daily data yet</p>}
          </div>
        </div>
      )}

      {/* DRILLDOWN TAB */}
      {!loading && tab === 'drilldown' && (
        <div className="bg-white rounded-xl border p-6">
          <h2 className="text-lg font-bold mb-4">Drill-Down Hierarchy</h2>
          {drilldown.length > 0 ? (
            <div className="space-y-3">
              {drilldown.map((item: any, i: number) => (
                <div key={i} className="border rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium">{item.label}</span>
                    <span className="text-sm font-bold">${(item.revenue || 0).toFixed(2)}</span>
                  </div>
                  <div className="flex gap-4 text-xs text-gray-500">
                    <span>{item.orders || 0} orders</span>
                    <span>Avg ${(item.orders > 0 ? (item.revenue || 0) / (item.orders || 1) : 0).toFixed(2)}</span>
                  </div>
                  {item.children?.length > 0 && (
                    <div className="mt-3 ml-4 space-y-2">
                      {item.children.map((child: any, j: number) => (
                        <div key={j} className="flex items-center justify-between text-sm border-t pt-2">
                          <span className="text-gray-600">{child.label}</span>
                          <span className="font-medium">${(child.revenue || 0).toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : <p className="text-gray-400 text-center py-8">No drill-down data available</p>}
        </div>
      )}

      {/* LABOR TAB */}
      {!loading && tab === 'labor' && labor && (
        <div className="space-y-6">
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-white rounded-xl border p-6 text-center">
              <div className="text-2xl font-bold">{(labor.totalHours || 0).toFixed(1)}</div>
              <div className="text-sm text-gray-500">Total Hours</div>
            </div>
            <div className="bg-white rounded-xl border p-6 text-center">
              <div className="text-2xl font-bold">${(labor.totalCost || 0).toFixed(2)}</div>
              <div className="text-sm text-gray-500">Total Labor Cost</div>
            </div>
            <div className="bg-white rounded-xl border p-6 text-center">
              <div className="text-2xl font-bold">{labor.employeeCount || 0}</div>
              <div className="text-sm text-gray-500">Active Employees</div>
            </div>
          </div>
          <div className="bg-white rounded-xl border p-6">
            <h2 className="text-lg font-bold mb-4">By Employee</h2>
            {labor.byEmployee?.length > 0 ? (
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-start text-xs font-medium text-gray-500 uppercase">Employee</th>
                    <th className="px-4 py-2 text-start text-xs font-medium text-gray-500 uppercase">Hours</th>
                    <th className="px-4 py-2 text-start text-xs font-medium text-gray-500 uppercase">Cost</th>
                    <th className="px-4 py-2 text-start text-xs font-medium text-gray-500 uppercase">Orders</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {labor.byEmployee.map((e: any) => (
                    <tr key={e.employeeId}>
                      <td className="px-4 py-2 text-sm font-medium">{e.name}</td>
                      <td className="px-4 py-2 text-sm">{(e.hours || 0).toFixed(1)}</td>
                      <td className="px-4 py-2 text-sm">${(e.cost || 0).toFixed(2)}</td>
                      <td className="px-4 py-2 text-sm">{e.orders || 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="text-gray-400 text-center py-8">No labor data</p>}
          </div>
        </div>
      )}

      {/* INVENTORY TAB */}
      {!loading && tab === 'inventory' && inventory && (
        <div className="space-y-6">
          <div className="grid grid-cols-4 gap-4">
            <div className="bg-white rounded-xl border p-6 text-center">
              <div className="text-2xl font-bold">${(inventory.atCost || 0).toFixed(2)}</div>
              <div className="text-sm text-gray-500">Value at Cost</div>
            </div>
            <div className="bg-white rounded-xl border p-6 text-center">
              <div className="text-2xl font-bold">${(inventory.atRetail || 0).toFixed(2)}</div>
              <div className="text-sm text-gray-500">Value at Retail</div>
            </div>
            <div className="bg-white rounded-xl border p-6 text-center">
              <div className="text-2xl font-bold">{inventory.lowStock || 0}</div>
              <div className="text-sm text-gray-500">Low Stock Items</div>
            </div>
            <div className="bg-white rounded-xl border p-6 text-center">
              <div className="text-2xl font-bold text-red-600">{inventory.outOfStock || 0}</div>
              <div className="text-sm text-gray-500">Out of Stock</div>
            </div>
          </div>
          {inventory.margin !== undefined && (
            <div className="bg-white rounded-xl border p-6 text-center">
              <div className="text-sm text-gray-500 mb-1">Overall Margin</div>
              <div className="text-3xl font-bold text-green-600">{inventory.margin}%</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
