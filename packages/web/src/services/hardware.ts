// ─── POS hardware layer (browser transports) ────────────────────────────────
// Bridges the physical peripherals a real register needs to the web app:
//   • Thermal receipt printer — WebSerial (primary) with a no-op fallback.
//   • Cash drawer — kicked via the printer's RJ11 port (ESC p pulse).
//   • Barcode scanner — keyboard-wedge listener (USB-HID scanners emulate a
//     keyboard) with an optional WebHID path.
//   • Customer-facing display — a second serial port, text lines only.
//
// The money-critical byte formatting lives in ./escpos.ts (pure + unit-tested);
// this file only moves bytes to a device. Every browser API is feature-detected
// and cast locally so the app compiles without w3c-web-serial types and degrades
// gracefully on unsupported browsers (nothing throws at import time).

import {
  buildReceipt,
  cashDrawerBytes,
  concatBytes,
  type ReceiptData,
} from './escpos';

// Minimal local shapes for the Web Serial API (not in the default TS DOM lib).
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

function getSerial(): SerialLike | null {
  const nav = navigator as unknown as { serial?: SerialLike };
  return nav.serial ?? null;
}

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
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_PRINTER_SETTINGS };
    return { ...DEFAULT_PRINTER_SETTINGS, ...(JSON.parse(raw) as Partial<PrinterSettings>) };
  } catch {
    return { ...DEFAULT_PRINTER_SETTINGS };
  }
}

export function savePrinterSettings(settings: PrinterSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* storage unavailable (private mode) — settings stay in memory */
  }
}

/**
 * Singleton hardware controller. Call `connect()` (from a user gesture) to pair
 * a printer, then `printReceipt()` / `openCashDrawer()`. When no serial port is
 * available it falls back to a console "simulator" so the UI never breaks.
 */
export class HardwareService {
  private port: SerialPortLike | null = null;
  private writer: WritableLike | null = null;
  settings: PrinterSettings = loadPrinterSettings();

  get isSupported(): boolean {
    return getSerial() !== null;
  }

  get isConnected(): boolean {
    return this.port !== null && this.writer !== null;
  }

  updateSettings(next: Partial<PrinterSettings>): void {
    this.settings = { ...this.settings, ...next };
    savePrinterSettings(this.settings);
  }

  /** Pair and open a printer. Must be called from a user gesture (browser rule). */
  async connect(baudRate = this.settings.baudRate): Promise<boolean> {
    const serial = getSerial();
    if (!serial) {
      console.warn('[hardware] Web Serial not supported in this browser; using simulator.');
      return false;
    }
    try {
      this.port = await serial.requestPort();
      await this.port.open({ baudRate });
      this.writer = this.port.writable?.getWriter() ?? null;
      return this.isConnected;
    } catch (err) {
      console.error('[hardware] Failed to connect printer:', err);
      this.port = null;
      this.writer = null;
      return false;
    }
  }

  /** Write raw bytes to the connected printer (or log them in simulator mode). */
  async write(bytes: Uint8Array): Promise<void> {
    if (!this.isConnected || !this.writer) {
      console.info(`[hardware:simulator] would print ${bytes.length} bytes`);
      return;
    }
    await this.writer.write(bytes);
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
      this.writer?.releaseLock();
      await this.port?.close();
    } catch (err) {
      console.warn('[hardware] Error during disconnect:', err);
    } finally {
      this.writer = null;
      this.port = null;
    }
  }
}

/** Shared singleton so the whole app talks to one printer connection. */
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
