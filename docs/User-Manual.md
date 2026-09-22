# Unified POS - Comprehensive Manual of Use

Edition 1.0 - A Division of Glorified Technology Solution (GTS)

> This manual explains every part of Unified POS: signing in, selling at the register, managing products and stock, serving customers, running marketing and commerce, handling money and accounting, staffing, hardware, offline sync, reporting, artificial intelligence, compliance, multi-region enterprise, the developer platform, system health, and settings. Read the section that matches the task in front of you, or work top to bottom for full onboarding.

## 1. Welcome to Unified POS

Unified POS is a complete Business Operating System for retail, restaurant and omnichannel merchants. One workspace brings together the cash register, inventory, purchasing, customers, loyalty, marketing, online commerce, payments, accounting, staffing, hardware, analytics and compliance.

### What you can do

- Sell in person at a fast touch register, take card, cash, gift card and stored-value payments, and print or email receipts.
- Manage products, variants, bundles and selection options across an unlimited catalog.
- Track stock across locations, batches, lots, serial numbers and expiry dates, and move inventory between sites.
- Build a customer 360 view, run loyalty and rewards, and launch targeted marketing campaigns.
- Take online orders, offer pickup and delivery, and connect sales channels and marketplaces.
- Reconcile accounting entries, manage employees, roles, permissions, time and labor.
- Pair printers, scanners, cash drawers and displays over USB, Serial or Bluetooth.
- Keep selling offline and sync automatically when the connection returns.
- Read reports, forecasts and AI recommendations, and act on them in one click.

### Who this manual is for

- Owners and administrators who configure the business and control access.
- Managers who oversee stock, staff, purchasing and reporting.
- Cashiers and servers who operate the register and fulfill orders.

> Note: Feature visibility depends on your role. If a menu or button described here is not visible to you, your administrator has scoped it to a different role.

## 2. Getting Started

### Signing in

1. Open the app in a modern browser. Chrome or Edge on a desktop is recommended for the full experience, including hardware pairing.
2. Enter your email and password on the Sign In page and choose Sign In.
3. If you do not yet have an account, choose Create Account to register a new business. You will provide a business name, industry, currency, your name, email and a password. The first account becomes the Owner.
4. If you forget your password, choose Forgot Password. A secure reset link is emailed to you. Open the link, set a new password, and you will be returned to Sign In.

> Security: For your protection the password reset link is only ever sent by email. It is never displayed on screen in a production deployment.

### Understanding the layout

- Left navigation sidebar: all modules, grouped by area, with your profile and sign-out at the bottom and the legal and manual links in the footer.
- Top bar: search, notifications bell with an unread badge, language selector, and quick actions.
- Main area: the selected module.
- Footer: Privacy, Terms, Cookies, Accessibility, Refunds and the one-click User Manual download.

### Choosing your language and region

Use the language selector in the top bar to switch the interface language. Set your business country, address, tax rate and currency in Settings. Unified POS supports businesses in every nation and every ISO 4217 currency.

### The demo environment

A fresh installation seeds a demo business with sample products, an owner, a manager and a cashier so you can explore safely. Replace or remove demo data before going live, and change the seeded passwords immediately.

## 3. Dashboard and Overview

The Overview page is your command center. It shows today's sales, order count, average order value, top products, recent activity and health indicators.

- Use the date range control to compare periods.
- Cards link through to the relevant module for deeper analysis.
- Alerts surface low stock, pending purchasing, staffing gaps and system notices.

## 4. Selling at the Register (POS)

The Register is the heart of the system, built for speed and accuracy.

### Starting a sale

1. Open the POS page and select the active register and location if prompted.
2. Tap or search products to add them to the cart. Use the category grid, the search box, or a barcode scanner.
3. Adjust quantities, add notes or modifiers, and apply line discounts where allowed.
4. Review the running subtotal, discounts, tax and total in the totals panel.

### Product selection types

- Simple products add directly to the cart.
- Variant products prompt for options such as size or color.
- Selection or bundle products prompt for included choices, with pricing rules applied automatically.
- Weighed and open-price items let you enter a quantity or a price at the point of sale.

### Discounts and promotions

