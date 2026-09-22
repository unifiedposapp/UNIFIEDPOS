// ─── Organization & Tenant ────────────────────────────────────

export interface Organization {
  id: string;
  name: string;
  industry: 'RETAIL' | 'RESTAURANT' | 'SERVICES';
  currency: string;
  taxRate: number;
  phone?: string;
  email?: string;
  address?: string;
  isActive: boolean;
}

export interface Location {
  id: string;
  organizationId: string;
  name: string;
  address?: string;
  phone?: string;
  isActive: boolean;
}

export interface Register {
  id: string;
  organizationId: string;
  locationId: string;
  name: string;
  status: RegisterStatus;
  // Set by GET /registers: who (if anybody) currently holds this drawer. A
  // cashier sees only that it is taken — the holding colleague's identity is
  // supervisor-only.
  available?: boolean;
  occupied?: boolean;
  openSession?: RegisterOccupancy | null;
}

export interface RegisterOccupancy {
  sessionId: string;
  locked: boolean;
  mine: boolean;
  openedAt: string;
  cashier?: string;
  employeeId?: string;
}

export type RegisterStatus = 'CLOSED' | 'OPENING' | 'OPEN' | 'SUSPENDED' | 'CLOSING';

export interface RegisterSession {
  id: string;
  registerId: string;
  employeeId: string;
  openingCash: number;
  closingCash?: number;
  expectedCash?: number;
  variance?: number;
  status: 'OPEN' | 'CLOSING' | 'CLOSED';
  openedAt: string;
  closedAt?: string;
  notes?: string;
  // Drawer handover lock: while true, the owning cashier must enter their own
  // PIN before the register accepts another sale.
  locked?: boolean;
  lockedAt?: string | null;
  lockReason?: RegisterLockReason | null;
  lockedCount?: number;
  // Accompanying the session on GET /registers/session.
  pinConfigured?: boolean;
  idleLockMinutes?: number;
  pinLock?: PinLockState;
}

export type RegisterLockReason = 'MANUAL' | 'IDLE';

/** PIN brute-freeze state returned by GET /registers/pin. */
export interface PinLockState {
  locked: boolean;
  remainingAttempts: number;
  retryAfterSeconds: number;
}

export interface PinStatus {
  pinConfigured: boolean;
  pinUpdatedAt?: string | null;
  lock: PinLockState;
}

export interface Device {
  id: string;
  organizationId: string;
  locationId?: string;
  registerId?: string;
  name: string;
  type: 'POS_TERMINAL' | 'MOBILE' | 'KIOSK' | 'KITCHEN_DISPLAY';
  status: 'ONLINE' | 'OFFLINE' | 'MAINTENANCE' | 'RETIRED';
  lastSyncAt?: string;
}

// ─── User & Auth ──────────────────────────────────────────────

export type UserRole = 'OWNER' | 'ADMIN' | 'MANAGER' | 'CASHIER';

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  isActive: boolean;
}

export interface Employee {
  id: string;
  organizationId: string;
  userId: string;
  employeeNumber?: string;
  department?: string;
  position?: string;
  hourlyRate?: number;
  isActive: boolean;
  user?: User;
  // The PIN itself is never transmitted — only whether one exists.
  pinConfigured?: boolean;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  user: User;
  employee?: Employee;
  token: string;
}

// ─── Customer ─────────────────────────────────────────────────

export interface Customer {
  id: string;
  organizationId: string;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  totalSpent: number;
  totalOrders: number;
  averageOrderValue: number;
  loyaltyPoints: number;
  notes?: string;
  isActive: boolean;
  createdAt: string;
}

// ─── Product Catalog ──────────────────────────────────────────

// Classification of a product. PHYSICAL goods are stock-tracked; SERVICE,
// DIGITAL, GIFT_CARD and NON_INVENTORY items are sold but not counted in stock.
// Mirrors PRODUCT_TYPES in constants.ts and the `Product.type` column.
export type ProductType = 'PHYSICAL' | 'SERVICE' | 'DIGITAL' | 'GIFT_CARD' | 'NON_INVENTORY';

export interface Category {
  id: string;
  organizationId: string;
  name: string;
  description?: string;
  color?: string;
  sortOrder: number;
  isActive: boolean;
  productCount?: number;
}

export interface Brand {
  id: string;
  organizationId: string;
  name: string;
  description?: string;
}

