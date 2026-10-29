import { useEffect, useState } from 'react';
import { api } from '../api/client';
import {
  CalendarDays,
  Users,
  Clock,
  Wallet,
  ArrowRightLeft,
  Plane,
  Plus,
  Upload,
  Download,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Trash2,
  RefreshCw,
} from 'lucide-react';

/**
 * Labour: the roster, time off, shift swaps and payroll (§21 workforce).
 *
 * The weekly view is the unit of work: a manager builds drafts, sees the
 * conflicts the server would block on, publishes, then freezes the period into
 * a payroll run. Hours come from the clock where people punched in and from the
 * published roster where they did not — the payroll table marks which is which,
 * so an estimate is never mistaken for a measured figure.
 */

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const isoDate = (d: Date) => {
  const copy = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return copy.toISOString().slice(0, 10);
};

function startOfWeek(base: Date) {
  const d = new Date(base);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

function addDays(base: Date, days: number) {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

/** Combine a yyyy-mm-dd date and an HH:mm time into the ISO instant the API wants. */
function atLocalTime(date: string, time: string) {
  return new Date(`${date}T${time}:00`).toISOString();
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const money = (n: number) => `$${Number(n || 0).toFixed(2)}`;
const num = (n: number, digits = 1) => Number(n || 0).toFixed(digits);

type Tab = 'roster' | 'timeoff' | 'swaps' | 'payroll';

export default function LaborPage() {
  const [tab, setTab] = useState<Tab>('roster');
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [employees, setEmployees] = useState<any[]>([]);
  const [shifts, setShifts] = useState<any[]>([]);
  const [conflicts, setConflicts] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [timeOff, setTimeOff] = useState<any[]>([]);
  const [swaps, setSwaps] = useState<any[]>([]);
  const [preview, setPreview] = useState<{ lines: any[]; totals: any } | null>(null);
  const [runs, setRuns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');

  const from = isoDate(weekStart);
  const to = isoDate(addDays(weekStart, 7));

  const [shiftForm, setShiftForm] = useState({
    employeeId: '',
    date: isoDate(new Date()),
    start: '09:00',
    end: '17:00',
    breakMinutes: '30',
    position: '',
  });

  const [offForm, setOffForm] = useState({
    employeeId: '',
    startDate: isoDate(new Date()),
    endDate: isoDate(addDays(new Date(), 1)),
    type: 'VACATION',
    reason: '',
  });

  async function load() {
    setLoading(true);
    try {
      const [empRes, shiftRes, conflictRes, summaryRes, offRes, swapRes, previewRes, runRes] = await Promise.all([
        api.getEmployees(),
        api.getSchedules({ from, to }),
        api.getScheduleConflicts({ from, to }),
        api.getLaborSummary({ from, to }),
        api.getTimeOff(),
        api.getShiftSwaps(),
        api.getPayrollPreview({ from, to }),
        api.getPayrollRuns(),
      ]);
      setEmployees(empRes.data || []);
      setShifts(shiftRes.data || []);
      setConflicts(conflictRes.data || []);
      setSummary(summaryRes.data || null);
      setTimeOff(offRes.data || []);
      setSwaps(swapRes.data || []);
      setPreview(previewRes.data || null);
      setRuns(runRes.data || []);
    } catch (err: any) {
      setNotice(err?.message || 'Could not load the labour data');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  const nameOf = (employeeId: string | null) =>
    employees.find((e) => e.id === employeeId)?.user?.name ?? 'Unassigned';

  async function addShift() {
    if (!shiftForm.employeeId) {
      alert('Choose an employee for this shift.');
      return;
    }
    const startAt = atLocalTime(shiftForm.date, shiftForm.start);
    const endAt = atLocalTime(shiftForm.date, shiftForm.end);
    if (new Date(endAt) <= new Date(startAt)) {
      alert('The shift must end after it starts.');
      return;
    }
    setBusy('shift');
    try {
      await api.createSchedule({
        employeeId: shiftForm.employeeId,
        startAt,
        endAt,
        breakMinutes: Number(shiftForm.breakMinutes) || 0,
        position: shiftForm.position || null,
      });
      setShiftForm({ ...shiftForm, position: '' });
      await load();
    } catch (err: any) {
      alert(err?.message || 'Could not add the shift');
    } finally {
      setBusy('');
    }
  }

  async function removeShift(id: string) {
    if (!confirm('Remove this shift from the roster?')) return;
    try {
      await api.deleteSchedule(id);
      await load();
    } catch (err: any) {
      alert(err?.message || 'Could not remove the shift');
    }
  }

  async function publish() {
    setBusy('publish');
    try {
      const res = await api.publishSchedules({ from, to });
      const published = res.data?.published ?? 0;
      const blocked = res.data?.blocked?.length ?? 0;
      const warnings = res.data?.availabilityWarnings?.length ?? 0;
      setNotice(
        `Published ${published} shift${published === 1 ? '' : 's'}` +
          (blocked ? ` · ${blocked} blocked by a double-booking` : '') +
          (warnings ? ` · ${warnings} outside declared availability` : ''),
      );
      await load();
    } catch (err: any) {
      alert(err?.message || 'Could not publish the roster');
    } finally {
      setBusy('');
    }
  }

  async function requestSwap(scheduleId: string) {
    try {
      await api.requestShiftSwap({ scheduleId });
      setNotice('Swap requested. It stays pending until a manager approves a replacement.');
      await load();
    } catch (err: any) {
      alert(err?.message || 'Could not request the swap');
    }
  }

  async function decideSwap(id: string, status: 'APPROVED' | 'DECLINED', toEmployeeId?: string) {
    try {
      await api.decideShiftSwap(id, { status, toEmployeeId });
      await load();
    } catch (err: any) {
      alert(err?.message || 'Could not update the swap');
    }
  }

  async function submitTimeOff() {
    if (!offForm.employeeId) {
      alert('Choose an employee for this request.');
      return;
    }
    setBusy('timeoff');
    try {
      await api.requestTimeOff({
        employeeId: offForm.employeeId,
        startDate: atLocalTime(offForm.startDate, '00:00'),
        endDate: atLocalTime(offForm.endDate, '23:59'),
        type: offForm.type,
        reason: offForm.reason || null,
      });
      setOffForm({ ...offForm, reason: '' });
      await load();
    } catch (err: any) {
      alert(err?.message || 'Could not record the request');
    } finally {
      setBusy('');
    }
  }

  async function decideTimeOff(id: string, status: 'APPROVED' | 'DECLINED') {
    try {
      const res = await api.decideTimeOff(id, { status });
      // Approving leave never silently cancels the roster — the server reports
      // which shifts now clash, and the manager decides what to do with them.
      const impacted = res.rosteredShifts?.length ?? 0;
      if (status === 'APPROVED' && impacted > 0) {
        setNotice(
          `Approved. ${impacted} rostered shift${impacted === 1 ? '' : 's'} now overlap this leave — reassign or publish again.`,
        );
      }
      await load();
    } catch (err: any) {
      alert(err?.message || 'Could not update the request');
    }
  }

  async function freezePayroll() {
    if (!preview?.lines?.length) {
      alert('There are no hours or tips in this period to freeze.');
      return;
    }
    if (!confirm(`Freeze ${from} → ${to} into a payroll run?`)) return;
    setBusy('payroll');
    try {
      const res = await api.runPayroll({ from, to });
      setNotice(`Payroll run ${res.data?.id?.slice(0, 8) ?? ''} frozen — download the CSV when you are ready.`);
      await load();
    } catch (err: any) {
      alert(err?.message || 'Could not create the payroll run');
    } finally {
      setBusy('');
    }
  }

  async function downloadRun(run: any) {
    setBusy(run.id);
    try {
      const blob = await api.downloadFile(`/labor/payroll/runs/${run.id}/csv`);
      saveBlob(blob, `payroll-${String(run.periodStart).slice(0, 10)}.csv`);
      await load();
    } catch (err: any) {
      alert(err?.message || 'Could not download the payroll file');
    } finally {
      setBusy('');
    }
  }

  const totalHours = shifts.reduce((s, sh) => s + Number(sh.hours || 0), 0);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const tabLabel = (value: Tab, label: string, Icon: any) => (
    <button
      key={value}
      onClick={() => setTab(value)}
      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm ${
        tab === value ? 'bg-blue-600 text-white' : 'bg-white border text-gray-700 hover:bg-gray-50'
      }`}
    >
      <Icon size={16} /> {label}
    </button>
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Labour &amp; Scheduling</h1>
          <p className="text-gray-500">Build the roster, approve leave, then freeze the period for payroll</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setWeekStart(addDays(weekStart, -7))}
            className="px-3 py-2 border rounded-lg text-sm bg-white hover:bg-gray-50"
          >
            Previous
          </button>
          <span className="text-sm font-medium px-2">
            {weekStart.toLocaleDateString()} → {addDays(weekStart, 6).toLocaleDateString()}
          </span>
          <button
            onClick={() => setWeekStart(addDays(weekStart, 7))}
            className="px-3 py-2 border rounded-lg text-sm bg-white hover:bg-gray-50"
          >
            Next
          </button>
          <button
            onClick={() => setWeekStart(startOfWeek(new Date()))}
            className="px-3 py-2 border rounded-lg text-sm bg-white hover:bg-gray-50"
          >
            This week
          </button>
          <button
            onClick={load}
            className="p-2 border rounded-lg bg-white hover:bg-gray-50"
            title="Reload"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {notice && (
        <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 text-blue-800 rounded-lg px-4 py-3 text-sm">
          <CheckCircle2 size={16} className="mt-0.5" />
          <span className="flex-1">{notice}</span>
          <button onClick={() => setNotice('')} className="text-blue-600 hover:underline">
            Dismiss
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="bg-white rounded-lg border p-4">
          <div className="text-xs text-gray-500">Rostered hours</div>
          <div className="text-xl font-semibold tabular-nums">{num(totalHours, 2)}</div>
        </div>
        <div className="bg-white rounded-lg border p-4">
          <div className="text-xs text-gray-500">Labour cost</div>
          <div className="text-xl font-semibold tabular-nums">{money(summary?.labourCost ?? 0)}</div>
        </div>
        <div className="bg-white rounded-lg border p-4">
          <div className="text-xs text-gray-500">Net sales</div>
          <div className="text-xl font-semibold tabular-nums">{money(summary?.netSales ?? 0)}</div>
        </div>
        <div className="bg-white rounded-lg border p-4">
          <div className="text-xs text-gray-500">Labour %</div>
          <div className="text-xl font-semibold tabular-nums">{num(summary?.labourPercent ?? 0)}%</div>
        </div>
        <div className="bg-white rounded-lg border p-4">
          <div className="text-xs text-gray-500">Sales / labour hour</div>
          <div className="text-xl font-semibold tabular-nums">{money(summary?.salesPerLabourHour ?? 0)}</div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {tabLabel('roster', 'Roster', CalendarDays)}
        {tabLabel('timeoff', 'Time off', Plane)}
        {tabLabel('swaps', 'Shift swaps', ArrowRightLeft)}
        {tabLabel('payroll', 'Payroll', Wallet)}
      </div>

      {tab === 'roster' && (
        <>
          <div className="bg-white rounded-lg border p-6 space-y-3">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Plus size={18} /> Add a shift
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
              <select
                value={shiftForm.employeeId}
                onChange={(e) => setShiftForm({ ...shiftForm, employeeId: e.target.value })}
                className="border rounded px-3 py-2 text-sm md:col-span-2"
              >
                <option value="">Employee…</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.user?.name} {emp.position ? `· ${emp.position}` : ''}
                  </option>
                ))}
              </select>
              <input
                type="date"
                value={shiftForm.date}
                onChange={(e) => setShiftForm({ ...shiftForm, date: e.target.value })}
                className="border rounded px-3 py-2 text-sm"
              />
              <input
                type="time"
                value={shiftForm.start}
                onChange={(e) => setShiftForm({ ...shiftForm, start: e.target.value })}
                className="border rounded px-3 py-2 text-sm"
              />
              <input
                type="time"
                value={shiftForm.end}
                onChange={(e) => setShiftForm({ ...shiftForm, end: e.target.value })}
                className="border rounded px-3 py-2 text-sm"
              />
              <input
                type="number"
                min="0"
                max="480"
                value={shiftForm.breakMinutes}
                onChange={(e) => setShiftForm({ ...shiftForm, breakMinutes: e.target.value })}
                placeholder="Break (min)"
                className="border rounded px-3 py-2 text-sm"
              />
              <input
                value={shiftForm.position}
                onChange={(e) => setShiftForm({ ...shiftForm, position: e.target.value })}
                placeholder="Position (optional)"
                className="border rounded px-3 py-2 text-sm md:col-span-2"
              />
              <button
                onClick={addShift}
                disabled={busy === 'shift'}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm"
              >
                {busy === 'shift' ? 'Adding…' : 'Add shift'}
              </button>
            </div>
            <p className="text-xs text-gray-500">
              New shifts start as drafts. Publishing checks every draft for double-bookings.
            </p>
          </div>

          {conflicts.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-1">
              <div className="flex items-center gap-2 font-medium text-amber-900 text-sm">
                <AlertTriangle size={16} /> {conflicts.length} roster conflict
                {conflicts.length === 1 ? '' : 's'} in this week
              </div>
              {conflicts.map((c, i) => (
                <div key={i} className="text-xs text-amber-800">
                  {c.employeeName ?? nameOf(c.employeeId)} — {c.reason}: {c.detail}
                </div>
              ))}
            </div>
          )}

          <div className="bg-white rounded-lg border overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <h2 className="font-semibold flex items-center gap-2">
                <Users size={18} /> Week of {weekStart.toLocaleDateString()}
              </h2>
              <button
                onClick={publish}
                disabled={busy === 'publish'}
                className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 disabled:opacity-50 text-sm"
              >
                <Upload size={16} /> {busy === 'publish' ? 'Publishing…' : 'Publish drafts'}
              </button>
            </div>

            {loading ? (
              <div className="p-6 text-sm text-gray-500">Loading roster…</div>
            ) : shifts.length === 0 ? (
              <div className="p-6 text-sm text-gray-500">No shifts rostered this week.</div>
            ) : (
              <div className="divide-y">
                {days.map((day) => {
                  const key = isoDate(day);
                  const dayShifts = shifts.filter((s) => isoDate(new Date(s.startAt)) === key);
                  if (dayShifts.length === 0) return null;
                  return (
                    <div key={key} className="px-4 py-3">
                      <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                        {WEEKDAYS[day.getDay()]} {day.toLocaleDateString()}
                      </div>
                      <div className="space-y-2">
                        {dayShifts.map((shift) => (
                          <div key={shift.id} className="flex items-center justify-between gap-3 text-sm">
                            <div className="flex items-center gap-3">
                              <Clock size={14} className="text-gray-400" />
                              <span className="font-medium w-40">{shift.employeeName ?? nameOf(shift.employeeId)}</span>
                              <span className="tabular-nums text-gray-600">
                                {new Date(shift.startAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} –{' '}
                                {new Date(shift.endAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                              <span className="text-gray-500 tabular-nums">
                                {num(shift.hours ?? 0, 2)} h
                              </span>
                              {shift.position && <span className="text-gray-500">· {shift.position}</span>}
                              <span
                                className={`text-xs px-2 py-0.5 rounded ${
                                  shift.status === 'PUBLISHED'
                                    ? 'bg-green-100 text-green-800'
                                    : shift.status === 'CANCELLED'
                                      ? 'bg-rose-100 text-rose-800'
                                      : 'bg-gray-100 text-gray-600'
                                }`}
                              >
                                {shift.status}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => requestSwap(shift.id)}
                                className="text-xs text-blue-600 hover:underline"
                              >
                                Request swap
                              </button>
                              <button
                                onClick={() => removeShift(shift.id)}
                                className="text-gray-400 hover:text-rose-600"
                                title="Remove shift"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {tab === 'timeoff' && (
        <>
          <div className="bg-white rounded-lg border p-6 space-y-3">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Plane size={18} /> Record a time-off request
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
              <select
                value={offForm.employeeId}
                onChange={(e) => setOffForm({ ...offForm, employeeId: e.target.value })}
                className="border rounded px-3 py-2 text-sm md:col-span-2"
              >
                <option value="">Employee…</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.user?.name}
                  </option>
                ))}
              </select>
              <input
                type="date"
                value={offForm.startDate}
                onChange={(e) => setOffForm({ ...offForm, startDate: e.target.value })}
                className="border rounded px-3 py-2 text-sm"
              />
              <input
                type="date"
                value={offForm.endDate}
                onChange={(e) => setOffForm({ ...offForm, endDate: e.target.value })}
                className="border rounded px-3 py-2 text-sm"
              />
              <select
                value={offForm.type}
                onChange={(e) => setOffForm({ ...offForm, type: e.target.value })}
                className="border rounded px-3 py-2 text-sm"
              >
                <option value="VACATION">Vacation</option>
                <option value="SICK">Sick</option>
                <option value="UNPAID">Unpaid</option>
                <option value="OTHER">Other</option>
              </select>
              <button
                onClick={submitTimeOff}
                disabled={busy === 'timeoff'}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm"
              >
                {busy === 'timeoff' ? 'Saving…' : 'Request'}
              </button>
              <input
                value={offForm.reason}
                onChange={(e) => setOffForm({ ...offForm, reason: e.target.value })}
                placeholder="Reason (optional)"
                className="border rounded px-3 py-2 text-sm md:col-span-6"
              />
            </div>
          </div>

          <div className="bg-white rounded-lg border overflow-hidden">
            <div className="px-4 py-3 border-b font-semibold">Requests</div>
            {timeOff.length === 0 ? (
              <div className="p-6 text-sm text-gray-500">No time-off requests.</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                  <tr>
                    <th className="text-left px-4 py-2">Employee</th>
                    <th className="text-left px-4 py-2">Type</th>
                    <th className="text-left px-4 py-2">Dates</th>
                    <th className="text-left px-4 py-2">Reason</th>
                    <th className="text-left px-4 py-2">Status</th>
                    <th className="text-right px-4 py-2">Decision</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {timeOff.map((req) => (
                    <tr key={req.id}>
                      <td className="px-4 py-2">{req.employeeName ?? nameOf(req.employeeId)}</td>
                      <td className="px-4 py-2">{req.type}</td>
                      <td className="px-4 py-2 tabular-nums">
                        {String(req.startDate).slice(0, 10)} → {String(req.endDate).slice(0, 10)}
                      </td>
                      <td className="px-4 py-2 text-gray-600 max-w-xs truncate">{req.reason || '—'}</td>
                      <td className="px-4 py-2">
                        <span
                          className={`text-xs px-2 py-0.5 rounded ${
                            req.status === 'APPROVED'
                              ? 'bg-green-100 text-green-800'
                              : req.status === 'DECLINED'
                                ? 'bg-rose-100 text-rose-800'
                                : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {req.status}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right">
                        {req.status === 'PENDING' ? (
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => decideTimeOff(req.id, 'APPROVED')}
                              className="text-green-600 hover:text-green-700"
                              title="Approve"
                            >
                              <CheckCircle2 size={16} />
                            </button>
                            <button
                              onClick={() => decideTimeOff(req.id, 'DECLINED')}
                              className="text-rose-600 hover:text-rose-700"
                              title="Decline"
                            >
                              <XCircle size={16} />
                            </button>
                          </div>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {tab === 'swaps' && (
        <div className="bg-white rounded-lg border overflow-hidden">
          <div className="px-4 py-3 border-b font-semibold flex items-center gap-2">
            <ArrowRightLeft size={18} /> Shift swaps
          </div>
          {swaps.length === 0 ? (
            <div className="p-6 text-sm text-gray-500">
              No swap requests. Request one from any shift on the Roster tab.
            </div>
          ) : (
            <div className="divide-y">
              {swaps.map((swap) => (
                <div key={swap.id} className="p-4 flex items-center justify-between gap-4 text-sm">
                  <div>
                    <div className="font-medium">
                      {swap.fromEmployeeName ?? nameOf(swap.fromEmployeeId)} →{' '}
                      {swap.toEmployeeName ?? (swap.toEmployeeId ? nameOf(swap.toEmployeeId) : 'open')}
                    </div>
                    <div className="text-xs text-gray-500">
                      {swap.reason || 'No reason given'} ·{' '}
                      {new Date(swap.createdAt).toLocaleString()}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-xs px-2 py-0.5 rounded ${
                        swap.status === 'APPROVED'
                          ? 'bg-green-100 text-green-800'
                          : swap.status === 'DECLINED'
                            ? 'bg-rose-100 text-rose-800'
                            : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {swap.status}
                    </span>
                    {swap.status === 'PENDING' && (
                      <>
                        <SwapCoverPicker
                          employees={employees}
                          excludeId={swap.fromEmployeeId}
                          onApprove={(employeeId) => decideSwap(swap.id, 'APPROVED', employeeId)}
                        />
                        <button
                          onClick={() => decideSwap(swap.id, 'DECLINED')}
                          className="px-2 py-1 border rounded text-xs hover:bg-gray-50"
                        >
                          Decline
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'payroll' && (
        <>
          <div className="bg-white rounded-lg border overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <h2 className="font-semibold flex items-center gap-2">
                <Wallet size={18} /> Payroll preview · {from} → {to}
              </h2>
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-500">
                  {preview?.totals?.headcount ?? 0} people · {num(preview?.totals?.hours ?? 0, 2)} h · OT{' '}
                  {num(preview?.totals?.overtimeHours ?? 0, 2)} h · tips {money(preview?.totals?.tips ?? 0)} ·{' '}
                  gross {money(preview?.totals?.gross ?? 0)}
                </span>
                <button
                  onClick={freezePayroll}
                  disabled={busy === 'payroll'}
                  className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm"
                >
                  {busy === 'payroll' ? 'Freezing…' : 'Freeze period'}
                </button>
              </div>
            </div>

            {!preview?.lines?.length ? (
              <div className="p-6 text-sm text-gray-500">
                No hours or tips fall inside this period. Publish a roster or let staff clock in first.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                  <tr>
                    <th className="text-left px-4 py-2">Employee</th>
                    <th className="text-left px-4 py-2">Source</th>
                    <th className="text-right px-4 py-2">Regular</th>
                    <th className="text-right px-4 py-2">Overtime</th>
                    <th className="text-right px-4 py-2">Total</th>
                    <th className="text-right px-4 py-2">Rate</th>
                    <th className="text-right px-4 py-2">Tips</th>
                    <th className="text-right px-4 py-2">Gross</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {preview.lines.map((line) => (
                    <tr key={line.employeeId}>
                      <td className="px-4 py-2">
                        {line.employeeName}
                        {line.employeeNumber && (
                          <span className="text-xs text-gray-400"> · {line.employeeNumber}</span>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        <span
                          className={`text-xs px-2 py-0.5 rounded ${
                            line.source === 'TIME_ENTRY'
                              ? 'bg-green-100 text-green-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                          title={
                            line.source === 'TIME_ENTRY'
                              ? 'Measured from clock-in/out'
                              : 'Estimated from the published roster — no clocked time'
                          }
                        >
                          {line.source === 'TIME_ENTRY' ? 'clocked' : 'roster est.'}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">{num(line.regularHours, 2)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{num(line.overtimeHours, 2)}</td>
                      <td className="px-4 py-2 text-right tabular-nums font-medium">{num(line.totalHours, 2)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{money(line.hourlyRate)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{money(line.tips)}</td>
                      <td className="px-4 py-2 text-right tabular-nums font-semibold">{money(line.grossPay)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="bg-white rounded-lg border overflow-hidden">
            <div className="px-4 py-3 border-b font-semibold">Frozen payroll runs</div>
            {runs.length === 0 ? (
              <div className="p-6 text-sm text-gray-500">No payroll has been frozen yet.</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                  <tr>
                    <th className="text-left px-4 py-2">Period</th>
                    <th className="text-left px-4 py-2">Status</th>
                    <th className="text-right px-4 py-2">Hours</th>
                    <th className="text-right px-4 py-2">OT</th>
                    <th className="text-right px-4 py-2">Tips</th>
                    <th className="text-right px-4 py-2">Gross</th>
                    <th className="text-right px-4 py-2">Export</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {runs.map((run) => (
                    <tr key={run.id}>
                      <td className="px-4 py-2 tabular-nums">
                        {String(run.periodStart).slice(0, 10)} → {String(run.periodEnd).slice(0, 10)}
                      </td>
                      <td className="px-4 py-2">
                        <span
                          className={`text-xs px-2 py-0.5 rounded ${
                            run.status === 'EXPORTED'
                              ? 'bg-green-100 text-green-800'
                              : 'bg-gray-100 text-gray-600'
                          }`}
                        >
                          {run.status}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">{num(run.totalHours, 2)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{num(run.totalOvertimeHours, 2)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{money(run.totalTips)}</td>
                      <td className="px-4 py-2 text-right tabular-nums font-medium">{money(run.totalGross)}</td>
                      <td className="px-4 py-2 text-right">
                        <button
                          onClick={() => downloadRun(run)}
                          disabled={busy === run.id}
                          className="inline-flex items-center gap-1 text-blue-600 hover:underline disabled:opacity-50"
                        >
                          <Download size={14} /> {busy === run.id ? '…' : 'CSV'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Approving a swap needs a named replacement — the server refuses to move a
 * shift to nobody, so the choice is made here rather than failing at submit.
 */
function SwapCoverPicker({
  employees,
  excludeId,
  onApprove,
}: {
  employees: any[];
  excludeId: string;
  onApprove: (employeeId: string) => void;
}) {
  const [employeeId, setEmployeeId] = useState('');
  return (
    <div className="flex items-center gap-2">
      <select
        value={employeeId}
        onChange={(e) => setEmployeeId(e.target.value)}
        className="border rounded px-2 py-1 text-xs"
      >
        <option value="">Cover with…</option>
        {employees
          .filter((e) => e.id !== excludeId)
          .map((e) => (
            <option key={e.id} value={e.id}>
              {e.user?.name}
            </option>
          ))}
      </select>
      <button
        onClick={() => {
          if (!employeeId) {
            alert('Choose the employee who will take this shift.');
            return;
          }
          onApprove(employeeId);
        }}
        className="px-2 py-1 bg-green-600 text-white rounded text-xs hover:bg-green-700"
      >
        Approve
      </button>
    </div>
  );
}
