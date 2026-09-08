import { useEffect, useRef, useState } from 'react';
import {
  Printer, Usb, Barcode, CheckCircle, XCircle, Save, Trash2, Power,
} from 'lucide-react';
import {
  hardware,
  attachBarcodeScanner,
  loadPrinterSettings,
  type PrinterSettings,
} from '../services/hardware';
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

export default function HardwarePage() {
  const [supported] = useState(() => hardware.isSupported);
  const [connected, setConnected] = useState(hardware.isConnected);
  const [settings, setSettings] = useState<PrinterSettings>(() => loadPrinterSettings());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [lastScan, setLastScan] = useState('');
  const [scanning, setScanning] = useState(false);
  const detachRef = useRef<(() => void) | null>(null);

  useEffect(() => () => detachRef.current?.(), []);

  function flash(text: string) {
    setMsg(text);
    window.setTimeout(() => setMsg(''), 4000);
  }

  async function handleConnect() {
    setBusy(true);
    try {
      const ok = await hardware.connect(settings.baudRate);
      setConnected(ok);
      flash(ok ? 'Printer paired and ready.' : 'Pairing cancelled or unsupported.');
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    setBusy(true);
    try {
      await hardware.disconnect();
      setConnected(false);
      flash('Printer disconnected.');
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
    if (scanning) {
      detachRef.current?.();
      detachRef.current = null;
      setScanning(false);
      flash('Scanner listener stopped.');
      return;
    }
    detachRef.current = attachBarcodeScanner((code) => {
      setLastScan(code);
      flash(`Scanned: ${code}`);
    });
    setScanning(true);
    flash('Scanner armed — focus the page and pull the trigger.');
  }

  const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500';

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Usb size={24} /> Register Hardware
        </h1>
        <p className="text-gray-500">
          Pair thermal receipt printers, cash drawers and barcode scanners. Uses the Web
          Serial API — Chrome/Edge on desktop. Unsupported browsers fall back to a console
          simulator so nothing breaks.
        </p>
      </div>

      {!supported && (
        <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
          <XCircle size={18} className="mt-0.5 shrink-0" />
          <span>
            Web Serial is not available in this browser. Print/drawer actions are simulated in
            the console. Use Chrome or Edge on desktop to connect real hardware.
          </span>
        </div>
      )}

      {msg && (
        <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
          <CheckCircle size={18} /> {msg}
        </div>
      )}

      {/* Connection */}
      <section className="bg-white rounded-lg shadow p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold flex items-center gap-2"><Printer size={18} /> Receipt Printer</h2>
          <span className={connected ? 'text-green-600 text-sm flex items-center gap-1' : 'text-gray-500 text-sm flex items-center gap-1'}>
            {connected ? <CheckCircle size={16} /> : <XCircle size={16} />}
            {connected ? 'Connected' : 'Not connected'}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {!connected ? (
            <button onClick={handleConnect} disabled={busy || !supported}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm">
              <Power size={16} /> Pair Printer
            </button>
          ) : (
            <button onClick={handleDisconnect} disabled={busy}
              className="flex items-center gap-2 px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50 text-sm">
              <Power size={16} /> Disconnect
            </button>
          )}
          <button onClick={handleTestPrint} disabled={busy}
            className="flex items-center gap-2 px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 disabled:opacity-50 text-sm">
            <Printer size={16} /> Test Print
          </button>
          <button onClick={handleOpenDrawer} disabled={busy}
            className="flex items-center gap-2 px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 disabled:opacity-50 text-sm">
            <Trash2 size={16} /> Open Cash Drawer
          </button>
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
            <span className="text-sm text-gray-600">Currency symbol</span>
            <input className={inputCls} value={settings.currencySymbol} maxLength={4}
              onChange={(e) => setSettings({ ...settings, currencySymbol: e.target.value })} />
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
          USB-HID scanners act as keyboards. Arm the listener, then scan — the fast keystroke
          burst is detected and separated from normal typing.
        </p>
        <div className="flex items-center gap-3">
          <button onClick={toggleScanner}
            className={scanning
              ? 'flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm'
              : 'flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm'}>
            <Barcode size={16} /> {scanning ? 'Stop Listening' : 'Arm Scanner'}
          </button>
          <span className="text-sm text-gray-600">
            Last scan: <span className="font-mono font-medium">{lastScan || '—'}</span>
          </span>
        </div>
      </section>
    </div>
  );
}
