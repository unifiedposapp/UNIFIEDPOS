// ═══════════════════════════════════════════════════════════════════════════
// GLOBAL PAYMENT METHODS CATALOG — WEB MIRROR (§10 Payments)
// ─────────────────────────────────────────────────────────────────────────────
// UI-facing mirror of packages/server/src/data/paymentMethods.ts (the server is
// the validation/routing source of truth). Follows the same manual-mirror
// convention as currencies.ts: this copy carries only the fields the frontend
// needs to render the payment picker — id, name, category, channels, countries
// and icon — plus grouping helpers.
//
// Every method a business can accept worldwide is present so no card network,
// wallet, real-time scheme, bank rail, BNPL, mobile-money service, cash voucher,
// cryptocurrency or offline method is left out of the checkout UI.
// ═══════════════════════════════════════════════════════════════════════════

export type PaymentChannel = 'IN_STORE' | 'ONLINE';

export type PaymentMethodCategory =
  | 'CARD'
  | 'DIGITAL_WALLET'
  | 'REAL_TIME'
  | 'QR'
  | 'BANK_TRANSFER'
  | 'BNPL'
  | 'MOBILE_MONEY'
  | 'VOUCHER'
  | 'CRYPTO'
  | 'CASH'
  | 'STORE_VALUE'
  | 'OFFLINE';

export interface PaymentMethod {
  id: string;
  name: string;
  category: PaymentMethodCategory;
  channels: PaymentChannel[];
  /** ISO 3166-1 alpha-2 markets where offered; absent = available worldwide. */
  countries?: string[];
  icon: string;
}

/** Canonical category ordering + human labels for the picker. */
export const PAYMENT_METHOD_CATEGORIES: PaymentMethodCategory[] = [
  'CARD',
  'DIGITAL_WALLET',
  'REAL_TIME',
  'QR',
  'BANK_TRANSFER',
  'BNPL',
  'MOBILE_MONEY',
  'VOUCHER',
  'CRYPTO',
  'CASH',
  'STORE_VALUE',
  'OFFLINE',
];

export const CATEGORY_LABELS: Record<PaymentMethodCategory, string> = {
  CARD: 'Cards',
  DIGITAL_WALLET: 'Digital Wallets',
  REAL_TIME: 'Instant / Real-Time',
  QR: 'QR Payments',
  BANK_TRANSFER: 'Bank Transfer & Open Banking',
  BNPL: 'Buy Now, Pay Later',
  MOBILE_MONEY: 'Mobile Money',
  VOUCHER: 'Vouchers & Cash',
  CRYPTO: 'Cryptocurrency',
  CASH: 'Cash',
  STORE_VALUE: 'Gift & Store Value',
  OFFLINE: 'Offline / Deferred',
};

const BOTH: PaymentChannel[] = ['IN_STORE', 'ONLINE'];
const STORE: PaymentChannel[] = ['IN_STORE'];
const ONLINE: PaymentChannel[] = ['ONLINE'];