- Apply an item-level discount or an order-level discount.
- Enter a promotion or coupon code to apply automatic rules.
- Price changes and discounts are recorded in the audit log for accountability.

### Taking payment

1. Choose Take Payment.
2. Select one or more tender types: Cash, Card, Gift Card, Store Credit, or a connected gateway.
3. For cash, enter the amount tendered; the change due is calculated for you and can trigger the cash drawer.
4. For card, follow the connected terminal or gateway prompts, or use the built-in simulator in non-production setups.
5. Split payments across multiple tenders are supported; the sale completes when the balance reaches zero.

### Receipts

- Print to a paired thermal printer, or use Register Printer on the receipt screen.
- Email or send the receipt by SMS where configured.
- Reprint any receipt later from the Orders module.
- Customize the receipt footer message, logo and currency in Settings.

### Holding, parking and recalling orders

- Hold a sale to serve another customer, then recall it later.
- Held orders are listed and can be resumed or discarded.

### Cash drawer and shifts

- Open a register session at the start of a shift with a starting float.
- The drawer kicks automatically on cash sales when auto-open is enabled.
- Close the session at the end of the shift to record the expected versus counted cash and the variance.

- Held and parked tickets belong to the cashier who parked them. Another cashier on
  another register cannot recall your tickets; a manager can see all of them.

### Your personal register PIN

Every cashier has their own 4-8 digit register code, separate from the password used
to sign in. It exists so that a drawer you are responsible for stays yours:

1. Go to Registers and set your PIN in the "My Register PIN" card. Repeated codes
   (1111) and straight runs (1234) are refused. A cashier without a PIN cannot open
   a register - there would be nothing to lock it with.
2. Change it whenever you like; you must enter the current PIN to replace it, so a
   colleague standing at an unlocked screen cannot quietly take over your code.
3. Forgotten it? A manager or owner can clear it, and you then choose a new one,
   which also releases your locked drawer.

### Locking the register when you step away

- Tap "Lock register" in the POS header (or Lock Register on the Registers page).
  The screen is replaced by a PIN pad, your basket stays exactly where it is, and
  the drawer stays open.
- Nobody else can get in: only your own PIN unlocks your own drawer, and while it is
  locked the server refuses sales, discounts, holds, refunds, voids and cash moves
  on that register.
- You can also simply walk away. An unattended register locks itself after the
  manager's auto-lock window (default 5 minutes) has passed with no typing,
  tapping or scanning.
- Five wrong PIN guesses freeze the PIN for five minutes as a brute-force guard.
- End of shift is different from stepping away: unlock your drawer, then Close
  Register to count the cash and record the variance.
- Managers see every open drawer on the floor (who holds it, whether it is locked,
  how often it has been locked) and can force unlock or force close one when a
  cashier is genuinely unavailable. Both actions are written to the audit log.

### Guest orders and quotes

- Create a guest order for walk-in or phone customers without a customer profile.
- Convert a quote into a sale when the customer confirms.

## 5. Orders and Fulfillment

The Orders module lists every sale and its lifecycle.

- Filter by status, channel, location, register and date.
- Open an order to see items, payments, discounts, tax, customer and fulfillment.
- Complete, cancel, void or refund an order.
- Issue partial or full refunds and returns; refund actions are audited.
- Handle disputes and chargebacks through the connected payment provider.

### Fulfillment methods

- In-store pickup: mark items ready and record the pickup.
- Local delivery: assign a courier, track status and capture proof of delivery.
- Shipping: generate packages and labels through connected providers.

## 6. Products and Catalog

The Catalog is where you author what you sell.

### Creating a product

1. Open Catalog and choose New Product.
2. Enter a name, description, category and tags.
3. Set pricing: standard price, cost, compare-at price and tax class.
4. Choose the product type: Simple, Variant, Selection or Bundle, Weighed, or Open Price.
5. Add images and media from the Media Library.
6. Save. The product becomes available to the register immediately.

### Variants and options

- Define option axes such as Size and Color.
- Generate variant combinations, each with its own SKU, price and stock.
- The register prompts for options when a variant product is sold.

### Categories and organization

- Group products into categories and subcategories for fast register navigation.
- Use tags and collections for cross-cutting groupings and promotions.

