// ═══════════════════════════════════════════════════════════════════════════
// GLOBAL PAYMENT METHODS CATALOG (§10 Payments)
// ─────────────────────────────────────────────────────────────────────────────
// A comprehensive, category-grouped registry of EVERY payment method/rail a
// business can accept worldwide, so no card network, wallet, real-time scheme,
// bank-transfer rail, BNPL, mobile-money service, cash voucher, cryptocurrency
// or offline method is left out.
//
// This is the server-side SOURCE OF TRUTH (mirrored in
// packages/web/src/data/paymentMethods.ts). It follows the same catalog pattern
// as currencies.ts / integrationCatalog.ts / globalRegions.ts:
//   interface → CATEGORIES → CATALOG → derived maps → helpers.
//
// `Payment.method` stays a free-form String (exactly like `currency`), so no
// Prisma migration is required — the catalog validates + normalises at the edge
// and drives routing: `gateway: true` methods are sent to the PSP
// (paymentProvider.ts), `gateway: false` methods stay on the internal ledger.
//
// Region-awareness: a method with a `countries` array is offered in those ISO
// 3166-1 alpha-2 markets; omitting `countries` means it is available worldwide.
// Country codes come from the authoritative taxonomy in globalRegions.ts.
// ═══════════════════════════════════════════════════════════════════════════

/** Where a method can be accepted. */
export type PaymentChannel = 'IN_STORE' | 'ONLINE';

/** High-level grouping — also the UI grouping order (see PAYMENT_METHOD_CATEGORIES). */
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

export interface PaymentMethodDef {
  /** Stable upper-snake code persisted on Payment.method (e.g. 'VISA', 'PIX'). */
  id: string;
  /** Human-readable display name. */
  name: string;
  /** Grouping / category (one of PAYMENT_METHOD_CATEGORIES). */
  category: PaymentMethodCategory;
  /** true = route through the PSP gateway; false = internal ledger entry. */
  gateway: boolean;
  /** Channels where the method can be accepted. */
  channels: PaymentChannel[];
  /** ISO 3166-1 alpha-2 markets where offered; omit = available worldwide. */
  countries?: string[];
  /** lucide icon name (best-effort) for UI display. */
  icon: string;
  /** Legacy/alternate codes that normalise to this id. */
  aliases?: string[];
}

/** Canonical category ordering (used for grouping in the UI + API). */
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

const BOTH: PaymentChannel[] = ['IN_STORE', 'ONLINE'];
const STORE: PaymentChannel[] = ['IN_STORE'];
const ONLINE: PaymentChannel[] = ['ONLINE'];

