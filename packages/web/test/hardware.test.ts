import { describe, it, expect } from 'vitest';
import {
  classifyDevice,
  detectCapabilities,
  systemInfo,
  hardware,
  PRINTER_VENDOR_IDS,
  UART_BRIDGE_VENDOR_IDS,
} from '../src/services/hardware';

describe('classifyDevice — by name', () => {
  it('recognises receipt printers', () => {
    expect(classifyDevice({ name: 'EPSON TM-T88VI' })).toBe('printer');
    expect(classifyDevice({ name: 'Star Micronics TSP143' })).toBe('printer');
    expect(classifyDevice({ name: 'POS-80C Thermal Printer' })).toBe('printer');
  });
  it('recognises barcode scanners before the generic printer rule', () => {
    expect(classifyDevice({ name: 'USB Barcode Scanner' })).toBe('scanner');
    expect(classifyDevice({ name: 'Honeywell Voyager 1250g' })).toBe('scanner');
  });
  it('recognises drawers, displays and scales', () => {
    expect(classifyDevice({ name: 'Cash Drawer Kick' })).toBe('drawer');
    expect(classifyDevice({ name: 'Customer Pole Display' })).toBe('display');
    expect(classifyDevice({ name: 'Digital Weighing Scale' })).toBe('scale');
  });
});

describe('classifyDevice — by USB IDs', () => {
  it('maps known printer vendor IDs to printer', () => {
    expect(classifyDevice({ vendorId: 0x04b8 })).toBe('printer'); // Epson
    expect(classifyDevice({ vendorId: 0x0a5f })).toBe('printer'); // Zebra
    expect(PRINTER_VENDOR_IDS).toContain(0x04b8);
  });
  it('treats a serial device on a UART bridge as a printer', () => {
    expect(classifyDevice({ vendorId: 0x1a86, transport: 'serial' })).toBe('printer'); // CH340
    expect(UART_BRIDGE_VENDOR_IDS).toContain(0x10c4);
  });
  it('biases an unidentified serial device to printer (ESC/POS dominates serial POS)', () => {
    expect(classifyDevice({ transport: 'serial' })).toBe('printer');
  });
  it('returns unknown for an unrecognised non-serial device', () => {
    expect(classifyDevice({ name: 'Mystery Gadget', transport: 'bluetooth' })).toBe('unknown');
    expect(classifyDevice({})).toBe('unknown');
  });
});

describe('capability + system detection is node-safe', () => {
  it('reports no transports when navigator is absent (Node test env)', () => {
    expect(detectCapabilities()).toEqual({ serial: false, usb: false, bluetooth: false });
  });
  it('systemInfo degrades gracefully without a DOM', () => {
    const info = systemInfo();
    expect(info.capabilities).toEqual({ serial: false, usb: false, bluetooth: false });
    expect(info.secureContext).toBe(true);
    expect(typeof info.os).toBe('string');
    expect(typeof info.browser).toBe('string');
  });
  it('the singleton imports cleanly and is unsupported without device APIs', () => {
    expect(hardware.isSupported).toBe(false);
    expect(hardware.isConnected).toBe(false);
    expect(hardware.activeDevice).toBeNull();
  });
});
