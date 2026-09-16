// ─── POS hardware layer (browser transports) ────────────────────────────────
// Bridges the physical peripherals a real register needs to the web app across
// every transport a browser exposes:
//   • Web Serial  — the classic ESC/POS USB/serial thermal printer path.
//   • WebUSB      — USB printers/scanners that expose a bulk OUT endpoint.
//   • Web Bluetooth — BLE printers (Nordic-UART / HM-10 style GATT services).
//
// The layer AUTO-DETECTS what the system supports, ENUMERATES every device the
// user has already granted (so nothing previously paired goes "missing"), and
// CLASSIFIES each one (printer / scanner / drawer / display / scale) from its
// reported name and USB vendor/product IDs. Already-granted devices reconnect
// silently on load — no picker, no gesture — while first-time pairing still
// requires the browser's user-gesture chooser.
//
// The money-critical byte formatting lives in ./escpos.ts (pure + unit-tested);
// this file only moves bytes to a device. Every browser API is feature-detected
// and cast locally so the app compiles without w3c-web-serial/webusb/web-bluetooth
// types and degrades gracefully (nothing throws at import time, even in Node).

import {
  buildReceipt,
  cashDrawerBytes,
  concatBytes,
  type ReceiptData,
} from './escpos';

export type TransportKind = 'serial' | 'usb' | 'bluetooth' | 'simulator';
export type DeviceKind = 'printer' | 'scanner' | 'drawer' | 'display' | 'scale' | 'unknown';

// ─── Local minimal shapes for the browser device APIs ───────────────────────
interface WritableLike {
  write(value: Uint8Array): Promise<void>;
  releaseLock(): void;
}
interface WritableStreamLike {
  getWriter(): WritableLike;
}
interface SerialPortLike {
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readonly writable: WritableStreamLike | null;
  getInfo(): { usbVendorId?: number; usbProductId?: number };
}
interface SerialLike {
  requestPort(options?: Record<string, unknown>): Promise<SerialPortLike>;
  getPorts(): SerialPortLike[];
}

interface USBEndpointLike {
  endpointNumber: number;
  direction: string;
  /** 2 = bulk. Optional because some shims omit it. */
  type?: number;
}
interface USBAlternateLike {
  interfaceClass: number;
  endpoints: USBEndpointLike[];
}
interface USBInterfaceLike {
  interfaceNumber: number;
  alternate: USBAlternateLike;
}
interface USBDeviceLike {
  readonly vendorId: number;
  readonly productId: number;
  readonly productName?: string;
  readonly serialNumber?: string;
  readonly opened: boolean;
  open(): Promise<void>;
  close(): Promise<void>;
  selectConfiguration(value: number): Promise<void>;
  claimInterface(interfaceNumber: number): Promise<void>;
  releaseInterface(interfaceNumber: number): Promise<void>;
  transferOut(endpointNumber: number, data: Uint8Array): Promise<{ status: string }>;
  readonly configuration?: { interfaces: USBInterfaceLike[] } | null;
}
interface USBLike {
  requestDevice(options: { filters: unknown[] }): Promise<USBDeviceLike>;
  getDevices(): Promise<USBDeviceLike[]>;
}

interface BTCharacteristicLike {
  readonly uuid: string;
  readonly properties: { write?: boolean; writeWithoutResponse?: boolean };
  writeValue(value: Uint8Array): Promise<void>;
  writeValueWithoutResponse?(value: Uint8Array): Promise<void>;
}
interface BTServiceLike {
  readonly uuid: string;
  getCharacteristics(): Promise<BTCharacteristicLike[]>;
}
interface BTServerLike {
  readonly connected: boolean;
  connect(): Promise<BTServerLike>;
  disconnect(): void;
  getPrimaryServices(): Promise<BTServiceLike[]>;
}
interface BTDeviceLike {
  readonly id: string;
  readonly name?: string;
  readonly gatt?: BTServerLike;
}
interface BluetoothLike {
  requestDevice(options: Record<string, unknown>): Promise<BTDeviceLike>;
  getDevices?(): Promise<BTDeviceLike[]>;
}

