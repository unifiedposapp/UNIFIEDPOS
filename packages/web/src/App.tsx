import { useEffect, lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
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
// §9 payment links, §17 restaurant ops, §12 AI depth, §37 fraud, media
const PaymentLinksPage = lazy(() => import('./pages/PaymentLinksPage'));
const RestaurantOpsPage = lazy(() => import('./pages/RestaurantOpsPage'));
const AIAnalyticsPage = lazy(() => import('./pages/AIAnalyticsPage'));
const FraudPage = lazy(() => import('./pages/FraudPage'));
const MediaPage = lazy(() => import('./pages/MediaPage'));
// Public, unauthenticated guest pages (payment checkout + scan-to-order)
const PayLinkPage = lazy(() => import('./pages/PayLinkPage'));
const GuestOrderPage = lazy(() => import('./pages/GuestOrderPage'));
// Global-expansion surfaces: fiscal, rails, agentic ops, verticals, finance,
// agent commerce, mesh, franchise, ecosystem, benchmarking
const FiscalizationPage = lazy(() => import('./pages/FiscalizationPage'));
const RailsPage = lazy(() => import('./pages/RailsPage'));
const AgentOpsPage = lazy(() => import('./pages/AgentOpsPage'));
const VerticalsPage = lazy(() => import('./pages/VerticalsPage'));
const FinancePage = lazy(() => import('./pages/FinancePage'));
const AgentStorefrontPage = lazy(() => import('./pages/AgentStorefrontPage'));
const MeshPage = lazy(() => import('./pages/MeshPage'));
const FranchisePage = lazy(() => import('./pages/FranchisePage'));
const AppsPage = lazy(() => import('./pages/AppsPage'));
const BenchmarkPage = lazy(() => import('./pages/BenchmarkPage'));

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
  const location = useLocation();

  useEffect(() => {
    loadFromStorage();
  }, [loadFromStorage]);

  // Public guest surfaces (§9 payment-link checkout, §17 scan-to-order) render
  // regardless of auth state and never mount the authenticated shell — a customer
  // scanning a QR code or clicking a pay link has no account in this system.
  if (/^\/(pay|order)\//.test(location.pathname)) {
    return (
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/pay/:token" element={<PayLinkPage />} />
          <Route path="/order/:token" element={<GuestOrderPage />} />
        </Routes>
      </Suspense>
    );
  }

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
          <Route path="/restaurant-ops" element={<RestaurantOpsPage />} />
          <Route path="/employees" element={<EmployeesPage />} />
          <Route path="/suppliers" element={<SuppliersPage />} />
          <Route path="/purchasing" element={<PurchasingPage />} />
          <Route path="/loyalty" element={<LoyaltyPage />} />
          <Route path="/accounting" element={<AccountingPage />} />
          <Route path="/webhooks" element={<WebhooksPage />} />
          <Route path="/ai" element={<AIInsightsPage />} />
          <Route path="/analytics" element={<AIAnalyticsPage />} />
          <Route path="/payments" element={<PaymentsPage />} />
          <Route path="/payment-links" element={<PaymentLinksPage />} />
          <Route path="/fraud" element={<FraudPage />} />
          <Route path="/media" element={<MediaPage />} />
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
          <Route path="/fiscalization" element={<FiscalizationPage />} />
          <Route path="/rails" element={<RailsPage />} />
          <Route path="/agent-ops" element={<AgentOpsPage />} />
          <Route path="/verticals" element={<VerticalsPage />} />
          <Route path="/finance" element={<FinancePage />} />
          <Route path="/agents" element={<AgentStorefrontPage />} />
          <Route path="/mesh" element={<MeshPage />} />
          <Route path="/franchise" element={<FranchisePage />} />
          <Route path="/apps" element={<AppsPage />} />
          <Route path="/benchmark" element={<BenchmarkPage />} />
          <Route path="/legal/:doc" element={<LegalPage />} />
          <Route path="*" element={<Navigate to="/pos" replace />} />
        </Routes>
      </Suspense>
    </Layout>
  );
}

export default App;
