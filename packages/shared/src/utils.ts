// ─── Currency Formatting ──────────────────────────────────────

import { PRODUCT_TYPE_LABELS, DEFAULT_PRODUCT_TYPE } from './constants';

// Formats an amount in any ISO 4217 currency. Intl handles the correct minor
// unit automatically (0 decimals for JPY, 3 for BHD, etc.). Falls back to a
// plain grouped number suffixed with the code for special/non-circulating
// codes (metals, SDR, XXX) that some Intl builds reject.
export function formatCurrency(amount: number, currency = 'USD'): string {
  const code = (currency || 'USD').toUpperCase();
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: code,
    }).format(amount);
  } catch {
    const grouped = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
    return `${grouped} ${code}`;
  }
}

// ─── Number Formatting ────────────────────────────────────────

export function formatNumber(value: number, decimals = 2): string {
  return value.toFixed(decimals);
}

// ─── Date Formatting ──────────────────────────────────────────

export function formatDate(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatDateTime(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatTime(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ─── Order Number Generation ──────────────────────────────────

export function generateOrderNumber(): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `ORD-${date}-${random}`;
}

// ─── Validation Helpers ───────────────────────────────────────

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function isNonEmpty(value: string): boolean {
  return value.trim().length > 0;
}

// ─── Cart Calculations ────────────────────────────────────────

export function calculateItemTotal(unitPrice: number, quantity: number, discount: number): number {
  return unitPrice * quantity - discount;
}

export function calculateTax(subtotal: number, taxRate: number): number {
  return subtotal * (taxRate / 100);
}

export function calculateChange(amountPaid: number, total: number): number {
  return Math.max(0, amountPaid - total);
}

// ─── Product Type Helpers ─────────────────────────────────────

// Types whose quantity is tracked by the inventory engine. Only physical goods
// are stocked; services, digital downloads, gift cards and non-inventory items
// are sold but never counted in stock.
const STOCK_TRACKED_PRODUCT_TYPES = new Set<string>([DEFAULT_PRODUCT_TYPE]);

// Human-readable label for a product type. Falls back to the raw value for
// unknown types and to the default label when none is set.
export function productTypeLabel(type?: string | null): string {
  if (!type) return PRODUCT_TYPE_LABELS[DEFAULT_PRODUCT_TYPE];
  return PRODUCT_TYPE_LABELS[type] ?? type;
}

// Whether a product of this type should have its stock tracked. A missing type
// is treated as the default (physical), which is stock-tracked.
export function isStockTracked(type?: string | null): boolean {
  if (!type) return true;
  return STOCK_TRACKED_PRODUCT_TYPES.has(type);
}