// Each accessor is null-safe even where `navigator` does not exist (Node/tests).
function getSerial(): SerialLike | null {
  if (typeof navigator === 'undefined') return null;
  const nav = navigator as unknown as { serial?: SerialLike };
  return nav.serial ?? null;
}
function getUsb(): USBLike | null {
  if (typeof navigator === 'undefined') return null;
  const nav = navigator as unknown as { usb?: USBLike };
  return nav.usb ?? null;
}
function getBluetooth(): BluetoothLike | null {
  if (typeof navigator === 'undefined') return null;
  const nav = navigator as unknown as { bluetooth?: BluetoothLike };
  return nav.bluetooth ?? null;
}

// ─── Device classification (pure — unit-tested, no DOM) ──────────────────────
/** USB vendor IDs commonly seen on ESC/POS thermal printers. */
export const PRINTER_VENDOR_IDS: number[] = [
  0x04b8, // Epson
  0x0456, // Star Micronics
  0x0a5f, // Zebra
  0x04f9, // Brother
  0x03f0, // HP
  0x1fc9, // NXP — many generic 58/80mm printers
  0x0483, // STMicroelectronics — generic POS boards
  0x0416, // Winbond — generic POS-58/POS-80
];
/** USB-UART bridge chips; a serial device behind one is almost always a printer. */
export const UART_BRIDGE_VENDOR_IDS: number[] = [
  0x1a86, // CH340
  0x067b, // Prolific PL2303
  0x10c4, // Silicon Labs CP210x
  0x0403, // FTDI
];

export interface DeviceIdentity {
  name?: string | null;
  vendorId?: number;
  productId?: number;
  transport?: TransportKind;
}

// Ordered most-specific → least-specific; the first matching keyword wins.
const NAME_RULES: Array<{ kind: DeviceKind; test: RegExp }> = [
  { kind: 'scanner', test: /scan|barcode|bar-?code|symbol|honeywell|datalogic|cipherlab|scanner/i },
  { kind: 'scale', test: /\bscale\b|weigh|weighing|\bbalance\b/i },
  { kind: 'drawer', test: /drawer|cash-?box|\bkick\b/i },
  { kind: 'display', test: /display|\bvfd\b|pole|customer-?facing|\blcd\b|\bled\b/i },
  { kind: 'printer', test: /print|epson|star ?micro|micronics|zebra|brother|tm-?t|tm-?u|tsp|pos-?\d{2}|receipt|thermal|esc\/?pos/i },
];

/**
 * Infer what kind of peripheral a device is from its reported name and USB IDs.
 * Pure (no DOM), so it is unit-testable. Name keywords win first; then known
 * printer/UART vendor IDs; then, because ESC/POS printers overwhelmingly
 * dominate *serial* POS peripherals, an unclassified serial device is treated as
 * a printer. Anything else is `unknown`.
 */
export function classifyDevice(identity: DeviceIdentity): DeviceKind {
  const name = (identity.name ?? '').trim();
  if (name) {
    for (const rule of NAME_RULES) if (rule.test.test(name)) return rule.kind;
  }
  const vid = identity.vendorId;
  if (vid !== undefined) {
    if (PRINTER_VENDOR_IDS.includes(vid)) return 'printer';
    if (UART_BRIDGE_VENDOR_IDS.includes(vid)) return 'printer';
  }
  if (identity.transport === 'serial') return 'printer';
  return 'unknown';
}

// ─── System / capability detection ───────────────────────────────────────────
export interface HardwareCapabilities {
  serial: boolean;
  usb: boolean;
  bluetooth: boolean;
}
export interface SystemInfo {
  os: string;
  browser: string;
  secureContext: boolean;
  capabilities: HardwareCapabilities;
}

/** Which device transports this browser exposes. */
export function detectCapabilities(): HardwareCapabilities {
  return {
    serial: getSerial() !== null,
    usb: getUsb() !== null,
    bluetooth: getBluetooth() !== null,
  };
}

