// API root. Defaults to same-origin "/api" (single-container deploy where the
// Express server also serves this SPA). For split hosting (SPA on a CDN, API on
// another domain) set VITE_API_URL at build time to the full API root,
// e.g. "https://api.yourdomain.com/api".
const API_BASE = import.meta.env.VITE_API_URL || '/api';

function getToken(): string | null {
  return localStorage.getItem('pos_token');
}

// Read the JS-accessible CSRF cookie (double-submit pattern). The session cookie
// itself is httpOnly and intentionally never readable from JavaScript.
function getCsrfToken(): string | null {
  const m = document.cookie.match(/(?:^|;\s*)pos_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

// A burst of parallel requests can all 401 at once when a token expires; this
// guard makes sure we clear the session and redirect to /login only once.
let redirectingToLogin = false;

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Attach the CSRF token on state-changing requests (required when the httpOnly
  // session cookie authenticates the call; harmless alongside a Bearer token).
  const method = (options.method || 'GET').toUpperCase();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const csrf = getCsrfToken();
    if (csrf) headers['X-CSRF-Token'] = csrf;
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
    credentials: 'include', // send the httpOnly session cookie (dual-mode auth)
  });

  const data = await response.json();

  if (!response.ok) {
    // Session expiry / rejected token. The auth store marks the user as
    // authenticated purely from a token's presence in localStorage (it never
    // checks expiry), so an expired JWT would otherwise leave the whole app
    // silently returning 401 with no way back to the sign-in screen — which is
    // exactly why pages like Registers show empty data and a locked "Open
    // Register" action. Clear the stale session and bounce to /login, unless we
    // are already on a public auth page (so a failed sign-in surfaces its error
    // inline instead of causing a redirect loop).
    if (response.status === 401 && !redirectingToLogin) {
      const path = window.location.pathname;
      const onPublicAuthPage =
        path.startsWith('/login') ||
        path.startsWith('/register') ||
        path.startsWith('/reset-password');
      if (!onPublicAuthPage) {
        redirectingToLogin = true;
        localStorage.removeItem('pos_token');
        localStorage.removeItem('pos_user');
        localStorage.removeItem('pos_employee');
        localStorage.removeItem('pos_organization');
        window.location.assign('/login');
      }
    }
    throw new Error(data.error || data.message || 'Request failed');
  }

  return data;
}