### Media library

- Upload logos, product photos and brand assets.
- Assets are reused on receipts, the online store and marketing materials.

## 7. Inventory Management

Inventory keeps stock counts accurate across every location.

### Stock levels

- See on-hand, committed, available and reorder points per product per location.
- Low-stock alerts highlight items that have reached their reorder point.

### Adjustments

- Record stock adjustments for shrinkage, damage, counts and corrections, each with a reason code.
- Every adjustment is time-stamped and attributable.

### Batches, lots, serials and expiry

- Track inventory by batch or lot for recall precision.
- Record serial numbers for high-value or warranty items.
- Track expiration dates and receive alerts before items expire.

### Transfers

- Move stock between locations with a transfer order.
- Track the transfer from requested to in-transit to received, adjusting both sites automatically.

### Stock counts

- Run a cycle count or a full physical inventory.
- Enter counted quantities; the system posts the variance as an adjustment.

## 8. Purchasing and Suppliers

Purchasing replenishes stock efficiently and keeps supplier records complete.

- Maintain suppliers with contact details, terms and lead times.
- Create purchase orders from low-stock suggestions or manually.
- Receive purchase orders fully or partially; received quantities update inventory and cost.
- Track purchase order status from draft to sent to partially received to closed.
- Record supplier invoices and match them to receipts for accounting.

## 9. Customers

The Customers module builds a 360-degree view of each person or company.

- Add customers with contact details, addresses, tax status and notes.
- View lifetime spend, visit frequency, average order value and recency.
- See full purchase history, returns, loyalty balance and stored value.
- Segment customers by behavior, value and preferences for targeted marketing.
- Manage consent and communication preferences for privacy compliance.

## 10. Loyalty and Rewards

Loyalty turns first-time buyers into regulars.

- Create loyalty programs with earn and burn rules.
- Award points on purchases and redeem them at the register.
- Issue and track rewards, tiers and member benefits.
- Sell and top up gift cards and stored-value accounts; balances are tracked with a full ledger.
- View loyalty transactions per customer for transparency.

## 11. Marketing

Marketing helps you reach the right customers with the right offer.

### Campaigns and segments

- Build segments from customer behavior, value and attributes.
- Create campaigns targeting a segment with a message and an offer.
- Track delivery, opens, redemptions and revenue attributed to each campaign.

### RFM analysis

- Recency, Frequency and Monetary analysis scores customers automatically.
- Use RFM segments such as champions, loyal, at-risk and hibernating to tailor outreach.

### Automation

- Trigger messages on events such as birthdays, win-back windows and low engagement.
- Schedule campaigns and review performance in Reports.

## 12. Commerce Hub

The Commerce Hub unifies online and in-person selling.

- Manage sales channels and connected marketplaces.
- Accept online orders into the same inventory and fulfillment flows as in-store sales.
- Offer pickup, delivery and shipping options with live availability.
- Keep omnichannel inventory in sync so you never oversell.
- Publish products to connected channels and map categories and pricing.

## 13. Restaurant Operations

For food and beverage venues, Restaurant mode adds floor and kitchen workflows.

- Manage tables, floors and seating, and open tabs per table.
- Send orders to kitchen display screens or preparation stations.
- Track course firing, prep status and service timing.
- Split bills by seat, item or amount, and merge or transfer tabs.
- Manage menus, modifiers, recipes and ingredient-level stock.

## 14. Payments, Payment Links and Gateways

- Take in-person and online payments through connected gateways.
- Configure a payment provider and, where available, a card terminal.
- Create payment links and send them to customers to pay remotely.
- View settlements and payouts, and reconcile them against your bank.
- Handle refunds, voids, disputes and chargebacks from the Payments module.
- In non-production setups a simulator allows full end-to-end testing without live charges.

> Security: Card data is handled by your connected, compliant payment provider. Unified POS does not store full card numbers.

## 15. Accounting

Accounting keeps your books aligned with operations.

- Post sales, refunds, payouts and purchases to accounting entries.
- Map accounts and tax codes to your chart of accounts.
- Reconcile entries against statements and resolve discrepancies.
- Export entries and reports for your accountant or external system.
- Connect an accounting integration from the Developer Platform for automated sync.

