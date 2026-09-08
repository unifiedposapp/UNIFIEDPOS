import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuthStore } from '../stores/authStore';
import { DollarSign, Lock, Unlock, AlertCircle, CheckCircle } from 'lucide-react';
import clsx from 'clsx';

export default function RegistersPage() {
  const [registers, setRegisters] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showOpenModal, setShowOpenModal] = useState(false);
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [openingCash, setOpeningCash] = useState('');
  const [closingCash, setClosingCash] = useState('');
  const [closeNotes, setCloseNotes] = useState('');
  const [processing, setProcessing] = useState(false);
  // Register selection for opening a session, plus inline creation when the
  // organization has no registers yet (so "Open Register" is never a dead end).
  const [selectedRegisterId, setSelectedRegisterId] = useState('');
  const [newRegisterName, setNewRegisterName] = useState('');
  const [newRegisterLocationId, setNewRegisterLocationId] = useState('');
  const { employee: _employee } = useAuthStore();

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [registersRes, sessionRes, locationsRes] = await Promise.all([
        api.getRegisters(),
        api.getRegisterSession(),
        api.getLocations(),
      ]);
      const regs = registersRes.data?.items || registersRes.data || [];
      setRegisters(regs);
      setSession(sessionRes.data);
      setLocations(locationsRes.data?.items || locationsRes.data || []);
      // Default the open-modal selection to the first available register.
      setSelectedRegisterId((prev) => prev || regs[0]?.id || '');
    } catch (err) {
      console.error('Failed to load registers:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleOpenRegister(e: React.FormEvent) {
    e.preventDefault();
    if (session) return;
    setProcessing(true);
    try {
      let registerId = selectedRegisterId;
      // No registers yet — create one first (OWNER/ADMIN), then open it. This
      // keeps "Open Register" actionable instead of permanently disabled.
      if (!registerId) {
        if (!newRegisterName.trim() || !newRegisterLocationId) {
          alert('Enter a register name and choose a location.');
          return;
        }
        const created = await api.createRegister({
          name: newRegisterName.trim(),
          locationId: newRegisterLocationId,
        });
        registerId = created.data.id;
      }
      await api.openRegister({
        registerId,
        openingCash: Number(openingCash),
      });
      setShowOpenModal(false);
      setOpeningCash('');
      setNewRegisterName('');
      setNewRegisterLocationId('');
      loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to open register');
    } finally {
      setProcessing(false);
    }
  }

  async function handleCloseRegister(e: React.FormEvent) {
    e.preventDefault();
    setProcessing(true);
    try {
      await api.closeRegister({
        closingCash: Number(closingCash),
        notes: closeNotes || undefined,
      });
      setShowCloseModal(false);
      setClosingCash('');
      setCloseNotes('');
      loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to close register');
    } finally {
      setProcessing(false);
    }
  }

  const statusColors: Record<string, string> = {
    CLOSED: 'bg-gray-100 text-gray-700',
    OPENING: 'bg-yellow-100 text-yellow-700',
    OPEN: 'bg-green-100 text-green-700',
    SUSPENDED: 'bg-orange-100 text-orange-700',
    CLOSING: 'bg-red-100 text-red-700',
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Register Management</h1>
        {!session ? (
          <button
            onClick={() => {
              setSelectedRegisterId(registers[0]?.id || '');
              setShowOpenModal(true);
            }}
            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm font-medium flex items-center gap-2"
          >
            <Unlock size={16} /> Open Register
          </button>
        ) : (
          <button
            onClick={() => setShowCloseModal(true)}
            className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm font-medium flex items-center gap-2"
          >
            <Lock size={16} /> Close Register
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64 text-gray-400">Loading...</div>
      ) : (
        <>
          {/* Current Session Status */}
          {session ? (
            <div className="bg-green-50 border border-green-200 rounded-xl p-6 mb-6">
              <div className="flex items-center gap-3 mb-4">
                <CheckCircle size={24} className="text-green-600" />
                <div>
                  <h2 className="text-lg font-bold text-green-900">Register Open</h2>
                  <p className="text-sm text-green-700">
                    Opened at {new Date(session.openedAt).toLocaleString()}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <p className="text-sm text-green-700">Register</p>
                  <p className="text-lg font-bold text-green-900">{session.register?.name}</p>
                </div>
                <div>
                  <p className="text-sm text-green-700">Opening Cash</p>
                  <p className="text-lg font-bold text-green-900">
                    ${Number(session.openingCash).toFixed(2)}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-green-700">Status</p>
                  <span className={clsx('px-2.5 py-1 rounded-full text-xs font-medium', statusColors[session.register?.status])}>
                    {session.register?.status}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-6 mb-6">
              <div className="flex items-center gap-3">
                <AlertCircle size={24} className="text-gray-400" />
                <div>
                  <h2 className="text-lg font-bold text-gray-900">Register Closed</h2>
                  <p className="text-sm text-gray-500">Open a register to start processing orders</p>
                </div>
              </div>
            </div>
          )}

          {/* All Registers */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-bold">All Registers</h2>
            </div>
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Location</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Last Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {registers.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-12 text-center text-gray-400">
                      No registers configured
                    </td>
                  </tr>
                ) : (
                  registers.map((reg) => (
                    <tr key={reg.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 text-sm font-medium">{reg.name}</td>
                      <td className="px-6 py-4 text-sm text-gray-500">{reg.location?.name}</td>
                      <td className="px-6 py-4">
                        <span className={clsx('px-2.5 py-1 rounded-full text-xs font-medium', statusColors[reg.status])}>
                          {reg.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        {new Date(reg.updatedAt).toLocaleString()}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Open Register Modal */}
      {showOpenModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-2xl p-8 w-full max-w-md">
            <h2 className="text-xl font-bold mb-6">Open Register</h2>
            <form onSubmit={handleOpenRegister} className="space-y-4">
              {registers.length > 0 ? (
                <div>
                  <label className="block text-sm font-medium mb-1">Register</label>
                  <select
                    value={selectedRegisterId}
                    onChange={(e) => setSelectedRegisterId(e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-green-500 outline-none"
                  >
                    {registers.map((reg) => (
                      <option key={reg.id} value={reg.id}>
                        {reg.name}
                        {reg.location?.name ? ` — ${reg.location.name}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="text-sm text-gray-500">
                    No registers exist yet. Create one to start taking orders.
                  </p>
                  <div>
                    <label className="block text-sm font-medium mb-1">Register Name</label>
                    <input
                      type="text"
                      value={newRegisterName}
                      onChange={(e) => setNewRegisterName(e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-green-500 outline-none"
                      placeholder="e.g. Register 1"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Location</label>
                    <select
                      value={newRegisterLocationId}
                      onChange={(e) => setNewRegisterLocationId(e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-green-500 outline-none"
                    >
                      <option value="">Select a location…</option>
                      {locations.map((loc: any) => (
                        <option key={loc.id} value={loc.id}>{loc.name}</option>
                      ))}
                    </select>
                    {locations.length === 0 && (
                      <p className="text-xs text-amber-600 mt-1">
                        No locations found — add a location first (Settings → Locations).
                      </p>
                    )}
                  </div>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium mb-1">Opening Cash Amount</label>
                <div className="relative">
                  <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={openingCash}
                    onChange={(e) => setOpeningCash(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-green-500 outline-none"
                    placeholder="0.00"
                  />
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowOpenModal(false)}
                  className="flex-1 py-2.5 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={processing}
                  className="flex-1 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                >
                  {processing ? 'Opening...' : registers.length > 0 ? 'Open Register' : 'Create & Open'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Close Register Modal */}
      {showCloseModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-2xl p-8 w-full max-w-md">
            <h2 className="text-xl font-bold mb-6">Close Register</h2>
            <form onSubmit={handleCloseRegister} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Closing Cash Amount</label>
                <div className="relative">
                  <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={closingCash}
                    onChange={(e) => setClosingCash(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-red-500 outline-none"
                    placeholder="0.00"
                  />
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Expected: ${(Number(session?.openingCash) || 0).toFixed(2)} + cash sales
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Notes (optional)</label>
                <textarea
                  value={closeNotes}
                  onChange={(e) => setCloseNotes(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-red-500 outline-none"
                  rows={2}
                  placeholder="Any notes about this session..."
                />
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowCloseModal(false)}
                  className="flex-1 py-2.5 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={processing}
                  className="flex-1 py-2.5 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
                >
                  {processing ? 'Closing...' : 'Close Register'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