/** Best-effort description of the host system + available device transports. */
export function systemInfo(): SystemInfo {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  let os = 'Unknown OS';
  if (/Windows NT/i.test(ua)) os = 'Windows';
  else if (/Android/i.test(ua)) os = 'Android';
  else if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS/iPadOS';
  else if (/CrOS/i.test(ua)) os = 'ChromeOS';
  else if (/Mac OS X|Macintosh/i.test(ua)) os = 'macOS';
  else if (/Linux/i.test(ua)) os = 'Linux';
  let browser = 'Unknown browser';
  if (/Edg\//i.test(ua)) browser = 'Edge';
  else if (/OPR\/|Opera/i.test(ua)) browser = 'Opera';
  else if (/Firefox\//i.test(ua)) browser = 'Firefox';
  else if (/Chrome\//i.test(ua)) browser = 'Chrome';
  else if (/Safari\//i.test(ua)) browser = 'Safari';
  return {
    os,
    browser,
    secureContext: typeof window !== 'undefined' ? window.isSecureContext : true,
    capabilities: detectCapabilities(),
  };
}

// ─── Discovered devices ──────────────────────────────────────────────────────
export interface DiscoveredDevice {
  /** Stable-ish id: `<transport>:<vid|id>:<pid>:<serial|index>`. */
  id: string;
  transport: TransportKind;
  kind: DeviceKind;
  name: string;
  vendorId?: number;
  productId?: number;
  /** True when the handle reports it is currently connected/open. */
  connected: boolean;
  /** Raw handle, used to reconnect without firing another picker. */
  handle?: unknown;
}

interface Transport {
  readonly kind: Exclude<TransportKind, 'simulator'>;
  readonly label: string;
  write(bytes: Uint8Array): Promise<void>;
  close(): Promise<void>;
}

// ─── Small helpers ───────────────────────────────────────────────────────────
function hex(n?: number): string {
  return n === undefined ? '?' : `0x${n.toString(16).padStart(4, '0')}`;
}
function describeSerial(vid?: number, pid?: number, index = 0): string {
  return vid !== undefined ? `Serial ${hex(vid)}:${hex(pid)}` : `Serial port ${index + 1}`;
}
function safeGetInfo(port: SerialPortLike): { usbVendorId?: number; usbProductId?: number } | null {
  try {
    return port.getInfo?.() ?? null;
  } catch {
    return null;
  }
}
async function safeAsync<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}
function pickPrinterInterface(dev: USBDeviceLike): USBInterfaceLike | null {
  const ifaces = dev.configuration?.interfaces ?? [];
  if (ifaces.length === 0) return null;
  const printer = ifaces.find((i) => i.alternate?.interfaceClass === 7); // USB printer class
  if (printer) return printer;
  const withOut = ifaces.find((i) => (i.alternate?.endpoints ?? []).some((e) => e.direction === 'out'));
  return withOut ?? ifaces[0] ?? null;
}

// Common BLE services that carry a serial/printer byte stream.
const BT_PRINTER_SERVICES: string[] = [
  '6e400001-b5a3-f393-e0a9-e50e24dcca9e', // Nordic UART Service
  '0000ffe0-0000-1000-8000-00805f9b34fb', // HM-10 / CC2541 "serial"
  '0000fff0-0000-1000-8000-00805f9b34fb', // Common thermal-printer service
  '49535343-fe7d-4ae5-8fa9-9fafd205e455', // Microchip/other UART-like
];

export interface PrinterSettings {
  baudRate: number;
  /** Paper width in characters — 32 (58mm) or 42/48 (80mm). */
  width: 32 | 42 | 48;
  /** ISO 4217 code of the receipt currency (any world currency). */
  currencyCode: string;
  /** Symbol prefixed to amounts; derived from `currencyCode`. */
  currencySymbol: string;
  /** Cash-drawer pin: 0 = drawer 1, 1 = drawer 2. */
  drawerPin: 0 | 1;
  /** Automatically kick the drawer after a cash sale. */
  autoOpenDrawer: boolean;
  /** Automatically print the receipt after checkout. */
  autoPrint: boolean;
}

const SETTINGS_KEY = 'pos.hardware.settings';
const LAST_DEVICE_KEY = 'pos.hardware.lastDevice';

export const DEFAULT_PRINTER_SETTINGS: PrinterSettings = {
  baudRate: 9600,
  width: 42,
  currencyCode: 'USD',
  currencySymbol: '$',
  drawerPin: 0,
  autoOpenDrawer: true,
  autoPrint: false,
};

export function loadPrinterSettings(): PrinterSettings {
  try {
    if (typeof localStorage === 'undefined') return { ...DEFAULT_PRINTER_SETTINGS };
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_PRINTER_SETTINGS };
    return { ...DEFAULT_PRINTER_SETTINGS, ...(JSON.parse(raw) as Partial<PrinterSettings>) };
  } catch {
    return { ...DEFAULT_PRINTER_SETTINGS };
  }
}

export function savePrinterSettings(settings: PrinterSettings): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* storage unavailable (private mode) — settings stay in memory */
  }
}

