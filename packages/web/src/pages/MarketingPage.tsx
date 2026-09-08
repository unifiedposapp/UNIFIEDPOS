import { useState, useEffect } from 'react';
import { Tag, Ticket, Megaphone, Users } from 'lucide-react';
import { api } from '../api/client';

export default function MarketingPage() {
  const [tab, setTab] = useState<'promotions' | 'coupons' | 'campaigns' | 'segments'>('promotions');
  const [promotions, setPromotions] = useState<any[]>([]);
  const [coupons, setCoupons] = useState<any[]>([]);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [segments, setSegments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const [pRes, cRes, campRes, segRes] = await Promise.all([
        api.getPromotions(), api.getCoupons(), api.getCampaigns(), api.getSegments(),
      ]);
      setPromotions(pRes.data || []);
      setCoupons(cRes.data || []);
      setCampaigns(campRes.data || []);
      setSegments(segRes.data || []);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  if (loading) return <div className="p-6">Loading...</div>;

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6 flex items-center gap-2"><Megaphone size={24} /> Marketing</h1>
      <div className="flex gap-2 mb-6 flex-wrap">
        {[
          { key: 'promotions', label: 'Promotions', icon: Tag },
          { key: 'coupons', label: 'Coupons', icon: Ticket },
          { key: 'campaigns', label: 'Campaigns', icon: Megaphone },
          { key: 'segments', label: 'Segments', icon: Users },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key as any)} className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium ${tab === t.key ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
            <t.icon size={16} /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'promotions' && (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">Name</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">Type</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">Value</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">Active</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">Start</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">End</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {promotions.map(p => (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-medium">{p.name}</td>
                  <td className="px-4 py-3"><span className="px-2 py-1 bg-blue-100 text-blue-700 rounded-full text-xs">{p.type}</span></td>
                  <td className="px-4 py-3 text-sm">{p.type === 'PERCENTAGE' ? `${p.value}%` : `$${Number(p.value).toFixed(2)}`}</td>
                  <td className="px-4 py-3"><span className={`px-2 py-1 rounded-full text-xs ${p.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{p.isActive ? 'Active' : 'Inactive'}</span></td>
                  <td className="px-4 py-3 text-sm text-gray-500">{new Date(p.startDate).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{p.endDate ? new Date(p.endDate).toLocaleDateString() : 'No end'}</td>
                </tr>
              ))}
              {promotions.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">No promotions</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'coupons' && (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">Code</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">Type</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">Value</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">Used</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">Active</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {coupons.map(c => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-mono font-medium">{c.code}</td>
                  <td className="px-4 py-3"><span className="px-2 py-1 bg-purple-100 text-purple-700 rounded-full text-xs">{c.type}</span></td>
                  <td className="px-4 py-3 text-sm">{c.type === 'PERCENTAGE' ? `${c.value}%` : `$${Number(c.value).toFixed(2)}`}</td>
                  <td className="px-4 py-3 text-sm">{c.usedCount}{c.usageLimit ? ` / ${c.usageLimit}` : ''}</td>
                  <td className="px-4 py-3"><span className={`px-2 py-1 rounded-full text-xs ${c.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{c.isActive ? 'Active' : 'Inactive'}</span></td>
                </tr>
              ))}
              {coupons.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-500">No coupons</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'campaigns' && (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">Name</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">Type</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">Audience</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">Status</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">Sent</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {campaigns.map(c => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-medium">{c.name}</td>
                  <td className="px-4 py-3"><span className="px-2 py-1 bg-indigo-100 text-indigo-700 rounded-full text-xs">{c.type}</span></td>
                  <td className="px-4 py-3 text-sm">{c.audience}</td>
                  <td className="px-4 py-3"><span className="px-2 py-1 bg-gray-100 text-gray-700 rounded-full text-xs">{c.status}</span></td>
                  <td className="px-4 py-3 text-sm">{c.sentCount}</td>
                </tr>
              ))}
              {campaigns.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-500">No campaigns</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'segments' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {segments.map((s, i) => (
            <div key={i} className="bg-white rounded-xl shadow-sm p-4">
              <div className="text-sm text-gray-500 mb-1">{s.name}</div>
              <div className="text-3xl font-bold text-blue-600">{s.count}</div>
              <div className="text-xs text-gray-400 mt-1">customers</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