## 16. Employees, Roles and Permissions

Staffing controls who can do what, and tracks time and labor cost.

### Employees

- Add employees with contact details, position, department, pay rates and location assignments.
- Deactivate employees to end access without deleting history.

### Roles and permissions

- Define roles such as Owner, Admin, Manager and Cashier.
- Grant or restrict permissions per module and per action.
- Assign roles to employees; the interface adapts to each person's permissions.

### Time and labor

- Record clock-in and clock-out time entries per employee.
- Review hours, breaks and labor cost against sales.
- Use labor optimization recommendations from the AI module for scheduling.

## 17. Registers and Devices

### Registers

- Create registers for each physical or virtual point of sale.
- Assign registers to locations and open or close sessions.
- Monitor register status and activity.
- Each register is held by exactly one cashier at a time. The list shows whether a
  drawer is free, yours, or in use by a colleague, and a register already being
  used cannot be opened a second time by anyone else.
- Set your own register PIN here ("My Register PIN"), lock or unlock your drawer, and
  choose how many minutes of inactivity trigger an automatic lock (managers only;
  choose "Never (disabled)" to turn auto-lock off).
- Managers see an "Open Drawers" console: who holds each register, whether it is
  locked and how often it has been locked, with force unlock, force close and PIN
  reset - every one of them recorded in the audit log.

### Device registry

- Register POS terminals, mobile devices, kiosks, kitchen displays and printers.
- Track each device's status, location, last heartbeat and configuration version.
- Retire devices to revoke their credentials.

### Pairing hardware (printers, scanners, drawers, displays)

Open Register Hardware. The page automatically detects your system and lists the transports your browser supports: Web Serial for USB and serial, WebUSB, and Web Bluetooth.

- Auto-detect and connect: reconnects to previously paired devices with no prompts.
- Pair USB or Serial, Pair WebUSB, or Pair Bluetooth: first-time pairing uses the browser's device chooser once; after that the device is remembered and reconnects automatically.
- Every already-granted device appears in the Paired Devices list and is classified as a printer, scanner, cash drawer, display or scale, so nothing goes missing.
- Test Print sends a sample receipt; Open Cash Drawer sends a drawer kick.
- Arm Scanner enables keyboard-wedge barcode scanning, which works with both USB-HID and Bluetooth scanners.

> Requirements: Real device pairing needs Chrome or Edge on a desktop over HTTPS or localhost. Firefox and Safari do not implement these device APIs, so the app falls back to a console simulator and nothing breaks.

### Receipt printer settings

- Set the baud rate, paper width (58mm or 80mm), receipt currency and symbol.
- Choose the cash drawer pin and whether to auto-open on cash sales and auto-print after checkout.

## 18. Offline Mode and Sync

Unified POS keeps selling when the network drops.

- Transactions are queued securely on the device while offline.
- When connectivity returns, the queue flushes automatically in the background, even if the tab was closed.
- Sync is idempotent: each transaction is de-duplicated so nothing is double-counted.
- The Sync page shows the queue, per-device status and a full sync history with sequence numbers and outcomes.

## 19. Reports and Analytics

Reports turn activity into decisions.

- Sales reports by period, product, category, location, register and employee.
- Inventory reports for stock valuation, movement, shrinkage and aging.
- Customer and loyalty reports for retention and lifetime value.
- Marketing campaign performance and attribution.
- Accounting summaries and tax reports.
- Export reports for offline analysis or sharing.

## 20. AI Insights, Forecasting and Copilot

Artificial intelligence is built in to help you act, not just observe.

- AI Insights surfaces anomalies, trends and opportunities in plain language.
- Forecasting projects demand and sales so you can stock and staff appropriately.
- Reorder recommendations suggest what to purchase and when.
- Labor optimization recommends schedules aligned to predicted demand.
- The Copilot answers natural-language questions about your business and proposes next steps, with a concise summary of what changed and what to do.

## 21. Notifications

- The bell in the top bar shows unread notifications with a badge.
- Receive alerts for low stock, system events, marketing triggers and order activity.
- Manage notification preferences per channel and per event type.
- Where enabled, push notifications reach supported browsers and devices.

