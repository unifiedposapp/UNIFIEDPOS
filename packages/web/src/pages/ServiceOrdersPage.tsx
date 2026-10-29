import { useEffect, useState } from 'react';
import { api } from '../api/client';
import {
  CalendarCheck,
  Wrench,
  PackageOpen,
  Plus,
  Clock,
  CheckCircle2,
  XCircle,
  ArrowRight,
  Trash2,
  RefreshCw,
  CornerDownLeft,
} from 'lucide-react';

/**
 * Field service: appointments, work orders and rentals (§17 verticals).
 *
 * All three are the same shape — work booked against a customer and an
 * employee, priced from lines — so they share one page with three tabs. Every
 * total shown here was recomputed server-side from the lines; nothing is
 * incremented in the browser.
 */

const isoDate = (d: Date) => {
  const copy = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return copy.toISOString().slice(0, 10);
};

function addDays(base: Date, days: number) {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

const atLocalTime = (date: string, time: string) => new Date(`${date}T${time}:00`).toISOString();

const money = (n: number) => `$${Number(n || 0).toFixed(2)}`;

const APPOINTMENT_FLOW: Record<string, string[]> = {
  BOOKED: ['CONFIRMED', 'CANCELLED', 'NO_SHOW'],
  CONFIRMED: ['IN_PROGRESS', 'CANCELLED', 'NO_SHOW'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

const WORK_FLOW: Record<string, string[]> = {
  OPEN: ['IN_PROGRESS', 'WAITING_PARTS', 'CANCELLED'],
  IN_PROGRESS: ['WAITING_PARTS', 'READY', 'CANCELLED'],
  WAITING_PARTS: ['IN_PROGRESS', 'READY', 'CANCELLED'],
  READY: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

const badge = (status: string) => {
  if (['COMPLETED', 'RETURNED', 'CONFIRMED'].includes(status)) return 'bg-green-100 text-green-800';
  if (['CANCELLED', 'NO_SHOW', 'OVERDUE'].includes(status)) return 'bg-rose-100 text-rose-800';
  if (['IN_PROGRESS', 'OUT', 'PARTIALLY_RETURNED'].includes(status)) return 'bg-blue-100 text-blue-800';
  if (['WAITING_PARTS', 'READY', 'RESERVED'].includes(status)) return 'bg-amber-100 text-amber-800';
  return 'bg-gray-100 text-gray-600';
};

type Tab = 'appointments' | 'work' | 'rentals';

export default function ServiceOrdersPage() {
  const [tab, setTab] = useState<Tab>('appointments');
  const [customers, setCustomers] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [appointments, setAppointments] = useState<any[]>([]);
  const [workOrders, setWorkOrders] = useState<any[]>([]);
  const [rentals, setRentals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');

  const today = new Date();
  const [range, setRange] = useState({ from: isoDate(today), to: isoDate(addDays(today, 7)) });

  // ── Appointment form ──
  const [appt, setAppt] = useState({
    title: '',
    date: isoDate(today),
    start: '10:00',
    end: '11:00',
    customerId: '',
    employeeId: '',
    serviceProductId: '',
    notes: '',
  });
  const [slots, setSlots] = useState<any[]>([]);
  const [slotsBusy, setSlotsBusy] = useState(false);

  // ── Work order form ──
  const [showWorkForm, setShowWorkForm] = useState(false);
  const [wo, setWo] = useState({
    customerId: '',
    assignedEmployeeId: '',
    type: 'REPAIR',
    deviceLabel: '',
    problem: '',
    warrantyUntil: '',
    notes: '',
  });
  const [openWorkOrder, setOpenWorkOrder] = useState<any>(null);
  const [line, setLine] = useState({ kind: 'LABOR', productId: '', description: '', quantity: '1', unitPrice: '' });

  // ── Rental form ──
  const [showRentalForm, setShowRentalForm] = useState(false);
  const [rental, setRental] = useState({
    customerId: '',
    startAt: `${isoDate(today)}T10:00`,
    dueAt: `${isoDate(addDays(today, 1))}T10:00`,
    depositAmount: '',
    notes: '',
  });
  const [rentalLines, setRentalLines] = useState<{ productId: string; quantity: string; rateUnit: string; rate: string }[]>([
    { productId: '', quantity: '1', rateUnit: 'DAY', rate: '' },
  ]);
  const [returning, setReturning] = useState<any>(null);
  const [returnForm, setReturnForm] = useState<{ lateFeePerDay: string; lines: Record<string, { qty: string; condition: string }> }>({
    lateFeePerDay: '',
    lines: {},
  });

  async function load() {
    setLoading(true);
    try {
      const [custRes, empRes, prodRes, apptRes, woRes, rentRes] = await Promise.all([
        api.getCustomers({ pageSize: '200' }),
        api.getEmployees(),
        api.getProducts({ pageSize: '300' }),
        api.getAppointments({ from: range.from, to: range.to }),
        api.getWorkOrders(),
        api.getRentals(),
      ]);
      setCustomers(custRes.data?.items || []);
      setEmployees(empRes.data || []);
      setProducts(prodRes.data?.items || []);
      setAppointments(apptRes.data || []);
      setWorkOrders(woRes.data || []);
      setRentals(rentRes.data || []);
    } catch (err: any) {
      setNotice(err?.message || 'Could not load the service desk');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.from, range.to]);

  const customerName = (id: string | null) => customers.find((c) => c.id === id)?.name ?? 'Walk-in';
  const employeeName = (id: string | null) =>
    id ? (employees.find((e) => e.id === id)?.user?.name ?? 'Unassigned') : 'Unassigned';
  const productName = (id: string | null) => products.find((p) => p.id === id)?.name ?? '';

  // ── Appointments ──────────────────────────────────────────────────────────

  async function findSlots() {
    if (!appt.employeeId) {
      alert('Choose an employee to see their free slots.');
      return;
    }
    setSlotsBusy(true);
    try {
      const res = await api.getAppointmentSlots({
        employeeId: appt.employeeId,
        date: appt.date,
        durationMinutes: '60',
      });
      setSlots(res.data?.slots || []);
    } catch (err: any) {
      alert(err?.message || 'Could not load the free slots');
    } finally {
      setSlotsBusy(false);
    }
  }

  function pickSlot(slot: any) {
    const start = new Date(slot.startAt);
    const end = new Date(slot.endAt);
    const hhmm = (d: Date) =>
      `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    setAppt({ ...appt, date: isoDate(start), start: hhmm(start), end: hhmm(end) });
  }

  async function createAppointment() {
    if (!appt.title) {
      alert('Give the appointment a title so the calendar is readable.');
      return;
    }
    setBusy('appt');
    try {
      await api.createAppointment({
        title: appt.title,
        startAt: atLocalTime(appt.date, appt.start),
        endAt: atLocalTime(appt.date, appt.end),
        customerId: appt.customerId || null,
        employeeId: appt.employeeId || null,
        serviceProductId: appt.serviceProductId || null,
        notes: appt.notes || null,
      });
      setAppt({ ...appt, title: '', notes: '' });
      setSlots([]);
      await load();
    } catch (err: any) {
      alert(err?.message || 'Could not book the appointment');
    } finally {
      setBusy('');
    }
  }

  async function setApptStatus(id: string, status: string) {
    try {
      await api.setAppointmentStatus(id, { status });
      await load();
    } catch (err: any) {
      alert(err?.message || 'Could not update the appointment');
    }
  }

  // ── Work orders ───────────────────────────────────────────────────────────

  async function createWorkOrder() {
    setBusy('wo');
    try {
      await api.createWorkOrder({
        customerId: wo.customerId || null,
        assignedEmployeeId: wo.assignedEmployeeId || null,
        type: wo.type,
        deviceLabel: wo.deviceLabel || null,
        problem: wo.problem || null,
        warrantyUntil: wo.warrantyUntil || null,
        notes: wo.notes || null,
      });
      setWo({ ...wo, deviceLabel: '', problem: '', notes: '' });
      setShowWorkForm(false);
      await load();
    } catch (err: any) {
      alert(err?.message || 'Could not open the work order');
    } finally {
      setBusy('');
    }
  }

  async function openOrder(id: string) {
    try {
      const res = await api.getWorkOrder(id);
      setOpenWorkOrder(res.data);
      setLine({ kind: 'LABOR', productId: '', description: '', quantity: '1', unitPrice: '' });
    } catch (err: any) {
      alert(err?.message || 'Could not open the work order');
    }
  }

  async function addLine() {
    if (!openWorkOrder) return;
    if (!line.description) {
      alert('Describe the line — a part, a labour operation or a fee.');
      return;
    }
    setBusy('line');
    try {
      await api.addWorkOrderLine(openWorkOrder.id, {
        kind: line.kind,
        productId: line.productId || null,
        description: line.description,
        quantity: Number(line.quantity) || 1,
        // A blank price with a linked product means "use the catalog price".
        ...(line.unitPrice ? { unitPrice: Number(line.unitPrice) } : {}),
      });
      const refreshed = await api.getWorkOrder(openWorkOrder.id);
      setOpenWorkOrder(refreshed.data);
      setLine({ kind: 'LABOR', productId: '', description: '', quantity: '1', unitPrice: '' });
      await load();
    } catch (err: any) {
      alert(err?.message || 'Could not add the line');
    } finally {
      setBusy('');
    }
  }

  async function removeLine(lineId: string) {
    if (!openWorkOrder) return;
    try {
      const res = await api.deleteWorkOrderLine(openWorkOrder.id, lineId);
      setOpenWorkOrder(res.data);
      await load();
    } catch (err: any) {
      alert(err?.message || 'Could not remove the line');
    }
  }

  async function setWorkStatus(id: string, status: string) {
    try {
      await api.setWorkOrderStatus(id, { status });
      const refreshed = await api.getWorkOrder(id);
      setOpenWorkOrder(refreshed.data);
      await load();
    } catch (err: any) {
      alert(err?.message || 'Could not update the work order');
    }
  }

  // ── Rentals ───────────────────────────────────────────────────────────────

  async function createRental() {
    const clean = rentalLines
      .filter((l) => l.productId && Number(l.quantity) > 0)
      .map((l) => ({
        productId: l.productId,
        quantity: Number(l.quantity),
        rateUnit: l.rateUnit,
        ...(l.rate ? { rate: Number(l.rate) } : {}),
      }));
    if (clean.length === 0) {
      alert('Add at least one item to rent.');
      return;
    }
    setBusy('rental');
    try {
      await api.createRental({
        customerId: rental.customerId || null,
        startAt: new Date(rental.startAt).toISOString(),
        dueAt: new Date(rental.dueAt).toISOString(),
        depositAmount: rental.depositAmount ? Number(rental.depositAmount) : 0,
        notes: rental.notes || null,
        lines: clean,
      });
      setShowRentalForm(false);
      setRentalLines([{ productId: '', quantity: '1', rateUnit: 'DAY', rate: '' }]);
      await load();
    } catch (err: any) {
      alert(err?.message || 'Could not create the rental');
    } finally {
      setBusy('');
    }
  }

  async function rentOut(id: string) {
    try {
      await api.rentOut(id);
      await load();
    } catch (err: any) {
      alert(err?.message || 'Could not hand over the goods');
    }
  }

  function startReturn(r: any) {
    setReturning(r);
    const seed: Record<string, { qty: string; condition: string }> = {};
    for (const l of r.lines ?? []) {
      const remaining = Math.max(0, Number(l.quantity) - Number(l.returnedQty ?? 0));
      seed[l.id] = { qty: String(remaining), condition: 'OK' };
    }
    setReturnForm({ lateFeePerDay: '', lines: seed });
  }

  async function submitReturn() {
    if (!returning) return;
    const lines = Object.entries(returnForm.lines)
      .filter(([, v]) => Number(v.qty) > 0)
      .map(([lineId, v]) => ({ lineId, returnedQty: Number(v.qty), condition: v.condition }));
    if (lines.length === 0) {
      alert('Nothing is being returned — enter a quantity on at least one line.');
      return;
    }
    setBusy('return');
    try {
      const res = await api.returnRental(returning.id, {
        lateFeePerDay: returnForm.lateFeePerDay ? Number(returnForm.lateFeePerDay) : 0,
        lines,
      });
      const fee = Number(res.lateFeeAmount ?? 0);
      setNotice(
        `Return processed · status ${res.data?.status}` + (fee > 0 ? ` · late fee ${money(fee)}` : ''),
      );
      setReturning(null);
      await load();
    } catch (err: any) {
      alert(err?.message || 'Could not process the return');
    } finally {
      setBusy('');
    }
  }

  async function cancelRental(id: string) {
    if (!confirm('Cancel this rental agreement?')) return;
    try {
      await api.cancelRental(id);
      await load();
    } catch (err: any) {
      alert(err?.message || 'Could not cancel the rental');
    }
  }

  const tabButton = (value: Tab, label: string, Icon: any) => (
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
          <h1 className="text-2xl font-bold">Service &amp; Rentals</h1>
          <p className="text-gray-500">Book appointments, run repair jobs and track rented stock</p>
        </div>
        <button
          onClick={load}
          className="p-2 border rounded-lg bg-white hover:bg-gray-50"
          title="Reload"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
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

      <div className="flex items-center gap-2">
        {tabButton('appointments', 'Appointments', CalendarCheck)}
        {tabButton('work', 'Work orders', Wrench)}
        {tabButton('rentals', 'Rentals', PackageOpen)}
      </div>

      {tab === 'appointments' && (
        <>
          <div className="bg-white rounded-lg border p-6 space-y-3">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Plus size={18} /> Book an appointment
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
              <input
                value={appt.title}
                onChange={(e) => setAppt({ ...appt, title: e.target.value })}
                placeholder="What is being booked?"
                className="border rounded px-3 py-2 text-sm md:col-span-2"
              />
              <select
                value={appt.employeeId}
                onChange={(e) => setAppt({ ...appt, employeeId: e.target.value })}
                className="border rounded px-3 py-2 text-sm"
              >
                <option value="">Any employee</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.user?.name}
                  </option>
                ))}
              </select>
              <input
                type="date"
                value={appt.date}
                onChange={(e) => setAppt({ ...appt, date: e.target.value })}
                className="border rounded px-3 py-2 text-sm"
              />
              <input
                type="time"
                value={appt.start}
                onChange={(e) => setAppt({ ...appt, start: e.target.value })}
                className="border rounded px-3 py-2 text-sm"
              />
              <input
                type="time"
                value={appt.end}
                onChange={(e) => setAppt({ ...appt, end: e.target.value })}
                className="border rounded px-3 py-2 text-sm"
              />
              <select
                value={appt.customerId}
                onChange={(e) => setAppt({ ...appt, customerId: e.target.value })}
                className="border rounded px-3 py-2 text-sm md:col-span-2"
              >
                <option value="">Walk-in customer</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <select
                value={appt.serviceProductId}
                onChange={(e) => setAppt({ ...appt, serviceProductId: e.target.value })}
                className="border rounded px-3 py-2 text-sm md:col-span-2"
              >
                <option value="">No linked service</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <button
                onClick={findSlots}
                disabled={slotsBusy}
                className="border rounded-lg px-3 py-2 text-sm bg-gray-50 hover:bg-gray-100 disabled:opacity-50"
              >
                {slotsBusy ? 'Checking…' : 'Find free slots'}
              </button>
              <button
                onClick={createAppointment}
                disabled={busy === 'appt'}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm"
              >
                {busy === 'appt' ? 'Booking…' : 'Book'}
              </button>
            </div>

            {slots.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {slots.slice(0, 24).map((s) => {
                  const start = new Date(s.startAt);
                  return (
                    <button
                      key={s.startAt}
                      onClick={() => pickSlot(s)}
                      className="px-3 py-1 border rounded-full text-xs hover:bg-blue-50 hover:border-blue-400 tabular-nums"
                    >
                      {start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="bg-white rounded-lg border overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <h2 className="font-semibold flex items-center gap-2">
                <CalendarCheck size={18} /> Booked
              </h2>
              <div className="flex items-center gap-2 text-sm">
                <input
                  type="date"
                  value={range.from}
                  onChange={(e) => setRange({ ...range, from: e.target.value })}
                  className="border rounded px-2 py-1"
                />
                <span className="text-gray-400">→</span>
                <input
                  type="date"
                  value={range.to}
                  onChange={(e) => setRange({ ...range, to: e.target.value })}
                  className="border rounded px-2 py-1"
                />
              </div>
            </div>
            {appointments.length === 0 ? (
              <div className="p-6 text-sm text-gray-500">Nothing booked in this window.</div>
            ) : (
              <div className="divide-y">
                {appointments.map((a) => {
                  const next = APPOINTMENT_FLOW[a.status] ?? [];
                  return (
                    <div key={a.id} className="px-4 py-3 flex items-center justify-between gap-4 text-sm">
                      <div className="min-w-0">
                        <div className="font-medium truncate">{a.title}</div>
                        <div className="text-xs text-gray-500 flex items-center gap-3">
                          <span className="flex items-center gap-1">
                            <Clock size={12} />
                            {new Date(a.startAt).toLocaleString()} –{' '}
                            {new Date(a.endAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          <span>{employeeName(a.employeeId)}</span>
                          <span>{customerName(a.customerId)}</span>
                          {a.serviceProductId && <span>· {productName(a.serviceProductId)}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`text-xs px-2 py-0.5 rounded ${badge(a.status)}`}>{a.status}</span>
                        {next.map((status) => (
                          <button
                            key={status}
                            onClick={() => setApptStatus(a.id, status)}
                            className={`px-2 py-1 border rounded text-xs hover:bg-gray-50 ${
                              status === 'CANCELLED' || status === 'NO_SHOW' ? 'text-rose-600' : ''
                            }`}
                          >
                            {status === 'IN_PROGRESS' ? 'Start' : status === 'COMPLETED' ? 'Complete' : status}
                          </button>
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

      {tab === 'work' && (
        <>
          <div className="flex justify-end">
            <button
              onClick={() => setShowWorkForm(!showWorkForm)}
              className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 text-sm"
            >
              <Plus size={16} /> New work order
            </button>
          </div>

          {showWorkForm && (
            <div className="bg-white rounded-lg border p-6 space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
                <select
                  value={wo.customerId}
                  onChange={(e) => setWo({ ...wo, customerId: e.target.value })}
                  className="border rounded px-3 py-2 text-sm md:col-span-2"
                >
                  <option value="">Walk-in customer</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <select
                  value={wo.assignedEmployeeId}
                  onChange={(e) => setWo({ ...wo, assignedEmployeeId: e.target.value })}
                  className="border rounded px-3 py-2 text-sm md:col-span-2"
                >
                  <option value="">Unassigned</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.user?.name}
                    </option>
                  ))}
                </select>
                <select
                  value={wo.type}
                  onChange={(e) => setWo({ ...wo, type: e.target.value })}
                  className="border rounded px-3 py-2 text-sm"
                >
                  <option value="REPAIR">Repair</option>
                  <option value="SERVICE">Service</option>
                  <option value="INSTALL">Install</option>
                </select>
                <input
                  value={wo.deviceLabel}
                  onChange={(e) => setWo({ ...wo, deviceLabel: e.target.value })}
                  placeholder="Device / asset"
                  className="border rounded px-3 py-2 text-sm"
                />
                <input
                  value={wo.problem}
                  onChange={(e) => setWo({ ...wo, problem: e.target.value })}
                  placeholder="Reported problem"
                  className="border rounded px-3 py-2 text-sm md:col-span-4"
                />
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500 whitespace-nowrap">Warranty until</span>
                  <input
                    type="date"
                    value={wo.warrantyUntil}
                    onChange={(e) => setWo({ ...wo, warrantyUntil: e.target.value })}
                    className="border rounded px-2 py-2 text-sm w-full"
                  />
                </div>
                <button
                  onClick={createWorkOrder}
                  disabled={busy === 'wo'}
                  className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm"
                >
                  {busy === 'wo' ? 'Opening…' : 'Open job'}
                </button>
              </div>
            </div>
          )}

          <div className="bg-white rounded-lg border overflow-hidden">
            {workOrders.length === 0 ? (
              <div className="p-6 text-sm text-gray-500">No work orders yet.</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                  <tr>
                    <th className="text-left px-4 py-2">Number</th>
                    <th className="text-left px-4 py-2">Type</th>
                    <th className="text-left px-4 py-2">Device</th>
                    <th className="text-left px-4 py-2">Customer</th>
                    <th className="text-left px-4 py-2">Status</th>
                    <th className="text-right px-4 py-2">Labour</th>
                    <th className="text-right px-4 py-2">Parts</th>
                    <th className="text-right px-4 py-2">Total</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {workOrders.map((w) => (
                    <tr key={w.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2 font-mono text-xs">{w.number}</td>
                      <td className="px-4 py-2">{w.type}</td>
                      <td className="px-4 py-2">{w.deviceLabel || '—'}</td>
                      <td className="px-4 py-2">{customerName(w.customerId)}</td>
                      <td className="px-4 py-2">
                        <span className={`text-xs px-2 py-0.5 rounded ${badge(w.status)}`}>{w.status}</span>
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">{money(w.laborTotal)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{money(w.partsTotal)}</td>
                      <td className="px-4 py-2 text-right tabular-nums font-medium">{money(w.totalAmount)}</td>
                      <td className="px-4 py-2 text-right">
                        <button onClick={() => openOrder(w.id)} className="text-blue-600 hover:underline text-xs">
                          Open
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {openWorkOrder && (
            <div className="bg-white rounded-lg border p-6 space-y-4">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-lg font-semibold">
                    {openWorkOrder.number} · {openWorkOrder.deviceLabel || openWorkOrder.type}
                  </h2>
                  <p className="text-sm text-gray-500">
                    {customerName(openWorkOrder.customerId)} · {employeeName(openWorkOrder.assignedEmployeeId)}
                    {openWorkOrder.warrantyUntil &&
                      ` · warranty to ${String(openWorkOrder.warrantyUntil).slice(0, 10)}`}
                  </p>
                  {openWorkOrder.problem && (
                    <p className="text-sm text-gray-700 mt-1 max-w-2xl">{openWorkOrder.problem}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded ${badge(openWorkOrder.status)}`}>
                    {openWorkOrder.status}
                  </span>
                  {(WORK_FLOW[openWorkOrder.status] ?? []).map((status) => (
                    <button
                      key={status}
                      onClick={() => setWorkStatus(openWorkOrder.id, status)}
                      className={`px-2 py-1 border rounded text-xs hover:bg-gray-50 ${
                        status === 'CANCELLED' ? 'text-rose-600' : ''
                      }`}
                    >
                      <ArrowRight size={12} className="inline" /> {status}
                    </button>
                  ))}
                  <button onClick={() => setOpenWorkOrder(null)} className="text-gray-400 hover:text-gray-600">
                    <XCircle size={18} />
                  </button>
                </div>
              </div>

              <div className="border rounded overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                    <tr>
                      <th className="text-left px-4 py-2">Kind</th>
                      <th className="text-left px-4 py-2">Description</th>
                      <th className="text-right px-4 py-2">Qty</th>
                      <th className="text-right px-4 py-2">Unit</th>
                      <th className="text-right px-4 py-2">Total</th>
                      <th className="px-4 py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {(openWorkOrder.lines ?? []).length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-3 text-gray-500">
                          No lines yet — add labour or parts below.
                        </td>
                      </tr>
                    ) : (
                      openWorkOrder.lines.map((l: any) => (
                        <tr key={l.id}>
                          <td className="px-4 py-2">{l.kind}</td>
                          <td className="px-4 py-2">{l.description}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{Number(l.quantity)}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{money(l.unitPrice)}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{money(l.totalAmount)}</td>
                          <td className="px-4 py-2 text-right">
                            <button
                              onClick={() => removeLine(l.id)}
                              className="text-gray-400 hover:text-rose-600"
                              title="Remove line"
                            >
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
                <select
                  value={line.kind}
                  onChange={(e) => setLine({ ...line, kind: e.target.value })}
                  className="border rounded px-2 py-2 text-sm"
                >
                  <option value="LABOR">Labour</option>
                  <option value="PART">Part</option>
                  <option value="FEE">Fee</option>
                </select>
                <select
                  value={line.productId}
                  onChange={(e) => {
                    const chosen = products.find((p) => p.id === e.target.value);
                    setLine({
                      ...line,
                      productId: e.target.value,
                      description: line.description || chosen?.name || '',
                    });
                  }}
                  className="border rounded px-2 py-2 text-sm md:col-span-2"
                >
                  <option value="">No catalog item</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <input
                  value={line.description}
                  onChange={(e) => setLine({ ...line, description: e.target.value })}
                  placeholder="Description"
                  className="border rounded px-2 py-2 text-sm"
                />
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={line.quantity}
                  onChange={(e) => setLine({ ...line, quantity: e.target.value })}
                  placeholder="Qty"
                  className="border rounded px-2 py-2 text-sm"
                />
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={line.unitPrice}
                    onChange={(e) => setLine({ ...line, unitPrice: e.target.value })}
                    placeholder="Unit price"
                    className="border rounded px-2 py-2 text-sm w-full"
                  />
                  <button
                    onClick={addLine}
                    disabled={busy === 'line'}
                    className="bg-blue-600 text-white px-3 py-2 rounded text-sm hover:bg-blue-700 disabled:opacity-50"
                  >
                    Add
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {tab === 'rentals' && (
        <>
          <div className="flex justify-end">
            <button
              onClick={() => setShowRentalForm(!showRentalForm)}
              className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 text-sm"
            >
              <Plus size={16} /> New rental
            </button>
          </div>

          {showRentalForm && (
            <div className="bg-white rounded-lg border p-6 space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <select
                  value={rental.customerId}
                  onChange={(e) => setRental({ ...rental, customerId: e.target.value })}
                  className="border rounded px-3 py-2 text-sm md:col-span-2"
                >
                  <option value="">Walk-in customer</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <label className="text-xs text-gray-600">
                  Out
                  <input
                    type="datetime-local"
                    value={rental.startAt}
                    onChange={(e) => setRental({ ...rental, startAt: e.target.value })}
                    className="border rounded px-2 py-2 text-sm w-full"
                  />
                </label>
                <label className="text-xs text-gray-600">
                  Due back
                  <input
                    type="datetime-local"
                    value={rental.dueAt}
                    onChange={(e) => setRental({ ...rental, dueAt: e.target.value })}
                    className="border rounded px-2 py-2 text-sm w-full"
                  />
                </label>
                <label className="text-xs text-gray-600">
                  Deposit
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={rental.depositAmount}
                    onChange={(e) => setRental({ ...rental, depositAmount: e.target.value })}
                    className="border rounded px-2 py-2 text-sm w-full"
                  />
                </label>
              </div>

              <div className="space-y-2">
                {rentalLines.map((rl, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <select
                      value={rl.productId}
                      onChange={(e) => {
                        const next = [...rentalLines];
                        next[index] = { ...next[index], productId: e.target.value };
                        setRentalLines(next);
                      }}
                      className="flex-1 border rounded px-3 py-2 text-sm"
                    >
                      <option value="">Select an item…</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} — {money(p.price)}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={rl.quantity}
                      onChange={(e) => {
                        const next = [...rentalLines];
                        next[index] = { ...next[index], quantity: e.target.value };
                        setRentalLines(next);
                      }}
                      placeholder="Qty"
                      className="w-20 border rounded px-2 py-2 text-sm"
                    />
                    <select
                      value={rl.rateUnit}
                      onChange={(e) => {
                        const next = [...rentalLines];
                        next[index] = { ...next[index], rateUnit: e.target.value };
                        setRentalLines(next);
                      }}
                      className="border rounded px-2 py-2 text-sm"
                    >
                      <option value="HOUR">per hour</option>
                      <option value="DAY">per day</option>
                      <option value="WEEK">per week</option>
                    </select>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={rl.rate}
                      onChange={(e) => {
                        const next = [...rentalLines];
                        next[index] = { ...next[index], rate: e.target.value };
                        setRentalLines(next);
                      }}
                      placeholder="Rate"
                      className="w-24 border rounded px-2 py-2 text-sm"
                    />
                  </div>
                ))}
                <button
                  onClick={() => setRentalLines([...rentalLines, { productId: '', quantity: '1', rateUnit: 'DAY', rate: '' }])}
                  className="text-xs text-blue-600 hover:underline"
                >
                  + Add another item
                </button>
              </div>

              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-500">
                  A blank rate uses the catalog price as the daily rate. Deposits are recorded, not charged.
                </p>
                <button
                  onClick={createRental}
                  disabled={busy === 'rental'}
                  className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm"
                >
                  {busy === 'rental' ? 'Creating…' : 'Create agreement'}
                </button>
              </div>
            </div>
          )}

          <div className="bg-white rounded-lg border overflow-hidden">
            {rentals.length === 0 ? (
              <div className="p-6 text-sm text-gray-500">No rental agreements.</div>
            ) : (
              <div className="divide-y">
                {rentals.map((r) => {
                  const outstanding = (r.lines ?? []).reduce(
                    (s: number, l: any) => s + Math.max(0, Number(l.quantity) - Number(l.returnedQty ?? 0)),
                    0,
                  );
                  const overdue = new Date(r.dueAt) < new Date() && ['OUT', 'PARTIALLY_RETURNED', 'OVERDUE'].includes(r.status);
                  return (
                    <div key={r.id} className="px-4 py-3 space-y-2">
                      <div className="flex items-center justify-between gap-4 text-sm">
                        <div>
                          <div className="font-medium">
                            <span className="font-mono text-xs text-gray-500 mr-2">{r.number}</span>
                            {customerName(r.customerId)}
                            <span className="text-gray-500 font-normal"> · {outstanding} item(s) out</span>
                          </div>
                          <div className="text-xs text-gray-500">
                            {new Date(r.startAt).toLocaleString()} → {new Date(r.dueAt).toLocaleString()}
                            {' · deposit '}
                            {money(r.depositAmount)}
                            {' · rate '}
                            {money(r.rateAmount)}
                            {Number(r.lateFeeAmount) > 0 && ` · late fee ${money(r.lateFeeAmount)}`}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-xs px-2 py-0.5 rounded ${
                              overdue ? 'bg-rose-100 text-rose-800' : badge(r.status)
                            }`}
                          >
                            {overdue ? 'OVERDUE' : r.status}
                          </span>
                          <span className="text-sm font-semibold tabular-nums">{money(r.totalAmount)}</span>
                          {r.status === 'RESERVED' && (
                            <>
                              <button
                                onClick={() => rentOut(r.id)}
                                className="px-2 py-1 border rounded text-xs hover:bg-gray-50"
                              >
                                Hand over
                              </button>
                              <button
                                onClick={() => cancelRental(r.id)}
                                className="px-2 py-1 border rounded text-xs text-rose-600 hover:bg-rose-50"
                              >
                                Cancel
                              </button>
                            </>
                          )}
                          {['OUT', 'PARTIALLY_RETURNED', 'OVERDUE'].includes(r.status) && (
                            <button
                              onClick={() => startReturn(r)}
                              className="flex items-center gap-1 px-2 py-1 border rounded text-xs hover:bg-gray-50"
                            >
                              <CornerDownLeft size={12} /> Return
                            </button>
                          )}
                        </div>
                      </div>

                      {returning?.id === r.id && (
                        <div className="bg-gray-50 border rounded p-3 space-y-2">
                          {(r.lines ?? []).map((l: any) => {
                            const remaining = Math.max(0, Number(l.quantity) - Number(l.returnedQty ?? 0));
                            return (
                              <div key={l.id} className="flex items-center gap-2 text-sm">
                                <span className="flex-1">
                                  {l.productName}
                                  <span className="text-xs text-gray-500"> · {remaining} remaining of {Number(l.quantity)}</span>
                                </span>
                                <input
                                  type="number"
                                  min="0"
                                  max={remaining}
                                  step="0.01"
                                  value={returnForm.lines[l.id]?.qty ?? '0'}
                                  onChange={(e) =>
                                    setReturnForm({
                                      ...returnForm,
                                      lines: {
                                        ...returnForm.lines,
                                        [l.id]: { ...(returnForm.lines[l.id] ?? { condition: 'OK' }), qty: e.target.value },
                                      },
                                    })
                                  }
                                  className="w-20 border rounded px-2 py-1 text-sm"
                                />
                                <select
                                  value={returnForm.lines[l.id]?.condition ?? 'OK'}
                                  onChange={(e) =>
                                    setReturnForm({
                                      ...returnForm,
                                      lines: {
                                        ...returnForm.lines,
                                        [l.id]: { ...(returnForm.lines[l.id] ?? { qty: String(remaining) }), condition: e.target.value },
                                      },
                                    })
                                  }
                                  className="border rounded px-2 py-1 text-sm"
                                >
                                  <option value="OK">OK</option>
                                  <option value="DAMAGED">Damaged</option>
                                  <option value="LOST">Lost</option>
                                </select>
                              </div>
                            );
                          })}
                          <div className="flex items-center justify-between pt-1">
                            <label className="text-xs text-gray-600 flex items-center gap-2">
                              Late fee per day
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={returnForm.lateFeePerDay}
                                onChange={(e) => setReturnForm({ ...returnForm, lateFeePerDay: e.target.value })}
                                className="w-24 border rounded px-2 py-1 text-sm"
                              />
                            </label>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => setReturning(null)}
                                className="px-3 py-1 border rounded text-sm hover:bg-white"
                              >
                                Cancel
                              </button>
                              <button
                                onClick={submitReturn}
                                disabled={busy === 'return'}
                                className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50"
                              >
                                {busy === 'return' ? 'Processing…' : 'Process return'}
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