// ── The catalog (mirrors the server) ────────────────────────────────────────
export const PAYMENT_METHODS: PaymentMethod[] = [
  // CARD
  { id: 'CARD', name: 'Card', category: 'CARD', channels: BOTH, icon: 'credit-card' },
  { id: 'CREDIT_CARD', name: 'Credit Card', category: 'CARD', channels: BOTH, icon: 'credit-card' },
  { id: 'DEBIT_CARD', name: 'Debit Card', category: 'CARD', channels: BOTH, icon: 'credit-card' },
  { id: 'CHIP', name: 'Chip / Insert', category: 'CARD', channels: STORE, icon: 'credit-card' },
  { id: 'SWIPE', name: 'Swipe / Magstripe', category: 'CARD', channels: STORE, icon: 'credit-card' },
  { id: 'TAP', name: 'Tap / Contactless', category: 'CARD', channels: STORE, icon: 'wifi' },
  { id: 'MANUAL_ENTRY', name: 'Manual Key Entry', category: 'CARD', channels: STORE, icon: 'keyboard' },
  { id: 'VISA', name: 'Visa', category: 'CARD', channels: BOTH, icon: 'credit-card' },
  { id: 'MASTERCARD', name: 'Mastercard', category: 'CARD', channels: BOTH, icon: 'credit-card' },
  { id: 'AMERICAN_EXPRESS', name: 'American Express', category: 'CARD', channels: BOTH, icon: 'credit-card' },
  { id: 'DISCOVER', name: 'Discover', category: 'CARD', channels: BOTH, icon: 'credit-card' },
  { id: 'JCB', name: 'JCB', category: 'CARD', channels: BOTH, countries: ['JP'], icon: 'credit-card' },
  { id: 'DINERS_CLUB', name: 'Diners Club', category: 'CARD', channels: BOTH, icon: 'credit-card' },
  { id: 'UNIONPAY', name: 'China UnionPay', category: 'CARD', channels: BOTH, countries: ['CN'], icon: 'credit-card' },
  { id: 'MAESTRO', name: 'Maestro', category: 'CARD', channels: BOTH, icon: 'credit-card' },
  { id: 'VISA_ELECTRON', name: 'Visa Electron', category: 'CARD', channels: BOTH, icon: 'credit-card' },
  { id: 'GIROCARD', name: 'Girocard (EC)', category: 'CARD', channels: STORE, countries: ['DE'], icon: 'credit-card' },
  { id: 'DANKORT', name: 'Dankort', category: 'CARD', channels: BOTH, countries: ['DK'], icon: 'credit-card' },
  { id: 'CARTES_BANCAIRES', name: 'Cartes Bancaires (CB)', category: 'CARD', channels: BOTH, countries: ['FR'], icon: 'credit-card' },
  { id: 'RUPAY', name: 'RuPay', category: 'CARD', channels: BOTH, countries: ['IN'], icon: 'credit-card' },
  { id: 'ELO', name: 'Elo', category: 'CARD', channels: BOTH, countries: ['BR'], icon: 'credit-card' },
  { id: 'HIPERCARD', name: 'Hipercard', category: 'CARD', channels: BOTH, countries: ['BR'], icon: 'credit-card' },
  { id: 'TROY', name: 'TROY', category: 'CARD', channels: BOTH, countries: ['TR'], icon: 'credit-card' },
  { id: 'MIR', name: 'Mir', category: 'CARD', channels: BOTH, countries: ['RU'], icon: 'credit-card' },
  { id: 'BC_CARD', name: 'BC Card', category: 'CARD', channels: BOTH, countries: ['KR'], icon: 'credit-card' },
  { id: 'EFTPOS', name: 'eftpos', category: 'CARD', channels: STORE, countries: ['AU', 'NZ'], icon: 'credit-card' },
  { id: 'PREPAID_CARD', name: 'Prepaid Card', category: 'CARD', channels: BOTH, icon: 'credit-card' },

  // DIGITAL_WALLET
  { id: 'APPLE_PAY', name: 'Apple Pay', category: 'DIGITAL_WALLET', channels: BOTH, icon: 'wallet' },
  { id: 'GOOGLE_PAY', name: 'Google Pay', category: 'DIGITAL_WALLET', channels: BOTH, icon: 'wallet' },
  { id: 'SAMSUNG_PAY', name: 'Samsung Pay', category: 'DIGITAL_WALLET', channels: BOTH, icon: 'wallet' },
  { id: 'GARMIN_PAY', name: 'Garmin Pay', category: 'DIGITAL_WALLET', channels: STORE, icon: 'watch' },
  { id: 'FITBIT_PAY', name: 'Fitbit Pay', category: 'DIGITAL_WALLET', channels: STORE, icon: 'watch' },
  { id: 'CLICK_TO_PAY', name: 'Click to Pay (SRC)', category: 'DIGITAL_WALLET', channels: ONLINE, icon: 'wallet' },
  { id: 'PAYPAL', name: 'PayPal', category: 'DIGITAL_WALLET', channels: ONLINE, icon: 'wallet' },
  { id: 'VENMO', name: 'Venmo', category: 'DIGITAL_WALLET', channels: BOTH, countries: ['US'], icon: 'wallet' },
  { id: 'CASH_APP_PAY', name: 'Cash App Pay', category: 'DIGITAL_WALLET', channels: BOTH, countries: ['US', 'GB'], icon: 'wallet' },
  { id: 'AMAZON_PAY', name: 'Amazon Pay', category: 'DIGITAL_WALLET', channels: ONLINE, icon: 'wallet' },
  { id: 'META_PAY', name: 'Meta Pay', category: 'DIGITAL_WALLET', channels: ONLINE, icon: 'wallet' },
  { id: 'ALIPAY', name: 'Alipay', category: 'DIGITAL_WALLET', channels: BOTH, countries: ['CN'], icon: 'wallet' },
  { id: 'WECHAT_PAY', name: 'WeChat Pay', category: 'DIGITAL_WALLET', channels: BOTH, countries: ['CN'], icon: 'wallet' },
  { id: 'UNIONPAY_APP', name: 'UnionPay App', category: 'DIGITAL_WALLET', channels: BOTH, countries: ['CN'], icon: 'wallet' },
  { id: 'SWISH', name: 'Swish', category: 'DIGITAL_WALLET', channels: BOTH, countries: ['SE'], icon: 'smartphone' },
  { id: 'VIPPS', name: 'Vipps', category: 'DIGITAL_WALLET', channels: BOTH, countries: ['NO'], icon: 'smartphone' },
  { id: 'MOBILEPAY', name: 'MobilePay', category: 'DIGITAL_WALLET', channels: BOTH, countries: ['DK', 'FI', 'NO'], icon: 'smartphone' },
  { id: 'TWINT', name: 'Twint', category: 'DIGITAL_WALLET', channels: BOTH, countries: ['CH'], icon: 'smartphone' },
  { id: 'PAYCONIQ', name: 'Payconiq', category: 'DIGITAL_WALLET', channels: BOTH, countries: ['BE', 'LU', 'NL'], icon: 'smartphone' },
  { id: 'BANCONTACT', name: 'Bancontact', category: 'DIGITAL_WALLET', channels: ONLINE, countries: ['BE'], icon: 'wallet' },
  { id: 'KAKAOPAY', name: 'KakaoPay', category: 'DIGITAL_WALLET', channels: BOTH, countries: ['KR'], icon: 'wallet' },
  { id: 'NAVERPAY', name: 'Naver Pay', category: 'DIGITAL_WALLET', channels: BOTH, countries: ['KR'], icon: 'wallet' },
  { id: 'TOSS', name: 'Toss', category: 'DIGITAL_WALLET', channels: BOTH, countries: ['KR'], icon: 'wallet' },
  { id: 'PAYCO', name: 'PAYCO', category: 'DIGITAL_WALLET', channels: BOTH, countries: ['KR'], icon: 'wallet' },
  { id: 'PAYPAY', name: 'PayPay', category: 'DIGITAL_WALLET', channels: BOTH, countries: ['JP'], icon: 'wallet' },
  { id: 'RAKUTEN_PAY', name: 'Rakuten Pay', category: 'DIGITAL_WALLET', channels: BOTH, countries: ['JP'], icon: 'wallet' },
  { id: 'LINE_PAY', name: 'LINE Pay', category: 'DIGITAL_WALLET', channels: BOTH, countries: ['JP', 'TW', 'TH'], icon: 'wallet' },
  { id: 'MERCADO_PAGO', name: 'Mercado Pago', category: 'DIGITAL_WALLET', channels: BOTH, countries: ['AR', 'BR', 'MX', 'CL', 'CO', 'PE', 'UY'], icon: 'wallet' },
  { id: 'PAYTM', name: 'Paytm', category: 'DIGITAL_WALLET', channels: BOTH, countries: ['IN'], icon: 'wallet' },
  { id: 'PHONEPE', name: 'PhonePe', category: 'DIGITAL_WALLET', channels: BOTH, countries: ['IN'], icon: 'wallet' },
  { id: 'BHIM', name: 'BHIM', category: 'DIGITAL_WALLET', channels: BOTH, countries: ['IN'], icon: 'wallet' },
  { id: 'GCASH', name: 'GCash', category: 'DIGITAL_WALLET', channels: BOTH, countries: ['PH'], icon: 'wallet' },
  { id: 'MAYA', name: 'Maya', category: 'DIGITAL_WALLET', channels: BOTH, countries: ['PH'], icon: 'wallet' },
  { id: 'DANA', name: 'DANA', category: 'DIGITAL_WALLET', channels: BOTH, countries: ['ID'], icon: 'wallet' },
  { id: 'OVO', name: 'OVO', category: 'DIGITAL_WALLET', channels: BOTH, countries: ['ID'], icon: 'wallet' },
  { id: 'GOPAY', name: 'GoPay', category: 'DIGITAL_WALLET', channels: BOTH, countries: ['ID'], icon: 'wallet' },
  { id: 'SHOPEEPAY', name: 'ShopeePay', category: 'DIGITAL_WALLET', channels: BOTH, countries: ['ID', 'MY', 'PH', 'SG', 'TH', 'VN', 'BR', 'TW'], icon: 'wallet' },
  { id: 'LINKAJA', name: 'LinkAja', category: 'DIGITAL_WALLET', channels: BOTH, countries: ['ID'], icon: 'wallet' },
  { id: 'TRUEMONEY', name: 'TrueMoney', category: 'DIGITAL_WALLET', channels: BOTH, countries: ['TH'], icon: 'wallet' },
  { id: 'RABBIT_LINE_PAY', name: 'Rabbit LINE Pay', category: 'DIGITAL_WALLET', channels: BOTH, countries: ['TH'], icon: 'wallet' },
  { id: 'MOMO_VN', name: 'MoMo', category: 'DIGITAL_WALLET', channels: BOTH, countries: ['VN'], icon: 'wallet' },
  { id: 'ZALOPAY', name: 'ZaloPay', category: 'DIGITAL_WALLET', channels: BOTH, countries: ['VN'], icon: 'wallet' },
  { id: 'MADA', name: 'mada', category: 'DIGITAL_WALLET', channels: BOTH, countries: ['SA'], icon: 'wallet' },
  { id: 'STC_PAY', name: 'stc pay', category: 'DIGITAL_WALLET', channels: BOTH, countries: ['SA'], icon: 'wallet' },
  { id: 'KNET', name: 'KNET', category: 'DIGITAL_WALLET', channels: BOTH, countries: ['KW'], icon: 'wallet' },
  { id: 'BENEFIT', name: 'BenefitPay', category: 'DIGITAL_WALLET', channels: BOTH, countries: ['BH'], icon: 'wallet' },
  { id: 'OMAN_NET', name: 'OmanNet', category: 'DIGITAL_WALLET', channels: BOTH, countries: ['OM'], icon: 'wallet' },
  { id: 'FAWRY', name: 'Fawry', category: 'DIGITAL_WALLET', channels: BOTH, countries: ['EG'], icon: 'wallet' },
  { id: 'SBERPAY', name: 'SberPay', category: 'DIGITAL_WALLET', channels: BOTH, countries: ['RU'], icon: 'wallet' },
  { id: 'YANDEX_PAY', name: 'Yandex Pay', category: 'DIGITAL_WALLET', channels: ONLINE, countries: ['RU'], icon: 'wallet' },
  { id: 'MAXIMA_WALLET', name: 'Mir Pay', category: 'DIGITAL_WALLET', channels: STORE, countries: ['RU'], icon: 'wallet' },

  // REAL_TIME
  { id: 'PIX', name: 'Pix', category: 'REAL_TIME', channels: BOTH, countries: ['BR'], icon: 'zap' },
  { id: 'UPI', name: 'UPI', category: 'REAL_TIME', channels: BOTH, countries: ['IN'], icon: 'zap' },
  { id: 'PROMPTPAY', name: 'PromptPay', category: 'REAL_TIME', channels: BOTH, countries: ['TH'], icon: 'zap' },
  { id: 'PAYNOW', name: 'PayNow', category: 'REAL_TIME', channels: BOTH, countries: ['SG'], icon: 'zap' },
  { id: 'PAYNOW_MY', name: 'DuitNow', category: 'REAL_TIME', channels: BOTH, countries: ['MY'], icon: 'zap' },
  { id: 'FPS', name: 'Faster Payment System', category: 'REAL_TIME', channels: BOTH, countries: ['HK'], icon: 'zap' },
  { id: 'BIZUM', name: 'Bizum', category: 'REAL_TIME', channels: BOTH, countries: ['ES'], icon: 'zap' },
  { id: 'CODI', name: 'CoDi', category: 'REAL_TIME', channels: BOTH, countries: ['MX'], icon: 'zap' },
  { id: 'SPEI', name: 'SPEI', category: 'REAL_TIME', channels: ONLINE, countries: ['MX'], icon: 'zap' },
  { id: 'OSKO', name: 'Osko (NPP)', category: 'REAL_TIME', channels: BOTH, countries: ['AU'], icon: 'zap' },
  { id: 'PAYID', name: 'PayID', category: 'REAL_TIME', channels: BOTH, countries: ['AU'], icon: 'zap' },
  { id: 'FEDNOW', name: 'FedNow', category: 'REAL_TIME', channels: ONLINE, countries: ['US'], icon: 'zap' },
  { id: 'RTP', name: 'RTP (Real-Time Payments)', category: 'REAL_TIME', channels: ONLINE, countries: ['US'], icon: 'zap' },
  { id: 'INSTANT_EFT', name: 'Instant EFT', category: 'REAL_TIME', channels: ONLINE, countries: ['ZA'], icon: 'zap' },
  { id: 'SBP', name: 'SBP (Faster Payments)', category: 'REAL_TIME', channels: BOTH, countries: ['RU'], icon: 'zap' },
  { id: 'IMPS', name: 'IMPS', category: 'REAL_TIME', channels: ONLINE, countries: ['IN'], icon: 'zap' },
  { id: 'SIIRTO', name: 'Siirto', category: 'REAL_TIME', channels: BOTH, countries: ['FI'], icon: 'zap' },
  { id: 'INSTANT_TRANSFER', name: 'Instant Bank Transfer', category: 'REAL_TIME', channels: ONLINE, icon: 'zap' },

  // QR
  { id: 'QR', name: 'QR Code', category: 'QR', channels: BOTH, icon: 'qr-code' },
  { id: 'EMV_QR', name: 'EMV QR', category: 'QR', channels: BOTH, icon: 'qr-code' },
  { id: 'QRIS', name: 'QRIS', category: 'QR', channels: BOTH, countries: ['ID'], icon: 'qr-code' },
  { id: 'UPI_QR', name: 'UPI QR', category: 'QR', channels: BOTH, countries: ['IN'], icon: 'qr-code' },
  { id: 'PIX_QR', name: 'Pix QR', category: 'QR', channels: BOTH, countries: ['BR'], icon: 'qr-code' },
  { id: 'WECHAT_QR', name: 'WeChat Pay QR', category: 'QR', channels: BOTH, countries: ['CN'], icon: 'qr-code' },
  { id: 'ALIPAY_QR', name: 'Alipay QR', category: 'QR', channels: BOTH, countries: ['CN'], icon: 'qr-code' },
  { id: 'PROMPTPAY_QR', name: 'PromptPay QR', category: 'QR', channels: BOTH, countries: ['TH'], icon: 'qr-code' },
  { id: 'PAYNOW_QR', name: 'PayNow QR', category: 'QR', channels: BOTH, countries: ['SG'], icon: 'qr-code' },
  { id: 'SWISH_QR', name: 'Swish QR', category: 'QR', channels: BOTH, countries: ['SE'], icon: 'qr-code' },

  // BANK_TRANSFER
  { id: 'ACH', name: 'ACH Transfer', category: 'BANK_TRANSFER', channels: ONLINE, countries: ['US'], icon: 'landmark' },
  { id: 'ACH_DEBIT', name: 'ACH Direct Debit', category: 'BANK_TRANSFER', channels: ONLINE, countries: ['US'], icon: 'landmark' },
  { id: 'SEPA_CREDIT_TRANSFER', name: 'SEPA Credit Transfer', category: 'BANK_TRANSFER', channels: ONLINE, icon: 'landmark' },
  { id: 'SEPA_INSTANT', name: 'SEPA Instant', category: 'BANK_TRANSFER', channels: ONLINE, icon: 'landmark' },
  { id: 'SEPA_DIRECT_DEBIT', name: 'SEPA Direct Debit', category: 'BANK_TRANSFER', channels: ONLINE, icon: 'landmark' },
  { id: 'DIRECT_DEBIT', name: 'Direct Debit', category: 'BANK_TRANSFER', channels: ONLINE, icon: 'landmark' },
  { id: 'OPEN_BANKING', name: 'Open Banking', category: 'BANK_TRANSFER', channels: ONLINE, icon: 'landmark' },
  { id: 'TRUSTLY', name: 'Trustly', category: 'BANK_TRANSFER', channels: ONLINE, icon: 'landmark' },
  { id: 'PAY_BY_BANK', name: 'Pay by Bank', category: 'BANK_TRANSFER', channels: ONLINE, icon: 'landmark' },
  { id: 'FASTER_PAYMENTS', name: 'Faster Payments', category: 'BANK_TRANSFER', channels: ONLINE, countries: ['GB'], icon: 'landmark' },
  { id: 'BACS', name: 'BACS Direct Debit', category: 'BANK_TRANSFER', channels: ONLINE, countries: ['GB'], icon: 'landmark' },
  { id: 'IDEAL', name: 'iDEAL', category: 'BANK_TRANSFER', channels: ONLINE, countries: ['NL'], icon: 'landmark' },
  { id: 'SOFORT', name: 'Sofort', category: 'BANK_TRANSFER', channels: ONLINE, countries: ['DE', 'AT', 'BE', 'NL', 'ES', 'IT', 'PL', 'CH'], icon: 'landmark' },
  { id: 'GIROPAY', name: 'giropay', category: 'BANK_TRANSFER', channels: ONLINE, countries: ['DE'], icon: 'landmark' },
  { id: 'EPS', name: 'eps', category: 'BANK_TRANSFER', channels: ONLINE, countries: ['AT'], icon: 'landmark' },
  { id: 'MULTIBANCO', name: 'Multibanco', category: 'BANK_TRANSFER', channels: ONLINE, countries: ['PT'], icon: 'landmark' },
  { id: 'MB_WAY', name: 'MB WAY', category: 'BANK_TRANSFER', channels: BOTH, countries: ['PT'], icon: 'smartphone' },
  { id: 'PRZELEWY24', name: 'Przelewy24', category: 'BANK_TRANSFER', channels: ONLINE, countries: ['PL'], icon: 'landmark' },
  { id: 'DOTPAY', name: 'Dotpay', category: 'BANK_TRANSFER', channels: ONLINE, countries: ['PL'], icon: 'landmark' },
  { id: 'BLIK', name: 'BLIK', category: 'BANK_TRANSFER', channels: BOTH, countries: ['PL'], icon: 'smartphone' },
  { id: 'MYBANK', name: 'MyBank', category: 'BANK_TRANSFER', channels: ONLINE, icon: 'landmark' },
  { id: 'POLI', name: 'POLi', category: 'BANK_TRANSFER', channels: ONLINE, countries: ['AU', 'NZ'], icon: 'landmark' },
  { id: 'INTERAC', name: 'Interac e-Transfer', category: 'BANK_TRANSFER', channels: ONLINE, countries: ['CA'], icon: 'landmark' },
  { id: 'NETBANKING', name: 'Netbanking', category: 'BANK_TRANSFER', channels: ONLINE, countries: ['IN'], icon: 'landmark' },
  { id: 'NEFT', name: 'NEFT', category: 'BANK_TRANSFER', channels: ONLINE, countries: ['IN'], icon: 'landmark' },
  { id: 'RTGS', name: 'RTGS', category: 'BANK_TRANSFER', channels: ONLINE, countries: ['IN'], icon: 'landmark' },
  { id: 'EFT', name: 'EFT', category: 'BANK_TRANSFER', channels: ONLINE, countries: ['ZA'], icon: 'landmark' },
  { id: 'CHAPS', name: 'CHAPS', category: 'BANK_TRANSFER', channels: ONLINE, countries: ['GB'], icon: 'landmark' },
  { id: 'WIRE_TRANSFER', name: 'Wire Transfer', category: 'BANK_TRANSFER', channels: ONLINE, icon: 'landmark' },
  { id: 'SWIFT', name: 'SWIFT / International Wire', category: 'BANK_TRANSFER', channels: ONLINE, icon: 'globe' },

  // BNPL
  { id: 'KLARNA', name: 'Klarna', category: 'BNPL', channels: ONLINE, icon: 'badge-dollar-sign' },
  { id: 'AFTERPAY', name: 'Afterpay / Clearpay', category: 'BNPL', channels: ONLINE, countries: ['US', 'CA', 'GB', 'AU', 'NZ'], icon: 'badge-dollar-sign' },
  { id: 'AFFIRM', name: 'Affirm', category: 'BNPL', channels: ONLINE, countries: ['US', 'CA'], icon: 'badge-dollar-sign' },
  { id: 'ZIP', name: 'Zip (Quadpay)', category: 'BNPL', channels: ONLINE, countries: ['US', 'AU', 'NZ', 'GB'], icon: 'badge-dollar-sign' },
  { id: 'SEZZLE', name: 'Sezzle', category: 'BNPL', channels: ONLINE, countries: ['US', 'CA'], icon: 'badge-dollar-sign' },
  { id: 'PERPAY', name: 'Perpay', category: 'BNPL', channels: ONLINE, countries: ['US'], icon: 'badge-dollar-sign' },
  { id: 'SPLITIT', name: 'Splitit', category: 'BNPL', channels: ONLINE, icon: 'badge-dollar-sign' },
  { id: 'ATOME', name: 'Atome', category: 'BNPL', channels: ONLINE, countries: ['SG', 'MY', 'PH', 'ID', 'AE', 'SA', 'HK', 'TW'], icon: 'badge-dollar-sign' },
  { id: 'TAMARA', name: 'Tamara', category: 'BNPL', channels: ONLINE, countries: ['SA', 'AE', 'KW'], icon: 'badge-dollar-sign' },
  { id: 'TABBY', name: 'Tabby', category: 'BNPL', channels: ONLINE, countries: ['AE', 'SA', 'KW', 'QA', 'BH'], icon: 'badge-dollar-sign' },
  { id: 'POSTPAY', name: 'Postpay', category: 'BNPL', channels: ONLINE, countries: ['AE'], icon: 'badge-dollar-sign' },
  { id: 'VALU', name: 'valU', category: 'BNPL', channels: ONLINE, countries: ['EG'], icon: 'badge-dollar-sign' },
  { id: 'SCALAPAY', name: 'Scalapay', category: 'BNPL', channels: ONLINE, countries: ['IT', 'ES', 'FR'], icon: 'badge-dollar-sign' },
  { id: 'ALMA', name: 'Alma', category: 'BNPL', channels: ONLINE, countries: ['FR'], icon: 'badge-dollar-sign' },
  { id: 'PAGANTIS', name: 'Pagantis', category: 'BNPL', channels: ONLINE, countries: ['ES'], icon: 'badge-dollar-sign' },
  { id: 'MERCADO_CREDITO', name: 'Mercado Crédito', category: 'BNPL', channels: ONLINE, countries: ['AR', 'BR', 'MX'], icon: 'badge-dollar-sign' },
  { id: 'PAY_IN_4', name: 'Pay in 4', category: 'BNPL', channels: ONLINE, icon: 'badge-dollar-sign' },
  { id: 'INSTALLMENTS', name: 'Installments', category: 'BNPL', channels: BOTH, icon: 'badge-dollar-sign' },
  { id: 'FINANCING', name: 'Financing', category: 'BNPL', channels: BOTH, icon: 'badge-dollar-sign' },

  // MOBILE_MONEY
  { id: 'M_PESA', name: 'M-Pesa', category: 'MOBILE_MONEY', channels: BOTH, countries: ['KE', 'TZ', 'UG', 'MZ', 'CD', 'ET', 'LS'], icon: 'smartphone' },
  { id: 'MTN_MOMO', name: 'MTN MoMo', category: 'MOBILE_MONEY', channels: BOTH, countries: ['NG', 'GH', 'UG', 'RW', 'ZM', 'CI', 'CM', 'BJ', 'ZA', 'SS', 'GN', 'LR'], icon: 'smartphone' },
  { id: 'AIRTEL_MONEY', name: 'Airtel Money', category: 'MOBILE_MONEY', channels: BOTH, countries: ['KE', 'TZ', 'UG', 'ZM', 'MW', 'RW', 'NG', 'GH', 'MG', 'CD'], icon: 'smartphone' },
  { id: 'ORANGE_MONEY', name: 'Orange Money', category: 'MOBILE_MONEY', channels: BOTH, countries: ['SN', 'CI', 'ML', 'BF', 'CM', 'CD', 'MG', 'MR', 'NE', 'TG', 'GU', 'JO', 'EG', 'MA', 'TN'], icon: 'smartphone' },
  { id: 'MOOV_MONEY', name: 'Moov Money', category: 'MOBILE_MONEY', channels: BOTH, countries: ['BJ', 'TG', 'CI', 'BF', 'ML', 'NE'], icon: 'smartphone' },
  { id: 'WAVE', name: 'Wave', category: 'MOBILE_MONEY', channels: BOTH, countries: ['SN', 'CI'], icon: 'smartphone' },
  { id: 'FREE_MONEY', name: 'Free Money', category: 'MOBILE_MONEY', channels: BOTH, countries: ['SN'], icon: 'smartphone' },
  { id: 'TIGO_PESA', name: 'Tigo Pesa', category: 'MOBILE_MONEY', channels: BOTH, countries: ['TZ'], icon: 'smartphone' },
  { id: 'HALOPESA', name: 'Halopesa', category: 'MOBILE_MONEY', channels: BOTH, countries: ['TZ'], icon: 'smartphone' },
  { id: 'ECOCASH', name: 'EcoCash', category: 'MOBILE_MONEY', channels: BOTH, countries: ['ZW'], icon: 'smartphone' },
  { id: 'ZAAD', name: 'Zaad', category: 'MOBILE_MONEY', channels: BOTH, countries: ['SO'], icon: 'smartphone' },
  { id: 'OPAY', name: 'OPay', category: 'MOBILE_MONEY', channels: BOTH, countries: ['NG'], icon: 'smartphone' },
  { id: 'PALMPAY', name: 'PalmPay', category: 'MOBILE_MONEY', channels: BOTH, countries: ['NG', 'GH'], icon: 'smartphone' },
  { id: 'KUDA', name: 'Kuda', category: 'MOBILE_MONEY', channels: ONLINE, countries: ['NG'], icon: 'smartphone' },
  { id: 'CHIPPER_CASH', name: 'Chipper Cash', category: 'MOBILE_MONEY', channels: BOTH, countries: ['NG', 'GH', 'KE', 'UG', 'TZ', 'ZA'], icon: 'smartphone' },
  { id: 'BKASH', name: 'bKash', category: 'MOBILE_MONEY', channels: BOTH, countries: ['BD'], icon: 'smartphone' },
  { id: 'NAGAD', name: 'Nagad', category: 'MOBILE_MONEY', channels: BOTH, countries: ['BD'], icon: 'smartphone' },
  { id: 'ROCKET', name: 'Rocket', category: 'MOBILE_MONEY', channels: BOTH, countries: ['BD'], icon: 'smartphone' },
  { id: 'JAZZCASH', name: 'JazzCash', category: 'MOBILE_MONEY', channels: BOTH, countries: ['PK'], icon: 'smartphone' },
  { id: 'EASYPAYSA', name: 'Easypaisa', category: 'MOBILE_MONEY', channels: BOTH, countries: ['PK'], icon: 'smartphone' },
  { id: 'ESEWA', name: 'eSewa', category: 'MOBILE_MONEY', channels: BOTH, countries: ['NP'], icon: 'smartphone' },
  { id: 'KHALTI', name: 'Khalti', category: 'MOBILE_MONEY', channels: BOTH, countries: ['NP'], icon: 'smartphone' },
  { id: 'WING', name: 'Wing', category: 'MOBILE_MONEY', channels: BOTH, countries: ['KH'], icon: 'smartphone' },

  // VOUCHER
  { id: 'BOLETO', name: 'Boleto Bancário', category: 'VOUCHER', channels: ONLINE, countries: ['BR'], icon: 'receipt' },
  { id: 'OXXO', name: 'OXXO', category: 'VOUCHER', channels: ONLINE, countries: ['MX'], icon: 'receipt' },
  { id: 'KONBINI', name: 'Konbini (convenience store)', category: 'VOUCHER', channels: ONLINE, countries: ['JP'], icon: 'receipt' },
  { id: 'SEVEN_ELEVEN', name: '7-Eleven', category: 'VOUCHER', channels: ONLINE, countries: ['JP', 'PH'], icon: 'receipt' },
  { id: 'BALOTO', name: 'Baloto', category: 'VOUCHER', channels: ONLINE, countries: ['CO'], icon: 'receipt' },
  { id: 'EFECTY', name: 'Efecty', category: 'VOUCHER', channels: ONLINE, countries: ['CO'], icon: 'receipt' },
  { id: 'RAPIPAY', name: 'Rapipago', category: 'VOUCHER', channels: ONLINE, countries: ['MX', 'AR'], icon: 'receipt' },
  { id: 'PAGO_FACIL', name: 'Pago Fácil', category: 'VOUCHER', channels: ONLINE, countries: ['AR'], icon: 'receipt' },
  { id: 'PAYSAFE_CARD', name: 'Paysafecard', category: 'VOUCHER', channels: ONLINE, icon: 'ticket' },
  { id: 'NEOSURF', name: 'Neosurf', category: 'VOUCHER', channels: ONLINE, icon: 'ticket' },
  { id: 'CASH_LIB', name: 'Cashlib', category: 'VOUCHER', channels: ONLINE, icon: 'ticket' },
  { id: 'ASTROPAY', name: 'AstroPay', category: 'VOUCHER', channels: ONLINE, icon: 'ticket' },
  { id: 'SAFETYPAY', name: 'SafetyPay', category: 'VOUCHER', channels: ONLINE, icon: 'ticket' },
  { id: 'SODEXO', name: 'Sodexo', category: 'VOUCHER', channels: STORE, icon: 'ticket' },
  { id: 'EDENRED', name: 'Edenred / Ticket Restaurant', category: 'VOUCHER', channels: STORE, icon: 'ticket' },
  { id: 'CASH_ON_DELIVERY', name: 'Cash on Delivery', category: 'VOUCHER', channels: BOTH, icon: 'truck' },

  // CRYPTO
  { id: 'CRYPTO', name: 'Cryptocurrency', category: 'CRYPTO', channels: ONLINE, icon: 'bitcoin' },
  { id: 'BITCOIN', name: 'Bitcoin', category: 'CRYPTO', channels: ONLINE, icon: 'bitcoin' },
  { id: 'ETHEREUM', name: 'Ethereum', category: 'CRYPTO', channels: ONLINE, icon: 'coins' },
  { id: 'USDC', name: 'USD Coin', category: 'CRYPTO', channels: ONLINE, icon: 'coins' },
  { id: 'USDT', name: 'Tether', category: 'CRYPTO', channels: ONLINE, icon: 'coins' },
  { id: 'DAI', name: 'Dai', category: 'CRYPTO', channels: ONLINE, icon: 'coins' },
  { id: 'LITECOIN', name: 'Litecoin', category: 'CRYPTO', channels: ONLINE, icon: 'coins' },
  { id: 'BITCOIN_CASH', name: 'Bitcoin Cash', category: 'CRYPTO', channels: ONLINE, icon: 'bitcoin' },
  { id: 'SOLANA', name: 'Solana', category: 'CRYPTO', channels: ONLINE, icon: 'coins' },
  { id: 'DOGECOIN', name: 'Dogecoin', category: 'CRYPTO', channels: ONLINE, icon: 'coins' },
  { id: 'POLYGON', name: 'Polygon', category: 'CRYPTO', channels: ONLINE, icon: 'coins' },
  { id: 'STABLECOIN', name: 'Stablecoin', category: 'CRYPTO', channels: ONLINE, icon: 'coins' },

  // CASH
  { id: 'CASH', name: 'Cash', category: 'CASH', channels: STORE, icon: 'banknote' },

  // STORE_VALUE
  { id: 'GIFT_CARD', name: 'Gift Card', category: 'STORE_VALUE', channels: BOTH, icon: 'gift' },
  { id: 'STORE_CREDIT', name: 'Store Credit', category: 'STORE_VALUE', channels: BOTH, icon: 'wallet' },
  { id: 'LOYALTY_POINTS', name: 'Loyalty Points', category: 'STORE_VALUE', channels: BOTH, icon: 'star' },
  { id: 'WALLET_BALANCE', name: 'Wallet Balance', category: 'STORE_VALUE', channels: BOTH, icon: 'wallet' },
  { id: 'GIFT_VOUCHER', name: 'Gift Voucher', category: 'STORE_VALUE', channels: BOTH, icon: 'ticket' },

  // OFFLINE
  { id: 'CHEQUE', name: 'Cheque / Check', category: 'OFFLINE', channels: STORE, icon: 'file-text' },
  { id: 'INVOICE', name: 'Invoice / On Account', category: 'OFFLINE', channels: BOTH, icon: 'receipt' },
  { id: 'BANK_DEPOSIT', name: 'Bank Deposit (manual)', category: 'OFFLINE', channels: BOTH, icon: 'landmark' },
  { id: 'DEFERRED', name: 'Deferred / Credit Terms', category: 'OFFLINE', channels: BOTH, icon: 'clock' },
  { id: 'HOUSE_ACCOUNT', name: 'House Account', category: 'OFFLINE', channels: BOTH, icon: 'building-2' },
  { id: 'OTHER', name: 'Other', category: 'OFFLINE', channels: BOTH, icon: 'more-horizontal' },
];