// ── The catalog ─────────────────────────────────────────────────────────────
export const PAYMENT_METHOD_CATALOG: PaymentMethodDef[] = [
  // ─── CARD (present variants + every major network) ──────────────────────
  { id: 'CARD', name: 'Card', category: 'CARD', gateway: true, channels: BOTH, icon: 'credit-card', aliases: ['DEBIT_OR_CREDIT'] },
  { id: 'CREDIT_CARD', name: 'Credit Card', category: 'CARD', gateway: true, channels: BOTH, icon: 'credit-card' },
  { id: 'DEBIT_CARD', name: 'Debit Card', category: 'CARD', gateway: true, channels: BOTH, icon: 'credit-card' },
  { id: 'CHIP', name: 'Chip / Insert', category: 'CARD', gateway: true, channels: STORE, icon: 'credit-card' },
  { id: 'SWIPE', name: 'Swipe / Magstripe', category: 'CARD', gateway: true, channels: STORE, icon: 'credit-card' },
  { id: 'TAP', name: 'Tap / Contactless', category: 'CARD', gateway: true, channels: STORE, icon: 'wifi', aliases: ['CONTACTLESS', 'NFC'] },
  { id: 'MANUAL_ENTRY', name: 'Manual Key Entry', category: 'CARD', gateway: true, channels: STORE, icon: 'keyboard' },
  { id: 'VISA', name: 'Visa', category: 'CARD', gateway: true, channels: BOTH, icon: 'credit-card' },
  { id: 'MASTERCARD', name: 'Mastercard', category: 'CARD', gateway: true, channels: BOTH, icon: 'credit-card' },
  { id: 'AMERICAN_EXPRESS', name: 'American Express', category: 'CARD', gateway: true, channels: BOTH, icon: 'credit-card', aliases: ['AMEX'] },
  { id: 'DISCOVER', name: 'Discover', category: 'CARD', gateway: true, channels: BOTH, icon: 'credit-card' },
  { id: 'JCB', name: 'JCB', category: 'CARD', gateway: true, channels: BOTH, icon: 'credit-card', countries: ['JP'] },
  { id: 'DINERS_CLUB', name: 'Diners Club', category: 'CARD', gateway: true, channels: BOTH, icon: 'credit-card' },
  { id: 'UNIONPAY', name: 'China UnionPay', category: 'CARD', gateway: true, channels: BOTH, icon: 'credit-card', countries: ['CN'] },
  { id: 'MAESTRO', name: 'Maestro', category: 'CARD', gateway: true, channels: BOTH, icon: 'credit-card' },
  { id: 'VISA_ELECTRON', name: 'Visa Electron', category: 'CARD', gateway: true, channels: BOTH, icon: 'credit-card' },
  { id: 'GIROCARD', name: 'Girocard (EC)', category: 'CARD', gateway: true, channels: STORE, icon: 'credit-card', countries: ['DE'] },
  { id: 'DANKORT', name: 'Dankort', category: 'CARD', gateway: true, channels: BOTH, icon: 'credit-card', countries: ['DK'] },
  { id: 'CARTES_BANCAIRES', name: 'Cartes Bancaires (CB)', category: 'CARD', gateway: true, channels: BOTH, icon: 'credit-card', countries: ['FR'] },
  { id: 'RUPAY', name: 'RuPay', category: 'CARD', gateway: true, channels: BOTH, icon: 'credit-card', countries: ['IN'] },
  { id: 'ELO', name: 'Elo', category: 'CARD', gateway: true, channels: BOTH, icon: 'credit-card', countries: ['BR'] },
  { id: 'HIPERCARD', name: 'Hipercard', category: 'CARD', gateway: true, channels: BOTH, icon: 'credit-card', countries: ['BR'] },
  { id: 'TROY', name: 'TROY', category: 'CARD', gateway: true, channels: BOTH, icon: 'credit-card', countries: ['TR'] },
  { id: 'MIR', name: 'Mir', category: 'CARD', gateway: true, channels: BOTH, icon: 'credit-card', countries: ['RU'] },
  { id: 'BC_CARD', name: 'BC Card', category: 'CARD', gateway: true, channels: BOTH, icon: 'credit-card', countries: ['KR'] },
  { id: 'EFTPOS', name: 'eftpos', category: 'CARD', gateway: true, channels: STORE, icon: 'credit-card', countries: ['AU', 'NZ'] },
  { id: 'PREPAID_CARD', name: 'Prepaid Card', category: 'CARD', gateway: true, channels: BOTH, icon: 'credit-card' },

  // ─── DIGITAL_WALLET ─────────────────────────────────────────────────────
  { id: 'APPLE_PAY', name: 'Apple Pay', category: 'DIGITAL_WALLET', gateway: true, channels: BOTH, icon: 'wallet' },
  { id: 'GOOGLE_PAY', name: 'Google Pay', category: 'DIGITAL_WALLET', gateway: true, channels: BOTH, icon: 'wallet' },
  { id: 'SAMSUNG_PAY', name: 'Samsung Pay', category: 'DIGITAL_WALLET', gateway: true, channels: BOTH, icon: 'wallet' },
  { id: 'GARMIN_PAY', name: 'Garmin Pay', category: 'DIGITAL_WALLET', gateway: true, channels: STORE, icon: 'watch' },
  { id: 'FITBIT_PAY', name: 'Fitbit Pay', category: 'DIGITAL_WALLET', gateway: true, channels: STORE, icon: 'watch' },
  { id: 'CLICK_TO_PAY', name: 'Click to Pay (SRC)', category: 'DIGITAL_WALLET', gateway: true, channels: ONLINE, icon: 'wallet' },
  { id: 'PAYPAL', name: 'PayPal', category: 'DIGITAL_WALLET', gateway: true, channels: ONLINE, icon: 'wallet' },
  { id: 'VENMO', name: 'Venmo', category: 'DIGITAL_WALLET', gateway: true, channels: BOTH, icon: 'wallet', countries: ['US'] },
  { id: 'CASH_APP_PAY', name: 'Cash App Pay', category: 'DIGITAL_WALLET', gateway: true, channels: BOTH, icon: 'wallet', countries: ['US', 'GB'] },
  { id: 'AMAZON_PAY', name: 'Amazon Pay', category: 'DIGITAL_WALLET', gateway: true, channels: ONLINE, icon: 'wallet' },
  { id: 'META_PAY', name: 'Meta Pay', category: 'DIGITAL_WALLET', gateway: true, channels: ONLINE, icon: 'wallet' },
  { id: 'ALIPAY', name: 'Alipay', category: 'DIGITAL_WALLET', gateway: true, channels: BOTH, icon: 'wallet', countries: ['CN'] },
  { id: 'WECHAT_PAY', name: 'WeChat Pay', category: 'DIGITAL_WALLET', gateway: true, channels: BOTH, icon: 'wallet', countries: ['CN'] },
  { id: 'UNIONPAY_APP', name: 'UnionPay App', category: 'DIGITAL_WALLET', gateway: true, channels: BOTH, icon: 'wallet', countries: ['CN'] },
  { id: 'SWISH', name: 'Swish', category: 'DIGITAL_WALLET', gateway: true, channels: BOTH, icon: 'smartphone', countries: ['SE'] },
  { id: 'VIPPS', name: 'Vipps', category: 'DIGITAL_WALLET', gateway: true, channels: BOTH, icon: 'smartphone', countries: ['NO'] },
  { id: 'MOBILEPAY', name: 'MobilePay', category: 'DIGITAL_WALLET', gateway: true, channels: BOTH, icon: 'smartphone', countries: ['DK', 'FI', 'NO'] },
  { id: 'TWINT', name: 'Twint', category: 'DIGITAL_WALLET', gateway: true, channels: BOTH, icon: 'smartphone', countries: ['CH'] },
  { id: 'PAYCONIQ', name: 'Payconiq', category: 'DIGITAL_WALLET', gateway: true, channels: BOTH, icon: 'smartphone', countries: ['BE', 'LU', 'NL'] },
  { id: 'BANCONTACT', name: 'Bancontact', category: 'DIGITAL_WALLET', gateway: true, channels: ONLINE, icon: 'wallet', countries: ['BE'] },
  { id: 'KAKAOPAY', name: 'KakaoPay', category: 'DIGITAL_WALLET', gateway: true, channels: BOTH, icon: 'wallet', countries: ['KR'] },
  { id: 'NAVERPAY', name: 'Naver Pay', category: 'DIGITAL_WALLET', gateway: true, channels: BOTH, icon: 'wallet', countries: ['KR'] },
  { id: 'TOSS', name: 'Toss', category: 'DIGITAL_WALLET', gateway: true, channels: BOTH, icon: 'wallet', countries: ['KR'] },
  { id: 'PAYCO', name: 'PAYCO', category: 'DIGITAL_WALLET', gateway: true, channels: BOTH, icon: 'wallet', countries: ['KR'] },
  { id: 'PAYPAY', name: 'PayPay', category: 'DIGITAL_WALLET', gateway: true, channels: BOTH, icon: 'wallet', countries: ['JP'] },
  { id: 'RAKUTEN_PAY', name: 'Rakuten Pay', category: 'DIGITAL_WALLET', gateway: true, channels: BOTH, icon: 'wallet', countries: ['JP'] },
  { id: 'LINE_PAY', name: 'LINE Pay', category: 'DIGITAL_WALLET', gateway: true, channels: BOTH, icon: 'wallet', countries: ['JP', 'TW', 'TH'] },
  { id: 'MERCADO_PAGO', name: 'Mercado Pago', category: 'DIGITAL_WALLET', gateway: true, channels: BOTH, icon: 'wallet', countries: ['AR', 'BR', 'MX', 'CL', 'CO', 'PE', 'UY'] },
  { id: 'PAYTM', name: 'Paytm', category: 'DIGITAL_WALLET', gateway: true, channels: BOTH, icon: 'wallet', countries: ['IN'] },
  { id: 'PHONEPE', name: 'PhonePe', category: 'DIGITAL_WALLET', gateway: true, channels: BOTH, icon: 'wallet', countries: ['IN'] },
  { id: 'BHIM', name: 'BHIM', category: 'DIGITAL_WALLET', gateway: true, channels: BOTH, icon: 'wallet', countries: ['IN'] },
  { id: 'GCASH', name: 'GCash', category: 'DIGITAL_WALLET', gateway: true, channels: BOTH, icon: 'wallet', countries: ['PH'] },
  { id: 'MAYA', name: 'Maya', category: 'DIGITAL_WALLET', gateway: true, channels: BOTH, icon: 'wallet', countries: ['PH'] },
  { id: 'DANA', name: 'DANA', category: 'DIGITAL_WALLET', gateway: true, channels: BOTH, icon: 'wallet', countries: ['ID'] },
  { id: 'OVO', name: 'OVO', category: 'DIGITAL_WALLET', gateway: true, channels: BOTH, icon: 'wallet', countries: ['ID'] },
  { id: 'GOPAY', name: 'GoPay', category: 'DIGITAL_WALLET', gateway: true, channels: BOTH, icon: 'wallet', countries: ['ID'] },
  { id: 'SHOPEEPAY', name: 'ShopeePay', category: 'DIGITAL_WALLET', gateway: true, channels: BOTH, icon: 'wallet', countries: ['ID', 'MY', 'PH', 'SG', 'TH', 'VN', 'BR', 'TW'] },
  { id: 'LINKAJA', name: 'LinkAja', category: 'DIGITAL_WALLET', gateway: true, channels: BOTH, icon: 'wallet', countries: ['ID'] },
  { id: 'TRUEMONEY', name: 'TrueMoney', category: 'DIGITAL_WALLET', gateway: true, channels: BOTH, icon: 'wallet', countries: ['TH'] },
  { id: 'RABBIT_LINE_PAY', name: 'Rabbit LINE Pay', category: 'DIGITAL_WALLET', gateway: true, channels: BOTH, icon: 'wallet', countries: ['TH'] },
  { id: 'MOMO_VN', name: 'MoMo', category: 'DIGITAL_WALLET', gateway: true, channels: BOTH, icon: 'wallet', countries: ['VN'] },
  { id: 'ZALOPAY', name: 'ZaloPay', category: 'DIGITAL_WALLET', gateway: true, channels: BOTH, icon: 'wallet', countries: ['VN'] },
  { id: 'MADA', name: 'mada', category: 'DIGITAL_WALLET', gateway: true, channels: BOTH, icon: 'wallet', countries: ['SA'] },
  { id: 'STC_PAY', name: 'stc pay', category: 'DIGITAL_WALLET', gateway: true, channels: BOTH, icon: 'wallet', countries: ['SA'] },
  { id: 'KNET', name: 'KNET', category: 'DIGITAL_WALLET', gateway: true, channels: BOTH, icon: 'wallet', countries: ['KW'] },
  { id: 'BENEFIT', name: 'BenefitPay', category: 'DIGITAL_WALLET', gateway: true, channels: BOTH, icon: 'wallet', countries: ['BH'] },
  { id: 'OMAN_NET', name: 'OmanNet', category: 'DIGITAL_WALLET', gateway: true, channels: BOTH, icon: 'wallet', countries: ['OM'] },
  { id: 'FAWRY', name: 'Fawry', category: 'DIGITAL_WALLET', gateway: true, channels: BOTH, icon: 'wallet', countries: ['EG'] },
  { id: 'SBERPAY', name: 'SberPay', category: 'DIGITAL_WALLET', gateway: true, channels: BOTH, icon: 'wallet', countries: ['RU'] },
  { id: 'YANDEX_PAY', name: 'Yandex Pay', category: 'DIGITAL_WALLET', gateway: true, channels: ONLINE, icon: 'wallet', countries: ['RU'] },
  { id: 'MAXIMA_WALLET', name: 'Mir Pay', category: 'DIGITAL_WALLET', gateway: true, channels: STORE, icon: 'wallet', countries: ['RU'] },

  // ─── REAL_TIME (instant account-to-account rails) ───────────────────────
  { id: 'PIX', name: 'Pix', category: 'REAL_TIME', gateway: true, channels: BOTH, icon: 'zap', countries: ['BR'] },
  { id: 'UPI', name: 'UPI', category: 'REAL_TIME', gateway: true, channels: BOTH, icon: 'zap', countries: ['IN'] },
  { id: 'PROMPTPAY', name: 'PromptPay', category: 'REAL_TIME', gateway: true, channels: BOTH, icon: 'zap', countries: ['TH'] },
  { id: 'PAYNOW', name: 'PayNow', category: 'REAL_TIME', gateway: true, channels: BOTH, icon: 'zap', countries: ['SG'] },
  { id: 'PAYNOW_MY', name: 'DuitNow', category: 'REAL_TIME', gateway: true, channels: BOTH, icon: 'zap', countries: ['MY'] },
  { id: 'FPS', name: 'Faster Payment System', category: 'REAL_TIME', gateway: true, channels: BOTH, icon: 'zap', countries: ['HK'] },
  { id: 'BIZUM', name: 'Bizum', category: 'REAL_TIME', gateway: true, channels: BOTH, icon: 'zap', countries: ['ES'] },
  { id: 'CODI', name: 'CoDi', category: 'REAL_TIME', gateway: true, channels: BOTH, icon: 'zap', countries: ['MX'] },
  { id: 'SPEI', name: 'SPEI', category: 'REAL_TIME', gateway: true, channels: ONLINE, icon: 'zap', countries: ['MX'] },
  { id: 'OSKO', name: 'Osko (NPP)', category: 'REAL_TIME', gateway: true, channels: BOTH, icon: 'zap', countries: ['AU'] },
  { id: 'PAYID', name: 'PayID', category: 'REAL_TIME', gateway: true, channels: BOTH, icon: 'zap', countries: ['AU'] },
  { id: 'FEDNOW', name: 'FedNow', category: 'REAL_TIME', gateway: true, channels: ONLINE, icon: 'zap', countries: ['US'] },
  { id: 'RTP', name: 'RTP (Real-Time Payments)', category: 'REAL_TIME', gateway: true, channels: ONLINE, icon: 'zap', countries: ['US'] },
  { id: 'INSTANT_EFT', name: 'Instant EFT', category: 'REAL_TIME', gateway: true, channels: ONLINE, icon: 'zap', countries: ['ZA'] },
  { id: 'SBP', name: 'SBP (Faster Payments)', category: 'REAL_TIME', gateway: true, channels: BOTH, icon: 'zap', countries: ['RU'] },
  { id: 'IMPS', name: 'IMPS', category: 'REAL_TIME', gateway: true, channels: ONLINE, icon: 'zap', countries: ['IN'] },
  { id: 'SIIRTO', name: 'Siirto', category: 'REAL_TIME', gateway: true, channels: BOTH, icon: 'zap', countries: ['FI'] },
  { id: 'INSTANT_TRANSFER', name: 'Instant Bank Transfer', category: 'REAL_TIME', gateway: true, channels: ONLINE, icon: 'zap' },

  // ─── QR ─────────────────────────────────────────────────────────────────
  { id: 'QR', name: 'QR Code', category: 'QR', gateway: true, channels: BOTH, icon: 'qr-code' },
  { id: 'EMV_QR', name: 'EMV QR', category: 'QR', gateway: true, channels: BOTH, icon: 'qr-code' },
  { id: 'QRIS', name: 'QRIS', category: 'QR', gateway: true, channels: BOTH, icon: 'qr-code', countries: ['ID'] },
  { id: 'UPI_QR', name: 'UPI QR', category: 'QR', gateway: true, channels: BOTH, icon: 'qr-code', countries: ['IN'] },
  { id: 'PIX_QR', name: 'Pix QR', category: 'QR', gateway: true, channels: BOTH, icon: 'qr-code', countries: ['BR'] },
  { id: 'WECHAT_QR', name: 'WeChat Pay QR', category: 'QR', gateway: true, channels: BOTH, icon: 'qr-code', countries: ['CN'] },
  { id: 'ALIPAY_QR', name: 'Alipay QR', category: 'QR', gateway: true, channels: BOTH, icon: 'qr-code', countries: ['CN'] },
  { id: 'PROMPTPAY_QR', name: 'PromptPay QR', category: 'QR', gateway: true, channels: BOTH, icon: 'qr-code', countries: ['TH'] },
  { id: 'PAYNOW_QR', name: 'PayNow QR', category: 'QR', gateway: true, channels: BOTH, icon: 'qr-code', countries: ['SG'] },
  { id: 'SWISH_QR', name: 'Swish QR', category: 'QR', gateway: true, channels: BOTH, icon: 'qr-code', countries: ['SE'] },

  // ─── BANK_TRANSFER / OPEN BANKING ───────────────────────────────────────
  { id: 'ACH', name: 'ACH Transfer', category: 'BANK_TRANSFER', gateway: true, channels: ONLINE, icon: 'landmark', countries: ['US'] },
  { id: 'ACH_DEBIT', name: 'ACH Direct Debit', category: 'BANK_TRANSFER', gateway: true, channels: ONLINE, icon: 'landmark', countries: ['US'] },
  { id: 'SEPA_CREDIT_TRANSFER', name: 'SEPA Credit Transfer', category: 'BANK_TRANSFER', gateway: true, channels: ONLINE, icon: 'landmark', countries: ['AT', 'BE', 'DE', 'ES', 'FI', 'FR', 'IE', 'IT', 'LU', 'NL', 'PT', 'GR', 'EE', 'LV', 'LT', 'SK', 'SI', 'CY', 'MT'] },
  { id: 'SEPA_INSTANT', name: 'SEPA Instant', category: 'BANK_TRANSFER', gateway: true, channels: ONLINE, icon: 'landmark' },
  { id: 'SEPA_DIRECT_DEBIT', name: 'SEPA Direct Debit', category: 'BANK_TRANSFER', gateway: true, channels: ONLINE, icon: 'landmark' },
  { id: 'DIRECT_DEBIT', name: 'Direct Debit', category: 'BANK_TRANSFER', gateway: true, channels: ONLINE, icon: 'landmark' },
  { id: 'OPEN_BANKING', name: 'Open Banking', category: 'BANK_TRANSFER', gateway: true, channels: ONLINE, icon: 'landmark' },
  { id: 'TRUSTLY', name: 'Trustly', category: 'BANK_TRANSFER', gateway: true, channels: ONLINE, icon: 'landmark' },
  { id: 'PAY_BY_BANK', name: 'Pay by Bank', category: 'BANK_TRANSFER', gateway: true, channels: ONLINE, icon: 'landmark' },
  { id: 'FASTER_PAYMENTS', name: 'Faster Payments', category: 'BANK_TRANSFER', gateway: true, channels: ONLINE, icon: 'landmark', countries: ['GB'] },
  { id: 'BACS', name: 'BACS Direct Debit', category: 'BANK_TRANSFER', gateway: true, channels: ONLINE, icon: 'landmark', countries: ['GB'] },
  { id: 'IDEAL', name: 'iDEAL', category: 'BANK_TRANSFER', gateway: true, channels: ONLINE, icon: 'landmark', countries: ['NL'] },
  { id: 'SOFORT', name: 'Sofort', category: 'BANK_TRANSFER', gateway: true, channels: ONLINE, icon: 'landmark', countries: ['DE', 'AT', 'BE', 'NL', 'ES', 'IT', 'PL', 'CH'] },
  { id: 'GIROPAY', name: 'giropay', category: 'BANK_TRANSFER', gateway: true, channels: ONLINE, icon: 'landmark', countries: ['DE'] },
  { id: 'EPS', name: 'eps', category: 'BANK_TRANSFER', gateway: true, channels: ONLINE, icon: 'landmark', countries: ['AT'] },
  { id: 'MULTIBANCO', name: 'Multibanco', category: 'BANK_TRANSFER', gateway: true, channels: ONLINE, icon: 'landmark', countries: ['PT'] },
  { id: 'MB_WAY', name: 'MB WAY', category: 'BANK_TRANSFER', gateway: true, channels: BOTH, icon: 'smartphone', countries: ['PT'] },
  { id: 'PRZELEWY24', name: 'Przelewy24', category: 'BANK_TRANSFER', gateway: true, channels: ONLINE, icon: 'landmark', countries: ['PL'] },
  { id: 'DOTPAY', name: 'Dotpay', category: 'BANK_TRANSFER', gateway: true, channels: ONLINE, icon: 'landmark', countries: ['PL'] },
  { id: 'BLIK', name: 'BLIK', category: 'BANK_TRANSFER', gateway: true, channels: BOTH, icon: 'smartphone', countries: ['PL'] },
  { id: 'MYBANK', name: 'MyBank', category: 'BANK_TRANSFER', gateway: true, channels: ONLINE, icon: 'landmark' },
  { id: 'POLI', name: 'POLi', category: 'BANK_TRANSFER', gateway: true, channels: ONLINE, icon: 'landmark', countries: ['AU', 'NZ'] },
  { id: 'INTERAC', name: 'Interac e-Transfer', category: 'BANK_TRANSFER', gateway: true, channels: ONLINE, icon: 'landmark', countries: ['CA'] },
  { id: 'NETBANKING', name: 'Netbanking', category: 'BANK_TRANSFER', gateway: true, channels: ONLINE, icon: 'landmark', countries: ['IN'] },
  { id: 'NEFT', name: 'NEFT', category: 'BANK_TRANSFER', gateway: false, channels: ONLINE, icon: 'landmark', countries: ['IN'] },
  { id: 'RTGS', name: 'RTGS', category: 'BANK_TRANSFER', gateway: false, channels: ONLINE, icon: 'landmark', countries: ['IN'] },
  { id: 'EFT', name: 'EFT', category: 'BANK_TRANSFER', gateway: false, channels: ONLINE, icon: 'landmark', countries: ['ZA'] },
  { id: 'CHAPS', name: 'CHAPS', category: 'BANK_TRANSFER', gateway: false, channels: ONLINE, icon: 'landmark', countries: ['GB'] },
  { id: 'WIRE_TRANSFER', name: 'Wire Transfer', category: 'BANK_TRANSFER', gateway: false, channels: ONLINE, icon: 'landmark' },
  { id: 'SWIFT', name: 'SWIFT / International Wire', category: 'BANK_TRANSFER', gateway: false, channels: ONLINE, icon: 'globe' },

  // ─── BNPL (buy now, pay later / installments) ───────────────────────────
  { id: 'KLARNA', name: 'Klarna', category: 'BNPL', gateway: true, channels: ONLINE, icon: 'badge-dollar-sign' },
  { id: 'AFTERPAY', name: 'Afterpay / Clearpay', category: 'BNPL', gateway: true, channels: ONLINE, icon: 'badge-dollar-sign', countries: ['US', 'CA', 'GB', 'AU', 'NZ'] },
  { id: 'AFFIRM', name: 'Affirm', category: 'BNPL', gateway: true, channels: ONLINE, icon: 'badge-dollar-sign', countries: ['US', 'CA'] },
  { id: 'ZIP', name: 'Zip (Quadpay)', category: 'BNPL', gateway: true, channels: ONLINE, icon: 'badge-dollar-sign', countries: ['US', 'AU', 'NZ', 'GB'] },
  { id: 'SEZZLE', name: 'Sezzle', category: 'BNPL', gateway: true, channels: ONLINE, icon: 'badge-dollar-sign', countries: ['US', 'CA'] },
  { id: 'PERPAY', name: 'Perpay', category: 'BNPL', gateway: true, channels: ONLINE, icon: 'badge-dollar-sign', countries: ['US'] },
  { id: 'SPLITIT', name: 'Splitit', category: 'BNPL', gateway: true, channels: ONLINE, icon: 'badge-dollar-sign' },
  { id: 'ATOME', name: 'Atome', category: 'BNPL', gateway: true, channels: ONLINE, icon: 'badge-dollar-sign', countries: ['SG', 'MY', 'PH', 'ID', 'AE', 'SA', 'HK', 'TW'] },
  { id: 'TAMARA', name: 'Tamara', category: 'BNPL', gateway: true, channels: ONLINE, icon: 'badge-dollar-sign', countries: ['SA', 'AE', 'KW'] },
  { id: 'TABBY', name: 'Tabby', category: 'BNPL', gateway: true, channels: ONLINE, icon: 'badge-dollar-sign', countries: ['AE', 'SA', 'KW', 'QA', 'BH'] },
  { id: 'POSTPAY', name: 'Postpay', category: 'BNPL', gateway: true, channels: ONLINE, icon: 'badge-dollar-sign', countries: ['AE'] },
  { id: 'VALU', name: 'valU', category: 'BNPL', gateway: true, channels: ONLINE, icon: 'badge-dollar-sign', countries: ['EG'] },
  { id: 'SCALAPAY', name: 'Scalapay', category: 'BNPL', gateway: true, channels: ONLINE, icon: 'badge-dollar-sign', countries: ['IT', 'ES', 'FR'] },
  { id: 'ALMA', name: 'Alma', category: 'BNPL', gateway: true, channels: ONLINE, icon: 'badge-dollar-sign', countries: ['FR'] },
  { id: 'PAGANTIS', name: 'Pagantis', category: 'BNPL', gateway: true, channels: ONLINE, icon: 'badge-dollar-sign', countries: ['ES'] },
  { id: 'MERCADO_CREDITO', name: 'Mercado Crédito', category: 'BNPL', gateway: true, channels: ONLINE, icon: 'badge-dollar-sign', countries: ['AR', 'BR', 'MX'] },
  { id: 'PAY_IN_4', name: 'Pay in 4', category: 'BNPL', gateway: true, channels: ONLINE, icon: 'badge-dollar-sign' },
  { id: 'INSTALLMENTS', name: 'Installments', category: 'BNPL', gateway: true, channels: BOTH, icon: 'badge-dollar-sign' },
  { id: 'FINANCING', name: 'Financing', category: 'BNPL', gateway: true, channels: BOTH, icon: 'badge-dollar-sign' },

  // ─── MOBILE_MONEY (carrier / telco wallets, esp. Africa & South Asia) ───
  { id: 'M_PESA', name: 'M-Pesa', category: 'MOBILE_MONEY', gateway: true, channels: BOTH, icon: 'smartphone', countries: ['KE', 'TZ', 'UG', 'MZ', 'CD', 'ET', 'LS'] },
  { id: 'MTN_MOMO', name: 'MTN MoMo', category: 'MOBILE_MONEY', gateway: true, channels: BOTH, icon: 'smartphone', countries: ['NG', 'GH', 'UG', 'RW', 'ZM', 'CI', 'CM', 'BJ', 'ZA', 'SS', 'GN', 'LR'] },
  { id: 'AIRTEL_MONEY', name: 'Airtel Money', category: 'MOBILE_MONEY', gateway: true, channels: BOTH, icon: 'smartphone', countries: ['KE', 'TZ', 'UG', 'ZM', 'MW', 'RW', 'NG', 'GH', 'MG', 'CD'] },
  { id: 'ORANGE_MONEY', name: 'Orange Money', category: 'MOBILE_MONEY', gateway: true, channels: BOTH, icon: 'smartphone', countries: ['SN', 'CI', 'ML', 'BF', 'CM', 'CD', 'MG', 'MR', 'NE', 'TG', 'GU', 'JO', 'EG', 'MA', 'TN'] },
  { id: 'MOOV_MONEY', name: 'Moov Money', category: 'MOBILE_MONEY', gateway: true, channels: BOTH, icon: 'smartphone', countries: ['BJ', 'TG', 'CI', 'BF', 'ML', 'NE', 'TG'] },
  { id: 'WAVE', name: 'Wave', category: 'MOBILE_MONEY', gateway: true, channels: BOTH, icon: 'smartphone', countries: ['SN', 'CI'] },
  { id: 'FREE_MONEY', name: 'Free Money', category: 'MOBILE_MONEY', gateway: true, channels: BOTH, icon: 'smartphone', countries: ['SN'] },
  { id: 'TIGO_PESA', name: 'Tigo Pesa', category: 'MOBILE_MONEY', gateway: true, channels: BOTH, icon: 'smartphone', countries: ['TZ'] },
  { id: 'HALOPESA', name: 'Halopesa', category: 'MOBILE_MONEY', gateway: true, channels: BOTH, icon: 'smartphone', countries: ['TZ'] },
  { id: 'ECOCASH', name: 'EcoCash', category: 'MOBILE_MONEY', gateway: true, channels: BOTH, icon: 'smartphone', countries: ['ZW'] },
  { id: 'ZAAD', name: 'Zaad', category: 'MOBILE_MONEY', gateway: true, channels: BOTH, icon: 'smartphone', countries: ['SO'] },
  { id: 'OPAY', name: 'OPay', category: 'MOBILE_MONEY', gateway: true, channels: BOTH, icon: 'smartphone', countries: ['NG'] },
  { id: 'PALMPAY', name: 'PalmPay', category: 'MOBILE_MONEY', gateway: true, channels: BOTH, icon: 'smartphone', countries: ['NG', 'GH'] },
  { id: 'KUDA', name: 'Kuda', category: 'MOBILE_MONEY', gateway: true, channels: ONLINE, icon: 'smartphone', countries: ['NG'] },
  { id: 'CHIPPER_CASH', name: 'Chipper Cash', category: 'MOBILE_MONEY', gateway: true, channels: BOTH, icon: 'smartphone', countries: ['NG', 'GH', 'KE', 'UG', 'TZ', 'ZA'] },
  { id: 'BKASH', name: 'bKash', category: 'MOBILE_MONEY', gateway: true, channels: BOTH, icon: 'smartphone', countries: ['BD'] },
  { id: 'NAGAD', name: 'Nagad', category: 'MOBILE_MONEY', gateway: true, channels: BOTH, icon: 'smartphone', countries: ['BD'] },
  { id: 'ROCKET', name: 'Rocket', category: 'MOBILE_MONEY', gateway: true, channels: BOTH, icon: 'smartphone', countries: ['BD'] },
  { id: 'JAZZCASH', name: 'JazzCash', category: 'MOBILE_MONEY', gateway: true, channels: BOTH, icon: 'smartphone', countries: ['PK'] },
  { id: 'EASYPAYSA', name: 'Easypaisa', category: 'MOBILE_MONEY', gateway: true, channels: BOTH, icon: 'smartphone', countries: ['PK'] },
  { id: 'ESEWA', name: 'eSewa', category: 'MOBILE_MONEY', gateway: true, channels: BOTH, icon: 'smartphone', countries: ['NP'] },
  { id: 'KHALTI', name: 'Khalti', category: 'MOBILE_MONEY', gateway: true, channels: BOTH, icon: 'smartphone', countries: ['NP'] },
  { id: 'WING', name: 'Wing', category: 'MOBILE_MONEY', gateway: true, channels: BOTH, icon: 'smartphone', countries: ['KH'] },

  // ─── VOUCHER / OVER-THE-COUNTER CASH ────────────────────────────────────
  { id: 'BOLETO', name: 'Boleto Bancário', category: 'VOUCHER', gateway: true, channels: ONLINE, icon: 'receipt', countries: ['BR'] },
  { id: 'OXXO', name: 'OXXO', category: 'VOUCHER', gateway: true, channels: ONLINE, icon: 'receipt', countries: ['MX'] },
  { id: 'KONBINI', name: 'Konbini (convenience store)', category: 'VOUCHER', gateway: true, channels: ONLINE, icon: 'receipt', countries: ['JP'] },
  { id: 'SEVEN_ELEVEN', name: '7-Eleven', category: 'VOUCHER', gateway: true, channels: ONLINE, icon: 'receipt', countries: ['JP', 'PH'] },
  { id: 'BALOTO', name: 'Baloto', category: 'VOUCHER', gateway: true, channels: ONLINE, icon: 'receipt', countries: ['CO'] },
  { id: 'EFECTY', name: 'Efecty', category: 'VOUCHER', gateway: true, channels: ONLINE, icon: 'receipt', countries: ['CO'] },
  { id: 'RAPIPAY', name: 'Rapipago', category: 'VOUCHER', gateway: true, channels: ONLINE, icon: 'receipt', countries: ['MX', 'AR'] },
  { id: 'PAGO_FACIL', name: 'Pago Fácil', category: 'VOUCHER', gateway: true, channels: ONLINE, icon: 'receipt', countries: ['AR'] },
  { id: 'PAYSAFE_CARD', name: 'Paysafecard', category: 'VOUCHER', gateway: true, channels: ONLINE, icon: 'ticket' },
  { id: 'NEOSURF', name: 'Neosurf', category: 'VOUCHER', gateway: true, channels: ONLINE, icon: 'ticket' },
  { id: 'CASH_LIB', name: 'Cashlib', category: 'VOUCHER', gateway: true, channels: ONLINE, icon: 'ticket' },
  { id: 'ASTROPAY', name: 'AstroPay', category: 'VOUCHER', gateway: true, channels: ONLINE, icon: 'ticket' },
  { id: 'SAFETYPAY', name: 'SafetyPay', category: 'VOUCHER', gateway: true, channels: ONLINE, icon: 'ticket' },
  { id: 'SODEXO', name: 'Sodexo', category: 'VOUCHER', gateway: false, channels: STORE, icon: 'ticket' },
  { id: 'EDENRED', name: 'Edenred / Ticket Restaurant', category: 'VOUCHER', gateway: false, channels: STORE, icon: 'ticket' },
  { id: 'CASH_ON_DELIVERY', name: 'Cash on Delivery', category: 'VOUCHER', gateway: false, channels: BOTH, icon: 'truck', aliases: ['COD'] },

  // ─── CRYPTO ─────────────────────────────────────────────────────────────
  { id: 'CRYPTO', name: 'Cryptocurrency', category: 'CRYPTO', gateway: true, channels: ONLINE, icon: 'bitcoin' },
  { id: 'BITCOIN', name: 'Bitcoin', category: 'CRYPTO', gateway: true, channels: ONLINE, icon: 'bitcoin', aliases: ['BTC'] },
  { id: 'ETHEREUM', name: 'Ethereum', category: 'CRYPTO', gateway: true, channels: ONLINE, icon: 'coins', aliases: ['ETH'] },
  { id: 'USDC', name: 'USD Coin', category: 'CRYPTO', gateway: true, channels: ONLINE, icon: 'coins' },
  { id: 'USDT', name: 'Tether', category: 'CRYPTO', gateway: true, channels: ONLINE, icon: 'coins' },
  { id: 'DAI', name: 'Dai', category: 'CRYPTO', gateway: true, channels: ONLINE, icon: 'coins' },
  { id: 'LITECOIN', name: 'Litecoin', category: 'CRYPTO', gateway: true, channels: ONLINE, icon: 'coins', aliases: ['LTC'] },
  { id: 'BITCOIN_CASH', name: 'Bitcoin Cash', category: 'CRYPTO', gateway: true, channels: ONLINE, icon: 'bitcoin', aliases: ['BCH'] },
  { id: 'SOLANA', name: 'Solana', category: 'CRYPTO', gateway: true, channels: ONLINE, icon: 'coins', aliases: ['SOL'] },
  { id: 'DOGECOIN', name: 'Dogecoin', category: 'CRYPTO', gateway: true, channels: ONLINE, icon: 'coins', aliases: ['DOGE'] },
  { id: 'POLYGON', name: 'Polygon', category: 'CRYPTO', gateway: true, channels: ONLINE, icon: 'coins', aliases: ['MATIC'] },
  { id: 'STABLECOIN', name: 'Stablecoin', category: 'CRYPTO', gateway: true, channels: ONLINE, icon: 'coins' },

  // ─── CASH ───────────────────────────────────────────────────────────────
  { id: 'CASH', name: 'Cash', category: 'CASH', gateway: false, channels: STORE, icon: 'banknote' },

  // ─── STORE_VALUE (house-issued) ─────────────────────────────────────────
  { id: 'GIFT_CARD', name: 'Gift Card', category: 'STORE_VALUE', gateway: false, channels: BOTH, icon: 'gift' },
  { id: 'STORE_CREDIT', name: 'Store Credit', category: 'STORE_VALUE', gateway: false, channels: BOTH, icon: 'wallet' },
  { id: 'LOYALTY_POINTS', name: 'Loyalty Points', category: 'STORE_VALUE', gateway: false, channels: BOTH, icon: 'star' },
  { id: 'WALLET_BALANCE', name: 'Wallet Balance', category: 'STORE_VALUE', gateway: false, channels: BOTH, icon: 'wallet' },
  { id: 'GIFT_VOUCHER', name: 'Gift Voucher', category: 'STORE_VALUE', gateway: false, channels: BOTH, icon: 'ticket' },

  // ─── OFFLINE / DEFERRED ─────────────────────────────────────────────────
  { id: 'CHEQUE', name: 'Cheque / Check', category: 'OFFLINE', gateway: false, channels: STORE, icon: 'file-text', aliases: ['CHECK'] },
  { id: 'INVOICE', name: 'Invoice / On Account', category: 'OFFLINE', gateway: false, channels: BOTH, icon: 'receipt' },
  { id: 'BANK_DEPOSIT', name: 'Bank Deposit (manual)', category: 'OFFLINE', gateway: false, channels: BOTH, icon: 'landmark' },
  { id: 'DEFERRED', name: 'Deferred / Credit Terms', category: 'OFFLINE', gateway: false, channels: BOTH, icon: 'clock' },
  { id: 'HOUSE_ACCOUNT', name: 'House Account', category: 'OFFLINE', gateway: false, channels: BOTH, icon: 'building-2' },
  { id: 'OTHER', name: 'Other', category: 'OFFLINE', gateway: false, channels: BOTH, icon: 'more-horizontal' },
];