function loadLastDeviceId(): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(LAST_DEVICE_KEY);
  } catch {
    return null;
  }
}
function saveLastDeviceId(id: string): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(LAST_DEVICE_KEY, id);
  } catch {
    /* ignore */
  }
}

/**
 * Singleton hardware controller. It auto-detects the available transports,
 * enumerates every device the user has already granted across Serial/USB/
 * Bluetooth, classifies each one, and silently reconnects to the last-used (or
 * first recognised printer) device on demand. When no transport is available it
 * falls back to a console "simulator" so the UI never breaks.
 */
export class HardwareService {
  private transport: Transport | null = null;
  private activeId: string | null = null;
  private activeName: string = '';
  private activeKind: DeviceKind = 'unknown';
  private activeTransport: TransportKind = 'simulator';
  settings: PrinterSettings = loadPrinterSettings();

  /** Which transports this browser supports. */
  get capabilities(): HardwareCapabilities {
    return detectCapabilities();
  }

  /** True when at least one real transport is available. */
  get isSupported(): boolean {
    const c = detectCapabilities();
    return c.serial || c.usb || c.bluetooth;
  }

  get isConnected(): boolean {
    return this.transport !== null;
  }

  /** The device currently driving the transport (null when simulating). */
  get activeDevice(): DiscoveredDevice | null {
    if (!this.transport) return null;
    return {
      id: this.activeId ?? this.transport.label,
      transport: this.activeTransport,
      kind: this.activeKind,
      name: this.activeName || this.transport.label,
      connected: true,
    };
  }

  updateSettings(next: Partial<PrinterSettings>): void {
    this.settings = { ...this.settings, ...next };
    savePrinterSettings(this.settings);
  }