export interface Product {
  id: string;
  organizationId: string;
  name: string;
  sku: string;
  barcode?: string;
  description?: string;
  type?: ProductType;
  price: number;
  costPrice: number;
  categoryId?: string;
  category?: Category;
  brandId?: string;
  brand?: Brand;
  taxRuleId?: string;
  imageUrl?: string;
  isActive: boolean;
  stock?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProductVariant {
  id: string;
  productId: string;
  name: string;
  value: string;
  priceAdj: number;
  sku?: string;
  barcode?: string;
}

export interface ModifierGroup {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  modifiers: Modifier[];
}

export interface Modifier {
  id: string;
  name: string;
  priceAdj: number;
}

export interface TaxRule {
  id: string;
  name: string;
  rate: number;
  isActive: boolean;
}

// ─── Inventory Engine ─────────────────────────────────────────

export interface InventoryBalance {
  id: string;
  productId: string;
  locationId: string;
  quantity: number;
  reserved: number;
  damaged: number;
  reorderPoint: number;
  product?: Product;
}

export type InventoryMovementType =
  | 'SALE' | 'PURCHASE' | 'TRANSFER_IN' | 'TRANSFER_OUT'
  | 'ADJUSTMENT' | 'RETURN' | 'DAMAGED' | 'COUNT';

export interface InventoryMovement {
  id: string;
  balanceId: string;
  type: InventoryMovementType;
  quantity: number;
  reference?: string;
  notes?: string;
  performedBy?: string;
  createdAt: string;
}

export interface Supplier {
  id: string;
  organizationId: string;
  name: string;
  contactName?: string;
  email?: string;
  phone?: string;
  address?: string;
  isActive: boolean;
}

// ─── Order Management ─────────────────────────────────────────

export type OrderStatus =
  | 'DRAFT' | 'HELD' | 'CONFIRMED' | 'PAID'
  | 'PROCESSING' | 'FULFILLED' | 'COMPLETED'
  | 'CANCELLED' | 'REFUNDED' | 'PARTIALLY_REFUNDED';

export type OrderChannel = 'IN_STORE' | 'ONLINE' | 'PHONE' | 'MOBILE';

export type FulfillmentType = 'PICKUP' | 'DELIVERY' | 'SHIP' | 'DINE_IN' | 'TAKEOUT';

export interface Order {
  id: string;
  orderNumber: string;
  organizationId: string;
  locationId?: string;
  registerId?: string;
  sessionId?: string;
  employeeId?: string;
  customerId?: string;
  channel: OrderChannel;
  status: OrderStatus;
  currency: string;
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  totalAmount: number;
  tipAmount: number;
  serviceCharge: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  items?: OrderItem[];
  discounts?: OrderDiscount[];
  taxes?: OrderTax[];
  payments?: Payment[];
  employee?: { id: string; name: string };
  customer?: { id: string; name: string; phone?: string };
  location?: { id: string; name: string };
  register?: { id: string; name: string };
}

export interface OrderItem {
  id: string;
  orderId: string;
  productId: string;
  variantId?: string;
  productName: string;
  variantName?: string;
  quantity: number;
  unitPrice: number;
  discountAmt: number;
  taxAmt: number;
  totalAmount: number;
  notes?: string;
}

export interface OrderDiscount {
  id: string;
  type: 'PERCENTAGE' | 'FIXED' | 'COUPON';
  value: number;
  reason?: string;
}

export interface OrderTax {
  id: string;
  name: string;
  rate: number;
  amount: number;
}

export interface OrderFulfillment {
  id: string;
  type: FulfillmentType;
  status: 'PENDING' | 'PREPARING' | 'READY' | 'DELIVERED';
  notes?: string;
}

// ─── Cart ─────────────────────────────────────────────────────

export interface CartItem {
  productId: string;
  variantId?: string;
  name: string;
  variantName?: string;
  price: number;
  quantity: number;
  discount: number;
  modifiers?: Modifier[];
  notes?: string;
}

export interface Cart {
  items: CartItem[];
  customerId?: string;
  discount: number;
  discountType?: 'PERCENTAGE' | 'FIXED';
  tip: number;
  notes?: string;
}

// ─── Payment System ───────────────────────────────────────────

export type PaymentMethod =
  | 'CASH' | 'CARD' | 'TAP' | 'CHIP' | 'APPLE_PAY' | 'GOOGLE_PAY'
  | 'GIFT_CARD' | 'STORE_CREDIT' | 'ACH' | 'QR' | 'OTHER';

export type PaymentStatus =
  | 'AUTHORIZED' | 'CAPTURED' | 'SETTLED' | 'COMPLETED'
  | 'DECLINED' | 'VOIDED' | 'REFUNDED' | 'FAILED';

export interface Payment {
  id: string;
  orderId: string;
  method: PaymentMethod;
  provider?: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  reference?: string;
  createdAt: string;
}

// ─── Audit System ─────────────────────────────────────────────

export interface AuditEvent {
  id: string;
  organizationId: string;
  actorId?: string;
  deviceId?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  previousValue?: any;
  newValue?: any;
  metadata?: any;
  createdAt: string;
  actor?: { id: string; name: string };
}

// ─── Time & Labor ─────────────────────────────────────────────

export interface TimeEntry {
  id: string;
  employeeId: string;
  clockIn: string;
  clockOut?: string;
  breakStart?: string;
  breakEnd?: string;
  notes?: string;
}

// ─── Reporting ────────────────────────────────────────────────

export interface SalesReport {
  totalOrders: number;
  totalRevenue: number;
  totalTax: number;
  totalDiscount: number;
  averageOrderValue: number;
  topProducts: { productId: string; productName: string; quantitySold: number; revenue: number }[];
  paymentBreakdown: { method: string; count: number; total: number }[];
}

export interface DailySalesSummary {
  date: string;
  totalOrders: number;
  totalRevenue: number;
  totalTax: number;
}

// ─── API Response Types ───────────────────────────────────────

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface PaginationParams {
  page?: number;
  pageSize?: number;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}