// ── Derived lookups ─────────────────────────────────────────────────────────
export const PAYMENT_METHOD_IDS: Set<string> = new Set(PAYMENT_METHOD_CATALOG.map((m) => m.id));

export const PAYMENT_METHOD_BY_ID: Record<string, PaymentMethodDef> = Object.fromEntries(
  PAYMENT_METHOD_CATALOG.map((m) => [m.id, m]),
);

/** Legacy / alternate code → canonical id (e.g. CONTACTLESS → TAP, BTC → BITCOIN). */
export const PAYMENT_METHOD_ALIASES: Record<string, string> = PAYMENT_METHOD_CATALOG.reduce(
  (acc, m) => {
    for (const a of m.aliases || []) acc[a] = m.id;
    return acc;
  },
  {} as Record<string, string>,
);

export function isValidPaymentMethod(id: unknown): boolean {
  return typeof id === 'string' && PAYMENT_METHOD_IDS.has(id.trim().toUpperCase());
}

/**
 * Normalise user input to a canonical catalog id: upper-cases, trims and folds
 * legacy aliases (TAP/CONTACTLESS, AMEX, BTC…). Returns null when unknown so the
 * edge can reject or fall back to OTHER.
 */
export function normalizePaymentMethod(id: unknown): string | null {
  if (typeof id !== 'string') return null;
  const up = id.trim().toUpperCase();
  if (!up) return null;
  const canonical = PAYMENT_METHOD_ALIASES[up] || up;
  return PAYMENT_METHOD_IDS.has(canonical) ? canonical : null;
}