## 22. Compliance Center

The Compliance Center helps you meet legal and privacy obligations.

- Record and manage customer consent for cookies and communications.
- Honor data-subject requests: export personal data and submit deletion requests.
- Maintain compliance records and evidence for audits.
- Review privacy policies, terms, cookie policy, accessibility statement, refund policy and the data processing agreement.

## 23. Enterprise and Multi-Region

For organizations operating across sites and countries.

- Manage multiple locations and warehouses under one organization.
- Provision and monitor global regions for data residency and performance.
- Assign locations to regions and track coverage.
- Apply consistent policies while allowing local tax, currency and language settings.

## 24. Developer Platform

Extend and integrate Unified POS.

- Generate API keys (public and secret) to call the platform programmatically.
- Register OAuth applications for secure third-party access.
- Configure webhooks to receive real-time events, with signature verification.
- Explore a catalog of integrations across payments, accounting, commerce, delivery and marketing, and connect the ones you need.
- Use the sandbox and API documentation to build and test safely.

## 25. System and Observability

Keep the platform healthy and observable.

- View health, readiness and runtime metrics.
- Monitor non-functional requirements such as latency and error rates.
- Manage backups and disaster-recovery posture.
- Review the audit log of sensitive actions for security and accountability.

## 26. Settings

Settings configure how the system looks and behaves for your business.

- Business profile: name, industry, address, phone, email and website.
- Branding: logo, favicon, cover graphics, brand colors and tagline, uploaded as media.
- Localization: country, language, time zone, currency and tax rate.
- Receipts: footer message, paper width and printer behavior.
- Alerts: low-stock thresholds and notification preferences.
- Security: change passwords and review active sessions.

> Tip: Branding and receipt changes take effect immediately across the register, receipts and the online store.

## 27. Security and Privacy

- Multi-tenant isolation ensures your data is separated from every other business.
- Passwords are hashed; sensitive credentials at rest are encrypted.
- Role-based access control and rate limiting protect against abuse.
- Each cashier's register drawer is protected by their own individual PIN: a locked
  register accepts no sale, refund or cash movement until its owner unlocks it, and
  repeated wrong guesses temporarily freeze the PIN.
- Sessions use secure cookies; audit logging records sensitive actions.
- You own your data. Export or request deletion at any time from the Compliance Center.

## 28. Troubleshooting and FAQ

### The register will not connect to my printer

- Confirm you are using Chrome or Edge on a desktop, over HTTPS or localhost.
- On Register Hardware, check that the transport chip for your connection type is available.
- Choose the correct Pair button, select the printer in the browser chooser, and confirm the baud rate and paper width.
- Use Test Print to verify. If nothing prints, check the printer's power, cable and paper.

### A page appears blank

- Refresh the browser. If it persists, sign out and back in.
- Confirm your session has not expired and that your role grants access to that module.

### Payments fail

- Verify the payment provider is configured and reachable.
- In non-production setups, confirm whether the simulator is active.
- Check the Payments module and audit log for the specific error.

### Data is not syncing

- Open the Sync page to see the queue and last outcome per device.
- Confirm connectivity; the queue flushes automatically when you are back online.

### I forgot my password

- Use Forgot Password on the Sign In page. The reset link is sent to your email.

## 29. Keyboard and Speed Tips

- Use the search box to jump to any product fast; barcode scanners type into it automatically.
- Arm the scanner on the Hardware page for continuous scanning during a shift.
- Learn the common register actions: add item, discount, hold, recall, take payment and print.
- Keep the register session open for the whole shift to maintain accurate cash tracking.

## 30. Roles at a Glance

- Owner: full access, including billing, enterprise, developer platform and destructive actions.
- Admin: broad operational access across modules, staff and settings.
- Manager: day-to-day operations, purchasing, inventory, reporting and staff scheduling.
- Cashier: register operations, order taking and basic customer lookup.

> Access is fully configurable. Your organization can tailor each role's permissions per module and action.

## 31. Glossary