  // ── Enumeration ──────────────────────────────────────────────────────────
  /**
   * List every device the user has ALREADY granted across all transports, so a
   * previously paired printer/scanner is never "missing" on reload. Reconnecting
   * to these needs no user gesture.
   */
  async enumerate(): Promise<DiscoveredDevice[]> {
    const out: DiscoveredDevice[] = [];

    const serial = getSerial();
    if (serial) {
      const ports = safeSync(() => serial.getPorts(), [] as SerialPortLike[]);
      ports.forEach((port, i) => {
        const info = safeGetInfo(port);
        const vendorId = info?.usbVendorId;
        const productId = info?.usbProductId;
        const name = describeSerial(vendorId, productId, i);
        out.push({
          id: `serial:${vendorId ?? 'x'}:${productId ?? 'x'}:${i}`,
          transport: 'serial',
          kind: classifyDevice({ name, vendorId, productId, transport: 'serial' }),
          name,
          vendorId,
          productId,
          connected: true, // granted serial ports can be re-opened directly
          handle: port,
        });
      });
    }

    const usb = getUsb();
    if (usb?.getDevices) {
      const devs = await safeAsync(() => usb.getDevices(), [] as USBDeviceLike[]);
      devs.forEach((dev, i) => {
        const name = dev.productName || `USB ${hex(dev.vendorId)}:${hex(dev.productId)}`;
        out.push({
          id: `usb:${dev.vendorId}:${dev.productId}:${dev.serialNumber ?? i}`,
          transport: 'usb',
          kind: classifyDevice({ name, vendorId: dev.vendorId, productId: dev.productId, transport: 'usb' }),
          name,
          vendorId: dev.vendorId,
          productId: dev.productId,
          connected: dev.opened,
          handle: dev,
        });
      });
    }

    const bt = getBluetooth();
    if (bt?.getDevices) {
      const getBt = bt.getDevices.bind(bt);
      const devs = await safeAsync(() => getBt(), [] as BTDeviceLike[]);
      devs.forEach((dev) => {
        const name = dev.name || 'Bluetooth device';
        out.push({
          id: `bt:${dev.id}`,
          transport: 'bluetooth',
          kind: classifyDevice({ name, transport: 'bluetooth' }),
          name,
          connected: Boolean(dev.gatt?.connected),
          handle: dev,
        });
      });
    }

    return out;
  }

  // ── Connection ───────────────────────────────────────────────────────────
  /**
   * Pair + open a device. First tries a silent reconnect to an already-granted
   * device (no picker); if none exists it falls back to the browser's pairing
   * chooser across the available transports. Must be called from a user gesture
   * for the first-time pairing path (browser rule).
   */
  async connect(baudRate = this.settings.baudRate): Promise<boolean> {
    const auto = await this.autoConnect(baudRate);
    if (auto) return true;
    return this.pair(undefined, baudRate);
  }

  /**
   * Reconnect to the last-used device, else the first recognised printer, else
   * any granted device — without a user gesture. Returns the device connected.
   */
  async autoConnect(baudRate = this.settings.baudRate): Promise<DiscoveredDevice | null> {
    const devices = await this.enumerate();
    if (devices.length === 0) return null;
    const lastId = loadLastDeviceId();
    const pick =
      (lastId ? devices.find((d) => d.id === lastId) : undefined) ||
      devices.find((d) => d.kind === 'printer' && d.connected) ||
      devices.find((d) => d.kind === 'printer') ||
      devices.find((d) => d.connected) ||
      devices[0];
    const ok = await this.connectToDevice(pick, baudRate);
    return ok ? pick : null;
  }

  /** Connect to a specific enumerated device (uses its retained handle). */
  async connectToDevice(device: DiscoveredDevice, baudRate = this.settings.baudRate): Promise<boolean> {
    let ok = false;
    if (device.transport === 'serial') {
      ok = await this.openSerialPort(device.handle as SerialPortLike, baudRate, device.name, device.kind);
    } else if (device.transport === 'usb') {
      ok = await this.openUsbDevice(device.handle as USBDeviceLike, device.name, device.kind);
    } else if (device.transport === 'bluetooth') {
      ok = await this.openBluetoothDevice(device.handle as BTDeviceLike, device.name, device.kind);
    }
    if (ok) {
      this.activeId = device.id;
      saveLastDeviceId(device.id);
    }
    return ok;
  }

  /**
   * First-time pairing via the browser chooser. `transport` pins one transport;
   * otherwise it tries each supported one in turn (serial → usb → bluetooth).
   */
  async pair(transport?: TransportKind, baudRate = this.settings.baudRate): Promise<boolean> {
    const caps = detectCapabilities();
    const order: Array<'serial' | 'usb' | 'bluetooth'> =
      transport === 'serial' || transport === 'usb' || transport === 'bluetooth'
        ? [transport]
        : (['serial', 'usb', 'bluetooth'] as const).filter((t) => caps[t]);
    for (const t of order) {
      const ok =
        t === 'serial' ? await this.pairSerial(baudRate)
        : t === 'usb' ? await this.pairUsb()
        : await this.pairBluetooth();
      if (ok) return true;
    }
    if (order.length === 0) {
      console.warn('[hardware] No supported device transport (Serial/USB/Bluetooth) — using simulator.');
    }
    return false;
  }

