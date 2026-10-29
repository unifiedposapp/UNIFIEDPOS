import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Layers, Plus, Trash2, Trophy, Search, RefreshCw } from 'lucide-react';

/**
 * Loyalty tiers (§8 loyalty depth).
 *
 * A flat earn rate makes "gold members earn double" impossible. Tiers are a
 * ladder keyed on lifetime points — lifetime, not balance, so redeeming a reward
 * never demotes a customer for spending their own points.
 */
export default function LoyaltyTiersPage() {
  const [programs, setPrograms] = useState<any[]>([]);
  const [programId, setProgramId] = useState('');
  const [tiers, setTiers] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [evaluating, setEvaluating] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', minLifetimePoints: '0', pointsMultiplier: '1', perks: '' });
  const [saving, setSaving] = useState(false);

  const [lookupId, setLookupId] = useState('');
  const [status, setStatus] = useState<any>(null);

  async function load() {
    setLoading(true);
    try {
      const [tierRes, progRes, custRes] = await Promise.all([
        api.getLoyaltyTiers(programId || undefined),
        api.getLoyaltyPrograms(),
        api.getCustomers({ pageSize: '200' }),
      ]);
      setTiers(tierRes.data || []);
      const progList = progRes.data || [];
      setPrograms(progList);
      if (!programId && progList.length > 0) setProgramId(progList[0].id);
      setCustomers(custRes.data?.items || []);
    } catch (err: any) {
      console.error('Failed to load loyalty tiers:', err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [programId]);

  async function createTier() {
    if (!programId) {
      alert('Create a loyalty program first — a tier belongs to one program.');
      return;
    }
    if (!form.name.trim()) {
      alert('Give the tier a name (Silver, Gold, VIP…).');
      return;
    }
    setSaving(true);
    try {
      let perks: Record<string, unknown> | null = null;
      if (form.perks.trim()) {
        // Free-form key:value pairs so a perk never needs a code change to exist.
        perks = {};
        for (const pair of form.perks.split(',')) {
          const [key, ...rest] = pair.split(':');
          if (!key.trim()) continue;
          (perks as Record<string, unknown>)[key.trim()] = rest.join(':').trim() || true;
        }
      }
      await api.createLoyaltyTier({
        programId,
        name: form.name.trim(),
        minLifetimePoints: Number(form.minLifetimePoints) || 0,
        pointsMultiplier: Number(form.pointsMultiplier) || 1,
        perks,
      });
      setShowForm(false);
      setForm({ name: '', minLifetimePoints: '0', pointsMultiplier: '1', perks: '' });
      await load();
    } catch (err: any) {
      alert(err?.message || 'Could not create the tier');
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!confirm('Delete this tier? Members in it fall back to the rung below.')) return;
    try {
      await api.deleteLoyaltyTier(id);
      await load();
    } catch (err: any) {
      alert(err?.message || 'Could not delete the tier');
    }
  }

  async function evaluate() {
    setEvaluating(true);
    try {
      const res = await api.evaluateLoyaltyTiers(programId || undefined);
      alert(
        `Evaluated ${res.data?.evaluated ?? 0} customers — ${res.data?.promoted ?? 0} promoted, ${res.data?.demoted ?? 0} moved down.`,
      );
      await load();
    } catch (err: any) {
      alert(err?.message || 'Could not evaluate tiers');
    } finally {
      setEvaluating(false);
    }
  }

  async function lookup() {
    if (!lookupId) return;
    try {
      const res = await api.getCustomerLoyaltyStatus(lookupId);
      setStatus(res.data);
    } catch (err: any) {
      setStatus(null);
      alert(err?.message || 'Could not load that customer');
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Loyalty Tiers</h1>
          <p className="text-gray-500">A ladder of perks keyed on lifetime points</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={programId} onChange={(e) => setProgramId(e.target.value)} className="border rounded-lg px-3 py-2 text-sm">
            <option value="">All programs</option>
            {programs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button
            onClick={evaluate}
            disabled={evaluating}
            className="flex items-center gap-2 border px-3 py-2 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw size={16} className={evaluating ? 'animate-spin' : ''} /> Re-evaluate members
          </button>
          <button
            onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-2 bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700"
          >
            <Plus size={18} /> New tier
          </button>
        </div>
      </div>

      {showForm && (
        <div className="bg-white rounded-lg border p-6 space-y-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Layers size={18} /> New tier
          </h2>
          <div className="grid grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Name</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Gold"
                className="w-full border rounded px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Starts at (lifetime pts)</label>
              <input
                type="number"
                min="0"
                value={form.minLifetimePoints}
                onChange={(e) => setForm({ ...form, minLifetimePoints: e.target.value })}
                className="w-full border rounded px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Points multiplier</label>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={form.pointsMultiplier}
                onChange={(e) => setForm({ ...form, pointsMultiplier: e.target.value })}
                className="w-full border rounded px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Perks (key:value, comma separated)</label>
              <input
                value={form.perks}
                onChange={(e) => setForm({ ...form, perks: e.target.value })}
                placeholder="freeShipping:true, discountPercent:5"
                className="w-full border rounded px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowForm(false)} className="px-4 py-2 bg-gray-200 rounded-lg hover:bg-gray-300">
              Cancel
            </button>
            <button
              onClick={createTier}
              disabled={saving}
              className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Create tier'}
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg border p-6">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Trophy size={18} /> The ladder
        </h2>
        {loading ? (
          <p className="text-gray-500">Loading…</p>
        ) : tiers.length === 0 ? (
          <p className="text-gray-500">No tiers yet. Add the first rung, usually at 0 points.</p>
        ) : (
          <div className="space-y-2">
            {tiers.map((tier) => (
              <div key={tier.id} className="flex items-center justify-between border rounded-lg px-4 py-3">
                <div>
                  <p className="font-semibold">
                    {tier.name}
                    <span className="ms-2 text-xs font-normal text-gray-500">{tier.memberCount ?? 0} members</span>
                  </p>
                  <p className="text-xs text-gray-500">
                    from <strong>{tier.minLifetimePoints}</strong> lifetime points · earns{' '}
                    <strong>×{tier.pointsMultiplier}</strong>
                    {tier.perks && Object.keys(tier.perks).length > 0 && (
                      <> · {Object.entries(tier.perks).map(([k, v]) => `${k}: ${String(v)}`).join(', ')}</>
                    )}
                  </p>
                </div>
                <button onClick={() => remove(tier.id)} className="p-2 text-rose-600 hover:bg-rose-50 rounded">
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white rounded-lg border p-6">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Search size={18} /> Where does this customer stand?
        </h2>
        <div className="flex gap-2 max-w-xl">
          <select value={lookupId} onChange={(e) => setLookupId(e.target.value)} className="flex-1 border rounded px-3 py-2 text-sm">
            <option value="">Select a customer…</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button onClick={lookup} className="px-4 py-2 bg-gray-800 text-white rounded-lg text-sm hover:bg-gray-900">
            Look up
          </button>
        </div>

        {status && (
          <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
            <div className="border rounded-lg p-4">
              <p className="text-gray-500 text-xs">Balance</p>
              <p className="text-2xl font-bold">{status.balance} pts</p>
              <p className="text-xs text-gray-500">{status.lifetimePoints} lifetime points</p>
            </div>
            <div className="border rounded-lg p-4">
              <p className="text-gray-500 text-xs">Current tier</p>
              <p className="text-2xl font-bold">{status.tier?.name ?? 'None yet'}</p>
              {status.tier && <p className="text-xs text-gray-500">earning ×{status.tier.pointsMultiplier}</p>}
              {status.nextTier && (
                <p className="mt-1 text-xs text-blue-700">
                  {status.nextTier.pointsToGo} points to {status.nextTier.name}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