export const PAYMENT_METHOD_BY_ID: Record<string, PaymentMethod> = Object.fromEntries(
  PAYMENT_METHODS.map((m) => [m.id, m]),
);

/**
 * Fast-access methods shown as large buttons at the top of the POS picker; the
 * full categorized list sits behind "More payment methods".
 */
export const QUICK_METHOD_IDS: string[] = ['CASH', 'CARD', 'TAP', 'QR', 'APPLE_PAY', 'GOOGLE_PAY'];

/**
 * Methods available in a market on a channel: worldwide methods (no `countries`)
 * plus those whose `countries` include the given ISO code, filtered by channel.
 */
export function availableMethods(
  channel: PaymentChannel,
  countryCode?: string | null,
): PaymentMethod[] {
  const cc = (countryCode || '').trim().toUpperCase();
  return PAYMENT_METHODS.filter(
    (m) => m.channels.includes(channel) && (!m.countries || (cc && m.countries.includes(cc))),
  );
}

/** Group a method list by category, preserving PAYMENT_METHOD_CATEGORIES order. */
export function groupByCategory(
  list: PaymentMethod[] = PAYMENT_METHODS,
): { category: PaymentMethodCategory; label: string; methods: PaymentMethod[] }[] {
  return PAYMENT_METHOD_CATEGORIES.map((category) => ({
    category,
    label: CATEGORY_LABELS[category],
    methods: list.filter((m) => m.category === category),
  })).filter((g) => g.methods.length > 0);
}

export const PAYMENT_METHOD_COUNT = PAYMENT_METHODS.length;