  async pairSerial(baudRate = this.settings.baudRate): Promise<boolean> {
    const serial = getSerial();
    if (!serial) return false;
    try {
      const port = await serial.requestPort();
      const info = safeGetInfo(port);
      const name = describeSerial(info?.usbVendorId, info?.usbProductId, 0);
      const kind = classifyDevice({ name, vendorId: info?.usbVendorId, productId: info?.usbProductId, transport: 'serial' });
      const ok = await this.openSerialPort(port, baudRate, name, kind);
      if (ok) {
        this.activeId = `serial:${info?.usbVendorId ?? 'x'}:${info?.usbProductId ?? 'x'}:paired`;
        saveLastDeviceId(this.activeId);
      }
      return ok;
    } catch (err) {
      console.error('[hardware] Serial pairing failed:', err);
      return false;
    }
  }

  async pairUsb(): Promise<boolean> {
    const usb = getUsb();
    if (!usb) return false;
    try {
      const dev = await usb.requestDevice({ filters: [] }); // empty filter ⇒ show all devices
      const name = dev.productName || `USB ${hex(dev.vendorId)}:${hex(dev.productId)}`;
      const kind = classifyDevice({ name, vendorId: dev.vendorId, productId: dev.productId, transport: 'usb' });
      const ok = await this.openUsbDevice(dev, name, kind);
      if (ok) {
        this.activeId = `usb:${dev.vendorId}:${dev.productId}:${dev.serialNumber ?? 0}`;
        saveLastDeviceId(this.activeId);
      }
      return ok;
    } catch (err) {
      console.error('[hardware] USB pairing failed:', err);
      return false;
    }
  }

  async pairBluetooth(): Promise<boolean> {
    const bt = getBluetooth();
    if (!bt) return false;
    try {
      const dev = await bt.requestDevice({ acceptAllDevices: true, optionalServices: BT_PRINTER_SERVICES });
      const name = dev.name || 'Bluetooth device';
      const kind = classifyDevice({ name, transport: 'bluetooth' });
      const ok = await this.openBluetoothDevice(dev, name, kind);
      if (ok) {
        this.activeId = `bt:${dev.id}`;
        saveLastDeviceId(this.activeId);
      }
      return ok;
    } catch (err) {
      console.error('[hardware] Bluetooth pairing failed:', err);
      return false;
    }
  }

  // ── Transport openers ──────────────────────────────────────────────────────
  private async openSerialPort(port: SerialPortLike, baudRate: number, label: string, kind: DeviceKind): Promise<boolean> {
    if (!port) return false;
    try {
      await this.disconnect();
      await port.open({ baudRate });
      const writer = port.writable?.getWriter() ?? null;
      if (!writer) {
        await port.close().catch(() => { /* ignore */ });
        return false;
      }
      this.transport = {
        kind: 'serial',
        label,
        write: (bytes) => writer.write(bytes),
        close: async () => {
          try { writer.releaseLock(); } catch { /* ignore */ }
          await port.close().catch(() => { /* ignore */ });
        },
      };
      this.activeName = label;
      this.activeKind = kind;
      this.activeTransport = 'serial';
      return true;
    } catch (err) {
      console.error('[hardware] Failed to open serial printer:', err);
      this.transport = null;
      return false;
    }
  }