// ── Routing helpers ─────────────────────────────────────────────────────────
/**
 * true when a method must be routed through the PSP gateway (replaces the old
 * hardcoded CARD_METHODS set). Unknown methods default to the internal ledger.
 */
export function isGatewayMethod(id: unknown): boolean {
  const canonical = normalizePaymentMethod(id);
  return canonical ? PAYMENT_METHOD_BY_ID[canonical].gateway : false;
}

/** true for internal-ledger methods (cash, store value, offline…) — no PSP call. */
export function isInternalMethod(id: unknown): boolean {
  return !isGatewayMethod(id);
}

/** Channels a method supports (defaults to both for unknown ids). */
export function paymentMethodChannels(id: unknown): PaymentChannel[] {
  const canonical = normalizePaymentMethod(id);
  return canonical ? PAYMENT_METHOD_BY_ID[canonical].channels : BOTH;
}

// ── Region / channel filtering ──────────────────────────────────────────────
/**
 * Every method available in a market: all worldwide methods (no `countries`)
 * plus those whose `countries` list contains the given ISO 3166-1 alpha-2 code.
 * Passing no/unknown country returns the worldwide set only.
 */
export function paymentMethodsForCountry(countryCode?: string | null): PaymentMethodDef[] {
  const cc = typeof countryCode === 'string' ? countryCode.trim().toUpperCase() : '';
  return PAYMENT_METHOD_CATALOG.filter(
    (m) => !m.countries || (cc && m.countries.includes(cc)),
  );
}

