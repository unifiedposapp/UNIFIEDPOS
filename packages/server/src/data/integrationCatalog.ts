// ═══════════════════════════════════════════════════════════════
// INTEGRATION / MARKETPLACE CATALOG (§30 Developer Platform)
// ───────────────────────────────────────────────────────────────
// A comprehensive, category-grouped registry of the platforms a
// business can connect to. Drives BOTH the App Marketplace and the
// Integrations "connect a provider" picker so no important
// configuration/platform is missing.
//
// Each provider carries the config fields required to connect it,
// so the UI can render the right inputs per platform.
// ═══════════════════════════════════════════════════════════════

export interface IntegrationProvider {
  id: string;          // stable slug used as `provider` on IntegrationConnection
  name: string;
  category: string;    // one of INTEGRATION_CATEGORIES
  description: string;
  icon: string;        // lucide icon name (best-effort) for UI display
}

// Canonical category ordering (also used for grouping in the UI).
export const INTEGRATION_CATEGORIES: string[] = [
  'PAYMENT',
  'ACCOUNTING',
  'ECOMMERCE',
  'MARKETPLACE',
  'DELIVERY',
  'SHIPPING',
  'MARKETING',
  'COMMUNICATION',
  'AUTOMATION',
  'CRM',
  'ANALYTICS',
  'LOYALTY',
  'HR_PAYROLL',
  'TAX_COMPLIANCE',
  'ERP_INVENTORY',
  'SOCIAL',
  'RESERVATIONS',
  'IDENTITY',
  'SUPPORT',
  'BANKING',
];

// Config fields required per category (used to render connect forms).
export const CATEGORY_CONFIG_FIELDS: Record<string, string[]> = {
  PAYMENT: ['apiKey', 'publishableKey', 'webhookSecret'],
  ACCOUNTING: ['apiKey', 'companyRealm', 'refreshToken'],
  ECOMMERCE: ['storeUrl', 'accessToken', 'apiKey'],
  MARKETPLACE: ['sellerId', 'apiKey', 'refreshToken'],
  DELIVERY: ['apiKey', 'storeSlug', 'webhookSecret'],
  SHIPPING: ['apiKey', 'userId', 'carrierAccount'],
  MARKETING: ['apiKey', 'audienceId', 'accessToken'],
  COMMUNICATION: ['accountSid', 'authToken', 'apiKey'],
  AUTOMATION: ['apiKey', 'webhookUrl'],
  CRM: ['apiKey', 'portalId', 'accessToken'],
  ANALYTICS: ['trackingId', 'apiKey', 'workspace'],
  LOYALTY: ['apiKey', 'storeId', 'accessToken'],
  HR_PAYROLL: ['apiKey', 'companySlug', 'accessToken'],
  TAX_COMPLIANCE: ['apiKey', 'companyCode', 'licenseKey'],
  ERP_INVENTORY: ['apiKey', 'orgId', 'accessToken'],
  SOCIAL: ['pageId', 'accessToken', 'apiKey'],
  RESERVATIONS: ['apiKey', 'venueId', 'accessToken'],
  IDENTITY: ['domain', 'clientId', 'clientSecret'],
  SUPPORT: ['apiKey', 'subdomain', 'accessToken'],
  BANKING: ['apiKey', 'institutionId', 'accessToken'],
};