  private async openUsbDevice(dev: USBDeviceLike, label: string, kind: DeviceKind): Promise<boolean> {
    if (!dev) return false;
    try {
      await this.disconnect();
      if (!dev.opened) await dev.open();
      if (!dev.configuration) await dev.selectConfiguration(1);
      const iface = pickPrinterInterface(dev);
      if (!iface) {
        console.warn('[hardware] USB device exposes no usable interface.');
        return false;
      }
      await dev.claimInterface(iface.interfaceNumber);
      const outEp = (iface.alternate?.endpoints ?? []).find(
        (e) => e.direction === 'out' && (e.type === undefined || e.type === 2),
      );
      const endpointNumber = outEp?.endpointNumber ?? 1;
      const interfaceNumber = iface.interfaceNumber;
      this.transport = {
        kind: 'usb',
        label,
        write: async (bytes) => { await dev.transferOut(endpointNumber, bytes); },
        close: async () => {
          try { await dev.releaseInterface(interfaceNumber); } catch { /* ignore */ }
          try { await dev.close(); } catch { /* ignore */ }
        },
      };
      this.activeName = label;
      this.activeKind = kind;
      this.activeTransport = 'usb';
      return true;
    } catch (err) {
      console.error('[hardware] Failed to open USB device:', err);
      this.transport = null;
      return false;
    }
  }

  private async openBluetoothDevice(dev: BTDeviceLike, label: string, kind: DeviceKind): Promise<boolean> {
    if (!dev?.gatt) return false;
    try {
      await this.disconnect();
      const server = await dev.gatt.connect();
      const services = await safeAsync(() => server.getPrimaryServices(), [] as BTServiceLike[]);
      let characteristic: BTCharacteristicLike | null = null;
      for (const svc of services) {
        const chars = await safeAsync(() => svc.getCharacteristics(), [] as BTCharacteristicLike[]);
        const writable = chars.find((c) => c.properties?.write || c.properties?.writeWithoutResponse);
        if (writable) {
          characteristic = writable;
          break;
        }
      }
      if (!characteristic) {
        console.warn('[hardware] Bluetooth device exposes no writable characteristic.');
        try { server.disconnect(); } catch { /* ignore */ }
        return false;
      }
      const ch = characteristic;
      this.transport = {
        kind: 'bluetooth',
        label,
        write: async (bytes) => {
          // Chunk to stay within the negotiated BLE MTU.
          for (let i = 0; i < bytes.length; i += 180) {
            const slice = bytes.subarray(i, i + 180);
            if (ch.properties?.writeWithoutResponse && ch.writeValueWithoutResponse) {
              await ch.writeValueWithoutResponse(slice);
            } else {
              await ch.writeValue(slice);
            }
          }
        },
        close: async () => { try { server.disconnect(); } catch { /* ignore */ } },
      };
      this.activeName = label;
      this.activeKind = kind;
      this.activeTransport = 'bluetooth';
      return true;
    } catch (err) {
      console.error('[hardware] Failed to open Bluetooth device:', err);
      this.transport = null;
      return false;
    }
  }

  // ── Output ────────────────────────────────────────────────────────────────
  /** Write raw bytes to the active device (or log them in simulator mode). */
  async write(bytes: Uint8Array): Promise<void> {
    if (!this.transport) {
      console.info(`[hardware:simulator] would print ${bytes.length} bytes`);
      return;
    }
    await this.transport.write(bytes);
  }

  /** Build + print a receipt from structured order data. */
  async printReceipt(data: ReceiptData): Promise<void> {
    const bytes = buildReceipt({
      ...data,
      width: this.settings.width,
      currencySymbol: data.currencySymbol ?? this.settings.currencySymbol,
    });
    await this.write(bytes);
  }

  /** Kick the cash drawer open. */
  async openCashDrawer(pin: 0 | 1 = this.settings.drawerPin): Promise<void> {
    await this.write(cashDrawerBytes(pin));
  }

  /**
   * Convenience: print a receipt and, for cash sales, open the drawer.
   * `tenderWasCash` drives the auto-open behaviour.
   */
  async completeSale(data: ReceiptData, tenderWasCash: boolean): Promise<void> {
    await this.printReceipt(data);
    if (tenderWasCash && this.settings.autoOpenDrawer) await this.openCashDrawer();
  }

  async disconnect(): Promise<void> {
    try {
      await this.transport?.close();
    } catch (err) {
      console.warn('[hardware] Error during disconnect:', err);
    } finally {
      this.transport = null;
      this.activeId = null;
      this.activeName = '';
      this.activeKind = 'unknown';
      this.activeTransport = 'simulator';
    }
  }
}

