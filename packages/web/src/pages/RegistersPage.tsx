import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuthStore } from '../stores/authStore';
import {
  DollarSign, Lock, Unlock, AlertCircle, CheckCircle, KeyRound, ShieldAlert,
  Tablet, Users,
} from 'lucide-react';
import clsx from 'clsx';

// Roles allowed to see (and clear) other people's drawers — mirrors SUPERVISOR_ROLES
// on the server, which is what actually enforces it.
const SUPERVISOR_ROLES = ['OWNER', 'ADMIN', 'MANAGER'];

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
  // Individual cashier PIN (§37): this cashier's own code, plus the org's idle
  // auto-lock policy, plus (for supervisors) every open drawer on the floor.
  const [pinStatus, setPinStatus] = useState<any>(null);
  const [pinForm, setPinForm] = useState({ current: '', next: '', confirm: '' });
  const [pinSaving, setPinSaving] = useState(false);
  const [pinMessage, setPinMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const [idleLockMinutes, setIdleLockMinutes] = useState(5);
  const [unlockPin, setUnlockPin] = useState('');
  const [activeSessions, setActiveSessions] = useState<any[]>([]);
  const { employee: _employee, user } = useAuthStore();
  const isSupervisor = SUPERVISOR_ROLES.includes(String(user?.role));

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [registersRes, sessionRes, locationsRes, pinRes, policyRes] = await Promise.all([
        api.getRegisters(),
        api.getRegisterSession(),
        api.getLocations(),
        api.getRegisterPinStatus().catch(() => null),
        api.getRegisterPolicy().catch(() => null),
      ]);
      const regs = registersRes.data?.items || registersRes.data || [];
      setRegisters(regs);
      setSession(sessionRes.data);
      setLocations(locationsRes.data?.items || locationsRes.data || []);
      if (pinRes?.data) setPinStatus(pinRes.data);
      if (policyRes?.data?.idleLockMinutes != null) setIdleLockMinutes(policyRes.data.idleLockMinutes);
      // Default the open-modal selection to the first available register.
      setSelectedRegisterId((prev) => prev || regs[0]?.id || '');
      if (isSupervisor) {
        const active = await api.getActiveRegisterSessions().catch(() => null);
        setActiveSessions(active?.data || []);
      }
    } catch (err) {
      console.error('Failed to load registers:', err);
    } finally {
      setLoading(false);
    }
  }

  /** Set a first PIN, or rotate an existing one (which requires the current). */
  async function handleSavePin(e: React.FormEvent) {
    e.preventDefault();
    setPinMessage(null);
    if (pinForm.next !== pinForm.confirm) {
      setPinMessage({ kind: 'error', text: 'The two PINs do not match' });
      return;
    }
    setPinSaving(true);
    try {
      await api.setRegisterPin(pinForm.next, pinStatus?.pinConfigured ? pinForm.current : undefined);
      setPinForm({ current: '', next: '', confirm: '' });
      setPinMessage({ kind: 'success', text: 'PIN saved. Only you can unlock your drawer now.' });
      const pinRes = await api.getRegisterPinStatus().catch(() => null);
      if (pinRes?.data) setPinStatus(pinRes.data);
      await loadData();
    } catch (err: any) {
      setPinMessage({ kind: 'error', text: err?.message || 'Could not save PIN' });
    } finally {
      setPinSaving(false);
    }
  }

  /** Lock the drawer, or bring it back with the same individual PIN. */
  async function handleLockToggle() {
    setPinMessage(null);
    try {
      if (session?.locked) {
        await api.unlockRegister(unlockPin);
        setUnlockPin('');
      } else {
        await api.lockRegister('MANUAL');
      }
      await loadData();
    } catch (err: any) {
      setPinMessage({ kind: 'error', text: err?.message || 'Could not change lock state' });
      setUnlockPin('');
    }
  }

  /** Supervisors set how long an unattended drawer may sit before it locks. */
  async function handlePolicyChange(minutes: number) {
    const previous = idleLockMinutes;
    setIdleLockMinutes(minutes);
    try {
      await api.updateRegisterPolicy(minutes);
    } catch (err: any) {
      setIdleLockMinutes(previous);
      setPinMessage({ kind: 'error', text: err?.message || 'Could not update the auto-lock policy' });
    }
  }

  /** Supervisor escape hatch for a drawer whose cashier is absent or stuck. */
  async function handleSupervisorAction(action: 'unlock' | 'close' | 'resetPin', row: any) {
    const label = row.registerName || 'this register';
    if (!window.confirm(`Force ${action === 'unlock' ? 'unlock' : action === 'close' ? 'close' : 'PIN reset on'} ${label} (${row.cashier})?`)) return;
    try {
      if (action === 'unlock') await api.forceUnlockRegisterSession(row.sessionId);
      else if (action === 'close') await api.forceCloseRegisterSession(row.sessionId, { notes: 'Closed by supervisor from register management' });
      else await api.resetRegisterPin(row.employeeId);
      await loadData();
    } catch (err: any) {
      alert(err?.message || 'Supervisor action failed');
    }
  }

  async function handleOpenRegister(e: React.FormEvent) {
    e.preventDefault();
    if (session?.id) return;
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
      // 423 = the drawer is still locked behind the cashier's own PIN: opening
      // the lock screen path is the fix, not a retry.
      if (err?.status === 423) {
        setPinMessage({ kind: 'error', text: 'Unlock this register with your PIN before closing it.' });
        await loadData();
      } else {
        alert(err.message || 'Failed to close register');
      }
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
        {!session?.id ? (
          <button
            onClick={() => {
              setSelectedRegisterId(registers.find((r) => !r.occupied)?.id || registers[0]?.id || '');
              setShowOpenModal(true);
            }}
            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm font-medium flex items-center gap-2"
          >
            <Unlock size={16} /> Open Register
          </button>
        ) : (
          <div className="flex items-center gap-3">
            {/* Lock is the handover control: the drawer stays open, the screen does
                not stay usable. Closing is end-of-shift; this is stepping away. */}
            <button
              onClick={handleLockToggle}
              disabled={!pinStatus?.pinConfigured}
              title={pinStatus?.pinConfigured
                ? 'Locks this drawer behind your personal PIN'
                : 'Set your personal PIN first'}
              className={clsx(
                'px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed',
                session.locked ? 'bg-green-600 text-white hover:bg-green-700' : 'bg-blue-600 text-white hover:bg-blue-700',
              )}
            >
              {session.locked ? <><Unlock size={16} /> Unlock with PIN</> : <><Lock size={16} /> Lock Register</>}
            </button>
            <button
              onClick={() => setShowCloseModal(true)}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm font-medium flex items-center gap-2"
            >
              <Lock size={16} /> Close Register
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64 text-gray-400">Loading...</div>
      ) : (
        <>
          {pinMessage && (
            <div
              className={clsx(
                'mb-6 rounded-xl border px-4 py-3 text-sm flex items-center gap-2',
                pinMessage.kind === 'error'
                  ? 'border-red-200 bg-red-50 text-red-700'
                  : 'border-green-200 bg-green-50 text-green-700',
              )}
            >
              {pinMessage.kind === 'error' ? <AlertCircle size={16} /> : <CheckCircle size={16} />}
              {pinMessage.text}
            </div>
          )}

          {/* Current Session Status */}
          {session?.id ? (
            <div
              className={clsx(
                'border rounded-xl p-6 mb-6',
                session.locked ? 'bg-blue-50 border-blue-200' : 'bg-green-50 border-green-200',
              )}
            >
              <div className="flex items-center gap-3 mb-4">
                {session.locked
                  ? <Lock size={24} className="text-blue-600" />
                  : <CheckCircle size={24} className="text-green-600" />}
                <div>
                  <h2 className={clsx('text-lg font-bold', session.locked ? 'text-blue-900' : 'text-green-900')}>
                    {session.locked ? 'Register locked' : 'Register Open'}
                  </h2>
                  <p className={clsx('text-sm', session.locked ? 'text-blue-700' : 'text-green-700')}>
                    Opened at {new Date(session.openedAt).toLocaleString()}
                    {session.locked && session.lockedAt
                      ? ` · locked ${session.lockReason === 'IDLE' ? 'automatically (idle)' : 'manually'} at ${new Date(session.lockedAt).toLocaleTimeString()}`
                      : ''}
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

              {/* Unlocking here is the same individual code as the POS lock screen;
                  the server matches it against this cashier's hash either way. */}
              {session.locked && (
                <div className="mt-4 flex items-center gap-2">
                  <input
                    type="password"
                    inputMode="numeric"
                    autoComplete="off"
                    value={unlockPin}
                    onChange={(e) => setUnlockPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
                    placeholder="Your PIN"
                    className="w-40 px-3 py-2 border border-blue-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none tracking-widest"
                  />
                  <button
                    onClick={handleLockToggle}
                    disabled={unlockPin.length < 4}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium disabled:opacity-40"
                  >
                    Unlock
                  </button>
                  <span className="text-sm text-blue-700">Sales are blocked until you unlock.</span>
                </div>
              )}
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

          {/* My register PIN — the individual code that makes a drawer private to
              the person standing at it. Hashed server-side; never read back. */}
          <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
            <div className="flex items-center gap-3 mb-1">
              <KeyRound size={18} className="text-gray-500" />
              <h2 className="text-lg font-bold">My Register PIN</h2>
              <span
                className={clsx(
                  'px-2 py-0.5 rounded-full text-xs font-medium',
                  pinStatus?.pinConfigured ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700',
                )}
              >
                {pinStatus?.pinConfigured ? 'PIN set' : 'No PIN yet'}
              </span>
            </div>
            <p className="text-sm text-gray-500 mb-4">
              4–8 digits, yours alone. Locking steps you out of the register and blocks
              sales until you enter it again — a colleague at this till cannot get into
              your drawer. Unattended registers lock themselves after{' '}
              <span className="font-medium text-gray-700">{idleLockMinutes} minute{idleLockMinutes === 1 ? '' : 's'}</span>
              {idleLockMinutes === 0 ? ' (auto-lock off)' : ''}.
            </p>

            {pinStatus?.lock?.locked && (
              <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 flex items-center gap-2">
                <ShieldAlert size={16} />
                PIN temporarily frozen after too many incorrect attempts. Try again in{' '}
                {Math.ceil(pinStatus.lock.retryAfterSeconds / 60)} minute(s).
              </p>
            )}

            <form onSubmit={handleSavePin} className="grid gap-4 sm:grid-cols-4">
              {pinStatus?.pinConfigured && (
                <div>
                  <label className="block text-sm font-medium mb-1">Current PIN</label>
                  <input
                    type="password"
                    inputMode="numeric"
                    autoComplete="off"
                    required
                    value={pinForm.current}
                    onChange={(e) => setPinForm({ ...pinForm, current: e.target.value.replace(/\D/g, '').slice(0, 8) })}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none tracking-widest"
                  />
                </div>
              )}
              <div>
                <label className="block text-sm font-medium mb-1">New PIN</label>
                <input
                  type="password"
                  inputMode="numeric"
                  autoComplete="new-password"
                  required
                  minLength={4}
                  maxLength={8}
                  value={pinForm.next}
                  onChange={(e) => setPinForm({ ...pinForm, next: e.target.value.replace(/\D/g, '').slice(0, 8) })}
                  placeholder="e.g. 4–8 digits"
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none tracking-widest"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Confirm PIN</label>
                <input
                  type="password"
                  inputMode="numeric"
                  autoComplete="new-password"
                  required
                  minLength={4}
                  maxLength={8}
                  value={pinForm.confirm}
                  onChange={(e) => setPinForm({ ...pinForm, confirm: e.target.value.replace(/\D/g, '').slice(0, 8) })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none tracking-widest"
                />
              </div>
              <div className="flex items-end">
                <button
                  type="submit"
                  disabled={pinSaving || pinForm.next.length < 4}
                  className="w-full sm:w-auto px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium disabled:opacity-50"
                >
                  {pinSaving ? 'Saving...' : pinStatus?.pinConfigured ? 'Change PIN' : 'Set PIN'}
                </button>
              </div>
            </form>
            <p className="text-xs text-gray-400 mt-2">
              Repeating (1111) and straight-run (1234) codes are rejected. Forgot it? A
              manager can clear it, then you choose a new one here.
            </p>

            {/* Org-wide auto-lock window, supervisor-editable. */}
            {isSupervisor && (
              <div className="mt-4 pt-4 border-t border-gray-100 flex flex-wrap items-center gap-3">
                <label className="text-sm font-medium text-gray-700" htmlFor="idle-lock">
                  Auto-lock unattended registers after
                </label>
                <select
                  id="idle-lock"
                  value={idleLockMinutes}
                  onChange={(e) => handlePolicyChange(Number(e.target.value))}
                  className="px-3 py-1.5 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  {[0, 1, 2, 3, 5, 10, 15, 30, 60].map((m) => (
                    <option key={m} value={m}>{m === 0 ? 'Never (disabled)' : `${m} min`}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* All Registers */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-bold">All Registers</h2>
            </div>
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-start text-xs font-medium text-gray-500 uppercase">Name</th>
                  <th className="px-6 py-3 text-start text-xs font-medium text-gray-500 uppercase">Location</th>
                  <th className="px-6 py-3 text-start text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-6 py-3 text-start text-xs font-medium text-gray-500 uppercase">Drawer</th>
                  <th className="px-6 py-3 text-start text-xs font-medium text-gray-500 uppercase">Last Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {registers.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center text-gray-400">
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
                      <td className="px-6 py-4 text-sm">
                        {/* Who holds this drawer. Cashiers are told a register is taken
                            but never whose — identities stay supervisor-only. */}
                        {!reg.openSession ? (
                          <span className="text-gray-500">Free</span>
                        ) : reg.openSession.mine ? (
                          <span className="inline-flex items-center gap-1.5 text-blue-700">
                            <Tablet size={14} /> Yours
                            {reg.openSession.locked ? ' (locked)' : ''}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-amber-700">
                            <Lock size={14} />
                            {reg.openSession.cashier ? `${reg.openSession.cashier}'s` : 'In use'}
                            {reg.openSession.locked ? ' · locked' : ''}
                          </span>
                        )}
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

          {/* Supervisor console: every open drawer on the floor, and the three
              escape hatches a locked-away cashier legitimately needs. */}
          {isSupervisor && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mt-6">
              <div className="px-6 py-4 border-b border-gray-200 flex items-center gap-2">
                <Users size={18} className="text-gray-500" />
                <h2 className="text-lg font-bold">Open Drawers</h2>
                <span className="text-sm text-gray-500">({activeSessions.length})</span>
              </div>
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-3 text-start text-xs font-medium text-gray-500 uppercase">Register</th>
                    <th className="px-6 py-3 text-start text-xs font-medium text-gray-500 uppercase">Cashier</th>
                    <th className="px-6 py-3 text-start text-xs font-medium text-gray-500 uppercase">Opened</th>
                    <th className="px-6 py-3 text-start text-xs font-medium text-gray-500 uppercase">Lock</th>
                    <th className="px-6 py-3 text-end text-xs font-medium text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {activeSessions.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-6 py-12 text-center text-gray-400">
                        No registers are open
                      </td>
                    </tr>
                  ) : (
                    activeSessions.map((row) => (
                      <tr key={row.sessionId} className="hover:bg-gray-50">
                        <td className="px-6 py-4 text-sm font-medium">
                          {row.registerName}
                          {row.locationName && <span className="block text-xs text-gray-500">{row.locationName}</span>}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-700">
                          {row.cashier}
                          <span className="block text-xs text-gray-500">
                            {row.pinConfigured ? 'PIN configured' : 'No PIN set'}
                            {row.lockedCount ? ` · locked ${row.lockedCount}×` : ''}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-500">{new Date(row.openedAt).toLocaleString()}</td>
                        <td className="px-6 py-4 text-sm">
                          {row.locked ? (
                            <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                              {row.lockReason === 'IDLE' ? 'Locked (idle)' : 'Locked'}
                            </span>
                          ) : (
                            <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600">Active</span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-sm text-end whitespace-nowrap">
                          {row.locked && (
                            <button
                              onClick={() => handleSupervisorAction('unlock', row)}
                              className="text-blue-600 hover:underline mr-3"
                            >
                              Force unlock
                            </button>
                          )}
                          {row.pinConfigured && (
                            <button
                              onClick={() => handleSupervisorAction('resetPin', row)}
                              className="text-amber-600 hover:underline mr-3"
                              title="Clear this cashier's PIN so they can choose a new one (also releases a stuck lock)"
                            >
                              Clear PIN
                            </button>
                          )}
                          <button
                            onClick={() => handleSupervisorAction('close', row)}
                            className="text-red-600 hover:underline"
                          >
                            Force close
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              <p className="px-6 py-3 text-xs text-gray-400 border-t border-gray-200">
                Every action here is written to the audit trail. Force unlock is for an
                absent or forgotten PIN, not for opening a colleague's drawer.
              </p>
            </div>
          )}
        </>
      )}

      {/* Open Register Modal */}
      {showOpenModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-2xl p-8 w-full max-w-md">
            <h2 className="text-xl font-bold mb-6">Open Register</h2>
            {/* The server refuses to hand a drawer to a cashier who cannot lock it
                again, so say so before they hit submit. */}
            {!isSupervisor && !pinStatus?.pinConfigured && (
              <p className="mb-4 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">
                Set your personal register PIN first (My Register PIN, above) — a drawer
                you cannot lock cannot be opened.
              </p>
            )}
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
                      <option key={reg.id} value={reg.id} disabled={reg.occupied}>
                        {reg.name}
                        {reg.location?.name ? ` — ${reg.location.name}` : ''}
                        {reg.occupied ? ' · in use by another cashier' : ''}
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
            {session?.locked && (
              <p className="mb-4 rounded-lg bg-blue-50 border border-blue-200 px-3 py-2 text-sm text-blue-800">
                This drawer is locked. Enter your PIN to unlock it before closing — a
                locked register cannot be reconciled.
              </p>
            )}
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