- Register: a point of sale, physical or virtual, where sales are rung up.
- Session or Shift: an opened-to-closed period on a register with a cash float and variance.
- Tender: a payment method applied to a sale.
- Stored Value: gift cards and store credit balances tracked with a ledger.
- SKU: a unique identifier for a sellable item or variant.
- Batch or Lot: a group of stock tracked together for recalls and expiry.
- RFM: Recency, Frequency, Monetary - a customer value scoring model.
- Omnichannel: unified selling across in-person, online and marketplace channels.
- Idempotent Sync: de-duplicated offline sync so transactions are never double-counted.
- Web Serial, WebUSB, Web Bluetooth: browser APIs for connecting physical devices.
- Fiscalisation: a government requirement that every receipt be signed, numbered and (in most regimes) reported.
- Seal: the cryptographic signature and chain link that makes a fiscal document tamper-evident.
- Settlement rail: the local clearing network a payment travels (SEPA Instant, PIX, ACH, UPI, M-Pesa and so on).
- Reconciliation: matching what the acquirer paid out against what the register recorded.
- Mandate: a signed, time-limited, ceiling-capped authorisation a shopping agent presents at checkout.
- Fencing token: the (epoch, sequence) pair that lets a store reject writes from a deposed leader.
- Royalty base: agreed revenue after exclusions, which is what a franchise royalty is actually charged on.
- Elimination: removing intercompany sales when consolidating a franchise network, because the network did not sell to itself.
- k-anonymity: a privacy rule that hides any statistic drawn from fewer than k comparable stores.

## 32. Global Expansion Modules

Ten modules exist for one reason: a business that crosses a border - a second country, a second store, a franchisee, a buying agent, a partner app - normally needs a second system. Here it needs a second tick box. Each one is described below with where to find it in the navigation.

### 32.1 Fiscalisation and e-invoicing

**Where: Fiscal.**

Unified POS ships 26 country regimes - TSE in Germany, SdI in Italy, ZATCA Phase 2 in Saudi Arabia, eTIMS in Kenya, NFC-e in Brazil, CFDI in Mexico, GST e-invoicing in India, KSeF in Poland and more - plus a no-fiscalisation profile for markets such as the US and UK.

- Every sealed document carries a sequence number, a digest of its content and a link to the previous document, so editing an old receipt breaks the chain and says so.
- **Verify chain** re-walks the documents and reports the first break, which is what an auditor asks for.
- Missing receipt numbers are listed rather than silently accepted; each regime keeps its own document numbering prefix and retention period.
- Where the regime requires a QR or TLV block (ZATCA, eTIMS, SAT, FATOORA), it is generated on the receipt.
- Reporting is queued, retried with back-off and shown with its last outcome. When a country needs a hardware or partner bridge, the Fiscal page tells you which single setting is missing instead of failing at the register.

### 32.2 Local payment rails and settlement

**Where: Rails.**

- Validates the identifier the local rail actually demands: IBAN check digits, US routing numbers, UK sort codes, Mexican CLABE, Brazilian CPF/CNPJ, Indian IFSC and UPI addresses, Nigerian NUBAN, Australian BSB, South African till numbers and international MSISDNs. A mistyped digit is caught before money moves, with the reason.
- Chooses the cheapest workable rail for a payout (instant, standard or wire) using each network's ceiling and fee, and shows what the choice costs.
- **Settlement reconciliation** compares the acquirer's statement against your own captured sales line by line, classifying every difference as amount, fee, timing or unmatched, and publishes a batch health score so a slow day is visible immediately.

### 32.3 Agentic back-office

**Where: Agent Ops.**

The planner forecasts demand per item, then works out the reorder point from lead time, review period and a chosen service level, with safety stock, pack sizes and supplier minimums respected.

- Guardrails are yours: a maximum spend, a maximum number of lines, and suppliers you have blocked. The plan trims the least urgent lines to fit and tells you what was deferred.
- Urgency is scored, so the line that runs dry first is at the top of the list.
- Approved lines become draft purchase orders. **Nothing is sent to a supplier until a human approves it** - the agent drafts, you decide.

### 32.4 Vertical solutions

**Where: Verticals.**

Fourteen trade packs - grocery, pharmacy, fashion, hardware, auto repair, salon, quick service, liquor, electronics, bakery, wholesale, rental, pet care and clinic - each add the fields, menu entries and register behaviour that trade needs. Enabling a pack applies it to your location; disabling it removes what it added without touching your sales history.