/** Methods available on a given channel (IN_STORE / ONLINE), optionally by country. */
export function paymentMethodsForChannel(
  channel: PaymentChannel,
  countryCode?: string | null,
): PaymentMethodDef[] {
  return paymentMethodsForCountry(countryCode).filter((m) => m.channels.includes(channel));
}

/** Group methods by category, preserving PAYMENT_METHOD_CATEGORIES order. */
export function methodsByCategory(
  list: PaymentMethodDef[] = PAYMENT_METHOD_CATALOG,
): { category: PaymentMethodCategory; methods: PaymentMethodDef[] }[] {
  return PAYMENT_METHOD_CATEGORIES.map((category) => ({
    category,
    methods: list.filter((m) => m.category === category),
  })).filter((g) => g.methods.length > 0);
}

/** True when the worldwide catalog offers at least one method for every ISO market. */
export function countryHasPaymentMethods(countryCode: string): boolean {
  return paymentMethodsForCountry(countryCode).length > 0;
}

export const PAYMENT_METHOD_STATS = {
  totalMethods: PAYMENT_METHOD_CATALOG.length,
  totalCategories: PAYMENT_METHOD_CATEGORIES.length,
  gatewayMethods: PAYMENT_METHOD_CATALOG.filter((m) => m.gateway).length,
  internalMethods: PAYMENT_METHOD_CATALOG.filter((m) => !m.gateway).length,
  worldwideMethods: PAYMENT_METHOD_CATALOG.filter((m) => !m.countries).length,
  regionalMethods: PAYMENT_METHOD_CATALOG.filter((m) => Boolean(m.countries)).length,
};
