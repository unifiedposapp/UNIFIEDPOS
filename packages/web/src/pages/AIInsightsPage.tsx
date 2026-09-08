import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Brain, TrendingUp, AlertTriangle, Star, Users, DollarSign, Sparkles, ShoppingCart, Heart } from 'lucide-react';

export default function AIInsightsPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [applying, setApplying] = useState(false);
  const [applyMsg, setApplyMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = async () => {
    try {
      const res = await api.getAIInsights();
      setData(res.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const loadSuggestions = async () => {
    try {
      const res = await api.getAISuggestions();
      setSuggestions(res.data?.suggestions || []);
    } catch (e) {
      console.error(e);
    }
  };

  // One-click apply: turn the reorder suggestion into a real DRAFT purchase order.
  const applyReorder = async (s: any) => {
    setApplying(true);
    setApplyMsg(null);
    try {
      const res = await api.applyAIReorder({
        items: (s.items || []).map((i: any) => ({ productId: i.productId, quantity: i.suggestedOrder, unitCost: i.unitCost })),
      });
      const po = res.data;
      setApplyMsg({ ok: true, text: `Purchase order created (${po?.items?.length || 0} items, $${Number(po?.totalAmount || 0).toFixed(2)}). Find it under Purchasing.` });
      loadSuggestions();
    } catch (e: any) {
      setApplyMsg({ ok: false, text: e?.message || 'Could not create the purchase order.' });
    } finally {
      setApplying(false);
    }
  };

  useEffect(() => { load(); loadSuggestions(); }, []);

  const PRIORITY_COLORS: Record<string, string> = {
    HIGH: 'border-red-200 bg-red-50',
    MEDIUM: 'border-yellow-200 bg-yellow-50',
    LOW: 'border-blue-200 bg-blue-50',
  };

  const TYPE_ICONS: Record<string, any> = {
    REVENUE: DollarSign,
    INVENTORY: AlertTriangle,
    SALES: TrendingUp,
    CUSTOMER: Users,
    PERFORMANCE: Star,
  };

  const SUGGESTION_ICONS: Record<string, any> = {
    REORDER: ShoppingCart,
    STAFFING: Users,
    WIN_BACK: Heart,
  };

  if (loading) {
    return <div className="p-6"><div className="animate-pulse text-gray-500">Loading insights...</div></div>;
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Brain size={28} className="text-purple-600" />
          AI Business Brain
        </h1>
        <p className="text-gray-500">Intelligent insights and recommendations for your business</p>
      </div>

      {data?.metrics && (
        <div className="grid grid-cols-4 gap-4">
          <div className="bg-white rounded-lg border p-4">
            <div className="text-sm text-gray-500">Total Revenue</div>
            <div className="text-2xl font-bold text-green-600">${data.metrics.totalRevenue?.toFixed(2)}</div>
            <div className="text-xs text-gray-400">{data.metrics.totalOrders} orders</div>
          </div>
          <div className="bg-white rounded-lg border p-4">
            <div className="text-sm text-gray-500">Today's Revenue</div>
            <div className="text-2xl font-bold text-blue-600">${data.metrics.todayRevenue?.toFixed(2)}</div>
            <div className="text-xs text-gray-400">{data.metrics.todayOrders} orders today</div>
          </div>
          <div className="bg-white rounded-lg border p-4">
            <div className="text-sm text-gray-500">Avg Order Value</div>
            <div className="text-2xl font-bold">${data.metrics.avgOrderValue?.toFixed(2)}</div>
          </div>
          <div className="bg-white rounded-lg border p-4">
            <div className="text-sm text-gray-500">Customers</div>
            <div className="text-2xl font-bold">{data.metrics.customerCount}</div>
            {data.metrics.lowStockCount > 0 && (
              <div className="text-xs text-red-500 mt-1">{data.metrics.lowStockCount} low stock items</div>
            )}
          </div>
        </div>
      )}

      {suggestions.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <Sparkles size={18} className="text-purple-600" />
            AI Suggestions — act in one click
          </h2>
          {applyMsg && (
            <div className={`mb-3 text-sm rounded-lg border px-4 py-3 ${applyMsg.ok ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-700'}`}>
              {applyMsg.text}
            </div>
          )}
          <div className="space-y-3">
            {suggestions.map((s: any) => {
              const Icon = SUGGESTION_ICONS[s.type] || Star;
              return (
                <div key={s.id} className={`border rounded-lg p-4 ${PRIORITY_COLORS[s.severity] || 'bg-white'}`}>
                  <div className="flex items-start gap-3">
                    <Icon size={20} className="mt-0.5 flex-shrink-0" />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold">{s.title}</h3>
                        <span className={`text-xs px-2 py-0.5 rounded ${
                          s.severity === 'HIGH' ? 'bg-red-100 text-red-700' :
                          s.severity === 'MEDIUM' ? 'bg-yellow-100 text-yellow-700' :
                          'bg-blue-100 text-blue-700'
                        }`}>{s.severity}</span>
                      </div>
                      <p className="text-sm text-gray-700 mt-1">{s.rationale}</p>
                      {s.type === 'REORDER' && s.items?.length > 0 && (
                        <div className="mt-3">
                          <div className="text-xs text-gray-500 mb-2">Suggested order (~${Number(s.impact?.estCost || 0).toFixed(2)}):</div>
                          <ul className="text-sm text-gray-700 space-y-1 mb-3">
                            {s.items.slice(0, 6).map((i: any) => (
                              <li key={i.productId} className="flex justify-between gap-4">
                                <span>{i.name} <span className="text-gray-400">({i.quantity} on hand)</span></span>
                                <span className="font-mono">order {i.suggestedOrder}</span>
                              </li>
                            ))}
                            {s.items.length > 6 && <li className="text-gray-400">+{s.items.length - 6} more…</li>}
                          </ul>
                          <button
                            onClick={() => applyReorder(s)}
                            disabled={applying}
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-600 text-white text-sm font-medium hover:bg-purple-700 disabled:opacity-50"
                          >
                            <ShoppingCart size={16} />
                            {applying ? 'Creating…' : 'Create purchase order'}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div>
        <h2 className="text-lg font-semibold mb-3">Insights & Recommendations</h2>
        <div className="space-y-3">
          {data?.insights?.map((insight: any, idx: number) => {
            const Icon = TYPE_ICONS[insight.type] || Star;
            return (
              <div key={idx} className={`border rounded-lg p-4 ${PRIORITY_COLORS[insight.priority] || 'bg-white'}`}>
                <div className="flex items-start gap-3">
                  <Icon size={20} className="mt-0.5 flex-shrink-0" />
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold">{insight.title}</h3>
                      <span className={`text-xs px-2 py-0.5 rounded ${
                        insight.priority === 'HIGH' ? 'bg-red-100 text-red-700' :
                        insight.priority === 'MEDIUM' ? 'bg-yellow-100 text-yellow-700' :
                        'bg-blue-100 text-blue-700'
                      }`}>{insight.priority}</span>
                    </div>
                    <p className="text-sm text-gray-700 mt-1">{insight.message}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {data?.topProducts?.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-3">Top Products</h2>
          <div className="bg-white rounded-lg border">
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="text-left px-4 py-3 text-sm font-medium">Product</th>
                  <th className="text-right px-4 py-3 text-sm font-medium">Units Sold</th>
                </tr>
              </thead>
              <tbody>
                {data.topProducts.map((p: any, idx: number) => (
                  <tr key={idx} className="border-b">
                    <td className="px-4 py-3">{p.name}</td>
                    <td className="px-4 py-3 text-right font-mono">{p.quantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
