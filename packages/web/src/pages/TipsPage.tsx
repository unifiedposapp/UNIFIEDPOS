import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { HandCoins, Plus, Calculator, Trash2, Save, Users } from 'lucide-react';

/**
 * Tip pooling (§21 hospitality).
 *
 * The pool is split by the rule the store chose — hours, sales, role points or
 * equally — using largest-remainder allocation, so the shares always add back up
 * to the pool to the cent. Nothing here recomputes a share in the browser.
 */
const METHODS = [
  { id: 'HOURS', label: 'By hours worked' },
  { id: 'SALES', label: 'By sales rung' },
  { id: 'POINTS', label: 'By role points' },
  { id: 'EQUAL', label: 'Equally' },
];

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function employeeName(employee: any): string {
  return employee?.user?.name || employee?.name || employee?.employeeNumber || 'Employee';
}

export default function TipsPage() {
  const [rules, setRules] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [distributions, setDistributions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(() => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10));
  const [method, setMethod] = useState('HOURS');
  const [poolAmount, setPoolAmount] = useState('');
  const [persist, setPersist] = useState(true);
  const [computing, setComputing] = useState(false);
  const [result, setResult] = useState<any>(null);

  const [showRuleForm, setShowRuleForm] = useState(false);
  const [ruleForm, setRuleForm] = useState({ name: '', method: 'HOURS', roles: '', includeCashTips: true, includeCardTips: true });
  const [savingRule, setSavingRule] = useState(false);

  const [tipForm, setTipForm] = useState({ employeeId: '', amount: '', type: 'CASH' });
  const [recording, setRecording] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const params = { from, to };
      const [ruleRes, empRes, sumRes, distRes] = await Promise.all([
        api.getTipRules(),
        api.getEmployees(),
        api.getTipSummary(params),
        api.getTipDistributions(params),
      ]);
      setRules(ruleRes.data || []);
      const empList = empRes.data;
      setEmployees(Array.isArray(empList) ? empList : empList?.items || []);
      setSummary(sumRes.data);
      setDistributions(distRes.data || []);
    } catch (err: any) {
      console.error('Failed to load tips:', err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  async function compute() {
    setComputing(true);
    setResult(null);
    try {
      const res = await api.computeTipPool({
        method,
        periodStart: new Date(`${from}T00:00:00`).toISOString(),
        periodEnd: new Date(`${to}T00:00:00`).toISOString(),
        ...(poolAmount ? { poolAmount: Number(poolAmount) } : {}),
        persist,
      });
      setResult(res.data);
      if (persist) await load();
    } catch (err: any) {
      alert(err?.message || 'Could not compute the pool');
    } finally {
      setComputing(false);
    }
  }

  async function createRule() {
    if (!ruleForm.name.trim()) {
      alert('Give the rule a name your managers will recognise.');
      return;
    }
    setSavingRule(true);
    try {
      await api.createTipRule({
        name: ruleForm.name.trim(),
        method: ruleForm.method,
        roles: ruleForm.roles
          .split(',')
          .map((r) => r.trim().toUpperCase())
          .filter(Boolean),
        includeCashTips: ruleForm.includeCashTips,
        includeCardTips: ruleForm.includeCardTips,
      });
      setShowRuleForm(false);
      setRuleForm({ name: '', method: 'HOURS', roles: '', includeCashTips: true, includeCardTips: true });
      await load();
    } catch (err: any) {
      alert(err?.message || 'Could not create the rule');
    } finally {
      setSavingRule(false);
    }
  }

  async function removeRule(id: string) {
    if (!confirm('Deactivate this pool rule?')) return;
    try {
      await api.deleteTipRule(id);
      await load();
    } catch (err: any) {
      alert(err?.message || 'Could not deactivate the rule');
    }
  }

  async function recordTip() {
    if (!tipForm.employeeId || !(Number(tipForm.amount) > 0)) {
      alert('Choose an employee and an amount greater than zero.');
      return;
    }
    setRecording(true);
    try {
      await api.recordTip({
        employeeId: tipForm.employeeId,
        amount: Number(tipForm.amount),
        type: tipForm.type,
      });
      setTipForm({ employeeId: '', amount: '', type: 'CASH' });
      await load();
    } catch (err: any) {
      alert(err?.message || 'Could not record the tip');
    } finally {
      setRecording(false);
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Tips &amp; Pooling</h1>
          <p className="text-gray-500">Record tips, split them by a rule, and freeze the result for payroll</p>
        </div>
        <button
          onClick={() => setShowRuleForm(!showRuleForm)}
          className="flex items-center gap-2 bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700"
        >
          <Plus size={18} /> New pool rule
        </button>
      </div>

      <div className="bg-white rounded-lg border p-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="border rounded px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">To</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="border rounded px-3 py-2 text-sm" />
        </div>
        {summary && (
          <div className="ms-auto flex items-center gap-6 text-sm">
            <div>
              <span className="text-gray-500">Tips recorded: </span>
              <strong>${Number(summary.total).toFixed(2)}</strong>
              <span className="text-gray-500"> ({summary.count})</span>
            </div>
            {Object.entries(summary.byType || {}).map(([type, amount]) => (
              <div key={type}>
                <span className="text-gray-500">{type}: </span>
                <strong>${Number(amount).toFixed(2)}</strong>
              </div>
            ))}
          </div>
        )}
      </div>

      {showRuleForm && (
        <div className="bg-white rounded-lg border p-6 space-y-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <HandCoins size={18} /> New pool rule
          </h2>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Name</label>
              <input
                value={ruleForm.name}
                onChange={(e) => setRuleForm({ ...ruleForm, name: e.target.value })}
                placeholder="Front of house daily"
                className="w-full border rounded px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Method</label>
              <select
                value={ruleForm.method}
                onChange={(e) => setRuleForm({ ...ruleForm, method: e.target.value })}
                className="w-full border rounded px-3 py-2 text-sm"
              >
                {METHODS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Eligible roles (comma separated)</label>
              <input
                value={ruleForm.roles}
                onChange={(e) => setRuleForm({ ...ruleForm, roles: e.target.value })}
                placeholder="SERVER, BARTENDER — blank means everyone"
                className="w-full border rounded px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div className="flex gap-6 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={ruleForm.includeCashTips}
                onChange={(e) => setRuleForm({ ...ruleForm, includeCashTips: e.target.checked })}
              />
              Include cash tips
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={ruleForm.includeCardTips}
                onChange={(e) => setRuleForm({ ...ruleForm, includeCardTips: e.target.checked })}
              />
              Include card tips
            </label>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowRuleForm(false)} className="px-4 py-2 bg-gray-200 rounded-lg hover:bg-gray-300">
              Cancel
            </button>
            <button
              onClick={createRule}
              disabled={savingRule}
              className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
            >
              {savingRule ? 'Saving…' : 'Create rule'}
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-lg border p-4">
          <h2 className="font-semibold mb-2 flex items-center gap-2">
            <Users size={16} /> Active rules
          </h2>
          {loading ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : rules.length === 0 ? (
            <p className="text-sm text-gray-500">No pool rule yet — the compute step falls back to hours worked.</p>
          ) : (
            <ul className="space-y-2">
              {rules.map((r) => (
                <li key={r.id} className="flex items-start justify-between border rounded px-3 py-2 text-sm">
                  <div>
                    <p className="font-medium">{r.name}</p>
                    <p className="text-xs text-gray-500">
                      {r.method}
                      {r.roles?.length ? ` · ${r.roles.join(', ')}` : ' · all roles'}
                    </p>
                  </div>
                  <button onClick={() => removeRule(r.id)} className="p-1 text-rose-600 hover:bg-rose-50 rounded">
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="bg-white rounded-lg border p-4">
          <h2 className="font-semibold mb-2 flex items-center gap-2">
            <Calculator size={16} /> Compute the pool
          </h2>
          <div className="space-y-2">
            <select value={method} onChange={(e) => setMethod(e.target.value)} className="w-full border rounded px-3 py-2 text-sm">
              {METHODS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
            <input
              type="number"
              min="0"
              step="0.01"
              value={poolAmount}
              onChange={(e) => setPoolAmount(e.target.value)}
              placeholder="Pool amount (blank = tips recorded)"
              className="w-full border rounded px-3 py-2 text-sm"
            />
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={persist} onChange={(e) => setPersist(e.target.checked)} />
              Freeze the result for payroll
            </label>
            <button
              onClick={compute}
              disabled={computing}
              className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {computing ? 'Computing…' : 'Compute shares'}
            </button>
          </div>
        </div>

        <div className="bg-white rounded-lg border p-4">
          <h2 className="font-semibold mb-2 flex items-center gap-2">
            <Save size={16} /> Record a tip
          </h2>
          <div className="space-y-2">
            <select
              value={tipForm.employeeId}
              onChange={(e) => setTipForm({ ...tipForm, employeeId: e.target.value })}
              className="w-full border rounded px-3 py-2 text-sm"
            >
              <option value="">Select an employee…</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {employeeName(e)}
                </option>
              ))}
            </select>
            <div className="flex gap-2">
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={tipForm.amount}
                onChange={(e) => setTipForm({ ...tipForm, amount: e.target.value })}
                placeholder="Amount"
                className="flex-1 border rounded px-3 py-2 text-sm"
              />
              <select
                value={tipForm.type}
                onChange={(e) => setTipForm({ ...tipForm, type: e.target.value })}
                className="border rounded px-2 py-2 text-sm"
              >
                <option value="CASH">Cash</option>
                <option value="CARD">Card</option>
                <option value="DECLARED">Declared</option>
              </select>
            </div>
            <button
              onClick={recordTip}
              disabled={recording}
              className="w-full px-4 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-900 disabled:opacity-50"
            >
              {recording ? 'Recording…' : 'Record tip'}
            </button>
          </div>
        </div>
      </div>

      {result && (
        <div className="bg-white rounded-lg border overflow-hidden">
          <div className="px-4 py-3 border-b flex items-center justify-between">
            <h2 className="font-semibold">
              Allocation — {result.method} · pool ${Number(result.pool).toFixed(2)} · distributed $
              {Number(result.distributed).toFixed(2)}
            </h2>
            <span className={`text-xs px-2 py-1 rounded ${result.roundingDrift === 0 ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>
              rounding drift {result.roundingDrift}
            </span>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-600">
              <tr>
                <th className="px-4 py-3">Employee</th>
                <th className="px-4 py-3 text-right">Hours</th>
                <th className="px-4 py-3 text-right">Sales</th>
                <th className="px-4 py-3 text-right">Weight</th>
                <th className="px-4 py-3 text-right">Share</th>
                <th className="px-4 py-3 text-right">%</th>
                <th className="px-4 py-3 text-right">Tips they took</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {result.lines.map((l: any) => (
                <tr key={l.employeeId}>
                  <td className="px-4 py-2">{l.employeeName || l.employeeId}</td>
                  <td className="px-4 py-2 text-right">{Number(l.hours).toFixed(2)}</td>
                  <td className="px-4 py-2 text-right">${Number(l.sales).toFixed(2)}</td>
                  <td className="px-4 py-2 text-right">{Number(l.weight).toFixed(2)}</td>
                  <td className="px-4 py-2 text-right font-medium">${Number(l.share).toFixed(2)}</td>
                  <td className="px-4 py-2 text-right">{Number(l.sharePct).toFixed(1)}%</td>
                  <td className="px-4 py-2 text-right text-gray-600">${Number(l.tipsRecorded).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="bg-white rounded-lg border overflow-hidden">
        <h2 className="px-4 py-3 border-b font-semibold">Frozen distributions</h2>
        {distributions.length === 0 ? (
          <p className="p-6 text-gray-500">Nothing has been frozen for this period yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-600">
              <tr>
                <th className="px-4 py-3">Period</th>
                <th className="px-4 py-3">Employee</th>
                <th className="px-4 py-3">Method</th>
                <th className="px-4 py-3 text-right">Hours</th>
                <th className="px-4 py-3 text-right">Sales</th>
                <th className="px-4 py-3 text-right">Tips</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {distributions.map((d) => (
                <tr key={d.id}>
                  <td className="px-4 py-2 text-gray-600">
                    {new Date(d.periodStart).toLocaleDateString()} – {new Date(d.periodEnd).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-2">{d.employeeName || d.employeeId}</td>
                  <td className="px-4 py-2">{d.method}</td>
                  <td className="px-4 py-2 text-right">{Number(d.hours).toFixed(2)}</td>
                  <td className="px-4 py-2 text-right">${Number(d.sales).toFixed(2)}</td>
                  <td className="px-4 py-2 text-right font-medium">${Number(d.tips).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
