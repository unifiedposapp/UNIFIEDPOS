import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Printer, Usb, Barcode, CheckCircle, XCircle, Save, Trash2, Power,
  Bluetooth, RefreshCw, Search, Cpu,
} from 'lucide-react';
import {
  hardware,
  attachBarcodeScanner,
  loadPrinterSettings,
  systemInfo,
  type PrinterSettings,
  type DiscoveredDevice,
  type DeviceKind,
  type HardwareCapabilities,
  type SystemInfo,
  type TransportKind,
} from '../services/hardware';
import { CURRENCIES, currencySymbol } from '../data/currencies';
import type { ReceiptData } from '../services/escpos';

// A representative sample used by the "Test print" button.
const SAMPLE_RECEIPT: ReceiptData = {
  storeName: 'Demo Store',
  addressLine: '123 Main Street',
  phone: '555-0100',
  orderNumber: 'TEST-0001',
  cashier: 'Cashier',
  register: 'Register 01',
  location: 'Main Store',
  items: [
    { name: 'Espresso', quantity: 2, unitPrice: 3.0, lineTotal: 6.0 },
    { name: 'Croissant', quantity: 1, unitPrice: 3.5, lineTotal: 3.5, notes: ['Large'] },
  ],
  subtotal: 9.5,
  tax: 0.81,
  total: 10.31,
  payments: [{ method: 'CASH', amount: 20.0, change: 9.69 }],
  footer: 'Test print — hardware is working!',
};

const KIND_LABELS: Record<DeviceKind, string> = {
  printer: 'Printer',
  scanner: 'Scanner',
  drawer: 'Cash drawer',
  display: 'Display',
  scale: 'Scale',
  unknown: 'Device',
};
const KIND_COLORS: Record<DeviceKind, string> = {
  printer: 'bg-blue-100 text-blue-800',
  scanner: 'bg-purple-100 text-purple-800',
  drawer: 'bg-amber-100 text-amber-800',
  display: 'bg-cyan-100 text-cyan-800',
  scale: 'bg-pink-100 text-pink-800',
  unknown: 'bg-gray-100 text-gray-700',
};
const TRANSPORT_LABELS: Record<TransportKind, string> = {
  serial: 'USB / Serial',
  usb: 'WebUSB',
  bluetooth: 'Bluetooth',
  simulator: 'Simulator',
};

