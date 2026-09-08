// ─── App Constants ────────────────────────────────────────────

export const APP_NAME = 'Unified POS';
export const DEFAULT_CURRENCY = 'USD';
export const DEFAULT_TAX_RATE = 0;
export const API_BASE_URL = 'http://localhost:3001/api';

// ─── User Roles ───────────────────────────────────────────────

export const USER_ROLES = {
  OWNER: 'OWNER',
  ADMIN: 'ADMIN',
  MANAGER: 'MANAGER',
  CASHIER: 'CASHIER',
} as const;

export const ROLE_LABELS: Record<string, string> = {
  OWNER: 'Owner',
  ADMIN: 'Administrator',
  MANAGER: 'Manager',
  CASHIER: 'Cashier',
};

// ─── Order Status ─────────────────────────────────────────────

export const ORDER_STATUS = {
  DRAFT: 'DRAFT',
  HELD: 'HELD',
  CONFIRMED: 'CONFIRMED',
  PAID: 'PAID',
  PROCESSING: 'PROCESSING',
  FULFILLED: 'FULFILLED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  REFUNDED: 'REFUNDED',
  PARTIALLY_REFUNDED: 'PARTIALLY_REFUNDED',
} as const;

export const ORDER_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Draft',
  HELD: 'On Hold',
  CONFIRMED: 'Confirmed',
  PAID: 'Paid',
  PROCESSING: 'Processing',
  FULFILLED: 'Fulfilled',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  REFUNDED: 'Refunded',
  PARTIALLY_REFUNDED: 'Partially Refunded',
};

// ─── Payment Methods ──────────────────────────────────────────

export const PAYMENT_METHODS = {
  CASH: 'CASH',
  CARD: 'CARD',
  TAP: 'TAP',
  CHIP: 'CHIP',
  APPLE_PAY: 'APPLE_PAY',
  GOOGLE_PAY: 'GOOGLE_PAY',
  GIFT_CARD: 'GIFT_CARD',
  STORE_CREDIT: 'STORE_CREDIT',
  ACH: 'ACH',
  QR: 'QR',
  OTHER: 'OTHER',
} as const;

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: 'Cash',
  CARD: 'Card',
  TAP: 'Tap to Pay',
  CHIP: 'Chip',
  APPLE_PAY: 'Apple Pay',
  GOOGLE_PAY: 'Google Pay',
  GIFT_CARD: 'Gift Card',
  STORE_CREDIT: 'Store Credit',
  ACH: 'ACH Transfer',
  QR: 'QR Payment',
  OTHER: 'Other',
};

// ─── Register Status ──────────────────────────────────────────

export const REGISTER_STATUS = {
  CLOSED: 'CLOSED',
  OPENING: 'OPENING',
  OPEN: 'OPEN',
  SUSPENDED: 'SUSPENDED',
  CLOSING: 'CLOSING',
} as const;

// ─── Audit Actions ────────────────────────────────────────────

export const AUDIT_ACTIONS = {
  REFUND_CREATED: 'REFUND_CREATED',
  DISCOUNT_APPLIED: 'DISCOUNT_APPLIED',
  PRICE_CHANGED: 'PRICE_CHANGED',
  INVENTORY_ADJUSTED: 'INVENTORY_ADJUSTED',
  EMPLOYEE_PERMISSION_CHANGED: 'EMPLOYEE_PERMISSION_CHANGED',
  REGISTER_OPENED: 'REGISTER_OPENED',
  REGISTER_CLOSED: 'REGISTER_CLOSED',
  CASH_DRAWER_OPENED: 'CASH_DRAWER_OPENED',
  PAYMENT_VOIDED: 'PAYMENT_VOIDED',
  ORDER_VOIDED: 'ORDER_VOIDED',
  ORDER_HELD: 'ORDER_HELD',
  CUSTOMER_CREATED: 'CUSTOMER_CREATED',
  PRODUCT_CREATED: 'PRODUCT_CREATED',
  PRODUCT_UPDATED: 'PRODUCT_UPDATED',
  PRODUCT_DELETED: 'PRODUCT_DELETED',
} as const;

// ─── Pagination ───────────────────────────────────────────────

export const DEFAULT_PAGE_SIZE = 20;
export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

// ─── Routes ───────────────────────────────────────────────────

export const ROUTES = {
  LOGIN: '/login',
  DASHBOARD: '/',
  POS: '/pos',
  ORDERS: '/orders',
  INVENTORY: '/inventory',
  CUSTOMERS: '/customers',
  REPORTS: '/reports',
  EMPLOYEES: '/employees',
  SETTINGS: '/settings',
} as const;
