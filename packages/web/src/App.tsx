import { useEffect, lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/authStore';
import Layout from './components/Layout';

// ─── Route-level code-splitting ─────────────────────────────────────────────
// Every page is a lazily-imported chunk, so the initial JS payload contains only
// the shell (router + Layout + auth store) plus whichever route paints first.
// Vite/Rollup emits one chunk per `import()` below and fetches it on navigation,
// which keeps the first-load bundle small and lets each page cache independently.
//
// Auth (unauthenticated shell)
const LoginPage = lazy(() => import('./pages/LoginPage'));
const RegisterPage = lazy(() => import('./pages/RegisterPage'));
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage'));
const LegalPage = lazy(() => import('./pages/LegalPage'));
// Core operations
const POSPage = lazy(() => import('./pages/POSPage'));
const OrdersPage = lazy(() => import('./pages/OrdersPage'));
const InventoryPage = lazy(() => import('./pages/InventoryPage'));
const CustomersPage = lazy(() => import('./pages/CustomersPage'));
const RegistersPage = lazy(() => import('./pages/RegistersPage'));
const ReportsPage = lazy(() => import('./pages/ReportsPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const ReceiptPage = lazy(() => import('./pages/ReceiptPage'));
const AuditLogPage = lazy(() => import('./pages/AuditLogPage'));
// Verticals & back office
const RestaurantPage = lazy(() => import('./pages/RestaurantPage'));
const LoyaltyPage = lazy(() => import('./pages/LoyaltyPage'));
const AccountingPage = lazy(() => import('./pages/AccountingPage'));
const EmployeesPage = lazy(() => import('./pages/EmployeesPage'));
const SuppliersPage = lazy(() => import('./pages/SuppliersPage'));
const PurchasingPage = lazy(() => import('./pages/PurchasingPage'));
const RetailPage = lazy(() => import('./pages/RetailPage'));
const CommercePage = lazy(() => import('./pages/CommercePage'));
const CatalogPage = lazy(() => import('./pages/CatalogPage'));
// Platform, integrations & intelligence
const WebhooksPage = lazy(() => import('./pages/WebhooksPage'));
const AIInsightsPage = lazy(() => import('./pages/AIInsightsPage'));
const PaymentsPage = lazy(() => import('./pages/PaymentsPage'));
const MarketingPage = lazy(() => import('./pages/MarketingPage'));
const CopilotPage = lazy(() => import('./pages/CopilotPage'));
const TransfersPage = lazy(() => import('./pages/TransfersPage'));
const DevicesPage = lazy(() => import('./pages/DevicesPage'));
const HardwarePage = lazy(() => import('./pages/HardwarePage'));
const PermissionsPage = lazy(() => import('./pages/PermissionsPage'));
const SyncPage = lazy(() => import('./pages/SyncPage'));
const NotificationsPage = lazy(() => import('./pages/NotificationsPage'));
// Enterprise, compliance & system
const SystemPage = lazy(() => import('./pages/SystemPage'));
const EnterprisePage = lazy(() => import('./pages/EnterprisePage'));
const DeveloperPage = lazy(() => import('./pages/DeveloperPage'));
const CompliancePage = lazy(() => import('./pages/CompliancePage'));

/** Centered spinner shown while a lazy route chunk is being fetched. */
function RouteFallback() {
  return (
    <div className="flex items-center justify-center h-64" role="status" aria-live="polite">
      <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}

function App() {
  const { isAuthenticated, loadFromStorage } = useAuthStore();

  useEffect(() => {
    loadFromStorage();
  }, [loadFromStorage]);

  if (!isAuthenticated) {
    return (
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/legal/:doc" element={<LegalPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </Suspense>
    );
  }

  return (
    <Layout>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/pos" element={<POSPage />} />
          <Route path="/orders" element={<OrdersPage />} />
          <Route path="/inventory" element={<InventoryPage />} />
          <Route path="/customers" element={<CustomersPage />} />
          <Route path="/registers" element={<RegistersPage />} />
          <Route path="/restaurant" element={<RestaurantPage />} />
          <Route path="/employees" element={<EmployeesPage />} />
          <Route path="/suppliers" element={<SuppliersPage />} />
          <Route path="/purchasing" element={<PurchasingPage />} />
          <Route path="/loyalty" element={<LoyaltyPage />} />
          <Route path="/accounting" element={<AccountingPage />} />
          <Route path="/webhooks" element={<WebhooksPage />} />
          <Route path="/ai" element={<AIInsightsPage />} />
          <Route path="/payments" element={<PaymentsPage />} />
          <Route path="/marketing" element={<MarketingPage />} />
          <Route path="/copilot" element={<CopilotPage />} />
          <Route path="/transfers" element={<TransfersPage />} />
          <Route path="/devices" element={<DevicesPage />} />
          <Route path="/hardware" element={<HardwarePage />} />
          <Route path="/permissions" element={<PermissionsPage />} />
          <Route path="/retail" element={<RetailPage />} />
          <Route path="/commerce" element={<CommercePage />} />
          <Route path="/catalog" element={<CatalogPage />} />
          <Route path="/sync" element={<SyncPage />} />
          <Route path="/enterprise" element={<EnterprisePage />} />
          <Route path="/developer" element={<DeveloperPage />} />
          <Route path="/system" element={<SystemPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/audit" element={<AuditLogPage />} />
          <Route path="/receipt/:orderId" element={<ReceiptPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/compliance" element={<CompliancePage />} />
          <Route path="/legal/:doc" element={<LegalPage />} />
          <Route path="*" element={<Navigate to="/pos" replace />} />
        </Routes>
      </Suspense>
    </Layout>
  );
}

export default App;
