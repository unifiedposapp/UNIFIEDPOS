import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Armchair, Plus, X, Calendar, Clock, Users } from 'lucide-react';

const STATUS_COLORS: Record<string, string> = {
  AVAILABLE: 'bg-green-100 text-green-800 border-green-300',
  OCCUPIED: 'bg-red-100 text-red-800 border-red-300',
  RESERVED: 'bg-blue-100 text-blue-800 border-blue-300',
  DIRTY: 'bg-yellow-100 text-yellow-800 border-yellow-300',
};

const RES_STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-yellow-100 text-yellow-700',
  CONFIRMED: 'bg-blue-100 text-blue-700',
  SEATED: 'bg-green-100 text-green-700',
  COMPLETED: 'bg-gray-100 text-gray-700',
  CANCELLED: 'bg-red-100 text-red-700',
  NO_SHOW: 'bg-red-100 text-red-700',
};

const WAIT_STATUS_COLORS: Record<string, string> = {
  WAITING: 'bg-yellow-100 text-yellow-700',
  NOTIFIED: 'bg-blue-100 text-blue-700',
  SEATED: 'bg-green-100 text-green-700',
  LEFT: 'bg-gray-100 text-gray-700',
};

export default function RestaurantPage() {
  const [tab, setTab] = useState<'tables' | 'reservations' | 'waitlist'>('tables');
  const [tables, setTables] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [reservations, setReservations] = useState<any[]>([]);
  const [waitlist, setWaitlist] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ number: '', name: '', capacity: '4', section: '', notes: '' });
  const [resForm, setResForm] = useState({ customerName: '', partySize: '2', date: '', time: '', notes: '' });
  const [waitForm, setWaitForm] = useState({ name: '', partySize: '2', phone: '', notes: '' });

  const load = async () => {
    const res = await api.getRestaurantOverview();
    setTables(res.data.tables);
    setSummary(res.data.summary);
  };

  const loadReservations = async () => {
    const res = await api.getReservations();
    setReservations(res.data || []);
  };

  const loadWaitlist = async () => {
    const res = await api.getWaitlist();
    setWaitlist(res.data || []);
  };

  useEffect(() => {
    if (tab === 'tables') load();
    else if (tab === 'reservations') loadReservations();
    else if (tab === 'waitlist') loadWaitlist();
  }, [tab]);

  const createTable = async () => {
    await api.createRestaurantTable({
      number: Number(form.number),
      name: form.name || undefined,
      capacity: Number(form.capacity),
      section: form.section || undefined,
      notes: form.notes || undefined,
    });
    setShowForm(false);
    setForm({ number: '', name: '', capacity: '4', section: '', notes: '' });
    load();
  };

  const changeStatus = async (id: string, status: string) => {
    await api.updateTableStatus(id, status);
    load();
  };

  const deleteTable = async (id: string) => {
    if (!confirm('Delete this table?')) return;
    await api.deleteRestaurantTable(id);
    load();
  };

  const createReservation = async () => {
    await api.createReservation({
      customerName: resForm.customerName,
      partySize: Number(resForm.partySize),
      reservationDate: `${resForm.date}T${resForm.time || '19:00'}:00.000Z`,
      notes: resForm.notes || undefined,
    });
    setResForm({ customerName: '', partySize: '2', date: '', time: '', notes: '' });
    loadReservations();
  };

  const updateResStatus = async (id: string, status: string) => {
    await api.updateReservationStatus(id, status);
    loadReservations();
  };

  const addToWaitlist = async () => {
    await api.addToWaitlist({
      name: waitForm.name,
      partySize: Number(waitForm.partySize),
      phone: waitForm.phone || undefined,
      notes: waitForm.notes || undefined,
    });
    setWaitForm({ name: '', partySize: '2', phone: '', notes: '' });
    loadWaitlist();
  };

  const updateWaitStatus = async (id: string, status: string) => {
    await api.updateWaitlistStatus(id, status);
    loadWaitlist();
  };

  const sections = summary?.sections || [];
  const grouped = sections.length > 0
    ? sections.map((s: string) => ({ section: s, tables: tables.filter(t => t.section === s) }))
    : [{ section: 'All', tables }];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Restaurant</h1>
          <p className="text-gray-500">Tables, reservations & waitlist</p>
        </div>
      </div>

      {/* Tab Bar */}
      <div className="flex gap-2 mb-2">
        {[
          { key: 'tables', label: 'Floor Plan', icon: Armchair },
          { key: 'reservations', label: 'Reservations', icon: Calendar },
          { key: 'waitlist', label: 'Waitlist', icon: Clock },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key as any)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium ${tab === t.key ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            <t.icon size={16} /> {t.label}
          </button>
        ))}
      </div>

      {/* TABLES TAB */}
      {tab === 'tables' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex gap-4">
              {summary && (
                <div className="grid grid-cols-5 gap-3">
                  {[
                    { label: 'Total', value: summary.total, color: 'bg-gray-50' },
                    { label: 'Available', value: summary.available, color: 'bg-green-50' },
                    { label: 'Occupied', value: summary.occupied, color: 'bg-red-50' },
                    { label: 'Reserved', value: summary.reserved, color: 'bg-blue-50' },
                    { label: 'Dirty', value: summary.dirty, color: 'bg-yellow-50' },
                  ].map(s => (
                    <div key={s.label} className={`${s.color} rounded-lg p-3 text-center`}>
                      <div className="text-xl font-bold">{s.value}</div>
                      <div className="text-xs text-gray-600">{s.label}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700">
              <Plus size={18} /> Add Table
            </button>
          </div>

          {showForm && (
            <div className="bg-white rounded-lg border p-4 space-y-3">
              <h3 className="font-semibold">New Table</h3>
              <div className="grid grid-cols-5 gap-3">
                <input placeholder="Table #" value={form.number} onChange={e => setForm({ ...form, number: e.target.value })} className="border rounded px-3 py-2" />
                <input placeholder="Name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="border rounded px-3 py-2" />
                <input placeholder="Capacity" type="number" value={form.capacity} onChange={e => setForm({ ...form, capacity: e.target.value })} className="border rounded px-3 py-2" />
                <input placeholder="Section" value={form.section} onChange={e => setForm({ ...form, section: e.target.value })} className="border rounded px-3 py-2" />
                <button onClick={createTable} className="bg-blue-600 text-white rounded px-4 py-2 hover:bg-blue-700">Create</button>
              </div>
            </div>
          )}

          {grouped.map((group: any) => (
            <div key={group.section}>
              <h2 className="text-lg font-semibold mb-3">{group.section}</h2>
              <div className="grid grid-cols-4 gap-4">
                {group.tables.map((table: any) => (
                  <div key={table.id} className={`border rounded-lg p-4 ${STATUS_COLORS[table.status] || 'bg-gray-50'}`}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Armchair size={20} />
                        <span className="font-bold text-lg">Table {table.number}</span>
                      </div>
                      <button onClick={() => deleteTable(table.id)} className="text-gray-400 hover:text-red-500"><X size={16} /></button>
                    </div>
                    {table.name && <div className="text-sm mb-1">{table.name}</div>}
                    <div className="text-sm">Capacity: {table.capacity} | Status: {table.status}</div>
                    <div className="flex gap-1 mt-3">
                      {['AVAILABLE', 'OCCUPIED', 'RESERVED', 'DIRTY'].map(s => (
                        <button key={s} onClick={() => changeStatus(table.id, s)}
                          className={`text-xs px-2 py-1 rounded border ${table.status === s ? 'bg-white font-bold' : 'bg-transparent opacity-60 hover:opacity-100'}`}>
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* RESERVATIONS TAB */}
      {tab === 'reservations' && (
        <div className="space-y-6">
          <div className="bg-white rounded-lg border p-4 space-y-3">
            <h3 className="font-semibold flex items-center gap-2"><Calendar size={18} /> New Reservation</h3>
            <div className="grid grid-cols-5 gap-3">
              <input placeholder="Customer Name" value={resForm.customerName} onChange={e => setResForm({ ...resForm, customerName: e.target.value })} className="border rounded px-3 py-2" />
              <input placeholder="Party Size" type="number" value={resForm.partySize} onChange={e => setResForm({ ...resForm, partySize: e.target.value })} className="border rounded px-3 py-2" />
              <input placeholder="Date" type="date" value={resForm.date} onChange={e => setResForm({ ...resForm, date: e.target.value })} className="border rounded px-3 py-2" />
              <input placeholder="Time" type="time" value={resForm.time} onChange={e => setResForm({ ...resForm, time: e.target.value })} className="border rounded px-3 py-2" />
              <button onClick={createReservation} className="bg-blue-600 text-white rounded px-4 py-2 hover:bg-blue-700">Reserve</button>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">Customer</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">Party</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">Date</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">Status</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {reservations.map(r => (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-medium">{r.customerName}</td>
                    <td className="px-4 py-3 text-sm"><Users size={14} className="inline mr-1" />{r.partySize}</td>
                    <td className="px-4 py-3 text-sm">{new Date(r.reservationDate).toLocaleString()}</td>
                    <td className="px-4 py-3"><span className={`px-2 py-1 rounded-full text-xs font-medium ${RES_STATUS_COLORS[r.status] || 'bg-gray-100 text-gray-700'}`}>{r.status}</span></td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        {r.status === 'PENDING' && <button onClick={() => updateResStatus(r.id, 'CONFIRMED')} className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs hover:bg-blue-200">Confirm</button>}
                        {r.status === 'CONFIRMED' && <button onClick={() => updateResStatus(r.id, 'SEATED')} className="px-2 py-1 bg-green-100 text-green-700 rounded text-xs hover:bg-green-200">Seat</button>}
                        {r.status === 'SEATED' && <button onClick={() => updateResStatus(r.id, 'COMPLETED')} className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs hover:bg-gray-200">Complete</button>}
                        {['PENDING', 'CONFIRMED'].includes(r.status) && <button onClick={() => updateResStatus(r.id, 'CANCELLED')} className="px-2 py-1 bg-red-100 text-red-700 rounded text-xs hover:bg-red-200">Cancel</button>}
                      </div>
                    </td>
                  </tr>
                ))}
                {reservations.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-500">No reservations</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* WAITLIST TAB */}
      {tab === 'waitlist' && (
        <div className="space-y-6">
          <div className="bg-white rounded-lg border p-4 space-y-3">
            <h3 className="font-semibold flex items-center gap-2"><Clock size={18} /> Add to Waitlist</h3>
            <div className="grid grid-cols-5 gap-3">
              <input placeholder="Name" value={waitForm.name} onChange={e => setWaitForm({ ...waitForm, name: e.target.value })} className="border rounded px-3 py-2" />
              <input placeholder="Party Size" type="number" value={waitForm.partySize} onChange={e => setWaitForm({ ...waitForm, partySize: e.target.value })} className="border rounded px-3 py-2" />
              <input placeholder="Phone" value={waitForm.phone} onChange={e => setWaitForm({ ...waitForm, phone: e.target.value })} className="border rounded px-3 py-2" />
              <input placeholder="Notes" value={waitForm.notes} onChange={e => setWaitForm({ ...waitForm, notes: e.target.value })} className="border rounded px-3 py-2" />
              <button onClick={addToWaitlist} className="bg-blue-600 text-white rounded px-4 py-2 hover:bg-blue-700">Add</button>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">Name</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">Party</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">Phone</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">Wait Time</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">Status</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {waitlist.map(w => (
                  <tr key={w.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-medium">{w.name}</td>
                    <td className="px-4 py-3 text-sm"><Users size={14} className="inline mr-1" />{w.partySize}</td>
                    <td className="px-4 py-3 text-sm">{w.phone || '-'}</td>
                    <td className="px-4 py-3 text-sm">{Math.round((Date.now() - new Date(w.createdAt).getTime()) / 60000)} min</td>
                    <td className="px-4 py-3"><span className={`px-2 py-1 rounded-full text-xs font-medium ${WAIT_STATUS_COLORS[w.status] || 'bg-gray-100 text-gray-700'}`}>{w.status}</span></td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        {w.status === 'WAITING' && <button onClick={() => updateWaitStatus(w.id, 'NOTIFIED')} className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs hover:bg-blue-200">Notify</button>}
                        {w.status === 'NOTIFIED' && <button onClick={() => updateWaitStatus(w.id, 'SEATED')} className="px-2 py-1 bg-green-100 text-green-700 rounded text-xs hover:bg-green-200">Seat</button>}
                        {['WAITING', 'NOTIFIED'].includes(w.status) && <button onClick={() => updateWaitStatus(w.id, 'LEFT')} className="px-2 py-1 bg-red-100 text-red-700 rounded text-xs hover:bg-red-200">Left</button>}
                      </div>
                    </td>
                  </tr>
                ))}
                {waitlist.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">No one on the waitlist</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