function safeSync<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/** Shared singleton so the whole app talks to one device connection. */
export const hardware = new HardwareService();

// ─── Barcode scanner (keyboard-wedge) ────────────────────────────────────────
// USB-HID barcode scanners type the scanned code very fast and terminate with
// Enter. We distinguish that from human typing by the inter-key interval and
// minimum length, so a physical keyboard still works normally.
export interface ScannerOptions {
  /** Minimum characters to treat a burst as a scan (default 4). */
  minLength?: number;
  /** Max ms between keystrokes to still count as one scan burst (default 40). */
  maxIntervalMs?: number;
  /** Only listen when this element (or none = document) has focus. */
  target?: EventTarget;
}

/**
 * Attach a keyboard-wedge barcode scanner. Returns a detach function. The
 * callback fires with the scanned code; the terminating Enter is suppressed so
 * it does not also submit a form.
 */
export function attachBarcodeScanner(onScan: (code: string) => void, options: ScannerOptions = {}): () => void {
  const minLength = options.minLength ?? 4;
  const maxInterval = options.maxIntervalMs ?? 40;
  const target = options.target ?? document;

  let buffer = '';
  let lastKeyAt = 0;

  const handler = (e: Event) => {
    const ev = e as KeyboardEvent;
    const now = Date.now();
    // A slow gap means the burst ended — reset so human typing is ignored.
    if (buffer.length && now - lastKeyAt > maxInterval * 4) buffer = '';
    lastKeyAt = now;

    if (ev.key === 'Enter') {
      if (buffer.length >= minLength && now - lastKeyAt <= maxInterval * 4) {
        // Fast burst + Enter ⇒ a scan. Suppress the keystroke and emit.
        ev.preventDefault();
        onScan(buffer);
      }
      buffer = '';
      return;
    }
    // Only accumulate single printable characters (ignore modifiers/nav keys).
    if (ev.key.length === 1) {
      if (now - lastKeyAt > maxInterval && buffer.length) {
        // gap too large for a scanner burst — likely human typing, restart
        buffer = '';
      }
      buffer += ev.key;
    }
  };

  target.addEventListener('keydown', handler as EventListener);
  return () => target.removeEventListener('keydown', handler as EventListener);
}

// ─── Customer-facing display ─────────────────────────────────────────────────
// Many pole/VFD displays are serial and accept plain ASCII lines. This writes a
// simple two-line total; unsupported setups silently no-op.
export class CustomerDisplay {
  private port: SerialPortLike | null = null;
  private writer: WritableLike | null = null;

  get isConnected(): boolean {
    return this.writer !== null;
  }

  async connect(baudRate = 9600): Promise<boolean> {
    const serial = getSerial();
    if (!serial) return false;
    try {
      this.port = await serial.requestPort();
      await this.port.open({ baudRate });
      this.writer = this.port.writable?.getWriter() ?? null;
      return this.isConnected;
    } catch (err) {
      console.error('[display] Failed to connect customer display:', err);
      return false;
    }
  }

  /** Show a line of text (cleared first). Best-effort; no-op when unconnected. */
  async showText(line: string): Promise<void> {
    if (!this.writer) return;
    // CLS (0x0c) then the ASCII text — the common VFD convention.
    await this.writer.write(concatBytes(new Uint8Array([0x0c]), encodeAscii(line)));
  }

  async showTotal(total: number, symbol = '$'): Promise<void> {
    await this.showText(`TOTAL ${symbol}${total.toFixed(2)}`);
  }

  async disconnect(): Promise<void> {
    try {
      this.writer?.releaseLock();
      await this.port?.close();
    } catch {
      /* ignore */
    } finally {
      this.writer = null;
      this.port = null;
    }
  }
}

function encodeAscii(text: string): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    bytes.push(c >= 0x20 && c <= 0x7e ? c : 0x3f);
  }
  return new Uint8Array(bytes);
}