### 32.5 Embedded finance

**Where: Finance.**

- Underwriting reads only your own trading history - months trading, sales stability, refund and chargeback rates, dormant days and settlement freshness - and returns a score, a risk band, a suggested limit, the reasons for any decline and a term sheet per available duration.
- Each facility has a real amortisation schedule and a daily sweep that takes a fixed percentage of net sales, capped, oldest instalment first. Any leftover is reported rather than applied twice.
- This is a ledger of a credit facility with its repayment maths; funds move only through the payment rails you have already configured.

### 32.6 Agentic commerce

**Where: Agent Storefront.**

Buying agents can already read your shop; now they can pay for it safely.

- The catalogue is published as JSON-LD (schema.org Product and Offer) so an agent can price and stock-check without scraping.
- `/.well-known/unifiedpos` and `/.well-known/unifiedpos/{merchantId}` declare your endpoints, mandate rules and accepted payment methods before an agent authenticates.
- A **mandate** is a signed authorisation with a ceiling amount, a lifetime, per-line price guards and a nonce. Checkout verifies the signature, the window, the currency, stock, the agent-sellable flag and the ceiling, and refuses with a specific code so the agent can correct one line instead of losing the sale.

### 32.7 Store mesh

**Where: Mesh.**

A store is a terminal, a tablet, a kitchen display and a kiosk writing to the same stock count.

- The leader is elected deterministically from live devices (role, then operator priority, then most recent heartbeat, then id), so every device reaches the same answer.
- The leader holds a lease. Every write carries its epoch and sequence, which is what fences off the classic failure: a partitioned ex-leader coming back and overwriting committed state. A write claiming an epoch the store never granted is refused for the same reason.
- Concurrent stock edits are merged as deltas rather than overwriting each other; absolute values fall back to last-writer-wins with a deterministic tie-break.
- The page shows health as healthy, degraded or isolated, with the lease countdown and which devices are unreachable.

### 32.8 Franchise and multi-entity

**Where: Franchise.**

- Royalty agreements support flat percentage, banded, per-unit and fixed models, agreed exclusions (VAT, tips, gift-card redemption) and a monthly minimum. Each calculation is printed as the steps that produced it, so a franchisee can audit a statement without asking you for a spreadsheet.
- Stock moved between entities is priced cost-plus-markup with freight, so the sending entity recognises its margin and the receiving one carries a real cost.
- The consolidated P&L sums the entities and then eliminates intercompany sales and their matching cost, showing the unrealised profit still sitting in a franchisee's stock. Unpaid royalties are aged.

### 32.9 Ecosystem: apps and custom fields

**Where: Apps.**

- Eleven partner and first-party apps are listed with exactly the scopes they need. Installing shows the riskiest thing the grant can do; a high-risk grant needs an explicit acknowledgement before it is issued.
- The API token is shown once. It can be rotated or revoked per installation, verified, and its scopes narrowed later without reinstalling.
- Custom fields add the columns your trade needs - cut length, batch number, stylist note - to orders, customers or products. Values are typed and validated at the edge, so a number field never quietly accepts "yes".

### 32.10 Peer benchmarking

**Where: Benchmark.**

Ten metrics - average basket, gross margin, labour cost, shrink, discounting, attachment rate, repeat customers, digital share, inventory turns and daily sales - compared against stores in your country, trade and size band.

- A cohort smaller than the k threshold never publishes, not even a median. Outliers are clipped into the 5th-95th percentile range and a calibrated noise figure is added to what is shown.
- The page publishes the privacy ledger with every figure: cohort size, k, noise applied, participation rate. A suppressed cell is the model working, not a missing feature.
- Contributing your own numbers is what makes the comparison exist at all; the participation rate is shown alongside every metric.

## 33. Getting Help

- Use this manual at any time from the footer link: User Manual (PDF).
- Review the legal and policy documents from the footer and the Compliance Center.
- Contact support for assistance with your account, integrations or hardware.

> Thank you for choosing Unified POS. We are proud to power your business, everywhere in the world.
