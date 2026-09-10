import { describe, it, expect } from 'vitest';
import {
  PRODUCT_TYPES,
  PRODUCT_TYPE_LABELS,
  DEFAULT_PRODUCT_TYPE,
  productTypeLabel,
  isStockTracked,
} from '../src/index';

describe('PRODUCT_TYPES constants', () => {
  it('exposes the full retail product taxonomy', () => {
    expect(PRODUCT_TYPES.PHYSICAL).toBe('PHYSICAL');
    expect(PRODUCT_TYPES.SERVICE).toBe('SERVICE');
    expect(PRODUCT_TYPES.DIGITAL).toBe('DIGITAL');
    expect(PRODUCT_TYPES.GIFT_CARD).toBe('GIFT_CARD');
    expect(PRODUCT_TYPES.NON_INVENTORY).toBe('NON_INVENTORY');
  });

  it('defaults to a physical, stock-tracked product', () => {
    expect(DEFAULT_PRODUCT_TYPE).toBe('PHYSICAL');
    expect(isStockTracked(DEFAULT_PRODUCT_TYPE)).toBe(true);
  });

  it('has a label for every product type', () => {
    for (const type of Object.values(PRODUCT_TYPES)) {
      expect(PRODUCT_TYPE_LABELS[type]).toBeTruthy();
    }
  });
});

describe('productTypeLabel', () => {
  it('returns the friendly label for known types', () => {
    expect(productTypeLabel('PHYSICAL')).toBe('Physical');
    expect(productTypeLabel('SERVICE')).toBe('Service');
    expect(productTypeLabel('DIGITAL')).toBe('Digital');
    expect(productTypeLabel('GIFT_CARD')).toBe('Gift Card');
    expect(productTypeLabel('NON_INVENTORY')).toBe('Non-inventory');
  });

  it('falls back to the default label when no type is set', () => {
    expect(productTypeLabel()).toBe('Physical');
    expect(productTypeLabel(null)).toBe('Physical');
    expect(productTypeLabel('')).toBe('Physical');
  });

  it('falls back to the raw value for an unknown type', () => {
    expect(productTypeLabel('MYSTERY')).toBe('MYSTERY');
  });
});

describe('isStockTracked', () => {
  it('tracks stock only for physical products', () => {
    expect(isStockTracked('PHYSICAL')).toBe(true);
  });

  it('does not track stock for non-physical types', () => {
    expect(isStockTracked('SERVICE')).toBe(false);
    expect(isStockTracked('DIGITAL')).toBe(false);
    expect(isStockTracked('GIFT_CARD')).toBe(false);
    expect(isStockTracked('NON_INVENTORY')).toBe(false);
  });

  it('treats a missing type as stock-tracked (defaults to physical)', () => {
    expect(isStockTracked()).toBe(true);
    expect(isStockTracked(null)).toBe(true);
    expect(isStockTracked('')).toBe(true);
  });

  it('does not track unknown types', () => {
    expect(isStockTracked('MYSTERY')).toBe(false);
  });
});