export default function HardwarePage() {
  const [sys, setSys] = useState<SystemInfo | null>(null);
  const [caps, setCaps] = useState<HardwareCapabilities>({ serial: false, usb: false, bluetooth: false });
  const [supported, setSupported] = useState(false);
  const [devices, setDevices] = useState<DiscoveredDevice[]>([]);
  const [scanning, setScanning] = useState(false);
  const [connected, setConnected] = useState(hardware.isConnected);
  const [active, setActive] = useState<DiscoveredDevice | null>(hardware.activeDevice);
  const [settings, setSettings] = useState<PrinterSettings>(() => loadPrinterSettings());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [lastScan, setLastScan] = useState('');
  const [scannerArmed, setScannerArmed] = useState(false);
  const [currFilter, setCurrFilter] = useState('');
  const detachRef = useRef<(() => void) | null>(null);

  // Every ISO 4217 currency in the world, optionally narrowed by the filter
  // box (matches code, name or symbol). Nothing is ever omitted.
  const currencyOptions = useMemo(() => {
    const q = currFilter.trim().toLowerCase();
    if (!q) return CURRENCIES;
    return CURRENCIES.filter((c) =>
      c.code.toLowerCase().includes(q) ||
      c.name.toLowerCase().includes(q) ||
      (c.symbol || '').toLowerCase().includes(q));
  }, [currFilter]);

  const activeCode = settings.currencyCode || 'USD';

  useEffect(() => () => detachRef.current?.(), []);

  function flash(text: string) {
    setMsg(text);
    window.setTimeout(() => setMsg(''), 4000);
  }

  function syncState() {
    setConnected(hardware.isConnected);
    setActive(hardware.activeDevice);
  }

  /** Re-read the list of already-granted devices across every transport. */
  async function refresh(silent = false) {
    setScanning(true);
    try {
      const list = await hardware.enumerate();
      setDevices(list);
      syncState();
      if (!silent) flash(`Found ${list.length} paired device${list.length === 1 ? '' : 's'}.`);
    } finally {
      setScanning(false);
    }
  }

  // On load: detect the system, list granted devices, and silently reconnect to
  // the last-used (or first recognised printer) device — no gesture required.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const info = systemInfo();
      if (cancelled) return;
      setSys(info);
      setCaps(info.capabilities);
      setSupported(info.capabilities.serial || info.capabilities.usb || info.capabilities.bluetooth);
      await refresh(true);
      if (cancelled) return;
      const dev = await hardware.autoConnect();
      if (cancelled) return;
      syncState();
      if (dev) flash(`Auto-connected to ${dev.name} (${KIND_LABELS[dev.kind]}).`);
      else await refresh(true);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleAutoDetect() {
    setBusy(true);
    try {
      const dev = await hardware.autoConnect();
      syncState();
      await refresh(true);
      flash(dev
        ? `Connected to ${dev.name} (${KIND_LABELS[dev.kind]} · ${TRANSPORT_LABELS[dev.transport]}).`
        : 'No previously paired device found. Use a Pair button to add one.');
    } finally {
      setBusy(false);
    }
  }

  async function handlePair(transport?: TransportKind) {
    setBusy(true);
    try {
      const ok = await hardware.pair(transport, settings.baudRate);
      syncState();
      await refresh(true);
      flash(ok
        ? `Paired ${hardware.activeDevice?.name ?? 'device'}.`
        : 'Pairing cancelled, unsupported, or no device selected.');
    } finally {
      setBusy(false);
    }
  }

  async function handleConnectDevice(device: DiscoveredDevice) {
    setBusy(true);
    try {
      const ok = await hardware.connectToDevice(device, settings.baudRate);
      syncState();
      flash(ok ? `Connected to ${device.name}.` : `Could not connect to ${device.name}.`);
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    setBusy(true);
    try {
      await hardware.disconnect();
      syncState();
      flash('Device disconnected.');
    } finally {
      setBusy(false);
    }
  }

  function handleSaveSettings() {
    hardware.updateSettings(settings);
    flash('Hardware settings saved.');
  }

  async function handleTestPrint() {
    setBusy(true);
    try {
      hardware.updateSettings(settings);
      await hardware.printReceipt(SAMPLE_RECEIPT);
      flash(connected ? 'Test receipt sent to printer.' : 'No printer — sample logged to console.');
    } catch (err: any) {
      flash(err?.message || 'Test print failed.');
    } finally {
      setBusy(false);
    }
  }

  async function handleOpenDrawer() {
    setBusy(true);
    try {
      await hardware.openCashDrawer(settings.drawerPin);
      flash(connected ? 'Drawer kick sent.' : 'No printer — drawer kick logged to console.');
    } finally {
      setBusy(false);
    }
  }

  function toggleScanner() {
    if (scannerArmed) {
      detachRef.current?.();
      detachRef.current = null;
      setScannerArmed(false);
      flash('Scanner listener stopped.');
      return;
    }
    detachRef.current = attachBarcodeScanner((code) => {
      setLastScan(code);
      flash(`Scanned: ${code}`);
    });
    setScannerArmed(true);
    flash('Scanner armed — focus the page and pull the trigger.');
  }

  const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500';
  const pairBtn = 'flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm';
  const ghostBtn = 'flex items-center gap-2 px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 disabled:opacity-50 text-sm';

  function CapChip({ label, on }: { label: string; on: boolean }) {
    return (
      <span className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full border ${on ? 'bg-green-50 border-green-200 text-green-700' : 'bg-gray-50 border-gray-200 text-gray-400'}`}>
        {on ? <CheckCircle size={12} /> : <XCircle size={12} />} {label}
      </span>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Usb size={24} /> Register Hardware
        </h1>
        <p className="text-gray-500">
          Automatically detects the system and any paired peripherals over USB/Serial, WebUSB and
          Bluetooth — printers, cash drawers, barcode scanners and displays. Previously granted
          devices reconnect on their own; unsupported browsers fall back to a console simulator.
        </p>
      </div>

      {/* System + capability detection */}
      <section className="bg-white rounded-lg shadow p-5 space-y-3">
        <h2 className="font-semibold flex items-center gap-2"><Cpu size={18} /> Detected System</h2>
        <div className="text-sm text-gray-700">
          {sys
            ? <span><span className="font-medium">{sys.os}</span> · {sys.browser} · {sys.secureContext ? 'secure context ✓' : 'insecure context (device APIs need HTTPS/localhost)'}</span>
            : <span className="text-gray-400">Detecting…</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          <CapChip label="Web Serial (USB/Serial)" on={caps.serial} />
          <CapChip label="WebUSB" on={caps.usb} />
          <CapChip label="Web Bluetooth" on={caps.bluetooth} />
        </div>
        {!supported && (
          <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
            <XCircle size={18} className="mt-0.5 shrink-0" />
            <span>
              No device transport is available in this browser. Print/drawer actions are simulated
              in the console. Use Chrome or Edge on desktop (over HTTPS or localhost) to pair real hardware.
            </span>
          </div>
        )}
      </section>

      {msg && (
        <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
          <CheckCircle size={18} /> {msg}
        </div>
      )}

      {/* Connection */}
      <section className="bg-white rounded-lg shadow p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold flex items-center gap-2"><Printer size={18} /> Active Device</h2>
          <span className={connected ? 'text-green-600 text-sm flex items-center gap-1' : 'text-gray-500 text-sm flex items-center gap-1'}>
            {connected ? <CheckCircle size={16} /> : <XCircle size={16} />}
            {connected ? (active ? `${active.name} · ${KIND_LABELS[active.kind]}` : 'Connected') : 'Not connected'}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={handleAutoDetect} disabled={busy || !supported} className={pairBtn}>
            <Search size={16} /> Auto-detect &amp; Connect
          </button>
          <button onClick={() => handlePair('serial')} disabled={busy || !caps.serial} className={ghostBtn}>
            <Usb size={16} /> Pair USB/Serial
          </button>
          <button onClick={() => handlePair('usb')} disabled={busy || !caps.usb} className={ghostBtn}>
            <Usb size={16} /> Pair WebUSB
          </button>
          <button onClick={() => handlePair('bluetooth')} disabled={busy || !caps.bluetooth} className={ghostBtn}>
            <Bluetooth size={16} /> Pair Bluetooth
          </button>
          {connected && (
            <button onClick={handleDisconnect} disabled={busy} className={ghostBtn}>
              <Power size={16} /> Disconnect
            </button>
          )}
          <button onClick={handleTestPrint} disabled={busy} className={ghostBtn}>
            <Printer size={16} /> Test Print
          </button>
          <button onClick={handleOpenDrawer} disabled={busy} className={ghostBtn}>
            <Trash2 size={16} /> Open Cash Drawer
          </button>
        </div>
      </section>

      {/* Discovered / already-paired devices */}
      <section className="bg-white rounded-lg shadow p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold flex items-center gap-2"><Usb size={18} /> Paired Devices ({devices.length})</h2>
          <button onClick={() => refresh()} disabled={scanning || busy} className={ghostBtn}>
            <RefreshCw size={16} className={scanning ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
        <p className="text-sm text-gray-500">
          Every device this browser has already been granted, across Serial, USB and Bluetooth.
          Select one to reconnect — no picker needed for devices you have paired before.
        </p>
        <div className="border rounded-lg divide-y">
          {devices.length === 0 ? (
            <p className="text-sm text-gray-400 px-4 py-6 text-center">
              No paired devices yet. Use a Pair button above to add one.
            </p>
          ) : (
            devices.map((d) => {
              const isActive = connected && active?.id === d.id;
              return (
                <div key={d.id} className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className={`text-xs px-2 py-1 rounded ${KIND_COLORS[d.kind]}`}>{KIND_LABELS[d.kind]}</span>
                    <div>
                      <div className="text-sm font-medium">{d.name}</div>
                      <div className="text-xs text-gray-500">
                        {TRANSPORT_LABELS[d.transport]}
                        {d.vendorId !== undefined ? ` · ${d.vendorId.toString(16)}:${(d.productId ?? 0).toString(16)}` : ''}
                        {' · '}{d.connected ? 'reachable' : 'not currently connected'}
                      </div>
                    </div>
                  </div>
                  {isActive ? (
                    <span className="text-xs text-green-600 flex items-center gap-1"><CheckCircle size={14} /> In use</span>
                  ) : (
                    <button onClick={() => handleConnectDevice(d)} disabled={busy}
                      className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-xs">
                      <Power size={14} /> Connect
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
      </section>

      {/* Settings */}
      <section className="bg-white rounded-lg shadow p-5 space-y-4">
        <h2 className="font-semibold">Printer Settings</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="block">
            <span className="text-sm text-gray-600">Baud rate</span>
            <select className={inputCls} value={settings.baudRate}
              onChange={(e) => setSettings({ ...settings, baudRate: Number(e.target.value) })}>
              {[4800, 9600, 19200, 38400, 57600, 115200].map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-sm text-gray-600">Paper width (chars)</span>
            <select className={inputCls} value={settings.width}
              onChange={(e) => setSettings({ ...settings, width: Number(e.target.value) as PrinterSettings['width'] })}>
              <option value={32}>32 — 58mm</option>
              <option value={42}>42 — 80mm</option>
              <option value={48}>48 — 80mm (font B)</option>
            </select>
          </label>
          <label className="block">
            <span className="text-sm text-gray-600">Receipt currency</span>
            <input className={inputCls} placeholder="Search code, name or symbol…" value={currFilter}
              onChange={(e) => setCurrFilter(e.target.value)} />
            <select className={`${inputCls} mt-2`} value={activeCode}
              onChange={(e) => {
                const code = e.target.value;
                setSettings({ ...settings, currencyCode: code, currencySymbol: currencySymbol(code) });
              }}>
              {!currencyOptions.some((c) => c.code === activeCode) && (
                <option value={activeCode}>{activeCode} — {currencySymbol(activeCode)}</option>
              )}
              {currencyOptions.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.symbol || c.code}  ·  {c.code} — {c.name}
                </option>
              ))}
            </select>
            <span className="text-xs text-gray-500 mt-1 block">
              {currencyOptions.length} currencies listed · Receipt preview:{' '}
              <span className="font-mono font-medium text-gray-700">{currencySymbol(activeCode)}1,234.50</span>
            </span>
          </label>
          <label className="block">
            <span className="text-sm text-gray-600">Cash drawer pin</span>
            <select className={inputCls} value={settings.drawerPin}
              onChange={(e) => setSettings({ ...settings, drawerPin: Number(e.target.value) as 0 | 1 })}>
              <option value={0}>Drawer 1 (pin 2)</option>
              <option value={1}>Drawer 2 (pin 5)</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={settings.autoOpenDrawer}
              onChange={(e) => setSettings({ ...settings, autoOpenDrawer: e.target.checked })} />
            Auto-open drawer on cash sales
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={settings.autoPrint}
              onChange={(e) => setSettings({ ...settings, autoPrint: e.target.checked })} />
            Auto-print receipt after checkout
          </label>
        </div>
        <button onClick={handleSaveSettings}
          className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm">
          <Save size={16} /> Save Settings
        </button>
      </section>

      {/* Barcode scanner */}
      <section className="bg-white rounded-lg shadow p-5 space-y-4">
        <h2 className="font-semibold flex items-center gap-2"><Barcode size={18} /> Barcode Scanner</h2>
        <p className="text-sm text-gray-500">
          USB-HID and Bluetooth scanners act as keyboards. Arm the listener, then scan — the fast
          keystroke burst is detected and separated from normal typing.
        </p>
        <div className="flex items-center gap-3">
          <button onClick={toggleScanner}
            className={scannerArmed
              ? 'flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm'
              : 'flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm'}>
            <Barcode size={16} /> {scannerArmed ? 'Stop Listening' : 'Arm Scanner'}
          </button>
          <span className="text-sm text-gray-600">
            Last scan: <span className="font-mono font-medium">{lastScan || '—'}</span>
          </span>
        </div>
      </section>
    </div>
  );
}
