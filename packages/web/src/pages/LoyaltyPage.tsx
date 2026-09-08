import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Star, Plus, Award } from 'lucide-react';

export default function LoyaltyPage() {
  const [programs, setPrograms] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', pointsPerDollar: '1', pointsPerVisit: '0', rewardThreshold: '100', rewardValue: '10' });

  const load = async () => {
    const [progRes, custRes] = await Promise.all([
      api.getLoyaltyPrograms(),
      api.getCustomers(),
    ]);
    setPrograms(progRes.data || []);
    setCustomers(custRes.data?.items || []);
  };

  useEffect(() => { load(); }, []);

  const createProgram = async () => {
    await api.createLoyaltyProgram({
      ...form,
      pointsPerDollar: Number(form.pointsPerDollar),
      pointsPerVisit: Number(form.pointsPerVisit),
      rewardThreshold: Number(form.rewardThreshold),
      rewardValue: Number(form.rewardValue),
    });
    setShowForm(false);
    load();
  };

  const awardPoints = async (customerId: string) => {
    const points = prompt('Points to award:');
    if (!points) return;
    await api.earnLoyaltyPoints({ customerId, points: Number(points) });
    load();
  };

  const redeemPoints = async (customerId: string) => {
    const points = prompt('Points to redeem:');
    if (!points) return;
    try {
      await api.redeemLoyaltyPoints({ customerId, points: Number(points) });
      load();
    } catch (e: any) {
      alert(e.message);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Loyalty & Marketing</h1>
          <p className="text-gray-500">Manage loyalty programs and reward customers</p>
        </div>
        <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-2 bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700">
          <Plus size={18} /> New Program
        </button>
      </div>

      {programs.length > 0 && (
        <div className="bg-white rounded-lg border p-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2"><Star size={20} /> Active Programs</h2>
          <div className="grid grid-cols-2 gap-4">
            {programs.map(p => (
              <div key={p.id} className="border rounded-lg p-4">
                <h3 className="font-bold text-lg">{p.name}</h3>
                {p.description && <p className="text-sm text-gray-500">{p.description}</p>}
                <div className="grid grid-cols-2 gap-2 mt-3 text-sm">
                  <div>Points per dollar: <strong>{Number(p.pointsPerDollar)}</strong></div>
                  <div>Points per visit: <strong>{p.pointsPerVisit}</strong></div>
                  <div>Reward threshold: <strong>{p.rewardThreshold} pts</strong></div>
                  <div>Reward value: <strong>${Number(p.rewardValue)}</strong></div>
                </div>
                <div className={`mt-2 text-xs px-2 py-1 rounded inline-block ${p.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
                  {p.isActive ? 'Active' : 'Inactive'}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {showForm && (
        <div className="bg-white rounded-lg border p-4 space-y-3">
          <h3 className="font-semibold">New Loyalty Program</h3>
          <div className="grid grid-cols-3 gap-3">
            <input placeholder="Program name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="border rounded px-3 py-2" />
            <input placeholder="Description" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className="border rounded px-3 py-2" />
            <input placeholder="Points per $" type="number" value={form.pointsPerDollar} onChange={e => setForm({ ...form, pointsPerDollar: e.target.value })} className="border rounded px-3 py-2" />
            <input placeholder="Points per visit" type="number" value={form.pointsPerVisit} onChange={e => setForm({ ...form, pointsPerVisit: e.target.value })} className="border rounded px-3 py-2" />
            <input placeholder="Reward threshold" type="number" value={form.rewardThreshold} onChange={e => setForm({ ...form, rewardThreshold: e.target.value })} className="border rounded px-3 py-2" />
            <input placeholder="Reward value ($)" type="number" value={form.rewardValue} onChange={e => setForm({ ...form, rewardValue: e.target.value })} className="border rounded px-3 py-2" />
          </div>
          <button onClick={createProgram} className="bg-purple-600 text-white px-4 py-2 rounded hover:bg-purple-700">Create Program</button>
        </div>
      )}

      <div className="bg-white rounded-lg border p-6">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2"><Award size={20} /> Customer Loyalty</h2>
        <div className="grid grid-cols-3 gap-4">
          {customers.map(c => (
            <div key={c.id} className="border rounded-lg p-4">
              <div className="font-bold">{c.name}</div>
              <div className="text-sm text-gray-500">{c.email || c.phone}</div>
              <div className="flex items-center gap-2 mt-2">
                <Star size={16} className="text-yellow-500" />
                <span className="font-bold text-lg">{c.loyaltyPoints}</span>
                <span className="text-sm text-gray-500">points</span>
              </div>
              <div className="text-sm text-gray-500">
                Total spent: ${Number(c.totalSpent).toFixed(2)} | Orders: {c.totalOrders}
              </div>
              <div className="flex gap-2 mt-3">
                <button onClick={() => awardPoints(c.id)} className="text-xs bg-green-100 text-green-700 px-3 py-1 rounded hover:bg-green-200">Award</button>
                <button onClick={() => redeemPoints(c.id)} className="text-xs bg-blue-100 text-blue-700 px-3 py-1 rounded hover:bg-blue-200">Redeem</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
