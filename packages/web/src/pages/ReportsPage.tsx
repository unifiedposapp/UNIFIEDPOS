import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { DollarSign, ShoppingBag, TrendingUp, CreditCard, Sun, Layers, Users, Package, ArrowDown, ArrowUp, Clock, Flame, Snowflake } from 'lucide-react';

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export default function ReportsPage() {
  const [tab, setTab] = useState<'sales' | 'today' | 'drilldown' | 'labor' | 'inventory' | 'patterns' | 'deadstock'>('sales');
  const [report, setReport] = useState<any>(null);
  const [daily, setDaily] = useState<any[]>([]);
  const [today, setToday] = useState<any>(null);
  const [drilldown, setDrilldown] = useState<any[]>([]);
  const [labor, setLabor] = useState<any>(null);
  const [inventory, setInventory] = useState<any>(null);
  const [patterns, setPatterns] = useState<any>(null);
  const [deadStock, setDeadStock] = useState<any>(null);
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
      } else if (tab === 'patterns') {
        // The heatmap is bucketed in the store's own timezone, not the browser's.
        const res = await api.getPeakHoursReport({ days: windowDays(90) });
        setPatterns(res.data);
      } else if (tab === 'deadstock') {
        const res = await api.getDeadStockReport({ days: windowDays(365) });
        setDeadStock(res.data);
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

  /** The trading-pattern endpoints work in rolling day counts, not date pairs. */
  const windowDays = (fallback: number) => {
    if (!dateRange.start) return String(fallback);
    const start = new Date(dateRange.start).getTime();
    const end = dateRange.end ? new Date(dateRange.end).getTime() : Date.now();
    const span = Math.round((end - start) / 86_400_000) || fallback;
    return String(Math.min(730, Math.max(7, span)));
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
          { key: 'patterns', label: 'Peak Hours', icon: Clock },
          { key: 'deadstock', label: 'Dead Stock', icon: Snowflake },
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

      {/* PEAK HOURS TAB — day × hour heatmap in the store's own timezone */}
      {!loading && tab === 'patterns' && patterns && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white rounded-xl border p-6">
              <div className="text-sm text-gray-500">Busiest slot</div>
              <p className="text-xl font-bold flex items-center gap-2"><Flame size={18} className="text-orange-500" />{patterns.peak?.name || '—'}</p>
              <p className="text-xs text-gray-400 mt-1">{patterns.peak?.orders || 0} orders · ${(patterns.peak?.revenue || 0).toFixed(2)}</p>
            </div>
            <div className="bg-white rounded-xl border p-6">
              <div className="text-sm text-gray-500">Orders analysed</div>
              <p className="text-2xl font-bold">{patterns.totalOrders}</p>
              <p className="text-xs text-gray-400 mt-1">last {patterns.days} days · all channels</p>
            </div>
            <div className="bg-white rounded-xl border p-6">
              <div className="text-sm text-gray-500">Peak concentration</div>
              <p className="text-2xl font-bold">{Math.round((patterns.concentration || 0) * 100)}%</p>
              <p className="text-xs text-gray-400 mt-1">of orders in the 10 busiest slots</p>
            </div>
            <div className="bg-white rounded-xl border p-6">
              <div className="text-sm text-gray-500">Online channel peak</div>
              <p className="text-lg font-bold">{patterns.online?.peak?.name || 'no web orders'}</p>
              <p className="text-xs text-gray-400 mt-1">{patterns.online?.orders || 0} web orders · ${(patterns.online?.revenue || 0).toFixed(2)}</p>
            </div>
          </div>

          <div className="bg-white rounded-xl border p-6 overflow-x-auto">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-bold">When the shop is busy</h2>
              <span className="text-xs text-gray-400">times shown in {patterns.timezone}</span>
            </div>
            <Heatmap grid={patterns.grid} />
            <div className="mt-4 flex flex-wrap gap-6 text-xs text-gray-500">
              <div>
                <span className="font-medium text-gray-700">Quietest slots:</span>{' '}
                {patterns.quietest?.length
                  ? patterns.quietest.map((c: any) => `${WEEKDAYS[c.day].slice(0, 3)} ${String(c.hour).padStart(2, '0')}:00`).join(', ')
                  : 'every slot traded'}
                {' '}— candidates for staff cuts or a promo.
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div className="bg-white rounded-xl border p-6">
              <h2 className="text-lg font-bold mb-3">By day</h2>
              <BarList rows={patterns.byDay.map((d: any) => ({ label: d.name, value: d.orders, extra: `$${d.revenue.toFixed(2)}` }))} />
            </div>
            <div className="bg-white rounded-xl border p-6">
              <h2 className="text-lg font-bold mb-3">By hour</h2>
              <BarList rows={patterns.byHour.filter((h: any) => h.orders > 0).map((h: any) => ({ label: `${String(h.hour).padStart(2, '0')}:00`, value: h.orders, extra: `$${h.revenue.toFixed(2)}` }))} />
            </div>
          </div>
        </div>
      )}

      {/* DEAD STOCK TAB */}
      {!loading && tab === 'deadstock' && deadStock && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white rounded-xl border p-6">
              <div className="text-sm text-gray-500">Cash asleep</div>
              <p className="text-2xl font-bold text-red-600">${(deadStock.summary?.costTied || 0).toFixed(2)}</p>
              <p className="text-xs text-gray-400 mt-1">{deadStock.summary?.pctOfStockValue || 0}% of stock value at cost</p>
            </div>
            <div className="bg-white rounded-xl border p-6">
              <div className="text-sm text-gray-500">Skus not moving</div>
              <p className="text-2xl font-bold">{deadStock.summary?.skus || 0}</p>
              <p className="text-xs text-gray-400 mt-1">{deadStock.summary?.units || 0} units of {(deadStock.summary?.skusTracked || 0)} tracked lines</p>
            </div>
            <div className="bg-white rounded-xl border p-6">
              <div className="text-sm text-gray-500">By severity</div>
              <p className="text-sm mt-1">
                <span className="text-amber-600 font-medium">{deadStock.summary?.bySeverity?.SLOW || 0} slow</span> ·{' '}
                <span className="text-orange-600 font-medium">{deadStock.summary?.bySeverity?.DEAD || 0} dead</span> ·{' '}
                <span className="text-red-600 font-medium">{deadStock.summary?.bySeverity?.FROZEN || 0} frozen</span>
              </p>
              <p className="text-xs text-gray-400 mt-1">
                &gt;{deadStock.thresholds?.slowDays}d / &gt;{deadStock.thresholds?.deadDays}d / &gt;{deadStock.thresholds?.frozenDays}d idle
              </p>
            </div>
            <div className="bg-white rounded-xl border p-6">
              <div className="text-sm text-gray-500">Worst line</div>
              <p className="text-base font-bold truncate">{deadStock.summary?.worst?.name || '—'}</p>
              <p className="text-xs text-gray-400 mt-1">${(deadStock.summary?.worst?.costValue || 0).toFixed(2)} at cost · {deadStock.summary?.worst?.daysIdle ?? 0} days idle</p>
            </div>
          </div>

          <div className="bg-white rounded-xl border p-6">
            <h2 className="text-lg font-bold mb-4">Stock that is not selling</h2>
            {deadStock.items?.length ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-start text-xs font-medium text-gray-500 uppercase">Product</th>
                      <th className="px-4 py-2 text-start text-xs font-medium text-gray-500 uppercase">On hand</th>
                      <th className="px-4 py-2 text-start text-xs font-medium text-gray-500 uppercase">Last sold</th>
                      <th className="px-4 py-2 text-start text-xs font-medium text-gray-500 uppercase">Idle</th>
                      <th className="px-4 py-2 text-start text-xs font-medium text-gray-500 uppercase">Cover</th>
                      <th className="px-4 py-2 text-start text-xs font-medium text-gray-500 uppercase">Severity</th>
                      <th className="px-4 py-2 text-start text-xs font-medium text-gray-500 uppercase">Suggested</th>
                      <th className="px-4 py-2 text-end text-xs font-medium text-gray-500 uppercase">Cash tied</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {deadStock.items.map((item: any) => (
                      <tr key={item.productId} className="hover:bg-gray-50">
                        <td className="px-4 py-2">
                          <p className="text-sm font-medium">{item.name}</p>
                          <p className="text-xs text-gray-400">{item.sku || '—'}{item.categoryName ? ` · ${item.categoryName}` : ''}</p>
                        </td>
                        <td className="px-4 py-2 text-sm">{item.quantity}</td>
                        <td className="px-4 py-2 text-sm text-gray-500">{item.lastSoldAt ? new Date(item.lastSoldAt).toLocaleDateString() : 'never'}</td>
                        <td className="px-4 py-2 text-sm">{item.daysIdle}d</td>
                        <td className="px-4 py-2 text-sm text-gray-500">{item.monthsOfCover != null ? `${item.monthsOfCover} mo` : 'no sales'}</td>
                        <td className="px-4 py-2">
                          <span className={`text-xs px-2 py-1 rounded ${SEVERITY_TONES[item.severity] || 'bg-gray-100 text-gray-700'}`}>{item.severity}</span>
                        </td>
                        <td className="px-4 py-2 text-xs text-gray-600">{ACTION_LABELS[item.suggestedAction] || item.suggestedAction}</td>
                        <td className="px-4 py-2 text-end text-sm font-bold">${item.costValue.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-gray-400 text-center py-8">Nothing has sat this long — every stocked line sold inside {deadStock.thresholds?.slowDays} days.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const SEVERITY_TONES: Record<string, string> = {
  SLOW: 'bg-amber-100 text-amber-800',
  DEAD: 'bg-orange-100 text-orange-800',
  FROZEN: 'bg-red-100 text-red-800',
};

const ACTION_LABELS: Record<string, string> = {
  KEEP: 'Keep stocking',
  PROMOTE: 'Feature it / bundle',
  DISCOUNT: 'Discount to clear',
  TRANSFER: 'Move to another location',
  RETURN_TO_SUPPLIER: 'Return to supplier',
  WRITE_OFF: 'Write off',
};

/** Monday-first 7×24 grid; opacity encodes order share so peaks read at a glance. */
function Heatmap({ grid }: { grid: any[] }) {
  const max = Math.max(1, ...(grid || []).map((c: any) => c.orders));
  const cell = (day: number, hour: number) => (grid || []).find((c: any) => c.day === day && c.hour === hour) || { orders: 0, revenue: 0 };
  return (
    <table className="border-separate" style={{ borderSpacing: 2 }}>
      <thead>
        <tr>
          <th />
          {Array.from({ length: 24 }, (_, h) => (
            <th key={h} className="text-[9px] font-normal text-gray-400 w-6">{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {WEEKDAYS.map((name, day) => (
          <tr key={name}>
            <th className="pe-2 text-end text-xs font-medium text-gray-500 whitespace-nowrap">{name.slice(0, 3)}</th>
            {Array.from({ length: 24 }, (_, hour) => {
              const c = cell(day, hour);
              const ratio = c.orders / max;
              return (
                <td
                  key={hour}
                  title={`${name} ${String(hour).padStart(2, '0')}:00 — ${c.orders} orders, $${Number(c.revenue || 0).toFixed(2)}`}
                  className="h-6 w-6 rounded-sm text-center"
                  style={{ background: c.orders ? `rgba(234, 88, 12, ${0.12 + ratio * 0.85})` : '#f3f4f6' }}
                >
                  <span className={`text-[9px] ${ratio > 0.55 ? 'text-white' : 'text-gray-500'}`}>{c.orders || ''}</span>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function BarList({ rows }: { rows: { label: string; value: number; extra?: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2 text-sm">
          <span className="w-16 shrink-0 text-gray-500">{r.label}</span>
          <span className="h-4 rounded bg-blue-500" style={{ width: `${(r.value / max) * 100}%`, minWidth: r.value ? 4 : 0 }} />
          <span className="text-gray-700">{r.value}</span>
          {r.extra && <span className="ms-auto text-xs text-gray-400">{r.extra}</span>}
        </div>
      ))}
      {!rows.length && <p className="text-gray-400 text-sm">No data in this window.</p>}
    </div>
  );
}