export const api = {
  // Auth
  login: (email: string, password: string) =>
    request<any>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  getMe: () => request<any>('/auth/me'),
  logout: () => request<any>('/auth/logout', { method: 'POST' }),
  register: (data: {
    name: string; email: string; password: string; organizationName: string;
    country: string; countryCode: string; currency?: string; industry?: string; phone?: string;
  }) => request<any>('/auth/register', { method: 'POST', body: JSON.stringify(data) }),
  forgotPassword: (email: string) =>
    request<any>('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) }),
  resetPassword: (token: string, password: string) =>
    request<any>('/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, password }) }),
  // MFA / TOTP two-factor (§37)
  getMfaStatus: () => request<any>('/auth/mfa/status'),
  mfaSetup: () => request<any>('/auth/mfa/setup', { method: 'POST' }),
  mfaEnable: (code: string) =>
    request<any>('/auth/mfa/enable', { method: 'POST', body: JSON.stringify({ code }) }),
  mfaDisable: (code: string) =>
    request<any>('/auth/mfa/disable', { method: 'POST', body: JSON.stringify({ code }) }),
  mfaVerify: (mfaToken: string, code: string) =>
    request<any>('/auth/mfa/verify', { method: 'POST', body: JSON.stringify({ mfaToken, code }) }),
  getUsers: () => request<any>('/auth/users'),
  createUser: (data: { email: string; password: string; name: string; role: string }) =>
    request<any>('/auth/users', { method: 'POST', body: JSON.stringify(data) }),

  // Inventory / Products
  getProducts: (params?: Record<string, string>) => {
    const query = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<any>(`/inventory/products${query}`);
  },
  getProduct: (id: string) => request<any>(`/inventory/products/${id}`),
  createProduct: (data: any) =>
    request<any>('/inventory/products', { method: 'POST', body: JSON.stringify(data) }),
  updateProduct: (id: string, data: any) =>
    request<any>(`/inventory/products/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteProduct: (id: string) =>
    request<any>(`/inventory/products/${id}`, { method: 'DELETE' }),
  getCategories: () => request<any>('/inventory/categories'),
  createCategory: (data: any) =>
    request<any>('/inventory/categories', { method: 'POST', body: JSON.stringify(data) }),
  updateCategory: (id: string, data: any) =>
    request<any>(`/inventory/categories/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteCategory: (id: string) =>
    request<any>(`/inventory/categories/${id}`, { method: 'DELETE' }),
  getLowStock: () => request<any>('/inventory/low-stock'),

  // Orders
  getOrders: (params?: Record<string, string>) => {
    const query = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<any>(`/orders${query}`);
  },
  getOrder: (id: string) => request<any>(`/orders/${id}`),
  createOrder: (data: any) =>
    request<any>('/orders', { method: 'POST', body: JSON.stringify(data) }),
  refundOrder: (id: string, data?: any) =>
    request<any>(`/orders/${id}/refund`, { method: 'POST', body: JSON.stringify(data || {}) }),
  cancelOrder: (id: string) =>
    request<any>(`/orders/${id}/cancel`, { method: 'POST' }),
  holdOrder: (id: string) =>
    request<any>(`/orders/${id}/hold`, { method: 'PUT' }),
  recallOrder: (id: string) =>
    request<any>(`/orders/${id}/recall`, { method: 'PUT' }),
  getHeldOrders: () => request<any>('/orders/held'),
  updateOrderStatus: (id: string, status: string) =>
    request<any>(`/orders/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) }),

  // Receipts
  getReceipt: (orderId: string) => request<any>(`/receipts/${orderId}`),

  // Audit
  getAuditEvents: (params?: Record<string, string>) => {
    const query = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<any>(`/audit${query}`);
  },

  // Customers
  getCustomers: (params?: Record<string, string>) => {
    const query = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<any>(`/customers${query}`);
  },
  getCustomer: (id: string) => request<any>(`/customers/${id}`),
  createCustomer: (data: any) =>
    request<any>('/customers', { method: 'POST', body: JSON.stringify(data) }),
  updateCustomer: (id: string, data: any) =>
    request<any>(`/customers/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteCustomer: (id: string) =>
    request<any>(`/customers/${id}`, { method: 'DELETE' }),

  // Registers
  getRegisters: () => request<any>('/registers'),
  createRegister: (data: any) =>
    request<any>('/registers', { method: 'POST', body: JSON.stringify(data) }),
  getRegisterSession: () => request<any>('/registers/session'),
  openRegister: (data: { registerId: string; openingCash: number }) =>
    request<any>('/registers/open', { method: 'POST', body: JSON.stringify(data) }),
  closeRegister: (data: { closingCash: number; notes?: string }) =>
    request<any>('/registers/close', { method: 'POST', body: JSON.stringify(data) }),

  // Locations
  getLocations: () => request<any>('/locations'),
  createLocation: (data: any) =>
    request<any>('/locations', { method: 'POST', body: JSON.stringify(data) }),
  updateLocation: (id: string, data: any) =>
    request<any>(`/locations/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteLocation: (id: string) =>
    request<any>(`/locations/${id}`, { method: 'DELETE' }),

  // Reports
  getTodayReport: () => request<any>('/reports/today'),
  getSalesReport: (params?: Record<string, string>) => {
    const query = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<any>(`/reports/sales${query}`);
  },
  getDailyReport: (params?: Record<string, string>) => {
    const query = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<any>(`/reports/daily${query}`);
  },
  getDrilldown: (params?: Record<string, string>) => {
    const query = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<any>(`/reports/drilldown${query}`);
  },
  getLaborReport: (params?: Record<string, string>) => {
    const query = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<any>(`/reports/labor${query}`);
  },
  getInventoryReport: () => request<any>('/reports/inventory'),

  // Settings
  getSettings: () => request<any>('/settings'),
  // Full ISO 4217 catalog served by the backend (source of truth for currencies).
  getCurrencies: () => request<any>('/settings/currencies'),
  updateSettings: (data: any) =>
    request<any>('/settings', { method: 'PUT', body: JSON.stringify(data) }),
  uploadSettingsMedia: (data: { name: string; dataUrl: string }) =>
    request<any>('/settings/media', { method: 'POST', body: JSON.stringify(data) }),
  deleteSettingsMedia: (mediaId: string) =>
    request<any>(`/settings/media/${mediaId}`, { method: 'DELETE' }),

  // Compliance center (privacy / GDPR / CCPA / PCI-DSS)
  getComplianceChecklist: () => request<any>('/compliance/checklist'),
  getComplianceConsent: () => request<any>('/compliance/consent'),
  saveComplianceConsent: (data: any) =>
    request<any>('/compliance/consent', { method: 'POST', body: JSON.stringify(data) }),
  getComplianceRequests: () => request<any>('/compliance/requests'),
  exportComplianceData: () => request<any>('/compliance/export', { method: 'POST' }),
  requestComplianceDeletion: (reason?: string) =>
    request<any>('/compliance/deletion-request', { method: 'POST', body: JSON.stringify({ reason }) }),
  // Data governance (§37): retention, purge, breach register, RoPA
  getRetention: () => request<any>('/compliance/retention'),
  updateRetention: (data: { dataRetentionDays?: number | null; legalHold?: boolean }) =>
    request<any>('/compliance/retention', { method: 'PUT', body: JSON.stringify(data) }),
  purgeRetainedData: () => request<any>('/compliance/purge', { method: 'POST' }),
  getBreaches: () => request<any>('/compliance/breaches'),
  createBreach: (data: { title: string; description?: string; severity?: string; affectedRecords?: number }) =>
    request<any>('/compliance/breaches', { method: 'POST', body: JSON.stringify(data) }),
  updateBreach: (id: string, data: any) =>
    request<any>(`/compliance/breaches/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  notifyBreach: (id: string, data: { regulator?: boolean; individuals?: boolean; note?: string }) =>
    request<any>(`/compliance/breaches/${id}/notify`, { method: 'POST', body: JSON.stringify(data) }),
  getRopa: () => request<any>('/compliance/ropa'),

  // Webhooks
  getWebhooks: () => request<any>('/webhooks'),
  createWebhook: (data: any) =>
    request<any>('/webhooks', { method: 'POST', body: JSON.stringify(data) }),
  updateWebhook: (id: string, data: any) =>
    request<any>(`/webhooks/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteWebhook: (id: string) =>
    request<any>(`/webhooks/${id}`, { method: 'DELETE' }),
  getWebhookEvents: () => request<any>('/webhooks/events'),

  // Loyalty
  getLoyaltyPrograms: () => request<any>('/loyalty/programs'),
  createLoyaltyProgram: (data: any) =>
    request<any>('/loyalty/programs', { method: 'POST', body: JSON.stringify(data) }),
  updateLoyaltyProgram: (id: string, data: any) =>
    request<any>(`/loyalty/programs/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  getLoyaltyTransactions: (customerId: string) =>
    request<any>(`/loyalty/customers/${customerId}/transactions`),
  earnLoyaltyPoints: (data: { customerId: string; points: number; reason?: string }) =>
    request<any>('/loyalty/earn', { method: 'POST', body: JSON.stringify(data) }),
  redeemLoyaltyPoints: (data: { customerId: string; points: number; reason?: string }) =>
    request<any>('/loyalty/redeem', { method: 'POST', body: JSON.stringify(data) }),

  // Restaurant
  getRestaurantTables: () => request<any>('/restaurant/tables'),
  createRestaurantTable: (data: any) =>
    request<any>('/restaurant/tables', { method: 'POST', body: JSON.stringify(data) }),
  updateTableStatus: (id: string, status: string) =>
    request<any>(`/restaurant/tables/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) }),
  deleteRestaurantTable: (id: string) =>
    request<any>(`/restaurant/tables/${id}`, { method: 'DELETE' }),
  getRestaurantOverview: () => request<any>('/restaurant/overview'),
  getReservations: (params?: Record<string, string>) => {
    const query = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<any>(`/restaurant/reservations${query}`);
  },
  createReservation: (data: any) =>
    request<any>('/restaurant/reservations', { method: 'POST', body: JSON.stringify(data) }),
  updateReservationStatus: (id: string, status: string) =>
    request<any>(`/restaurant/reservations/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) }),
  deleteReservation: (id: string) =>
    request<any>(`/restaurant/reservations/${id}`, { method: 'DELETE' }),
  getWaitlist: () => request<any>('/restaurant/waitlist'),
  addToWaitlist: (data: any) =>
    request<any>('/restaurant/waitlist', { method: 'POST', body: JSON.stringify(data) }),
  updateWaitlistStatus: (id: string, status: string) =>
    request<any>(`/restaurant/waitlist/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) }),

  // Accounting
  getAccountingEntries: (params?: Record<string, string>) => {
    const query = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<any>(`/accounting/entries${query}`);
  },
  createAccountingEntry: (data: any) =>
    request<any>('/accounting/entries', { method: 'POST', body: JSON.stringify(data) }),
  reconcileEntry: (id: string) =>
    request<any>(`/accounting/entries/${id}/reconcile`, { method: 'PUT' }),
  getAccountingSummary: (params?: Record<string, string>) => {
    const query = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<any>(`/accounting/summary${query}`);
  },

  // Employees
  getEmployees: () => request<any>('/employees'),
  getEmployee: (id: string) => request<any>(`/employees/${id}`),
  updateEmployee: (id: string, data: any) =>
    request<any>(`/employees/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  clockEmployee: (id: string, action: string) =>
    request<any>(`/employees/${id}/time`, { method: 'POST', body: JSON.stringify({ action }) }),
  getEmployeeTimeEntries: (id: string) =>
    request<any>(`/employees/${id}/time-entries`),

  // Suppliers
  getSuppliers: () => request<any>('/suppliers'),
  createSupplier: (data: any) =>
    request<any>('/suppliers', { method: 'POST', body: JSON.stringify(data) }),
  updateSupplier: (id: string, data: any) =>
    request<any>(`/suppliers/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteSupplier: (id: string) =>
    request<any>(`/suppliers/${id}`, { method: 'DELETE' }),

  // Purchasing
  getPurchaseOrders: () => request<any>('/purchasing/orders'),
  createPurchaseOrder: (data: any) =>
    request<any>('/purchasing/orders', { method: 'POST', body: JSON.stringify(data) }),
  receivePurchaseOrder: (id: string, items: any[]) =>
    request<any>(`/purchasing/orders/${id}/receive`, { method: 'POST', body: JSON.stringify({ items }) }),

  // AI Insights
  getAIInsights: () => request<any>('/ai/insights'),
  // Actionable suggestions (reorder/staffing/win-back) + one-click apply.
  getAISuggestions: () => request<any>('/ai/suggestions'),
  applyAIReorder: (payload?: { supplierId?: string; items?: { productId: string; quantity: number; unitCost?: number }[]; notes?: string }) =>
    request<any>('/ai/reorder/apply', { method: 'POST', body: JSON.stringify(payload || {}) }),

  // Payments
  // Active PSP config (publishable key / simulator flag) for checkout.
  getPaymentConfig: () => request<any>('/payments/config'),
  // Full global payment-methods catalog (optionally filtered by ?country=&channel=).
  getPaymentMethods: (params?: Record<string, string>) => {
    const query = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<any>(`/payments/methods${query}`);
  },
  getPayments: (params?: Record<string, string>) => {
    const query = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<any>(`/payments${query}`);
  },
  processPayment: (data: any) =>
    request<any>('/payments/process', { method: 'POST', body: JSON.stringify(data) }),
  voidPayment: (id: string) =>
    request<any>(`/payments/${id}/void`, { method: 'POST' }),
  refundPayment: (data: any) =>
    request<any>('/payments/refund', { method: 'POST', body: JSON.stringify(data) }),
  settlePayment: (id: string) =>
    request<any>(`/payments/${id}/settle`, { method: 'PUT' }),
  reconcilePayment: (id: string) =>
    request<any>(`/payments/${id}/reconcile`, { method: 'PUT' }),
  getRefunds: () => request<any>('/payments/refunds'),

  // Inventory Operations
  getTransfers: () => request<any>('/inventory-ops/transfers'),
  createTransfer: (data: any) =>
    request<any>('/inventory-ops/transfers', { method: 'POST', body: JSON.stringify(data) }),
  receiveTransfer: (id: string, items: any[]) =>
    request<any>(`/inventory-ops/transfers/${id}/receive`, { method: 'POST', body: JSON.stringify({ items }) }),
  getStockCounts: () => request<any>('/inventory-ops/counts'),
  createStockCount: (data: any) =>
    request<any>('/inventory-ops/counts', { method: 'POST', body: JSON.stringify(data) }),
  adjustStock: (data: any) =>
    request<any>('/inventory-ops/adjust', { method: 'POST', body: JSON.stringify(data) }),
  getInventoryMovements: (params?: Record<string, string>) => {
    const query = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<any>(`/inventory-ops/movements${query}`);
  },

  // Marketing
  getMarketingOverview: () => request<any>('/marketing/overview'),
  getPromotions: () => request<any>('/marketing/promotions'),
  createPromotion: (data: any) =>
    request<any>('/marketing/promotions', { method: 'POST', body: JSON.stringify(data) }),
  updatePromotion: (id: string, data: any) =>
    request<any>(`/marketing/promotions/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deletePromotion: (id: string) =>
    request<any>(`/marketing/promotions/${id}`, { method: 'DELETE' }),
  getCoupons: () => request<any>('/marketing/coupons'),
  createCoupon: (data: any) =>
    request<any>('/marketing/coupons', { method: 'POST', body: JSON.stringify(data) }),
  updateCoupon: (id: string, data: any) =>
    request<any>(`/marketing/coupons/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteCoupon: (id: string) =>
    request<any>(`/marketing/coupons/${id}`, { method: 'DELETE' }),
  redeemCoupon: (id: string) =>
    request<any>(`/marketing/coupons/${id}/redeem`, { method: 'POST' }),
  validateCoupon: (code: string, orderTotal?: number) =>
    request<any>('/marketing/coupons/validate', { method: 'POST', body: JSON.stringify({ code, orderTotal }) }),
  getCampaigns: () => request<any>('/marketing/campaigns'),
  createCampaign: (data: any) =>
    request<any>('/marketing/campaigns', { method: 'POST', body: JSON.stringify(data) }),
  updateCampaign: (id: string, data: any) =>
    request<any>(`/marketing/campaigns/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  launchCampaign: (id: string, segmentKey?: string) =>
    request<any>(`/marketing/campaigns/${id}/launch`, { method: 'POST', body: JSON.stringify({ segmentKey }) }),
  engageCampaign: (id: string, type: 'open' | 'convert') =>
    request<any>(`/marketing/campaigns/${id}/engage`, { method: 'POST', body: JSON.stringify({ type }) }),
  cancelCampaign: (id: string) =>
    request<any>(`/marketing/campaigns/${id}/cancel`, { method: 'POST' }),
  getSegments: () => request<any>('/marketing/segments'),

  // AI Copilot
  askCopilot: (question: string) =>
    request<any>('/copilot/ask', { method: 'POST', body: JSON.stringify({ question }) }),
  getForecast: () => request<any>('/copilot/forecast'),

  // Enterprise
  getRegions: () => request<any>('/enterprise/regions'),
  createRegion: (data: any) =>
    request<any>('/enterprise/regions', { method: 'POST', body: JSON.stringify(data) }),
  getWarehouses: () => request<any>('/enterprise/warehouses'),
  createWarehouse: (data: any) =>
    request<any>('/enterprise/warehouses', { method: 'POST', body: JSON.stringify(data) }),
  getEnterpriseOverview: () => request<any>('/enterprise/overview'),
  // Global region coverage — provision one region per UN geoscheme sub-region
  provisionGlobalRegions: () =>
    request<any>('/enterprise/regions/provision-global', { method: 'POST' }),
  getRegionCoverage: () => request<any>('/enterprise/regions/coverage'),

  // ── Retail Engine (§18) ──────────────────────────────────────
  // Gift Cards
  getGiftCards: (params?: Record<string, string>) => {
    const query = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<any>(`/retail/gift-cards${query}`);
  },
  createGiftCard: (data: any) =>
    request<any>('/retail/gift-cards', { method: 'POST', body: JSON.stringify(data) }),
  getGiftCard: (id: string) => request<any>(`/retail/gift-cards/${id}`),
  addGiftCardFunds: (id: string, amount: number) =>
    request<any>(`/retail/gift-cards/${id}/add-funds`, { method: 'POST', body: JSON.stringify({ amount }) }),
  activateGiftCard: (id: string) =>
    request<any>(`/retail/gift-cards/${id}/activate`, { method: 'POST' }),
  lookupGiftCard: (cardNumber: string) =>
    request<any>(`/retail/gift-cards/lookup?cardNumber=${encodeURIComponent(cardNumber)}`),
  redeemGiftCard: (id: string, amount: number) =>
    request<any>(`/retail/gift-cards/${id}/redeem`, { method: 'POST', body: JSON.stringify({ amount }) }),

  // Store Credit
  getStoreCredits: (params?: Record<string, string>) => {
    const query = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<any>(`/retail/store-credits${query}`);
  },
  issueStoreCredit: (data: any) =>
    request<any>('/retail/store-credits', { method: 'POST', body: JSON.stringify(data) }),
  redeemStoreCredit: (id: string, amount: number) =>
    request<any>(`/retail/store-credits/${id}/redeem`, { method: 'POST', body: JSON.stringify({ amount }) }),

  // Layaway
  getLayaways: (params?: Record<string, string>) => {
    const query = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<any>(`/retail/layaways${query}`);
  },
  createLayaway: (data: any) =>
    request<any>('/retail/layaways', { method: 'POST', body: JSON.stringify(data) }),
  payLayaway: (id: string, amount: number) =>
    request<any>(`/retail/layaways/${id}/pay`, { method: 'PUT', body: JSON.stringify({ amount }) }),
  cancelLayaway: (id: string, cancellationFee?: number) =>
    request<any>(`/retail/layaways/${id}/cancel`, { method: 'PUT', body: JSON.stringify({ cancellationFee }) }),

  // Exchanges
  processExchange: (data: any) =>
    request<any>('/retail/exchanges', { method: 'POST', body: JSON.stringify(data) }),

  // Suspended Carts
  getSuspendedCarts: () => request<any>('/retail/suspended-carts'),
  saveSuspendedCart: (data: any) =>
    request<any>('/retail/suspended-carts', { method: 'POST', body: JSON.stringify(data) }),
  resumeSuspendedCart: (id: string) =>
    request<any>(`/retail/suspended-carts/${id}/resume`, { method: 'POST' }),
  deleteSuspendedCart: (id: string) =>
    request<any>(`/retail/suspended-carts/${id}`, { method: 'DELETE' }),

  // ── Permissions / RBAC (§15) ─────────────────────────────────
  getRoles: () => request<any>('/permissions/roles'),
  createRole: (data: any) =>
    request<any>('/permissions/roles', { method: 'POST', body: JSON.stringify(data) }),
  updateRole: (id: string, data: any) =>
    request<any>(`/permissions/roles/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteRole: (id: string) =>
    request<any>(`/permissions/roles/${id}`, { method: 'DELETE' }),
  assignRolePermissions: (id: string, permissionIds: string[]) =>
    request<any>(`/permissions/roles/${id}/permissions`, { method: 'PUT', body: JSON.stringify({ permissionIds }) }),
  getPermissions: () => request<any>('/permissions'),
  seedPermissions: () =>
    request<any>('/permissions/seed', { method: 'POST' }),
  assignEmployeeRole: (employeeId: string, roleId: string) =>
    request<any>(`/permissions/employees/${employeeId}/role`, { method: 'PUT', body: JSON.stringify({ roleId }) }),
  checkPermission: (resource: string, action: string) =>
    request<any>(`/permissions/check?resource=${resource}&action=${action}`),

  // ── Device Management (§38) ──────────────────────────────────
  getDevices: () => request<any>('/devices'),
  registerDevice: (data: any) =>
    request<any>('/devices/register', { method: 'POST', body: JSON.stringify(data) }),
  getDevice: (id: string) => request<any>(`/devices/${id}`),
  assignDevice: (id: string, data: any) =>
    request<any>(`/devices/${id}/assign`, { method: 'PUT', body: JSON.stringify(data) }),
  updateDeviceStatus: (id: string, status: string) =>
    request<any>(`/devices/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) }),
  deviceHeartbeat: (id: string) =>
    request<any>(`/devices/${id}/heartbeat`, { method: 'POST' }),
  getDeviceSyncConfig: (id: string) => request<any>(`/devices/${id}/sync-config`),
  revokeDeviceCredential: (id: string) =>
    request<any>(`/devices/${id}/revoke`, { method: 'POST' }),
  getDeviceOverview: () => request<any>('/devices/overview'),

  // ── Enhanced Accounting (§31) ────────────────────────────────
  // Reconciliation
  generateDailyReconciliation: (date: string) =>
    request<any>('/accounting/reconcile/daily', { method: 'POST', body: JSON.stringify({ date }) }),
  confirmReconciliation: (id: string, actualBalance: number, notes?: string) =>
    request<any>(`/accounting/reconcile/${id}/confirm`, { method: 'PUT', body: JSON.stringify({ actualBalance, notes }) }),
  getReconciliationHistory: (params?: Record<string, string>) => {
    const query = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<any>(`/accounting/reconcile/history${query}`);
  },
  voidEntry: (id: string) =>
    request<any>(`/accounting/entries/${id}/void`, { method: 'POST' }),

  // Tax Report
  getTaxReport: (params?: Record<string, string>) => {
    const query = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<any>(`/accounting/tax-report${query}`);
  },

  // COGS & Profit Margins
  getCogsReport: (params?: Record<string, string>) => {
    const query = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<any>(`/accounting/cogs${query}`);
  },

  // Expenses
  getExpenses: (params?: Record<string, string>) => {
    const query = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<any>(`/accounting/expenses${query}`);
  },
  createExpense: (data: any) =>
    request<any>('/accounting/expenses', { method: 'POST', body: JSON.stringify(data) }),
  approveExpense: (id: string) =>
    request<any>(`/accounting/expenses/${id}/approve`, { method: 'PUT' }),

  // Invoices
  getInvoices: (params?: Record<string, string>) => {
    const query = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<any>(`/accounting/invoices${query}`);
  },
  createInvoice: (data: any) =>
    request<any>('/accounting/invoices', { method: 'POST', body: JSON.stringify(data) }),
  updateInvoiceStatus: (id: string, status: string) =>
    request<any>(`/accounting/invoices/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) }),

  // Profit & Loss
  getPnL: (params?: Record<string, string>) => {
    const query = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<any>(`/accounting/pnl${query}`);
  },

  // ── System / Observability (§39) ─────────────────────────────
  getSystemMetrics: () => request<any>('/system/metrics'),
  getObservability: () => request<any>('/system/observability'),
  getBackupConfig: () => request<any>('/system/backup-config'),
  getNFR: () => request<any>('/system/nfr'),

  // ── Commerce Hub (§13 Omnichannel / §48 Phase 3) ─────────────
  getCommerceOverview: () => request<any>('/commerce/overview'),

  // Sales channels
  getSalesChannels: () => request<any>('/commerce/channels'),
  createSalesChannel: (data: any) =>
    request<any>('/commerce/channels', { method: 'POST', body: JSON.stringify(data) }),
  updateSalesChannel: (id: string, data: any) =>
    request<any>(`/commerce/channels/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteSalesChannel: (id: string) =>
    request<any>(`/commerce/channels/${id}`, { method: 'DELETE' }),
  getChannelStats: (id: string) => request<any>(`/commerce/channels/${id}/stats`),

  // Online / omnichannel orders
  getCommerceOrders: (params?: Record<string, string>) => {
    const query = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<any>(`/commerce/orders${query}`);
  },
  createOnlineOrder: (data: any) =>
    request<any>('/commerce/orders', { method: 'POST', body: JSON.stringify(data) }),
  getCommerceOrder: (id: string) => request<any>(`/commerce/orders/${id}`),
  cancelCommerceOrder: (id: string) =>
    request<any>(`/commerce/orders/${id}/cancel`, { method: 'POST' }),

  // Fulfillment queue
  getFulfillmentQueue: (params?: Record<string, string>) => {
    const query = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<any>(`/commerce/fulfillment${query}`);
  },
  updateFulfillment: (id: string, data: any) =>
    request<any>(`/commerce/fulfillment/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  setFulfillmentStatus: (id: string, status: string) =>
    request<any>(`/commerce/fulfillment/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) }),

  // Pickup & curbside
  getPickupOrders: () => request<any>('/commerce/pickup'),
  markPickupReady: (id: string) =>
    request<any>(`/commerce/pickup/${id}/ready`, { method: 'POST' }),
  markPickupComplete: (id: string) =>
    request<any>(`/commerce/pickup/${id}/complete`, { method: 'POST' }),

  // Delivery
  getDeliveryZones: () => request<any>('/commerce/delivery/zones'),
  createDeliveryZone: (data: any) =>
    request<any>('/commerce/delivery/zones', { method: 'POST', body: JSON.stringify(data) }),
  updateDeliveryZone: (id: string, data: any) =>
    request<any>(`/commerce/delivery/zones/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteDeliveryZone: (id: string) =>
    request<any>(`/commerce/delivery/zones/${id}`, { method: 'DELETE' }),
  quoteDelivery: (data: any) =>
    request<any>('/commerce/delivery/quote', { method: 'POST', body: JSON.stringify(data) }),
  getDeliveries: () => request<any>('/commerce/deliveries'),
  dispatchDelivery: (id: string, data?: any) =>
    request<any>(`/commerce/deliveries/${id}/dispatch`, { method: 'POST', body: JSON.stringify(data || {}) }),
  markDelivered: (id: string) =>
    request<any>(`/commerce/deliveries/${id}/delivered`, { method: 'POST' }),

  // Marketplace / commerce integrations
  getCommerceIntegrations: () => request<any>('/commerce/integrations'),
  connectIntegration: (data: any) =>
    request<any>('/commerce/integrations', { method: 'POST', body: JSON.stringify(data) }),
  updateIntegration: (id: string, data: any) =>
    request<any>(`/commerce/integrations/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  disconnectIntegration: (id: string) =>
    request<any>(`/commerce/integrations/${id}`, { method: 'DELETE' }),
  syncIntegration: (id: string) =>
    request<any>(`/commerce/integrations/${id}/sync`, { method: 'POST' }),

  // Omnichannel inventory
  getOmnichannelInventory: (params?: Record<string, string>) => {
    const query = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<any>(`/commerce/inventory/omnichannel${query}`);
  },
  sourceFulfillment: (data: { productId: string; quantity?: number }) =>
    request<any>('/commerce/fulfillment/source', { method: 'POST', body: JSON.stringify(data) }),

  // ── Enterprise (multi-region / warehouses) ─────────────────
  updateRegion: (id: string, data: any) =>
    request<any>(`/enterprise/regions/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteRegion: (id: string) =>
    request<any>(`/enterprise/regions/${id}`, { method: 'DELETE' }),
  updateWarehouse: (id: string, data: any) =>
    request<any>(`/enterprise/warehouses/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteWarehouse: (id: string) =>
    request<any>(`/enterprise/warehouses/${id}`, { method: 'DELETE' }),
  assignLocationRegion: (locationId: string, regionId: string | null) =>
    request<any>(`/enterprise/locations/${locationId}/assign-region`, { method: 'PUT', body: JSON.stringify({ regionId }) }),

  // ── System health (§39) ────────────────────────────────────
  getSystemHealth: () => request<any>('/system/health'),

  // ── Developer Platform (§30 / §40 Phase 5) ─────────────────
  getApiKeys: () => request<any>('/developer/keys'),
  generateApiKey: (name: string) =>
    request<any>('/developer/keys/generate', { method: 'POST', body: JSON.stringify({ name }) }),
  registerOAuthApp: (data: { name: string; redirectUri: string; scopes?: string[] }) =>
    request<any>('/developer/oauth/register', { method: 'POST', body: JSON.stringify(data) }),
  getDeveloperIntegrations: () => request<any>('/developer/integrations'),
  connectDeveloperIntegration: (data: any) =>
    request<any>('/developer/integrations', { method: 'POST', body: JSON.stringify(data) }),
  disconnectDeveloperIntegration: (id: string) =>
    request<any>(`/developer/integrations/${id}/disconnect`, { method: 'PUT' }),
  getSandboxStatus: () => request<any>('/developer/sandbox/status'),
  resetSandbox: () => request<any>('/developer/sandbox/reset', { method: 'POST' }),
  testWebhook: (webhookId: string, event?: string) =>
    request<any>('/developer/test/webhook', { method: 'POST', body: JSON.stringify({ webhookId, event }) }),
  getMarketplace: () => request<any>('/developer/marketplace'),
  getDeveloperCatalog: () => request<any>('/developer/catalog'),
  getApiDocs: () => request<any>('/developer/docs'),

  // ── Product Catalog (§11) ──────────────────────────────────
  getCatalogOverview: () => request<any>('/catalog/overview'),
  // Brands
  getBrands: () => request<any>('/catalog/brands'),
  createBrand: (data: any) =>
    request<any>('/catalog/brands', { method: 'POST', body: JSON.stringify(data) }),
  updateBrand: (id: string, data: any) =>
    request<any>(`/catalog/brands/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteBrand: (id: string) => request<any>(`/catalog/brands/${id}`, { method: 'DELETE' }),
  // Tax rules
  getTaxRules: () => request<any>('/catalog/tax-rules'),
  createTaxRule: (data: any) =>
    request<any>('/catalog/tax-rules', { method: 'POST', body: JSON.stringify(data) }),
  updateTaxRule: (id: string, data: any) =>
    request<any>(`/catalog/tax-rules/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteTaxRule: (id: string) => request<any>(`/catalog/tax-rules/${id}`, { method: 'DELETE' }),
  // Variants
  getVariants: (productId: string) => request<any>(`/catalog/products/${productId}/variants`),
  createVariant: (data: any) =>
    request<any>('/catalog/variants', { method: 'POST', body: JSON.stringify(data) }),
  deleteVariant: (id: string) => request<any>(`/catalog/variants/${id}`, { method: 'DELETE' }),
  // Modifier groups & modifiers
  getModifierGroups: () => request<any>('/catalog/modifier-groups'),
  createModifierGroup: (data: any) =>
    request<any>('/catalog/modifier-groups', { method: 'POST', body: JSON.stringify(data) }),
  deleteModifierGroup: (id: string) => request<any>(`/catalog/modifier-groups/${id}`, { method: 'DELETE' }),
  getModifiers: (params?: Record<string, string>) => {
    const query = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<any>(`/catalog/modifiers${query}`);
  },
  createModifier: (data: any) =>
    request<any>('/catalog/modifiers', { method: 'POST', body: JSON.stringify(data) }),
  deleteModifier: (id: string) => request<any>(`/catalog/modifiers/${id}`, { method: 'DELETE' }),
  // Price lists
  getPriceLists: () => request<any>('/catalog/price-lists'),
  getPriceList: (id: string) => request<any>(`/catalog/price-lists/${id}`),
  createPriceList: (data: any) =>
    request<any>('/catalog/price-lists', { method: 'POST', body: JSON.stringify(data) }),
  setPriceListItem: (id: string, data: { productId: string; price: number }) =>
    request<any>(`/catalog/price-lists/${id}/items`, { method: 'POST', body: JSON.stringify(data) }),
  deletePriceList: (id: string) => request<any>(`/catalog/price-lists/${id}`, { method: 'DELETE' }),
  // Bundles
  getBundles: () => request<any>('/catalog/bundles'),
  createBundle: (data: any) =>
    request<any>('/catalog/bundles', { method: 'POST', body: JSON.stringify(data) }),
  deleteBundle: (id: string) => request<any>(`/catalog/bundles/${id}`, { method: 'DELETE' }),
  // Kits
  getKits: () => request<any>('/catalog/kits'),
  createKit: (data: any) =>
    request<any>('/catalog/kits', { method: 'POST', body: JSON.stringify(data) }),
  deleteKit: (id: string) => request<any>(`/catalog/kits/${id}`, { method: 'DELETE' }),
  // Composite products
  getComposites: () => request<any>('/catalog/composites'),
  createComposite: (data: any) =>
    request<any>('/catalog/composites', { method: 'POST', body: JSON.stringify(data) }),
  addCompositeOption: (id: string, data: any) =>
    request<any>(`/catalog/composites/${id}/options`, { method: 'POST', body: JSON.stringify(data) }),
  addCompositeOptionValue: (optionId: string, data: any) =>
    request<any>(`/catalog/options/${optionId}/values`, { method: 'POST', body: JSON.stringify(data) }),
  deleteComposite: (id: string) => request<any>(`/catalog/composites/${id}`, { method: 'DELETE' }),

  // ── Offline-first Sync Engine (§25 / §26) ──────────────────
  pushSyncTransactions: (transactions: any[]) =>
    request<any>('/sync/transactions', { method: 'POST', body: JSON.stringify({ transactions }) }),
  getSyncTransactions: (params?: Record<string, string>) => {
    const query = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<any>(`/sync/transactions${query}`);
  },
  getSyncStatus: () => request<any>('/sync/status'),
  getSyncConflicts: () => request<any>('/sync/conflicts'),
  resolveSyncConflict: (id: string) =>
    request<any>(`/sync/conflicts/${id}/resolve`, { method: 'POST' }),

  // ── Notifications (§5) ─────────────────────────────────────
  getNotifications: (params?: Record<string, string>) => {
    const query = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<any>(`/notifications${query}`);
  },
  getUnreadCount: () => request<any>('/notifications/unread-count'),
  getNotificationPreferences: () => request<any>('/notifications/preferences'),
  updateNotificationPreferences: (data: any) =>
    request<any>('/notifications/preferences', { method: 'PUT', body: JSON.stringify(data) }),
  createNotification: (data: any) =>
    request<any>('/notifications', { method: 'POST', body: JSON.stringify(data) }),
  markNotificationRead: (id: string) =>
    request<any>(`/notifications/${id}/read`, { method: 'POST' }),
  markAllNotificationsRead: () =>
    request<any>('/notifications/read-all', { method: 'POST' }),
  deleteNotification: (id: string) =>
    request<any>(`/notifications/${id}`, { method: 'DELETE' }),

  // ── Inventory Batches / Lots / Serials (§12) ───────────────
  getBatches: (params?: Record<string, string>) => {
    const query = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<any>(`/inventory-ops/batches${query}`);
  },
  createBatch: (data: any) =>
    request<any>('/inventory-ops/batches', { method: 'POST', body: JSON.stringify(data) }),
  consumeBatch: (id: string, data: { quantity: number; notes?: string }) =>
    request<any>(`/inventory-ops/batches/${id}/consume`, { method: 'POST', body: JSON.stringify(data) }),
  setBatchStatus: (id: string, status: string) =>
    request<any>(`/inventory-ops/batches/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) }),
  getSerials: (params?: Record<string, string>) => {
    const query = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<any>(`/inventory-ops/serials${query}`);
  },
  createSerials: (data: any) =>
    request<any>('/inventory-ops/serials', { method: 'POST', body: JSON.stringify(data) }),
  setSerialStatus: (id: string, data: { status: string; soldOrderItemId?: string }) =>
    request<any>(`/inventory-ops/serials/${id}/status`, { method: 'PUT', body: JSON.stringify(data) }),

  // ── Chargebacks / Disputes / Payouts / Settlements (§10) ───
  getChargebacks: () => request<any>('/payments/chargebacks'),
  createChargeback: (data: { paymentId: string; amount: number; reason?: string }) =>
    request<any>('/payments/chargebacks', { method: 'POST', body: JSON.stringify(data) }),
  resolveChargeback: (id: string, status: string) =>
    request<any>(`/payments/chargebacks/${id}/resolve`, { method: 'PUT', body: JSON.stringify({ status }) }),
  getDisputes: () => request<any>('/payments/disputes'),
  createDispute: (data: { paymentId: string; amount: number; reason?: string }) =>
    request<any>('/payments/disputes', { method: 'POST', body: JSON.stringify(data) }),
  resolveDispute: (id: string, status: string) =>
    request<any>(`/payments/disputes/${id}/resolve`, { method: 'PUT', body: JSON.stringify({ status }) }),
  getPayouts: () => request<any>('/payments/payouts'),
  createPayout: (data: { amount: number; currency?: string; paymentId?: string; scheduledAt?: string }) =>
    request<any>('/payments/payouts', { method: 'POST', body: JSON.stringify(data) }),
  setPayoutStatus: (id: string, status: string) =>
    request<any>(`/payments/payouts/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) }),
  getSettlements: () => request<any>('/payments/settlements'),

  // ── Payment Links (§9) ─────────────────────────────────────
  getPaymentLinks: () => request<any>('/payment-links'),
  createPaymentLink: (data: { amount: number; currency?: string; description?: string; customerId?: string; orderId?: string; maxPayments?: number; expiresAt?: string }) =>
    request<any>('/payment-links', { method: 'POST', body: JSON.stringify(data) }),
  getPaymentLink: (id: string) => request<any>(`/payment-links/${id}`),
  cancelPaymentLink: (id: string) =>
    request<any>(`/payment-links/${id}/cancel`, { method: 'PUT' }),
  deletePaymentLink: (id: string) =>
    request<any>(`/payment-links/${id}`, { method: 'DELETE' }),
  // Public (unauthenticated) checkout — used by the /pay/:token page.
  getPublicPaymentLink: (token: string) => request<any>(`/payment-links/public/${token}`),
  payPublicPaymentLink: (token: string, data: { paymentMethodId?: string; method?: string }) =>
    request<any>(`/payment-links/public/${token}/pay`, { method: 'POST', body: JSON.stringify(data) }),

  // ── Fraud Detection (§37) ──────────────────────────────────
  getFraudAlerts: (params?: Record<string, string>) => {
    const query = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<any>(`/fraud${query}`);
  },
  getFraudStats: () => request<any>('/fraud/stats'),
  getFraudAlert: (id: string) => request<any>(`/fraud/${id}`),
  updateFraudAlertStatus: (id: string, status: string, note?: string) =>
    request<any>(`/fraud/${id}/status`, { method: 'PUT', body: JSON.stringify({ status, note }) }),

  // ── Restaurant extensions (§17): QR ordering, catering, food-cost ──
  getTableQrToken: (tableId: string) => request<any>(`/restaurant/tables/${tableId}/qr-token`),
  createTableQrToken: (tableId: string) =>
    request<any>(`/restaurant/tables/${tableId}/qr-token`, { method: 'POST' }),
  revokeTableQrToken: (tableId: string) =>
    request<any>(`/restaurant/tables/${tableId}/qr-token`, { method: 'DELETE' }),
  getCateringOrders: (params?: Record<string, string>) => {
    const query = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<any>(`/restaurant/catering${query}`);
  },
  createCateringOrder: (data: any) =>
    request<any>('/restaurant/catering', { method: 'POST', body: JSON.stringify(data) }),
  getCateringOrder: (id: string) => request<any>(`/restaurant/catering/${id}`),
  updateCateringStatus: (id: string, status: string) =>
    request<any>(`/restaurant/catering/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) }),
  getFoodCostAnalysis: (target?: number) =>
    request<any>(`/restaurant/menu/food-cost${target ? `?target=${target}` : ''}`),

  // Public guest QR ordering (no auth) — used by the /order/:token guest page.
  getPublicQrTable: (token: string) => request<any>(`/public/qr/${token}`),
  submitPublicQrOrder: (token: string, data: { items: { productId: string; quantity: number; notes?: string }[]; customerName?: string; phone?: string }) =>
    request<any>(`/public/qr/${token}/order`, { method: 'POST', body: JSON.stringify(data) }),
  getPublicQrOrder: (token: string, orderId: string) =>
    request<any>(`/public/qr/${token}/order/${orderId}`),

  // ── Web Push (VAPID) ───────────────────────────────────────
  getPushConfig: () => request<any>('/push/config'),
  subscribePush: (data: { endpoint: string; keys: { p256dh: string; auth: string }; userAgent?: string }) =>
    request<any>('/push/subscribe', { method: 'POST', body: JSON.stringify(data) }),
  unsubscribePush: (endpoint: string) =>
    request<any>('/push/subscribe', { method: 'DELETE', body: JSON.stringify({ endpoint }) }),
  getPushSubscriptions: () => request<any>('/push/subscriptions'),
  sendTestPush: (data?: { title?: string; body?: string }) =>
    request<any>('/push/test', { method: 'POST', body: JSON.stringify(data || {}) }),
  generateVapidKeys: () => request<any>('/push/vapid-keys'),

  // ── Real-time (SSE) status ─────────────────────────────────
  getRealtimeStatus: () => request<any>('/realtime/status'),

  // ── AI analytics depth (forecast / anomalies / RFM) ────────
  getAIForecast: (params?: Record<string, string>) => {
    const query = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<any>(`/ai/forecast${query}`);
  },
  getAIAnomalies: (params?: Record<string, string>) => {
    const query = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<any>(`/ai/anomalies${query}`);
  },
  getAISegments: (params?: Record<string, string>) => {
    const query = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<any>(`/ai/segments${query}`);
  },
  getCopilotSummary: (metrics?: any) =>
    request<any>('/ai/copilot-summary', { method: 'POST', body: JSON.stringify({ metrics }) }),

  // ── Media asset library (S3/DB) ────────────────────────────
  getMediaBackend: () => request<any>('/media/backend'),
  getMedia: (params?: Record<string, string>) => {
    const query = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<any>(`/media${query}`);
  },
  uploadMedia: (data: { name?: string; mimeType: string; dataUrl: string; folder?: string; width?: number; height?: number }) =>
    request<any>('/media', { method: 'POST', body: JSON.stringify(data) }),
  getMediaAsset: (id: string) => request<any>(`/media/${id}`),
  deleteMediaAsset: (id: string) => request<any>(`/media/${id}`, { method: 'DELETE' }),
};