// ── The catalog ────────────────────────────────────────────────
export const INTEGRATION_PROVIDERS: IntegrationProvider[] = [
  // PAYMENT
  { id: 'stripe', name: 'Stripe', category: 'PAYMENT', description: 'Cards, wallets & online payments', icon: 'credit-card' },
  { id: 'square', name: 'Square', category: 'PAYMENT', description: 'In-person & online payments', icon: 'credit-card' },
  { id: 'paypal', name: 'PayPal', category: 'PAYMENT', description: 'Wallet, pay-later & checkout', icon: 'wallet' },
  { id: 'adyen', name: 'Adyen', category: 'PAYMENT', description: 'Global enterprise payments', icon: 'credit-card' },
  { id: 'braintree', name: 'Braintree', category: 'PAYMENT', description: 'Payments by PayPal', icon: 'credit-card' },
  { id: 'authorize-net', name: 'Authorize.Net', category: 'PAYMENT', description: 'Card processing gateway', icon: 'credit-card' },
  { id: 'worldpay', name: 'Worldpay', category: 'PAYMENT', description: 'Omnichannel acquiring', icon: 'credit-card' },
  { id: 'checkout-com', name: 'Checkout.com', category: 'PAYMENT', description: 'Digital payments platform', icon: 'credit-card' },
  { id: 'klarna', name: 'Klarna', category: 'PAYMENT', description: 'Buy now, pay later', icon: 'badge-dollar-sign' },
  { id: 'afterpay', name: 'Afterpay', category: 'PAYMENT', description: 'Installment payments', icon: 'badge-dollar-sign' },
  { id: 'm-pesa', name: 'M-Pesa', category: 'PAYMENT', description: 'Mobile money (Africa)', icon: 'smartphone' },
  { id: 'paystack', name: 'Paystack', category: 'PAYMENT', description: 'Payments for Africa', icon: 'wallet' },
  { id: 'flutterwave', name: 'Flutterwave', category: 'PAYMENT', description: 'Pan-African payments', icon: 'wallet' },
  { id: 'razorpay', name: 'Razorpay', category: 'PAYMENT', description: 'Payments for India', icon: 'wallet' },
  { id: 'mercadopago', name: 'Mercado Pago', category: 'PAYMENT', description: 'Payments for LatAm', icon: 'wallet' },
  { id: 'alipay', name: 'Alipay', category: 'PAYMENT', description: 'Mobile payments (China)', icon: 'smartphone' },
  { id: 'wechat-pay', name: 'WeChat Pay', category: 'PAYMENT', description: 'Mobile payments (China)', icon: 'smartphone' },

  // ACCOUNTING
  { id: 'quickbooks', name: 'QuickBooks', category: 'ACCOUNTING', description: 'Sync accounting & ledger', icon: 'calculator' },
  { id: 'xero', name: 'Xero', category: 'ACCOUNTING', description: 'Cloud accounting', icon: 'file-text' },
  { id: 'sage', name: 'Sage', category: 'ACCOUNTING', description: 'Business accounting suite', icon: 'calculator' },
  { id: 'freshbooks', name: 'FreshBooks', category: 'ACCOUNTING', description: 'Invoicing & accounting', icon: 'receipt' },
  { id: 'zoho-books', name: 'Zoho Books', category: 'ACCOUNTING', description: 'Online accounting', icon: 'book-open' },
  { id: 'wave', name: 'Wave', category: 'ACCOUNTING', description: 'Free accounting & invoices', icon: 'file-text' },
  { id: 'netsuite-accounting', name: 'NetSuite ERP', category: 'ACCOUNTING', description: 'Cloud ERP financials', icon: 'database' },

  // ECOMMERCE
  { id: 'shopify', name: 'Shopify', category: 'ECOMMERCE', description: 'Sync online storefront', icon: 'shopping-bag' },
  { id: 'woocommerce', name: 'WooCommerce', category: 'ECOMMERCE', description: 'WordPress commerce', icon: 'shopping-cart' },
  { id: 'bigcommerce', name: 'BigCommerce', category: 'ECOMMERCE', description: 'SaaS ecommerce platform', icon: 'shopping-bag' },
  { id: 'magento', name: 'Adobe Commerce', category: 'ECOMMERCE', description: 'Magento storefront', icon: 'store' },
  { id: 'wix', name: 'Wix Stores', category: 'ECOMMERCE', description: 'Wix ecommerce', icon: 'store' },
  { id: 'squarespace', name: 'Squarespace', category: 'ECOMMERCE', description: 'Squarespace commerce', icon: 'store' },
  { id: 'prestashop', name: 'PrestaShop', category: 'ECOMMERCE', description: 'Open-source store', icon: 'shopping-bag' },
  { id: 'ecwid', name: 'Ecwid', category: 'ECOMMERCE', description: 'Embeddable storefront', icon: 'shopping-bag' },

  // MARKETPLACE
  { id: 'amazon', name: 'Amazon', category: 'MARKETPLACE', description: 'Selling Partner API', icon: 'package' },
  { id: 'ebay', name: 'eBay', category: 'MARKETPLACE', description: 'Listings & orders', icon: 'tag' },
  { id: 'etsy', name: 'Etsy', category: 'MARKETPLACE', description: 'Handmade marketplace', icon: 'gem' },
  { id: 'walmart', name: 'Walmart', category: 'MARKETPLACE', description: 'Marketplace seller', icon: 'store' },
  { id: 'aliexpress', name: 'AliExpress', category: 'MARKETPLACE', description: 'Global marketplace', icon: 'globe' },
  { id: 'alibaba', name: 'Alibaba', category: 'MARKETPLACE', description: 'B2B wholesale', icon: 'boxes' },
  { id: 'mercadolibre', name: 'Mercado Libre', category: 'MARKETPLACE', description: 'LatAm marketplace', icon: 'globe' },
  { id: 'rakuten', name: 'Rakuten', category: 'MARKETPLACE', description: 'Japan marketplace', icon: 'globe' },
  { id: 'jumia', name: 'Jumia', category: 'MARKETPLACE', description: 'Africa marketplace', icon: 'globe' },
  { id: 'flipkart', name: 'Flipkart', category: 'MARKETPLACE', description: 'India marketplace', icon: 'globe' },

  // DELIVERY
  { id: 'doordash', name: 'DoorDash', category: 'DELIVERY', description: 'Delivery & drive', icon: 'bike' },
  { id: 'uber-eats', name: 'Uber Eats', category: 'DELIVERY', description: 'Food delivery', icon: 'utensils' },
  { id: 'grubhub', name: 'Grubhub', category: 'DELIVERY', description: 'Food delivery', icon: 'utensils' },
  { id: 'deliveroo', name: 'Deliveroo', category: 'DELIVERY', description: 'Delivery (UK/EU)', icon: 'bike' },
  { id: 'just-eat', name: 'Just Eat', category: 'DELIVERY', description: 'Food ordering', icon: 'utensils' },
  { id: 'zomato', name: 'Zomato', category: 'DELIVERY', description: 'Food delivery (India)', icon: 'utensils' },
  { id: 'rappi', name: 'Rappi', category: 'DELIVERY', description: 'Delivery (LatAm)', icon: 'bike' },
  { id: 'talabat', name: 'Talabat', category: 'DELIVERY', description: 'Delivery (MENA)', icon: 'bike' },
  { id: 'glovo', name: 'Glovo', category: 'DELIVERY', description: 'On-demand delivery', icon: 'bike' },

  // SHIPPING
  { id: 'shipstation', name: 'ShipStation', category: 'SHIPPING', description: 'Multi-carrier shipping', icon: 'truck' },
  { id: 'shippo', name: 'Shippo', category: 'SHIPPING', description: 'Shipping API & labels', icon: 'package' },
  { id: 'easypost', name: 'EasyPost', category: 'SHIPPING', description: 'Shipping & tracking', icon: 'package' },
  { id: 'fedex', name: 'FedEx', category: 'SHIPPING', description: 'Rates, labels, tracking', icon: 'truck' },
  { id: 'ups', name: 'UPS', category: 'SHIPPING', description: 'Rates, labels, tracking', icon: 'truck' },
  { id: 'dhl', name: 'DHL', category: 'SHIPPING', description: 'International shipping', icon: 'plane' },
  { id: 'usps', name: 'USPS', category: 'SHIPPING', description: 'US postal shipping', icon: 'mail' },

  // MARKETING
  { id: 'mailchimp', name: 'Mailchimp', category: 'MARKETING', description: 'Email marketing', icon: 'mail' },
  { id: 'klaviyo', name: 'Klaviyo', category: 'MARKETING', description: 'Email & SMS marketing', icon: 'mail' },
  { id: 'hubspot-marketing', name: 'HubSpot Marketing', category: 'MARKETING', description: 'Campaigns & automation', icon: 'megaphone' },
  { id: 'constant-contact', name: 'Constant Contact', category: 'MARKETING', description: 'Email campaigns', icon: 'mail' },
  { id: 'brevo', name: 'Brevo (Sendinblue)', category: 'MARKETING', description: 'Email, SMS & CRM', icon: 'mail' },
  { id: 'activecampaign', name: 'ActiveCampaign', category: 'MARKETING', description: 'Marketing automation', icon: 'megaphone' },
  { id: 'google-ads', name: 'Google Ads', category: 'MARKETING', description: 'Search & display ads', icon: 'target' },
  { id: 'meta-ads', name: 'Meta Ads', category: 'MARKETING', description: 'Facebook & Instagram ads', icon: 'target' },
  { id: 'tiktok-ads', name: 'TikTok Ads', category: 'MARKETING', description: 'Short-video ads', icon: 'target' },

  // COMMUNICATION
  { id: 'twilio', name: 'Twilio', category: 'COMMUNICATION', description: 'SMS & voice messaging', icon: 'message-square' },
  { id: 'whatsapp-business', name: 'WhatsApp Business', category: 'COMMUNICATION', description: 'Business messaging', icon: 'message-circle' },
  { id: 'slack', name: 'Slack', category: 'COMMUNICATION', description: 'Team notifications', icon: 'hash' },
  { id: 'microsoft-teams', name: 'Microsoft Teams', category: 'COMMUNICATION', description: 'Team notifications', icon: 'users' },
  { id: 'sendgrid', name: 'SendGrid', category: 'COMMUNICATION', description: 'Transactional email', icon: 'send' },
  { id: 'mailgun', name: 'Mailgun', category: 'COMMUNICATION', description: 'Email sending API', icon: 'send' },
  { id: 'telegram', name: 'Telegram', category: 'COMMUNICATION', description: 'Bot messaging', icon: 'send' },
  { id: 'vonage', name: 'Vonage', category: 'COMMUNICATION', description: 'SMS, voice & verify', icon: 'phone' },

  // AUTOMATION
  { id: 'zapier', name: 'Zapier', category: 'AUTOMATION', description: 'Connect 6000+ apps', icon: 'zap' },
  { id: 'make', name: 'Make (Integromat)', category: 'AUTOMATION', description: 'Visual automation', icon: 'workflow' },
  { id: 'workato', name: 'Workato', category: 'AUTOMATION', description: 'Enterprise automation', icon: 'workflow' },
  { id: 'n8n', name: 'n8n', category: 'AUTOMATION', description: 'Open-source workflows', icon: 'workflow' },
  { id: 'power-automate', name: 'Power Automate', category: 'AUTOMATION', description: 'Microsoft flows', icon: 'workflow' },

  // CRM
  { id: 'salesforce', name: 'Salesforce', category: 'CRM', description: 'Enterprise CRM', icon: 'users' },
  { id: 'hubspot-crm', name: 'HubSpot CRM', category: 'CRM', description: 'Customer relationship mgmt', icon: 'users' },
  { id: 'zoho-crm', name: 'Zoho CRM', category: 'CRM', description: 'Sales CRM', icon: 'users' },
  { id: 'pipedrive', name: 'Pipedrive', category: 'CRM', description: 'Sales pipeline CRM', icon: 'users' },
  { id: 'freshsales', name: 'Freshsales', category: 'CRM', description: 'Sales CRM', icon: 'users' },
  { id: 'dynamics-365', name: 'Microsoft Dynamics 365', category: 'CRM', description: 'CRM & ERP', icon: 'users' },

  // ANALYTICS
  { id: 'google-analytics', name: 'Google Analytics', category: 'ANALYTICS', description: 'Web & app analytics', icon: 'bar-chart-3' },
  { id: 'mixpanel', name: 'Mixpanel', category: 'ANALYTICS', description: 'Product analytics', icon: 'line-chart' },
  { id: 'amplitude', name: 'Amplitude', category: 'ANALYTICS', description: 'Behavioral analytics', icon: 'line-chart' },
  { id: 'segment', name: 'Segment', category: 'ANALYTICS', description: 'Customer data platform', icon: 'database' },
  { id: 'metabase', name: 'Metabase', category: 'ANALYTICS', description: 'BI & dashboards', icon: 'pie-chart' },
  { id: 'power-bi', name: 'Power BI', category: 'ANALYTICS', description: 'Microsoft BI', icon: 'pie-chart' },
  { id: 'tableau', name: 'Tableau', category: 'ANALYTICS', description: 'Visual analytics', icon: 'pie-chart' },

  // LOYALTY
  { id: 'loyaltylion', name: 'LoyaltyLion', category: 'LOYALTY', description: 'Loyalty & rewards', icon: 'star' },
  { id: 'smile-io', name: 'Smile.io', category: 'LOYALTY', description: 'Loyalty programs', icon: 'smile' },
  { id: 'yotpo', name: 'Yotpo', category: 'LOYALTY', description: 'Reviews & loyalty', icon: 'message-square' },

  // HR_PAYROLL
  { id: 'gusto', name: 'Gusto', category: 'HR_PAYROLL', description: 'Payroll & benefits', icon: 'banknote' },
  { id: 'adp', name: 'ADP', category: 'HR_PAYROLL', description: 'Payroll & HR', icon: 'banknote' },
  { id: 'bamboo-hr', name: 'BambooHR', category: 'HR_PAYROLL', description: 'HR information system', icon: 'user-cog' },
  { id: 'rippling', name: 'Rippling', category: 'HR_PAYROLL', description: 'Workforce management', icon: 'user-cog' },
  { id: 'deel', name: 'Deel', category: 'HR_PAYROLL', description: 'Global payroll & hiring', icon: 'globe' },

  // TAX_COMPLIANCE
  { id: 'avalara', name: 'Avalara', category: 'TAX_COMPLIANCE', description: 'Sales tax automation', icon: 'percent' },
  { id: 'taxjar', name: 'TaxJar', category: 'TAX_COMPLIANCE', description: 'Sales tax reporting', icon: 'percent' },
  { id: 'stripe-tax', name: 'Stripe Tax', category: 'TAX_COMPLIANCE', description: 'Tax calculation', icon: 'percent' },
  { id: 'sovos', name: 'Sovos', category: 'TAX_COMPLIANCE', description: 'Global tax compliance', icon: 'percent' },

  // ERP_INVENTORY
  { id: 'sap-business-one', name: 'SAP Business One', category: 'ERP_INVENTORY', description: 'ERP for SMBs', icon: 'database' },
  { id: 'cin7', name: 'Cin7', category: 'ERP_INVENTORY', description: 'Inventory & order mgmt', icon: 'boxes' },
  { id: 'extensiv', name: 'Extensiv (Skubana)', category: 'ERP_INVENTORY', description: 'Multichannel ops', icon: 'boxes' },
  { id: 'linnworks', name: 'Linnworks', category: 'ERP_INVENTORY', description: 'Order & inventory mgmt', icon: 'boxes' },
  { id: 'inflow', name: 'inFlow', category: 'ERP_INVENTORY', description: 'Inventory software', icon: 'boxes' },
  { id: 'brightpearl', name: 'Brightpearl', category: 'ERP_INVENTORY', description: 'Retail ops platform', icon: 'boxes' },

  // SOCIAL
  { id: 'instagram', name: 'Instagram', category: 'SOCIAL', description: 'Social commerce', icon: 'camera' },
  { id: 'facebook', name: 'Facebook', category: 'SOCIAL', description: 'Pages & shops', icon: 'share-2' },
  { id: 'tiktok', name: 'TikTok', category: 'SOCIAL', description: 'Short-video commerce', icon: 'video' },
  { id: 'pinterest', name: 'Pinterest', category: 'SOCIAL', description: 'Visual discovery', icon: 'image' },
  { id: 'youtube', name: 'YouTube', category: 'SOCIAL', description: 'Video channel', icon: 'youtube' },
  { id: 'x-twitter', name: 'X (Twitter)', category: 'SOCIAL', description: 'Social messaging', icon: 'at-sign' },

  // RESERVATIONS
  { id: 'opentable', name: 'OpenTable', category: 'RESERVATIONS', description: 'Restaurant reservations', icon: 'utensils-crossed' },
  { id: 'resy', name: 'Resy', category: 'RESERVATIONS', description: 'Reservations platform', icon: 'utensils-crossed' },
  { id: 'toast', name: 'Toast', category: 'RESERVATIONS', description: 'Restaurant platform', icon: 'utensils-crossed' },
  { id: 'lightspeed', name: 'Lightspeed', category: 'RESERVATIONS', description: 'Retail & restaurant POS', icon: 'store' },
  { id: 'calendly', name: 'Calendly', category: 'RESERVATIONS', description: 'Appointment scheduling', icon: 'calendar' },
  { id: 'booksy', name: 'Booksy', category: 'RESERVATIONS', description: 'Appointments & bookings', icon: 'calendar' },

  // IDENTITY
  { id: 'okta', name: 'Okta', category: 'IDENTITY', description: 'Identity & SSO', icon: 'shield' },
  { id: 'auth0', name: 'Auth0', category: 'IDENTITY', description: 'Authentication platform', icon: 'shield' },
  { id: 'azure-ad', name: 'Microsoft Entra ID', category: 'IDENTITY', description: 'Directory & SSO', icon: 'shield' },
  { id: 'google-workspace', name: 'Google Workspace', category: 'IDENTITY', description: 'SSO & directory', icon: 'shield' },
  { id: 'onelogin', name: 'OneLogin', category: 'IDENTITY', description: 'Identity management', icon: 'shield' },
  { id: 'duo', name: 'Duo Security', category: 'IDENTITY', description: 'MFA & 2FA', icon: 'shield-check' },

  // SUPPORT
  { id: 'zendesk', name: 'Zendesk', category: 'SUPPORT', description: 'Helpdesk & tickets', icon: 'life-buoy' },
  { id: 'freshdesk', name: 'Freshdesk', category: 'SUPPORT', description: 'Customer support', icon: 'life-buoy' },
  { id: 'intercom', name: 'Intercom', category: 'SUPPORT', description: 'Messenger & support', icon: 'message-circle' },
  { id: 'zoho-desk', name: 'Zoho Desk', category: 'SUPPORT', description: 'Helpdesk software', icon: 'life-buoy' },

  // BANKING
  { id: 'plaid', name: 'Plaid', category: 'BANKING', description: 'Bank account linking', icon: 'landmark' },
  { id: 'wise', name: 'Wise', category: 'BANKING', description: 'International transfers', icon: 'banknote' },
  { id: 'ramp', name: 'Ramp', category: 'BANKING', description: 'Corporate cards & spend', icon: 'credit-card' },
  { id: 'mercury', name: 'Mercury', category: 'BANKING', description: 'Business banking', icon: 'landmark' },
];

// Providers grouped by category, preserving INTEGRATION_CATEGORIES order.
export function providersByCategory(): { category: string; providers: IntegrationProvider[] }[] {
  return INTEGRATION_CATEGORIES
    .map((category) => ({
      category,
      providers: INTEGRATION_PROVIDERS.filter((p) => p.category === category),
    }))
    .filter((g) => g.providers.length > 0);
}

export const CATALOG_STATS = {
  totalProviders: INTEGRATION_PROVIDERS.length,
  totalCategories: INTEGRATION_CATEGORIES.length,
};
